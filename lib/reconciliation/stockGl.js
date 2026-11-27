// lib/reconciliation/stockGl.js
//
// Stock ↔ GL reconciliation for one month (ported from Accounting).
//
// Compares, per stock GL account (item category stock_acno, else the
// "Stock" Account Settings default — same resolution as the costing JVs):
//   • GL ledger balance — same posting logic as the Trial Balance / Balance Sheet
//   • Stock Activity With Rate closing value — the costing view of the same stock
// and splits the difference into causes, so nobody has to trace it by hand.
//
// Every component is a signed effect on the stock balance:
//   ledger effect − report effect = that component's share of the difference.
// Σ ledger effects = GL closing, Σ report effects = report closing, by construction.
//
// For JV-driven components three figures are shown:
//   report — what the stock report counts
//   now    — what the auto JV would post if generated today
//   ledger — what was actually posted
// ledger − now = JV is stale (posted before re-costing)
// now − report = JV method differs from the stock report
//
// Read-only. Reads go through `prisma` (lib/prisma.js) so "Hide off books"
// applies; opening stock only through lib/openingStock.js (per godown, summed).

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getAllAccountSettings } from "@/lib/accounts/accountSettings";
import { getOpening } from "@/lib/openingStock";
import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import {
  getStockActivityWithRateReport,
  getCostOfGoodsManufacturedReport,
  getCostOfGoodsSoldReport,
} from "@/app/api/reports/[reportType]/route";

// Auto JV markers written by finalizeCogJV (app/api/reports/[reportType]/route.js):
// TRANSACTIONS_MASTER tran_code 3, rmk1 = `AUTO_${tag}`, rmk5 = period.
// COGM / MATISS period = "M/YYYY", COGS period = "yyyy-MM".
const COGM_TAG = "AUTO_COGM";
const COGS_TAG = "AUTO_COGS";
const MATISS_TAG = "AUTO_MATISS";
const TOLERANCE = 1;           // component differences below this are rounding
const BALANCED_TOLERANCE = 10; // an account (or the total) within this is balanced

const n = (v) => Number(v || 0);
const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const pad2 = (v) => String(v).padStart(2, "0");

// GL movement sign — identical to the Trial Balance / Accounts Activity reports
// (tran codes as in this system: 21 = Service Invoice).
const GL_TRAN_CODES = [1, 2, 3, 4, 5, 6, 9, 10, 12, 21];
const GL_NET = Prisma.sql`(
  CASE
    WHEN tm.tran_code = 1 AND t.sub_tran_id = 1       THEN -COALESCE(t.camt,0)
    WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3)  THEN  COALESCE(t.damt,0)
    WHEN tm.tran_code = 2 AND t.sub_tran_id = 1       THEN  COALESCE(t.damt,0)
    WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3)  THEN -COALESCE(t.camt,0)
    WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)         THEN  COALESCE(t.damt,0) - COALESCE(t.camt,0)
    ELSE 0
  END)`;

// Same text filter the Direct Material Issuance report / JV uses
const DIRECT_ISSUE_SQL = Prisma.sql`(
  tm.rmk5 ILIKE 'Clean%' OR tm.rmk5 ILIKE 'Lab%' OR tm.rmk5 ILIKE '%qc%'
)`;
// T7/T8 linked to a Posted production plan through its process order reference
// (lib/manufacturing/processOrderRef.js — process_order_id, else rmk5 on a
// voucher that is not automatic; same rule as production costing)
const PLAN_LINKED_SQL = Prisma.sql`EXISTS (
  SELECT 1 FROM "productionPlanMaster" p
  WHERE p.id = NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")},''), '[^0-9]', '', 'g'), '')::integer
    AND p.status = 'Posted'
)`;

