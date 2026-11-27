// lib/reconciliation/itemTrace.js
//
// Item costing trace for one month — for one item, or for every item at once.
//
// Takes each item's Stock Activity With Rate row (the official figures) and
// rebuilds every number in it from source rows, so each rate can be explained:
// where it came from, which formula produced it, and what production costing
// and the auto JVs would make of the same item if they were run today.
// Every check that fails becomes a finding with what / why / fix and the
// value at stake.
//
// The month's data is loaded once (loadContext) and every item is evaluated
// from it (evaluateItem), so the single-item trace and the all-items scan run
// exactly the same checks.
//
// Rules mirrored here (keep in sync when the engines change):
//   • Stock report  — getStockActivityWithRateReport (reports route)
//   • Costing rates — getActualIssuances / _calcCcRateForPeriod / costOnePlan
//                     (app/api/costing/production/route.js)
//   • JVs           — postCostOfGoodsManufacturedJV / postCostOfGoodsSoldJV /
//                     postDirectMaterialIssuanceJV (reports route)
//
// Ported from Accounting. Fixed ids replaced by company data:
//   • CC pool       — main accounts of Account Settings group
//                     "conversion_overheads", less account "conversion_cost"
//                     (the account the COGM JV credits), as _calcCcRateForPeriod.
//   • CC categories — lib/costing/ccPolicy.js ccCategoryIdsFor / semiCcOnFor.
//   • Produced / raw categories — Settings → Production setup.
//   • Item stock account — category stock_acno → Account Settings "stock"
//                     default (the rule the auto JVs use).
//   • Opening stock — lib/openingStock.js (qty summed over godowns; value is
//                     always qty × rate, so the "stored value" check is gone).
// Read-only: nothing here writes.

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  getStockActivityWithRateReport,
  getCostOfGoodsManufacturedReport,
} from "@/app/api/reports/[reportType]/route";
import { getCcComponents } from "@/lib/costing/ccRates";
import { ccCategoryIdsFor, semiCcOnFor } from "@/lib/costing/ccPolicy";
import { getIssueRates, isBlendedCosting } from "@/lib/costing/issueRate";
import { getOpening, getOpeningByGodown } from "@/lib/openingStock";
import { voucherLabel } from "@/lib/vouchers/voucherLink";
import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import { getAccount, getAccountGroup } from "@/lib/accounts/accountSettings";
import {
  getProductionSetup,
  isFinishedCategory,
  isSemiFinishedCategory,
  isRawMaterialCategory,
  isPackingCategory,
} from "@/lib/production/setup";

const COGM_TAG = "AUTO_COGM";
const COGS_TAG = "AUTO_COGS";
const MATISS_TAG = "AUTO_MATISS";

const AMT_TOL = 1;       // value differences below this are rounding
const QTY_TOL = 0.0005;
const SCAN_CACHE_MS = 10 * 60 * 1000;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Fallback names; SMS's own document names (voucherLabel) win when known
const TRAN_LABEL_FALLBACK = {
  1: "Receipt", 2: "Payment", 3: "Journal voucher", 4: "Purchase", 5: "POS sale",
  6: "Sale", 7: "Material issue", 8: "Production receipt", 9: "Purchase return",
  10: "Sale return", 11: "Stock transfer", 12: "POS return",
};
const tranLabel = (code) => voucherLabel(code) || TRAN_LABEL_FALLBACK[code] || `Code ${code}`;

// One generic label per finding code — used to group the all-items scan
export const CAUSES = {
  opening_missing: "No opening stock snapshot",
  opening_negative_clamped: "Last month's negative stock reset to zero",
  opening_qty_drift: "Opening quantity ≠ last month's closing",
  opening_rate_drift: "Opening rate ≠ last month's closing rate",
  opening_split: "Opening RM + CC split doesn't add up",
  opening_zero_rate: "Opening stock has no rate",
  prev_not_locked: "Previous month not locked",
  purchase_zero: "Purchase with quantity but no amount",
  purchase_outlier: "Purchase rate far from the month's average",
  purchase_other_account: "Purchase posted to another GL account",
  purchase_extra_lines: "Purchase charge lines the stock report ignores",
  purchase_basis_differs: "Costing and stock report read different purchase totals",
  prod_uncosted: "Production received but never costed",
  prod_pce_month: "Production costed in a different month",
  prod_plan_status: "Production plan not Posted",
  prod_ref: "Receipt reference is not a clean plan number",
  prod_qty: "Received quantity changed after costing",
  prod_multi: "Several items received under one plan",
  prod_no_issues: "No material issued against the plan",
  prod_stale: "Production costing out of date",
  prod_variance: "Issued much more/less than the plan needs",
  prod_orphan: "Unplanned production shares unlinked issues",
  pce_zero_qty: "Costing entry with zero quantity",
  prod_rate_recalc: "Production rate rebuild differs from stock report",
  cc_wrong_cat: "CC charged to a category that doesn't carry CC",
  cc_m2m: "M2M receipt carries CC",
  cc_stale: "CC rate out of date",
  cc_input_missing: "Semi-finished input carries no CC",
  cc_recalc: "CC rate rebuild differs from stock report",
  blended_recalc: "Blended rate rebuild differs from stock report",
  blended_no_pool: "Stock went out with nothing to value it",
  blended_jump: "Rate moved sharply from the opening rate",
  issue_uncovered: "Issues no JV takes out of stock",
  issue_orphan_value: "Unlinked issues valued at voucher amount",
  issue_direct_nojv: "Direct issuance JV not posted",
  issue_double: "Direct issue may be credited twice",
  issue_plan_uncosted: "Issued to a plan that is not costed",
  issue_plan_month: "Issued and costed in different months",
  issue_plan_missing: "Issue missing from the plan's costing",
  issue_qty: "Issued quantity changed after costing",
  issue_rate: "Material rate in costing ≠ stock report rate",
  sales_returns_exceed: "Returns exceed sales — COGS skips item",
  sales_zero_price: "Sale lines with no price",
  sales_below_cost: "Sold below cost",
  sales_zero_cost: "Sold with zero cost",
  closing_negative: "Negative closing stock",
  closing_zero_rate: "Closing stock has no value",
  closing_next_drift: "Next month's opening out of date",
  godown_negative: "Negative stock in a godown",
  recipe_bom_mismatch: "Recipe materials don't match its BOM",
  recipe_bom_inactive: "Active recipe uses an inactive BOM",
  recipe_bom_wrong: "Recipe's BOM missing or for another item",
  recipe_multi_active: "More than one active recipe",
  gl_no_account: "Item has no stock account",
  gl_missing: "Auto JV not posted",
  gl_method: "JV and stock report value the item differently",
  gl_duplicate: "Auto JV posted more than once",
  gl_after_jv: "Vouchers entered after the JVs",
};