function monthBounds(month, year) {
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const to = new Date(year, month, 0, 23, 59, 59, 999);
  const fromStr = `${year}-${pad2(month)}-01`;
  const toStr = `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;
  return { from, to, fromStr, toStr };
}

function prevMonth(month, year) {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

// ── Data loaders ────────────────────────────────────────────────────────────

// itcd → { name, category, acno (stock), purchaseAcno, purchaseRetAcno }
// Category column first, then the Account Settings default — the same chain
// lib/accounts/itemAccounts.js uses when the vouchers / costing JVs post.
async function loadItems() {
  const [items, settings] = await Promise.all([
    prisma.item.findMany({
      select: {
        itcd: true, item: true, ic_id: true,
        itemCategories: { select: { ic_name: true, stock_acno: true, purchase_acno: true, purchase_return_acno: true } },
      },
    }),
    getAllAccountSettings(),
  ]);
  const def = (key) => (settings[key]?.acno != null ? Number(settings[key].acno) : null);
  const stockDefault = def("stock");
  const purchaseDefault = def("purchase");
  const purchaseRetDefault = def("purchase_return");
  const map = new Map();
  for (const i of items) {
    const c = i.itemCategories || {};
    map.set(Number(i.itcd), {
      name: i.item || "",
      ic_id: Number(i.ic_id || 0),
      category: c.ic_name || "",
      acno: c.stock_acno != null ? Number(c.stock_acno) : stockDefault,
      purchaseAcno: c.purchase_acno != null ? Number(c.purchase_acno) : purchaseDefault,
      purchaseRetAcno: c.purchase_return_acno != null ? Number(c.purchase_return_acno) : purchaseRetDefault,
    });
  }
  return map;
}

async function loadLedger(acnos, fromStr, toStr) {
  if (acnos.length === 0) return { opening: new Map(), moves: [], manual: [] };

  const openingRows = await prisma.$queryRaw`
    SELECT t.acno, SUM(${GL_NET}) AS bal
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    WHERE t.acno = ANY(${acnos}::int[])
      AND tm.tran_code = ANY(${GL_TRAN_CODES}::int[])
      AND tm.dated < ${fromStr}::date
    GROUP BY t.acno
  `;

  const moves = await prisma.$queryRaw`
    SELECT t.acno, tm.tran_code, COALESCE(tm.rmk1, '') AS rmk1,
           SUM(COALESCE(t.damt,0)) AS dr, SUM(COALESCE(t.camt,0)) AS cr, SUM(${GL_NET}) AS net
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    WHERE t.acno = ANY(${acnos}::int[])
      AND tm.tran_code = ANY(${GL_TRAN_CODES}::int[])
      AND tm.dated BETWEEN ${fromStr}::date AND ${toStr}::date
    GROUP BY t.acno, tm.tran_code, COALESCE(tm.rmk1, '')
  `;

  // JVs other than the three costing auto JVs hitting stock accounts
  const manual = await prisma.$queryRaw`
    SELECT tm.tran_id, tm.tran_code, tm.vr_no, tm.dated, COALESCE(tm.rmk,'') AS rmk, COALESCE(tm.rmk1,'') AS rmk1,
           t.acno, SUM(${GL_NET}) AS net
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    WHERE t.acno = ANY(${acnos}::int[])
      AND tm.tran_code = 3
      AND COALESCE(tm.rmk1,'') NOT IN (${COGM_TAG}, ${COGS_TAG}, ${MATISS_TAG})
      AND tm.dated BETWEEN ${fromStr}::date AND ${toStr}::date
    GROUP BY tm.tran_id, tm.tran_code, tm.vr_no, tm.dated, tm.rmk, tm.rmk1, t.acno
    HAVING SUM(${GL_NET}) <> 0
    ORDER BY tm.dated, tm.tran_id
  `;

  return {
    opening: new Map(openingRows.map((r) => [Number(r.acno), n(r.bal)])),
    moves,
    manual,
  };
}

async function loadJvStatus(month, year) {
  const mySlash = `${month}/${year}`;
  const ymDash = `${year}-${pad2(month)}`;
  const rows = await prisma.$queryRaw`
    SELECT tm.tran_id, tm.tran_code, tm.vr_no, tm.dated, tm.rmk1, tm.rmk5
    FROM "TRANSACTIONS_MASTER" tm
    WHERE tm.tran_code = 3
      AND (
        (tm.rmk1 = ${COGM_TAG}   AND tm.rmk5 = ${mySlash}) OR
        (tm.rmk1 = ${MATISS_TAG} AND tm.rmk5 = ${mySlash}) OR
        (tm.rmk1 = ${COGS_TAG}   AND tm.rmk5 = ${ymDash})
      )
    ORDER BY tm.tran_id
  `;
  const byTag = {};
  for (const r of rows) {
    (byTag[r.rmk1] ||= []).push({
      tran_id: Number(r.tran_id), tran_code: Number(r.tran_code),
      vr_no: r.vr_no != null ? Number(r.vr_no) : null, dated: r.dated,
    });
  }
  return [
    { tag: COGM_TAG, label: "Cost of Goods Manufactured", vouchers: byTag[COGM_TAG] || [] },
    { tag: COGS_TAG, label: "Cost of Goods Sold", vouchers: byTag[COGS_TAG] || [] },
    { tag: MATISS_TAG, label: "Direct Material Issuance", vouchers: byTag[MATISS_TAG] || [] },
  ];
}

// T7 issuance qty per item, split by which auto JV credits it
async function loadIssuanceClasses(from, to) {
  const rows = await prisma.$queryRaw`
    SELECT t.itcd,
           CASE
             WHEN ${DIRECT_ISSUE_SQL} THEN 'direct'
             WHEN ${PLAN_LINKED_SQL}  THEN 'plan'
             ELSE 'orphan'
           END AS cls,
           SUM(t.qty) AS qty,
           COUNT(DISTINCT tm.tran_id) AS vouchers
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    WHERE tm.tran_code = 7
      AND tm.dated >= ${from} AND tm.dated <= ${to}
      AND t.qty IS NOT NULL
      AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
    GROUP BY t.itcd, cls
  `;
  const orphanT8 = await prisma.$queryRaw`
    SELECT COUNT(*) AS cnt
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    WHERE tm.tran_code = 8
      AND tm.dated >= ${from} AND tm.dated <= ${to}
      AND t.sub_tran_id = 1 AND t.qty > 0
      AND NOT ${PLAN_LINKED_SQL}
  `;
  // Direct issuances whose rmk5 is not a valid plan are also swept into the
  // orphan production pool (costOrphanItems) when orphan receipts exist.
  const directAlsoOrphan = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT tm.tran_id) AS cnt
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    WHERE tm.tran_code = 7
      AND tm.dated >= ${from} AND tm.dated <= ${to}
      AND t.sub_tran_id = 1 AND t.qty > 0
      AND ${DIRECT_ISSUE_SQL}
      AND NOT ${PLAN_LINKED_SQL}
  `;
  return {
    rows: rows.map((r) => ({ itcd: Number(r.itcd), cls: r.cls, qty: n(r.qty), vouchers: Number(r.vouchers) })),
    orphanReceiptCount: Number(orphanT8[0]?.cnt || 0),
    directInOrphanPool: Number(directAlsoOrphan[0]?.cnt || 0),
  };
}