const n = (v) => Number(v || 0);
const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const pad2 = (v) => String(v).padStart(2, "0");
const div = (a, b) => (n(b) !== 0 ? n(a) / n(b) : 0);
const fmt = (v) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n(v));
const fmtR = (v) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n(v));
const fmtQ = (v) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n(v));
const fmtD = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const rateDiffers = (a, b) => Math.abs(n(a) - n(b)) > Math.max(0.01, Math.abs(n(b)) * 0.0005);
const qtyDiffers = (a, b) => Math.abs(n(a) - n(b)) > QTY_TOL;
const groupBy = (arr, key) => {
  const m = new Map();
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

// Same text rules as SMS's Direct Material Issuance report / MATISS JV
// (rmk5 ILIKE 'Clean%' OR 'Lab%' OR '%qc%')
const DIRECT_RE = [/^clean/i, /^lab/i, /qc/i];
const isDirectIssue = (rmk5) => DIRECT_RE.some((re) => re.test(rmk5 || ""));
// Plan id as the reconciliation / orphan logic reads it: digits only
const planIdOf = (rmk5) => {
  const d = String(rmk5 || "").replace(/\D/g, "");
  const id = d ? Number(d) : null;
  return id && id <= 2147483647 ? id : null; // plan ids are Postgres integers
};

function monthBounds(month, year) {
  return {
    from: new Date(year, month - 1, 1, 0, 0, 0, 0),
    to: new Date(year, month, 0, 23, 59, 59, 999),
  };
}
function shiftMonth(month, year, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}
const label = (m, y) => `${MONTHS[m - 1]} ${y}`;
const ymKey = (m, y) => y * 100 + m;

function severityOf(impact) {
  const a = Math.abs(n(impact));
  if (a >= 100000) return "high";
  if (a >= 1000) return "medium";
  return "low";
}

// ── Loaders ─────────────────────────────────────────────────────────────────

// Item stock account = category stock_acno, else the Account Settings "stock"
// default — the same rule the auto JVs use (resolveItemAccounts, tran 7).
// carries_cc is set by loadContext from the month's CC categories.
// Purchase / purchase-return lines post to the category's purchase_acno /
// purchase_return_acno (else the "purchase" / "purchase_return" defaults) —
// lib/accounts/itemAccounts.js LINE_RULES 4 and 9.
async function loadItemsMap(ids) {
  const [rows, stockDefault, purDefault, purRetDefault] = await Promise.all([
    prisma.item.findMany({
      where: ids ? { itcd: { in: ids } } : undefined,
      select: {
        itcd: true, item: true, code: true, unit: true, ic_id: true,
        itemCategories: { select: { ic_name: true, stock_acno: true, purchase_acno: true, purchase_return_acno: true } },
      },
    }),
    getAccount("stock"),
    getAccount("purchase"),
    getAccount("purchase_return"),
  ]);
  const num = (a) => (a != null ? Number(a) : null);
  const acnoOf = (r) => num(r.itemCategories?.stock_acno ?? stockDefault);
  const acnos = [...new Set(rows.map(acnoOf).filter((a) => a != null))];
  const names = new Map(
    (acnos.length ? await prisma.aCNO.findMany({ where: { acno: { in: acnos } }, select: { acno: true, acname: true } }) : [])
      .map((a) => [Number(a.acno), a.acname])
  );
  return new Map(rows.map((r) => {
    const acno = acnoOf(r);
    return [Number(r.itcd), {
      itcd: Number(r.itcd), name: r.item || "", code: r.code || "", unit: r.unit || "",
      ic_id: Number(r.ic_id || 0), category: r.itemCategories?.ic_name || "",
      carries_cc: false, acno, acname: acno != null ? names.get(acno) || null : null,
      acno_from: r.itemCategories?.stock_acno != null ? "category" : acno != null ? "default" : null,
      purchase_acno: num(r.itemCategories?.purchase_acno ?? purDefault),
      purchase_return_acno: num(r.itemCategories?.purchase_return_acno ?? purRetDefault),
    }];
  }));
}

// Every stock line in the month — all voucher types, all sub lines
async function loadLines(from, to, itcd) {
  const rows = await prisma.$queryRaw`
    SELECT t.id AS line_id, t.itcd, tm.tran_id, tm.vr_no, tm.dated, tm.tran_code, t.sub_tran_id,
           COALESCE(tm.rmk1, '') AS rmk1, COALESCE(tm.rmk4, '') AS rmk4, COALESCE(${poRefSql("tm")}, '') AS rmk5, -- process order ref (lib/manufacturing/processOrderRef.js)
           COALESCE(t.invoice_no, tm.invoice_no, '') AS invoice_no,
           COALESCE(pa.acname, '') AS party,
           t.acno, t.qty, t.rate, t.damt, t.camt, t.gross_amount
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    LEFT JOIN "acno" pa ON pa.acno = tm.pycd
    WHERE ${itcd ? Prisma.sql`t.itcd = ${itcd}` : Prisma.sql`t.itcd IS NOT NULL`}
      AND tm.dated >= ${from} AND tm.dated <= ${to}
    ORDER BY tm.dated, tm.tran_id, t.id
  `;
  return rows.map((r) => ({
    line_id: Number(r.line_id),
    itcd: Number(r.itcd),
    tran_id: Number(r.tran_id),
    vr_no: r.vr_no != null ? Number(r.vr_no) : null,
    dated: r.dated,
    tran_code: Number(r.tran_code),
    sub_tran_id: r.sub_tran_id != null ? Number(r.sub_tran_id) : null,
    rmk1: r.rmk1,
    rmk4: r.rmk4,
    rmk5: r.rmk5, // kept raw — costing matches plan references exactly
    invoice_no: r.invoice_no || "",
    party: r.party || "",
    acno: r.acno != null ? Number(r.acno) : null,
    qty: r.qty != null ? n(r.qty) : null,
    rate: n(r.rate),
    damt: n(r.damt),
    camt: n(r.camt),
    gross_amount: n(r.gross_amount),
  }));
}

// Rate production costing would use for each item TODAY — the month's issue
// rate from lib/costing/issueRate.js (the same rate the stock report issues
// at). The purchase / production parts are kept for the diagnosis text.
// Also returns the item's CC per unit (opening CC blended with this month's
// costed CC) and when it was last costed.
async function costingRatesNow(itcds, month, year, from, to) {
  const ids = [...new Set(itcds.map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;

  const [opens, purch, pces, issueRates] = await Promise.all([
    getOpening(month, year, { itcds: ids }), // all godowns summed
    prisma.$queryRaw`
      SELECT t.itcd,
        COALESCE(SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0) ELSE -COALESCE(t.camt,0) END), 0) AS amt_all,
        COALESCE(SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE -t.qty END), 0)                          AS qty_all,
        COALESCE(SUM(CASE WHEN t.sub_tran_id = 1 THEN
          CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0) ELSE -COALESCE(t.camt,0) END ELSE 0 END), 0) AS amt_main,
        COALESCE(SUM(CASE WHEN t.sub_tran_id = 1 THEN
          CASE WHEN tm.tran_code = 4 THEN t.qty ELSE -t.qty END ELSE 0 END), 0)                          AS qty_main
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      WHERE tm.tran_code IN (4, 9)
        AND tm.dated >= ${from} AND tm.dated <= ${to}
        AND t.qty > 0
        AND t.itcd = ANY(${ids}::int[])
      GROUP BY t.itcd
    `,
    prisma.productionCostEntry.findMany({
      where: { month, year, itcd: { in: ids } },
      select: { itcd: true, qty_costed: true, cost_per_unit: true, actual_cost_per_unit: true, cc_cost: true, calculated_at: true },
    }),
    getIssueRates({ month, year, itcds: ids, computeMonth: getStockActivityWithRateReport }),
  ]);
  // costing.method = "average": production costing's own rate (getActualIssuances
  // in app/api/costing/production/route.js) — produced this month → opening +
  // costed production (CC stripped); otherwise opening + net purchases.
  const blended = await isBlendedCosting();
  const avgProd = new Map();
  if (!blended) {
    for (const e of pces) {
      const r = n(e.actual_cost_per_unit ?? e.cost_per_unit);
      if (!(r > 0)) continue;
      const a = avgProd.get(Number(e.itcd)) || { qty: 0, value: 0 };
      a.qty += n(e.qty_costed);
      a.value += r * n(e.qty_costed);
      avgProd.set(Number(e.itcd), a);
    }
  }

  const openMap = new Map(opens.map((o) => [Number(o.itcd), { qty: n(o.opening_qty), rate: n(o.opening_rate), cc: n(o.cc_rate) }]));
  const purchMap = new Map(purch.map((p) => [Number(p.itcd), {
    amt_all: n(p.amt_all), qty_all: n(p.qty_all), amt_main: n(p.amt_main), qty_main: n(p.qty_main),
  }]));
  const prodMap = new Map();
  for (const e of pces) {
    const id = Number(e.itcd);
    const p = prodMap.get(id) || { qty: 0, value: 0, cc_qty: 0, cc_cost: 0, last: null };
    const rate = n(e.cost_per_unit ?? e.actual_cost_per_unit);
    if (rate > 0) {
      p.qty += n(e.qty_costed);
      p.value += rate * n(e.qty_costed);
    }
    p.cc_qty += n(e.qty_costed);
    p.cc_cost += n(e.cc_cost);
    if (!p.last || e.calculated_at > p.last) p.last = e.calculated_at;
    prodMap.set(id, p);
  }

  for (const id of ids) {
    const o = openMap.get(id) || { qty: 0, rate: 0, cc: 0 };
    const p = purchMap.get(id) || { amt_all: 0, qty_all: 0, amt_main: 0, qty_main: 0 };
    const pr = prodMap.get(id);
    let rate = issueRates.get(id)?.rate || 0;
    if (!blended) {
      const a = avgProd.get(id);
      const q = o.qty + (a ? a.qty : p.qty_all);
      const v = o.qty * o.rate + (a ? a.value : p.amt_all);
      rate = q > 0 ? v / q : 0;
    }
    let source = "none";
    if (rate > 0) source = pr && pr.qty > 0 ? "production" : p.qty_main ? "purchases" : "opening";
    out.set(id, {
      rate, source,
      opening_qty: o.qty, opening_rate: o.rate, opening_cc_rate: o.cc,
      purch_qty: p.qty_all, purch_amt: p.amt_all,
      purch_qty_main: p.qty_main, purch_amt_main: p.amt_main,
      prod_qty: pr?.qty || 0, prod_value: pr?.value || 0,
      last_costed: pr?.last || null,
    });
  }
  return out;
}

// CC rate production costing would use TODAY — mirrors _calcCcRateForPeriod
// (app/api/costing/production/route.js): pool = net of the main accounts in
// Account Settings group "conversion_overheads", less the "conversion_cost"
// account; shared over this month's receipts of the CC categories.
export async function ccRateNow(month, year) {
  const [ccCategoryIds, semiOn, overheadMacnos, ccAcno] = await Promise.all([
    ccCategoryIdsFor(month, year),
    semiCcOnFor(month, year),
    getAccountGroup("conversion_overheads"),
    getAccount("conversion_cost"),
  ]);
  const dateFrom = new Date(year, month - 1, 1);
  const dateTo = new Date(year, month, 0, 23, 59, 59);
  const catIds = ccCategoryIds.length ? ccCategoryIds.map(Number) : [-1];
  const macnos = overheadMacnos.length ? overheadMacnos.map(Number) : [-1];
  const [pool, qty] = await Promise.all([
    prisma.$queryRaw`
      SELECT COALESCE(SUM(t.damt), 0) AS dr, COALESCE(SUM(t.camt), 0) AS cr
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      JOIN "acno" a ON t.acno = a.acno
      WHERE a.macno = ANY(${macnos}::int[])
        ${ccAcno != null ? Prisma.sql`AND a.acno <> ${ccAcno}` : Prisma.empty}
        AND tm.dated >= ${dateFrom} AND tm.dated <= ${dateTo}
    `,
    prisma.$queryRaw`
      SELECT COALESCE(SUM(t.qty), 0) AS qty
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      JOIN "Item" i ON i.itcd = t.itcd
      WHERE tm.tran_code = 8
        AND tm.dated >= ${dateFrom} AND tm.dated <= ${dateTo}
        AND tm.rmk4 IS DISTINCT FROM 'M2M'
        AND t.sub_tran_id = 1 AND t.qty > 0
        AND i.ic_id = ANY(${catIds}::int[])
    `,
  ]);
  const total = Math.max(0, n(pool[0]?.dr) - n(pool[0]?.cr));
  const q = n(qty[0]?.qty);
  return {
    pool: total, qty: q, rate: q > 0 ? total / q : 0, semi_on: !!semiOn,
    cc_acno: ccAcno != null ? Number(ccAcno) : null,
    overheads_set: overheadMacnos.length > 0,
  };
}

// T8 qty per plan (all items) and T7 qty per plan × material — exact rmk5
// match, sub line 1, qty > 0 — exactly what costOnePlan reads
export async function loadPlanQtyNow(planRefs, from, to) {
  if (!planRefs.length) return { t8: new Map(), t7: new Map() };
  const [t8, t7] = await Promise.all([
    prisma.$queryRaw`
      SELECT ${poRefSql("tm")} AS rmk5, COALESCE(SUM(t.qty),0) AS qty, MIN(t.itcd) AS itcd, COUNT(DISTINCT t.itcd) AS items
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 8 AND tm.dated >= ${from} AND tm.dated <= ${to}
        AND ${poRefSql("tm")} = ANY(${planRefs}::text[])
        AND t.sub_tran_id = 1 AND t.qty > 0
      GROUP BY 1
    `,
    prisma.$queryRaw`
      SELECT ${poRefSql("tm")} AS rmk5, t.itcd, COALESCE(SUM(t.qty),0) AS qty
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 7 AND tm.dated >= ${from} AND tm.dated <= ${to}
        AND ${poRefSql("tm")} = ANY(${planRefs}::text[])
        AND t.sub_tran_id = 1 AND t.qty > 0
      GROUP BY 1, t.itcd
    `,
  ]);
  const t8Map = new Map(t8.map((r) => [String(r.rmk5), { qty: n(r.qty), itcd: Number(r.itcd), items: Number(r.items) }]));
  const t7Map = new Map();
  for (const r of t7) {
    const k = String(r.rmk5);
    if (!t7Map.has(k)) t7Map.set(k, new Map());
    t7Map.get(k).set(Number(r.itcd), n(r.qty));
  }
  return { t8: t8Map, t7: t7Map };
}

// Auto JVs for the month, with what each posted per account
async function loadJvs(month, year) {
  const mySlash = `${month}/${year}`;
  const ymDash = `${year}-${pad2(month)}`;
  const rows = await prisma.$queryRaw`
    SELECT tm.tran_id, tm.vr_no, tm.dated, tm.rmk1, t.acno,
           COALESCE(SUM(COALESCE(t.damt,0) - COALESCE(t.camt,0)), 0) AS net
    FROM "TRANSACTIONS_MASTER" tm
    LEFT JOIN "Transactions" t ON t.tran_id = tm.tran_id
    WHERE tm.tran_code = 3
      AND (
        (tm.rmk1 = ${COGM_TAG}   AND tm.rmk5 = ${mySlash}) OR
        (tm.rmk1 = ${MATISS_TAG} AND tm.rmk5 = ${mySlash}) OR
        (tm.rmk1 = ${COGS_TAG}   AND tm.rmk5 = ${ymDash})
      )
    GROUP BY tm.tran_id, tm.vr_no, tm.dated, tm.rmk1, t.acno
    ORDER BY tm.tran_id
  `;
  const byTag = { [COGM_TAG]: [], [COGS_TAG]: [], [MATISS_TAG]: [] };
  const seen = new Set();
  const net = new Map(); // `${tran_id}:${acno}` → net
  for (const r of rows) {
    const id = Number(r.tran_id);
    if (r.acno != null) net.set(`${id}:${Number(r.acno)}`, r2(r.net));
    if (seen.has(id)) continue;
    seen.add(id);
    byTag[r.rmk1]?.push({ tran_id: id, tran_code: 3, vr_no: r.vr_no != null ? Number(r.vr_no) : null, dated: r.dated });
  }
  return { byTag, net };
}

// Active recipes and how their materials compare with the BOM selected on them.
// Only recipe lines whose product is in a material category of Settings →
// Production setup (raw material, packing, semi-finished, finished) count as
// materials; machine-instruction and blank lines are left out. (Accounting
// matched the category name "MACHIN"; SMS reads the setup instead.)
async function loadRecipeChecks(itcd, materialCatIds) {
  const cats = materialCatIds.length ? materialCatIds.map(Number) : [-1];
  const rows = await prisma.$queryRaw`
    WITH r AS (
      SELECT receipe_id, finished_id, bom_id
      FROM "RECEIPE_MASTER"
      WHERE status = 'Active' ${itcd ? Prisma.sql`AND finished_id = ${itcd}` : Prisma.empty}
    ),
    rec AS (
      SELECT DISTINCT r.receipe_id, rd.product_id AS itcd
      FROM r
      JOIN "RECEIPE_DETAIL" rd    ON rd.receipe_id = r.receipe_id
      JOIN "Item" i               ON i.itcd = rd.product_id
      WHERE i.ic_id = ANY(${cats}::int[])
    ),
    bom AS (
      SELECT DISTINCT r.receipe_id, bd.material_id AS itcd
      FROM r JOIN "BomDetail" bd ON bd.bom_id = r.bom_id
    )
    SELECT r.receipe_id, r.finished_id, r.bom_id,
           bm.instructions AS bom_status, bm.finished_id AS bom_item,
           COALESCE((SELECT json_agg(b.itcd) FROM bom b
                     WHERE b.receipe_id = r.receipe_id
                       AND NOT EXISTS (SELECT 1 FROM rec x WHERE x.receipe_id = b.receipe_id AND x.itcd = b.itcd)), '[]'::json) AS missing,
           COALESCE((SELECT json_agg(x.itcd) FROM rec x
                     WHERE x.receipe_id = r.receipe_id
                       AND NOT EXISTS (SELECT 1 FROM bom b WHERE b.receipe_id = x.receipe_id AND b.itcd = x.itcd)), '[]'::json) AS extra
    FROM r
    LEFT JOIN "BomMaster" bm ON bm.id = r.bom_id
  `;
  return rows.map((r) => ({
    receipe_id: Number(r.receipe_id),
    finished_id: Number(r.finished_id),
    bom_id: r.bom_id != null ? Number(r.bom_id) : null,
    bom_status: r.bom_status ?? null,
    bom_item: r.bom_item != null ? Number(r.bom_item) : null,
    missing: (r.missing || []).map(Number),
    extra: (r.extra || []).map(Number),
  }));
}

// Quantity per godown for one item — same lines the stock report counts
// (transfers move stock from godown to godown2).
// SMS: opening per godown comes from the month's opening snapshot
// (lib/openingStock.js getOpeningByGodown), movement from this month's vouchers.
async function loadGodownStock(itcd, from, to) {
  const month = from.getMonth() + 1;
  const year = from.getFullYear();
  const [openRows, mvRows] = await Promise.all([
    getOpeningByGodown(month, year, { itcds: [itcd] }),
    prisma.$queryRaw`
      WITH mv AS (
        SELECT tm.godown AS g,
          CASE WHEN tm.tran_code IN (4, 8, 10, 12) THEN t.qty ELSE -t.qty END AS q
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE t.itcd = ${itcd} AND tm.dated >= ${from} AND tm.dated <= ${to} AND t.qty IS NOT NULL
          AND tm.tran_code IN (4, 5, 6, 7, 8, 9, 10, 11, 12)
          AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
          AND (tm.tran_code NOT IN (4, 9) OR t.sub_tran_id = 1)
        UNION ALL
        SELECT tm.godown2 AS g, t.qty AS q
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE t.itcd = ${itcd} AND tm.dated >= ${from} AND tm.dated <= ${to} AND t.qty IS NOT NULL
          AND tm.tran_code = 11
          AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
      )
      SELECT mv.g AS godown, COALESCE(gd.godown, '') AS name, COALESCE(SUM(mv.q), 0) AS movement
      FROM mv
      LEFT JOIN "Godown" gd ON gd.id = mv.g
      GROUP BY mv.g, gd.godown
    `,
  ]);
  const byG = new Map();
  const row = (g, name) => {
    const k = g == null ? "none" : String(g);
    if (!byG.has(k)) byG.set(k, { godown: g, name: name || (g == null ? "No godown" : `Godown ${g}`), opening: 0, movement: 0, closing: 0 });
    return byG.get(k);
  };
  for (const o of openRows) row(o.godown != null ? Number(o.godown) : null, o.godown_name).opening += n(o.opening_qty);
  for (const m of mvRows) row(m.godown != null ? Number(m.godown) : null, m.name).movement += n(m.movement);
  return [...byG.values()]
    .map((r) => ({ ...r, closing: r.opening + r.movement }))
    .filter((r) => Math.abs(r.opening) > QTY_TOL || Math.abs(r.movement) > QTY_TOL || Math.abs(r.closing) > QTY_TOL)
    .sort((a, b) => a.closing - b.closing);
}

// Opening snapshots for a list of months (optionally one item), read through
// lib/openingStock.js: one merged row per item, qty summed over godowns.
// SMS keeps no updated_at on the merged row and derives value = qty × rate.
async function loadSnapshots(periods, itcd = null) {
  const out = new Map();
  const perMonth = await Promise.all(periods.map((p) =>
    getOpening(p.month, p.year, itcd != null ? { itcds: [itcd] } : {}).then((rows) => ({ p, rows }))
  ));
  for (const { p, rows } of perMonth) {
    for (const r of rows) {
      out.set(`${Number(r.itcd)}:${ymKey(p.month, p.year)}`, {
        month: p.month, year: p.year,
        qty: n(r.opening_qty), rate: n(r.opening_rate),
        cc_rate: n(r.cc_rate), rm_rate: n(r.rm_rate),
        updated_at: null,
      });
    }
  }
  return out;
}
const historyPeriods = (month, year) => Array.from({ length: 13 }, (_, i) => shiftMonth(month, year, 1 - i));

// ── Context: everything the checks need for one month ───────────────────────

async function loadContext({ month, year, itcd = null }) {
  const single = itcd != null;
  const { from, to } = monthBounds(month, year);
  const prev = shiftMonth(month, year, -1);
  const next = shiftMonth(month, year, 1);
  const prevB = monthBounds(prev.month, prev.year);
  const product = single ? itcd : undefined;

  const [items, reportRows, prevRows, lines, locks, jvs, ccNow, cogmRows, ownPces, asMaterial, ccComp, setup] = await Promise.all([
    loadItemsMap(single ? [itcd] : null),
    getStockActivityWithRateReport({ dateFrom: from, dateTo: to, product }),
    getStockActivityWithRateReport({ dateFrom: prevB.from, dateTo: prevB.to, product }),
    loadLines(from, to, itcd),
    prisma.costingPeriod.findMany({
      where: { OR: [{ month, year }, { month: prev.month, year: prev.year }] },
      select: { month: true, year: true, is_locked: true, locked_at: true, locked_by: true },
    }),
    loadJvs(month, year),
    ccRateNow(month, year),
    getCostOfGoodsManufacturedReport({ month, year, viewMode: "summary" }),
    prisma.productionCostEntry.findMany({ where: { month, year, ...(single ? { itcd } : {}) }, include: { details: true } }),
    prisma.productionCostDetail.findMany({
      where: { entry: { month, year }, ...(single ? { material_id: itcd } : {}) },
      include: { entry: { select: { id: true, plan_id: true, itcd: true, qty_costed: true, is_orphan: true, calculated_at: true } } },
    }),
    getCcComponents({ month, year }),
    getProductionSetup(),
  ]);
  const materialCatIds = [...new Set([
    ...(setup.rawMaterialCategoryIds || []), ...(setup.packingCategoryIds || []),
    ...(setup.semiFinishedCategoryIds || []), ...(setup.finishedCategoryIds || []),
  ].map(Number))];

  // Plans referenced by receipts, issues and costing entries
  const planIds = new Set();
  for (const l of lines) {
    if (l.tran_code === 7 || l.tran_code === 8) {
      l.plan_id = planIdOf(l.rmk5);
      if (l.plan_id) planIds.add(l.plan_id);
    }
  }
  for (const e of ownPces) if (e.plan_id) planIds.add(e.plan_id);
  for (const d of asMaterial) if (d.entry?.plan_id) planIds.add(d.entry.plan_id);
  const loadedPce = new Set(ownPces.map((e) => e.id));

  const materialIds = new Set(single ? [itcd] : []);
  for (const e of ownPces) for (const d of e.details) materialIds.add(Number(d.material_id));

  const [plans, planPces, planQty, snapshots, recipes] = await Promise.all([
    planIds.size
      ? prisma.productionPlanMaster.findMany({
        where: { id: { in: [...planIds] } },
        select: { id: true, status: true, finished_id: true, m2m: true, qty: true, item: { select: { item: true } } },
      })
      : [],
    planIds.size
      ? prisma.productionCostEntry.findMany({ where: { plan_id: { in: [...planIds] }, id: { notIn: [...loadedPce] } }, include: { details: true } })
      : [],
    loadPlanQtyNow([...planIds].map(String), from, to),
    single
      ? loadSnapshots(historyPeriods(month, year), itcd)
      : loadSnapshots([{ month, year }, { month: next.month, year: next.year }]),
    loadRecipeChecks(itcd, materialCatIds),
  ]);

  // Rates now: every item with movement (all mode) or the item + its materials
  const rateIds = single ? [...materialIds] : [...new Set([...materialIds, ...lines.map((l) => l.itcd), ...reportRows.map((r) => Number(r.product_code))])];
  const ratesNow = await costingRatesNow(rateIds, month, year, from, to);

  // Names for materials and products referenced in single mode
  if (single) {
    const extra = [...new Set([
      ...materialIds,
      ...asMaterial.map((d) => Number(d.entry?.itcd)),
      ...plans.map((p) => Number(p.finished_id)),
      ...recipes.flatMap((r) => [...r.missing, ...r.extra]),
    ].filter((x) => x && !items.has(x)))];
    if (extra.length) for (const [k, v] of await loadItemsMap(extra)) items.set(k, v);
  }
  // Which items carry CC follows this month's CC categories (ccPolicy);
  // "produced" = finished or semi-finished in Settings → Production setup
  for (const v of items.values()) {
    v.carries_cc = ccComp.carriesCategory(v.ic_id);
    v.produced = isFinishedCategory(setup, v.ic_id) || isSemiFinishedCategory(setup, v.ic_id);
    v.kind = isFinishedCategory(setup, v.ic_id) ? "finished"
      : isSemiFinishedCategory(setup, v.ic_id) ? "semi-finished"
        : isRawMaterialCategory(setup, v.ic_id) ? "raw material"
          : isPackingCategory(setup, v.ic_id) ? "packing" : "other";
  }

  const allPces = [...ownPces, ...planPces];

  // COGM: product rows and each material's share of RM credit — as the JV builds them
  const cogmSummary = (cogmRows || []).filter((r) => r.view_type === "summary");
  const cogmByProduct = new Map(cogmSummary.map((r) => [Number(r.mm_no), r]));
  const cogmCredit = new Map();
  for (const r of cogmSummary) {
    let mats = [];
    try { mats = JSON.parse(r.material_details || "[]"); } catch { mats = []; }
    mats = mats.filter((m) => n(m.total_cost) !== 0);
    const matSum = mats.reduce((s, m) => s + n(m.total_cost), 0);
    const rmCost = r2(r.rm_cost);
    if (rmCost === 0 || matSum <= 0) continue;
    for (const m of mats) {
      const id = Number(m.material_itcd);
      cogmCredit.set(id, n(cogmCredit.get(id)) + rmCost * (n(m.total_cost) / matSum));
    }
  }

  return {
    month, year, single, from, to, prev, next,
    items,
    report: new Map(reportRows.map((r) => [Number(r.product_code), r])),
    prevReport: new Map(prevRows.map((r) => [Number(r.product_code), r])),
    linesByItem: groupBy(lines, (l) => l.itcd),
    locks, jvs, ccNow,
    cogmByProduct, cogmCredit,
    ownPcesByItem: groupBy(ownPces, (e) => Number(e.itcd)),
    pceByPlan: new Map(allPces.filter((e) => e.plan_id != null).map((e) => [e.plan_id, e])),
    allPces,
    asMaterialByItem: groupBy(asMaterial, (d) => Number(d.material_id)),
    planMap: new Map(plans.map((p) => [p.id, p])),
    planQty, ratesNow, snapshots, ccComp, setup,
    blended: await isBlendedCosting(), // costing.method — the stock report's CC formula follows it
    recipesByItem: groupBy(recipes, (r) => r.finished_id),
    godownStock: single ? new Map([[itcd, await loadGodownStock(itcd, from, to)]]) : null,
  };
}

// ── Evaluate one item from the context ──────────────────────────────────────

function evaluateItem(ctx, itcd) {
  const { month, year, prev, next } = ctx;
  const item = ctx.items.get(itcd);
  if (!item) return null;

  const R = ctx.report.get(itcd) || null;
  const P = ctx.prevReport.get(itcd) || null;
  const snap = ctx.snapshots.get(`${itcd}:${ymKey(month, year)}`) || null;
  const nextSnap = ctx.snapshots.get(`${itcd}:${ymKey(next.month, next.year)}`) || null;
  const lockOf = (m, y) => ctx.locks.find((l) => l.month === m && l.year === y) || null;
  const curLock = lockOf(month, year);
  const prevLock = lockOf(prev.month, prev.year);
  const ccNow = ctx.ccNow;
  const planMap = ctx.planMap;
  const isPostedPlan = (id) => planMap.get(id)?.status === "Posted";
  const nameOf = (id) => ctx.items.get(Number(id))?.name || null;

  // Copy lines: evaluation annotates them, the cached context must stay clean
  const lines = (ctx.linesByItem.get(itcd) || []).map((l) => ({ ...l, flags: [] }));
  const ownPces = ctx.ownPcesByItem.get(itcd) || [];
  const asMaterial = ctx.asMaterialByItem.get(itcd) || [];
  const myRateNow = ctx.ratesNow.get(itcd);

  const findings = [];
  const add = ({ code, key, ...f }) => findings.push({
    id: key != null ? `${code}:${key}` : code,
    code,
    severity: f.severity ?? severityOf(f.impact),
    ...f,
    impact: f.impact != null ? r2(Math.abs(f.impact)) : null,
  });

  // ── Official figures (stock report) ───────────────────────────────────────
  const rep = {
    opening_qty: n(R?.opening_stock), opening_rate: n(R?.opening_rate), opening_value: n(R?.opening_value),
    opening_cc_rate: n(R?.opening_cc_rate), opening_rm_rate: n(R?.opening_rm_rate),
    purchase_qty: n(R?.purchase_qty), purchase_amount: n(R?.purchase_amount),
    purchase_ret_qty: n(R?.purchase_ret_qty), purchase_ret_amount: n(R?.purchase_ret_amount),
    production_qty: n(R?.material_production_qty), production_rate: n(R?.material_production_rate),
    production_amount: n(R?.material_production_amount),
    issue_qty: n(R?.material_issuance_qty), issue_rate: n(R?.material_issuance_rate), issue_amount: n(R?.material_issuance_amount),
    sale_qty: n(R?.sale_qty), sale_amount: n(R?.sale_amount), sale_ret_qty: n(R?.sale_ret_qty), sale_ret_amount: n(R?.sale_ret_amount),
    pos_qty: n(R?.pos_qty), pos_amount: n(R?.pos_amount), pos_ret_qty: n(R?.pos_ret_qty), pos_ret_amount: n(R?.pos_ret_amount),
    cc_rate: n(R?.cc_rate), blended_rate: n(R?.avg_rate_after_purchase),
    closing_qty: n(R?.closing_qty), closing_rate: n(R?.closing_rate), closing_value: n(R?.closing_value),
  };
  const rate = rep.blended_rate;

  // ── Classify lines ────────────────────────────────────────────────────────
  const REPORT_CODES = new Set([4, 5, 6, 7, 8, 9, 10, 12]);
  for (const l of lines) {
    l.type = tranLabel(l.tran_code);
    l.amount = l.damt || l.camt || l.gross_amount;
    l.unit_value = l.qty ? div(l.damt || l.camt, l.qty) : 0;
    l.ref = l.rmk5 || l.invoice_no || "";

    let excluded = null;
    if (l.qty == null) excluded = "No quantity";
    else if (l.sub_tran_id === 3) excluded = "Control/tax line (sub line 3)";
    else if ((l.tran_code === 4 || l.tran_code === 9) && l.sub_tran_id !== 1) excluded = `Sub line ${l.sub_tran_id ?? "empty"} — only main lines count`;
    else if (l.tran_code === 11) excluded = "Transfer — nets to zero across godowns";
    else if (!REPORT_CODES.has(l.tran_code)) excluded = "Voucher type not part of stock";
    l.counted = !excluded;
    l.excluded_reason = excluded;

    if (!l.counted) l.report_value = 0;
    else if (l.tran_code === 4) l.report_value = l.damt;
    else if (l.tran_code === 9) l.report_value = -l.camt;
    else if (l.tran_code === 8) l.report_value = l.qty * rep.production_rate;
    else if ([5, 6, 7].includes(l.tran_code)) l.report_value = -l.qty * rate;
    else if ([10, 12].includes(l.tran_code)) l.report_value = l.qty * rate;
    else l.report_value = 0;

    if (l.tran_code === 7) {
      l.cls = isDirectIssue(l.rmk5) ? "direct" : (l.plan_id && isPostedPlan(l.plan_id) ? "plan" : "orphan");
      l.exact_ref = l.plan_id != null && l.rmk5 === String(l.plan_id);
    }
    if (l.tran_code === 8) {
      l.linked = l.plan_id != null && isPostedPlan(l.plan_id);
      l.exact_ref = l.plan_id != null && l.rmk5 === String(l.plan_id);
      l.m2m = l.rmk4 === "M2M";
    }
  }
  const counted = (code) => lines.filter((l) => l.counted && l.tran_code === code);
  const sumQty = (arr) => arr.reduce((s, l) => s + n(l.qty), 0);

  // ════════════════════════════════════════════════════════════════════════
  // 1. OPENING
  // ════════════════════════════════════════════════════════════════════════
  const prevClosingQty = n(P?.closing_qty);
  const prevClosingRate = n(P?.closing_rate);
  const prevClosingValue = n(P?.closing_value);
  const expectedOpenQty = Math.max(0, prevClosingQty);
  const opening = {
    snapshot: snap,
    report_qty: rep.opening_qty, report_rate: rep.opening_rate, report_value: rep.opening_value,
    prev_closing: P ? { qty: prevClosingQty, rate: prevClosingRate, value: prevClosingValue } : null,
    prev_locked: !!prevLock?.is_locked, prev_locked_at: prevLock?.locked_at ?? null, prev_locked_by: prevLock?.locked_by ?? null,
  };

  if (!snap && (Math.abs(prevClosingQty) > QTY_TOL)) {
    add({
      code: "opening_missing", area: "opening", severity: "high", impact: prevClosingValue,
      title: "No opening stock snapshot for this month",
      what: `${label(prev.month, prev.year)} closes with ${fmtQ(prevClosingQty)} at ${fmtR(prevClosingRate)}, but ${label(month, year)} has no opening row, so the stock report starts this item from zero.`,
      why: prevLock?.is_locked
        ? "The previous month is locked, but its lock did not create an opening row for this item (it had no activity in the report at lock time, or the lock failed part-way)."
        : "Opening stock is only created when the previous month is locked. The previous month is not locked yet.",
      fix: [`Lock ${label(prev.month, prev.year)} (or unlock and re-lock it) to regenerate opening stock.`],
    });
  } else if (snap) {
    if (P && prevClosingQty < -QTY_TOL && Math.abs(snap.qty) <= QTY_TOL) {
      add({
        code: "opening_negative_clamped", area: "opening", impact: Math.abs(prevClosingQty) * prevClosingRate,
        title: "Last month's negative stock was reset to zero",
        what: `${label(prev.month, prev.year)} closed at ${fmtQ(prevClosingQty)} (negative). The lock stores negative closing as 0, so this month opens with 0.`,
        why: "Issues or sales were posted before the matching receipt. The quantity that went below zero disappears at the lock, so the stock report and GL no longer agree on quantity or value.",
        fix: ["Post the missing receipt (or correct the over-issue) in the previous month.", `Then unlock and re-lock ${label(prev.month, prev.year)}.`],
      });
    } else if (P && qtyDiffers(snap.qty, expectedOpenQty)) {
      add({
        code: "opening_qty_drift", area: "opening", impact: (snap.qty - expectedOpenQty) * (snap.rate || prevClosingRate),
        title: "Opening quantity doesn't match last month's closing",
        what: `Opening ${fmtQ(snap.qty)}, but ${label(prev.month, prev.year)} now closes at ${fmtQ(prevClosingQty)} (difference ${fmtQ(snap.qty - expectedOpenQty)}).`,
        why: `Vouchers in ${label(prev.month, prev.year)} were added, edited or deleted after the snapshot was saved${snap.updated_at ? ` (${fmtD(snap.updated_at)})` : ""}, or the opening row was edited by hand.`,
        fix: [`Check ${label(prev.month, prev.year)} vouchers for this item.`, `Unlock and re-lock ${label(prev.month, prev.year)} so the opening is regenerated.`],
      });
    }
    if (P && rateDiffers(snap.rate, prevClosingRate) && Math.abs(expectedOpenQty) > QTY_TOL) {
      add({
        code: "opening_rate_drift", area: "opening", impact: (snap.rate - prevClosingRate) * snap.qty,
        title: "Opening rate doesn't match last month's closing rate",
        what: `Opening rate ${fmtR(snap.rate)}, but ${label(prev.month, prev.year)} now closes at ${fmtR(prevClosingRate)}.`,
        why: "The previous month's rate changed after the lock: production was re-costed, purchases were changed, or its own opening changed. The snapshot keeps the old rate.",
        fix: [`Open this item for ${label(prev.month, prev.year)} to see what moved the rate.`, `Unlock and re-lock ${label(prev.month, prev.year)} once it is final.`],
      });
    }
    // (Accounting's "stored opening value ≠ qty × rate" check is not ported:
    // SMS never stores the opening value — lib/openingStock.js derives it.)
    if (item.carries_cc && snap.cc_rate > 0 && rateDiffers(snap.rm_rate + snap.cc_rate, snap.rate)) {
      add({
        code: "opening_split", area: "opening", severity: "low",
        title: "Opening RM + CC split doesn't add up to the opening rate",
        what: `RM ${fmtR(snap.rm_rate)} + CC ${fmtR(snap.cc_rate)} = ${fmtR(snap.rm_rate + snap.cc_rate)}, but the opening rate is ${fmtR(snap.rate)}.`,
        why: "COGS splits each sale into RM and CC with these figures. When they don't add up, the RM/CC columns are wrong even if the total cost is right.",
        fix: ["Re-lock the previous month to regenerate the split."],
      });
    }
    if (snap.qty > QTY_TOL && snap.rate <= 0) {
      add({
        code: "opening_zero_rate", area: "opening", severity: "high",
        title: "Opening stock has no rate",
        what: `${fmtQ(snap.qty)} opening quantity is valued at 0.`,
        why: "Every issue and sale this month uses a blended rate that includes the opening. A zero opening rate pulls the blended rate down.",
        fix: ["Find the month where this item lost its rate (see History) and fix the costing there, then re-lock forward."],
      });
    }
  }
  if (!prevLock?.is_locked && snap) {
    add({
      code: "prev_not_locked", area: "opening", severity: "info",
      title: `${label(prev.month, prev.year)} is not locked`,
      what: "This month's opening comes from a snapshot, but the previous month is still open for changes.",
      why: "Any change to last month after this point will not reach this month's opening until last month is locked again.",
      fix: [`Lock ${label(prev.month, prev.year)} once it is final.`],
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. PURCHASES
  // ════════════════════════════════════════════════════════════════════════
  const purLines = counted(4);
  const purRetLines = counted(9);
  const purQty = sumQty(purLines);
  const purAmt = purLines.reduce((s, l) => s + l.damt, 0);
  const refRate = div(purAmt, purQty) || rep.opening_rate;

  for (const l of purLines) {
    if (n(l.qty) > 0 && l.damt <= 0) {
      l.flags.push("zero_value");
      add({
        code: "purchase_zero", key: l.line_id, area: "purchases", impact: n(l.qty) * refRate,
        title: "Purchase line with quantity but no amount",
        what: `Voucher #${l.vr_no ?? l.tran_id} (${fmtD(l.dated)}) receives ${fmtQ(l.qty)} at 0.`,
        why: "The quantity enters stock free, so the blended rate drops for every issue and sale this month.",
        fix: ["Correct the purchase amount on this voucher."],
        ref: { tab: "movements", line_id: l.line_id },
      });
    } else if (refRate > 0 && n(l.qty) > 0) {
      const lr = l.damt / l.qty;
      const dev = (lr - refRate) / refRate;
      if (purLines.length > 1 && Math.abs(dev) >= 0.5) {
        l.flags.push("outlier");
        add({
          code: "purchase_outlier", key: l.line_id, area: "purchases", severity: severityOf((lr - refRate) * l.qty) === "high" ? "high" : "medium",
          impact: (lr - refRate) * l.qty,
          title: `Purchase rate ${dev > 0 ? "far above" : "far below"} this month's average`,
          what: `Voucher #${l.vr_no ?? l.tran_id}: ${fmtQ(l.qty)} at ${fmtR(lr)} vs average ${fmtR(refRate)} (${dev > 0 ? "+" : ""}${(dev * 100).toFixed(0)}%).`,
          why: "Usually a unit error (kg vs g, carton vs piece), a typo in qty or amount, or freight posted into the item line.",
          fix: ["Check quantity, unit and amount on the voucher."],
          ref: { tab: "movements", line_id: l.line_id },
        });
      }
    }
    if (l.rate > 0 && n(l.qty) > 0 && Math.abs(l.rate * l.qty - l.damt) > Math.max(AMT_TOL, l.damt * 0.01)) l.flags.push("rate_field_differs");
    if (item.purchase_acno != null && l.acno != null && l.acno !== item.purchase_acno) l.flags.push("other_account");
  }
  for (const l of purRetLines) if (item.purchase_return_acno != null && l.acno != null && l.acno !== item.purchase_return_acno) l.flags.push("other_account");

  const otherAcctLines = [...purLines, ...purRetLines].filter((l) => l.flags.includes("other_account"));
  if (otherAcctLines.length) {
    const v = otherAcctLines.reduce((s, l) => s + (l.tran_code === 4 ? l.damt : -l.camt), 0);
    add({
      code: "purchase_other_account", area: "gl", impact: v,
      title: "Purchases posted to a different account than the item's purchase account",
      what: `${otherAcctLines.length} purchase line(s) worth ${fmt(v)} posted to account(s) ${[...new Set(otherAcctLines.map((l) => l.acno))].join(", ")} instead of ${item.purchase_acno ?? "—"} (purchases) / ${item.purchase_return_acno ?? "—"} (returns).`,
      why: "The stock report counts them for this item, but the GL puts the value in another account than its category (or the Account Settings default) gives today. Common after an item's category or its accounts are changed.",
      fix: ["Correct the account on those purchase lines, or post a transfer JV between the two accounts."],
      ref: { tab: "movements" },
    });
  }
  const extraPurLines = lines.filter((l) => (l.tran_code === 4 || l.tran_code === 9) && !l.counted && l.sub_tran_id !== 3 && (n(l.qty) !== 0 || l.damt || l.camt));
  if (extraPurLines.length) {
    const v = extraPurLines.reduce((s, l) => s + l.damt - l.camt, 0);
    add({
      code: "purchase_extra_lines", area: "purchases", impact: v,
      title: "Purchase lines the stock report ignores",
      what: `${extraPurLines.length} purchase/return line(s) on sub lines other than 1 carry ${fmt(v)} for this item.`,
      why: "The stock report reads only main lines (sub line 1). Production costing's material rate reads every line that has a quantity, so the two disagree. If these lines post to the stock account, the GL disagrees too.",
      fix: ["Post freight/charges to an expense account, or put them on the main line if they belong in item cost."],
      ref: { tab: "movements" },
    });
  }
  if (myRateNow && (Math.abs(myRateNow.purch_amt - myRateNow.purch_amt_main) >= AMT_TOL || qtyDiffers(myRateNow.purch_qty, myRateNow.purch_qty_main))) {
    add({
      code: "purchase_basis_differs", area: "purchases", severity: "medium",
      impact: myRateNow.purch_amt - myRateNow.purch_amt_main,
      title: "Production costing and the stock report read different purchase totals",
      what: `Costing reads ${fmtQ(myRateNow.purch_qty)} / ${fmt(myRateNow.purch_amt)}; the stock report reads ${fmtQ(myRateNow.purch_qty_main)} / ${fmt(myRateNow.purch_amt_main)}.`,
      why: "Costing includes all purchase sub lines that have a quantity; the stock report includes only sub line 1. The material rate used in production then differs from the stock report's issue rate.",
      fix: ["Remove quantities from charge lines on purchase vouchers."],
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. PRODUCTION (item produced) — RM + CC
  // ════════════════════════════════════════════════════════════════════════
  const t8Lines = lines.filter((l) => l.tran_code === 8);
  const producedQty = sumQty(t8Lines.filter((l) => l.counted));

  // Report production rate = Σ(cost_per_unit × qty_costed) / Σ qty_costed over this month's PCEs
  const ratedPces = ownPces.filter((e) => n(e.qty_costed) > 0 && n(e.cost_per_unit) > 0);
  const pceQtyRated = ratedPces.reduce((s, e) => s + n(e.qty_costed), 0);
  const pceValRated = ratedPces.reduce((s, e) => s + n(e.cost_per_unit) * n(e.qty_costed), 0);
  const prodRateRecalc = div(pceValRated, pceQtyRated);
  const pceCcCost = ownPces.reduce((s, e) => s + n(e.cc_cost), 0);
  const pceQtyAll = ownPces.reduce((s, e) => s + n(e.qty_costed), 0);
  const rmPart = (e) => n(e.actual_cost_per_unit ?? (n(e.cost_per_unit) - n(e.cc_rate)));

  // Group receipts by plan reference as costing sees them
  const groups = new Map();
  for (const l of t8Lines) {
    const key = l.linked ? `plan:${l.plan_id}` : "orphan";
    if (!groups.has(key)) groups.set(key, { key, plan_id: l.linked ? l.plan_id : null, lines: [], qty: 0, refs: new Set(), m2m: false });
    const g = groups.get(key);
    g.lines.push(l);
    if (l.counted) g.qty += n(l.qty);
    g.refs.add(l.rmk5 || "(blank)");
    if (l.m2m) g.m2m = true;
  }
  for (const e of ownPces) {
    const key = e.plan_id != null ? `plan:${e.plan_id}` : "orphan";
    if (!groups.has(key)) groups.set(key, { key, plan_id: e.plan_id, lines: [], qty: 0, refs: new Set(), m2m: false });
  }

  let ownCcValue = 0;       // CC added at this item's own stage
  let inputCcValue = 0;     // CC carried in from semi-finished / finished inputs
  const productions = [];
  for (const g of groups.values()) {
    const plan = g.plan_id ? planMap.get(g.plan_id) : null;
    const pce = g.plan_id ? ctx.pceByPlan.get(g.plan_id) || null : ownPces.find((e) => e.plan_id == null) || null;
    const pceThisMonth = pce && pce.month === month && pce.year === year;
    const planRef = g.plan_id != null ? String(g.plan_id) : null;
    const t8Now = planRef ? ctx.planQty.t8.get(planRef) : null;
    const t7Now = planRef ? ctx.planQty.t7.get(planRef) || new Map() : new Map();
    const ccNowRate = item.carries_cc && !g.m2m ? ccNow.rate : 0;

    let materials = [];
    let now = null;
    if (pce) {
      const ids = new Set(pce.details.map((d) => Number(d.material_id)));
      for (const id of t7Now.keys()) ids.add(id);
      materials = [...ids].map((mid) => {
        const d = pce.details.find((x) => Number(x.material_id) === mid);
        const mi = ctx.items.get(mid);
        const rn = ctx.ratesNow.get(mid);
        const qtyNow = pce.is_orphan ? n(d?.actual_qty) : n(t7Now.get(mid));
        const rateNow = pce.is_orphan ? n(d?.actual_unit_cost) : n(rn?.rate);
        const isCcInput = ctx.ccComp.carriesCategory(mi?.ic_id);
        const ccPerUnit = isCcInput ? n(ctx.ccComp.get(mid)?.rate ?? rn?.opening_cc_rate) : 0;
        return {
          itcd: mid,
          name: d?.material_name || mi?.name || `Item ${mid}`,
          code: d?.material_code || mi?.code || "",
          ic_id: mi?.ic_id ?? null,
          carries_cc: isCcInput,
          bom_qty: n(d?.qty),
          bom_rate: n(d?.unit_cost),
          cost_source: d?.cost_source || (d ? null : "issued after costing"),
          stored_qty: d?.actual_qty != null ? n(d.actual_qty) : null,
          stored_rate: d?.actual_unit_cost != null ? n(d.actual_unit_cost) : null,
          stored_cost: d?.actual_cost != null ? n(d.actual_cost) : null,
          now_qty: qtyNow,
          now_rate: rateNow,
          now_rate_source: pce.is_orphan ? "issue voucher amount" : rn?.source || "none",
          now_cost: qtyNow * rateNow,
          cc_per_unit: ccPerUnit,
          cc_value: qtyNow * ccPerUnit,
          recosted_after: !!(isCcInput && rn?.last_costed && pce.calculated_at && rn.last_costed > pce.calculated_at),
        };
      }).sort((a, b) => n(b.now_cost) - n(a.now_cost));

      const qtyBase = pce.is_orphan ? n(pce.qty_costed) : (t8Now?.qty || n(pce.qty_costed));
      const actualNow = materials.reduce((s, m) => s + m.now_cost, 0);
      const rmBasis = actualNow > 0 ? actualNow : n(pce.theoretical_cost);
      now = {
        qty: qtyBase,
        rm_cost: rmBasis,
        rm_rate: div(rmBasis, qtyBase),
        cc_rate: pce.is_orphan ? n(pce.cc_rate) : ccNowRate,
        basis: actualNow > 0 ? "actual" : "theoretical",
      };
      now.cost_per_unit = now.rm_rate + now.cc_rate;
    }

    const inputCc = materials.reduce((s, m) => s + m.cc_value, 0);
    const baseQty = g.qty || n(pce?.qty_costed);
    if (pce && pceThisMonth) {
      ownCcValue += n(pce.cc_cost);
      inputCcValue += inputCc;
    }

    const prod = {
      key: g.key,
      plan_id: g.plan_id,
      refs: [...g.refs],
      plan_status: plan?.status ?? null,
      plan_item: plan?.item?.item ?? null,
      plan_finished_id: plan?.finished_id ?? null,
      plan_qty: plan ? n(plan.qty) : null,
      m2m: g.m2m || !!plan?.m2m,
      linked: g.plan_id != null,
      t8_qty: g.qty,
      t8_qty_all_items: t8Now?.qty ?? null,
      t8_items: t8Now?.items ?? null,
      lines: g.lines.map((l) => l.line_id),
      pce: pce ? {
        id: pce.id, month: pce.month, year: pce.year, is_orphan: !!pce.is_orphan, item_type: pce.item_type,
        qty_costed: n(pce.qty_costed), cost_per_unit: n(pce.cost_per_unit),
        rm_rate: rmPart(pce), cc_rate: n(pce.cc_rate), cc_cost: n(pce.cc_cost),
        actual_issued_cost: pce.actual_issued_cost != null ? n(pce.actual_issued_cost) : null,
        theoretical_cost: n(pce.theoretical_cost), theoretical_per_unit: n(pce.theoretical_cost_per_unit),
        wastage_cost: n(pce.wastage_cost), cost_variance: pce.cost_variance != null ? n(pce.cost_variance) : null,
        calculated_at: pce.calculated_at, calculated_by: pce.calculated_by,
        this_month: !!pceThisMonth,
      } : null,
      cc_breakdown: pce ? {
        own_rate: n(pce.cc_rate),
        inputs_rate: div(inputCc, baseQty),
        total_rate: n(pce.cc_rate) + div(inputCc, baseQty),
        inputs: materials.filter((m) => m.carries_cc && m.now_qty > 0).map((m) => ({ itcd: m.itcd, name: m.name, qty: m.now_qty, cc_per_unit: m.cc_per_unit, cc_value: m.cc_value })),
      } : null,
      now,
      materials,
    };
    productions.push(prod);

    const where = g.plan_id ? `Plan ${g.plan_id}` : "Unplanned production";
    const refTab = { tab: "production", key: g.key };

    if (g.qty > QTY_TOL && !pce) {
      add({
        code: "prod_uncosted", key: g.key, area: "production",
        severity: pceQtyRated > 0 ? "medium" : "high",
        impact: g.qty * (pceQtyRated > 0 ? prodRateRecalc : (myRateNow?.rate || rep.opening_rate)),
        title: `${where}: received but never costed`,
        what: `${fmtQ(g.qty)} received with no production costing entry.`,
        why: pceQtyRated > 0
          ? `The stock report values all production at the average of the costed batches (${fmtR(prodRateRecalc)}), so this batch borrows another batch's cost. The COGM JV will not debit it at all.`
          : "With no costed batch at all, the stock report values this production at 0 — the blended rate collapses and the COGM JV debits nothing.",
        fix: g.plan_id
          ? ["Run production costing for this month (Auto-Cost Pending)."]
          : ["Link the receipt to its production plan (rmk5), or run costing with unplanned production included."],
        ref: refTab,
      });
    }
    if (pce && !pceThisMonth && g.qty > QTY_TOL) {
      add({
        code: "prod_pce_month", key: g.key, area: "production", impact: g.qty * n(pce.cost_per_unit),
        title: `${where}: costed in ${label(pce.month, pce.year)}, received in ${label(month, year)}`,
        what: `The costing entry belongs to ${label(pce.month, pce.year)}, so this month's stock report does not use it.`,
        why: "Costing is stored per month. When receipts of one plan fall in two months, only the month that was costed gets a rate.",
        fix: ["Keep a plan's receipts and issues in one month, or re-cost both months."],
        ref: refTab,
      });
    }
    if (g.plan_id && plan && plan.status !== "Posted") {
      add({
        code: "prod_plan_status", key: g.key, area: "production", severity: "medium",
        title: `Plan ${g.plan_id} is "${plan.status || "blank"}", not Posted`,
        what: "Production costing only costs Posted plans; this receipt is treated as unplanned.",
        why: "Unplanned receipts share the pool of unlinked issues by quantity instead of using their own materials.",
        fix: ["Post the plan, then re-run costing."],
        ref: refTab,
      });
    }
    if (g.lines.some((l) => l.plan_id && !l.exact_ref)) {
      add({
        code: "prod_ref", key: g.key, area: "production", severity: "medium",
        title: `${where}: receipt reference is not a clean plan number`,
        what: `Reference "${[...g.refs].slice(0, 5).join(", ")}" — costing matches receipts by exact plan number.`,
        why: "Costing picks the plan by digits but reads its received quantity by exact match, so it finds 0 and falls back to the plan's planned quantity.",
        fix: ["Edit the receipt so rmk5 holds only the plan number."],
        ref: refTab,
      });
    }
    if (pce && pceThisMonth && !pce.is_orphan) {
      if (t8Now && qtyDiffers(t8Now.qty, pce.qty_costed)) {
        add({
          code: "prod_qty", key: g.key, area: "production", impact: (t8Now.qty - n(pce.qty_costed)) * n(pce.cost_per_unit),
          title: `${where}: received quantity changed after costing`,
          what: `Costed ${fmtQ(pce.qty_costed)}, now received ${fmtQ(t8Now.qty)}.`,
          why: "Receipts were added or edited after costing ran. The per-unit cost is spread over the old quantity, and COGM debits the old quantity while the stock report counts the new one.",
          fix: ["Re-run production costing for this plan."],
          ref: refTab,
        });
      }
      if (t8Now && t8Now.items > 1) {
        add({
          code: "prod_multi", key: g.key, area: "production", severity: "medium",
          title: `${where}: several items received under one plan`,
          what: `${t8Now.items} different items were received against this plan; costing treats the total ${fmtQ(t8Now.qty)} as one item.`,
          why: "The plan's material cost is spread over the combined quantity and booked to one item only.",
          fix: ["Receive each item against its own plan."],
          ref: refTab,
        });
      }
      if (pce.actual_issued_cost == null) {
        add({
          code: "prod_no_issues", key: g.key, area: "production", severity: "high", impact: n(pce.theoretical_cost),
          title: `${where}: no material issued against the plan`,
          what: `Costed from the plan's material list (theoretical ${fmt(pce.theoretical_cost)}) because no issue voucher references plan ${g.plan_id}.`,
          why: "Stock of the materials never leaves through this plan. The COGM JV cannot credit materials for it (no material breakdown), so the JV is blocked or the material stock is overstated.",
          fix: ["Post the material issue for this plan with rmk5 = plan number, then re-cost."],
          ref: refTab,
        });
      }
      if (now && rateDiffers(now.cost_per_unit, pce.cost_per_unit)) {
        const imp = (now.cost_per_unit - n(pce.cost_per_unit)) * (t8Now?.qty || n(pce.qty_costed));
        const lateInputs = materials.filter((m) => m.recosted_after && rateDiffers(m.now_rate, m.stored_rate));
        const movedLines = materials.filter((m) => rateDiffers(m.now_rate, m.stored_rate) || qtyDiffers(m.now_qty, m.stored_qty));
        const reasons = [];
        if (lateInputs.length) reasons.push(`semi-finished input ${lateInputs.map((m) => `${m.name} (${fmtR(m.stored_rate)} → ${fmtR(m.now_rate)})`).slice(0, 3).join(", ")} was re-costed after this product, so this product still carries the input's old cost and old CC`);
        if (rateDiffers(now.cc_rate, pce.cc_rate)) reasons.push(`the CC rate moved from ${fmtR(pce.cc_rate)} to ${fmtR(now.cc_rate)}`);
        if (t8Now && qtyDiffers(t8Now.qty, pce.qty_costed)) reasons.push("the received quantity changed");
        const otherMoved = movedLines.filter((m) => !lateInputs.includes(m));
        if (otherMoved.length) reasons.push(`material line(s) ${otherMoved.map((m) => m.name).slice(0, 3).join(", ")} changed rate or quantity`);
        add({
          code: "prod_stale", key: g.key, area: "production", impact: imp,
          title: `${where}: costing is out of date`,
          what: `Stored cost/unit ${fmtR(pce.cost_per_unit)}; re-running costing today would give ${fmtR(now.cost_per_unit)} (RM ${fmtR(now.rm_rate)} + CC ${fmtR(now.cc_rate)}).`,
          why: reasons.length
            ? `Costing ran on ${fmtD(pce.calculated_at)}. Since then ${reasons.join("; ")}.`
            : `Material rates, issued quantities, receipts or the CC pool changed after costing ran on ${fmtD(pce.calculated_at)}.`,
          fix: lateInputs.length
            ? ["Re-run production costing for the whole month with Auto-Sequence, so semi-finished goods are costed before the products that use them.", "Then regenerate the JVs."]
            : ["Re-run production costing for this month, then regenerate the JVs."],
          ref: refTab,
        });
      }
      if (pce.cost_variance != null && n(pce.theoretical_cost) > 0 && Math.abs(n(pce.cost_variance)) / n(pce.theoretical_cost) >= 0.1) {
        add({
          code: "prod_variance", key: g.key, area: "production", severity: "info",
          impact: n(pce.cost_variance),
          title: `${where}: issued ${n(pce.cost_variance) > 0 ? "more" : "less"} than the plan needs`,
          what: `Actual ${fmt(pce.actual_issued_cost)} vs plan ${fmt(pce.theoretical_cost)} (${((n(pce.cost_variance) / n(pce.theoretical_cost)) * 100).toFixed(1)}%). Wastage ${fmt(pce.wastage_cost)}.`,
          why: "Actual issues drive the cost. A large gap usually means over-issue, a wrong plan reference on an issue, or a plan material list that doesn't match the recipe.",
          fix: ["Review the materials table: compare plan qty with issued qty."],
          ref: refTab,
        });
      }
      // Semi-finished / finished inputs that bring no CC with them
      for (const m of materials) {
        if (!m.carries_cc || m.now_qty <= QTY_TOL || m.cc_per_unit > 0) continue;
        const rn = ctx.ratesNow.get(m.itcd);
        add({
          code: "cc_input_missing", key: `${g.key}:${m.itcd}`, area: "cc",
          severity: rn?.source === "production" ? "medium" : "info",
          impact: m.now_qty * ccNow.rate,
          title: `${where}: semi-finished input "${m.name}" carries no CC`,
          what: `${fmtQ(m.now_qty)} of ${m.name} went into this product with a CC of 0 per unit, so no conversion cost from its own stage reaches this product.`,
          why: rn?.source === "production"
            ? "The input was produced this month but its costing entries have no CC — they were M2M, or costed before overheads were posted."
            : "The input was not produced this month, and its opening stock has no CC split (opening locked before CC was tracked, or the stock was bought in).",
          fix: rn?.source === "production"
            ? ["Post the month's overheads, then re-run production costing with Auto-Sequence."]
            : ["If the input was made in-house, re-lock the previous month so its opening carries its CC."],
          ref: refTab,
        });
      }
    }
    if (pce && pceThisMonth) {
      if (!item.carries_cc && n(pce.cc_cost) > 0) {
        add({
          code: "cc_wrong_cat", key: g.key, area: "cc", impact: n(pce.cc_cost),
          title: `${where}: CC charged to a category that doesn't carry CC`,
          what: `${fmt(pce.cc_cost)} CC on an item in "${item.category}".`,
          why: ccNow.semi_on
            ? "Only finished and semi-finished goods absorb conversion cost. The item's category was probably changed after costing."
            : "Only finished goods absorb conversion cost (semi-finished CC is off). The item's category was changed after costing, or costing ran while semi-finished CC was on.",
          fix: ["Re-run production costing."],
          ref: refTab,
        });
      }
      if (prod.m2m && n(pce.cc_cost) > 0) {
        add({
          code: "cc_m2m", key: g.key, area: "cc", impact: n(pce.cc_cost),
          title: `${where}: M2M receipt carries CC`,
          what: `Machine-to-machine receipts should not absorb CC, but ${fmt(pce.cc_cost)} was applied.`,
          why: "The receipt was tagged M2M after costing ran, or unplanned costing applied CC to it.",
          fix: ["Re-run production costing."],
          ref: refTab,
        });
      }
      if (!pce.is_orphan && item.carries_cc && !prod.m2m && rateDiffers(ccNow.rate, n(pce.cc_rate))) {
        const q = t8Now?.qty || n(pce.qty_costed);
        add({
          code: "cc_stale", key: g.key, area: "cc", impact: (ccNow.rate - n(pce.cc_rate)) * q,
          title: `${where}: CC rate is out of date`,
          what: `Costed with CC ${fmtR(pce.cc_rate)}; the CC pool today gives ${fmtR(ccNow.rate)} (${fmt(ccNow.pool)} ÷ ${fmtQ(ccNow.qty)}).`,
          why: "Overhead vouchers (Account Settings → Conversion overheads) or production receipts were posted after costing, so the pool or the quantity it is shared over changed.",
          fix: ["Post all overheads for the month first, then re-run production costing."],
          ref: refTab,
        });
      }
    }
    if (pce?.is_orphan && pceThisMonth) {
      add({
        code: "prod_orphan", key: g.key, area: "production", severity: "medium",
        impact: n(pce.actual_issued_cost),
        title: "Unplanned production shares the pool of unlinked issues",
        what: `${fmtQ(pce.qty_costed)} costed at ${fmtR(rmPart(pce))} RM from unlinked issues, pro-rated by quantity across every unplanned receipt.`,
        why: "Without a plan the system cannot know which materials went into this item. It also values those issues at the amount typed on the issue voucher, not at the material's blended rate.",
        fix: ["Link receipts and issues to their production plan (rmk5 = plan number) and re-cost."],
        ref: refTab,
      });
    }
  }

  for (const e of ownPces) {
    if (n(e.qty_costed) <= 0) {
      add({
        code: "pce_zero_qty", key: e.id, area: "production", severity: "medium",
        title: `Costing entry ${e.plan_id ? `for plan ${e.plan_id}` : "(unplanned)"} has zero quantity`,
        what: `Cost ${fmt(e.total_cost)} recorded for 0 units.`,
        why: "Usually issues with no receipt. The cost never reaches the stock report, but COGM still reads the entry.",
        fix: ["Post the production receipt or remove the issue."],
      });
    }
  }
  if (producedQty > QTY_TOL && Math.abs(prodRateRecalc - rep.production_rate) > 0.0001) {
    add({
      code: "prod_rate_recalc", area: "data", severity: "medium",
      title: "Production rate rebuilt here differs from the stock report",
      what: `Rebuilt ${fmtR(prodRateRecalc)} vs stock report ${fmtR(rep.production_rate)}.`,
      why: "The stock report's logic changed and this trace was not updated, or costing entries changed while the page was loading.",
      fix: ["Refresh. If it persists, report it to the developer."],
    });
  }

  // CC: SMS's stock report gives a CC rate to finished goods only (Settings →
  // Production setup): ( opening qty × opening CC + this month's PCE CC cost
  // + earlier months' returns' CC [+ input CC when the report provides it] )
  // ÷ ( opening qty + produced qty + earlier months' returned qty ).
  // The report flags carries_cc itself (finished + semi-finished per
  // costing.semiFinishedCC); with costing.method = blendedCC it divides by the
  // costed qty and adds the CC carried in by inputs (lib/costing/ccRates.js).
  const reportCarriesCc = R?.carries_cc ?? isFinishedCategory(ctx.setup, item.ic_id);
  const priorRetQtyCc = n(R?.prior_ret_qty);
  const costedQtyThisMonth = ownPces.filter((e) => e.month === month && e.year === year).reduce((s, e) => s + n(e.qty_costed), 0);
  const ccBlendQty = rep.opening_qty + (ctx.blended ? costedQtyThisMonth : producedQty) + priorRetQtyCc;
  const ccBlendCost = rep.opening_qty * rep.opening_cc_rate + (ctx.blended ? n(R?.cc_own_cost) : pceCcCost) + n(R?.prior_ret_cc_value) + n(R?.cc_input_cost);
  const cc = {
    carries: item.carries_cc,
    opening_qty: rep.opening_qty, opening_cc_rate: rep.opening_cc_rate,
    pce_qty: pceQtyAll, pce_cc_cost: pceCcCost, pce_input_cc_cost: n(R?.cc_input_cost),
    blended_rate: reportCarriesCc ? div(ccBlendCost, ccBlendQty) : 0,
    report_rate: rep.cc_rate,
    pool_now: ccNow.pool, pool_qty_now: ccNow.qty, rate_now: ccNow.rate,
    own_value: ownCcValue,
    inputs_value: inputCcValue,
    own_per_unit: div(ownCcValue, costedQtyThisMonth),
    inputs_per_unit: div(inputCcValue, costedQtyThisMonth),
  };
  if (reportCarriesCc && R && Math.abs(cc.blended_rate - rep.cc_rate) > 0.0001) {
    add({
      code: "cc_recalc", area: "data", severity: "medium",
      title: "CC rate rebuilt here differs from the stock report",
      what: `Rebuilt ${fmtR(cc.blended_rate)} vs stock report ${fmtR(rep.cc_rate)}.`,
      why: "Costing entries changed while the page was loading, or the stock report's CC logic changed and this trace was not updated.",
      fix: ["Refresh. If it persists, report it to the developer."],
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. BLENDED RATE — rebuild and verify
  // ════════════════════════════════════════════════════════════════════════
  const purRetQty = sumQty(purRetLines);
  const purRetAmt = purRetLines.reduce((s, l) => s + l.camt, 0);
  // SMS's stock report also pools earlier months' sale returns at their own
  // cost (Settings → Features "saleReturn.costAtOriginalMonth"; 0 when off)
  const priorRetQty = n(R?.prior_ret_qty);
  const priorRetValue = n(R?.prior_ret_cost_value);
  const poolQty = rep.opening_qty + purQty - purRetQty + producedQty + priorRetQty;
  const poolValue = rep.opening_qty * rep.opening_rate + purAmt - purRetAmt + producedQty * rep.production_rate + priorRetValue;
  const blendedRecalc = div(poolValue, poolQty);
  const blended = {
    pool_qty: poolQty, pool_value: poolValue, rate: blendedRecalc, report_rate: rate,
    rm_rate: rate - (item.carries_cc ? rep.cc_rate : 0), cc_rate: item.carries_cc ? rep.cc_rate : 0,
    parts: [
      { key: "opening", label: "Opening", qty: rep.opening_qty, value: rep.opening_qty * rep.opening_rate, rate: rep.opening_rate },
      { key: "purchases", label: "Purchases", qty: purQty, value: purAmt, rate: div(purAmt, purQty) },
      { key: "returns", label: "Purchase returns", qty: -purRetQty, value: -purRetAmt, rate: div(purRetAmt, purRetQty) },
      { key: "production", label: "Production", qty: producedQty, value: producedQty * rep.production_rate, rate: rep.production_rate },
      ...(Math.abs(priorRetQty) > QTY_TOL
        ? [{ key: "prior_returns", label: "Earlier months' sale returns", qty: priorRetQty, value: priorRetValue, rate: div(priorRetValue, priorRetQty) }]
        : []),
    ],
  };
  for (const p of blended.parts) p.share = div(p.value, poolValue) * 100;

  if (R && Math.abs(blendedRecalc - rate) > 0.0001 && poolQty > 0) {
    add({
      code: "blended_recalc", area: "data", severity: "medium",
      title: "Blended rate rebuilt here differs from the stock report",
      what: `Rebuilt ${fmtR(blendedRecalc)} vs stock report ${fmtR(rate)}.`,
      why: "Vouchers changed while the page was loading, or the stock report's logic changed and this trace was not updated.",
      fix: ["Refresh. If it persists, report it to the developer."],
    });
  }
  if (poolQty <= QTY_TOL && (rep.issue_qty > 0 || rep.sale_qty + rep.pos_qty > 0)) {
    add({
      code: "blended_no_pool", area: "issues", severity: "high",
      impact: (rep.issue_qty + rep.sale_qty + rep.pos_qty) * rep.opening_rate,
      title: "Stock went out with nothing to value it",
      what: `Opening + purchases + production = ${fmtQ(poolQty)}, but ${fmtQ(rep.issue_qty + rep.sale_qty + rep.pos_qty)} went out.`,
      why: "With no stock coming in, the blended rate is 0 (issues fall back to the opening rate). Issues and sales are valued at 0 or at a stale rate.",
      fix: ["Post the missing receipt, opening or production for this item."],
    });
  }
  if (rate > 0 && rep.opening_rate > 0 && Math.abs(rate - rep.opening_rate) / rep.opening_rate >= 0.25 && rep.opening_qty > QTY_TOL) {
    const top = [...blended.parts].filter((p) => p.key !== "opening" && Math.abs(p.qty) > QTY_TOL)
      .sort((a, b) => Math.abs(b.value - b.qty * rep.opening_rate) - Math.abs(a.value - a.qty * rep.opening_rate))[0];
    add({
      code: "blended_jump", area: "issues", severity: "info",
      title: `Rate moved ${rate > rep.opening_rate ? "up" : "down"} ${Math.abs(((rate - rep.opening_rate) / rep.opening_rate) * 100).toFixed(0)}% from the opening rate`,
      what: `Opening ${fmtR(rep.opening_rate)} → blended ${fmtR(rate)}.${top ? ` The biggest pull is ${top.label.toLowerCase()} at ${fmtR(top.rate)}.` : ""}`,
      why: "A large move is usually real (price change), but check the line that drives it in Rate build-up before trusting it.",
      fix: ["Confirm the purchase or production rate behind the move."],
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. ISSUES (item consumed) — plan / direct / orphan
  // ════════════════════════════════════════════════════════════════════════
  const t7Lines = lines.filter((l) => l.tran_code === 7 && l.counted);
  // Unlinked issues are credited only when unplanned production (another item,
  // with received qty) absorbed them. Issue-only orphan entries cost the
  // material against itself with 0 qty, so COGM credits nothing for them.
  const orphanPoolPcd = asMaterial.filter((d) =>
    d.entry?.is_orphan && d.entry?.plan_id == null && Number(d.entry.itcd) !== itcd && n(d.entry.qty_costed) > 0);
  const issueGroups = new Map();
  for (const l of t7Lines) {
    const key = l.cls === "plan" ? `plan:${l.plan_id}` : l.cls === "direct" ? `direct:${l.rmk5}` : "orphan";
    if (!issueGroups.has(key)) issueGroups.set(key, { key, cls: l.cls, plan_id: l.cls === "plan" ? l.plan_id : null, refs: new Set(), lines: [], qty: 0, costing_qty: 0 });
    const g = issueGroups.get(key);
    g.lines.push(l.line_id);
    g.qty += n(l.qty);
    g.refs.add(l.rmk5 || "(blank)");
    if (l.sub_tran_id === 1 && n(l.qty) > 0 && l.exact_ref) g.costing_qty += n(l.qty);
  }
  for (const d of asMaterial) {
    if (d.entry?.plan_id == null) continue;
    const key = `plan:${d.entry.plan_id}`;
    if (!issueGroups.has(key)) issueGroups.set(key, { key, cls: "plan", plan_id: d.entry.plan_id, refs: new Set(), lines: [], qty: 0, costing_qty: 0 });
  }

  const consumption = [];
  for (const g of issueGroups.values()) {
    const plan = g.plan_id ? planMap.get(g.plan_id) : null;
    const pcd = g.plan_id ? asMaterial.find((d) => d.entry?.plan_id === g.plan_id) : null;
    if (Math.abs(g.qty) <= QTY_TOL && !pcd) continue;
    const pce = g.plan_id ? ctx.pceByPlan.get(g.plan_id) : null;
    const reportValue = g.qty * rate;
    let jv = "none";
    let jvValue = 0;
    if (g.cls === "plan" && pcd) { jv = "COGM"; jvValue = n(pcd.actual_cost); }
    else if (g.cls === "direct") { jv = "MATISS"; jvValue = reportValue; }
    else if (g.cls === "orphan" && orphanPoolPcd.length) {
      jv = "COGM (unplanned pool)";
      jvValue = orphanPoolPcd.reduce((s, d) => s + n(d.actual_cost), 0);
      g.costing_qty = orphanPoolPcd.reduce((s, d) => s + n(d.actual_qty), 0);
    }
    const productId = g.plan_id ? Number(pce?.itcd ?? plan?.finished_id) || null : null;
    const row = {
      key: g.key, cls: g.cls, plan_id: g.plan_id, refs: [...g.refs], lines: g.lines,
      product_itcd: productId,
      product: productId ? nameOf(productId) || plan?.item?.item || null : null,
      plan_status: plan?.status ?? null,
      qty: g.qty, costing_qty: g.costing_qty,
      report_rate: rate, report_value: reportValue,
      costing: pcd ? {
        qty: n(pcd.actual_qty), rate: n(pcd.actual_unit_cost), value: n(pcd.actual_cost),
        bom_qty: n(pcd.qty), bom_rate: n(pcd.unit_cost), source: pcd.cost_source,
        calculated_at: pcd.entry?.calculated_at,
      } : null,
      rate_now: myRateNow?.rate ?? 0,
      rate_now_source: myRateNow?.source ?? "none",
      jv, jv_value: jvValue,
      pce_month: pce ? { month: pce.month, year: pce.year } : null,
    };
    consumption.push(row);

    const where = g.plan_id ? `Plan ${g.plan_id}${row.product ? ` (${row.product})` : ""}` : g.cls === "direct" ? `Direct issue "${[...g.refs][0]}"` : "Unlinked issues";
    const refTab = { tab: "consumption", key: g.key };

    if (g.cls === "orphan" && g.qty > QTY_TOL) {
      if (!orphanPoolPcd.length) {
        add({
          code: "issue_uncovered", area: "issues", impact: reportValue, severity: severityOf(reportValue) === "low" ? "medium" : severityOf(reportValue),
          title: "Issues not linked to any plan — no JV takes them out of stock",
          what: `${fmtQ(g.qty)} issued with reference "${[...g.refs].slice(0, 5).join(", ")}${g.refs.size > 5 ? "…" : ""}". The stock report values them at ${fmt(reportValue)}, but no COGM, MATISS or unplanned-production entry credits them.`,
          why: "Only plan-linked issues (COGM), Cleaning/Lab/QC/Raw Material issues (MATISS) and issues swept into unplanned production are posted to GL. These fall through, so the GL stock account stays higher than the stock report.",
          fix: ["Put the plan number in rmk5, or a Cleaning/Lab/QC label for direct use.", "Then re-cost and regenerate the JV."],
          ref: refTab,
        });
      } else if (Math.abs(jvValue - reportValue) >= AMT_TOL) {
        add({
          code: "issue_orphan_value", area: "issues", impact: jvValue - reportValue,
          title: "Unlinked issues valued at the voucher amount, not the blended rate",
          what: `Unplanned production credits ${fmt(jvValue)} for this item; the stock report values the same issues at ${fmt(reportValue)} (${fmtQ(g.qty)} × ${fmtR(rate)}).`,
          why: "Unplanned costing uses the amount typed on the issue voucher (often 0 or old), not the item's rate for the month.",
          fix: ["Link these issues to their plans, so they are costed at the blended rate."],
          ref: refTab,
        });
      }
    }
    if (g.cls === "direct" && g.qty > QTY_TOL && !ctx.jvs.byTag[MATISS_TAG].length) {
      add({
        code: "issue_direct_nojv", key: g.key, area: "gl", impact: reportValue,
        title: "Direct issuance JV not posted",
        what: `${fmtQ(g.qty)} issued for "${[...g.refs][0]}" (${fmt(reportValue)}) — no Direct Material Issuance JV exists for ${label(month, year)}.`,
        why: "Direct issues leave the GL only through the MATISS JV.",
        fix: ["Open the Direct Material Issuance Cost report for this month, preview the JV and post it."],
        ref: refTab,
      });
    }
    if (g.cls === "direct" && g.qty > QTY_TOL && orphanPoolPcd.length) {
      add({
        code: "issue_double", key: g.key, area: "issues", impact: reportValue, severity: "high",
        title: "Direct issue may be credited twice",
        what: `"${[...g.refs][0]}" has no plan link, so unplanned production costing also sweeps it into its pool — and MATISS credits it again.`,
        why: "Unplanned costing picks up every issue without a valid plan number, including Cleaning/Lab/QC ones.",
        fix: ["Check the unplanned production entry's materials; remove direct issues from the unplanned pool."],
        ref: refTab,
      });
    }
    if (g.cls === "plan" && g.qty > QTY_TOL) {
      if (!pce) {
        add({
          code: "issue_plan_uncosted", key: g.key, area: "issues", impact: reportValue,
          title: `${where}: issued but the plan is not costed`,
          what: `${fmtQ(g.qty)} issued to plan ${g.plan_id}, but the plan has no costing entry.`,
          why: "Costing only runs for plans with a production receipt in the month. Without it, the COGM JV never credits these materials, so the GL stock account stays higher than the stock report.",
          fix: ["Post the plan's production receipt, then run costing."],
          ref: refTab,
        });
      } else if (pce.month !== month || pce.year !== year) {
        add({
          code: "issue_plan_month", key: g.key, area: "issues", impact: reportValue,
          title: `${where}: issued in ${label(month, year)}, plan costed in ${label(pce.month, pce.year)}`,
          what: `Costing reads only issues of the month it runs for, so these ${fmtQ(g.qty)} are not in any COGM.`,
          why: "Issues and receipts of one plan were posted in different months.",
          fix: ["Move the issue into the costing month, or re-cost the plan in this month."],
          ref: refTab,
        });
      } else if (!pcd) {
        add({
          code: "issue_plan_missing", key: g.key, area: "issues", impact: reportValue,
          title: `${where}: issue not in the plan's costing`,
          what: `${fmtQ(g.qty)} issued to plan ${g.plan_id}, but its costing entry has no line for this material.`,
          why: g.costing_qty < g.qty - QTY_TOL
            ? "The issue reference is not an exact plan number or the quantity is on a sub line other than 1, so costing does not see it."
            : "The issue was posted after costing ran.",
          fix: ["Fix the reference if needed, then re-run production costing for the plan."],
          ref: refTab,
        });
      } else {
        if (qtyDiffers(n(pcd.actual_qty), g.costing_qty)) {
          add({
            code: "issue_qty", key: g.key, area: "issues", impact: (g.costing_qty - n(pcd.actual_qty)) * rate,
            title: `${where}: issued quantity changed after costing`,
            what: `Costing used ${fmtQ(pcd.actual_qty)}, issues now total ${fmtQ(g.costing_qty)}.`,
            why: "Issues were added or edited after costing ran.",
            fix: ["Re-run production costing for the plan."],
            ref: refTab,
          });
        }
        if (rateDiffers(n(pcd.actual_unit_cost), rate) && n(pcd.actual_qty) > 0) {
          const imp = (n(pcd.actual_unit_cost) - rate) * n(pcd.actual_qty);
          const reasons = [];
          if (myRateNow && rateDiffers(myRateNow.rate, n(pcd.actual_unit_cost))) reasons.push(`costing ran before later changes (today it would use ${fmtR(myRateNow.rate)})`);
          if (myRateNow?.source === "production") reasons.push("this item was also produced this month: costing blends opening + this month's production only and ignores purchases, while the stock report blends opening + purchases + production");
          else if (producedQty > QTY_TOL) reasons.push("the stock report includes this month's production in the rate, costing does not");
          if (myRateNow && Math.abs(myRateNow.purch_amt - myRateNow.purch_amt_main) >= AMT_TOL) reasons.push("costing reads purchase charge lines the stock report ignores");
          add({
            code: "issue_rate", key: g.key, area: "issues", impact: imp,
            title: `${where}: material rate differs from the stock report`,
            what: `Costing values ${fmtQ(pcd.actual_qty)} at ${fmtR(pcd.actual_unit_cost)}; the stock report issues at ${fmtR(rate)}. COGM ${imp > 0 ? "credits more" : "credits less"} than the stock report removes.`,
            why: reasons.length ? `Because ${reasons.join("; and ")}.` : "The two engines use different rate formulas for this item.",
            fix: ["If costing is stale, re-run it.", "A remaining gap is a method difference; post an adjustment JV or align the formulas."],
            ref: refTab,
          });
        }
      }
    }
  }
  // Problem rows first (largest JV ↔ report gap), then by value
  consumption.sort((a, b) =>
    Math.abs(b.jv_value - b.report_value) - Math.abs(a.jv_value - a.report_value) ||
    Math.abs(b.report_value) - Math.abs(a.report_value));
  for (const c of consumption) if (c.refs.length > 5) c.refs = [...c.refs.slice(0, 5), `+${c.refs.length - 5} more`];

  // ════════════════════════════════════════════════════════════════════════
  // 6. SALES
  // ════════════════════════════════════════════════════════════════════════
  const soldQty = rep.sale_qty + rep.pos_qty;
  const retQty = rep.sale_ret_qty + rep.pos_ret_qty;
  const netSold = soldQty - retQty;
  const saleAmt = rep.sale_amount + rep.pos_amount - rep.sale_ret_amount - rep.pos_ret_amount;
  const sales = {
    sold_qty: soldQty, returned_qty: retQty, net_qty: netSold,
    revenue: saleAmt, sale_rate: div(saleAmt, netSold),
    cost_rate: rate, rm_rate: blended.rm_rate, cc_rate: blended.cc_rate,
    report_cost: netSold * rate, cogs_included: netSold > 0, cogs_cost: netSold > 0 ? netSold * rate : 0,
    margin: saleAmt - netSold * rate,
  };
  if (netSold <= 0 && retQty > QTY_TOL) {
    add({
      code: "sales_returns_exceed", area: "sales", impact: netSold * rate,
      title: "Returns exceed sales — COGS skips this item",
      what: `Sold ${fmtQ(soldQty)}, returned ${fmtQ(retQty)}. The stock report adds ${fmt(-netSold * rate)} back to stock; the COGS JV ignores items with no net sales.`,
      why: "The COGS report only includes items with positive net sales.",
      fix: ["Post an adjustment JV (Dr stock, Cr COGS) for the returned cost."],
      ref: { tab: "movements" },
    });
  }
  const freeSales = lines.filter((l) => l.counted && (l.tran_code === 6 || l.tran_code === 5) && n(l.qty) > 0 && !(l.camt || l.gross_amount));
  if (freeSales.length) {
    for (const l of freeSales) l.flags.push("zero_value");
    const q = sumQty(freeSales);
    add({
      code: "sales_zero_price", area: "sales", severity: "info", impact: q * rate,
      title: `${freeSales.length} sale line(s) with no price`,
      what: `${fmtQ(q)} delivered at 0 on ${freeSales.map((l) => `#${l.vr_no ?? l.tran_id}`).slice(0, 5).join(", ")}${freeSales.length > 5 ? "…" : ""}. Their cost (${fmt(q * rate)}) is still charged to COGS.`,
      why: "Free samples, replacements, or a sale invoice still waiting for its price.",
      fix: ["Confirm these are intended; otherwise enter the price on the invoice."],
      ref: { tab: "movements", line_id: freeSales[0].line_id },
    });
  }
  if (netSold > QTY_TOL && rate > 0 && sales.sale_rate > 0 && sales.sale_rate < rate) {
    add({
      code: "sales_below_cost", area: "sales", severity: "info", impact: sales.margin,
      title: "Sold below cost",
      what: `Average sale rate ${fmtR(sales.sale_rate)} vs cost ${fmtR(rate)}.`,
      why: "Either a real loss, or the cost rate is inflated by one of the issues above.",
      fix: ["Resolve the other findings first, then review pricing."],
    });
  }
  if (netSold > QTY_TOL && rate <= 0) {
    add({
      code: "sales_zero_cost", area: "sales", severity: "high",
      title: "Sold with zero cost",
      what: `${fmtQ(netSold)} sold at a cost rate of 0.`,
      why: "The item has no valued stock this month (no opening rate, no costed production, no purchase amount).",
      fix: ["Fix the missing rate source shown in Rate build-up."],
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 7. CLOSING
  // ════════════════════════════════════════════════════════════════════════
  const closing = {
    qty: rep.closing_qty, rate: rep.closing_rate, value: rep.closing_value,
    next_snapshot: nextSnap,
    month_locked: !!curLock?.is_locked, locked_at: curLock?.locked_at ?? null, locked_by: curLock?.locked_by ?? null,
  };
  if (rep.closing_qty < -QTY_TOL) {
    add({
      code: "closing_negative", area: "closing", severity: "high", impact: rep.closing_value,
      title: "Closing stock is negative",
      what: `Closes at ${fmtQ(rep.closing_qty)} (${fmt(rep.closing_value)}).`,
      why: "More went out than came in. At the lock the negative quantity is reset to 0, and the gap never reaches next month's opening.",
      fix: ["Post the missing receipt or correct over-issues before locking."],
      ref: { tab: "movements" },
    });
  }
  if (rep.closing_qty > QTY_TOL && rep.closing_rate <= 0) {
    add({
      code: "closing_zero_rate", area: "closing", severity: "high",
      title: "Closing stock has no value",
      what: `${fmtQ(rep.closing_qty)} in stock valued at 0.`,
      why: "No rate source this month — next month will open at 0 too.",
      fix: ["Fix the missing rate source before locking."],
    });
  }
  if (nextSnap && closing.month_locked) {
    const expQty = Math.max(0, rep.closing_qty);
    if (qtyDiffers(nextSnap.qty, expQty) || (expQty > QTY_TOL && rateDiffers(nextSnap.rate, rep.closing_rate))) {
      add({
        code: "closing_next_drift", area: "closing", impact: nextSnap.qty * nextSnap.rate - expQty * rep.closing_rate,
        title: `${label(next.month, next.year)} opening is out of date`,
        what: `Saved opening ${fmtQ(nextSnap.qty)} @ ${fmtR(nextSnap.rate)}; this month now closes ${fmtQ(expQty)} @ ${fmtR(rep.closing_rate)}.`,
        why: "This month changed after it was locked.",
        fix: [`Unlock and re-lock ${label(month, year)}.`],
      });
    }
  }

  // Recipe ↔ BOM: the active recipe should use an active BOM of this item with the same materials
  const recipeRows = (ctx.recipesByItem.get(itcd) || []).map((r) => ({
    ...r,
    missing: r.missing.map((id) => ({ itcd: id, name: nameOf(id) || `Item ${id}` })),
    extra: r.extra.map((id) => ({ itcd: id, name: nameOf(id) || `Item ${id}` })),
  }));
  const listNames = (arr) => `${arr.slice(0, 5).map((m) => m.name).join(", ")}${arr.length > 5 ? ` +${arr.length - 5} more` : ""}`;
  if (recipeRows.length > 1) {
    add({
      code: "recipe_multi_active", area: "recipe", severity: "low",
      title: `${recipeRows.length} active recipes for this item`,
      what: `Recipes ${recipeRows.map((r) => `#${r.receipe_id}`).join(", ")} are all Active.`,
      why: "Production plans can pick any of them, so batches of the same item may use different materials.",
      fix: ["Keep one recipe Active and set the others Inactive."],
    });
  }
  for (const r of recipeRows) {
    const where = `Recipe #${r.receipe_id}`;
    if (r.bom_id == null) continue;
    if (r.bom_item == null || r.bom_item !== itcd) {
      add({
        code: "recipe_bom_wrong", key: r.receipe_id, area: "recipe", severity: "medium",
        title: `${where}: its BOM ${r.bom_item == null ? "doesn't exist" : "belongs to another item"}`,
        what: r.bom_item == null ? `BOM #${r.bom_id} is selected but no longer exists.` : `BOM #${r.bom_id} is the BOM of ${nameOf(r.bom_item) || `item ${r.bom_item}`}.`,
        why: "The recipe was copied from another item, or its BOM was deleted.",
        fix: ["Select this item's own active BOM on the recipe."],
      });
      continue;
    }
    if (r.bom_status !== "A") {
      add({
        code: "recipe_bom_inactive", key: r.receipe_id, area: "recipe", severity: "medium",
        title: `${where}: uses inactive BOM #${r.bom_id}`,
        what: "The recipe is Active, but the BOM selected on it is not.",
        why: "A new BOM was activated, but the recipe still points to the old one, so plans made from it use the old materials and percentages.",
        fix: ["Open the recipe and select the item's active BOM, or create a new recipe from it."],
      });
    }
    if (r.missing.length || r.extra.length) {
      add({
        code: "recipe_bom_mismatch", key: r.receipe_id, area: "recipe", severity: "medium",
        title: `${where}: materials don't match BOM #${r.bom_id}`,
        what: [
          r.missing.length ? `In the BOM but not in the recipe: ${listNames(r.missing)}.` : "",
          r.extra.length ? `In the recipe but not in the BOM: ${listNames(r.extra)}.` : "",
        ].filter(Boolean).join(" "),
        why: "One of the two was changed without the other — typically a material was replaced. Production plans follow the recipe while BOM-based costing and checks follow the BOM.",
        fix: ["Update the recipe or the BOM so both list the same materials (machine instructions are ignored)."],
      });
    }
  }

  // Stock by godown (single-item trace only)
  let godowns = null;
  const gRows = ctx.godownStock?.get(itcd);
  if (gRows) {
    const total = gRows.reduce((s, g) => s + g.closing, 0);
    // Reliable only when all of this item's stock came in through vouchers
    const reliable = Math.abs(total - rep.closing_qty) <= Math.max(0.01, Math.abs(rep.closing_qty) * 0.0005);
    godowns = { rows: gRows, total, report_closing_qty: rep.closing_qty, reliable };
    if (reliable && rep.closing_qty >= -QTY_TOL) {
      const neg = gRows.filter((g) => g.closing < -QTY_TOL);
      if (neg.length) {
        add({
          code: "godown_negative", area: "closing", severity: "medium", impact: neg.reduce((s, g) => s + g.closing, 0) * rate,
          title: `Negative stock in ${neg.length === 1 ? `godown "${neg[0].name}"` : `${neg.length} godowns`}`,
          what: `${neg.map((g) => `${g.name}: ${fmtQ(g.closing)}`).join(", ")} — while the company total is ${fmtQ(rep.closing_qty)}.`,
          why: "Stock was issued or sold from a godown before it was received or transferred there. The total looks fine, but the godown records are wrong and the next issue from that godown may be blocked or mis-posted.",
          fix: ["Post the missing transfer into that godown, or correct the godown on the issue/sale voucher."],
          ref: { tab: "movements" },
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 8. GL — what each JV does for this item vs the stock report
  // ════════════════════════════════════════════════════════════════════════
  const cogmRow = ctx.cogmByProduct.get(itcd);
  const cogmCredit = n(ctx.cogmCredit.get(itcd));
  const glPurchase = [...purLines, ...purRetLines]
    .filter((l) => l.acno != null && l.acno === (l.tran_code === 4 ? item.purchase_acno : item.purchase_return_acno))
    .reduce((s, l) => s + l.damt - l.camt, 0);
  const issueByCls = (cls) => consumption.filter((c) => c.cls === cls).reduce((s, c) => s + c.report_value, 0);
  const planIssueValue = issueByCls("plan");
  const directIssueValue = issueByCls("direct");
  const orphanIssueValue = issueByCls("orphan");

  const byTag = ctx.jvs.byTag;
  const posted = { [COGM_TAG]: byTag[COGM_TAG].length > 0, [COGS_TAG]: byTag[COGS_TAG].length > 0, [MATISS_TAG]: byTag[MATISS_TAG].length > 0 };
  const glRow = (key, labelText, reportV, glV, jv, extra = {}) => ({
    key, label: labelText, report: r2(reportV), gl: r2(glV), diff: r2(glV - reportV),
    jv, posted: jv ? posted[jv] : null, ...extra,
  });
  const gl = {
    acno: item.acno, acname: item.acname,
    rows: [
      glRow("purchases", "Purchases − returns", purAmt - purRetAmt, glPurchase, null, { note: "GL = purchase / return lines of this item posted to its purchase / purchase-return account" }),
      glRow("production", "Production in (COGM Dr)", producedQty * rep.production_rate, n(cogmRow?.net_cost), COGM_TAG,
        { note: cogmRow ? `COGM: ${fmtQ(cogmRow.qty)} × (RM ${fmtR(cogmRow.rm_pure_rate ?? cogmRow.rm_rate)} + CC ${fmtR(cogmRow.cc_total_rate ?? cogmRow.cc_rate)})` : "Not in COGM" }),
      glRow("consumption", "Used in production (COGM Cr)", -planIssueValue - (orphanPoolPcd.length ? orphanIssueValue : 0), -cogmCredit, COGM_TAG,
        { note: "COGM credits each material its share of the product's RM cost" }),
      glRow("direct", "Direct issues (MATISS Cr)", -directIssueValue, -directIssueValue, MATISS_TAG),
      glRow("uncovered", "Issues no JV credits", orphanPoolPcd.length ? 0 : -orphanIssueValue, 0, null),
      glRow("sales", "Cost of sales (COGS Cr)", -sales.report_cost, -sales.cogs_cost, COGS_TAG,
        { note: sales.cogs_included ? `COGS: ${fmtQ(netSold)} × ${fmtR(rate)}` : "No net sales — COGS skips this item" }),
    ].filter((r) => Math.abs(r.report) >= AMT_TOL || Math.abs(r.gl) >= AMT_TOL),
    jvs: [
      { tag: COGM_TAG, label: "COGM" },
      { tag: COGS_TAG, label: "COGS" },
      { tag: MATISS_TAG, label: "Direct issuance" },
    ].map((j) => ({
      ...j,
      vouchers: byTag[j.tag].map((v) => ({ ...v, acno_net: n(ctx.jvs.net.get(`${v.tran_id}:${item.acno}`)) })),
    })),
  };
  gl.total_report = r2(gl.rows.reduce((s, r) => s + r.report, 0));
  gl.total_gl = r2(gl.rows.reduce((s, r) => s + r.gl, 0));

  if (item.acno == null && (Math.abs(rep.closing_value) >= AMT_TOL || Math.abs(rep.opening_value) >= AMT_TOL)) {
    add({
      code: "gl_no_account", area: "gl", severity: "high", impact: rep.closing_value,
      title: "Item has no stock account",
      what: `"${item.category}" has no stock account and the Account Settings "Stock" default is not set, so none of this item's costing reaches the GL.`,
      why: "Every auto JV takes the item's stock account from its category, or the \"Stock\" default in Finance → Account Settings. Without one the JV skips the item (and blocks posting).",
      fix: ["Set the stock account on the item category, or the \"Stock\" default in Finance → Account Settings."],
    });
  }
  for (const r of gl.rows) {
    if (!r.jv) continue;
    if (!r.posted && Math.abs(r.report) >= AMT_TOL) {
      add({
        code: "gl_missing", key: r.key, area: "gl", impact: r.report,
        title: `${r.jv.replace("AUTO_", "")} JV not posted`,
        what: `The stock report moves this item by ${fmt(r.report)} for "${r.label}", but no ${r.jv.replace("AUTO_", "")} JV exists for ${label(month, year)}.`,
        why: "Costing movements reach the GL only through the auto JVs.",
        fix: ["Open the matching cost report for this month, preview the JV and post it."],
      });
    } else if (Math.abs(r.diff) >= AMT_TOL && r.key !== "direct") {
      add({
        code: "gl_method", key: r.key, area: "gl", impact: r.diff,
        title: `${r.label}: JV and stock report value this item differently`,
        what: `Stock report ${fmt(r.report)}, JV (if generated today) ${fmt(r.gl)}.`,
        why: r.key === "production"
          ? "COGM debits the costed quantity × (RM + CC); the stock report values the received quantity × the costed rate. They differ when received ≠ costed quantity, when a batch is uncosted, or when RM rate falls back to the theoretical cost."
          : r.key === "consumption"
            ? "COGM credits each material at its production-costing rate; the stock report issues at the month's blended rate. See the material rate finding above."
            : r.key === "sales"
              ? "COGS skips items whose returns exceed their sales."
              : "Different valuation rules.",
        fix: ["Fix the underlying production / rate finding, or post an adjustment JV for the remaining gap."],
      });
    }
  }
  // Movements posted after a JV that involves this item. Any later line moves
  // the item's rate or quantities, so the posted JV no longer matches.
  const involved = {
    [COGM_TAG]: producedQty > QTY_TOL || planIssueValue !== 0 || (orphanPoolPcd.length > 0 && orphanIssueValue !== 0),
    [COGS_TAG]: Math.abs(netSold) > QTY_TOL,
    [MATISS_TAG]: directIssueValue !== 0,
  };
  const lateByLine = new Map();
  for (const j of gl.jvs) {
    const v = j.vouchers[j.vouchers.length - 1];
    if (!v) continue;
    if (j.vouchers.length > 1 && involved[j.tag]) {
      add({
        code: "gl_duplicate", key: j.tag, area: "gl", severity: "high",
        title: `${j.label} JV posted ${j.vouchers.length} times`,
        what: `Vouchers ${j.vouchers.map((x) => `#${x.vr_no ?? x.tran_id}`).join(", ")} all belong to ${label(month, year)}.`,
        why: "The stock account is moved twice for the same month.",
        fix: ["Reverse the extra voucher."],
      });
    }
    if (!involved[j.tag]) continue;
    for (const l of lines) {
      if (!l.counted || l.tran_id <= v.tran_id) continue;
      l.flags.push(`after_${j.tag}`);
      lateByLine.set(l.line_id, [...(lateByLine.get(l.line_id) || []), `${j.label} #${v.vr_no ?? v.tran_id}`]);
    }
  }
  if (lateByLine.size) {
    const late = lines.filter((l) => lateByLine.has(l.line_id));
    const jvNames = [...new Set([...lateByLine.values()].flat())];
    add({
      code: "gl_after_jv", area: "gl", severity: "medium",
      title: `${late.length} voucher line(s) entered after the JVs were posted`,
      what: `${jvNames.join(", ")} posted before ${late.map((l) => `${l.type} #${l.vr_no ?? l.tran_id}`).slice(0, 4).join(", ")}${late.length > 4 ? "…" : ""}.`,
      why: "Each JV was built from the figures at that moment. Later vouchers change this item's quantities and blended rate, so the posted JVs no longer match the stock report.",
      fix: ["Reverse the affected JVs, re-run costing if production is involved, and post them again."],
      ref: { tab: "movements" },
    });
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || n(b.impact) - n(a.impact));
  const counts = findings.reduce((c, f) => ({ ...c, [f.severity]: (c[f.severity] || 0) + 1 }), {});
  const problems = findings.filter((f) => f.severity !== "info");
  const status = counts.high ? "error" : counts.medium ? "warn" : "ok";

  // Value flow (stock report basis) — must foot to the closing value
  const flow = [
    { key: "opening", label: "Opening", qty: rep.opening_qty, rate: rep.opening_rate, value: rep.opening_qty * rep.opening_rate },
    { key: "purchases", label: "Purchases", qty: purQty, rate: div(purAmt, purQty), value: purAmt },
    { key: "purchase_returns", label: "Purchase returns", qty: -purRetQty, rate: div(purRetAmt, purRetQty), value: -purRetAmt },
    { key: "production", label: "Production received", qty: producedQty, rate: rep.production_rate, value: producedQty * rep.production_rate },
    { key: "issues", label: "Issued", qty: -rep.issue_qty, rate, value: -rep.issue_qty * rate },
    { key: "sales", label: "Sold (incl. POS)", qty: -soldQty, rate, value: -soldQty * rate },
    { key: "sale_returns", label: "Sale returns (incl. POS)", qty: retQty, rate, value: retQty * rate },
  ];
  const flowValue = flow.reduce((s, f) => s + f.value, 0);

  return {
    item,
    period: { month, year, label: label(month, year), locked: !!curLock?.is_locked, semi_cc_on: !!ctx.ccNow.semi_on, prev: { ...prev, label: label(prev.month, prev.year) } },
    found_in_report: !!R,
    verdict: {
      status,
      counts,
      problems: problems.length,
      largest: r2(Math.max(0, ...problems.map((f) => n(f.impact)))),
    },
    report: rep,
    opening,
    blended,
    cc,
    flow: { rows: flow, value: flowValue, closing_qty: rep.closing_qty, closing_value: rep.closing_value, gap: r2(flowValue - rep.closing_value) },
    production: {
      qty: producedQty,
      report_rate: rep.production_rate,
      recalc_rate: prodRateRecalc,
      pce_qty: pceQtyRated,
      groups: productions,
    },
    consumption,
    rate_now: myRateNow || null,
    sales,
    closing,
    godowns,
    recipes: recipeRows,
    gl,
    movements: lines,
    findings,
  };
}

// ── Month-level checks (scan only) ──────────────────────────────────────────

function monthChecks(ctx) {
  const out = [];
  const { month, year, prev, ccNow } = ctx;
  const ccCosted = ctx.allPces.filter((e) => e.month === month && e.year === year).reduce((s, e) => s + n(e.cc_cost), 0);
  const ccAcno = ccNow.cc_acno;
  const cogmCcCredit = ccAcno == null ? 0 : (ctx.jvs.byTag[COGM_TAG] || []).reduce((s, v) => s + -n(ctx.jvs.net.get(`${v.tran_id}:${ccAcno}`)), 0);
  const unabsorbed = ccNow.pool - ccCosted;
  out.push({
    id: "cc_pool",
    ok: Math.abs(unabsorbed) < AMT_TOL * 10,
    title: "Conversion cost pool",
    detail: `${ccNow.overheads_set ? "Overheads (Account Settings → Conversion overheads)" : "Overheads (Account Settings → Conversion overheads is NOT set)"} ${fmt(ccNow.pool)} ÷ ${fmtQ(ccNow.qty)} ${ccNow.semi_on ? "FG+SFG" : "FG"} units = ${fmtR(ccNow.rate)} per unit. Costing absorbed ${fmt(ccCosted)}${ctx.jvs.byTag[COGM_TAG].length ? `, the COGM JV credited ${fmt(cogmCcCredit)} to the conversion cost account${ccAcno != null ? ` ${ccAcno}` : ""}` : ""}.`,
    why: Math.abs(unabsorbed) < AMT_TOL * 10
      ? `Every rupee of overhead was charged to ${ccNow.semi_on ? "finished and semi-finished" : "finished goods"} production exactly once.`
      : unabsorbed > 0
        ? `${fmt(unabsorbed)} of overhead is not in any product: some ${ccNow.semi_on ? "FG/SFG" : "FG"} receipts are uncosted, or overheads were posted after costing ran.`
        : `${fmt(-unabsorbed)} more CC was charged than the pool holds: costing ran before some overheads were reversed, or M2M/other receipts absorbed CC.`,
    amount: r2(unabsorbed),
  });
  const late = [];
  for (const e of ctx.allPces) {
    if (e.month !== month || e.year !== year) continue;
    for (const d of e.details) {
      const rn = ctx.ratesNow.get(Number(d.material_id));
      const mi = ctx.items.get(Number(d.material_id));
      // Produced inputs (FG/SFG) — order matters for their RM even without semi CC
      if (mi?.produced && rn?.last_costed && rn.last_costed > e.calculated_at && rateDiffers(rn.rate, d.actual_unit_cost)) late.push(e.id);
    }
  }
  const lateCount = new Set(late).size;
  out.push({
    id: "costing_order",
    ok: lateCount === 0,
    title: "Costing order (semi-finished before finished)",
    detail: lateCount
      ? `${lateCount} production costing entr${lateCount === 1 ? "y uses" : "ies use"} a semi-finished input that was re-costed afterwards at a different rate.`
      : `Every product was costed after the semi-finished inputs it consumes, so their ${ccNow.semi_on ? "RM and CC" : "cost"} flowed through.`,
    why: lateCount
      ? `Those products still carry the input's old cost${ccNow.semi_on ? " (including its CC)" : ""}. Re-run costing for the month with Auto-Sequence.`
      : ccNow.semi_on
        ? "Semi-finished CC is included in each product's material cost, and the product then adds its own CC."
        : "Each semi-finished input's cost is included in the product's material cost, and the product then adds its own CC.",
    amount: null,
  });
  for (const [tag, labelText] of [[COGM_TAG, "COGM"], [COGS_TAG, "COGS"], [MATISS_TAG, "Direct issuance"]]) {
    const v = ctx.jvs.byTag[tag];
    out.push({
      id: `jv_${tag}`,
      ok: v.length === 1,
      title: `${labelText} JV`,
      detail: v.length === 0 ? "Not posted for this month." : v.length === 1 ? `Posted — voucher #${v[0].vr_no ?? v[0].tran_id}, ${fmtD(v[0].dated)}.` : `Posted ${v.length} times: ${v.map((x) => `#${x.vr_no ?? x.tran_id}`).join(", ")}.`,
      why: v.length === 0 ? "Costing for this month has not reached the GL yet." : v.length > 1 ? "The stock accounts are moved twice — reverse the extra voucher." : "",
      amount: null,
    });
  }
  const prevLock = ctx.locks.find((l) => l.month === prev.month && l.year === prev.year);
  const curLock = ctx.locks.find((l) => l.month === month && l.year === year);
  out.push({
    id: "locks",
    ok: !!prevLock?.is_locked,
    title: "Period locks",
    detail: `${label(prev.month, prev.year)} ${prevLock?.is_locked ? "locked" : "NOT locked"} · ${label(month, year)} ${curLock?.is_locked ? "locked" : "open"}.`,
    why: prevLock?.is_locked ? "" : "This month's opening stock is only final once the previous month is locked.",
    amount: null,
  });
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

// The month's data is kept in this server process for SCAN_CACHE_MS. Requests
// for the same month that arrive while it is loading share one load instead
// of each running the heavy queries.
const cache = globalThis.__itemTraceCache || (globalThis.__itemTraceCache = new Map());
const inflight = globalThis.__itemTraceInflight || (globalThis.__itemTraceInflight = new Map());
const cacheKey = (month, year) => `${year}-${month}`;

async function monthContext(month, year, fresh) {
  const key = cacheKey(month, year);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < SCAN_CACHE_MS) return { ctx: hit.ctx, at: hit.at, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const p = loadContext({ month, year })
    .then((ctx) => {
      const at = Date.now();
      cache.set(key, { ctx, at });
      // Keep only a few months in memory
      for (const k of [...cache.keys()].slice(0, Math.max(0, cache.size - 3))) cache.delete(k);
      return { ctx, at, cached: false };
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Full trace for one item. Reuses a recent all-items scan of the same month
// when there is one, so drilling in from the scan is instant.
export async function traceItemCosting({ itcd, month, year, fresh = false }) {
  const hit = cache.get(cacheKey(month, year));
  const useScan = !fresh && hit && Date.now() - hit.at < SCAN_CACHE_MS && hit.ctx.items.has(itcd);
  const ctx = useScan ? hit.ctx : await loadContext({ month, year, itcd });
  if (!ctx.items.has(itcd)) {
    const err = new Error(`Item ${itcd} not found`);
    err.status = 404;
    throw err;
  }
  const godownCtx = useScan
    ? { ...ctx, godownStock: new Map([[itcd, await loadGodownStock(itcd, ctx.from, ctx.to)]]) }
    : ctx;
  const out = evaluateItem(godownCtx, itcd);

  // Opening rate history (last 12 months + next)
  const snapshots = useScan
    ? await loadSnapshots(historyPeriods(month, year), itcd)
    : ctx.snapshots;
  const history = [];
  for (let i = 11; i >= -1; i--) {
    const p = shiftMonth(month, year, -i);
    const s = snapshots.get(`${itcd}:${ymKey(p.month, p.year)}`);
    history.push({ month: p.month, year: p.year, current: i === 0, ...(s ? { qty: s.qty, rate: s.rate, cc_rate: s.cc_rate, rm_rate: s.rm_rate, updated_at: s.updated_at } : { missing: true }) });
  }
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1], b = history[i];
    if (!a.missing && !b.missing && a.rate > 0) b.change_pct = ((b.rate - a.rate) / a.rate) * 100;
  }
  return { ...out, history, from_scan: !!useScan };
}

// Every item with something to check this month, plus month-level checks and
// findings grouped by cause.
export async function scanAllItemsCosting({ month, year, fresh = false }) {
  const t0 = Date.now();
  const { ctx, at, cached } = await monthContext(month, year, fresh);

  const candidates = new Set([...ctx.linesByItem.keys(), ...ctx.ownPcesByItem.keys(), ...ctx.asMaterialByItem.keys()]);
  for (const [id, r] of ctx.report) {
    if (Math.abs(n(r.opening_stock)) > QTY_TOL || Math.abs(n(r.closing_qty)) > QTY_TOL) candidates.add(id);
  }
  for (const [id, r] of ctx.prevReport) if (Math.abs(n(r.closing_qty)) > QTY_TOL) candidates.add(id);

  const items = [];
  const causes = new Map();
  for (const id of candidates) {
    const t = evaluateItem(ctx, id);
    if (!t) continue;
    const problems = t.findings.filter((f) => f.severity !== "info");
    items.push({
      itcd: id, name: t.item.name, code: t.item.code, category: t.item.category, ic_id: t.item.ic_id, acno: t.item.acno,
      status: t.verdict.status, problems: problems.length, notes: t.findings.length - problems.length,
      largest: t.verdict.largest,
      closing_value: r2(t.report.closing_value), rate: t.report.blended_rate,
      top: problems[0]?.title || null,
      findings: t.findings.map((f) => ({ id: f.id, code: f.code, severity: f.severity, area: f.area, title: f.title, what: f.what, impact: f.impact })),
    });
    for (const f of t.findings) {
      const c = causes.get(f.code) || {
        code: f.code, label: CAUSES[f.code] || f.title, area: f.area, severity: f.severity,
        why: f.why, fix: f.fix, items: new Set(), count: 0, impact: 0,
      };
      if ({ high: 0, medium: 1, low: 2, info: 3 }[f.severity] < { high: 0, medium: 1, low: 2, info: 3 }[c.severity]) c.severity = f.severity;
      c.items.add(id);
      c.count += 1;
      c.impact += n(f.impact);
      causes.set(f.code, c);
    }
  }
  items.sort((a, b) => ({ error: 0, warn: 1, ok: 2 }[a.status] - { error: 0, warn: 1, ok: 2 }[b.status]) || b.largest - a.largest);

  const order = { high: 0, medium: 1, low: 2, info: 3 };
  const causeList = [...causes.values()]
    .map((c) => ({ ...c, items: [...c.items], item_count: c.items.size, impact: r2(c.impact) }))
    .sort((a, b) => order[a.severity] - order[b.severity] || b.impact - a.impact);

  return {
    period: { month, year, label: label(month, year) },
    took_ms: Date.now() - t0,
    cached,
    calculated_at: new Date(at).toISOString(),
    cache_minutes: SCAN_CACHE_MS / 60000,
    totals: {
      items_checked: items.length,
      items_error: items.filter((i) => i.status === "error").length,
      items_warn: items.filter((i) => i.status === "warn").length,
      items_ok: items.filter((i) => i.status === "ok").length,
    },
    month_checks: monthChecks(ctx),
    causes: causeList,
    items,
  };
}