// Opening snapshot: one merged row per item, qty summed over all godowns.
async function loadSnapshot(month, year) {
  const rows = await getOpening(month, year);
  return new Map(rows
    .filter((s) => n(s.opening_qty) !== 0 || n(s.opening_rate) !== 0)
    .map((s) => [Number(s.itcd), { qty: n(s.opening_qty), rate: n(s.opening_rate), value: n(s.opening_value) }]));
}

// ── COGM JV "if posted now" — mirrors postCostOfGoodsManufacturedJV ─────────
function cogmNowByAcno(cogmRows, itemMap) {
  const dr = new Map();
  const cr = new Map();
  const materials = new Map(); // material itcd → { qty, cost } as valued by production costing
  for (const r of cogmRows) {
    const producedAcno = itemMap.get(Number(r.mm_no))?.acno;
    const rmCost = r2(r.rm_cost);
    const net = r2(rmCost + r2(r.cc_cost));
    if (producedAcno != null) dr.set(producedAcno, n(dr.get(producedAcno)) + net);

    let mats = [];
    try { mats = JSON.parse(r.material_details || "[]"); } catch { mats = []; }
    mats = mats.filter((m) => n(m.total_cost) !== 0);
    const matSum = mats.reduce((s, m) => s + n(m.total_cost), 0);
    for (const m of mats) {
      const id = Number(m.material_itcd);
      const mm = materials.get(id) || { qty: 0, cost: 0 };
      mm.qty += n(m.total_qty);
      mm.cost += n(m.total_cost);
      materials.set(id, mm);
      if (rmCost === 0 || matSum <= 0) continue;
      const acno = itemMap.get(id)?.acno;
      if (acno == null) continue;
      cr.set(acno, n(cr.get(acno)) + rmCost * (n(m.total_cost) / matSum));
    }
  }
  return { dr, cr, materials };
}

// ── COGS JV "if posted now" — mirrors postCostOfGoodsSoldJV (credit per stock acno)
function cogsNowByAcno(cogsRows, itemMap) {
  const cr = new Map();
  for (const r of cogsRows || []) {
    const cost = n(r.net_cost_amount ?? r.total_cost_amount);
    if (cost === 0) continue;
    const acno = itemMap.get(Number(r.product_code))?.acno;
    if (acno == null) continue;
    cr.set(acno, n(cr.get(acno)) + cost);
  }
  return cr;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function getStockGlReconciliation({ month, year }) {
  const { from, to, fromStr, toStr } = monthBounds(month, year);
  const prev = prevMonth(month, year);
  const prevBounds = monthBounds(prev.month, prev.year);

  const [itemMap, report, prevReport, cogmRows, cogsRows, issuance, snapshot, jvStatus] = await Promise.all([
    loadItems(),
    getStockActivityWithRateReport({ dateFrom: from, dateTo: to, viewMode: "summary" }),
    getStockActivityWithRateReport({ dateFrom: prevBounds.from, dateTo: prevBounds.to, viewMode: "summary" }),
    getCostOfGoodsManufacturedReport({ month, year, viewMode: "summary" }),
    getCostOfGoodsSoldReport({ dateFrom: from, dateTo: to }),
    loadIssuanceClasses(from, to),
    loadSnapshot(month, year),
    loadJvStatus(month, year),
  ]);

  const summaryCogm = (cogmRows || []).filter((r) => r.view_type === "summary");
  const cogmNow = cogmNowByAcno(summaryCogm, itemMap);
  const cogsNow = cogsNowByAcno(cogsRows, itemMap);
  const orphanCovered = issuance.orphanReceiptCount > 0;

  // Per-item issuance class qty
  const issueByItem = new Map(); // itcd → { plan, orphan, direct, vouchers }
  for (const r of issuance.rows) {
    const e = issueByItem.get(r.itcd) || { plan: 0, orphan: 0, direct: 0, vouchers: 0 };
    e[r.cls] += r.qty;
    e.vouchers += r.vouchers;
    issueByItem.set(r.itcd, e);
  }

  // ── Report side per account ───────────────────────────────────────────────
  const blank = () => ({
    opening: 0, purchases: 0, production: 0, issuePlan: 0, issueOrphan: 0, issueDirect: 0,
    issueTotal: 0, sales: 0, transfers: 0, closing: 0, prevClosing: 0, items: 0,
    purchaseElsewhere: new Set(), // purchase / return accounts that are not this stock account
  });
  const rep = new Map();
  const acc = (acno) => { if (!rep.has(acno)) rep.set(acno, blank()); return rep.get(acno); };
  const missingAcno = [];
  const negativeClosing = [];
  const noCostProduction = [];
  const uncoveredIssuance = [];

  for (const r of report) {
    const itcd = Number(r.product_code);
    const info = itemMap.get(itcd);
    const acno = info?.acno;
    const closing = n(r.closing_value);
    const rate = n(r.total_cost_rate);
    const issueRate = n(r.material_issuance_rate);

    if (acno == null) {
      if (Math.abs(closing) >= TOLERANCE || Math.abs(n(r.opening_value)) >= TOLERANCE) {
        missingAcno.push({ itcd, name: r.product_name, category: r.category, closing_value: r2(closing) });
      }
      continue;
    }
    const a = acc(acno);
    a.items += 1;
    a.opening += n(r.opening_value);
    const purchases = n(r.purchase_amount) - n(r.purchase_ret_amount);
    a.purchases += purchases;
    if (Math.abs(purchases) >= TOLERANCE) {
      if (info.purchaseAcno != null && info.purchaseAcno !== acno) a.purchaseElsewhere.add(info.purchaseAcno);
      if (n(r.purchase_ret_amount) && info.purchaseRetAcno != null && info.purchaseRetAcno !== acno) a.purchaseElsewhere.add(info.purchaseRetAcno);
    }
    a.production += n(r.material_production_amount);
    a.issueTotal += n(r.material_issuance_amount);
    const netSold = n(r.sale_qty) + n(r.pos_qty) - n(r.sale_ret_qty) - n(r.pos_ret_qty);
    a.sales += netSold * rate;
    a.transfers += n(r.transfer_in_amount) - n(r.transfer_out_amount);
    a.closing += closing;

    const cls = issueByItem.get(itcd);
    if (cls) {
      a.issuePlan += cls.plan * issueRate;
      a.issueDirect += cls.direct * issueRate;
      a.issueOrphan += cls.orphan * issueRate;
      if (!orphanCovered && cls.orphan > 0) {
        uncoveredIssuance.push({
          itcd, name: r.product_name, acno, qty: cls.orphan, rate: issueRate, value: r2(cls.orphan * issueRate),
        });
      }
    }

    if (n(r.closing_qty) < 0) {
      negativeClosing.push({ itcd, name: r.product_name, acno, qty: n(r.closing_qty), rate, value: r2(closing) });
    }
    if (n(r.material_production_qty) > 0 && n(r.material_production_rate) === 0) {
      noCostProduction.push({ itcd, name: r.product_name, acno, qty: n(r.material_production_qty) });
    }
  }

  // Previous month closing per account + opening snapshot drift per item
  const prevByItem = new Map(prevReport.map((r) => [Number(r.product_code), r]));
  for (const r of prevReport) {
    const acno = itemMap.get(Number(r.product_code))?.acno;
    if (acno != null && rep.has(acno)) rep.get(acno).prevClosing += n(r.closing_value);
  }
  const openingDrift = [];
  const driftIds = new Set([...prevByItem.keys(), ...snapshot.keys()]);
  for (const itcd of driftIds) {
    const info = itemMap.get(itcd);
    if (info?.acno == null || !rep.has(info.acno)) continue;
    const p = prevByItem.get(itcd);
    const s = snapshot.get(itcd);
    const prevQty = n(p?.closing_qty);
    const prevVal = n(p?.closing_value);
    const snapQty = s ? s.qty : 0;
    const snapVal = s ? s.value : 0;
    const diff = snapVal - prevVal;
    if (Math.abs(diff) < TOLERANCE) continue;
    let reason;
    if (!s) reason = "Missing from opening snapshot";
    else if (prevQty < 0 && snapQty === 0) reason = "Negative closing dropped to 0 at lock";
    else if (snapQty < 0 && prevQty >= 0) reason = "Opening edited to negative after lock";
    else if (Math.abs(snapQty - prevQty) > 0.0005) reason = "Qty changed after lock";
    else reason = "Rate changed after lock (re-costed)";
    openingDrift.push({
      itcd, name: info.name, acno: info.acno, reason,
      prev_qty: prevQty, prev_value: r2(prevVal), snap_qty: snapQty, snap_value: r2(snapVal),
      diff: r2(diff),
    });
  }

  // ── Ledger side per account ───────────────────────────────────────────────
  const acnos = [...rep.entries()]
    .filter(([, a]) => [a.opening, a.closing, a.purchases, a.production, a.issueTotal, a.sales, a.prevClosing]
      .some((v) => Math.abs(v) >= TOLERANCE))
    .map(([acno]) => acno);
  const ledger = await loadLedger(acnos, fromStr, toStr);
  const nameIds = [...new Set([...acnos, ...[...rep.values()].flatMap((a) => [...a.purchaseElsewhere])])];
  const acnames = new Map(
    (nameIds.length
      ? await prisma.aCNO.findMany({ where: { acno: { in: nameIds } }, select: { acno: true, acname: true } })
      : []
    ).map((a) => [Number(a.acno), a.acname])
  );

  const led = new Map(acnos.map((a) => [a, {
    opening: n(ledger.opening.get(a)), purchases: 0, cogmDr: 0, cogmCr: 0, cogsNet: 0, matissNet: 0,
    manual: 0, other: 0, otherCodes: new Set(),
  }]));
  for (const m of ledger.moves) {
    const L = led.get(Number(m.acno));
    if (!L) continue;
    const code = Number(m.tran_code);
    if (code === 4 || code === 9) L.purchases += n(m.net);
    else if (code === 3 && m.rmk1 === COGM_TAG) { L.cogmDr += n(m.dr); L.cogmCr += n(m.cr); }
    else if (code === 3 && m.rmk1 === COGS_TAG) L.cogsNet += n(m.net);
    else if (code === 3 && m.rmk1 === MATISS_TAG) L.matissNet += n(m.net);
    else if (code === 3) L.manual += n(m.net);
    else { L.other += n(m.net); L.otherCodes.add(code); }
  }
  const manualJvs = ledger.manual.map((j) => ({
    tran_id: Number(j.tran_id), tran_code: Number(j.tran_code),
    vr_no: j.vr_no != null ? Number(j.vr_no) : null, dated: j.dated,
    rmk: j.rmk, rmk1: j.rmk1, acno: Number(j.acno), net: r2(j.net),
  }));

  const posted = Object.fromEntries(jvStatus.map((j) => [j.tag, j.vouchers.length > 0]));

  // ── Components per account ────────────────────────────────────────────────
  const findings = [];
  const accounts = acnos.map((acno) => {
    const R = rep.get(acno);
    const L = led.get(acno);
    const L_close = L.opening + L.purchases + L.cogmDr - L.cogmCr + L.cogsNet + L.matissNet + L.manual + L.other;

    const issueCovered = R.issuePlan + (orphanCovered ? R.issueOrphan : 0);
    const issueUncovered = orphanCovered ? 0 : R.issueOrphan;
    const issueOther = R.issueTotal - R.issuePlan - R.issueOrphan - R.issueDirect;
    const reportFlows = R.opening + R.purchases + R.production - R.issueTotal - R.sales + R.transfers;

    const comp = (key, label, ledgerV, reportV, extra = {}) => ({
      key, label, ledger: r2(ledgerV), report: r2(reportV), diff: r2(ledgerV - reportV), ...extra,
    });
    const jvComp = (key, label, tag, ledgerV, reportV, nowV) => comp(key, label, ledgerV, reportV, {
      now: r2(nowV), jv: tag, posted: posted[tag],
      stale: r2(ledgerV - nowV),   // posted vs if-posted-today
      method: r2(nowV - reportV),  // JV method vs stock report
    });

    const components = [
      comp("opening", "Opening balance", L.opening, R.opening, {
        prevClosing: r2(R.prevClosing),
        carried: r2(L.opening - R.prevClosing),     // gap already in the ledger vs last month's report
        snapshotDrift: r2(R.opening - R.prevClosing), // opening snapshot vs last month's closing
      }),
      comp("purchases", "Purchases − returns", L.purchases, R.purchases, {
        postedTo: [...R.purchaseElsewhere].map((a) => ({ acno: a, acname: acnames.get(a) || `Account ${a}` })),
      }),
      jvComp("production", "Production received (COGM Dr)", COGM_TAG, L.cogmDr, R.production, n(cogmNow.dr.get(acno))),
      jvComp("consumption", "Consumed in production (COGM Cr)", COGM_TAG, -L.cogmCr, -issueCovered, -n(cogmNow.cr.get(acno))),
      jvComp("direct", "Direct issuance (MATISS Cr)", MATISS_TAG, L.matissNet, -R.issueDirect, -R.issueDirect),
      comp("uncovered", "Issuances not covered by any JV", 0, -issueUncovered),
      comp("issueOther", "Other issuance valuation", 0, -issueOther),
      jvComp("sales", "Cost of sales (COGS Cr)", COGS_TAG, L.cogsNet, -R.sales, -n(cogsNow.get(acno))),
      comp("transfers", "Transfers", 0, R.transfers),
      comp("manual", "Manual JVs to stock account", L.manual, 0),
      comp("other", "Other vouchers posting to stock", L.other, 0, { codes: [...L.otherCodes] }),
      comp("rounding", "Report valuation rounding", 0, R.closing - reportFlows),
    ];

    const diff = r2(L_close - R.closing);
    const name = acnames.get(acno) || `Account ${acno}`;

    findings.push(...explainAccount({ acno, acname: name, components, accountDiff: diff }));

    return {
      acno, acname: name, items: R.items,
      ledger_closing: r2(L_close), report_closing: r2(R.closing), diff, components,
    };
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // Rate mismatch: materials consumed in production, COGM value vs stock report value
  const rateMismatch = [];
  const reportByItem = new Map(report.map((x) => [Number(x.product_code), x]));
  for (const [itcd, m] of cogmNow.materials) {
    const r = reportByItem.get(itcd);
    if (!r || m.qty <= 0) continue;
    const reportValue = m.qty * n(r.material_issuance_rate);
    const diff = m.cost - reportValue;
    if (Math.abs(diff) < TOLERANCE) continue;
    rateMismatch.push({
      itcd, name: r.product_name, acno: itemMap.get(itcd)?.acno ?? null, qty: m.qty,
      cogm_rate: m.cost / m.qty, report_rate: n(r.material_issuance_rate),
      cogm_value: r2(m.cost), report_value: r2(reportValue), diff: r2(diff),
    });
  }
  rateMismatch.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // Data-health checks: not differences yet, but they cause them
  const checks = [];
  if (issuance.directInOrphanPool > 0 && orphanCovered) checks.push({
    id: "direct_in_orphan", count: issuance.directInOrphanPool,
    title: "Cleaning / Lab issues may be credited twice",
    what: `${issuance.directInOrphanPool} Cleaning/Lab/QC issue voucher(s) have no production-plan link.`,
    why: "Unplanned production costing picks up every unlinked issue, including these — and the Direct Issuance JV credits them too.",
    fix: ["Keep Cleaning/Lab/QC issues out of unplanned production, or link them to a plan."],
  });
  if (missingAcno.length) checks.push({
    id: "missing_acno", count: missingAcno.length, items: "missingAcno",
    title: "Items without a stock account",
    what: `${missingAcno.length} item(s) carry stock value but neither their category nor the 'Stock' Account Setting gives a stock account.`,
    why: "The stock report values them, but no JV can post them, so they never reach the GL.",
    fix: ["Set the stock account on the item category, or the 'Stock' default in Finance → Account Settings."],
  });
  if (negativeClosing.length) checks.push({
    id: "negative_stock", count: negativeClosing.length, items: "negativeClosing",
    title: "Negative closing stock",
    what: `${negativeClosing.length} item(s) end the month below zero.`,
    why: "Issues or sales were posted before the matching receipt. Negative stock is valued at the blended rate and makes rates unreliable.",
    fix: ["Post the missing receipts or correct the issue quantities before locking the month."],
  });
  if (noCostProduction.length) checks.push({
    id: "no_cost_production", count: noCostProduction.length, items: "noCostProduction",
    title: "Production without cost",
    what: `${noCostProduction.length} item(s) were produced this month but have no production costing entry.`,
    why: "Their production is valued at 0, which pulls their blended rate down.",
    fix: ["Run production costing for this month (Costing → Production)."],
  });

  findings.sort((a, b) => Number(a.resolved) - Number(b.resolved) || Math.abs(b.amount) - Math.abs(a.amount));

  const totals = {
    ledger: r2(accounts.reduce((s, a) => s + a.ledger_closing, 0)),
    report: r2(accounts.reduce((s, a) => s + a.report_closing, 0)),
  };
  totals.diff = r2(totals.ledger - totals.report);

  return {
    period: { month, year, from: fromStr, to: toStr },
    tolerance: BALANCED_TOLERANCE,
    totals,
    accounts,
    jvStatus,
    findings,
    checks,
    issues: {
      openingDrift: openingDrift.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
      negativeClosing: negativeClosing.sort((a, b) => a.value - b.value),
      uncoveredIssuance: uncoveredIssuance.sort((a, b) => b.value - a.value),
      noCostProduction,
      rateMismatch: rateMismatch.slice(0, 100),
      manualJvs,
      missingAcno,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Explanations
// Each finding answers: what is different, why the system ends up like this,
// and what to change (numbered steps). `items` names the issues list with the
// affected items. Findings on an account that already balances are marked
// resolved — older differences that cancel out (e.g. a manual JV fixing a gap).
// ─────────────────────────────────────────────────────────────────────────────

const JV_INFO = {
  AUTO_COGM: { name: "COGM", report: "Cost of Goods Manufactured report" },
  AUTO_COGS: { name: "COGS", report: "Cost of Goods Sold report" },
  AUTO_MATISS: { name: "Direct Material Issuance", report: "Direct Material Issuance Cost report" },
};

const METHOD_WHY = {
  production: "COGM debits each produced item with RM + CC from production costing, using the quantity that was costed. The stock report values production as quantity received × the costing rate. When costed and received quantities differ, so do the amounts.",
  consumption: "COGM credits materials at the production-costing rate. The stock report values every issue at the month's blended rate (opening + purchases + production). Small rate differences on large quantities add up.",
  direct: "The Direct Issuance JV and the stock report should use the same blended rate; a difference means the issuance list or rates changed.",
  sales: "The COGS JV only includes items with positive net sales (and, when Settings → Features costs sale returns at their original month, takes earlier months' returns at that month's cost). The stock report values every sale and return at this month's rate.",
};

function severityOf(amount) {
  const a = Math.abs(n(amount));
  if (a >= 100000) return "high";
  if (a >= 1000) return "medium";
  return "low";
}

function explainAccount({ acno, acname, components, accountDiff }) {
  const resolved = Math.abs(accountDiff) < BALANCED_TOLERANCE;
  const out = [];
  const add = (cause, amount, text) => {
    if (Math.abs(n(amount)) < TOLERANCE) return;
    out.push({ id: `${acno}-${cause}`, acno, acname, cause, resolved, amount: r2(amount), severity: severityOf(amount), ...text });
  };

  for (const c of components) {
    if (Math.abs(c.diff) < TOLERANCE) continue;
    switch (c.key) {
      case "opening":
        add("opening_drift", -c.snapshotDrift, {
          title: "Opening stock doesn't match last month's closing",
          what: `This month's opening stock is ${fmtSigned(c.snapshotDrift)} against last month's closing in the stock report.`,
          why: "Opening stock is saved as a snapshot when the previous month is locked. If anything changes after the lock — vouchers posted or edited, costing re-run, or negative closing stock dropped to 0 — the report starts this month from a different value than the GL.",
          fix: [
            "Open the affected items to see the reason for each one.",
            "If last month's stock is now correct, unlock and re-lock last month so the opening is regenerated.",
            "Otherwise post one adjustment JV for this amount to the stock account.",
          ],
          items: "openingDrift",
        });
        add("carried", c.carried, {
          title: "Difference already existed at the start of the month",
          what: `The GL opening balance is ${fmtSigned(c.carried)} against last month's closing in the stock report.`,
          why: "GL and stock report were already apart when last month ended. This month only inherits that difference — the cause is in an earlier month.",
          fix: [
            "Switch this page to the previous month and fix the cause there.",
            "Or post one adjustment JV for this amount and note which month it belongs to.",
          ],
        });
        break;
      case "purchases": {
        const elsewhere = (c.postedTo || []).map((a) => `${a.acno} ${a.acname}`).join(", ");
        add("purchases", c.diff, {
          title: "Purchases post a different amount to stock",
          what: `Purchase and purchase-return vouchers moved the stock account by ${fmtSigned(c.ledger)}; the stock report counts ${fmtSigned(c.report)}.`,
          why: elsewhere
            ? `Purchase lines of these items post to their category's Purchase / Purchase Return account (${elsewhere}), not to this stock account, so the stock account never receives them. Extra lines (freight, tax, charges) posted to the stock account also count here.`
            : "Purchase vouchers can post extra lines (freight, tax, charges) to the stock account, while the stock report only reads each item's main line.",
          fix: elsewhere
            ? ["If purchases should go straight to stock, set the category's Purchase account to its stock account (Setup → Item Categories).", "Otherwise post a month-end JV moving the purchases from the Purchase account to stock."]
            : ["Check this month's purchase vouchers for extra lines posted to this stock account.", "Move those lines to the correct expense or tax account."],
        });
        break;
      }
      case "production":
      case "consumption":
      case "direct":
      case "sales": {
        const jv = JV_INFO[c.jv];
        if (!c.posted) {
          add(`${c.key}_missing`, c.diff, {
            title: `${jv.name} JV is not posted`,
            what: `The stock report counts ${fmtSigned(c.report)} for "${c.label}", but no ${jv.name} JV exists for this month.`,
            why: `Costing movements only reach the GL through the ${jv.name} journal voucher. Until it is posted, the GL does not move.`,
            fix: [`Open the ${jv.report} for this month.`, "Preview the JV, check it, then post it."],
          });
          break;
        }
        add(`${c.key}_stale`, c.stale, {
          title: `${jv.name} JV is out of date`,
          what: `Posted ${fmtSigned(c.ledger)}, but the JV would be ${fmtSigned(c.now)} if it were generated today.`,
          why: "The JV was posted from the figures at that moment. Afterwards costing was re-run, rates changed, or vouchers were added or edited — so the posted amount no longer matches.",
          fix: [
            `Post an adjustment JV of ${fmtSigned(-c.stale)} to this stock account.`,
            "In future, finish costing and lock the period before posting the costing JVs.",
          ],
        });
        add(`${c.key}_method`, c.method, {
          title: `${jv.name} values "${c.label}" differently from the stock report`,
          what: `${jv.name} gives ${fmtSigned(c.now)}, the stock report ${fmtSigned(c.report)}.`,
          why: METHOD_WHY[c.key],
          fix: c.key === "consumption"
            ? ["Open the items to see which materials have different rates.", "Post a month-end adjustment JV for the difference."]
            : ["Post a month-end adjustment JV for the difference."],
          items: c.key === "consumption" ? "rateMismatch" : undefined,
        });
        break;
      }
      case "uncovered":
        add("uncovered", c.diff, {
          title: "Material issues never reach the GL",
          what: `Issues worth ${fmtSigned(-c.report)} reduce stock in the report, but no JV credits the stock account.`,
          why: "These issues have no production-plan link, and there is no unplanned production receipt this month to absorb them. They are not Cleaning/Lab/QC issues either, so neither the COGM nor the Direct Issuance JV picks them up.",
          fix: [
            "Link the issue vouchers to their production plan, or",
            "Label them Cleaning/Lab/QC so the Direct Issuance JV posts them, or",
            "Post a JV crediting the stock account for this amount.",
          ],
          items: "uncoveredIssuance",
        });
        break;
      case "issueOther":
        add("issue_other", c.diff, {
          title: "Unexplained issuance value",
          what: "Part of the issuance value in the stock report does not belong to plan, unplanned or direct issues.",
          why: "Usually sub-lines or rate edge cases on issue vouchers.",
          fix: ["Check the item's issues in Costing Checker."],
        });
        break;
      case "transfers":
        add("transfers", c.diff, {
          title: "Transfers are valued in the report only",
          what: "Godown transfers move value in the stock report but never post to the GL.",
          why: "Transfers between godowns don't change the company's total stock, so they have no GL posting.",
          fix: ["No action unless this appears without a godown filter."],
        });
        break;
      case "manual":
        add("manual", c.diff, {
          title: "Manual JVs changed the stock account",
          what: `Journal vouchers other than the costing JVs moved this stock account by ${fmtSigned(c.ledger)}.`,
          why: "These JVs move the GL, but the stock report never sees them. They are usually corrections for earlier differences.",
          fix: ["Review each voucher and confirm it is still needed.", "If a voucher corrected something that has since been fixed at the source, reverse it."],
          items: "manualJvs",
        });
        break;
      case "other":
        add("other_postings", c.diff, {
          title: "Other vouchers post directly to stock",
          what: `Voucher types ${c.codes.join(", ")} moved this stock account by ${fmtSigned(c.ledger)}.`,
          why: "Only purchases and the costing JVs should post to stock accounts. Another voucher type is mapped to this account.",
          fix: ["Find those vouchers in the account ledger.", "Correct the account they post to."],
        });
        break;
      case "rounding":
        add("rounding", c.diff, {
          title: "Rounding in the stock report",
          what: "The report's closing value differs slightly from the sum of its movements.",
          why: "Rates are calculated per item and rounded.",
          fix: ["No action needed."],
        });
        break;
    }
  }
  return out;
}

function fmtSigned(v) {
  const s = Math.abs(n(v)).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n(v) >= 0 ? "+" : "−"}${s}`;
}
