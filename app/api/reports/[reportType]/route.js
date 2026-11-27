import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCashBankMacnos } from "@/lib/accounts/partyMacnos";
import { checkPeriodLock } from "@/lib/periodLock";
import { getOpening, getOpeningRates, getLatestOpeningPeriod, openingQtySql, openingQtyByGodownSql } from "@/lib/openingStock";
import { REPORT_CONFIG, ENTERED_BY_REPORTS, reportDay, reportMonths } from "@/components/Reports/config";
import { attachEnteredBy } from "@/lib/audit/enteredBy";
import { getAccount, requireAccount, getAccountGroup, accountSettingError } from "@/lib/accounts/accountSettings";
import { distributorFileCodes } from "@/lib/reports/distributorFiles";
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { format } from "date-fns";
import { Prisma } from "@prisma/client";
import { getProcessOrderReconciliationData } from "@/lib/reports/processOrderReconciliation";
import { getProductionPlanningReport } from "@/lib/reports/productionPlanning";
import { getBatchBalanceReport } from "@/lib/reports/batchBalance";
import { getBatchLedgerReport } from "@/lib/reports/batchLedger";
import { getProcessOrderTimingReport } from "@/lib/reports/processOrderTiming";
// Ported from Eastland: Sale Order → Plan → Lab → Process Order → Dispatch → Invoice
import { getIsoTimelineReport } from "@/lib/reports/isoTimeline";
import { getPendingReport } from "@/lib/reports/pendingReport";
import { getSalesTeamMisReport } from "@/lib/reports/salesTeamMis";
import { getRMCReport } from "@/lib/reports/rmc";
import { getFundsFlowReport } from "@/lib/reports/fundsFlow";
import { getFundsPositionReport } from "@/lib/reports/fundsPosition";
import { getSavedAccountOrder } from "@/lib/reports/accountOrder";
import { getCustomerMarginReport } from "@/lib/reports/customerMargin";
import { getChecksInHandReport } from "@/lib/reports/checksInHand";
import { getFixedAssetRegister, getFixedAssetMovement, getFixedAssetSchedule, getFixedAssetDisposals } from "@/lib/reports/fixedAssets";
import { getHrReport } from "@/lib/reports/hr";
import { hrReportKey } from "@/lib/hr/reports/catalog";
import { getMaterialProcurementReport, calculateMaterialProcurementSummary } from "@/lib/reports/materialProcurement";
import { getProductionSetup, isFinishedCategory } from "@/lib/production/setup";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { requirePermission } from "@/lib/auth/permissions";
import { setAuditActor } from "@/lib/audit/context";
import { applyReportScope, ScopeChoiceRequired } from "@/lib/auth/reportScope";
import { scopedSalesPersons } from "@/lib/auth/salesScope";
import { buildLedgerRows, ledgerDrCr, wantsLedgerDetail } from "@/lib/reports/ledgerDetail";
import { attachItemInfo } from "@/lib/reports/itemInfo";
import { expandItemRows, mergeVoucherLines } from "@/lib/reports/accountLedgerSummary";
import { withSubAccounts, summariseBySubAccount } from "@/lib/reports/subAccountLedger";
import { feature } from "@/lib/features/server";
import { getPriorMonthReturns } from "@/lib/costing/saleReturnCost";
import { isBlendedCosting } from "@/lib/costing/issueRate";
import { getCcComponents } from "@/lib/costing/ccRates";
import { ccCategoryIdsFor } from "@/lib/costing/ccPolicy";
import { getPendingByItem, getPendingStockMoves } from "@/lib/stock/pendingApprovals";
import { getPosReport } from "@/lib/reports/pos";
import { getReturnablePackingReport as getReturnablePackingBalances, returnablePackingSummary } from "@/lib/reports/returnablePacking";
import { attachServices, serviceCategoryColumns, servicesByItem } from "@/lib/service/landedCost";
import { linkedIssuesFor } from "@/lib/items/processLink";

// ─────────────────────────────────────────────────────────────────────────────
//  Journal Voucher posting (tran_code 3) — GL accounts from Finance → Account
//  Settings (lib/accounts/accountSettingDefs.js):
//    conversion_cost : credited by the COGM voucher (required)
//    cogs            : debited by the COGS voucher (required)
//    stock_lost      : Direct Material Issuance Dr for Cleaning issuances
//    qc_cost         : Direct Material Issuance Dr for Lab / QC issuances
//  stock_lost / qc_cost are optional settings — while one is unset the JV that
//  needs it is refused (422) instead of posting to no account.
//  Item stock sides use each item's stock account (category stock_acno →
//  'stock' default), the same rule as a Material Issue line.
// ─────────────────────────────────────────────────────────────────────────────

// Party groups (customers / vendors) come from Account Settings. An empty group
// matches no account — Prisma.join cannot take an empty list.
const macnoInSql = (macnos) => Prisma.join(macnos.length ? macnos : [-1]);

function normalizeDateStr(dateStr) {
  if (typeof dateStr !== "string") return dateStr;

  // Drop any time component first, e.g.
  //   "2026-06-03 11:54:00"  or  "2026-06-03T11:54:00"  ->  "2026-06-03"
  //   "03-06-2026 11:54:00"                              ->  "03-06-2026"
  const datePart = dateStr.trim().split(/[ T]/)[0];

  const parts = datePart.split("-");
  if (parts.length === 3) {
    // DD-MM-YYYY  ->  YYYY-MM-DD
    if (parts[0].length <= 2 && parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    }
    // YYYY-MM-DD (already ISO) -> keep, but zero-pad month/day
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    }
  }

  return datePart;
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST — Generate a Journal Voucher (tran_code 3) from a costing report.
//  Body: { action: "postJV", filters: {...same shape the UI sends to GET...} }
//  Supported reportTypes: costOfGoodsManufactured, costOfGoodsSold,
//                         directMaterialIssuanceCost
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request, { params }) {
  const { reportType } = await params;
  const config = REPORT_CONFIG[reportType];

  if (!config) {
    return NextResponse.json({ error: "Invalid report type" }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body?.action !== "postJV") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  // Rebuild the same filters object the report functions expect, from the body.
  const raw = body.filters || {};
  const filters = {};
  config.filters.forEach((filter) => {
    const value = raw[filter.name];
    if (value !== null && value !== undefined && value !== "") {
      filters[filter.name] = value;
    }
  });
  if (filters.dateFrom) {
    const d = new Date(normalizeDateStr(filters.dateFrom));
    if (!isNaN(d)) { d.setHours(0, 0, 0, 0); filters.dateFrom = d; }
  }
  if (filters.dateTo) {
    const d = new Date(normalizeDateStr(filters.dateTo));
    if (!isNaN(d)) { d.setHours(23, 59, 59, 999); filters.dateTo = d; }
  }

  const preview = body.preview === true;
  // Who may: anyone who may open the report previews; posting the JV also
  // needs the Journal Voucher right (it creates a tran_code 3 voucher).
  let session;
  try {
    ({ session } = await authorize(`report.${reportType}.view`));
    if (!preview) await requirePermission(session, "journal.create");
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }
  setAuditActor(session); // the JV's writes are attributed to this user
  // Only attach user_id if it maps to a real user — a stale JWT (e.g. after a DB
  // reseed) otherwise trips the TRANSACTIONS_MASTER_user_id_fkey constraint.
  let userId = session?.user?.id ?? null;
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: String(userId) }, select: { id: true } });
    userId = u ? u.id : null;
  }

  try {
    if (reportType === "costOfGoodsManufactured") {
      return await postCostOfGoodsManufacturedJV(filters, userId, preview);
    }
    if (reportType === "costOfGoodsSold") {
      return await postCostOfGoodsSoldJV(filters, userId, preview);
    }
    if (reportType === "directMaterialIssuanceCost") {
      return await postDirectMaterialIssuanceJV(filters, userId, preview);
    }
    return NextResponse.json(
      { error: "Journal Voucher posting is not available for this report." },
      { status: 400 }
    );
  } catch (err) {
    console.error("COG JV posting error:", err);
    // Account Settings gaps name the setting to fill in.
    if (err?.statusCode === 422) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: err?.message ?? "Failed to post Journal Voucher." },
      { status: 500 }
    );
  }
}

// ── Resolve itcd → stock account for a list of item codes ────────────────────
// Category stock_acno → 'stock' Account Settings default (resolveItemAccounts,
// tran 7). When the default is unset and some category has no stock account,
// those items are simply left out of the map so the caller lists them in
// `missing` (the preview shows them; posting is refused).
async function getStockAcnoMap(itcds) {
  const ids = [...new Set(itcds.map(Number).filter((n) => Number.isFinite(n)))];
  if (ids.length === 0) return new Map();
  try {
    const { lineAcno } = await resolveItemAccounts(ids.map((itcd) => ({ itcd })), 7);
    return new Map(Object.entries(lineAcno).map(([itcd, acno]) => [Number(itcd), Number(acno)]));
  } catch (err) {
    if (err?.statusCode !== 422) throw err;
    const items = await prisma.item.findMany({
      where: { itcd: { in: ids } },
      select: { itcd: true, itemCategories: { select: { stock_acno: true } } },
    });
    const map = new Map();
    for (const it of items) {
      const acno = it.itemCategories?.stock_acno;
      if (acno != null) map.set(Number(it.itcd), Number(acno));
    }
    return map;
  }
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ── Build ordered JV lines [{acno, acname, damt, camt}] from Dr/Cr maps ──────
function buildJVLines(debitByAcno, creditByAcno, nameMap, tag) {
  const lines = [];
  for (const [acno, amt] of debitByAcno) {
    const damt = round2(amt);
    if (damt === 0) continue;
    lines.push({ acno: Number(acno), acname: nameMap.get(Number(acno)) || `Account ${acno}`, damt, camt: 0, narration1: `${tag} auto JV` });
  }
  for (const [acno, amt] of creditByAcno) {
    const camt = round2(amt);
    if (camt === 0) continue;
    lines.push({ acno: Number(acno), acname: nameMap.get(Number(acno)) || `Account ${acno}`, damt: 0, camt, narration1: `${tag} auto JV` });
  }
  return lines;
}

// ── Preview or persist a balanced tran_code=3 voucher from Dr/Cr maps ────────
//  preview=true  → returns the proposed voucher (lines + account names +
//                  validation flags) WITHOUT writing anything.
//  preview=false → enforces every guard, then creates master + lines.
async function finalizeCogJV({ tag, rmk, period, dated, userId, debitByAcno, creditByAcno, missing = [], preview = false }) {
  // Resolve account names so the preview is human-readable.
  const acnos = [...new Set([...debitByAcno.keys(), ...creditByAcno.keys()].map(Number))];
  const accounts = acnos.length
    ? await prisma.aCNO.findMany({ where: { acno: { in: acnos } }, select: { acno: true, acname: true } })
    : [];
  const nameMap = new Map(accounts.map((a) => [Number(a.acno), a.acname]));

  const lines = buildJVLines(debitByAcno, creditByAcno, nameMap, tag);
  const totalDr = round2(lines.reduce((s, l) => s + l.damt, 0));
  const totalCr = round2(lines.reduce((s, l) => s + l.camt, 0));
  const balanced = Math.abs(totalDr - totalCr) <= 0.05;
  const uniqueMissing = [...new Set(missing)];

  // Duplicate guard — one JV per tag + period.
  const existing = await prisma.transactionsMaster.findFirst({
    where: { tran_code: 3, rmk1: `AUTO_${tag}`, rmk5: period },
    select: { tran_id: true },
  });
  const duplicateTranId = existing?.tran_id ?? null;

  const canPost = balanced && uniqueMissing.length === 0 && !duplicateTranId && lines.length > 0;

  // ── Preview mode: show the proposed voucher, persist nothing ──────────────
  if (preview) {
    return NextResponse.json(
      {
        preview: true,
        tag,
        rmk,
        period,
        dated,
        lines,
        totalDebit: totalDr,
        totalCredit: totalCr,
        balanced,
        canPost,
        missing: uniqueMissing.slice(0, 50),
        duplicateTranId,
      },
      { status: 200 }
    );
  }

  // ── Commit mode: enforce every guard before writing ───────────────────────
  if (uniqueMissing.length > 0) {
    return NextResponse.json(
      { error: "Some items have no stock account: set one on their category, or the 'Stock' default in Finance → Account Settings, before posting.", details: uniqueMissing.slice(0, 20) },
      { status: 400 }
    );
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "Nothing to post — all amounts are zero." }, { status: 400 });
  }
  if (!balanced) {
    return NextResponse.json(
      { error: `Journal Voucher is unbalanced (Dr ${totalDr.toFixed(2)} vs Cr ${totalCr.toFixed(2)}).` },
      { status: 400 }
    );
  }
  if (duplicateTranId) {
    return NextResponse.json(
      { error: `A ${tag} Journal Voucher for this period is already posted (voucher #${duplicateTranId}).`, tran_id: duplicateTranId },
      { status: 409 }
    );
  }

  const lockError = await checkPeriodLock(dated, 3, { action: "create" });
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 422 });
  }

  const master = await prisma.transactionsMaster.create({
    data: { tran_code: 3, dated, time: dated, check_date: dated, rmk, rmk1: `AUTO_${tag}`, rmk5: period, user_id: userId },
    select: { tran_id: true, vr_no: true },
  });
  await prisma.transactions.createMany({
    data: lines.map((l) => ({ tran_id: master.tran_id, sub_tran_id: 1, acno: l.acno, damt: l.damt, camt: l.camt, narration1: l.narration1 })),
  });

  return NextResponse.json(
    { message: `${tag} Journal Voucher posted successfully.`, vr_no: master.vr_no, tran_id: master.tran_id, totalDebit: totalDr, totalCredit: totalCr, lineCount: lines.length },
    { status: 201 }
  );
}

// ── COGM JV: Dr FG stock account (net) / Cr RM stock account (rm) + Cr conversion_cost (cc) ─
async function postCostOfGoodsManufacturedJV(filters, userId, preview = false) {
  // Always compute the summary view — its rows carry the material breakdown.
  const data = await getCostOfGoodsManufacturedReport({ ...filters, viewMode: "summary" });
  const rows = data.filter((r) => r.view_type === "summary");
  if (rows.length === 0) {
    return NextResponse.json({ error: "No production cost data to post for the selected period." }, { status: 400 });
  }

  const rowMaterials = rows.map((r) => {
    try { return JSON.parse(r.material_details || "[]"); } catch { return []; }
  });
  const matItcds = rowMaterials.flat().map((m) => m.material_itcd);
  const acnoMap = await getStockAcnoMap([...rows.map((r) => r.mm_no), ...matItcds]);

  const debitByAcno = new Map();  // produced item stock_acno → net cost
  const creditByAcno = new Map(); // RM stock_acno → rm cost (+ CC account below)
  const missing = [];
  let totalCC = 0;

  rows.forEach((r, i) => {
    // Use the SAME figures the report displays so the JV total matches exactly.
    const producedAcno = acnoMap.get(Number(r.mm_no));
    const rmCost = round2(Number(r.rm_cost || 0));
    const cc = round2(Number(r.cc_cost || 0));
    const net = round2(rmCost + cc);
    totalCC += cc;

    // Debit every produced item (finished AND semi-finished) to its own stock GL.
    if (producedAcno == null) { missing.push(`Produced item ${r.mm_no} (${r.mm_description || ""})`); }
    else if (net !== 0) debitByAcno.set(producedAcno, (debitByAcno.get(producedAcno) || 0) + net);

    // Credit RM: distribute this row's rm_cost across its material stock
    // accounts in proportion to each material's cost, so the credits sum to
    // EXACTLY rm_cost (the last material absorbs any rounding remainder).
    const mats = rowMaterials[i].filter((m) => Number(m.total_cost || 0) !== 0);
    const matSum = mats.reduce((s, m) => s + Number(m.total_cost || 0), 0);
    const allHaveAcno = mats.every((m) => acnoMap.get(Number(m.material_itcd)) != null);
    mats.forEach((m) => {
      if (acnoMap.get(Number(m.material_itcd)) == null) {
        missing.push(`Material ${m.material_itcd} (${m.material_name || ""})`);
      }
    });

    if (rmCost !== 0 && matSum > 0) {
      let allocated = 0;
      mats.forEach((m, idx) => {
        const rmAcno = acnoMap.get(Number(m.material_itcd));
        const share = (allHaveAcno && idx === mats.length - 1)
          ? round2(rmCost - allocated)
          : round2(rmCost * (Number(m.total_cost || 0) / matSum));
        allocated = round2(allocated + share);
        if (rmAcno == null) return; // recorded as missing; skip crediting
        creditByAcno.set(rmAcno, (creditByAcno.get(rmAcno) || 0) + share);
      });
    } else if (rmCost !== 0) {
      missing.push(`Produced item ${r.mm_no} (${r.mm_description || ""}) has RM cost but no material breakdown to post against`);
    }
  });

  if (totalCC !== 0) {
    const ccAcno = await requireAccount("conversion_cost");
    creditByAcno.set(ccAcno, (creditByAcno.get(ccAcno) || 0) + totalCC);
  }

  const m = parseInt(filters.month) || (new Date().getMonth() + 1);
  const y = parseInt(filters.year) || new Date().getFullYear();
  const dated = new Date(y, m, 0, 0, 0, 0, 0); // last day of the selected month

  return await finalizeCogJV({
    tag: "COGM",
    rmk: `COGM JV ${String(m).padStart(2, "0")}/${y}`,
    period: `${m}/${y}`,
    dated, userId, debitByAcno, creditByAcno, missing, preview,
  });
}

// ── COGS JV: Dr cogs (total cost) / Cr item stock account (total cost) ───────
async function postCostOfGoodsSoldJV(filters, userId, preview = false) {
  const data = await getCostOfGoodsSoldReport(filters);
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "No COGS data to post for the selected period." }, { status: 400 });
  }

  const acnoMap = await getStockAcnoMap(data.map((r) => r.product_code));
  const creditByAcno = new Map();
  const missing = [];
  let totalCost = 0;

  for (const r of data) {
    // COGS: net of earlier months' returns at their own cost (saleReturn.costAtOriginalMonth),
    // goods at the BOOK rate only: the services (GRN landed cost and the dispatch /
    // sale-return services in the report's total — costing.servicesInCost) were
    // posted to their expense accounts by their Service Invoices, so none of them
    // is credited to stock here (lib/service/landedCost.js).
    const cost = Number(r.net_book_cost_amount ?? r.net_cost_amount ?? r.total_cost_amount ?? 0);
    if (cost === 0) continue;
    const acno = acnoMap.get(Number(r.product_code));
    if (acno == null) { missing.push(`Item ${r.product_code} (${r.product_name || ""})`); continue; }
    creditByAcno.set(acno, (creditByAcno.get(acno) || 0) + cost);
    totalCost += cost;
  }

  // Debit the COGS account (Account Settings) with the same total that was credited.
  // A stock account whose returns outweigh its cost is debited instead (and
  // COGS credited when the whole period nets negative) — never a negative amount.
  const debitByAcno = new Map();
  for (const [acno, amt] of [...creditByAcno]) {
    if (amt < 0) { creditByAcno.delete(acno); debitByAcno.set(acno, (debitByAcno.get(acno) || 0) - amt); }
  }
  if (totalCost > 0) debitByAcno.set(await requireAccount("cogs"), (debitByAcno.get(await requireAccount("cogs")) || 0) + totalCost);
  else if (totalCost < 0) creditByAcno.set(await requireAccount("cogs"), (creditByAcno.get(await requireAccount("cogs")) || 0) - totalCost);
  const dated = filters.dateTo ? new Date(filters.dateTo) : new Date();

  return await finalizeCogJV({
    tag: "COGS",
    rmk: `COGS JV ${format(dated, "dd-MM-yyyy")}`,
    period: format(dated, "yyyy-MM"),
    dated, userId, debitByAcno, creditByAcno, missing, preview,
  });
}

// ── Direct Material Issuance report ──────────────────────────────────────────
// tran_code=7 (Material Issue) issuances that are NOT linked to a production
// plan. rmk5 holds the production-plan id (a PURE integer like "111111") when
// linked; for directly-posted issuances it is null/empty or a TEXT label such
// as "Cleaning Adj" or "Lab Sample 5". Rule: include when rmk5 is null/empty or
// NOT a pure integer (i.e. it is text — even if the text contains digits). Each
// item's cost = issued qty × blended cost rate (material_issuance_rate) from the
// Stock Activity With Rate report for the same month.
export async function getDirectMaterialIssuanceCostReport(filters = {}) {
  const m = parseInt(filters.month) || (new Date().getMonth() + 1);
  const y = parseInt(filters.year) || new Date().getFullYear();
  const dateFrom = new Date(y, m - 1, 1, 0, 0, 0, 0); // first day of the chosen month (was the next month's: an empty, reversed range)
  const dateTo = new Date(y, m, 0, 23, 59, 59, 999); // last day of month (for rate sub-report)
  console.log("m: ", m)
  console.log("y:", y)
  // Directly-posted T7 issuances grouped per item. Filter by the CALENDAR month
  // of the stored `dated` (EXTRACT) so "June" = June 1..June 30 exactly, with no
  // server-timezone shift. Only Cleaning / Lab-QC text labels are kept.
  const rows = await prisma.$queryRaw`
    SELECT
      t.itcd                       AS product_code,
      COALESCE(i.item, 'Unknown')  AS product_name,
      CASE
        WHEN tm.rmk5 ILIKE 'Clean%'                        THEN 'cleaning'
        WHEN tm.rmk5 ILIKE 'Lab%' OR tm.rmk5 ILIKE '%qc%'  THEN 'qc'
        ELSE 'other'
      END                          AS issuance_type,
      COALESCE(SUM(t.qty), 0)      AS issue_qty,
      COALESCE(SUM(t.damt), 0)     AS posted_amount,
      COUNT(DISTINCT tm.tran_id)   AS tran_count
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    LEFT JOIN "Item" i ON i.itcd = t.itcd
    WHERE tm.tran_code = 7
      AND EXTRACT(YEAR FROM tm.dated) = ${y}
      AND EXTRACT(MONTH FROM tm.dated) = ${m}
      AND t.sub_tran_id = 1
      AND t.qty > 0
      AND t.itcd IS NOT NULL
      -- Only Cleaning and Lab/QC issuances (matches the CASE above). This also
      -- excludes plan-linked rows (numeric rmk5), null/empty rmk5, and any other
      -- text — those 'other' rows are dropped entirely.
      AND (
        tm.rmk5 ILIKE 'Clean%'
        OR tm.rmk5 ILIKE 'Lab%'
        OR tm.rmk5 ILIKE '%qc%'
      )
    GROUP BY t.itcd, i.item, issuance_type
    ORDER BY product_name ASC;
  `;

  console.log(rows)

  if (rows.length === 0) {
    return [];
  }

  // Blended cost rate per item from Stock Activity With Rate (same month).
  // Defensive: if the rate sub-report fails, still return the issuance rows
  // (rates default to 0) instead of failing the whole endpoint.
  let rateMap = new Map();
  try {
    const rateData = await getStockActivityWithRateReport({ dateFrom, dateTo, viewMode: "summary" });
    rateMap = new Map(
      (rateData || []).map((r) => [Number(r.product_code), Number(r.material_issuance_rate || 0)])
    );
  } catch (e) {
    console.error("[directMaterialIssuanceCost] rate lookup failed:", e?.message || e);
  }

  const TYPE_LABEL = { cleaning: "Cleaning", qc: "Lab / QC", other: "Other" };

  return rows.map((r) => {
    const issue_qty = Number(r.issue_qty || 0);
    const blended_rate = rateMap.get(Number(r.product_code)) || 0;
    const issuance_type = r.issuance_type || "other";
    return {
      product_code: Number(r.product_code),
      product_name: r.product_name,
      issuance_type,
      issuance_type_label: TYPE_LABEL[issuance_type] || "Other",
      issue_qty,
      blended_rate,
      total_cost_amount: round2(issue_qty * blended_rate),
      posted_amount: Number(r.posted_amount || 0),
      tran_count: Number(r.tran_count || 0),
    };
  });
}

function calculateDirectMaterialIssuanceCostSummary(data) {
  return {
    total_items: data.length,
    total_qty: data.reduce((s, r) => s + (r.issue_qty || 0), 0),
    total_cost: round2(data.reduce((s, r) => s + (r.total_cost_amount || 0), 0)),
  };
}

// ── Direct Material Issuance JV ──────────────────────────────────────────────
//   Cr each item's stock account (raw material leaving stock)
//   Dr 'stock_lost' for Cleaning issuances, Dr 'qc_cost' for Lab/QC
//   (Finance → Account Settings).
// Rows whose rmk5 text is neither cleaning nor lab/qc ('other') have no mapped
// debit account, so they are flagged in `missing` and block the post. A type
// whose setting is unset refuses the post (422) naming the setting; the
// preview lists it in `missing`.
async function postDirectMaterialIssuanceJV(filters, userId, preview = false) {
  const data = await getDirectMaterialIssuanceCostReport(filters);
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "No directly-posted material issuances to cost for the selected period." }, { status: 400 });
  }

  const DR_SETTING_BY_TYPE = { cleaning: "stock_lost", qc: "qc_cost" };
  const DR_ACNO_BY_TYPE = {
    cleaning: await getAccount("stock_lost"),
    qc: await getAccount("qc_cost"),
  };
  const unsetSettings = new Set();

  const acnoMap = await getStockAcnoMap(data.map((r) => r.product_code));
  const creditByAcno = new Map(); // item stock_acno → cost (raw material out)
  const debitByAcno = new Map();  // Stock Lost / QC Cost → cost, per issuance type
  const missing = [];

  for (const r of data) {
    // COGS: net of earlier months' returns at their own cost (saleReturn.costAtOriginalMonth);
    // rows without net_cost_amount (feature off / COGM) use total_cost_amount as before
    const cost = Number(r.net_cost_amount ?? r.total_cost_amount ?? 0);
    if (cost === 0) continue;

    const drAcno = DR_ACNO_BY_TYPE[r.issuance_type];
    const drSetting = DR_SETTING_BY_TYPE[r.issuance_type];
    if (drAcno == null && drSetting) {
      unsetSettings.add(drSetting);
      missing.push(accountSettingError(drSetting).message);
      continue;
    }
    if (drAcno == null) {
      missing.push(`Issuance type "${r.issuance_type_label || r.issuance_type}" for item ${r.product_code} (${r.product_name || ""}) has no debit account mapping`);
      continue;
    }
    const crAcno = acnoMap.get(Number(r.product_code));
    if (crAcno == null) {
      missing.push(`Item ${r.product_code} (${r.product_name || ""}) has no stock account (category or 'Stock' default)`);
      continue;
    }

    debitByAcno.set(drAcno, (debitByAcno.get(drAcno) || 0) + cost);
    creditByAcno.set(crAcno, (creditByAcno.get(crAcno) || 0) + cost);
  }

  if (unsetSettings.size && !preview) {
    throw accountSettingError([...unsetSettings][0]);
  }

  const m = parseInt(filters.month) || (new Date().getMonth() + 1);
  const y = parseInt(filters.year) || new Date().getFullYear();
  const dated = new Date(y, m, 0, 0, 0, 0, 0); // last day of the selected month

  return await finalizeCogJV({
    tag: "MATISS",
    rmk: `Material Issuance JV ${String(m).padStart(2, "0")}/${y}`,
    period: `${m}/${y}`,
    dated, userId, debitByAcno, creditByAcno, missing, preview,
  });
}

export async function GET(request, { params }) {
  const { reportType } = await params;
  const config = REPORT_CONFIG[reportType];

  if (!config) {
    return NextResponse.json({ error: "Invalid report type" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);

  // Extract pagination parameters
  const page = parseInt(searchParams.get("page")) || 1;
  const limit = parseInt(searchParams.get("limit")) || 10;
  const offset = (page - 1) * limit;

  // Extract search parameters
  const search = searchParams.get("search") || "";
  const searchColumn = searchParams.get("searchColumn") || "";

  // Extract sorting parameters
  const sortBy = searchParams.get("sortBy") || "";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  // Extract filters
  const filters = {};
  config.filters.forEach((filter) => {
    const value = searchParams.get(filter.name);
    if (value !== null && value !== "") {
      filters[filter.name] = value;
    }
  });

  // Normalize date filters to full-day BOUNDARIES so time components never
  // cause records to be missed:
  //   dateFrom → 00:00:00.000 (start of that day)
  //   dateTo   → 23:59:59.999 (end of that day)
  // Stored as Date objects; every downstream query wraps them in `new Date(...)`
  // (cloning a Date is safe) and any extra setHours/setUTCHours just re-applies
  // the same boundary.
  if (filters.dateFrom) {
    const d = new Date(normalizeDateStr(filters.dateFrom));
    if (!isNaN(d)) { d.setHours(0, 0, 0, 0); filters.dateFrom = d; }
  }
  if (filters.dateTo) {
    const d = new Date(normalizeDateStr(filters.dateTo));
    if (!isNaN(d)) { d.setHours(23, 59, 59, 999); filters.dateTo = d; }
  }

  // Reports were the widest hole in the system: middleware only required a
  // session on /api/*, so anyone signed in could read any report by URL. Each
  // report is now a permission of its own, and the filters are narrowed to the
  // caller's data scope before a single query runs.
  // Hoisted: a few reports narrow their own rows to the signed-in person
  // (Sales Team MIS shows a sales person only their own customers), so the
  // session has to outlive this block.
  let session = null;
  try {
    ({ session } = await authorize(`report.${reportType}.view`));
    await applyReportScope({ session, reportType, config, filters });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    if (error instanceof ScopeChoiceRequired) {
      return NextResponse.json(
        { error: error.message, options: error.options, filter: error.filter },
        { status: 400 },
      );
    }
    throw error;
  }

  //Get dynamic columns based on filters
  let currentColumns = config.getColumns
    ? config.getColumns(filters)
    : config.columns || [];

  // Add pagination, search, and sort to filters
  const queryOptions = {
    ...filters,
    pagination: {
      page,
      limit,
      offset,
    },
    search: {
      term: search,
      column: searchColumn,
      searchableColumns: getSearchableColumns(currentColumns),
    },
    sort: {
      column: sortBy,
      order: sortOrder,
      sortableColumns: getSortableColumns(currentColumns),
    },
  };

  try {
    let data = [];
    let summary = {};
    let totalRecords = 0;
    let qcParamsResult = null;

    // HR reports (lib/hr/reports/catalog.js) share one case: "hr".
    switch (hrReportKey(reportType) ? "hr" : reportType) {
      case "hr": {
        // Each also needs its HR right and stays inside the employees the
        // session may see (lib/reports/hr.js). A refusal or a bad period is
        // answered as such, not as a 500.
        try {
          const result = await getHrReport(reportType, filters, session);
          data = result.data;
          summary = result.summary;
          // Leave taken has one column per leave type used (config.apiColumns).
          currentColumns = result.columns;
        } catch (error) {
          const res = authErrorResponse(error);
          if (res) return res;
          if (error?.status && error.status < 500) {
            return NextResponse.json({ error: error.message }, { status: error.status });
          }
          throw error;
        }
        break;
      }

      case "purchase": {
        const includeReturns = filters.includeReturns === true || filters.includeReturns === "true";
        if (includeReturns) {
          const [purchaseData, returnData] = await Promise.all([
            getPSTransactionReport({
              tran_code: 4,
              type: "",
              filters,
              amountField: "damt",
              accountLabel: "vendor",
            }),
            getPSTransactionReport({
              tran_code: 9,
              type: "",
              filters,
              amountField: "camt",
              accountLabel: "vendor",
            }),
          ]);
          data = [...purchaseData, ...returnData];
          const purchaseSummary = calculatePSTransactionSummary("", purchaseData, "damt");
          const returnSummary = calculatePSTransactionSummary("", returnData, "camt");
          summary = {
            total_purchase_qty: purchaseSummary.total_qty || 0,
            total_purchase_return_qty: returnSummary.total_qty || 0,
            total_qty: (purchaseSummary.total_qty || 0) - (returnSummary.total_qty || 0),
            total_gross_amount: (purchaseSummary.total_gross_amount || 0) - (returnSummary.total_gross_amount || 0),
            total_tax: (purchaseSummary.total_tax || 0) - (returnSummary.total_tax || 0),
            total_amount: (purchaseSummary.total_amount || 0) - (returnSummary.total_amount || 0),
          };
        } else {
          data = await getPSTransactionReport({
            tran_code: 4,
            type: "",
            filters,
            amountField: "damt",
            accountLabel: "vendor",
          });
          summary = calculatePSTransactionSummary("", data, "damt");
        }
        break;
      }
      case "sale":
        // A sales person sees only their own customers (+ team with salesTeam.viewTeam);
        // ADMIN/ACCOUNTANT and salesTeam.viewAll see everyone's
        // (lib/auth/salesScope.js). The filter can narrow, never widen.
        const saleSalesPersons = await scopedSalesPersons(session, filters.sale_person);
        const saleFilters = {
          ...filters,
          sale_person: saleSalesPersons ? saleSalesPersons.join(",") : undefined,
        };
        // Check if the user wants to include sales returns as well
        const includeReturns = filters.includeReturns === true || filters.includeReturns === "true";
        if (includeReturns) {
          // Fetch sales data (tran_code 6) and sales return data (tran_code 10)
          const [salesData, salesReturnData] = await Promise.all([
            getPSTransactionReport({
              tran_code: 6,
              type: "",
              // filters,
              filters: saleFilters,
              amountField: "camt",
              accountLabel: "customer",
            }),
            getPSTransactionReport({
              tran_code: 10,
              type: "",
              // filters,
              filters: saleFilters,
              amountField: "damt",
              accountLabel: "customer",
            })
          ]);
          // Combine data arrays
          data = [...salesData, ...salesReturnData];
          // Compute individual summaries
          const salesSummary = calculatePSTransactionSummary("", salesData, "camt");
          const salesReturnSummary = calculatePSTransactionSummary("", salesReturnData, "damt");
          // Merge summaries (summing numeric fields)
          summary = {
            total_qty: (salesSummary.total_qty || 0) - (salesReturnSummary.total_qty || 0),
            total_gross_amount: (salesSummary.total_gross_amount || 0) - (salesReturnSummary.total_gross_amount || 0),
            total_tax: (salesSummary.total_tax || 0) - (salesReturnSummary.total_tax || 0),
            total_amount: (salesSummary.total_amount || 0) - (salesReturnSummary.total_amount || 0),
          };
        } else {
          // Original behavior: fetch only sales data
          data = await getPSTransactionReport({
            tran_code: 6,
            type: "",
            // filters,
            filters: saleFilters,
            amountField: "camt",
            accountLabel: "customer",
          });
          summary = calculatePSTransactionSummary("", data, "camt");
        }
        break;

      case "purchaseReturn":
        data = await getPSTransactionReport({
          tran_code: 9,
          type: "",
          filters,
          amountField: "camt",
          accountLabel: "vendor",
        });
        summary = calculatePSTransactionSummary("", data, "camt");
        break;

      case "saleReturn":
        data = await getPSTransactionReport({
          tran_code: 10,
          type: "",
          filters,
          amountField: "damt",
          accountLabel: "customer",
        });
        summary = calculatePSTransactionSummary("", data, "damt");
        break;
      case "purchaseOrder":
        data = await getOrderTransactionReport(4, filters);
        summary = calculateOrderSummary(data);
        break;

      case "dailyDispatch":
        data = await getDailyDispatchReport(filters);
        summary = calculateDailyDispatchSummary(data);
        break;
      case "serviceOrder":
        data = await getOrderTransactionReport(5, filters);
        summary = calculateOrderSummary(data);
        break;
      case "serviceEntry":
        data = await getTransactionReport(20, filters);
        summary = calculateTransactionSummary(data);
        break;
      case "serviceInvoice":
        data = await getTransactionReport(21, filters);
        summary = calculateTransactionSummary(data);
        break;
      case "saleOrder":
        data = await getOrderTransactionReport(6, filters);
        summary = calculateOrderSummary(data);
        break;
      case "saleOrderToDispatch": {
        data = await getSaleOrderToDispatchReport(filters);
        summary = calculateSaleOrderToDispatchSummary(data);
        break;
      }  

       case "materialprocurementenquiry":
        data = await getMaterialProcurementEnquiryReport(filters);
        break;

        case "materialprocurement": {
        data = await getMaterialProcurementReport(filters);
        summary = calculateMaterialProcurementSummary(data);
        break;
      }

      case "grn": // Goods Receipt Note
        data = await getPurchaseReport("grn", filters);
        summary = calculatePurchaseSummary("grn", data);
        break;
      
      // Exbond Report: the GRN Report limited to LC vendors (the 'LC / Import
      // Accounts' group in Finance → Account Settings; empty group → no rows)
      case "exbondReport": {
        const lcMacnos = await getAccountGroup("lc_accounts");
        data = await getPurchaseReport("grn", { ...filters, vendorMacnos: lcMacnos.length ? lcMacnos : [-1] });
        summary = calculatePurchaseSummary("grn", data);
        break;
      }

      case "grnReturn": // Goods Receipt Note Return
        // data = await getGrnReturnReport("grnReturn", filters);
        // summary = calculateGrnReturnSummary("grnReturn", data);
        data = await getGrnReturnReport(filters);
        summary = calculateGrnReturnSummary(data);
        break;
      case "dispatch":
        // "Without Rate" ticked → only dispatches with no invoice number yet
        data = await getSaleReport("dispatch", {
          ...filters,
          uninvoicedOnly: filters.withoutRate === true || filters.withoutRate === "true",
          // Sales person → own customers only (lib/auth/salesScope.js)
          // salesPersonScope: await scopedSalesPersons(session, filters.sale_person),
        });
        summary = calculateSaleSummary("dispatch", data);
        break;
      // Same as Dispatch, limited to dispatches with no invoice number yet
      case "dispatchWithoutRates":
        // data = await getSaleReport("dispatch", { ...filters, uninvoicedOnly: true });
        data = await getSaleReport("dispatch", {
          ...filters,
          uninvoicedOnly: true,
          // salesPersonScope: await scopedSalesPersons(session, filters.sale_person),
        });
        summary = calculateSaleSummary("dispatch", data);
        break;
      case "dispatchReturn":
        data = await getDispatchReturnReport(filters);
        summary = calculateDispatchReturnSummary(data);
        break;
      case "stock":
        data = await getStockReport(filters);
        // "Show Zero Stock" is ticked by default (config). Zero-stock items
        // are hidden only when it is unticked. (FG Stock shares
        // getStockReport and is not affected.)
        if (filters.showZeroStock === false || filters.showZeroStock === "false") {
          data = data.filter((r) => Number(r.actualStock) !== 0);
        }
        summary = calculateStockSummary(data);
        break;
      case "fgstock":
        data = await getStockReport(filters);
        summary = calculateStockSummary(data);
        break;
      case "fgdailystock":
        data = await getFGDailyUpdate(filters);
        summary = calculateFGDailyUpdateSummary(data);
        break;
      case "stockMetrics":
        data = await getStockMetricsReport(filters);
        summary = calculateStockMetricsSummary(data);
        break;
      case "stockActivity": {
        // Godown Wise adds a dynamic IN/OUT column pair per godown that moved
        // stock in the period — same mechanism as accountsActivity's month columns.
        const stockActivity = await getStockActivityReportWithColumns(filters);
        data = stockActivity.rows;
        if (stockActivity.columns) {
          currentColumns = [...currentColumns, ...stockActivity.columns];
        }
        summary = calculateStockActivitySummary(data);
        break;
      }
      case "stockActivityView":
        data = await getStockActivityViewReport(filters);
        summary = calculateStockActivityViewSummary(data);
        break;
      case "stockActivityWithRate":
        // The screen only: an in-process item's rate takes in its production
        // item's production (inProcessRate). Month-end opening (lib/
        // openingStockGenerate.js) and COGS call without it — unchanged.
        // "Purchase amounts" filter (amountBasis): gross (default) = before
        // sales tax; net = with it, as the Purchase report's Net Amount and the
        // old ERP — screen only, like inProcessRate (openings / COGS: gross).
        data = await getStockActivityWithRateReport({
          ...filters,
          inProcessRate: true,
          withTax: String((filters.amountBasis && typeof filters.amountBasis === "object" ? filters.amountBasis.value : filters.amountBasis) || "").toLowerCase() === "net",
        });
        summary = calculateStockActivityWithRateSummary(data);
        break;

      case "costOfGoodsSold":
        data = await getCostOfGoodsSoldReport(filters);
        summary = calculateCOGSSummary(data);
        break;

      // Data Checking Report = the COGS figures without the margin columns
      // (components/Reports/config.js, dataChecking): same rows, no margin totals.
      case "dataChecking": {
        const MARGIN_KEYS = ["margin_rate", "margin_amount", "gross_margin_pct", "gross_profit_rate", "gross_profit_amount", "gross_profit_pct"];
        data = (await getCostOfGoodsSoldReport(filters)).map((r) => {
          const row = { ...r };
          for (const k of MARGIN_KEYS) delete row[k];
          return row;
        });
        const {
          total_margin: _m, avg_gross_margin: _mp, total_gross_profit: _gp, avg_gross_profit_pct: _gpp, // eslint-disable-line no-unused-vars
          ...rest
        } = calculateCOGSSummary(data);
        summary = rest;
        break;
      }

      case "costOfGoodsManufactured":
        data = await getCostOfGoodsManufacturedReport(filters);
        summary = calculateCOGMSummary(data);
        break;

      case "directMaterialIssuanceCost":
        data = await getDirectMaterialIssuanceCostReport(filters);
        summary = calculateDirectMaterialIssuanceCostSummary(data);
        break;

      case "stockLedger":
        data = await getStockLedgerReport(filters);
        summary = calculateStockLedgerSummary(data);
        break;
      // Point of sale (lib/reports/pos.js) — a cashier sees only their own till.
      case "posTransactions":
      case "posDailySales":
      case "posSalesByItem":
      case "posSalesByPayment":
      case "posSalesByCashier":
      case "posReturns": {
        ({ data, summary } = await getPosReport(reportType, filters, session));
        break;
      }
      case "tradingMargin":
        data = await getTradingMarginReport(filters);
        summary = calculateTradingMarginSummary(data);
        break;
      // Summary stays voucher-level in both views, so the totals shown do not
      // change when the user switches to the grouped detail view.
      case "payment": {
        const vouchers = await getTransactionReport(2, filters);
        summary = calculateTransactionSummary(vouchers);
        data = wantsVoucherDetailRows(filters)
          ? toVoucherDetailRows(vouchers)
          : vouchers;
        break;
      }
      case "receipt": {
        const vouchers = await getTransactionReport(1, filters);
        summary = calculateTransactionSummary(vouchers);
        data = wantsVoucherDetailRows(filters)
          ? toVoucherDetailRows(vouchers)
          : vouchers;
        break;
      }
      case "journal": {
        const vouchers = await getTransactionReport(3, filters);
        summary = calculateTransactionSummary(vouchers);
        data = wantsVoucherDetailRows(filters)
          ? toVoucherDetailRows(vouchers)
          : vouchers;
        break;
      }
      case "materialProduction":
        data = await getMaterialProductionReport(filters);
        summary = calculateMaterialProductionSummary(data);
        break;
      case "materialIssuance":
        data = await getMaterialIssuanceReport(filters);
        summary = calculateMaterialIssuanceSummary(data);
        break;
      case "materialTransfer":
        data = await getMaterialTransferReport(filters);
        summary = calculateMaterialTransferSummary(data);
        break;

         case "importedMaterialinTransit":
        data = await getImportedMaterialInTransitReport(filters);
        summary = calculateImportedMaterialInTransitSummary(data);
        break;

              case "importedMaterialStock":
        data = await getImportedMaterialStockReport(filters);
        summary = calculateImportedMaterialStockSummary(data);
        break;

      case "importedMaterialDeals":
        data = await getImportedMaterialDealsReport(filters);
        summary = calculateImportedMaterialDealsSummary(data);
        break;

      case "processOrderReconciliation": {
        const report = await getProcessOrderReconciliationData(filters);
        data = report.rows;
        summary = report.summary;
        break;
      }
      case "accountLedger":
        data = await getAccountLedger(filters);
        // Sub Accounts (feature "vouchers.subAccounts"): column, filter and the
        // Summary by Sub Account view. Off → the plain ledger, filter / view ignored.
        if (await feature("vouchers.subAccounts")) {
          data = await withSubAccounts(data, filters.subAccount);
          summary = calculateAccountLedgerSummary(data);
          const view = filters.viewMode && typeof filters.viewMode === "object" ? filters.viewMode.value : filters.viewMode;
          if (view === "summary") data = await summariseBySubAccount(data);
        } else {
          summary = calculateAccountLedgerSummary(data);
        }
        break;
      case "accountLedgerSummary": {
        // Invoice / return items as columns (lib/reports/accountLedgerSummary.js).
        // Summary (default): one row per voucher. Detailed: one row per voucher
        // line, as the Account Ledger's Detailed view. The summary is taken
        // before the item rows are added — they carry no balance.
        const lines = await getAccountLedger(filters);
        const base = wantsLedgerDetail(filters) ? lines : mergeVoucherLines(lines);
        summary = calculateAccountLedgerSummary(base);
        data = await expandItemRows(base);
        break;
      }
        case "cbBook": {
        // No account picked = all cash & bank accounts (Finance → Account
        // Settings "Cash / Bank" groups), each as its own block.
        const picked = Array.isArray(filters.account) ? filters.account.filter(Boolean) : String(filters.account ?? "").split(",").filter(Boolean);
        if (!picked.length) {
          const macnos = await getCashBankMacnos();
          const accounts = await prisma.aCNO.findMany({ where: { macno: { in: macnos } }, select: { acno: true }, orderBy: { acno: "asc" } });
          filters.account = accounts.map((a) => a.acno);
        }
        data = filters.account.length ? await getAccountLedger(filters) : [];
        summary = calculateAccountLedgerSummary(data);
        break;
      }
      case "accountsActivity": {
        const activity = await getAccountActivity(filters);
        if (activity && Array.isArray(activity.columns)) {
          // Compare-months mode: dynamic net-per-month columns from the query.
          data = activity.data;
          currentColumns = activity.columns;
          summary = { total_accounts: new Set(data.map((t) => t.account)).size };
        } else {
          data = activity;
          summary = calculateAccountActivitySummary(data);
        }
        break;
      }
      case "trialBalance":
        data = await getTrialBalance(filters);
        summary = calculateTrialBalanceSummary(data);
        break;
      case "trialBalancePeriod": {
        const flatData = await getTrialBalancePeriodReport(filters);
        summary = calculateTrialBalancePeriodSummary(flatData);
        data = trialBalanceAccountRows(flatData);
        break;
      }
      case "discard":
        data = await getDiscardReport(filters);
        // summary = calculateTrialBalanceSummary(data);
        break;
      case "trialBalanceSheet": {
        const flatData = await getTrialBalanceSheetReport(filters);
        summary = calculateTrialBalancePeriodSummary(flatData);
        data = trialBalanceAccountRows(flatData);
        break;
      }
      case "monthlyBalanceSheet":
        ({ data, summary } = await getMonthlyBalanceSheetReport(filters));
        break;
      case "profitLoss": {
        const flatData = await getProfitLossReport(filters);
        summary = calculateTrialBalancePeriodSummary(flatData);
        data = trialBalanceAccountRows(flatData);
        break;
      }
      case "profitLossMonthly": {
        // P&L, one column per month (getProfitLossMonthlyReport)
        data = await getProfitLossMonthlyReport(filters);
        const sumWhere = (pred) => Number(data.filter(pred).reduce((s, r) => s + (r.total || 0), 0).toFixed(2));
        summary = {
          total_accounts: data.length,
          total_income: sumWhere((r) => Number(r.mbscd) === 4),
          total_expense: sumWhere((r) => Number(r.mbscd) === 5),
          net: sumWhere(() => true),
        };
        break;
      }
      // ── Ported from the Accounting system ──
      case "customerFile": {
        data = await getCustomerFileReport(filters);
        break;
      }
      case "dailyProduction":
        data = await getDailyProductionReport(filters);
        summary = calculateDailyProductionSummary(data);
        break;
      case "digitalInvoice": {
        data = await getDigitalInvoiceReport(filters);
        // summary = calculateDigitalInvoiceSummary(data);
        break;
      }
      case "ilfile": {
        data = await getILFileReport(filters);
        break;
      }
      case "monthWiseRMMovingAverage": {
        const result = await getMonthWiseRMMovingAverageReport(filters);
        data = result.rows;
        currentColumns = result.columns;
        summary = calculateMonthWiseRMMovingAverageSummary(data);
        break;
      }
      case "pcfile": {
        data = await getPCFileReport(filters);
        break;
      }
      case "prfile": {
        data = await getPRFileReport(filters);
        break;
      }
      case "purchasingfile": {
        data = await getPurchasingFileReport(filters);
        break;
      }
      case "rmCosting":
        data = await getRMCostingReport(filters);
        summary = calculateRMCostingSummary(data);
        break;
      case "withHoldingTax": {
        data = await getWithHoldingTaxReport(filters);
        break;
      }
      case "salesOrderBalance":
        // let rawSalesOrderData = await getOrderBalanceReport(filters);
        // A sales person sees only their own customers (+ team with salesTeam.viewTeam);
        // ADMIN/ACCOUNTANT and salesTeam.viewAll see everyone's
        // (lib/auth/salesScope.js). The filter can narrow, never widen.
        const balanceSalesPersons = await scopedSalesPersons(session, filters.sale_person);
        let rawSalesOrderData = await getOrderBalanceReport({
          ...filters,
          sale_person: balanceSalesPersons ? balanceSalesPersons.join(",") : undefined,
        });
        // Excel-style balance filters on a line's BAL (KG): "less than" and
        // "greater than" (e.g. -5). Blank or not a number → not applied.
        {
          const num = (v) => {
            if (v === undefined || v === null || String(v).trim() === "") return null;
            const n = Number(String(v).trim());
            return Number.isFinite(n) ? n : null;
          };
          const lt = num(filters.balanceLessThan);
          const gt = num(filters.balanceGreaterThan);
          if (lt !== null) rawSalesOrderData = rawSalesOrderData.filter((r) => Number(r.pendingQty) < lt);
          if (gt !== null) rawSalesOrderData = rawSalesOrderData.filter((r) => Number(r.pendingQty) > gt);
        }
        data = ORDER_BALANCE_GROUPED_VIEWS.has(filters.view)
          ? buildOrderBalanceGroupedRows(rawSalesOrderData, {
              bySalesPerson: filters.view === "groupSalesPerson",
            })
          : groupOrderBalanceByOrder(rawSalesOrderData, filters.view);
        summary = calculateOrderBalanceSummary(rawSalesOrderData);
        break;
      case "purchaseOrderBalance":
        data = await getOrderBalanceReport(filters);
        summary = calculateOrderBalanceSummary(data);
        break;
      case "bom":
        data = await getBOMReport(filters);
        summary = calculateBOMSummary(data);
        break;
      case "customerAging": {
        // A sales person sees only their own customers (+ team with salesTeam.viewTeam);
        // ADMIN/ACCOUNTANT and salesTeam.viewAll see everyone's
        // (lib/auth/salesScope.js). The filter can narrow, never widen.
        const salesPersons = await scopedSalesPersons(session, filters.sale_person);
        data = await getCustomerAgingReport({
          ...filters,
          sale_person: salesPersons ? salesPersons.join(",") : undefined,
        });
        summary = calculateAgingSummary(data);
        break;
      }
      case "vendorAging":
        data = await getVendorAgingReport(filters);
        summary = calculateAgingSummary(data);
        break;
      case "qc":
        const qcResult = await getQCReport(filters);
        data = qcResult.data || qcResult;
        summary = calculateQCSummary(data);
        // Only add STATUS column, not parameter columns (parameters are in detail view)
        if (qcResult.statusColumn) {
          currentColumns = [...currentColumns, qcResult.statusColumn];
        }
        break;
      case "orderQc":
        const orderQcResult = await getOrderQCReport(filters);
        data = orderQcResult.data || orderQcResult;
        summary = calculateOrderQCSummary(data);
        // Only add STATUS column, not parameter columns (parameters are in detail view)
        if (orderQcResult.statusColumn) {
          currentColumns = [...currentColumns, orderQcResult.statusColumn];
        }
        break;
      case "qcParameters":
        qcParamsResult = await getQCParametersReport(filters);
        data = qcParamsResult.data || [];
        summary = calculateQCSummary(data);

        // Create columns using the getColumns function with parameter columns
        currentColumns = config.getColumns ?
          config.getColumns(filters, qcParamsResult.parameterColumns || []) :
          config.columns || [];
        break;
      case "returnablePacking":
        // Customers' and vendors' returnable drums (lib/reports/returnablePacking.js).
        data = await getReturnablePackingBalances(filters);
        summary = returnablePackingSummary(data, filters);
        break;
      case "monthlyStock":
        data = await getMonthlyStockReport(filters);
        summary = calculateMonthlyStockSummary(data);
        break;
      case "batchCosting":
        data = await getBatchCostingReport(filters);
        summary = calculateBatchCostingSummary(data);
        break;
      case "monthlyStockValuation":
        data = await getMonthlyStockValuationReport(filters);
        summary = calculateMonthlyStockValuationSummary(data);
        break;

      case "stockWithCost":
        data = await getStockWithCostReport(filters);
        summary = calculateStockWithCostSummary(data);
        break;

      case "costOfSales":
        data = await getCostOfSalesReport(filters);
        summary = calculateCostOfSalesSummary(data);
        break;

      case "masterSample":
        qcParamsResult = await getMasterSampleReport(filters);
        data = qcParamsResult.data || [];
        summary = calculateMasterSampleSummary(data);

        // Create columns using the getColumns function with parameter columns
        currentColumns = config.getColumns ?
          config.getColumns(filters, qcParamsResult.parameterColumns || []) :
          config.columns || [];
        break;

      case "productionPlanning": {
        const ppResult = await getProductionPlanningReport(filters);
        data = ppResult.data;
        summary = ppResult.summary;
        break;
      }

      case "batchBalance": {
        const result = await getBatchBalanceReport({
          itcd: filters.itcd,
          godown: filters.godown,
          batch_no: filters.batch_no,
          showEmpty: filters.showEmpty === "true",
        });
        data = result.data;
        summary = result.summary;
        break;
      }

      case "batchLedger": {
        const result = await getBatchLedgerReport({
          itcd: filters.itcd,
          batch_no: filters.batch_no,
          godown: filters.godown,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        });
        data = result.data;
        summary = result.summary;
        break;
      }

      case "changelog": {
        // Browses AuditLog entries (see lib/audit/logger.js) with optional
        // filters by model, record, user, and date range. Defaults to the
        // last 7 days when no date range is given, since the table spans
        // every model globally.
        const clEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();
        const clStart = filters.dateFrom
          ? new Date(filters.dateFrom)
          : new Date(clEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

        const clWhere = {
          dated: { gte: clStart, lte: clEnd },
          ...(filters.model_name ? { model_name: { contains: filters.model_name, mode: "insensitive" } } : {}),
          ...(filters.record_id ? { record_id: String(filters.record_id) } : {}),
          ...(filters.user_id ? { user_id: String(filters.user_id) } : {}),
        };

        const clRows = await prisma.auditLog.findMany({
          where: clWhere,
          orderBy: { dated: "desc" },
        });

        data = clRows.map((r) => ({
          id: r.id,
          dated: r.dated,
          model_name: r.model_name,
          record_id: r.record_id,
          action: r.action,
          // Stringified for display in the report table (a plain grid
          // column can't render a JSON array/object as a React child);
          // the raw structured value is still in the DB for
          // programmatic use.
          changes: r.changes
            ? r.changes.map((c) => `${c.field}: ${c.old} → ${c.new}`).join("; ")
            : "",
          snapshot: r.snapshot ? JSON.stringify(r.snapshot) : "",
          user_name: r.user_name ?? "System",
        }));

        summary = {
          total: data.length,
          creates: data.filter((r) => r.action === "create").length,
          updates: data.filter((r) => r.action === "update").length,
          deletes: data.filter((r) => r.action === "delete").length,
        };
        break;
      }

      // Sale Order To Invoice Time Tracking (Features: saleOrder.planFromOrder)
      case "isoTimeline": {
        if (!(await feature("saleOrder.planFromOrder"))) {
          return NextResponse.json({ error: "Planning from the Sale Order is switched off (Settings → Features → Sale Order)." }, { status: 403 });
        }
        const result = await getIsoTimelineReport({
          ...filters,
          soDateFrom: filters.soDateFrom ? normalizeDateStr(filters.soDateFrom) : null,
          soDateTo: filters.soDateTo ? normalizeDateStr(filters.soDateTo) : null,
          session,
        });
        data = result.data;
        summary = result.summary;
        break;
      }

      // Pending Report — plan lines waiting for their Process Order (Features: production.labNature)
      case "pendingReport": {
        if (!(await feature("production.labNature"))) {
          return NextResponse.json({ error: "The Lab's Nature on plan lines is switched off (Settings → Features → Production)." }, { status: 403 });
        }
        const result = await getPendingReport(filters);
        data = result.data;
        summary = result.summary;
        break;
      }

      case "processOrderTiming": {
        const result = await getProcessOrderTimingReport({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          proc_ord_no: filters.proc_ord_no,
          lateOnly: filters.lateOnly === "true",
        });
        data = result.data;
        summary = result.summary;
        break;
      }

      case "salesTeamMis": {
        const result = await getSalesTeamMisReport({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          salesPersonIds: filters.sale_person,
          viewMode: filters.viewMode,
          viewBy: filters.viewBy,
          // Who is asking. ADMIN/ACCOUNTANT see every sales person; anyone
          // else is held to the customers assigned to them.
          session,
        });
        data = result.data;
        summary = result.summary;
        break;
      }

      case "fundsFlow": {
        // The signed-in user's own account order (Arrange accounts)
        const accountOrder = await getSavedAccountOrder("fundsFlow", session?.user?.id);
        const result = await getFundsFlowReport(filters, { accountOrder });
        data = result.data;
        summary = result.summary;
        break;
      }

      case "fundsPosition": {
        const accountOrder = await getSavedAccountOrder("fundsPosition", session?.user?.id);
        const result = await getFundsPositionReport(filters, { accountOrder });
        data = result.data;
        summary = result.summary;
        break;
      }

      case "customerMargin": {
        const result = await getCustomerMarginReport(filters);
        data = result.data;
        summary = result.summary;
        break;
      }

      case "checksInHand": {
        const result = await getChecksInHandReport(filters);
        data = result.data;
        summary = result.summary;
        break;
      }

      // Fixed assets (lib/reports/fixedAssets.js). The schedule belongs to the
      // "fixedAssets.depreciation" feature (Settings → Features).
      case "fixedAssetRegister":
      case "fixedAssetMovement":
      case "fixedAssetSchedule":
      case "fixedAssetDisposals": {
        if (reportType === "fixedAssetSchedule" && !(await feature("fixedAssets.depreciation"))) {
          return NextResponse.json({ error: "Monthly depreciation is switched off (Settings → Features → Fixed assets)." }, { status: 403 });
        }
        const fn = { fixedAssetRegister: getFixedAssetRegister, fixedAssetMovement: getFixedAssetMovement, fixedAssetSchedule: getFixedAssetSchedule, fixedAssetDisposals: getFixedAssetDisposals }[reportType];
        const result = await fn(filters);
        data = result.data;
        summary = result.summary;
        break;
      }

      case "rmc": {
        const result = await getRMCReport(filters);
        data = result.data;
        summary = result.summary;
        break;
      }

      case "salesPerformanceWeekly": {
        const result = await getSalesPerformanceWeeklyReport(filters);
        data = result.data;
        summary = result.summary;
        break;
      }

      // Same report; the plain one has Sale Cost / Margin / Margin % stripped
      // (components/Reports/config.js hides the columns too).
      case "sales_matrix_monthwise":
      case "sales_matrix_monthwise_margin": {
        // data = await getSalesMatrixMonthwiseReport(filters);
        // A sales person sees only their own customers (+ team with salesTeam.viewTeam);
        // ADMIN/ACCOUNTANT and salesTeam.viewAll see everyone's
        // (lib/auth/salesScope.js). The filter can narrow, never widen.
        const matrixSalesPersons = await scopedSalesPersons(session, filters.sale_person);
        data = await getSalesMatrixMonthwiseReport({
          ...filters,
          sale_person: matrixSalesPersons ? matrixSalesPersons.join(",") : undefined,
        });
        const yr = parseInt(filters.year) || new Date().getFullYear();
        let mFrom = parseInt(filters.monthFrom) || 1;
        let mTo = parseInt(filters.monthTo) || (new Date().getMonth() + 1);
        if (mFrom > mTo) { const tmp = mFrom; mFrom = mTo; mTo = tmp; }
        const monthsList = [];
        for (let m = mFrom; m <= mTo; m++) {
          const mStr = String(m).padStart(2, "0");
          monthsList.push({ key: `${mStr}-${yr}` });
        }
        summary = calculateSalesMatrixMonthwiseSummary(data, monthsList);
        if (reportType === "sales_matrix_monthwise") {
          const isCost = (k) => /_(sale_cost|margin|margin_pct)$/.test(k);
          const strip = (o) =>
            o && typeof o === "object"
              ? Object.fromEntries(Object.entries(o).filter(([k]) => !isCost(k)))
              : o;
          data = Array.isArray(data) ? data.map(strip) : data;
          summary = strip(summary);
        }
        break;
      }


      default:
        return NextResponse.json(
          { error: "Invalid report type" },
          { status: 400 }
        );
    }

    // "Entered by" (who keyed the document) on every row that carries its id —
    // one batched lookup for the whole report (lib/audit/enteredBy.js; the
    // reports and their column: ENTERED_BY_REPORTS in components/Reports/config.js).
    if (ENTERED_BY_REPORTS[reportType] && Array.isArray(data)) {
      await attachEnteredBy(data, ENTERED_BY_REPORTS[reportType]);
    }

    // Purchase/sale returns are fetched separately, so sort the combined
    // rows before pagination to keep the selected date order across both.
    if ((reportType === "purchase" || reportType === "sale") && Array.isArray(data)) {
      const direction = filters.dateOrder === "asc" ? 1 : -1;
      data = [...data].sort((left, right) => {
        const leftDate = new Date(left?.dated).getTime();
        const rightDate = new Date(right?.dated).getTime();
        if (!Number.isFinite(leftDate)) return Number.isFinite(rightDate) ? 1 : 0;
        if (!Number.isFinite(rightDate)) return -1;
        return (leftDate - rightDate) * direction;
      });
    }

    // Item Code / Category / Sub Category on every row that names an item —
    // one batched lookup (lib/reports/itemInfo.js); the viewer shows the ones
    // a report lacks (components/Reports/itemColumns.js).
    await attachItemInfo(prisma, reportType === "stockMetrics" ? data?.items : data);

    // Services on GRN / dispatch / sale return (freight, off-load, weighing …)
    // spread onto each row's items — one column per service used, then the
    // services total and the landed cost (purchase side) or net of services
    // (sale side). Reports with config `services` (components/Reports/config.js);
    // lib/service/landedCost.js; the viewer appends the columns.
    let extraColumns = [];
    if (config.services && Array.isArray(data)) {
      extraColumns = await attachServices(data, { side: config.services });
    }
    // Stock Activity With Rate / COGS: services split by service category, one
    // column per category used, placed in the report's own bands
    // (config.serviceCategoryColumns → serviceCategoryColumns).
    if (config.serviceCategoryColumns && Array.isArray(data)) {
      extraColumns = await serviceCategoryColumns(data, config.serviceCategoryColumns);
    }

    // Calculate pagination info
    const isSalesOrderBalanceCustomer = reportType === "salesOrderBalance" && filters.view === "customer";

    const totalPages = Math.ceil(
      reportType === "stockMetrics" ? data?.items.length : data.length / limit
    );
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Build response object
    const responseObj = {
      data:
        reportType === "stockMetrics"
          ? data?.items.slice(offset, offset + limit)
          : data?.slice(offset, offset + limit),
      summary,
      pagination: {
        currentPage: page,
        pageSize: limit,
        total: reportType === "stockMetrics" ? data?.items.length : data.length,
        totalPages,
        hasNextPage,
        hasPrevPage,
        startRecord: offset + 1,
        endRecord: Math.min(
          offset + limit,
          reportType === "stockMetrics" ? data?.items.length : data.length
        ),
      },
      allData: reportType === "stockMetrics" ? data?.items : data,
      config: {
        title: config.title,
        description: config.description,
        columns: currentColumns,
        detailColumns: config.detailColumns,
        exportOptions: config.exportOptions,
        extraColumns,
      },
    };

    // Include parameterColumns for qcParameters report
    if (reportType === "qcParameters" && qcParamsResult?.parameterColumns) {
      responseObj.parameterColumns = qcParamsResult.parameterColumns;
    }
    if (reportType === "masterSample" && qcParamsResult?.parameterColumns) {
      responseObj.parameterColumns = qcParamsResult.parameterColumns;
    }

    return NextResponse.json(responseObj);
  } catch (error) {
    console.error(`Error generating ${reportType} report:`, error);
    return NextResponse.json(
      { error: "Failed to generate report", details: error.message },
      { status: 500 }
    );
  }
}

// Helper functions
function getSearchableColumns(columns) {
  return columns
    .filter((col) => col.searchable !== false)
    .map((col) => col.field);
}

function getSortableColumns(columns) {
  return columns
    .filter((col) => col.sortable !== false)
    .map((col) => col.field);
}

// Helper functions for each report type
async function getPurchaseReport(type, filters) {

  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setHours(0, 0, 0, 0))
    : undefined;

  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999))
    : undefined;

  const includeReturns =
    filters.includeReturns === true ||
    filters.includeReturns === "true";

  const where = {
    tran_code: includeReturns
      ? { in: [4, 9] }
      : 4,
    //tran_code: 4,
    dated: {
      gte: filters.dateFrom ? startDate : undefined,
      lte: filters.dateTo ? endDate : undefined,
    },
  };

  if (filters.vendor) where.pycd = Number(filters.vendor);
  if (filters.godown) where.godown = parseInt(filters.godown);
  if (filters.po_no) where.po_no = parseInt(filters.po_no);

  // Exbond Report: only GRNs whose vendor sits under these main account
  // groups (Account Settings 'lc_accounts'). Set by the API case, not the URL.
  if (Array.isArray(filters.vendorMacnos) && filters.vendorMacnos.length) {
    where.acno = { macno: { in: filters.vendorMacnos } };
  }


  // 🔴 ITEM FILTER FIX
  if (filters.item) {
    where.transactions = {
      some: {
        itcd: parseInt(filters.item),
      },
    };
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      acno: true,
      godownDetails: true,
      transactions: {
        where: {
          ...(filters.item && { itcd: parseInt(filters.item) }),
        },
        include: {
          itemDetails: true,
          godownDetails: true,
        },
      },
    },
    orderBy: {
      // dated: "desc",
      tran_id: "desc"
    },
  });

  // ---------------------------
  // Step 1: Process individual transactions
  // ---------------------------
  const processedData = transactions.map((t) => {
    const filteredTransactions = t.transactions.filter((tran) =>
      [1, 2].includes(tran.sub_tran_id)
    );

    return {
      ...t,
      transactions: filteredTransactions,
      total_qty: filteredTransactions.reduce(
        (sum, line) => sum + (line.qty || 0),
        0
      ),
      ...(type === ""
        ? {
          total_amount: filteredTransactions.reduce(
            (sum, line) =>
              sum +
              (t.tran_code === 9
                ? (line.camt || 0)
                : (line.damt || 0)),
            0
          ),
          // total_amount: filteredTransactions.reduce(
          //   (sum, line) => sum + (line.damt || 0),
          //   0
          // ),
        }
        : {}),
    };
  });

  // ---------------------------
  // Step 2: Apply summary grouping if filters.type is set
  // ---------------------------
  if (filters.type === "vendor") {
    // Group by vendor (pycd)
    const grouped = {};

    processedData.forEach((t) => {
      const key = t.pycd;
      if (!grouped[key]) {
        grouped[key] = {
          pycd: key,
          vendorName: t.acno?.acname || "Unknown Vendor",
          total_qty: 0,
          total_amount: 0,
          transactions: [],
        };
      }

      grouped[key].total_qty += t.total_qty;
      grouped[key].total_amount += t.total_amount || 0;
      grouped[key].transactions.push(...t.transactions);
    });

    return Object.values(grouped);
  }

  if (filters.type === "product") {
    // Product Detail: break each GRN into one row per item line
    return processedData.flatMap((t) =>
      t.transactions.map((line) => ({
        ...t,
        itcd: line.itcd,
        batch_no: line.batch_no,
        transactions: [line],
        total_qty: line.qty || 0,
        total_amount:
          t.tran_code === 9
            ? (line.camt || 0)
            : (line.damt || 0),
      }))
    );
  }

  // ---------------------------
  // Step 3: Default (no grouping)
  // ---------------------------
  return processedData;
}

// ---------------------------
// Calculate overall totals (unchanged, just cleaned)
// ---------------------------
function calculatePurchaseSummary(type, data) {
  return {
    total_qty: data.reduce((sum, t) => sum + t.total_qty, 0),
    ...(type === ""
      ? {
        total_gross_amount: data.reduce(
          (sum, t) =>
            sum +
            t.transactions.reduce(
              (innerSum, line) => innerSum + (line.gross_amount || 0),
              0
            ),
          0
        ),
        total_tax: data.reduce(
          (sum, t) =>
            sum +
            t.transactions.reduce(
              (innerSum, line) => innerSum + (line.st_amount || 0),
              0
            ),
          0
        ),
        total_amount: data.reduce((sum, t) => sum + (t.total_amount || 0), 0),
      }
      : {}),
  };
}

// async function getPSTransactionReport(config) {
//   const {
//     tran_code,
//     type = "", // "vendor", "product", or ""
//     filters = {},
//     amountField = "damt", // "damt" or "camt"
//     accountFilterField = "pycd", // Field name for vendor/customer filter
//     accountLabel = "vendor", // "vendor" or "customer"
//   } = config;

//   const where = {
//     tran_code: Array.isArray(tran_code) ? { in: tran_code } : tran_code,
//     dated: {
//       gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
//       lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
//     },
//   };

//   const whereTransactions = {};

//   // Apply account filter (vendor/customer)
//   if (filters[accountLabel]) {
//     where[accountFilterField] = Number(filters[accountLabel]);
//   }

//   // Apply other filters
//   if (filters.godown && filters.godown !== "all") where.godown = parseInt(filters.godown);
//   if (filters.po_no && filters.po_no !== "all") where.po_no = parseInt(filters.po_no);
//   if (filters.so_no && filters.so_no !== "all") where.so_no = parseInt(filters.so_no);
//   if (filters.dispatch_no && filters.dispatch_no !== "all") where.dispatch_no = parseInt(filters.dispatch_no);
//   if (filters.invoice_no && filters.invoice_no !== "all") where.invoice_no = filters.invoice_no;

//   if (filters.type === "invoiceSummary" || filters.type === "invoice") {
//     if (!filters.invoice_no || filters.invoice_no === "all") {
//       where.invoice_no = { not: null, notIn: ["", "null"] };
//     }
//   } else if (filters.type === "invoiceAwaited") {
//     where.grn_no = { not: null };
//     where.OR = [
//       { invoice_no: null },
//       { invoice_no: "" }
//     ];
//   }
//   if (filters.region) {
//     where.ordersSO = {
//       region: filters.region,
//     }
//   }
//   if (filters.item) {
//     where.transactions = {
//       some: {
//         itcd: parseInt(filters.item),
//       },
//     };
//   }
//   if (filters.item) whereTransactions.itcd = parseInt(filters.item);

//   const transactions = await prisma.transactionsMaster.findMany({
//     where,
//     include: {
//       acno: true,
//       godownDetails: true,
//       ordersSO: true,
//       transactions: {
//         where: whereTransactions,
//         include: {
//           itemDetails: true,
//           godownDetails: true,
//         },
//       },
//     },
//     orderBy: {
//       dated: "desc",
//     },
//   });

//   // Process individual transactions
//   const processedData = transactions.map((t) => {
//     const filteredTransactions = t.transactions.filter((tran) =>
//       [1, 2].includes(tran.sub_tran_id)
//     );

//     return {
//       ...t,
//       transactions: filteredTransactions,
//       // dated: new Date(t.dated).toLocaleDateString(),
//       total_qty: filteredTransactions.reduce(
//         (sum, line) => sum + (line.qty || 0),
//         0
//       ),
//       ...(type === ""
//         ? {
//           total_amount: filteredTransactions.reduce(
//             (sum, line) => sum + (t.tran_code === 9 ? (line.camt || 0) : t.tran_code === 10 ? (line.damt || 0) : (line[amountField] || 0)),
//             0
//           ),
//         }
//         : {}),
//     };
//   });

//   // Apply grouping if type filter is set
//   if (filters.type === "vendor" || filters.type === "customer") {
//     const grouped = {};
//     const labelField =
//       filters.type === "vendor" ? "vendorName" : "customerName";

//     processedData.forEach((t) => {
//       const key = t[accountFilterField];
//       if (!grouped[key]) {
//         grouped[key] = {
//           [accountFilterField]: key,
//           [labelField]: t.acno?.acname || `Unknown ${filters.type}`,
//           total_qty: 0,
//           total_amount: 0,
//           transactions: [],
//         };
//       }

//       grouped[key].total_qty += t.total_qty;
//       grouped[key].total_amount += t.total_amount || 0;
//       grouped[key].transactions.push(...t.transactions);
//     });

//     return Object.values(grouped);
//   }

//   if (filters.type === "product") {
//     const grouped = {};

//     processedData.forEach((t) => {
//       t.transactions.forEach((line) => {
//         const key = line.itcd;
//         if (!grouped[key]) {
//           grouped[key] = {
//             itcd: key,
//             productName: line.itemDetails?.item || "Unknown Product",
//             total_qty: 0,
//             total_amount: 0,
//             transactions: [],
//           };
//         }

//         grouped[key].total_qty += line.qty || 0;
//         grouped[key].total_amount += t.tran_code === 9 ? (line.camt || 0) : t.tran_code === 10 ? (line.damt || 0) : (line[amountField] || 0);
//         grouped[key].transactions.push(line);
//       });
//     });

//     return Object.values(grouped);
//   }

//   if (["productDetail", "customerDetail", "vendorDetail"].includes(filters.type)) {
//     const flattened = [];
//     processedData.forEach((t) => {
//       if (t.transactions && Array.isArray(t.transactions)) {
//         t.transactions.forEach((line) => {
//           flattened.push({
//             ...line,
//             dated: t.dated,
//             tran_id: t.tran_id,
//             pycd: t.pycd,
//             vendorName: t.acno?.acname || "-",
//             customerName: t.acno?.acname || "-",
//             productName: line.itemDetails?.item || "-",
//             soNo: t.so_no || t.po_no || "-",
//             total_qty: line.qty || 0,
//             gross_amount: t.tran_code === 9 ? (line.camt || 0) : t.tran_code === 10 ? (line.damt || 0) : (line[amountField] || 0),
//             st_amount: line.st_amount || 0,
//             total_amount: (t.tran_code === 9 ? (line.camt || 0) : t.tran_code === 10 ? (line.damt || 0) : (line[amountField] || 0)) + (line.st_amount || 0),
//             acno: t.acno,
//             godown: t.godownDetails?.godown || "N/A",
//           });
//         });
//       }
//     });
//     return flattened;
//   }

//   return processedData;
// }

// Helper: parse a potentially comma-separated filter value into a Prisma condition.
// intVal: true  → parse values as integers
// intVal: false → keep as strings
function parseMultiFilter(rawValue, intVal = false) {
  if (!rawValue || rawValue === "all") return null;
  const parts = String(rawValue).split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return intVal ? parseInt(parts[0], 10) : parts[0];
  }
  return { in: intVal ? parts.map(p => parseInt(p, 10)) : parts };
}

async function getPSTransactionReport(config) {
  const {
    tran_code,
    type = "", // "vendor", "product", or ""
    filters = {},
    amountField = "damt", // "damt" or "camt"
    accountFilterField = "pycd", // Field name for vendor/customer filter
    accountLabel = "vendor", // "vendor" or "customer"
  } = config;

  const where = {
    tran_code: Array.isArray(tran_code) ? { in: tran_code } : tran_code,
    dated: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
  };

  const whereTransactions = {};

  // Apply account filter (vendor/customer) — supports multi-select
  if (filters[accountLabel] && filters[accountLabel] !== "all") {
    const parsed = parseMultiFilter(filters[accountLabel], true);
    if (parsed !== null) where[accountFilterField] = parsed;
  }

  // Apply other master-level filters — all support multi-select via comma-separated values
  const godownVal = parseMultiFilter(filters.godown, true);
  if (godownVal !== null) where.godown = godownVal;

  if (filters.po_no && filters.po_no !== "all") where.po_no = parseInt(filters.po_no);

  const soNoVal = parseMultiFilter(filters.so_no, true);
  if (soNoVal !== null) where.so_no = soNoVal;

  const dispatchVal = parseMultiFilter(filters.dispatch_no, true);
  if (dispatchVal !== null) where.dispatch_no = dispatchVal;

  const invoiceVal = parseMultiFilter(filters.invoice_no, false);
  if (invoiceVal !== null) where.invoice_no = invoiceVal;

  if (filters.type === "invoiceSummary" || filters.type === "invoice") {
    if (!filters.invoice_no || filters.invoice_no === "all") {
      where.invoice_no = { not: null, notIn: ["", "null"] };
    }
  } else if (filters.type === "invoiceAwaited") {
    where.grn_no = { not: null };
    where.OR = [
      { invoice_no: null },
      { invoice_no: "" }
    ];
  }

  // "Without Rate" toggle (Purchase / Purchase Return / Sale / Sale Return):
  // only documents with no invoice number, or with an item line that has no
  // rate. Kept in AND so it does not clash with the OR above.
  if (filters.withoutRate === true || filters.withoutRate === "true") {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { invoice_no: null },
          { invoice_no: "" },
          {
            transactions: {
              some: {
                sub_tran_id: 1,
                itcd: { not: null },
                OR: [{ rate: null }, { rate: 0 }],
              },
            },
          },
        ],
      },
    ];
  }

  // Region filter — supports multi-select
  const regionVal = parseMultiFilter(filters.region, false);
  if (regionVal !== null) {
    where.ordersSO = {
      ...where.ordersSO,
      region: regionVal,
    };
  }

  // Sales person filter — filters by the salesperson assigned to the customer
  // account (ACNO.salesArea). Resolves selected IDs/usernames to match either representation.
  const salePersonVal = parseMultiFilter(filters.sale_person, false);
  if (salePersonVal !== null) {
    const targetKeys = typeof salePersonVal === "object" && salePersonVal.in
      ? salePersonVal.in
      : [salePersonVal];

    const resolvedUsers = await prisma.user.findMany({
      where: {
        OR: [
          { id: { in: targetKeys } },
          { username: { in: targetKeys } }
        ]
      },
      select: {
        id: true,
        username: true
      }
    });

    const allowedSalesAreas = [];
    resolvedUsers.forEach(u => {
      if (u.id) allowedSalesAreas.push(u.id);
      if (u.username) allowedSalesAreas.push(u.username);
    });

    where.acno = {
      ...where.acno,
      salesArea: allowedSalesAreas.length > 0 ? { in: allowedSalesAreas } : "__NON_EXISTENT__",
    };
  }

  // Item-details filters — all support multi-select
  const itemDetailsFilter = {};
  const laminationVal = parseMultiFilter(filters.lamination, false);
  if (laminationVal !== null) itemDetailsFilter.lamination = laminationVal;

  const colorVal = parseMultiFilter(filters.color, false);
  if (colorVal !== null) itemDetailsFilter.color = colorVal;

  const inkTypeVal = parseMultiFilter(filters.ink_type, false);
  if (inkTypeVal !== null) itemDetailsFilter.ink_type = inkTypeVal;

  const subtratesVal = parseMultiFilter(filters.subtrates, false);
  if (subtratesVal !== null) itemDetailsFilter.subtrates = subtratesVal;

  const businessUnitVal = parseMultiFilter(filters.business_unit, false);
  if (businessUnitVal !== null) itemDetailsFilter.business_unit = businessUnitVal;

  const printingPropertyVal = parseMultiFilter(filters.printing_property, false);
  if (printingPropertyVal !== null) itemDetailsFilter.printing_property = printingPropertyVal;

  const natureOfInkVal = parseMultiFilter(filters.nature_of_ink, false);
  if (natureOfInkVal !== null) itemDetailsFilter.nature_of_ink = natureOfInkVal;

  // Category / MainCategory (Ink Series) filter
  const rawCategory = filters.category || filters.ink_series || filters.main_categories || filters.mc_id;
  if (rawCategory && rawCategory !== "all") {
    const isNum = !isNaN(rawCategory) || (typeof rawCategory === "string" && rawCategory.split(",").every(s => !isNaN(s.trim())));
    if (isNum) {
      const mcVal = parseMultiFilter(rawCategory, true);
      if (mcVal !== null) itemDetailsFilter.mc_id = mcVal;
    } else {
      const mcValStr = parseMultiFilter(rawCategory, false);
      if (mcValStr !== null) {
        itemDetailsFilter.mainCategory = {
          mc_name: mcValStr,
        };
      }
    }
  }

  // Item Category filter — supports multi-select by ID or name
  // const rawItemCategory = filters.item_category || filters.ic_id;
  // if (rawItemCategory && rawItemCategory !== "all") {
  //   const isNum = !isNaN(rawItemCategory) || (typeof rawItemCategory === "string" && rawItemCategory.split(",").every(s => !isNaN(s.trim())));
  //   if (isNum) {
  //     const icVal = parseMultiFilter(rawItemCategory, true);
  //     if (icVal !== null) itemDetailsFilter.ic_id = icVal;
  //   } else {
  //     const icValStr = parseMultiFilter(rawItemCategory, false);
  //     if (icValStr !== null) {
  //       itemDetailsFilter.itemCategories = {
  //         ic_name: icValStr,
  //       };
  //     }
  //   }
  // }

  const hasItemDetailsFilter = Object.keys(itemDetailsFilter).length > 0;

  // Item filter — supports multi-select
  const itemVal = parseMultiFilter(filters.item, true);
  if (itemVal !== null || hasItemDetailsFilter) {
    where.transactions = {
      some: {
        ...(itemVal !== null && { itcd: itemVal }),
        ...(hasItemDetailsFilter && { itemDetails: itemDetailsFilter }),
      },
    };
  }

  if (itemVal !== null) whereTransactions.itcd = itemVal;
  if (hasItemDetailsFilter) whereTransactions.itemDetails = itemDetailsFilter;

  // "Without Rate", line level: a line shows only when IT has no rate (item
  // line, rate 0 / blank) or its document has no invoice number. So a priced
  // line on an invoiced document never shows, even when that document also
  // has a zero-rate line.
  if (filters.withoutRate === true || filters.withoutRate === "true") {
    whereTransactions.AND = [
      ...(whereTransactions.AND || []),
      {
        OR: [
          { itcd: { not: null }, OR: [{ rate: null }, { rate: 0 }] },
          { transactionsMaster: { OR: [{ invoice_no: null }, { invoice_no: "" }] } },
        ],
      },
    ];
  }

  // City filter — supports multi-select
  const cityVal = parseMultiFilter(filters.city, false);
  if (cityVal !== null) {
    where.acno = {
      ...where.acno,
      city: cityVal
    };
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      acno: true,
      godownDetails: true,
      ordersSO: true,
      transactions: {
        where: whereTransactions,
        include: {
          itemDetails: {
            include: {
              mainCategory: true,
              itemCategories: true,
            },
          },
          godownDetails: true,
        },
      },
    },
    orderBy: {
      dated: filters.dateOrder === "asc" ? "asc" : "desc",
    },
  });

  const primaryTranCode = Array.isArray(tran_code) ? tran_code[0] : tran_code;

  // Process individual transactions
  const processedData = transactions.map((t) => {
    const isReturn = t.tran_code !== primaryTranCode;

    const filteredTransactions = t.transactions.filter((tran) =>
      [1, 2].includes(tran.sub_tran_id)
    ).map(tran => {
      const qty = tran.qty || 0;
      const gross = t.tran_code === 9 ? (tran.camt || 0) : t.tran_code === 10 ? (tran.damt || 0) : (tran[amountField] || 0);
      const tax = tran.st_amount || 0;
      const damt = tran.damt || 0;
      const camt = tran.camt || 0;
      const mcName = tran.itemDetails?.mainCategory?.mc_name || tran.itemDetails?.series || "-";
      const icName = tran.itemDetails?.itemCategories?.ic_name || "-";

      return {
        ...tran,
        mc_name: mcName,
        ink_series: mcName,
        series: mcName,
        ic_name: icName,
        category: mcName,
        tran_code: t.tran_code,
        qty: isReturn ? -qty : qty,
        damt: isReturn ? -damt : damt,
        camt: isReturn ? -camt : camt,
        st_amount: isReturn ? -tax : tax,
      };
    });

    const rawQty = filteredTransactions.reduce(
      (sum, line) => sum + (line.qty || 0),
      0
    );
    const rawAmt = filteredTransactions.reduce(
      (sum, line) => sum + (t.tran_code === 9 ? (line.camt || 0) : t.tran_code === 10 ? (line.damt || 0) : (line[amountField] || 0)),
      0
    );

    return {
      ...t,
      transactions: filteredTransactions,
      // dated: new Date(t.dated).toLocaleDateString(),
      total_qty: rawQty,
      ...(type === ""
        ? {
          total_amount: rawAmt,
        }
        : {}),
    };
  });

  // Apply grouping if type filter is set
  if (filters.type === "vendor" || filters.type === "customer" || filters.type === "customerSummary") {
    const grouped = {};
    const labelField =
      filters.type === "vendor" ? "vendorName" : "customerName";

    processedData.forEach((t) => {
      const key = t[accountFilterField];
      if (!grouped[key]) {
        grouped[key] = {
          [accountFilterField]: key,
          [labelField]: t.acno?.acname || `Unknown ${filters.type}`,
          invoice_no: t.invoice_no,
          check_date: t.check_date,
          total_qty: 0,
          total_amount: 0,
          transactions: [],
        };
      }

      grouped[key].total_qty += t.total_qty;
      grouped[key].total_amount += t.total_amount || 0;
      grouped[key].transactions.push(...t.transactions);
    });

    return Object.values(grouped).map(withAvgRate);
  }

  if (filters.type === "product") {
    const grouped = {};

    processedData.forEach((t) => {
      t.transactions.forEach((line) => {
        const key = line.itcd;
        if (!grouped[key]) {
          grouped[key] = {
            itcd: key,
            code: line.itemDetails?.code || "-",
            itemDetails: line.itemDetails,
            productName: line.itemDetails?.item || "Unknown Product",
            mc_name: line.itemDetails?.mainCategory?.mc_name || line.itemDetails?.series || "-",
            ink_series: line.itemDetails?.mainCategory?.mc_name || line.itemDetails?.series || "-",
            total_qty: 0,
            total_amount: 0,
            transactions: [],
          };
        }
        grouped[key].invoice_no = t.invoice_no;
        grouped[key].check_date = t.check_date;
        grouped[key].total_qty += line.qty || 0;
        grouped[key].total_amount += t.tran_code === 9 ? (line.camt || 0) : t.tran_code === 10 ? (line.damt || 0) : (line[amountField] || 0);
        grouped[key].transactions.push(line);
      });
    });

    return Object.values(grouped).map(withAvgRate);
  }

  if (["productDetail", "customerDetail", "vendorDetail"].includes(filters.type)) {
    const flattened = [];
    processedData.forEach((t) => {
      if (t.transactions && Array.isArray(t.transactions)) {
        t.transactions.forEach((line) => {
          const mcName = line.itemDetails?.mainCategory?.mc_name || line.itemDetails?.series || "-";
          const icName = line.itemDetails?.itemCategories?.ic_name || "-";
          flattened.push({
            ...line,
            dated: t.dated,
            tran_id: t.tran_id,
            invoice_no: t.invoice_no,
            pycd: t.pycd,
            vendorName: t.acno?.acname || "-",
            customerName: t.acno?.acname || "-",
            productName: line.itemDetails?.item || "-",
            code: line.itemDetails?.code || "-",
            mc_name: mcName,
            ink_series: mcName,
            series: mcName,
            ic_name: icName,
            category: mcName,
            soNo: t.so_no || t.po_no || "-",
            total_qty: line.qty || 0,
            gross_amount: t.tran_code === 9 ? (line.camt || 0) : t.tran_code === 10 ? (line.damt || 0) : (line[amountField] || 0),
            st_amount: line.st_amount || 0,
            total_amount: (t.tran_code === 9 ? (line.camt || 0) : t.tran_code === 10 ? (line.damt || 0) : (line[amountField] || 0)) + (line.st_amount || 0),
            acno: t.acno,
            godown: t.godownDetails?.godown || "N/A",

          });
        });
      }
    });
    return flattened;
  }

  return processedData;
}

// Grouped summary rows (customer/vendor/product): total_amount is the gross
// (pre-tax) amount, so avg rate = gross / qty.
function withAvgRate(row) {
  const qty = Number(row.total_qty) || 0;
  return {
    ...row,
    avg_rate: qty ? Number(((Number(row.total_amount) || 0) / qty).toFixed(2)) : 0,
  };
}

function calculatePSTransactionSummary(type, data, amountField = "damt") {
  // If data is flattened (Detail view), rows have 'qty' instead of 'total_qty'
  // If data is grouped (Summary view), rows have 'total_qty'
  const totalQty = data.reduce(
    (sum, t) => sum + (t.qty || t.total_qty || 0),
    0
  );

  const baseSummary = {
    total_qty: totalQty,
  };

  if (type === "") {
    const totalGross = data.reduce(
      (sum, t) => sum + (t[amountField] || t.total_amount || 0),
      0
    );

    const totalTax = data.reduce((sum, t) => {
      // If it's a detail row, st_amount is direct. If master/grouped, it's in transactions
      if (t.st_amount !== undefined && !t.transactions) {
        return sum + (t.st_amount || 0);
      }
      return (
        sum +
        (t.transactions?.reduce(
          (innerSum, line) => innerSum + (line.st_amount || 0),
          0
        ) || 0)
      );
    }, 0);

    return {
      ...baseSummary,
      total_gross_amount: totalGross,
      total_tax: totalTax,
      total_amount: totalGross + totalTax,
    };
  }

  return baseSummary;
}

//   // Process individual transactions
//   const processedData = transactions.map((t) => {
//     const filteredTransactions = t.transactions.filter((tran) =>
//       [1, 2].includes(tran.sub_tran_id)
//     );

//     return {
//       ...t,
//       transactions: filteredTransactions,
//       // dated: new Date(t.dated).toLocaleDateString(),
//       total_qty: filteredTransactions.reduce(
//         (sum, line) => sum + (line.qty || 0),
//         0
//       ),
//       ...(type === ""
//         ? {
//           total_amount: filteredTransactions.reduce(
//             (sum, line) => sum + (line[amountField] || 0),
//             0
//           ),
//         }
//         : {}),
//     };
//   });

//   // Apply grouping if type filter is set
//   if (filters.type === "vendor" || filters.type === "customer") {
//     const grouped = {};
//     const labelField =
//       filters.type === "vendor" ? "vendorName" : "customerName";

//     processedData.forEach((t) => {
//       const key = t[accountFilterField];
//       if (!grouped[key]) {
//         grouped[key] = {
//           [accountFilterField]: key,
//           [labelField]: t.acno?.acname || `Unknown ${filters.type}`,
//           total_qty: 0,
//           total_amount: 0,
//           transactions: [],
//         };
//       }

//       grouped[key].total_qty += t.total_qty;
//       grouped[key].total_amount += t.total_amount || 0;
//       grouped[key].transactions.push(...t.transactions);
//     });

//     return Object.values(grouped);
//   }

//   if (filters.type === "product") {
//     const grouped = {};

//     processedData.forEach((t) => {
//       t.transactions.forEach((line) => {
//         const key = line.itcd;
//         if (!grouped[key]) {
//           grouped[key] = {
//             itcd: key,
//             productName: line.itemDetails?.item || "Unknown Product",
//             total_qty: 0,
//             total_amount: 0,
//             transactions: [],
//           };
//         }

//         grouped[key].total_qty += line.qty || 0;
//         grouped[key].total_amount += line[amountField] || 0;
//         grouped[key].transactions.push(line);
//       });
//     });

//     return Object.values(grouped);
//   }

//   return processedData;
// }

// function calculatePSTransactionSummary(type, data, amountField = "damt") {
//   const baseSummary = {
//     total_qty: data.reduce((sum, t) => sum + t.total_qty, 0),
//   };

//   if (type === "") {
//     return {
//       ...baseSummary,
//       total_gross_amount: data.reduce((sum, t) => sum + (t.total_amount || 0), 0),
//       total_tax: data.reduce(
//         (sum, t) =>
//           sum +
//           t.transactions.reduce(
//             (innerSum, line) => innerSum + (line.st_amount || 0),
//             0
//           ),
//         0
//       ),
//       total_amount:
//         data.reduce((sum, t) => sum + (t.total_amount || 0), 0) +
//         data.reduce(
//           (sum, t) =>
//             sum +
//             t.transactions.reduce(
//               (innerSum, line) => innerSum + (line.st_amount || 0),
//               0
//             ),
//           0
//         ),
//     };
//   }

//   return baseSummary;
// }

async function getPurchaseReturnReport(filters) {
  const where = {
    tran_code: 9, // Purchase return transaction code
    dated: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
  };

  const whereTransactions = {};

  if (filters.vendor) {
    where.pycd = Number(filters.vendor);
  }

  if (filters.godown) {
    where.godown = parseInt(filters.godown);
  }

  if (filters.po_no) {
    where.po_no = parseInt(filters.po_no);
  }

  if (filters.item) {
    whereTransactions.itcd = parseInt(filters.item);
    where.transactions = {
      some: {
        itcd: parseInt(filters.item),
      },
    };
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      acno: true,
      godownDetails: true,
      transactions: {
        where: whereTransactions,
        include: {
          itemDetails: true,
          godownDetails: true,
        },
      },
    },
    orderBy: {
      dated: "desc",
    },
  });

  return transactions.map((t) => {

    const filteredTransactions = t.transactions.filter((tran) =>
      [1, 2].includes(tran.sub_tran_id)
    );

    return {
      ...t,
      transactions: filteredTransactions,
      dated: new Date(t.dated).toLocaleDateString(),
      total_qty: filteredTransactions.reduce(
        (sum, line) => sum + (line.qty || 0),
        0
      ),
      total_amount: filteredTransactions.reduce(
        (sum, line) => sum + (line.camt || 0),
        0
      ),
    };
  });
}

function calculatePurchaseReturnSummary(data) {
  return {
    total_qty: data.reduce((sum, t) => sum + t.total_qty, 0),
    total_gross_amount: data.reduce(
      (sum, t) =>
        sum +
        t.transactions.reduce((sum, line) => sum + (line.gross_amount || 0), 0),
      0
    ),
    total_tax: data.reduce(
      (sum, t) =>
        sum +
        t.transactions.reduce((sum, line) => sum + (line.st_amount || 0), 0),
      0
    ),
    total_amount: data.reduce((sum, t) => sum + t.total_amount, 0),
  };
}

async function getGrnReturnReport(filters) {
  const where = {
    tran_code: 9,
  };


  if (filters.dateFrom || filters.dateTo) {
    where.dated = {};

    if (filters.dateFrom) {
      where.dated.gte = new Date(filters.dateFrom);
    }

    if (filters.dateTo) {
      const endDate = new Date(filters.dateTo);
      endDate.setHours(23, 59, 59, 999);

      where.dated.lte = endDate;
    }
  }


  if (filters.vendor && !isNaN(Number(filters.vendor))) {
    where.pycd = Number(filters.vendor);
  }


  if (filters.godown && !isNaN(parseInt(filters.godown))) {
    where.godown = parseInt(filters.godown);
  }


  if (filters.po_no && !isNaN(parseInt(filters.po_no))) {
    where.po_no = parseInt(filters.po_no);
  }

  const whereTransactions = {
    sub_tran_id: {
      in: [1, 2],
    },
  };


  if (filters.item && !isNaN(parseInt(filters.item))) {
    whereTransactions.itcd = parseInt(filters.item);

    where.transactions = {
      some: {
        itcd: parseInt(filters.item),
        sub_tran_id: {
          in: [1, 2],
        },
      },
    };
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,

    include: {
      acno: true,

      godownDetails: true,

      transactions: {
        where: whereTransactions,

        include: {
          itemDetails: true,
          godownDetails: true,
        },
      },
    },

    orderBy: {
      dated: "desc",
    },
  });

  // Product Detail → one row per item line (columns read transactions[0]),
  // so a return with 2 items shows 2 rows instead of only the first item.
  if (filters.type === "product") {
    return transactions.flatMap((t) =>
      t.transactions.map((line) => ({
        ...t,
        transactions: [line],
        dated: new Date(t.dated).toLocaleDateString(),
        total_qty: Number(line.qty || 0),
        total_amount: Number(line.camt || 0),
      }))
    );
  }

  return transactions.map((t) => ({
    ...t,

    dated: new Date(t.dated).toLocaleDateString(),

    total_qty: t.transactions.reduce(
      (sum, line) => sum + Number(line.qty || 0),
      0
    ),

    total_amount: t.transactions.reduce(
      (sum, line) => sum + Number(line.camt || 0),
      0
    ),
  }));
}

function calculateGrnReturnSummary(data) {

  const rows = Array.isArray(data) ? data : [];

  return {
    total_qty: rows.reduce(
      (sum, t) => sum + Number(t.total_qty || 0),
      0
    ),

    total_gross_amount: rows.reduce(
      (sum, t) =>
        sum +
        (t.transactions || []).reduce(
          (s, line) => s + Number(line.gross_amount || 0),
          0
        ),
      0
    ),

    total_tax: rows.reduce(
      (sum, t) =>
        sum +
        (t.transactions || []).reduce(
          (s, line) => s + Number(line.st_amount || 0),
          0
        ),
      0
    ),

    total_amount: rows.reduce(
      (sum, t) => sum + Number(t.total_amount || 0),
      0
    ),
  };
}

async function getOrderTransactionReport(orderCatagory, filters) {
  const where = {
    order_catagory: orderCatagory, // 4 for Purchase Order, 6 for Sale Order
    dated: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
  };
  if (filters.vendor) {
    where.party_code = Number(filters.vendor);
  }
  if (filters.godown) {
    where.godown = parseInt(filters.godown);
  }
  if (filters.freeOfCost) {
    where.freeOfCost = filters.freeOfCost === 'true' ? true : false;
  }

  if (filters.item) {
    where.orderDetails = {
      some: {
        itcd: parseInt(filters.item),
      },
    };
  }

  const whereOrderTransactions = {};
  if (filters.item) {
    whereOrderTransactions.itcd = parseInt(filters.item);
  }
  const orders = await prisma.orderMaster.findMany({
    where,
    include: {
      acno: true,
      godownDetails: true,
      orderDetails: {
        where: whereOrderTransactions,
        include: {
          items: true,
          service: true,
        },
      },
    },
    orderBy: {
      dated: "desc",
    },
  });

  return orders.map((o) => {
    return {
      ...o,
      // Order drill (CLAUDE.md rule 15): order_no + 400 / 500 / 600.
      tran_code: orderCatagory * 100,
      dated: new Date(o.dated).toLocaleDateString(),
      total_qty: o.orderDetails.reduce((sum, line) => sum + (line.qty || 0), 0),
      total_amount: o.orderDetails.reduce(
        (sum, line) => sum + (line.amount || 0),
        0
      ),
    };
  });
}
function calculateOrderSummary(data) {
  return {
    total_qty: data.reduce((sum, t) => sum + t.total_qty, 0),
    total_amount: data.reduce((sum, t) => sum + t.total_amount, 0),
  };
}


async function getDispatchReturnReport(filters) {

  const where = {
    tran_code: 10,
    dated: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
  };

  if (filters.customer) {
    where.pycd = Number(filters.customer);
  }
  if (filters.godown) {
    where.godown = parseInt(filters.godown);
  }
  if (filters.so_no) {
    where.so_no = parseInt(filters.so_no);
  }
  const whereTransactions = {};
  if (filters.item) {
    whereTransactions.itcd = parseInt(filters.item);
    where.transactions = {
      some: {
        itcd: parseInt(filters.item),
      },
    };
  }
  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      acno: true,
      godownDetails: true,
      transactions: {
        where: whereTransactions,
        include: {
          itemDetails: true,
          godownDetails: true,
        },
      },
    },
    orderBy: {
      dated: "desc",
    },
  });
  // Product Detail → one row per item line (columns read transactions[0]),
  // so a return with 2 items shows 2 rows instead of only the first item.
  if (filters.type === "product") {
    return transactions.flatMap((t) =>
      t.transactions
        .filter((tran) => [1, 2].includes(tran.sub_tran_id))
        .map((line) => ({
          ...t,
          transactions: [line],
          dated: new Date(t.dated).toLocaleDateString(),
          total_qty: line.qty || 0,
          total_amount: line.damt || 0,
        }))
    );
  }

  return transactions.map((t) => {
    // keep only sale/return lines
    const filteredTransactions = t.transactions.filter((tran) =>
      [1, 2].includes(tran.sub_tran_id)
    );
    return {
      ...t,
      transactions: filteredTransactions,
      dated: new Date(t.dated).toLocaleDateString(),
      total_qty: filteredTransactions.reduce(
        (sum, line) => sum + (line.qty || 0),
        0
      ),
      total_amount: filteredTransactions.reduce(
        (sum, line) => sum + (line.damt || 0),
        0
      ),
    };
  });
}

function calculateDispatchReturnSummary(data) {

  const totalQty = data.reduce((sum, r) => sum + (r.total_qty || 0), 0);
  const totalAmount = data.reduce((sum, r) => sum + (r.total_amount || 0), 0);
  // 2️⃣ Tax total – sum of st_amount from every line
  const totalTax = data.reduce((sum, r) => {
    if (Array.isArray(r.transactions)) {
      return (
        sum +
        r.transactions.reduce((inner, line) => inner + (line.st_amount || 0), 0)
      );
    }
    return sum;
  }, 0);
  // 3️⃣ Grand total (amount + tax)
  const grandTotal = totalAmount + totalTax;
  // Return the summary object – shape matches other summary functions
  return {
    total_qty: totalQty,
    total_amount: totalAmount,
    total_tax: totalTax,
    total_gross_amount: totalAmount, // same as amount for returns
    total: grandTotal,
  };
}

async function getSaleReport(type, filters) {
  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setUTCHours(0, 0, 0, 0))
    : undefined;

  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setUTCHours(23, 59, 59, 999))
    : undefined;

  const where = {
    tran_code: 6, // Sale transaction code
    dated: {
      gte: filters.dateFrom ? startDate : undefined,
      lte: filters.dateTo ? endDate : undefined,
    },

  };

  const whereTransactions = {};

  if (filters.customer) {
    where.pycd = Number(filters.customer);
  }

  if (filters.so_no) {
    where.so_no = parseInt(filters.so_no);
  }

  // Dispatch No (exact). Not a number → ignored.
  if (filters.dispatch_no && Number.isFinite(parseInt(filters.dispatch_no))) {
    where.dispatch_no = parseInt(filters.dispatch_no);
  }

  if (filters.godown) {
    where.godown = parseInt(filters.godown);
  }
  // Dispatch Without Rates: dispatches with no invoice number yet, plus
  // invoiced ones that still have an item line at rate 0 / no rate.
  if (filters.uninvoicedOnly) {
    // where.OR = [{ invoice_no: null }, { invoice_no: "" }];
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { invoice_no: null },
          { invoice_no: "" },
          {
            transactions: {
              some: {
                sub_tran_id: 1,
                itcd: { not: null },
                OR: [{ rate: null }, { rate: 0 }],
              },
            },
          },
        ],
      },
    ];
    // Lines: on an invoiced dispatch only the zero-rate item lines show.
    whereTransactions.AND = [
      ...(whereTransactions.AND || []),
      {
        OR: [
          { itcd: { not: null }, OR: [{ rate: null }, { rate: 0 }] },
          { transactionsMaster: { OR: [{ invoice_no: null }, { invoice_no: "" }] } },
        ],
      },
    ];
  }
  if (filters.region) {
    where.ordersSO = {
      region: filters.region,
    };
  }
  // Sales person scope (set by the API case, not the URL): only customers
  // whose ACNO.salesArea is one of these users (by id or username).
  // if (Array.isArray(filters.salesPersonScope)) {
  //   const users = await prisma.user.findMany({
  //     where: { id: { in: filters.salesPersonScope } },
  //     select: { id: true, username: true },
  //   });
  //   const areas = users.flatMap((u) => [u.id, u.username].filter(Boolean));
  //   where.acno = { salesArea: { in: areas.length ? areas : ["__NON_EXISTENT__"] } };
  // }
  if (filters.item) {
    whereTransactions.itcd = parseInt(filters.item);
    where.transactions = {
      some: {
        itcd: parseInt(filters.item),
      },
    };
  }

  // Dispatch → Product Detail only: Ink Series (Item.mc_id) filter, and the
  // series name on each line for its column.
  const isDispatchProduct = type === "dispatch" && filters.type === "product";
  const inkSeries = isDispatchProduct ? inkSeriesIds(filters) : [];
  if (inkSeries.length) {
    whereTransactions.itemDetails = { mc_id: { in: inkSeries } };
    where.transactions = {
      some: { ...(where.transactions?.some || {}), itemDetails: { mc_id: { in: inkSeries } } },
    };
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      acno: true,
      godownDetails: true,
      ordersSO: true,
      transactions: {
        where: whereTransactions,
        include: {
          itemDetails: isDispatchProduct
            ? { include: { mainCategory: { select: { mc_name: true } } } }
            : true,
          godownDetails: true,
        },
      },
    },
    orderBy: [
      { dated: "desc" },
      {dispatch_no :"desc"},
      { acno: { acname: "asc" } },
      { so_no: "desc" },
      { tran_id: "desc" }
    ],
  });

  // Dispatch: item lines with 0 qty (or 0 litres on an LTR line) are hidden
  // unless "Show Zero Qty" is ticked; a dispatch left with no item line goes.
  if (type === "dispatch" && !(filters.showZeroQty === true || filters.showZeroQty === "true")) {
    const isZeroLine = (l) =>
      l.sub_tran_id === 1 &&
      (!(Number(l.qty) > 0) ||
        (String(l.unit || "").toUpperCase() === "LTR" && !(Number(l.qty_ltr) > 0)));
    for (let i = transactions.length - 1; i >= 0; i--) {
      const t = transactions[i];
      t.transactions = t.transactions.filter((l) => !isZeroLine(l));
      if (!t.transactions.some((l) => l.sub_tran_id === 1)) transactions.splice(i, 1);
    }
  }

  // Product Detail: break each dispatch into one row per item line
  if (type === "dispatch" && filters.type === "product") {
    return transactions.flatMap((t) =>
      t.transactions
        .filter((tran) => [1, 2].includes(tran.sub_tran_id))
        .map((line) => ({
          ...t,
          transactions: [line],
          batch_no: line.batch_no,
          total_qty: line.qty || 0,
        }))
    );
  }

  return transactions.map((t) => {
    // Filter sub_tran_id within each transactions array
    const filteredTransactions = t.transactions.filter((tran) =>
      [1, 2].includes(tran.sub_tran_id)
    );

    return {
      ...t,
      transactions: filteredTransactions,
      total_qty: filteredTransactions.reduce(
        (sum, line) => sum + (line.qty || 0),
        0
      ),
      ...(type === ""
        ? {
          total_amount: filteredTransactions.reduce(
            (sum, line) => sum + (line.camt || 0),
            0
          ),
        }
        : {}),
    };
  });
}

function calculateSaleSummary(type, data) {
  return {
    total_qty: data.reduce((sum, t) => sum + t.total_qty, 0),
    // Dispatch: litres of the lines dispatched in LTR (qty above stays KG)
    ...(type === "dispatch"
      ? {
        total_qty_ltr: data.reduce(
          (sum, t) =>
            sum +
            (t.transactions || [])
              .filter((l) => String(l.unit || "").toUpperCase() === "LTR")
              .reduce((s, l) => s + (Number(l.qty_ltr) || 0), 0),
          0
        ),
      }
      : {}),

    ...(type === ""
      ? {
        total_gross_amount: data.reduce(
          (sum, t) =>
            sum +
            t.transactions.reduce(
              (innerSum, line) => innerSum + (line.gross_amount || 0),
              0
            ),
          0
        ),
        total_tax: data.reduce(
          (sum, t) =>
            sum +
            t.transactions.reduce(
              (innerSum, line) => innerSum + (line.st_amount || 0),
              0
            ),
          0
        ),
        total_amount: data.reduce((sum, t) => sum + t.total_amount, 0),
      }
      : {}),
  };
}

async function getSaleReturnReport(filters) {
  const where = {
    tran_code: 10, // Sale return transaction code
    dated: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
  };

  const whereTransactions = {};

  if (filters.customer) {
    where.pycd = Number(filters.customer);
  }

  if (filters.godown) {
    where.godown = parseInt(filters.godown);
  }

  if (filters.po_no) {
    where.po_no = parseInt(filters.po_no);
  }

  if (filters.item) {
    whereTransactions.itcd = parseInt(filters.item);
    where.transactions = {
      some: {
        itcd: parseInt(filters.item),
      },
    };
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      acno: true,
      godownDetails: true,
      transactions: {
        where: whereTransactions,
        include: {
          itemDetails: true,
          godownDetails: true,
        },
      },
    },
    orderBy: {
      dated: "desc",
    },
  });

  return transactions.map((t) => {
    // Filter sub_tran_id within each transactions array
    const filteredTransactions = t.transactions.filter((tran) =>
      [1, 2].includes(tran.sub_tran_id)
    );

    return {
      ...t,
      transactions: filteredTransactions,
      dated: new Date(t.dated).toLocaleDateString(),
      total_qty: filteredTransactions.reduce(
        (sum, line) => sum + (line.qty || 0),
        0
      ),
      total_amount: filteredTransactions.reduce(
        (sum, line) => sum + (line.damt || 0),
        0
      ),
    };
  });
}

function calculateSaleReturnSummary(data) {
  return {
    total_qty: data.reduce((sum, t) => sum + t.total_qty, 0),
    total_gross_amount: data.reduce(
      (sum, t) =>
        sum +
        t.transactions.reduce((sum, line) => sum + (line.gross_amount || 0), 0),
      0
    ),
    total_tax: data.reduce(
      (sum, t) =>
        sum +
        t.transactions.reduce((sum, line) => sum + (line.st_amount || 0), 0),
      0
    ),
    total_amount: data.reduce((sum, t) => sum + t.total_amount, 0),
  };
}


async function getDailyDispatchReport(filters) {
  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setUTCHours(0, 0, 0, 0))
    : undefined;

  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setUTCHours(23, 59, 59, 999))
    : undefined;

  const where = {
    tran_code: 6, // Dispatch ka actual tran_code lagao
    dated: {
      gte: startDate,
      lte: endDate,
    },
  };

  const transactionWhere = {
    sub_tran_id: {
      in: [1, 2],
    },
  };

  if (filters.itcd) {
    transactionWhere.itcd = Number(filters.itcd);
  }

  const records = await prisma.transactionsMaster.findMany({
    where,
    include: {
      transactions: {
        where: transactionWhere,
        include: {
          itemDetails: {
            select: {
              item: true,
              itcd: true,
              ink_type: true
            }
          }
        }
      },
    },
    orderBy: {
      dated: "asc",
    },
  });

  // Dynamic Dates
  const dates = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    dates.push(current.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: 'numeric' }));
    current.setDate(current.getDate() + 1);
  }

  const result = {};

  records.forEach((master) => {
    const dateKey = master.dated.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: 'numeric' });

    master.transactions.forEach((tran) => {
      const mmCode = String(tran.itcd);
      const item_name = String(tran.itemDetails.item)

      if (!result[mmCode]) {
        result[mmCode] = {
          itcd: mmCode,
          item_name: item_name,
        };

        dates.forEach((d) => {
          result[mmCode][d] = 0;
        });
      }

      result[mmCode][dateKey] += Number(tran.qty || 0);
    });
  });

  return Object.values(result);
}

function calculateDailyDispatchSummary(data) {
  return {
    // total_mm_codes: data.rows.length,

    // total_qty: data.rows.reduce((sum, row) => {
    //   const rowTotal = Object.keys(row)
    //     .filter(
    //       (key) => key !== "itcd" && key !== "item_name"
    //     )
    //     .reduce(
    //       (innerSum, key) =>
    //         innerSum + Number(row[key] || 0),
    //       0
    //     );

    //   return sum + rowTotal;
    // }, 0),
  };
}
// export async function getStockReport(filters = {}) {
//   try {
//     const results = await prisma.$queryRaw`
//       SELECT 
//     i.itcd,
//     i.item,
//     i.ic_id,
//     ic.ic_name as ItemCategory,
//     ic.id,

//     COALESCE(SUM(
//       CASE
//         WHEN tm.tran_code IN (4, 10, 12) THEN t.qty
//         WHEN tm.tran_code IN (6, 9, 5) THEN -t.qty
//         ELSE 0
//       END
//     ), 0) AS "actualStock",

//     SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//       - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END) AS "totalPurchased",

//     SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
//       - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END) AS "totalPurchaseValue",

//     SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
//       - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END) AS "totalSold",

//     SUM(CASE WHEN tm.tran_code IN (5,6) THEN COALESCE(t.camt,0)::numeric ELSE 0 END) 
//       - SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) AS "totalSaleValue",

//     CASE 
//       WHEN (SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//             - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)) > 0
//       THEN (
//         (SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END))
//         /
//         NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)
//       )
//       ELSE 0
//     END AS "avgPurchaseRate",

//     CASE 
//       WHEN (SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
//             - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)) > 0
//       THEN (
//         (SUM(CASE WHEN tm.tran_code IN (5,6) THEN COALESCE(t.camt,0)::numeric ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)::numeric ELSE 0 END))
//         /
//         NULLIF((SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)),0)
//       )
//       ELSE 0
//     END AS "avgSaleRate",

//     (COALESCE(SUM(
//       CASE
//         WHEN tm.tran_code IN (4, 10, 12) THEN t.qty
//         WHEN tm.tran_code IN (6, 9, 5) THEN -t.qty
//         ELSE 0
//       END
//     ), 0) *
//     CASE 
//       WHEN (SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//             - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)) > 0
//       THEN (
//         (SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END))
//         /
//         NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)
//       )
//       ELSE 0
//     END) AS "currentStockValue",

//     (COALESCE(SUM(
//       CASE
//         WHEN tm.tran_code IN (4, 10, 12) THEN t.qty
//         WHEN tm.tran_code IN (6, 9, 5) THEN -t.qty
//         ELSE 0
//       END
//     ), 0) *
//     CASE 
//       WHEN (SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
//             - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)) > 0
//       THEN (
//         (SUM(CASE WHEN tm.tran_code IN (5,6) THEN COALESCE(t.camt,0)::numeric ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)::numeric ELSE 0 END))
//         /
//         NULLIF((SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)),0)
//       )
//       ELSE 0
//     END) AS "potentialSaleValue",

//     CASE 
//       WHEN (
//         (SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END))
//       ) > 0
//       THEN ROUND((
//         (
//           (SUM(CASE WHEN tm.tran_code IN (5,6) THEN COALESCE(t.camt,0)::numeric ELSE 0 END) 
//            - SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)::numeric ELSE 0 END))
//           /
//           NULLIF((SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
//            - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)),0)
//         )
//         -
//         (
//           (SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
//            - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END))
//           /
//           NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//            - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)
//         )
//       )::numeric / 
//       NULLIF((
//         (SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END))
//         /
//         NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//          - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)
//       ),0)::numeric * 100,2)
//       ELSE 0
//     END AS "profitMargin",

//     CASE 
//       WHEN (SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//             - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)) > 0
//       THEN ROUND((
//         (
//           (SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
//            - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END))::numeric
//           /
//           NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
//            - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)::numeric
//         ) * 100
//       )::numeric,2)
//       ELSE 0
//     END AS "stockTurnover"

// FROM "Transactions" t
// JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
// JOIN "Item" i ON t.itcd = i.itcd
// LEFT JOIN "ItemCategory" ic ON i.ic_id = ic.id
// WHERE t.itcd IS NOT NULL
//   AND t.qty IS NOT NULL
//   ${
//     filters?.category
//       ? Prisma.sql`AND i.ic_id = ${parseInt(filters.category)}`
//       : Prisma.empty
//   }
//    ${
//           filters?.item
//             ? Prisma.sql`AND i.itcd = ${parseInt(filters.item)}`
//             : Prisma.empty
//         }
//         ${
//           filters?.godown
//             ? Prisma.sql`AND tm.godown = ${parseInt(filters.godown)}`
//             : Prisma.empty
//         }
// GROUP BY i.itcd, i.item, i.ic_id,ic.ic_name , ic.id
// ORDER BY i.item ASC;
//     `;

//     return results ?? [];
//   } catch (err) {
//     console.error("[getStockReport] ERROR:", err);
//     return [];
//   }
// }

export async function getStockReport(filters = {}) {
  try {
    const results = await prisma.$queryRaw`
      SELECT 
    i.itcd,
    i.item,
    i.code,
    i.code as inkcode,
    i.ic_id,
    ic.ic_name as ItemCategory,
    ic.id,
    mc.mc_name AS ink_series,
    MAX(tm.dated) AS "dated",
 
    -- actualStock: 4,8,10,12 = Increase | 5,6,7,9 = Decrease | 11 = Transfer (godown-aware)
    COALESCE(SUM(
      CASE
        WHEN tm.tran_code IN (4, 8, 10, 12) THEN t.qty
        WHEN tm.tran_code IN (5, 6, 7, 9) THEN -t.qty
        WHEN tm.tran_code = 11 AND ${filters?.godown ? Prisma.sql`tm.godown2 = ${parseInt(filters.godown)}` : Prisma.sql`FALSE`} THEN t.qty
        WHEN tm.tran_code = 11 AND ${filters?.godown ? Prisma.sql`tm.godown = ${parseInt(filters.godown)}` : Prisma.sql`FALSE`} THEN -t.qty
        ELSE 0
      END
    ), 0) AS "actualStock",
 
    -- totalPurchased: Sirf Purchase (4) minus Purchase Return (9)
    SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
      - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END) AS "totalPurchased",
 
    -- totalPurchaseValue: Sirf Purchase amount (damt) minus Purchase Return (camt)
    SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
      - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END) AS "totalPurchaseValue",
 
    -- totalProduction: Production (8)
    SUM(CASE WHEN tm.tran_code = 8 THEN t.qty ELSE 0 END) AS "totalProduction",
 
    -- totalIssued: Issued/Consumption (7)
    SUM(CASE WHEN tm.tran_code = 7 THEN t.qty ELSE 0 END) AS "totalIssued",
 
    -- totalSold: Sale (5,6) minus Sale Return (10)
    SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
      - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END) AS "totalSold",
 
    -- totalSaleValue: Sale amount (camt) minus Sale Return (damt)
    SUM(CASE WHEN tm.tran_code IN (5,6) THEN COALESCE(t.camt,0)::numeric ELSE 0 END) 
      - SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) AS "totalSaleValue",
 
    -- avgPurchaseRate: Sirf purchase se calculate
    CASE 
      WHEN (SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
            - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)) > 0
      THEN (
        (SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END))
        /
        NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)
      )
      ELSE 0
    END AS "avgPurchaseRate",
 
    -- avgSaleRate: Sirf sale se calculate
    CASE 
      WHEN (SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
            - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)) > 0
      THEN (
        (SUM(CASE WHEN tm.tran_code IN (5,6) THEN COALESCE(t.camt,0)::numeric ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)::numeric ELSE 0 END))
        /
        NULLIF((SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)),0)
      )
      ELSE 0
    END AS "avgSaleRate",
 
    -- currentStockValue: actualStock × avgPurchaseRate
    (COALESCE(SUM(
      CASE
        WHEN tm.tran_code IN (4, 8, 10, 12) THEN t.qty
        WHEN tm.tran_code IN (5, 6, 7, 9) THEN -t.qty
        WHEN tm.tran_code = 11 AND ${filters?.godown ? Prisma.sql`tm.godown2 = ${parseInt(filters.godown)}` : Prisma.sql`FALSE`} THEN t.qty
        WHEN tm.tran_code = 11 AND ${filters?.godown ? Prisma.sql`tm.godown = ${parseInt(filters.godown)}` : Prisma.sql`FALSE`} THEN -t.qty
        ELSE 0
      END
    ), 0) *
    CASE 
      WHEN (SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
            - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)) > 0
      THEN (
        (SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END))
        /
        NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)
      )
      ELSE 0
    END) AS "currentStockValue",
 
    -- potentialSaleValue: actualStock × avgSaleRate
    (COALESCE(SUM(
      CASE
        WHEN tm.tran_code IN (4, 8, 10, 12) THEN t.qty
        WHEN tm.tran_code IN (5, 6, 7, 9) THEN -t.qty
        WHEN tm.tran_code = 11 AND ${filters?.godown ? Prisma.sql`tm.godown2 = ${parseInt(filters.godown)}` : Prisma.sql`FALSE`} THEN t.qty
        WHEN tm.tran_code = 11 AND ${filters?.godown ? Prisma.sql`tm.godown = ${parseInt(filters.godown)}` : Prisma.sql`FALSE`} THEN -t.qty
        ELSE 0
      END
    ), 0) *
    CASE 
      WHEN (SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
            - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)) > 0
      THEN (
        (SUM(CASE WHEN tm.tran_code IN (5,6) THEN COALESCE(t.camt,0)::numeric ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)::numeric ELSE 0 END))
        /
        NULLIF((SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)),0)
      )
      ELSE 0
    END) AS "potentialSaleValue",
 
    -- profitMargin: (avgSaleRate - avgPurchaseRate) / avgPurchaseRate × 100
    CASE 
      WHEN (
        (SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END))
      ) > 0
      THEN ROUND((
        (
          (SUM(CASE WHEN tm.tran_code IN (5,6) THEN COALESCE(t.camt,0)::numeric ELSE 0 END) 
           - SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)::numeric ELSE 0 END))
          /
          NULLIF((SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
           - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END)),0)
        )
        -
        (
          (SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
           - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END))
          /
          NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
           - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)
        )
      )::numeric / 
      NULLIF((
        (SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.damt,0)::numeric ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 9 THEN COALESCE(t.camt,0)::numeric ELSE 0 END))
        /
        NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
         - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)
      ),0)::numeric * 100,2)
      ELSE 0
    END AS "profitMargin",
 
    -- stockTurnover: (totalSold / totalPurchased) × 100
    CASE 
      WHEN (SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
            - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)) > 0
      THEN ROUND((
        (
          (SUM(CASE WHEN tm.tran_code IN (5,6) THEN t.qty ELSE 0 END) 
           - SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END))::numeric
          /
          NULLIF((SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END) 
           - SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END)),0)::numeric
        ) * 100
      )::numeric,2)
      ELSE 0
    END AS "stockTurnover"
 
FROM "Transactions" t
JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
JOIN "Item" i ON t.itcd = i.itcd
LEFT JOIN "ItemCategory" ic ON i.ic_id = ic.id
LEFT JOIN "MainCategory" mc ON i.mc_id = mc.id
WHERE t.itcd IS NOT NULL
  AND t.qty IS NOT NULL
  ${filters?.category
        ? Prisma.sql`AND i.ic_id = ${parseInt(filters.category)}`
        : Prisma.empty
      }
  ${inkSeriesWhereSql(filters)}
  ${(() => {
        // `item` is one itcd from the report screen, or a comma list
        // ("12,34,56") so callers like the BOM view get many items in one call.
        const itcds = String(filters?.item ?? "")
          .split(",")
          .map((s) => parseInt(s, 10))
          .filter(Number.isFinite);
        return itcds.length
          ? Prisma.sql`AND i.itcd IN (${Prisma.join(itcds)})`
          : Prisma.empty;
      })()}
  ${filters?.godown
        ? Prisma.sql`AND (tm.godown = ${parseInt(filters.godown)} OR (tm.tran_code = 11 AND tm.godown2 = ${parseInt(filters.godown)}))`
        : Prisma.empty
      }
  ${filters?.dateFrom ? Prisma.sql`AND tm.dated >= ${new Date(new Date(filters.dateFrom).setHours(0, 0, 0, 0))}` : Prisma.empty}
  ${filters?.dateTo ? Prisma.sql`AND tm.dated <= ${new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999))}` : Prisma.empty}
GROUP BY i.itcd, i.item,i.code,i.ic_id, ic.ic_name, ic.id, mc.mc_name
ORDER BY i.item ASC;
    `;

    if (!results?.length) return results ?? [];

    // Stock in hand as of To Date (else today): latest Monthly Opening +
    // movements since that month — same rule as Stock Activity. Replaces the
    // all-history (or date-range-only) sum above; the other columns are as is.
    const asOf = filters?.dateTo ? new Date(filters.dateTo) : new Date();
    asOf.setHours(23, 59, 59, 999);
    const before = new Date(asOf.getTime() + 1);
    const godownId = filters?.godown ? parseInt(filters.godown) : null;
    const stockMap = await stockQtyBefore(before, godownId, results.map((r) => r.itcd));

    // Vouchers waiting on Approvals (not posted): their qty is shown on its
    // own and Available = Stock − Pending Out (lib/stock/pendingApprovals.js)
    const pending = await getPendingByItem(results.map((r) => Number(r.itcd)), godownId);

    return results.map((r) => {
      const actualStock = stockMap.get(Number(r.itcd)) ?? 0;
      const held = pending.get(Number(r.itcd));
      return {
        ...r,
        actualStock,
        pendingIn: held?.in || 0,
        pendingOut: held?.out || 0,
        availableStock: actualStock - (held?.out || 0),
        currentStockValue: actualStock * (Number(r.avgPurchaseRate) || 0),
        potentialSaleValue: actualStock * (Number(r.avgSaleRate) || 0),
      };
    });
  } catch (err) {
    console.error("[getStockReport] ERROR:", err);
    return [];
  }
}
function calculateStockSummary(data) {
  return {
    total_items: data.length,
    total_stock: data.reduce((sum, item) => sum + (item.actualStock || 0), 0),
    total_value: data.reduce(
      (sum, item) => sum + (item.currentStockValue || 0),
      0
    ),
  };
}

async function getFGDailyUpdate(filters = {}) {
  try {
    // Settings → Production setup: the finished goods godown (where T8 lands
    // and T6 dispatches leave from) and the finished goods categories
    const prodSetup = await getProductionSetup();
    const FG_GODOWN = prodSetup.finishedGoodsGodown;
    const FG_CATEGORIES = prodSetup.finishedCategoryIds.length ? prodSetup.finishedCategoryIds : [-1];

    const parseBackendDate = (val) => {
      if (val instanceof Date) return new Date(val);
      if (typeof val === 'string') {
        const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        }
      }
      return new Date(val);
    };

    const dateFrom = parseBackendDate(filters.dateFrom);
    const dateTo = parseBackendDate(filters.dateTo);
    dateFrom.setHours(0, 0, 0, 0);
    dateTo.setHours(23, 59, 59, 999);

    const year = dateFrom.getFullYear();
    const month = dateFrom.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);

    // Opening qty in the FG godown only (lib/openingStock.js)
    const openingStocks = await getOpening(month, year, {
      godown: FG_GODOWN,
      itemWhere: {
        ic_id: { in: FG_CATEGORIES },
        ...(filters?.item ? { itcd: parseInt(filters.item) } : {}),
      },
      include: { item: true },
    });

    const itemMap = {};

    openingStocks.forEach((row) => {
      if (!row.opening_qty) return;
      itemMap[row.itcd] = {
        itcd: row.itcd,
        item: row.item?.item || "",
        code: row.item?.code || "",
        uom: "KG",
        opening: Number(row.opening_qty || 0),
        movements: {},
      };
    });

    // Post-filter itemMap by mm (partial text match on itcd) since Prisma
    // cannot do LIKE on an Int field directly.
    if (filters?.mm) {
      const mmStr = String(filters.mm).trim();
      for (const k of Object.keys(itemMap)) {
        if (!String(k).includes(mmStr)) delete itemMap[k];
      }
    }

    const fgGodownFilter = Prisma.sql`
      (
        COALESCE(t.godown, tm.godown) = ${FG_GODOWN}
        OR (tm.tran_code = 11 AND tm.godown2 = ${FG_GODOWN})
      )
    `;

    const fgRecExpr = Prisma.sql`
      SUM(
        CASE
          WHEN tm.tran_code = 11 AND tm.godown2 = ${FG_GODOWN}
            THEN t.qty
          WHEN tm.tran_code IN (8, 10, 12)
            AND COALESCE(t.godown, tm.godown) = ${FG_GODOWN}
            THEN t.qty
          ELSE 0
        END
      )
    `;

    const fgDispExpr = Prisma.sql`
      SUM(
        CASE
          WHEN tm.tran_code IN (5, 6)
            AND COALESCE(t.godown, tm.godown) = ${FG_GODOWN}
            THEN t.qty
          ELSE 0
        END
      )
    `;

    const itemFilterSql = filters?.item
      ? Prisma.sql`AND i.itcd = ${parseInt(filters.item)}`
      : Prisma.empty;
    const mmFilterSql = filters?.mm
      ? Prisma.sql`AND CAST(i.itcd AS TEXT) LIKE ${'%' + filters.mm + '%'}`
      : Prisma.empty;
    const fgCategoryFilterSql = Prisma.sql`AND i.ic_id IN (${Prisma.join(FG_CATEGORIES)})`;

    // Roll opening forward when report starts after the 1st of the month
    if (dateFrom > monthStart) {
      const rollForwardEnd = new Date(dateFrom);
      rollForwardEnd.setDate(rollForwardEnd.getDate() - 1);
      rollForwardEnd.setHours(23, 59, 59, 999);

      const priorMovements = await prisma.$queryRaw`
        SELECT
          i.itcd,
          i.item,
          i.code,
          ${fgRecExpr} AS rec,
          ${fgDispExpr} AS disp
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        JOIN "Item" i ON i.itcd = t.itcd
        WHERE tm.dated >= ${monthStart}
          AND tm.dated <= ${rollForwardEnd}
          AND ${fgGodownFilter}
          AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
          ${fgCategoryFilterSql}
          ${itemFilterSql}
          ${mmFilterSql}
        GROUP BY i.itcd, i.item, i.code
      `;

      priorMovements.forEach((row) => {
        if (!itemMap[row.itcd]) {
          itemMap[row.itcd] = {
            itcd: row.itcd,
            item: row.item,
            code: row.code,
            uom: "KG",
            opening: 0,
            movements: {},
          };
        }
        itemMap[row.itcd].opening +=
          Number(row.rec || 0) - Number(row.disp || 0);
      });
    }

    // Daily Movements
    const transactions = await prisma.$queryRaw`
  SELECT
    i.itcd,
    i.item,
    i.code,
    tm.dated::date as report_date,
    ${fgRecExpr} as rec,
    ${fgDispExpr} as disp

  FROM "Transactions" t
  JOIN "TRANSACTIONS_MASTER" tm
    ON tm.tran_id = t.tran_id
  JOIN "Item" i
    ON i.itcd = t.itcd

  WHERE tm.dated >= ${dateFrom}
  AND tm.dated <= ${dateTo}
  AND ${fgGodownFilter}
  AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
  ${fgCategoryFilterSql}
  ${itemFilterSql}
  ${mmFilterSql}

  GROUP BY
    i.itcd,
    i.item,
    i.code,
    tm.dated::date

  ORDER BY
    i.item,
    report_date
    `;

    const dates = [];

    for (
      let d = new Date(dateFrom);
      d <= dateTo;
      d.setDate(d.getDate() + 1)
    ) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
    }

    transactions.forEach((trx) => {
      const key = trx.itcd;

      if (!itemMap[key]) {
        itemMap[key] = {
          itcd: trx.itcd,
          item: trx.item,
          code: trx.code,
          uom: "KG",
          opening: 0,
          movements: {},
        };
      }

      const reportDate = new Date(trx.report_date);
      const yyyy = reportDate.getUTCFullYear();
      const mm = String(reportDate.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(reportDate.getUTCDate()).padStart(2, '0');
      const reportDateStr = `${yyyy}-${mm}-${dd}`;

      itemMap[key].movements[reportDateStr] = {
        rec: Number(trx.rec || 0),
        disp: Number(trx.disp || 0),
      };
    });

    const rows = [];

    Object.values(itemMap).forEach((item) => {
      const row = {
        itcd: item.itcd,
        item: item.item,
        code: item.code,
        uom: item.uom,
      };

      let opening = item.opening;

      dates.forEach((date) => {
        const movement =
          item.movements[date] || {};

        const rec = Number(
          movement.rec || 0
        );

        const disp = Number(
          movement.disp || 0
        );

        const closing =
          opening + rec - disp;

        row[`${date}_opn`] = opening;
        row[`${date}_rec`] = rec;
        row[`${date}_disp`] = disp;
        row[`${date}_closing`] = closing;

        opening = closing;
      });

      rows.push(row);
    });

    return rows;

  } catch (error) {
    console.error(
      "[getFGDailyUpdate]",
      error
    );

    return [];

  }
}

function calculateFGDailyUpdateSummary(data) {
  return {
    total_items: data.length,
  };
}

// Every movement column of the Stock Activity report. A row is worth showing
// when ANY of these is non-zero, and the summary totals each of them.
const STOCK_MOVEMENT_FIELDS = [
  "purchase_qty",
  "purchase_ret_qty",
  "production_qty",
  "issued_qty",
  "sale_qty",
  "sale_ret_qty",
  "pos_qty",
  "pos_ret_qty",
  "transfer_in_qty",
  "transfer_out_qty",
];

// ── Stock Activity: shared SQL pieces ────────────────────────────────────────
// Stock formula (CLAUDE.md): IN 4,8,10,12 · OUT 5,6,7,9 · transfers (11) IN
// when godown2 is the filtered godown, OUT when godown is. With no godown
// filter transfers cancel out. sub_tran_id=3 control rows never count.

const stockSignedQtySql = (godownId) => Prisma.sql`
  CASE
    WHEN tm.tran_code IN (4,8,10,12) THEN  COALESCE(t.qty, 0)
    WHEN tm.tran_code IN (5,6,7,9)   THEN -COALESCE(t.qty, 0)
    WHEN tm.tran_code = 11 THEN
      CASE
        WHEN ${godownId}::int = tm.godown2 THEN  COALESCE(t.qty, 0)
        WHEN ${godownId}::int = tm.godown  THEN -COALESCE(t.qty, 0)
        ELSE 0
      END
    ELSE 0
  END`;

// Transfer quantities. WITH a godown filter they are directional: IN when the
// filtered godown receives, OUT when it sends. WITHOUT a filter every transfer
// is both an IN (somewhere) and an OUT (somewhere else), so both columns carry
// the full transfer volume and cancel each other in the net — the report still
// foots to opening + in − out = closing.
const transferInQtySql = (godownId) =>
  godownId
    ? Prisma.sql`CASE WHEN tm.tran_code = 11 AND ${godownId}::int = tm.godown2 THEN COALESCE(t.qty,0) ELSE 0 END`
    : Prisma.sql`CASE WHEN tm.tran_code = 11 THEN COALESCE(t.qty,0) ELSE 0 END`;

const transferOutQtySql = (godownId) =>
  godownId
    ? Prisma.sql`CASE WHEN tm.tran_code = 11 AND ${godownId}::int = tm.godown THEN COALESCE(t.qty,0) ELSE 0 END`
    : Prisma.sql`CASE WHEN tm.tran_code = 11 THEN COALESCE(t.qty,0) ELSE 0 END`;

// Which transfer rows feed the "from" / "to" godown columns. Filtered: only
// the legs that touch the filtered godown. Unfiltered: every transfer leg.
const transferInScopeSql = (godownId) =>
  godownId ? Prisma.sql`AND ${godownId}::int = tm.godown2` : Prisma.empty;
const transferOutScopeSql = (godownId) =>
  godownId ? Prisma.sql`AND ${godownId}::int = tm.godown` : Prisma.empty;

const stockGodownWhereSql = (godownId) =>
  godownId
    ? Prisma.sql`AND (tm.godown = ${godownId} OR tm.godown2 = ${godownId})`
    : Prisma.empty;

/**
 * CTE body giving opening qty per item as of `startDate` (exclusive):
 * latest MonthlyOpeningStock snapshot on/before startDate + movements from
 * that snapshot's 1st up to startDate. Without any snapshot it falls back to
 * summing all history (what the report did before snapshots existed).
 * Columns: itcd, opening_qty.
 */
async function stockOpeningSql(startDate, godownId) {
  if (!startDate) {
    return Prisma.sql`SELECT NULL::int AS itcd, 0::float8 AS opening_qty WHERE FALSE`;
  }

  const period = await getLatestOpeningPeriod(startDate);
  const anchor = period ? new Date(period.year, period.month - 1, 1, 0, 0, 0, 0) : null;

  const movements = Prisma.sql`
    SELECT t.itcd, SUM(${stockSignedQtySql(godownId)}) AS qty
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    WHERE t.qty IS NOT NULL
      AND (t.sub_tran_id IS NULL OR t.sub_tran_id <> 3)
      AND tm.dated < ${startDate}
      ${anchor ? Prisma.sql`AND tm.dated >= ${anchor}` : Prisma.empty}
      ${stockGodownWhereSql(godownId)}
    GROUP BY t.itcd`;

  // Same columns either way (itcd, opening_qty) — callers read o.opening_qty.
  if (!anchor) return Prisma.sql`SELECT m.itcd, m.qty AS opening_qty FROM (${movements}) m`;

  return Prisma.sql`
    SELECT
      COALESCE(s.itcd, m.itcd)                              AS itcd,
      COALESCE(s.opening_qty, 0) + COALESCE(m.qty, 0)       AS opening_qty
    FROM (${openingQtySql(period.month, period.year, { godown: godownId })}) s
    FULL OUTER JOIN (${movements}) m ON m.itcd = s.itcd`;
}

/**
 * Stock qty per item for `itcds` strictly before `beforeDate` — the same
 * Monthly Opening + movements rule as stockOpeningSql (Stock Activity).
 * Used by the Stock / FG Stock report (closing stock) and the Stock Ledger
 * (opening). Map<itcd, qty>; an item with nothing reads 0.
 */
async function stockQtyBefore(beforeDate, godownId, itcds) {
  const ids = [...new Set(itcds.map(Number).filter(Number.isFinite))];
  if (!beforeDate || ids.length === 0) return new Map();
  const sql = await stockOpeningSql(beforeDate, godownId);
  const rows = await prisma.$queryRaw`
    SELECT x.itcd::int AS itcd, x.opening_qty::float8 AS qty
    FROM (${sql}) x
    WHERE x.itcd IN (${Prisma.join(ids)})`;
  return new Map(rows.map((r) => [Number(r.itcd), Number(r.qty) || 0]));
}

/** Period movement rows, one per item, WHERE-bounded by the report range. */
const stockPeriodWhereSql = ({ startDate, endDate, godownId }) => Prisma.sql`
  WHERE t.qty IS NOT NULL
    AND (t.sub_tran_id IS NULL OR t.sub_tran_id <> 3)
    ${startDate ? Prisma.sql`AND tm.dated >= ${startDate}` : Prisma.empty}
    ${endDate ? Prisma.sql`AND tm.dated <= ${endDate}` : Prisma.empty}
    ${stockGodownWhereSql(godownId)}`;

// Ink Series filter = Main Category ids (Item.mc_id), sent as a comma list
// ("3,7") by the multi-select.
const inkSeriesIds = (filters) =>
  String(filters?.inkSeries ?? "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter(Number.isFinite);

const inkSeriesWhereSql = (filters) => {
  const ids = inkSeriesIds(filters);
  return ids.length ? Prisma.sql`AND i.mc_id IN (${Prisma.join(ids)})` : Prisma.empty;
};

const stockItemWhereSql = (filters) => Prisma.sql`
  WHERE 1=1
    ${filters.product ? Prisma.sql`AND i.itcd = ${parseInt(filters.product)}` : Prisma.empty}
    ${filters.category ? Prisma.sql`AND i.ic_id = ${parseInt(filters.category)}` : Prisma.empty}
    ${inkSeriesWhereSql(filters)}`;

/**
 * Per-godown transfer movement for the same period, when "Godown Wise" is on.
 * Returns { byItem, godowns } where byItem maps itcd → { xin_<id>, xout_<id> }
 * and godowns lists only the godowns that actually moved stock in the period,
 * so the report shows 3-5 column pairs rather than all twelve.
 */
async function stockTransferByGodown({ startDate, endDate, godownId }) {
  const rows = await prisma.$queryRaw`
    SELECT
      t.itcd::int        AS itcd,
      tm.godown2::int    AS in_godown,
      tm.godown::int     AS out_godown,
      SUM(COALESCE(t.qty, 0))::float8 AS qty
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    ${stockPeriodWhereSql({ startDate, endDate, godownId })}
      AND tm.tran_code = 11
    GROUP BY t.itcd, tm.godown2, tm.godown
  `;
  if (rows.length === 0) return { byItem: new Map(), godowns: [] };

  const ids = new Set();
  const byItem = new Map();
  for (const r of rows) {
    const itcd = Number(r.itcd);
    const qty = Number(r.qty) || 0;
    if (!byItem.has(itcd)) byItem.set(itcd, {});
    const cell = byItem.get(itcd);
    if (r.in_godown != null) {
      ids.add(Number(r.in_godown));
      const k = `xin_${r.in_godown}`;
      cell[k] = (cell[k] || 0) + qty;
    }
    if (r.out_godown != null) {
      ids.add(Number(r.out_godown));
      const k = `xout_${r.out_godown}`;
      cell[k] = (cell[k] || 0) + qty;
    }
  }

  const names = await prisma.godown.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, godown: true },
    orderBy: { id: "asc" },
  });
  return { byItem, godowns: names.map((g) => ({ id: g.id, name: g.godown })) };
}

// Column pair per godown, appended after the transfer totals.
function stockGodownColumns(godowns) {
  return godowns.flatMap((g) => [
    { field: `xin_${g.id}`, headerName: `${g.name} IN`, width: 18, type: "number" },
    { field: `xout_${g.id}`, headerName: `${g.name} OUT`, width: 18, type: "number" },
  ]);
}

const isGodownWise = (filters) =>
  filters?.godownWise === true || filters?.godownWise === "true";

/**
 * Rows plus, when Godown Wise is on, the dynamic per-godown columns.
 * getStockActivityReport() stays a plain array for every other caller.
 */
// Vouchers waiting on Approvals (dated up to the report's To Date) — not
// posted, so not in the movements: shown as pending_in_qty / pending_out_qty,
// and available_balance = balance − pending out (lib/stock/pendingApprovals.js).
async function addPendingApprovalQty(rows, { idField, balanceField, godownId = null, endDate = null }) {
  if (!rows?.length) return rows;
  const moves = await getPendingStockMoves({
    itcds: rows.map((r) => Number(r[idField])),
    godown: godownId,
  });
  const byItem = new Map();
  for (const m of moves) {
    if (endDate && m.dated && m.dated > endDate) continue;
    if (godownId == null && m.tranCode === 11) continue; // transfers net out across godowns
    const e = byItem.get(m.itcd) || { in: 0, out: 0 };
    e.in += m.inQty;
    e.out += m.outQty;
    byItem.set(m.itcd, e);
  }
  for (const r of rows) {
    const e = byItem.get(Number(r[idField]));
    r.pending_in_qty = e?.in || 0;
    r.pending_out_qty = e?.out || 0;
    r.available_balance = (Number(r[balanceField]) || 0) - (e?.out || 0);
  }
  return rows;
}

async function getStockActivityReportWithColumns(filters = {}) {
  const rows = await getStockActivityReport(filters);
  if (!isGodownWise(filters)) return { rows, columns: null };

  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setHours(0, 0, 0, 0))
    : undefined;
  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999))
    : undefined;
  const godownId = filters.godown ? Number(filters.godown) : null;

  const { byItem, godowns } = await stockTransferByGodown({ startDate, endDate, godownId });
  // Every row carries every per-godown field so the grid never has holes.
  const blank = {};
  for (const g of godowns) { blank[`xin_${g.id}`] = 0; blank[`xout_${g.id}`] = 0; }
  for (const row of rows) Object.assign(row, blank, byItem.get(Number(row.product_code)) || {});

  return { rows, columns: godowns.length ? stockGodownColumns(godowns) : [] };
}

async function getStockActivityReport(filters = {}) {
  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setHours(0, 0, 0, 0))
    : undefined;

  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999))
    : undefined;

  const godownId = filters.godown
    ? Number(filters.godown)
    : null;

  try {
    const opening = await stockOpeningSql(startDate, godownId);

    const results = await prisma.$queryRaw`
      WITH opening AS (${opening}),

      period AS (
        SELECT
          t.itcd,
          SUM(CASE WHEN tm.tran_code = 4  THEN COALESCE(t.qty,0) ELSE 0 END) AS purchase_qty,
          SUM(CASE WHEN tm.tran_code = 9  THEN COALESCE(t.qty,0) ELSE 0 END) AS purchase_ret_qty,
          SUM(CASE WHEN tm.tran_code = 8  THEN COALESCE(t.qty,0) ELSE 0 END) AS production_qty,
          SUM(CASE WHEN tm.tran_code = 7  THEN COALESCE(t.qty,0) ELSE 0 END) AS issued_qty,
          SUM(CASE WHEN tm.tran_code = 6  THEN COALESCE(t.qty,0) ELSE 0 END) AS sale_qty,
          SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.qty,0) ELSE 0 END) AS sale_ret_qty,
          SUM(CASE WHEN tm.tran_code = 5  THEN COALESCE(t.qty,0) ELSE 0 END) AS pos_qty,
          SUM(CASE WHEN tm.tran_code = 12 THEN COALESCE(t.qty,0) ELSE 0 END) AS pos_ret_qty,
          SUM(${transferInQtySql(godownId)})                                 AS transfer_in_qty,
          SUM(${transferOutQtySql(godownId)})                                AS transfer_out_qty,
          SUM(${stockSignedQtySql(godownId)})                                AS total_qty
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        ${stockPeriodWhereSql({ startDate, endDate, godownId })}
        GROUP BY t.itcd
      )

      SELECT
        i.itcd                                  AS product_code,
        i.item                                  AS product_name,
        i.code,
        i.code                                  AS inkcode,
        ic.ic_name                              AS category,
        mc.mc_name                              AS ink_series,
        COALESCE(o.opening_qty, 0)::float8      AS opening_stock,
        COALESCE(p.purchase_qty, 0)::float8     AS purchase_qty,
        COALESCE(p.purchase_ret_qty, 0)::float8 AS purchase_ret_qty,
        COALESCE(p.production_qty, 0)::float8   AS production_qty,
        COALESCE(p.issued_qty, 0)::float8       AS issued_qty,
        COALESCE(p.sale_qty, 0)::float8         AS sale_qty,
        COALESCE(p.sale_ret_qty, 0)::float8     AS sale_ret_qty,
        COALESCE(p.pos_qty, 0)::float8          AS pos_qty,
        COALESCE(p.pos_ret_qty, 0)::float8      AS pos_ret_qty,
        COALESCE(p.transfer_in_qty, 0)::float8  AS transfer_in_qty,
        COALESCE(p.transfer_out_qty, 0)::float8 AS transfer_out_qty,
        COALESCE(p.total_qty, 0)::float8        AS total_qty,
        (COALESCE(o.opening_qty, 0) + COALESCE(p.total_qty, 0))::float8 AS stock_balance
      FROM "Item" i
      LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id
      LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
      LEFT JOIN opening o ON o.itcd = i.itcd
      LEFT JOIN period  p ON p.itcd = i.itcd
      ${stockItemWhereSql(filters)}
      ORDER BY i.item ASC;
    `;

    await addPendingApprovalQty(results, { idField: "product_code", balanceField: "stock_balance", godownId, endDate });

    // Hide only items that did nothing at all: no opening, no closing and not a
    // single movement. Testing total_qty (the NET movement) is not enough — an
    // item produced 1,500 and sold 1,500 nets to zero but clearly belongs in
    // the report, and that alone was hiding half the rows on a godown run.
    if (filters.showZeroStock === "true" || filters.showZeroStock === true) {
      return results;
    }
    const nz = (v) => Number(v) !== 0;
    return results.filter((row) =>
      STOCK_MOVEMENT_FIELDS.some((f) => nz(row[f])) ||
      nz(row.opening_stock) ||
      nz(row.stock_balance) ||
      nz(row.pending_out_qty) ||
      nz(row.pending_in_qty)
    );

  } catch (err) {
    console.error("Error generating stock activity report:", err);
    return [];
  }
}

async function getStockActivityViewReport(filters = {}) {
  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setHours(0, 0, 0, 0))
    : undefined;

  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999))
    : undefined;

  const godownId = filters.godown
    ? Number(filters.godown)
    : null;

  try {
    const opening = await stockOpeningSql(startDate, godownId);

    const results = await prisma.$queryRaw`
      WITH opening AS (${opening}),

      period AS (
        SELECT
          t.itcd,
          SUM(CASE
                WHEN tm.tran_code IN (4,8,10,12)                        THEN COALESCE(t.qty,0)
                WHEN tm.tran_code = 11 AND ${godownId}::int = tm.godown2 THEN COALESCE(t.qty,0)
                ELSE 0
              END) AS qty_in,
          SUM(CASE
                WHEN tm.tran_code IN (5,6,7,9)                          THEN COALESCE(t.qty,0)
                WHEN tm.tran_code = 11 AND ${godownId}::int = tm.godown  THEN COALESCE(t.qty,0)
                ELSE 0
              END) AS qty_out
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        ${stockPeriodWhereSql({ startDate, endDate, godownId })}
        GROUP BY t.itcd
      )

      SELECT
        i.itcd                              AS product_code,
        i.item                              AS product_name,
        i.code,
        i.code                              AS inkcode,
        ic.ic_name                          AS category,
        mc.mc_name                          AS ink_series,
        COALESCE(o.opening_qty, 0)::float8  AS opening,
        COALESCE(p.qty_in, 0)::float8       AS qty_in,
        COALESCE(p.qty_out, 0)::float8      AS qty_out,
        (COALESCE(o.opening_qty, 0) + COALESCE(p.qty_in, 0) - COALESCE(p.qty_out, 0))::float8 AS closing
      FROM "Item" i
      LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id
      LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
      LEFT JOIN opening o ON o.itcd = i.itcd
      LEFT JOIN period  p ON p.itcd = i.itcd
      ${stockItemWhereSql(filters)}
      ORDER BY
        LEFT(i.itcd::TEXT, 1) ASC,
        i.itcd::INTEGER ASC
    `;

    let finalResults = results;
    if (filters.showZeroStock !== "true") {
      finalResults = results.filter(row =>
        Number(row.opening) !== 0 ||
        Number(row.qty_in) !== 0 ||
        Number(row.qty_out) !== 0 ||
        Number(row.closing) !== 0
      );
    }

    return finalResults;

  } catch (err) {
    console.error("Error generating stock activity view report:", err);
    return [];
  }
}

// Summary strip for the Stock Activity report (config.js summaryFields:
// total_in, total_out, total_stock). In/Out follow the stock formula; transfers
// only count for the direction relative to the filtered godown, which is what
// the row-level transfer_in_qty / transfer_out_qty already encode.
// Every column on screen gets a total, so the strip foots to the grid:
//   opening + in − out = closing stock.
function calculateStockActivitySummary(data) {
  const sum = (field) =>
    data.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
  const r2 = (n) => Math.round(n * 100) / 100;

  const totals = {
    total_purchase: sum("purchase_qty"),
    total_purchase_ret: sum("purchase_ret_qty"),
    total_production: sum("production_qty"),
    total_issued: sum("issued_qty"),
    total_sale: sum("sale_qty"),
    total_sale_ret: sum("sale_ret_qty"),
    total_pos: sum("pos_qty"),
    total_pos_ret: sum("pos_ret_qty"),
    total_transfer_in: sum("transfer_in_qty"),
    total_transfer_out: sum("transfer_out_qty"),
  };

  const total_opening = sum("opening_stock");
  const total_in =
    totals.total_purchase +
    totals.total_production +
    totals.total_sale_ret +
    totals.total_pos_ret +
    totals.total_transfer_in;
  const total_out =
    totals.total_sale +
    totals.total_pos +
    totals.total_issued +
    totals.total_purchase_ret +
    totals.total_transfer_out;
  const total_movement = sum("total_qty");
  const total_stock = sum("stock_balance");

  return {
    total_items: data.length,
    total_opening: r2(total_opening),
    ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, r2(v)])),
    total_in: r2(total_in),
    total_out: r2(total_out),
    total_movement: r2(total_movement),
    total_stock: r2(total_stock),
    total_pending_out: r2(sum("pending_out_qty")),
    total_available: r2(total_stock - sum("pending_out_qty")),
  };
}

function calculateStockActivityViewSummary(data) {
  const total_opening = data.reduce((sum, item) => sum + (Number(item.opening) || 0), 0);
  const total_in = data.reduce((sum, item) => sum + (Number(item.qty_in) || 0), 0);
  const total_out = data.reduce((sum, item) => sum + (Number(item.qty_out) || 0), 0);
  const total_closing = data.reduce((sum, item) => sum + (Number(item.closing) || 0), 0);

  return {
    total_opening,
    total_in,
    total_out,
    total_closing,
  };
}

// Updated version of the getTradingMarginReport to include:
// - Purchase (4), Purchase Return (9), Sale (6), Sale Return (10), POS (5)
async function getTradingMarginReport(filters) {
  const where = {
    dated: {
      ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
      ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
    },
  };

  if (filters.item) {
    where.transactions = {
      some: {
        itcd: parseInt(filters.item),
      },
    };
  }
  // Fetch all relevant transactions (4, 5, 6, 9, 10)
  const allTransactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      transactions: {
        include: {
          itemDetails: {
            include: {
              itemCategories: true,
            },
          },
        },
      },
    },
  });

  const itemMap = new Map();

  allTransactions.forEach((t) => {
    t.transactions.forEach((line) => {
      if (!line.itcd) return;

      const itemId = line.itcd;
      if (!itemMap.has(itemId)) {
        itemMap.set(itemId, {
          itemDetails: line.itemDetails,

          // Quantities
          purchase_qty: 0,
          purchase_return_qty: 0,
          sale_qty: 0,
          sale_return_qty: 0,
          pos_qty: 0,

          // Amounts
          purchase_amount: 0,
          purchase_return_amount: 0,
          sale_amount: 0,
          sale_return_amount: 0,
          pos_amount: 0,
        });
      }

      const itemData = itemMap.get(itemId);

      switch (t.tran_code) {
        case 4: // Purchase
          itemData.purchase_qty += line.qty || 0;
          itemData.purchase_amount += line.damt || 0;
          break;

        case 9: // Purchase Return
          itemData.purchase_return_qty += line.qty || 0;
          itemData.purchase_return_amount += line.camt || 0;
          break;

        case 6: // Sale
          itemData.sale_qty += line.qty || 0;
          itemData.sale_amount += line.camt || 0;
          break;

        case 10: // Sale Return
          itemData.sale_return_qty += line.qty || 0;
          itemData.sale_return_amount += line.damt || 0;
          break;

        case 5: // POS
          itemData.pos_qty += line.qty || 0;
          itemData.pos_amount += line.gross_amount || 0;
          break;
      }
    });
  });

  const marginData = Array.from(itemMap.values()).map((item) => {
    const total_purchase_qty = item.purchase_qty - item.purchase_return_qty;

    const total_purchase_amount =
      item.purchase_amount - item.purchase_return_amount;

    const total_sale_qty = item.sale_qty + item.pos_qty - item.sale_return_qty;

    const total_sale_amount =
      item.sale_amount + item.pos_amount - item.sale_return_amount;

    const avg_purchase_rate =
      total_purchase_qty > 0 ? total_purchase_amount / total_purchase_qty : 0;

    const avg_sale_rate =
      total_sale_qty > 0 ? total_sale_amount / total_sale_qty : 0;

    const margin = total_sale_amount - total_purchase_amount;

    const margin_percent =
      total_purchase_amount > 0 ? (margin / total_purchase_amount) * 100 : 0;

    return {
      ...item,
      avg_purchase_rate,
      avg_sale_rate,
      margin,
      margin_percent,
    };
  });

  if (filters.category) {
    const categoryId = parseInt(filters.category);
    return marginData.filter(
      (item) => item.itemDetails?.itemCategories?.id === categoryId
    );
  }

  return marginData;
}

function calculateTradingMarginSummary(data) {
  const total_purchase_qty = data.reduce(
    (sum, item) => sum + item.purchase_qty,
    0
  );
  const total_purchase_amount = data.reduce(
    (sum, item) => sum + item.purchase_amount,
    0
  );
  const total_sale_qty = data.reduce((sum, item) => sum + item.sale_qty, 0);
  const total_sale_amount = data.reduce(
    (sum, item) => sum + item.sale_amount,
    0
  );

  const total_pos_qty = data.reduce((sum, item) => sum + item.pos_qty, 0);
  const total_pos_amount = data.reduce((sum, item) => sum + item.pos_amount, 0);
  const total_sale_return_qty = data.reduce(
    (sum, item) => sum + item.sale_return_qty,
    0
  );
  const total_sale_return_amount = data.reduce(
    (sum, item) => sum + item.sale_return_amount,
    0
  );
  const total_purchase_return_qty = data.reduce(
    (sum, item) => sum + item.purchase_return_qty,
    0
  );
  const total_purchase_return_amount = data.reduce(
    (sum, item) => sum + item.purchase_return_amount,
    0
  );
  const total_margin = total_sale_amount - total_purchase_amount;
  const avg_margin_percent =
    total_purchase_amount > 0
      ? (total_margin / total_purchase_amount) * 100
      : 0;

  return {
    total_purchase_qty,
    total_purchase_amount,
    total_pos_qty,
    total_pos_amount,
    total_sale_return_qty,
    total_sale_return_amount,
    total_purchase_return_qty,
    total_purchase_return_amount,

    total_sale_qty,
    total_sale_amount,
    total_margin,
    avg_margin_percent,
  };
}

async function getStockLedgerReport(filters) {
  let { item, dateFrom, dateTo } = filters;

  if (!dateFrom) dateFrom = "2000-01-01";
  if (!dateTo) dateTo = new Date().toISOString().split('T')[0];
  if (!item) item = 1000004;

  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setHours(0, 0, 0, 0))
    : undefined;

  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999))
    : undefined;

  // Opening as of dateFrom: latest Monthly Opening + movements since that
  // month (same rule as Stock Activity). The opening table has no batch, so a
  // Batch No filter keeps the old all-history sum for that batch.
  const openingBalance = filters.batchNo || !startDate
    ? await getOpeningBalanceRaw(
        item,
        filters.godown,
        startDate,
        endDate,
        filters.batchNo
      )
    : (await stockQtyBefore(
        startDate,
        filters.godown ? parseInt(filters.godown) : null,
        [parseInt(item)],
      )).get(parseInt(item)) ?? 0;

  const godownValue = filters.godown ? parseInt(filters.godown) : undefined;

  // Get all transactions for the item
  const where = {
    dated: {
      gte: startDate,
      lte: endDate,
    },
    transactions: {
      some: {
        itcd: parseInt(item),
        ...(filters.batchNo && { batch_no: filters.batchNo })
      },
    },
    ...(godownValue ? { OR: [{ godown: godownValue }, { godown2: godownValue }] } : {}),
  };

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      acno: true,
      godownDetails: true,
      transactions: {
        where: {
          itcd: parseInt(item),
          ...(filters.batchNo && { batch_no: filters.batchNo })
        },
        include: {
          itemDetails: true,
          godownDetails: true,
        },
      },
    },
    orderBy: {
      dated: "asc",
    },
  });

  // Format the data
  const ledgerData = [];
  let runningBalance = openingBalance;

  // Add opening balance row
  ledgerData.push({
    dated: format(new Date(dateFrom), "MMM dd, yyyy"),
    transaction_no: "OPENING",
    grn_no: "",
    transaction_type: "Opening Balance",
    vendor_customer: "",
    opening_qty: runningBalance,
    qty_in: 0,
    qty_out: 0,
    closing_qty: runningBalance,
    rate: 0,
    amount: 0,
  });

  // Process each transaction
  transactions.forEach((t) => {
    t.transactions
      .filter((tran) => tran.sub_tran_id !== 3)
      .forEach((line) => {
        const opening = runningBalance;
        let qtyIn = 0;
        let qtyOut = 0;

        // Updated logic with 7 (Issue) and 8 (Production)
        if (t.tran_code === 4 || t.tran_code === 8 || t.tran_code === 10 || t.tran_code === 12) {
          // Purchase (4), Production (8), or Sale Return (10,12) - add to stock
          qtyIn = line.qty || 0;
        } else if (
          t.tran_code === 5 ||
          t.tran_code === 6 ||
          t.tran_code === 7 ||
          t.tran_code === 9
        ) {
          // Sale (5,6), Issue (7), or Purchase Return (9) - remove from stock
          qtyOut = line.qty || 0;
        } else if (t.tran_code === 11) {
          // Transfer handling
          if (filters.godown) {
            if (t.godown2 === parseInt(filters.godown)) {
              // Transfer in to this godown
              qtyIn = line.qty || 0;
            } else if (t.godown === parseInt(filters.godown)) {
              // Transfer out from this godown
              qtyOut = line.qty || 0;
            }
          }
          // If no specific godown, transfers cancel out in ledger
        }

        runningBalance += qtyIn - qtyOut;

        // Determine amount based on transaction type
        let amount = 0;
        if (t.tran_code === 4 || t.tran_code === 8) {
          // Purchase or Production - use damt
          amount = line.damt || 0;
        } else if (t.tran_code === 5 || t.tran_code === 6) {
          // Sale - use camt
          amount = line.camt || 0;
        } else if (t.tran_code === 7) {
          // Issue - use camt (consumption)
          amount = line.camt || 0;
        } else if (t.tran_code === 9) {
          // Purchase Return - use camt
          amount = line.camt || 0;
        } else if (t.tran_code === 10 || t.tran_code === 12) {
          // Sale Return - use damt
          amount = line.damt || 0;
        }

        ledgerData.push({
          // The voucher behind the line — the report's "Open voucher" drill
          // (CLAUDE.md rule 15, lib/vouchers/voucherLink.js). rmk1 picks the
          // landed Material Issue page for tran_code 7.
          tran_id: t.tran_id,
          tran_code: t.tran_code,
          rmk1: t.rmk1 ?? null,
          dated: format(new Date(t.dated), "MMM dd, yyyy"),
          transaction_no: t.vr_no,
          reference_no: t.grn_no || t.dispatch_no || t.rmk5 || t.vr_no || "",
          transaction_type: getTransactionTypeLabel(t.tran_code),
          vendor_customer: t.acno?.acname || "",
          item_name: line.itemDetails?.iname || "",
          transactions: Array(line),
          opening_qty: opening,
          qty_in: qtyIn,
          qty_out: qtyOut,
          closing_qty: runningBalance,
          rate: line.rate,
          amount: amount,
        });
      });
  });

  // Vouchers waiting on Approvals (lib/stock/pendingApprovals.js): not posted,
  // listed after the posted rows. Pending OUT comes off the balance (that qty
  // is spoken for); pending IN is shown but not added until it is approved.
  // No batch on a held voucher's reservation, so a Batch No run leaves them out.
  if (!filters.batchNo) {
    const pending = await getPendingStockMoves({ itcds: [parseInt(item)], godown: godownValue ?? null });
    for (const m of pending) {
      if (endDate && m.dated && m.dated > endDate) continue;
      if (godownValue == null && m.tranCode === 11) continue; // transfers net out across godowns
      const opening = runningBalance;
      runningBalance -= m.outQty;
      ledgerData.push({
        dated: format(new Date(m.dated), "MMM dd, yyyy"),
        transaction_no: m.ref,
        reference_no: m.action === "update" ? `Edit of #${m.targetId}` : "",
        transaction_type: `${getTransactionTypeLabel(m.tranCode)} — PENDING APPROVAL`,
        vendor_customer: `Requested by ${m.requestedBy}`,
        item_name: "",
        opening_qty: opening,
        qty_in: m.inQty,
        qty_out: m.outQty,
        closing_qty: runningBalance,
        rate: 0,
        amount: 0,
        is_pending: true,
      });
    }
  }

  return ledgerData;
}

// Updated opening balance function using raw query
async function getOpeningBalanceRaw(itemId, godown, dateFrom, dateTo, batchNo) {
  const itcd = parseInt(itemId);
  const fromDate = new Date(dateFrom);
  const toDate = new Date(dateTo);

  if (godown) {
    const stockResult = await prisma.$queryRaw`
      SELECT SUM(
        CASE 
          WHEN tm.tran_code IN (4, 8, 10, 12) AND tm.godown = ${Number(
      godown
    )} THEN t.qty  -- Purchase, Production, Sale Return (add to stock)
          WHEN tm.tran_code IN (5, 6, 7, 9) AND tm.godown = ${Number(
      godown
    )} THEN -t.qty  -- Sale, POS, Issue, Purchase Return (remove from stock)
          WHEN tm.tran_code = 11 AND tm.godown = ${Number(
      godown
    )} THEN -t.qty  -- Transfer out
          WHEN tm.tran_code = 11 AND tm.godown2 = ${Number(
      godown
    )} THEN t.qty   -- Transfer in
          ELSE 0
        END
      ) as stock
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      WHERE t.itcd = ${itcd} 
      ${batchNo ? Prisma.sql`AND t.batch_no = ${batchNo}` : Prisma.empty}
      AND tm.dated < ${fromDate}::timestamp
      AND (tm.godown2 = ${Number(godown)} OR tm.godown = ${Number(godown)})
    `;
    return stockResult[0]?.stock || 0;
  } else {
    // Calculate opening balance across all godowns
    const stockResult = await prisma.$queryRaw`
      SELECT SUM(
        CASE 
          WHEN tm.tran_code IN (4, 8, 10, 12) THEN t.qty  -- Purchase, Production, Sale Return (add to stock)
          WHEN tm.tran_code IN (5, 6, 7, 9) THEN -t.qty  -- Sale, POS, Issue, Purchase Return (remove from stock)
          WHEN tm.tran_code = 11 THEN 0  -- Transfers cancel out when summing all godowns
          ELSE 0
        END
      ) as stock
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      WHERE t.itcd = ${itcd} 
      ${batchNo ? Prisma.sql`AND t.batch_no = ${batchNo}` : Prisma.empty}
      AND tm.dated < ${fromDate}
    `;
    return stockResult[0]?.stock || 0;
  }
}


function calculateStockLedgerSummary(data) {
  // Posted rows only; vouchers pending approval are totalled on their own
  const posted = data.filter((r) => !r.is_pending);
  const pending = data.filter((r) => r.is_pending);
  const total_in = posted.reduce((sum, item) => sum + (item.qty_in || 0), 0);
  const total_out = posted.reduce((sum, item) => sum + (item.qty_out || 0), 0);
  const pending_out = pending.reduce((sum, item) => sum + (item.qty_out || 0), 0);
  const closing_balance = posted.length > 0 ? posted[posted.length - 1].closing_qty : 0;

  return {
    total_in,
    total_out,
    net_movement: total_in - total_out,
    closing_balance,
    pending_in: pending.reduce((sum, item) => sum + (item.qty_in || 0), 0),
    pending_out,
    available_balance: closing_balance - pending_out,
  };
}

// Helper functions
function getTransactionCodesForType(type) {
  switch (type) {
    case "purchase":
      return [4];
    case "sale":
      return [6];
    case "purchaseReturn":
      return [9];
    case "saleReturn":
      return [10];
    default:
      return [4, 6, 9, 10]; // All
  }
}

// Helper function to get transaction type label
function getTransactionTypeLabel(tranCode, subTranId = null) {
  const tranTypes = {
    1: subTranId === 2 ? "Receipt Deduction" : "Receipt",
    2: subTranId === 2 ? "Payment Deduction" : "Payment",
    3: "Journal",
    4: "Purchase Invoice",
    5: "POS",
    6: "Sale Invoice",
    7: "Issue",
    8: "Production",
    9: "Purchase Return",
    10: "Sale Return",
    11: "Inter-Godown Transfer",
    12: "POS Sale Return",
  };
  return tranTypes[tranCode] || "Unknown";
}

async function getOpeningStock(productId, godownId, dateFrom) {
  const transactions = await prisma.transactionsMaster.findMany({
    where: {
      ...(dateFrom && {
        dated: {
          lt: new Date(dateFrom),
        },
      }),
      ...(godownId && {
        godown: parseInt(godownId),
      }),
      ...(productId && {
        transactions: {
          some: {
            itcd: parseInt(productId),
            NOT: { sub_tran_id: 3 },
          },
        },
      }),
    },
    include: {
      transactions: productId
        ? {
          where: {
            itcd: parseInt(productId),
            NOT: { sub_tran_id: 3 },
          },
        }
        : {
          where: {
            NOT: { sub_tran_id: 3 },
          },
        },
    },
  });

  const stockMap = {};

  transactions.forEach((tranMaster) => {
    (tranMaster.transactions || []).forEach((tran) => {
      const pid = tran.itcd;
      const qty = tran.qty || 0;

      if (!stockMap[pid]) {
        stockMap[pid] = 0;
      }

      switch (tranMaster.tran_code) {
        case 4: // Purchase
        case 10: // Sale Return
          stockMap[pid] += qty;
          break;
        case 6: // Sale
        case 9: // Purchase Return
        case 5: // POS
          stockMap[pid] -= qty;
          break;
      }
    });
  });

  if (productId) {
    return stockMap[parseInt(productId)] || 0;
  } else {
    return stockMap;
  }
}

async function getTransactionReport(tran_code, filters) {
  const where = {
    tran_code,
    dated: {
      ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
      ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
    },
    // pycd: {
    //   in: [2, 3, 222],
    // },
  };

  const transactionSome = {};

  if (filters.region) {
    transactionSome.acnoDetails = {
      subCategory: filters.region === "NORTH" ? "N" : "S",
    };
  }

  if (filters.customer) {
    transactionSome.acno = Number(filters.customer);
  }

  // Sales person filter — userid from OrderMaster via linked sale invoice
  const salePersonVal = parseMultiFilter(filters.sale_person, false);
  if (salePersonVal !== null && tran_code === 1) {
    const saleInvoices = await prisma.transactionsMaster.findMany({
      where: {
        tran_code: 6,
        invoice_no: { not: null, notIn: ["", "null"] },
        ordersSO: { userid: salePersonVal },
      },
      select: { invoice_no: true },
    });
    const invoiceNos = [...new Set(saleInvoices.map((s) => s.invoice_no).filter(Boolean))];
    if (invoiceNos.length === 0) {
      return [];
    }
    transactionSome.invoice_no = { in: invoiceNos };
  }

  if (Object.keys(transactionSome).length > 0) {
    where.transactions = { some: transactionSome };
  }

  if (filters.account) {
    where.pycd = filters.account;
  }

  // Support filtering by related service id (for service entry/invoice)
  if (filters.service_id || filters.service) {
    where.service_id = Number(filters.service_id || filters.service);
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,

    include: {
      acno: true,
      ordersSO: true,
      transactions: {
        include: {
          acnoDetails: true,
        }
      },
    },

    orderBy: {
      dated: "desc",
    },
  });

  return transactions.map((t) => {
    let totalDamt = 0;
    let totalCamt = 0;

    // Loop through child transactions
    t.transactions
      ?.filter((t) => t.sub_tran_id !== 3)
      .forEach((tran) => {
        totalDamt += tran.damt || 0;
        totalCamt += tran.camt || 0;
      });

    // Optionally calculate net amount
    let netAmount;
    if (t.tran_code === 1) {
      netAmount = totalCamt - totalDamt; // For receipts, net is credit - debit
    } else if (t.tran_code === 2) {
      netAmount = totalDamt - totalCamt; // For payments, net is debit - credit
    }

    // The voucher's lines, for the group detail view. Main lines first, then
    // deductions. sub_tran_id=3 is the generated cash/bank contra, not a real
    // line of the voucher, so it is left out here exactly as it is left out of
    // totalDamt/totalCamt above — the lines shown always add up to the master
    // row's amount.
    const lines = [...(t.transactions || [])]
      .filter((line) => line.sub_tran_id !== 3)
      .sort(
        (a, b) =>
          (a.sub_tran_id || 1) - (b.sub_tran_id || 1) || (a.id || 0) - (b.id || 0)
      )
      .map((line) => ({
        sub_tran_id: line.sub_tran_id || 1,
        acno: line.acno || "",
        acname: line.acnoDetails?.acname || "",
        chno: line.chno || "",
        check_date: line.check_date
          ? new Date(line.check_date).toLocaleDateString()
          : "",
        invoice_no: line.invoice_no || "",
        damt: line.damt || 0,
        camt: line.camt || 0,
        narration: line.narration1 || "",
      }));

    // Cheque / TID numbers off the lines — TRANSACTIONS_MASTER.check_no is
    // almost always empty because the app writes the number on each line, and
    // a voucher can carry several. Distinct, in line order.
    const lineChequeNos = [
      ...new Set(lines.map((l) => l.chno).filter(Boolean)),
    ].join(", ");

    return {
      tran_id: t.tran_id,
      // Voucher drill (CLAUDE.md rule 15); service_id picks Service Entry on 20.
      tran_code: t.tran_code,
      dated: new Date(t.dated).toLocaleDateString(),
      vr_no: t.vr_no || "",
      service_id: t.service_id || "",
      acno: t.pycd || "",
      account: t.acno?.acname || "",
      chno: lineChequeNos,
      check_no: t.check_no || lineChequeNos,
      customer:
        t.transactions.length > 0
          ? t.transactions[0]?.acnoDetails?.acname
          : "",
      amount: netAmount || 0,
      damt: totalDamt,
      camt: totalCamt,
      region:
        t.transactions.length > 0
          ? (t.transactions[0]?.acnoDetails?.subCategory === "N"
            ? "NORTH"
            : t.transactions[0]?.acnoDetails?.subCategory === "S"
              ? "SOUTH"
              : t.transactions[0]?.acnoDetails?.subCategory || "")
          : "",

      narration: t.rmk || t.rmk1 || "",
      line_count: lines.length,
      transactions: lines,
    };
  });
}

function calculateTransactionSummary(data) {
  const totalDamt = data.reduce((sum, t) => sum + (t.damt || 0), 0);
  const totalCamt = data.reduce((sum, t) => sum + (t.camt || 0), 0);
  const totalNet = data.reduce((sum, t) => sum + (t.amount || 0), 0);

  return {
    total_transactions: data.length,
    total_damt: totalDamt,
    total_camt: totalCamt,
    total_net: totalNet,
  };
}

// True when the report should render as the grouped detail view rather than
// one row per voucher. Driven by the "view" filter the receipt/payment/journal
// configs declare.
const wantsVoucherDetailRows = (filters) => filters?.view === "detailView";

// Flatten the voucher list into the row stream ReportViewer's grouped detail
// view expects: a voucher_header, its lines as detail_row, then a
// voucher_total — each tagged with row_type, which is what config
// .groupedDetailView.rowTypes keys off.
//
// Only sub_tran_id 1 and 2 lines appear; getTransactionReport has already
// dropped the sub_tran_id=3 contra, so a voucher's detail rows always sum to
// the header and total rows beside them.
function toVoucherDetailRows(vouchers) {
  const rows = [];

  vouchers.forEach((voucher) => {
    rows.push({
      row_type: "voucher_header",
      tran_id: voucher.tran_id,
      tran_code: voucher.tran_code,
      dated: voucher.dated,
      vr_no: voucher.vr_no,
      account: voucher.account,
      chno: voucher.chno,
      damt: voucher.damt,
      camt: voucher.camt,
      narration: voucher.narration,
    });

    (voucher.transactions || []).forEach((line) => {
      rows.push({
        row_type: "detail_row",
        // Carried on every line so an exported detail row can still be traced
        // back to its voucher, even though the column is blanked on screen.
        tran_id: voucher.tran_id,
        tran_code: voucher.tran_code,
        dated: "",
        vr_no: "",
        account: line.acname || String(line.acno || ""),
        chno: line.chno,
        damt: line.damt,
        camt: line.camt,
        narration: line.narration,
      });
    });

    rows.push({
      row_type: "voucher_total",
      tran_id: voucher.tran_id,
      label: `Voucher ${voucher.vr_no || ""} Total`,
      damt: voucher.damt,
      camt: voucher.camt,
    });
  });

  return rows;
}

export async function getAccountLedger(filters) {
  let { dateFrom, dateTo, account } = filters;

  // ── Normalize inputs ────────────────────────────────────────────────────────
  if (!account) account = 2;

  let accountArray = [];
  if (Array.isArray(account)) {
    accountArray = account.map(Number);
  } else if (typeof account === "string" && account.includes(",")) {
    accountArray = account.split(",").map(Number);
  } else {
    accountArray = [Number(account)];
  }

  if (!dateFrom) dateFrom = "2000-01-01";
  if (!dateTo) dateTo = new Date().toISOString().split("T")[0];

  // ── Query 1: Opening balance per account (everything BEFORE dateFrom) ───────
  // Returns a real JS number via ::float8 — no BigInt / string issues
  const openingRows = await prisma.$queryRaw`
    SELECT
      t.acno::int                                                AS acno,
      COALESCE(
        SUM(
          CASE
            WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN  COALESCE(t.damt, 0)
            WHEN tm.tran_code = 2 AND t.sub_tran_id = 1      THEN  COALESCE(t.damt, 0)
            WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN  COALESCE(t.damt, 0)
            ELSE 0
          END
          -
          CASE
            WHEN tm.tran_code = 1 AND t.sub_tran_id = 1      THEN  COALESCE(t.camt, 0)
            WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN  COALESCE(t.camt, 0)
            WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN  COALESCE(t.camt, 0)
            ELSE 0
          END
        )::float8
      , 0)                                                       AS opening_balance
    FROM "Transactions" t
    INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    WHERE t.acno        = ANY(${accountArray}::int[])
      AND tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
      AND tm.dated      < ${dateFrom}::date
    GROUP BY t.acno;
  `;

  // Account names for every requested account, so an account with no movement
  // in the period still shows its name on the opening row (and in any grouping
  // header) instead of a bare number.
  const nameRows = await prisma.aCNO.findMany({
    where: { acno: { in: accountArray } },
    select: { acno: true, acname: true },
  });
  const nameMap = Object.fromEntries(nameRows.map((r) => [Number(r.acno), r.acname || ""]));

  // Build a quick lookup: acno -> opening_balance
  const openingMap = {};
  for (const row of openingRows) {
    openingMap[Number(row.acno)] = Number(row.opening_balance) || 0;
  }

  // ── Query 2: Period transactions (dateFrom → dateTo) ────────────────────────
  // balance_movement is the running net movement within the period only.
  // Final balance = openingMap[acno] + balance_movement  (done in JS below)
  const periodRows = await prisma.$queryRaw`
    SELECT
      t.tran_id::int                                             AS tran_id,
      tm.tran_code::int                                          AS tran_code,
      t.acno::int                                                AS acno,
      tm.dated::date                                             AS dated,
      tm.vr_no::int                                             AS vr_no,
      tm.invoice_no                                              AS invoice_no,
      t.invoice_no                                               AS detail_invoice_no,
      tm.rmk5                                                    AS rmk5,
      t.id::int                                                  AS line_id,
      tm.pycd::int                                               AS pycd,
      tm.rmk                                                     AS voucher_rmk,
      -- Who entered the voucher: TRANSACTIONS_MASTER.user_id = "User".id
      -- (app users); legacy imported vouchers carry a "Users".user_id code.
      COALESCE(
        NULLIF(u.name, ''), NULLIF(u.username, ''), NULLIF(lu.user_name, ''), NULLIF(tm.user_id, '')
      )                                                          AS user_name,
      -- Receipt / Payment lines keep their "Slip #" in narration5: it is its
      -- own column there (slip_no) and stays out of the narration text.
      CASE WHEN tm.tran_code IN (1,2) THEN NULLIF(t.narration5, '') END AS slip_no,
      CONCAT_WS(' ',
        NULLIF(t.narration1, ''), NULLIF(t.narration2, ''), NULLIF(t.narration3, ''),
        NULLIF(t.narration4, ''),
        CASE WHEN tm.tran_code IN (1,2) THEN NULL ELSE NULLIF(t.narration5, '') END
      )                                                          AS line_narration,
      CASE tm.tran_code
        WHEN 1  THEN 'Receipt'
        WHEN 2  THEN 'Payment'
        WHEN 3  THEN 'Journal'
        WHEN 4  THEN 'Purchase Invoice'
        WHEN 5  THEN 'POS'
        WHEN 6  THEN 'Sale Invoice'
        WHEN 9  THEN 'Purchase Return'
        WHEN 10 THEN 'Sale Return'
        WHEN 12 THEN 'POS Return'
        ELSE         'Other'
      END                                                        AS tran_type,
      t.sub_tran_id::int                                         AS sub_tran_id,
      -- Debit amount for this account on this voucher line
      CASE
        WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt, 0)
        WHEN tm.tran_code = 2 AND t.sub_tran_id = 1      THEN COALESCE(t.damt, 0)
        WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN COALESCE(t.damt, 0)
        ELSE 0
      END::float8                                                AS debit,
      -- Credit amount for this account on this voucher line
      CASE
        WHEN tm.tran_code = 1 AND t.sub_tran_id = 1      THEN COALESCE(t.camt, 0)
        WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt, 0)
        WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN COALESCE(t.camt, 0)
        ELSE 0
      END::float8                                                AS credit,
      -- Running net movement within the period (opening added in JS)
      SUM(
        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt, 0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1      THEN COALESCE(t.damt, 0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN COALESCE(t.damt, 0)
          ELSE 0
        END
        -
        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1      THEN COALESCE(t.camt, 0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt, 0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN COALESCE(t.camt, 0)
          ELSE 0
        END
      ) OVER (
        PARTITION BY t.acno
        ORDER BY tm.dated, tm.vr_no, t.sub_tran_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::float8                                                  AS balance_movement,
      a.acname,
      CONCAT_WS(' ',
        NULLIF(tm.rmk,         ''),
        NULLIF(t.narration1,   ''),
        NULLIF(t.narration2,   ''),
        NULLIF(t.narration3,   ''),
        NULLIF(t.narration4,   ''),
        CASE WHEN tm.tran_code IN (1,2) THEN NULL ELSE NULLIF(t.narration5, '') END
      )                                                          AS narration
    FROM "Transactions" t
    INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    LEFT  JOIN "acno"                a  ON a.acno     = t.acno
    LEFT  JOIN "User"                u  ON u.id       = tm.user_id
    LEFT  JOIN "Users"               lu ON lu.user_id = tm.user_id
    WHERE t.acno        = ANY(${accountArray}::int[])
      AND tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
      AND tm.dated BETWEEN ${dateFrom}::date AND ${dateTo}::date
    ORDER BY tm.dated, tm.vr_no, t.sub_tran_id;
  `;

  // ── Query 3: Counterpart accounts for each voucher (the "against" column) ───
  // Excludes the viewing account(s) — only opposite legs of the same voucher
  const tranIds = [...new Set(periodRows.map((r) => Number(r.tran_id)))];
  let counterparts = [];
  if (tranIds.length > 0) {
    counterparts = await prisma.$queryRaw`
      SELECT
        t.tran_id::int   AS tran_id,
        tm.vr_no::int    AS vr_no,
        t.acno::int      AS acno,
        t.sub_tran_id::int AS sub_tran_id,
        t.damt::float8   AS debit,
        t.camt::float8   AS credit,
        a.acname,
        a.macno::int     AS macno,
        t.id::int        AS line_id,
        CASE WHEN tm.tran_code IN (1,2) THEN NULLIF(t.narration5, '') END AS slip_no,
        CONCAT_WS(' ',
          NULLIF(t.narration1, ''), NULLIF(t.narration2, ''), NULLIF(t.narration3, ''),
          NULLIF(t.narration4, ''),
          CASE WHEN tm.tran_code IN (1,2) THEN NULL ELSE NULLIF(t.narration5, '') END
        )                AS line_narration
      FROM "Transactions" t
      LEFT JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "acno" a ON a.acno = t.acno
      WHERE t.tran_id = ANY(${tranIds}::int[])
        AND t.acno   != ALL(${accountArray}::int[])
      ORDER BY t.tran_id, t.sub_tran_id, t.id;
    `;
  }

  // Group counterparts by tran_id
  const counterpartMap = {};
  for (const c of counterparts) {
    const key = Number(c.tran_id);
    if (!counterpartMap[key]) counterpartMap[key] = [];
    counterpartMap[key].push({
      ...c,
      tran_id: Number(c.tran_id),
      vr_no: Number(c.vr_no),
      acno: Number(c.acno),
      sub_tran_id: Number(c.sub_tran_id),
      debit: Number(c.debit) || 0,
      credit: Number(c.credit) || 0,
      macno: Number(c.macno) || null,
    });
  }

  // ── Build final output ───────────────────────────────────────────────────────
  // Group period rows by account
  const groupedByAccount = {};
  for (const r of periodRows) {
    const acno = Number(r.acno);
    if (!groupedByAccount[acno]) groupedByAccount[acno] = [];

    const opening = openingMap[acno] || 0;
    const balanceMovement = Number(r.balance_movement) || 0;

    groupedByAccount[acno].push({
      tran_id: Number(r.tran_id),
      // This account's own Transactions line (Sub Account lookup, lib/reports/subAccountLedger.js)
      line_id: r.line_id != null ? Number(r.line_id) : null,
      // Voucher drill (CLAUDE.md rule 15)
      tran_code: r.tran_code != null ? Number(r.tran_code) : null,
      acno,
      dated: r.dated,
      vr_no: Number(r.vr_no),
      invoice_no: r.invoice_no || null,
      detail_invoice_no: r.detail_invoice_no || r.invoice_no,
      rmk5: r.rmk5 || null,
      tran_type: r.tran_type,
      sub_tran_id: Number(r.sub_tran_id),
      debit: Number(r.debit) || 0,
      credit: Number(r.credit) || 0,
      // ✅ opening + running period movement = correct running balance
      balance: Number((opening + balanceMovement).toFixed(2)),
      acname: r.acname || "",
      narration: r.narration || "",
      user_name: r.user_name || "",
      // This line's own Slip # (receipt / payment only); buildLedgerRows fills
      // the header row's from its voucher's lines.
      slip_no: r.slip_no || null,
      isOpening: false,
      transactions: counterpartMap[Number(r.tran_id)] || [],
    });
  }

  // Every line of every voucher (viewed accounts + counter accounts), each with
  // its effect under the ledger Dr/Cr rules — the "Against account" column and
  // the Detailed option (lib/reports/ledgerDetail.js) read it.
  const vouchers = new Map();
  const voucherOf = (id) => {
    if (!vouchers.has(id)) vouchers.set(id, { pycd: null, rmk: "", tran_code: null, lines: [] });
    return vouchers.get(id);
  };
  for (const r of periodRows) {
    const v = voucherOf(Number(r.tran_id));
    v.pycd = r.pycd != null ? Number(r.pycd) : null;
    v.rmk = r.voucher_rmk || "";
    v.tran_code = Number(r.tran_code);
    v.lines.push({
      id: Number(r.line_id),
      acno: Number(r.acno),
      acname: r.acname || "",
      sub_tran_id: Number(r.sub_tran_id),
      effect: (Number(r.debit) || 0) - (Number(r.credit) || 0),
      narration: r.line_narration || "",
      slip_no: r.slip_no || null,
    });
  }
  for (const c of counterparts) {
    const v = voucherOf(Number(c.tran_id));
    const { debit, credit } = ledgerDrCr(v.tran_code, c.sub_tran_id, c.debit, c.credit);
    v.lines.push({
      id: Number(c.line_id),
      acno: c.acno != null ? Number(c.acno) : null,
      acname: c.acname || "",
      sub_tran_id: Number(c.sub_tran_id),
      effect: debit - credit,
      narration: c.line_narration || "",
      slip_no: c.slip_no || null,
    });
  }
  for (const v of vouchers.values()) {
    v.lines.sort((a, b) => a.sub_tran_id - b.sub_tran_id || a.id - b.id);
  }
  const detailed = wantsLedgerDetail(filters);

  // One opening row per account, then its transactions in date order
  const final = [];
  for (const acno of accountArray) {
    const rows = buildLedgerRows(groupedByAccount[acno] || [], vouchers, { detailed });
    const opening = openingMap[acno] || 0;
    const acname = (rows.length > 0 ? rows[0].acname : "") || nameMap[acno] || "";

    final.push({
      tran_id: null,
      acno,
      dated: dateFrom,
      vr_no: null,
      rmk5: null,
      invoice_no: null,
      detail_invoice_no: null,
      tran_type: "Opening Balance",
      sub_tran_id: null,
      debit: null,
      credit: null,
      balance: opening,   // ✅ always a JS number
      acname,
      narration: "",
      against: "",
      user_name: "",
      slip_no: null,
      isOpening: true,
      transactions: [],
    });

    final.push(...rows);
  }

  return final;
}

export function calculateAccountLedgerSummary(data) {
  // Build per-account summary
  const accountMap = {};
  for (const row of data) {
    const key = Number(row.acno);
    if (!accountMap[key]) accountMap[key] = { acno: key, acname: row.acname || "", debit: 0, credit: 0, lastBalance: 0 };
    if (row.acname && !accountMap[key].acname) accountMap[key].acname = row.acname;
    if (row.isOpening) continue;
    accountMap[key].debit += Number(row.debit) || 0;
    accountMap[key].credit += Number(row.credit) || 0;
    accountMap[key].lastBalance = Number(row.balance) || 0;
  }

  const accounts = Object.values(accountMap).map((acc) => ({
    acno: acc.acno,
    acname: acc.acname,
    debit: acc.debit,
    credit: acc.credit,
    closing: acc.lastBalance,
  }));

  const total_debit = accounts.reduce((s, a) => s + a.debit, 0);
  const total_credit = accounts.reduce((s, a) => s + a.credit, 0);
  const total_balance = accounts.reduce((s, a) => s + a.closing, 0);

  return {
    accounts,
    total_debit,
    total_credit,
    closing: total_balance,
    balance: total_balance,
  };
}

// Shared Dr/Cr classification used by every branch of the Accounts Activity report.
const ACCOUNT_ACTIVITY_DEBIT_SQL = Prisma.sql`
  CASE
    WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN 0
    WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt,0)
    WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0)
    WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN 0
    WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.damt,0)
    ELSE 0
  END`;

const ACCOUNT_ACTIVITY_CREDIT_SQL = Prisma.sql`
  CASE
    WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0)
    WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN 0
    WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN 0
    WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt,0)
    WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.camt,0)
    ELSE 0
  END`;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Compare-months mode: one net (debit − credit) column per selected calendar
// month, so account movement can be compared side by side across months.
async function getAccountActivityComparison(filters, monthKeys) {
  const { macno } = filters;
  const macnoFilter = macno ? Prisma.sql`AND a.macno = ${Number(macno)}` : Prisma.empty;

  // Validate, dedupe, and order months most-recent first.
  const months = [...new Set(monthKeys)]
    .filter((k) => /^\d{4}-\d{2}$/.test(k))
    .sort()
    .reverse();

  const monthMeta = months.map((key) => {
    const [y, m] = key.split("-").map(Number);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this month
    const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return {
      key,
      field: `m_${y}_${String(m).padStart(2, "0")}`,
      label: `${MONTH_LABELS[m - 1]} ${y}`,
      start,
      end,
    };
  });

  const netExpr = (mm) =>
    Prisma.sql`SUM(CASE WHEN dated BETWEEN ${mm.start}::date AND ${mm.end}::date THEN debit_amount - credit_amount ELSE 0 END)`;

  const monthSelects = Prisma.join(
    monthMeta.map((mm) => Prisma.sql`${netExpr(mm)} AS ${Prisma.raw(`"${mm.field}"`)}`),
    ", "
  );
  const havingClause = Prisma.join(
    monthMeta.map((mm) => Prisma.sql`${netExpr(mm)} <> 0`),
    " OR "
  );

  const rows = await prisma.$queryRaw`
    WITH txn AS (
      SELECT
        t.acno,
        a.acname,
        a.macno,
        ${ACCOUNT_ACTIVITY_DEBIT_SQL} AS debit_amount,
        ${ACCOUNT_ACTIVITY_CREDIT_SQL} AS credit_amount,
        tm.dated
      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      LEFT JOIN "acno" a ON t.acno = a.acno
      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        ${macnoFilter}
    )
    SELECT
      acno,
      macno,
      COALESCE(acname, 'Unknown') AS account,
      ${monthSelects}
    FROM txn
    GROUP BY acno, acname, macno
    HAVING ${havingClause}
    ORDER BY account ASC;
  `;

  const columns = [
    { field: "acno", headerName: "Account No", width: 20 },
    { field: "account", headerName: "Account", width: 115 },
    { field: "macno", headerName: "M Account No", width: 20 },
    ...monthMeta.map((mm) => ({
      field: mm.field,
      headerName: mm.label,
      width: 40,
      type: "currency",
    })),
  ];

  return { data: rows, columns };
}

async function getAccountActivity(filters) {
  let { dateFrom, dateTo, macno, compareMonths } = filters;

  // When compare months are selected, switch to the side-by-side month view.
  // The base month (derived from dateFrom) is always included as a column.
  if (compareMonths) {
    const monthKeys = String(compareMonths).split(",").map((s) => s.trim()).filter(Boolean);
    const base = dateFrom ? new Date(dateFrom) : null;
    if (base && !isNaN(base)) {
      monthKeys.unshift(`${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`);
    }
    if (monthKeys.some((k) => /^\d{4}-\d{2}$/.test(k))) {
      return getAccountActivityComparison(filters, monthKeys);
    }
  }

  if (!dateFrom) dateFrom = "2000-01-01";
  if (!dateTo) dateTo = new Date().toISOString().split("T")[0];

  const macnoFilter = macno ? Prisma.sql`AND a.macno = ${Number(macno)}` : Prisma.empty;

  const results = await prisma.$queryRaw`
    WITH txn AS (
      SELECT 
        t.acno,
        a.acname,
        a.macno,
        tm.tran_code,
        t.sub_tran_id,
 
        -- Apply calculateAmounts logic here
        CASE 
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.damt,0)
          ELSE 0
        END AS debit_amount,
 
        CASE 
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0)
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt,0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.camt,0)
          ELSE 0
        END AS credit_amount,
 
        tm.dated
      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      LEFT JOIN "acno" a ON t.acno = a.acno
      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        ${macnoFilter}
    )
    SELECT 
      acno,
      macno,
      COALESCE(acname, 'Unknown') AS account,
 
      -- Opening balance (before dateFrom)
      SUM(CASE WHEN dated < ${dateFrom}::date THEN debit_amount - credit_amount ELSE 0 END) AS opening_balance,
 
      -- Period debit & credit
      SUM(CASE WHEN dated BETWEEN ${dateFrom}::date AND ${dateTo}::date THEN debit_amount ELSE 0 END) AS debit,
      SUM(CASE WHEN dated BETWEEN ${dateFrom}::date AND ${dateTo}::date THEN credit_amount ELSE 0 END) AS credit,
 
      -- Closing balance = opening + period
      SUM(CASE WHEN dated <= ${dateTo}::date THEN debit_amount - credit_amount ELSE 0 END) AS closing_balance
 
    FROM txn
    GROUP BY acno, acname, macno
    HAVING 
      SUM(CASE WHEN dated < ${dateFrom}::date THEN debit_amount - credit_amount ELSE 0 END) <> 0 OR
      SUM(CASE WHEN dated BETWEEN ${dateFrom}::date AND ${dateTo}::date THEN debit_amount ELSE 0 END) <> 0 OR
      SUM(CASE WHEN dated BETWEEN ${dateFrom}::date AND ${dateTo}::date THEN credit_amount ELSE 0 END) <> 0 OR
      SUM(CASE WHEN dated <= ${dateTo}::date THEN debit_amount - credit_amount ELSE 0 END) <> 0
    ORDER BY account ASC;
  `;

  return results;
}

function calculateAccountActivitySummary(data) {
  return {
    total_accounts: new Set(data.map((t) => t.account)).size,
    total_debit: data.reduce((sum, t) => sum + t.debit, 0),
    total_credit: data.reduce((sum, t) => sum + t.credit, 0),
  };
}

// The only voucher types that carry Dr/Cr. The stock-only codes (7 material
// issue, 8 production, 11 transfer) post no amounts, so offering them would
// just return all-zero rows.
const TRIAL_BALANCE_TRAN_CODES = [1, 2, 3, 4, 5, 6, 9, 10, 12, 21];

// ─────────────────────────────────────────────────────────────────────────────
//  Trial Balance
//  Two modes, driven by whether `dateFrom` is supplied:
//    • As-of mode (no dateFrom)  — cumulative up to `dateTo`.
//        opening = 0, debit/credit = net balance split by sign (legacy behaviour)
//    • Period mode (dateFrom set) — range [dateFrom .. dateTo].
//        opening = net balance strictly BEFORE dateFrom
//        debit / credit = gross movement inside the period
//        balance = opening + debit - credit  (closing as of dateTo)
//  Both `macno` (main account) and `acno` (ledger account) accept a single value
//  or a comma-joined list; "all"/empty means no filter.
// ─────────────────────────────────────────────────────────────────────────────
// A ledger line with no account (or an account since deleted) is shown under
// this name in the Trial Balance — never dropped, so the totals stay true and
// the line can be found and corrected.
const NO_ACCOUNT_LABEL = "No account (line saved without an account)";

async function getTrialBalance(filters) {
  let { dateFrom, dateTo, macno, acno, account, tran_code } = filters;

  // The route hands dates over as LOCAL-midnight Date objects. Casting those to
  // ::date in Postgres goes through UTC and can slip a day, so pin them to a
  // plain YYYY-MM-DD string built from the local parts first.
  const toDateOnly = (v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) return typeof v === "string" ? v : null;
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  dateFrom = toDateOnly(dateFrom);
  dateTo = toDateOnly(dateTo);

  if (!dateTo) {
    dateTo = new Date().toISOString().split("T")[0]; // default to today
  }

  const hasRange = !!dateFrom;

  // Multi-selects arrive from the UI as a comma-joined string.
  const toIntArray = (v) => {
    if (v === undefined || v === null || v === "" || v === "all") return [];
    const list = Array.isArray(v) ? v : String(v).split(",");
    return list
      .map((x) => parseInt(String(x).trim(), 10))
      .filter((n) => !isNaN(n));
  };

  const macnoList = toIntArray(macno);
  const acnoList = toIntArray(acno ?? account);

  // Anything outside TRIAL_BALANCE_TRAN_CODES is dropped rather than passed
  // through, so a hand-edited URL cannot pull stock-only vouchers into the
  // ledger figures. No selection = every financial type, as before.
  const requestedTranCodes = toIntArray(tran_code).filter((c) =>
    TRIAL_BALANCE_TRAN_CODES.includes(c),
  );
  const tranCodes = requestedTranCodes.length
    ? requestedTranCodes
    : TRIAL_BALANCE_TRAN_CODES;

  const isOpeningSql = hasRange
    ? Prisma.sql`(tm.dated < ${dateFrom}::date)`
    : Prisma.sql`false`;

  const macnoFilterSql = macnoList.length
    ? Prisma.sql`AND m.macno = ANY(${macnoList}::int[])`
    : Prisma.empty;

  const acnoFilterSql = acnoList.length
    ? Prisma.sql`AND t.acno = ANY(${acnoList}::int[])`
    : Prisma.empty;

  const results = await prisma.$queryRaw`
    WITH txn AS (
      SELECT
        t.acno,
        a.acname,
        m.macno AS macno,
        m.macname,
        ${isOpeningSql} AS is_opening,
        -- Apply the same logic from calculateAmounts
        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.damt,0)
          ELSE 0
        END AS debit_amount,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0)
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt,0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.camt,0)
          ELSE 0
        END AS credit_amount

      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      -- LEFT joins: a line saved without an account (or with one since
      -- deleted) stays in as "No account" instead of silently dropping out
      -- and putting the totals out.
      LEFT JOIN "acno" a ON t.acno = a.acno
      LEFT JOIN "MACNO" m ON a.macno = m.macno
      WHERE tm.dated <= ${dateTo}::date
        AND tm.tran_code = ANY(${tranCodes}::int[])
        ${macnoFilterSql}
        ${acnoFilterSql}
    )
    SELECT
      acno,
      macno,
      COALESCE(acname, ${NO_ACCOUNT_LABEL}) AS account,
      COALESCE(macname, ${NO_ACCOUNT_LABEL}) AS macaccount,
      COALESCE(SUM(CASE WHEN is_opening THEN debit_amount - credit_amount ELSE 0 END), 0)::float8 AS opening,
      COALESCE(SUM(CASE WHEN is_opening THEN 0 ELSE debit_amount END), 0)::float8            AS period_debit,
      COALESCE(SUM(CASE WHEN is_opening THEN 0 ELSE credit_amount END), 0)::float8           AS period_credit,
      COALESCE(SUM(debit_amount - credit_amount), 0)::float8                                 AS closing
    FROM txn
    GROUP BY acno, acname, macno, macname
    ORDER BY account ASC;
  `;

  return results.map((r) => {
    const opening = Number(r.opening) || 0;
    const periodDebit = Number(r.period_debit) || 0;
    const periodCredit = Number(r.period_credit) || 0;
    const closing = Number(r.closing) || 0;

    return {
      acno: r.acno != null ? Number(r.acno) : "",
      macno: r.macno != null ? Number(r.macno) : "",
      account: r.account ?? "Unknown",
      macaccount: r.macaccount ?? "Unknown",
      opening: hasRange ? opening : 0,
      // Period mode → gross movement in range. As-of mode → net split by sign.
      debit: hasRange ? periodDebit : Math.max(closing, 0),
      credit: hasRange ? periodCredit : Math.max(-closing, 0),
      balance: closing,
    };
  });
}

function calculateTrialBalanceSummary(data) {
  const total_opening = data.reduce((sum, a) => sum + (a.opening || 0), 0);
  const total_debit = data.reduce((sum, a) => sum + (a.debit || 0), 0);
  const total_credit = data.reduce((sum, a) => sum + (a.credit || 0), 0);
  return {
    total_accounts: data.length,
    total_opening,
    total_debit,
    total_credit,
    total_balance: data.reduce((sum, a) => sum + (a.balance || 0), 0),
    diff: Number((total_debit - total_credit).toFixed(2)),
  };
}

async function getTrialBalancePeriodReport(filters) {
  let { dateFrom, dateTo } = filters;

  if (!dateFrom) dateFrom = "2000-01-01";
  if (!dateTo) dateTo = new Date().toISOString().split("T")[0];

  const results = await prisma.$queryRaw`
    WITH txn AS (
      SELECT
        t.acno,
        a.acname,
        a.macno,
        m.macname,
        m.bscd,
        mb.mbscd,
        mb."mbscdDetail",
        b."bscdDetail",
        tm.dated,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.damt,0)
          ELSE 0
        END AS debit_amount,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0)
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt,0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.camt,0)
          ELSE 0
        END AS credit_amount

      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm
        ON t.tran_id = tm.tran_id
      LEFT JOIN "acno" a
        ON t.acno = a.acno
      LEFT JOIN "MACNO" m
        ON a.macno = m.macno
      LEFT JOIN "BSCD" b
        ON m.bscd = b.bscd
      LEFT JOIN "MBSCD" mb
        ON b.mbscd = mb.mbscd

      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        AND tm.dated BETWEEN ${dateFrom}::date AND ${dateTo}::date
    )

    SELECT
      acno,
      macno,
      mbscd,
      bscd,
      "mbscdDetail",
      "bscdDetail",
      COALESCE(acname, ${NO_ACCOUNT_LABEL}) AS account,
      COALESCE(macname, ${NO_ACCOUNT_LABEL}) AS macaccount,

      SUM(debit_amount) AS debit,
      SUM(credit_amount) AS credit,
      SUM(debit_amount - credit_amount) AS closing

    FROM txn

    GROUP BY
      acno,
      acname,
      macno,
      macname,
      bscd,
      mbscd,
      "mbscdDetail",
      "bscdDetail"

    HAVING
      SUM(debit_amount) <> 0
      OR SUM(credit_amount) <> 0

    ORDER BY account ASC;
  `;

  return results.map((r) => ({
    mbscd: r.mbscd ?? "",
    mbscdName: r.mbscdDetail ?? "",

    bscd: r.bscd ?? "",
    bscdName: r.bscdDetail ?? "",

    macno: r.macno != null ? Number(r.macno) : "",
    acno: r.acno != null ? Number(r.acno) : "",

    macaccount: r.macaccount ?? "",
    account: r.account ?? "",

    debit: Number(r.debit) || 0,
    credit: Number(r.credit) || 0,

    // Net balance for the selected period only
    balance: Number(r.closing) || 0,
  }));
}

function calculateTrialBalancePeriodSummary(data) {
  const total_debit = data.reduce((s, r) => s + (r.debit || 0), 0);
  const total_credit = data.reduce((s, r) => s + (r.credit || 0), 0);
  return {
    total_accounts: data.length,
    total_opening: data.reduce((s, r) => s + (r.opening || 0), 0),
    total_debit,
    total_credit,
    total_closing: data.reduce((s, r) => s + (r.balance || 0), 0),
    diff: Number((total_debit - total_credit).toFixed(2)),
  };
}

// Trial Balance (Period / Sheet) and Profit & Loss: one FLAT row per account
// for the wide report layout (CLAUDE.md rule 15). The account tree — main
// group › sub group › main account — is drawn by the viewer from these fields
// (components/Reports/config.js `accountTreeLayout`, rowGroupBy) with
// subtotals, so no header / total rows are built here.
//   debit / credit  = the account's net balance on its side (Dr when the
//                     balance is positive, Cr when negative) — the figures the
//                     old grouped tree showed as "Debit / Credit Balance"
//   balance         = debit - credit of the movements (sign: + Dr, − Cr)
//   dr_movement / cr_movement = the gross debit / credit movements behind it
// Sorted by the tree codes (numeric), accounts keep the query's order inside
// a main account — the same order the old hierarchy printed them in.
function trialBalanceAccountRows(flatData) {
  const code = (v) => parseFloat(v) || 0;
  return flatData
    .map((r, i) => {
      const bal = r.balance || 0;
      return {
        mbscd: r.mbscd,
        mbscdName: r.mbscdName,
        bscd: r.bscd,
        bscdName: r.bscdName,
        macno: r.macno,
        macaccount: r.macaccount,
        acno: r.acno,
        account: r.account,
        dr_movement: r.debit || 0,
        cr_movement: r.credit || 0,
        debit: bal > 0 ? bal : 0,
        credit: bal < 0 ? -bal : 0,
        balance: bal,
        _i: i,
      };
    })
    .sort((a, b) => code(a.mbscd) - code(b.mbscd) || code(a.bscd) - code(b.bscd) || code(a.macno) - code(b.macno) || a._i - b._i)
    .map(({ _i, ...row }) => row);
}



async function getTrialBalanceSheetReport(filters) {
  let { dateTo } = filters;

  if (!dateTo) {
    dateTo = new Date().toISOString().split("T")[0];
  }

  const results = await prisma.$queryRaw`
    WITH txn AS (
      SELECT
        t.acno,
        a.acname,
        a.macno,
        m.macname,
        m.bscd,
        mb.mbscd,
        mb."mbscdDetail",
        b."bscdDetail",
        tm.dated,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.damt,0)
          ELSE 0
        END AS debit_amount,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0)
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt,0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.camt,0)
          ELSE 0
        END AS credit_amount

      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm
        ON t.tran_id = tm.tran_id
      LEFT JOIN "acno" a
        ON t.acno = a.acno
      LEFT JOIN "MACNO" m
        ON a.macno = m.macno
      LEFT JOIN "BSCD" b
        ON m.bscd = b.bscd
      LEFT JOIN "MBSCD" mb
        ON b.mbscd = mb.mbscd

      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        AND tm.dated <= ${dateTo}::date
        AND mb.mbscd IN (1, 2, 3)
    )

    , grouped_accounts AS (
      SELECT
        acno,
        macno,
        mbscd,
        bscd,
        "mbscdDetail",
        "bscdDetail",
        COALESCE(acname, ${NO_ACCOUNT_LABEL}) AS account,
        COALESCE(macname, ${NO_ACCOUNT_LABEL}) AS macaccount,

        SUM(debit_amount) AS debit,
        SUM(credit_amount) AS credit,
        SUM(debit_amount - credit_amount) AS closing

      FROM txn

      GROUP BY
        acno,
        acname,
        macno,
        macname,
        bscd,
        mbscd,
        "mbscdDetail",
        "bscdDetail"

      HAVING
        SUM(debit_amount) <> 0
        OR SUM(credit_amount) <> 0
    )

    (
      SELECT * FROM grouped_accounts
      WHERE mbscd = 1
      ORDER BY account ASC
      -- LIMIT 3
    )
    UNION ALL
    (
      SELECT * FROM grouped_accounts
      WHERE mbscd = 2
      ORDER BY account ASC
      -- LIMIT 3
    )
    UNION ALL
    (
      SELECT * FROM grouped_accounts
      WHERE mbscd = 3
      ORDER BY account ASC
      -- LIMIT 3
    )
    ORDER BY mbscd ASC, account ASC;
  `;

  return results.map((r) => ({
    mbscd: r.mbscd ?? "",
    mbscdName: r.mbscdDetail ?? "",

    bscd: r.bscd ?? "",
    bscdName: r.bscdDetail ?? "",

    macno: r.macno != null ? Number(r.macno) : "",
    acno: r.acno != null ? Number(r.acno) : "",

    macaccount: r.macaccount ?? "",
    account: r.account ?? "",

    debit: Number(r.debit) || 0,
    credit: Number(r.credit) || 0,
    balance: Number(r.closing) || 0,
  }));
}

// ── Monthly Balance Sheet ────────────────────────────────────────────────────
// (Profit and Loss month on month is getProfitLossMonthlyReport further down.)
// Ported from arcc (commit 555d86c8) onto SMS's chart: MBSCD (1 Assets,
// 2 Liabilities, 3 Owner's Equity, 4 Income, 5 Expenses) › BSCD › MACNO ›
// ACNO, with the same tran_codes and Dr / Cr rule as getTrialBalanceSheetReport
// / getProfitLossReport, so the figures agree with those reports. One column
// per month of the period (m_YYYY_MM, reportMonths in
// components/Reports/config.js). Rows go out as a row_type stream
// (header › accounts › total per tree level) read by the report's
// layout.groupRows; the last row (net_row) is the Accumulated Profit / (Loss)
// or the Profit / (Loss).

// A filter date (local-midnight Date from the route, or a string) →
// "YYYY-MM-DD" of the day the user picked, or the fallback.
function reportYmd(value, fallback) {
  const d = reportDay(value);
  if (!d) return fallback;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Debit / credit of every account under the given main groups (MBSCD), summed
// per "bucket": the month (YYYY_MM), or "OPEN" for everything before
// openingBefore.
async function getMonthlyAccountMovements({ mbscds, dateFrom, dateTo, openingBefore = null, accountIds = [] }) {
  const bucketSql = openingBefore
    ? Prisma.sql`CASE WHEN tm.dated < ${openingBefore}::date THEN 'OPEN' ELSE to_char(tm.dated, 'YYYY_MM') END`
    : Prisma.sql`to_char(tm.dated, 'YYYY_MM')`;

  const results = await prisma.$queryRaw`
    WITH txn AS (
      SELECT
        t.acno,
        a.acname,
        a.macno,
        m.macname,
        m.bscd,
        mb.mbscd,
        mb."mbscdDetail",
        b."bscdDetail",
        ${bucketSql} AS bucket,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.damt,0)
          ELSE 0
        END AS debit_amount,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0)
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt,0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.camt,0)
          ELSE 0
        END AS credit_amount

      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      INNER JOIN "acno" a ON t.acno = a.acno
      INNER JOIN "MACNO" m ON a.macno = m.macno
      INNER JOIN "BSCD" b ON m.bscd = b.bscd
      INNER JOIN "MBSCD" mb ON b.mbscd = mb.mbscd

      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        AND tm.dated <= ${dateTo}::date
        ${dateFrom ? Prisma.sql`AND tm.dated >= ${dateFrom}::date` : Prisma.empty}
        AND mb.mbscd IN (${Prisma.join(mbscds)})
        ${accountIds.length ? Prisma.sql`AND t.acno IN (${Prisma.join(accountIds)})` : Prisma.empty}
    )
    SELECT
      acno,
      macno,
      mbscd,
      bscd,
      "mbscdDetail",
      "bscdDetail",
      acname AS account,
      macname AS macaccount,
      bucket,
      SUM(debit_amount)::float8 AS debit,
      SUM(credit_amount)::float8 AS credit
    FROM txn
    GROUP BY acno, acname, macno, macname, bscd, mbscd, "mbscdDetail", "bscdDetail", bucket
  `;

  // One row per account, its buckets side by side
  const byAccount = new Map();
  for (const r of results) {
    const acno = Number(r.acno);
    let row = byAccount.get(acno);
    if (!row) {
      row = {
        mbscd: r.mbscd ?? "",
        mbscdName: r.mbscdDetail ?? "",
        bscd: r.bscd ?? "",
        bscdName: r.bscdDetail ?? "",
        macno: r.macno != null ? Number(r.macno) : "",
        macaccount: r.macaccount ?? "",
        acno,
        account: r.account ?? "",
        debit: 0,
        credit: 0,
        buckets: {},
      };
      byAccount.set(acno, row);
    }
    const debit = Number(r.debit) || 0;
    const credit = Number(r.credit) || 0;
    row.debit += debit;
    row.credit += credit;
    row.buckets[r.bucket] = (row.buckets[r.bucket] || 0) + (debit - credit);
  }

  // Tree order: main group › sub group › main account › account name
  const code = (v) => parseFloat(v) || 0;
  return [...byAccount.values()]
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort(
      (a, b) =>
        code(a.mbscd) - code(b.mbscd) ||
        code(a.bscd) - code(b.bscd) ||
        code(a.macno) - code(b.macno) ||
        String(a.account).localeCompare(String(b.account)),
    );
}

// Sorted account rows → row_type stream for layout.groupRows. Total rows
// carry no figures (the viewer sums the accounts). netRow { label, plus,
// minus }: last row = Σ main groups in plus − Σ those in minus.
function buildMonthlyAccountTreeRows(accounts, fields, netRow) {
  const label = (no, name) => [no, name].filter((v) => v !== "" && v != null).join(" ");
  const net = Object.fromEntries(fields.map((f) => [f, 0]));
  const rows = [];
  let mbKey = null;
  let bsKey = null;
  let macKey = null;

  const closeMac = () => { if (macKey !== null) rows.push({ row_type: "macno_total" }); macKey = null; };
  const closeBs = () => { closeMac(); if (bsKey !== null) rows.push({ row_type: "bscd_total" }); bsKey = null; };
  const closeMb = () => { closeBs(); if (mbKey !== null) rows.push({ row_type: "mbscd_total" }); mbKey = null; };

  for (const acc of accounts) {
    const mb = String(acc.mbscd);
    const bs = `${mb}/${acc.bscd}`;
    const mac = `${bs}/${acc.macno}`;
    if (mb !== mbKey) {
      closeMb();
      rows.push({ row_type: "mbscd_header", label: label(acc.mbscd, acc.mbscdName) });
      mbKey = mb;
    }
    if (bs !== bsKey) {
      closeBs();
      rows.push({ row_type: "bscd_header", label: label(acc.bscd, acc.bscdName) });
      bsKey = bs;
    }
    if (mac !== macKey) {
      closeMac();
      rows.push({ row_type: "macno_header", label: label(acc.macno, acc.macaccount) });
      macKey = mac;
    }

    const line = {
      row_type: "account_row",
      acno: acc.acno,
      account: acc.account,
      mbscdName: acc.mbscdName,
      bscdName: acc.bscdName,
      macaccount: acc.macaccount,
    };
    fields.forEach((f) => { line[f] = acc[f] || 0; });
    rows.push(line);

    const mbNo = Number(acc.mbscd);
    const sign = netRow?.plus?.includes(mbNo) ? 1 : netRow?.minus?.includes(mbNo) ? -1 : 0;
    fields.forEach((f) => { net[f] += sign * (acc[f] || 0); });
  }
  closeMb();

  if (netRow && rows.length) {
    const line = { row_type: "net_row", account: netRow.label };
    // Round to paisa and drop −0 so the row never shows "-0.00"
    fields.forEach((f) => { line[f] = Math.round(net[f] * 100) / 100 || 0; });
    rows.push(line);
  }
  return rows;
}

// Monthly Balance Sheet: each month column = the account's closing balance
// (Dr − Cr) at that month end = opening (before From Date) + the months so
// far. Liabilities (2) and Equity (3) × −1 so they read positive.
async function getMonthlyBalanceSheetReport(filters) {
  const today = reportYmd(new Date(), "");
  const dateFrom = reportYmd(filters.dateFrom, `${today.slice(0, 4)}-01-01`);
  const dateTo = reportYmd(filters.dateTo, today);
  const months = reportMonths({ dateFrom, dateTo }).map((m) => m.field);

  const accounts = await getMonthlyAccountMovements({ mbscds: [1, 2, 3], dateFrom: null, dateTo, openingBefore: dateFrom });
  accounts.forEach((acc) => {
    let running = acc.buckets.OPEN || 0;
    months.forEach((f) => {
      running += acc.buckets[f.slice(2)] || 0;
      acc[f] = [2, 3].includes(Number(acc.mbscd)) ? 0 - running : running;
    });
  });

  const total_debit = accounts.reduce((s, r) => s + r.debit, 0);
  const total_credit = accounts.reduce((s, r) => s + r.credit, 0);
  const summary = {
    total_accounts: accounts.length,
    total_debit,
    total_credit,
    diff: Number((total_debit - total_credit).toFixed(2)),
  };
  const data = buildMonthlyAccountTreeRows(accounts, months, {
    label: "ACCUMULATED PROFIT / (LOSS)",
    plus: [1],
    minus: [2, 3],
  });
  return { data, summary };
}

async function getProfitLossReport(filters) {
  let { dateFrom, dateTo } = filters;

  if (!dateFrom) dateFrom = "2000-01-01";
  if (!dateTo) dateTo = new Date().toISOString().split("T")[0];

  const results = await prisma.$queryRaw`
    WITH txn AS (
      SELECT
        t.acno,
        a.acname,
        a.macno,
        m.macname,
        m.bscd,
        mb.mbscd,
        mb."mbscdDetail",
        b."bscdDetail",
        tm.dated,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.damt,0)
          ELSE 0
        END AS debit_amount,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0)
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt,0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.camt,0)
          ELSE 0
        END AS credit_amount

      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm
        ON t.tran_id = tm.tran_id
      LEFT JOIN "acno" a
        ON t.acno = a.acno
      LEFT JOIN "MACNO" m
        ON a.macno = m.macno
      LEFT JOIN "BSCD" b
        ON m.bscd = b.bscd
      LEFT JOIN "MBSCD" mb
        ON b.mbscd = mb.mbscd

      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        AND tm.dated BETWEEN ${dateFrom}::date AND ${dateTo}::date
        AND (b.mbscd = 4  OR b.mbscd = 5) -- Only P&L groups
        AND a.acno IS NOT NULL
    )

    , grouped_accounts AS (
      SELECT
        acno,
        macno,
        mbscd,
        bscd,
        "mbscdDetail",
        "bscdDetail",
        COALESCE(acname, 'Unknown') AS account,
        COALESCE(macname, 'Unknown') AS macaccount,

        SUM(debit_amount) AS debit,
        SUM(credit_amount) AS credit,
        SUM(debit_amount - credit_amount) AS closing

      FROM txn

      GROUP BY
        acno,
        acname,
        macno,
        macname,
        bscd,
        mbscd,
        "mbscdDetail",
        "bscdDetail"

      HAVING
        SUM(debit_amount) <> 0
        OR SUM(credit_amount) <> 0
    )

    (
      SELECT * FROM grouped_accounts
      WHERE mbscd = 4
      ORDER BY account ASC
      -- LIMIT 1
    )
    UNION ALL
    (
      SELECT * FROM grouped_accounts
      WHERE mbscd = 5
      ORDER BY account ASC
      -- LIMIT 1
    )
    ORDER BY mbscd ASC, account ASC;
  `;

  return results.map((r) => ({
    mbscd: r.mbscd ?? "",
    mbscdName: r.mbscdDetail ?? "",

    bscd: r.bscd ?? "",
    bscdName: r.bscdDetail ?? "",

    macno: r.macno != null ? Number(r.macno) : "",
    acno: r.acno != null ? Number(r.acno) : "",

    macaccount: r.macaccount ?? "",
    account: r.account ?? "",

    debit: Number(r.debit) || 0,
    credit: Number(r.credit) || 0,
    balance: Number(r.closing) || 0,
  }));
}

// Profit and Loss — Month on Month (REPORT_CONFIG.profitLossMonthly).
// The same figures as getProfitLossReport (same tran_codes, same Dr / Cr rule,
// P&L groups 4 / 5 only), one row per account with one column per month of
// the period: m_YYYY_MM = that month's debit − credit (+ Dr, − Cr, the sign of
// the P&L "Balance"), and `total` = the whole period (= the P&L Balance).
// The month columns are built by the config from the same date range.
async function getProfitLossMonthlyReport(filters) {
  let { dateFrom, dateTo } = filters;

  if (!dateFrom) dateFrom = "2000-01-01";
  if (!dateTo) dateTo = new Date().toISOString().split("T")[0];

  // Account filter (optional, one or many: "860,263") — empty = every account
  const accountIds = (Array.isArray(filters.account) ? filters.account : String(filters.account ?? "").split(","))
    .map((a) => Number(a))
    .filter((a) => Number.isFinite(a) && a > 0);
  const accountSql = accountIds.length
    ? Prisma.sql`AND t.acno IN (${Prisma.join(accountIds)})`
    : Prisma.empty;

  const results = await prisma.$queryRaw`
    WITH txn AS (
      SELECT
        t.acno,
        a.acname,
        a.macno,
        m.macname,
        m.bscd,
        mb.mbscd,
        mb."mbscdDetail",
        b."bscdDetail",
        to_char(tm.dated, 'YYYY_MM') AS ym,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0)
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.damt,0)
          ELSE 0
        END AS debit_amount,

        CASE
          WHEN tm.tran_code = 1 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0)
          WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id = 1 THEN 0
          WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt,0)
          WHEN tm.tran_code IN (3,4,5,6,9,10,12,21) THEN COALESCE(t.camt,0)
          ELSE 0
        END AS credit_amount

      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm
        ON t.tran_id = tm.tran_id
      LEFT JOIN "acno" a
        ON t.acno = a.acno
      LEFT JOIN "MACNO" m
        ON a.macno = m.macno
      LEFT JOIN "BSCD" b
        ON m.bscd = b.bscd
      LEFT JOIN "MBSCD" mb
        ON b.mbscd = mb.mbscd

      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        AND tm.dated BETWEEN ${dateFrom}::date AND ${dateTo}::date
        AND (b.mbscd = 4  OR b.mbscd = 5) -- Only P&L groups
        AND a.acno IS NOT NULL
        ${accountSql}
    )
    SELECT
      acno,
      macno,
      mbscd,
      bscd,
      "mbscdDetail",
      "bscdDetail",
      COALESCE(acname, 'Unknown') AS account,
      COALESCE(macname, 'Unknown') AS macaccount,
      ym,
      SUM(debit_amount) AS debit,
      SUM(credit_amount) AS credit
    FROM txn
    GROUP BY acno, acname, macno, macname, bscd, mbscd, "mbscdDetail", "bscdDetail", ym
    HAVING SUM(debit_amount) <> 0 OR SUM(credit_amount) <> 0
    ORDER BY mbscd ASC, account ASC, ym ASC;
  `;

  // One row per account, the months side by side
  const byAccount = new Map();
  for (const r of results) {
    const acno = r.acno != null ? Number(r.acno) : "";
    let row = byAccount.get(acno);
    if (!row) {
      row = {
        mbscd: r.mbscd ?? "",
        mbscdName: r.mbscdDetail ?? "",
        bscd: r.bscd ?? "",
        bscdName: r.bscdDetail ?? "",
        macno: r.macno != null ? Number(r.macno) : "",
        macaccount: r.macaccount ?? "",
        acno,
        account: r.account ?? "",
        dr_movement: 0,
        cr_movement: 0,
        total: 0,
      };
      byAccount.set(acno, row);
    }
    const debit = Number(r.debit) || 0;
    const credit = Number(r.credit) || 0;
    const key = `m_${r.ym}`;
    row[key] = (row[key] || 0) + (debit - credit);
    row.dr_movement += debit;
    row.cr_movement += credit;
    row.total += debit - credit;
  }

  // Same order as the P&L tree: main group › sub group › main account › name
  const code = (v) => parseFloat(v) || 0;
  return [...byAccount.values()].sort(
    (a, b) =>
      code(a.mbscd) - code(b.mbscd) ||
      code(a.bscd) - code(b.bscd) ||
      code(a.macno) - code(b.macno) ||
      String(a.account).localeCompare(String(b.account)),
  );
}


// route.js
async function getStockMetricsReport(filters = {}) {
  try {
    // Same rule as the Stock Report: each godown's Monthly Opening Stock of
    // the latest period (current month's 1st) + every movement since that
    // 1st up to today. Without any generated period it sums all history.
    // Movements use the Stock Report's rule, so both reports agree:
    //   IN : 4, 8, 10, 12 and transfer (11) into the godown (godown2)
    //   OUT: 5, 6, 7, 9 and transfer (11) out of the godown
    // sub_tran_id = 3 control rows are excluded.
    const period = await getLatestOpeningPeriod(new Date());
    const anchor = period ? new Date(period.year, period.month - 1, 1, 0, 0, 0, 0) : null;
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const openingCte = period
      ? openingQtyByGodownSql(period.month, period.year)
      : Prisma.sql`SELECT NULL::int AS itcd, NULL::int AS godown, 0::float8 AS opening_qty WHERE FALSE`;
    const movesDateSql = Prisma.sql`AND tm.dated <= ${endOfToday} ${anchor ? Prisma.sql`AND tm.dated >= ${anchor}` : Prisma.empty}`;

    const results = await prisma.$queryRaw`
      WITH opening AS (${openingCte}),
      moves AS (
        SELECT t.itcd, tm.godown AS godown_id,
          SUM(
            CASE
              WHEN tm.tran_code IN (4, 8, 10, 12) THEN t.qty
              WHEN tm.tran_code IN (5, 6, 7, 9, 11) THEN -t.qty
              ELSE 0
            END
          ) AS qty
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        WHERE t.qty IS NOT NULL
          AND COALESCE(t.sub_tran_id, 1) <> 3
          AND tm.godown IS NOT NULL
          ${movesDateSql}
        GROUP BY t.itcd, tm.godown
        UNION ALL
        SELECT t.itcd, tm.godown2 AS godown_id, SUM(t.qty) AS qty
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        WHERE tm.tran_code = 11
          AND t.qty IS NOT NULL
          AND COALESCE(t.sub_tran_id, 1) <> 3
          AND tm.godown2 IS NOT NULL
          ${movesDateSql}
        GROUP BY t.itcd, tm.godown2
      ),
      moves_sum AS (
        SELECT itcd, godown_id, SUM(qty) AS qty FROM moves GROUP BY itcd, godown_id
      ),
      stock_calc AS (
        SELECT
          i.itcd,
          i.item,
          i.code,
          ic.ic_name AS category,
          mc.mc_name AS ink_series,
          g.id AS godown_id,
          (COALESCE(o.opening_qty, 0) + COALESCE(m.qty, 0))::float8 AS stock
        FROM "Item" i
        LEFT JOIN "ItemCategory" ic ON i.ic_id = ic.id
        LEFT JOIN "MainCategory" mc ON i.mc_id = mc.id
        CROSS JOIN "Godown" g
        LEFT JOIN opening o ON o.itcd = i.itcd AND o.godown = g.id
        LEFT JOIN moves_sum m ON m.itcd = i.itcd AND m.godown_id = g.id
        WHERE 1=1
          ${filters.category
        ? Prisma.sql`AND i.ic_id = ${parseInt(filters.category)}`
        : Prisma.empty
      }
          ${filters.item
        ? Prisma.sql`AND i.itcd = ${parseInt(filters.item)}`
        : Prisma.empty
      }
          ${filters.godown
        ? Prisma.sql`AND g.id = ${parseInt(filters.godown)}`
        : Prisma.empty
      }
          ${inkSeriesWhereSql(filters)}
      )
      SELECT
        itcd,
        item,
        code,
        category,
        ink_series,
        jsonb_object_agg(godown_id, stock) AS godownStocks,
        SUM(stock) AS totalStock
      FROM stock_calc
      GROUP BY itcd, item, code, category, ink_series
      ${filters.showZero === "false"
        ? Prisma.sql`HAVING SUM(stock) > 0`
        : Prisma.empty
      }
      ORDER BY item ASC;
    `;

    /* Old: all-time transactions, without Monthly Opening (and without 7 / 8)
    const results = await prisma.$queryRaw`
      WITH stock_calc AS (
        SELECT 
          i.itcd,
          i.item,
          i.code,
          ic.ic_name AS category,
          mc.mc_name AS ink_series,
          g.id AS godown_id,
          g.godown,
          SUM(
            CASE 
              WHEN tm.tran_code IN (4,10,12) AND tm.godown = g.id THEN t.qty  -- Purchases / Sale Returns
              WHEN tm.tran_code IN (6,9,5) AND tm.godown = g.id THEN -t.qty  -- Sales / Purchase Returns / POS
              WHEN tm.tran_code = 11 AND tm.godown = g.id THEN -t.qty        -- Transfer Out
              WHEN tm.tran_code = 11 AND tm.godown2 = g.id THEN t.qty        -- Transfer In
              ELSE 0
            END
          ) AS stock
        FROM "Item" i
        LEFT JOIN "ItemCategory" ic ON i.ic_id = ic.id
        LEFT JOIN "MainCategory" mc ON i.mc_id = mc.id
        CROSS JOIN "Godown" g
        LEFT JOIN "Transactions" t ON t.itcd = i.itcd
        LEFT JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE 1=1
          ${filters.category
        ? Prisma.sql`AND i.ic_id = ${parseInt(filters.category)}`
        : Prisma.empty
      }
          ${filters.item
        ? Prisma.sql`AND i.itcd = ${parseInt(filters.item)}`
        : Prisma.empty
      }
          ${filters.godown
        ? Prisma.sql`AND g.id = ${parseInt(filters.godown)}`
        : Prisma.empty
      }
          ${inkSeriesWhereSql(filters)}
        GROUP BY i.itcd, i.item, i.code, ic.ic_name, mc.mc_name, g.id, g.godown
      )
      SELECT
        itcd,
        item,
        code,
        category,
        ink_series,
        jsonb_object_agg(godown_id, stock) AS godownStocks,
        SUM(stock) AS totalStock
      FROM stock_calc
      GROUP BY itcd, item, code, category, ink_series
      ${filters.showZero === "false"
        ? Prisma.sql`HAVING SUM(stock) > 0`
        : Prisma.empty
      }
      ORDER BY item ASC;
    `;
    */

    // Also fetch godowns list for dynamic column headers
    const godowns = await prisma.godown.findMany({
      orderBy: { godown: "asc" },
    });

    return {
      items: results,
      godowns,
    };
  } catch (err) {
    console.error("Error generating stock metrics report:", err);
    return { items: [], godowns: [] };
  }
}

function calculateStockMetricsSummary(data) {
  const { items, godowns } = data;

  // Calculate total stock across all items and godowns
  const totalStock = items.reduce((sum, item) => sum + item.totalstock, 0);

  // Calculate godown-wise totals
  const godownTotals = {};
  godowns.forEach((godown) => {
    godownTotals[godown.id] = items.reduce(
      (sum, item) => sum + (item.godownstocks[godown.id] || 0),
      0
    );
  });

  return {
    total_items: items.length,
    total_stock: totalStock,
    godown_totals: godownTotals,
  };
}

function parseFilterDate(dateStr, isEndDate = false) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    const d = new Date(dateStr.getTime());
    if (isEndDate) {
      d.setHours(23, 59, 59, 999);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return d;
  }

  let formattedStr = dateStr;
  if (typeof dateStr === 'string') {
    // If it has DD-MM-YYYY format, convert to YYYY-MM-DD
    const parts = dateStr.split('-');
    if (parts.length === 3 && parts[0].length <= 2 && parts[2].length === 4) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];
      formattedStr = `${year}-${month}-${day}`;
    }
  }

  const d = new Date(formattedStr);
  if (isNaN(d.getTime())) return null;

  if (isEndDate) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

async function getOrderBalanceReport(filters) {
  let { dateFrom, dateTo, orderType, customer, godown, item, region, orderNo, city, sale_person, status } = filters;
  // const { dateFrom, dateTo } = filters;

  // const orderType = "4";
  // const godown = "2";
  // const customer = "0013";
  // Set default status if not provided (but do not override if empty string which means All Statuses)
  if (status === undefined || status === null) {
    status = "pending";
  }

  // Validate required parameters
  if (!orderType) {
    orderType = 4; // Default to purchase orders if not provided
    // throw new Error("Order type is required (4 for purchase, 6 for sales)");
  }

  const parsedDateFrom = parseFilterDate(dateFrom, false) || new Date("2000-01-01");
  const parsedDateTo = parseFilterDate(dateTo, true) || new Date();

  if (orderType) orderType = Number(orderType);
  if (godown) godown = Number(godown);
  if (customer) customer = Number(customer);
  if (orderNo) orderNo = Number(orderNo);

  // Determine if it's purchase order (4) or sales order (6)
  const isPurchaseOrder = parseInt(orderType) === 4;
  const joinField = isPurchaseOrder ? "po_no" : "so_no";
  const netCase = isPurchaseOrder
    ? Prisma.sql`
      CASE 
        WHEN tm.tran_code = 4 THEN t.qty
        WHEN tm.tran_code = 9 THEN -t.qty
        ELSE 0
      END
    `
    : Prisma.sql`
      CASE 
        WHEN tm.tran_code = 6 THEN t.qty
        WHEN tm.tran_code = 13 THEN -t.qty
        ELSE 0
      END
    `;

  // Sales person filter resolution (supports multi-select array, comma-separated IDs, or single string)
  const spParam = filters.sale_person ?? filters.salesPersonIds ?? filters.salesPerson ?? filters.salesPersonId;
  const salesPersonFilter = Array.isArray(spParam)
    ? spParam.map(String).filter(Boolean)
    : typeof spParam === "string" && spParam.trim().length > 0 && spParam.trim() !== "all"
    ? spParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  let allowedSalesPersons = null;
  if (salesPersonFilter && salesPersonFilter.length > 0) {
    const matchingUsers = await prisma.user.findMany({
      where: {
        OR: [
          { id: { in: salesPersonFilter } },
          { username: { in: salesPersonFilter } },
          { name: { in: salesPersonFilter } },
        ],
      },
      select: { id: true, username: true },
    });

    const keysSet = new Set(salesPersonFilter);
    matchingUsers.forEach((u) => {
      if (u.id) keysSet.add(u.id);
      if (u.username) keysSet.add(u.username);
    });
    allowedSalesPersons = Array.from(keysSet);
  }

  try {
    // Share of an (order, item) shipment total that belongs to one SO line:
    // earlier lines fill first, the last line takes whatever is left.
    const fifo = (col, prev = "prev_qty", qty = "ordered_qty") => Prisma.raw(
      `CASE WHEN l.is_last THEN GREATEST(COALESCE(s.${col}, 0) - l.${prev}, 0) ` +
      `ELSE LEAST(l.${qty}, GREATEST(COALESCE(s.${col}, 0) - l.${prev}, 0)) END`
    );
    // Updated query based on the new PO verification approach
    const orderBalances = await prisma.$queryRaw`
      -- Shipments are summed ONCE per (order, item). An SO can carry the
      -- same item on several lines (e.g. 500 + 500); joining every line to
      -- every dispatch row counted the whole 1000 on each line (2000 total).
      -- The per-item total is now split across those lines in line order
      -- (FIFO); the last line takes any excess (over-dispatch).
      WITH ship AS (
        SELECT
          tm.${Prisma.raw(joinField)} as order_no,
          t.itcd,
          COALESCE(SUM(CASE WHEN tm.tran_code = 6  THEN t.qty_ltr ELSE 0 END), 0) as ship_ltr,
          COALESCE(SUM(CASE WHEN tm.tran_code = 13 THEN t.qty_ltr ELSE 0 END), 0) as ship_return_ltr,
          COALESCE(SUM(CASE WHEN tm.tran_code = 4  THEN t.qty ELSE 0 END), 0) as purchased_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 6  THEN t.qty ELSE 0 END), 0) as ship_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 13 THEN t.qty ELSE 0 END), 0) as ship_return_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 9  THEN t.qty ELSE 0 END), 0) as returned_qty,
          COALESCE(SUM(${netCase}), 0) as net_received
        FROM "TRANSACTIONS_MASTER" tm
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
        WHERE tm.${Prisma.raw(joinField)} IS NOT NULL
          AND t.itcd IS NOT NULL
          AND tm.tran_code IN (${isPurchaseOrder ? Prisma.sql`4, 9` : Prisma.sql`6, 13`})
        GROUP BY 1, 2
      ),
      so_lines AS (
        SELECT
          om.order_no,
          om.dated as order_date,
          om.sale_po,
          om.party_code,
          a.acname as customer_name,
          a.sales_ares as sales_person_id,
          u.name as sales_person_name,
          om.delivery_location,
          om.region,
          od.id as od_id,
          od.status as od_status,
          od.itcd,
          i.code as item_code,
          i.item as item_name,
          mc.mc_name as ink_series,
          od.rate,
          od.amount,
          CONCAT('Verification for PO ', om.order_no, ', Item ', od.itcd) as description,
          COALESCE(od.qty, 0) as ordered_qty,
          -- LTR lines: the order was taken in litres; qty above is the KG
          -- derived from them. Shown side by side so both can be checked.
          COALESCE(od.unit, 'KG') as unit,
          COALESCE(od.qty_ltr, 0) as ordered_ltr,
          -- qty on earlier lines of the same item (for the FIFO split)
          COALESCE(SUM(COALESCE(od.qty, 0)) OVER w, 0) - COALESCE(od.qty, 0) as prev_qty,
          COALESCE(SUM(COALESCE(od.qty_ltr, 0)) OVER w, 0) - COALESCE(od.qty_ltr, 0) as prev_ltr,
          ROW_NUMBER() OVER (PARTITION BY od.order_no, od.itcd ORDER BY od.id DESC) = 1 as is_last
        FROM "OrderMaster" om
        JOIN "OrderDetail" od ON om.order_no = od.order_no
        JOIN "Item" i ON od.itcd = i.itcd
        LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id   -- Ink Series
        LEFT JOIN "acno" a ON om.party_code = a.acno
        LEFT JOIN "User" u ON u.id = a.sales_ares
        WHERE om.order_catagory = ${parseInt(orderType)}
          ${customer
        ? Prisma.sql`AND om.party_code = ${Number(customer)}`
        : Prisma.empty
      }
          ${orderNo
        ? Prisma.sql`AND om.order_no = ${Number(orderNo)}`
        : Prisma.empty
      }
          ${godown
        ? Prisma.sql`AND om.godown = ${parseInt(godown)}`
        : Prisma.empty
      }
          ${item ? Prisma.sql`AND od.itcd = ${parseInt(item)}` : Prisma.empty}
          ${inkSeriesIds(filters).length
        ? Prisma.sql`AND i.mc_id IN (${Prisma.join(inkSeriesIds(filters))})`
        : Prisma.empty}
          ${region && region !== "all"
        ? Prisma.sql`AND om.region = ${region}`
        : Prisma.empty
      }
          ${city && city !== ""
        ? Prisma.sql`AND a.city = ${city}`
        : Prisma.empty
      }
          ${allowedSalesPersons && allowedSalesPersons.length > 0
        ? Prisma.sql`AND a.sales_ares IN (${Prisma.join(allowedSalesPersons)})`
        : Prisma.empty
      }
          ${parsedDateFrom
        ? Prisma.sql`AND om.dated >= ${parsedDateFrom}::timestamp`
        : Prisma.empty
      }
          ${parsedDateTo
        ? Prisma.sql`AND om.dated <= ${parsedDateTo}::timestamp`
        : Prisma.empty
      }
        WINDOW w AS (PARTITION BY od.order_no, od.itcd ORDER BY od.id ROWS UNBOUNDED PRECEDING)
      ),
      po_verification AS (
        SELECT
          l.order_no, l.order_date, l.sale_po, l.party_code, l.customer_name,
          l.sales_person_id, l.sales_person_name, l.delivery_location, l.region,
          l.itcd, l.item_code, l.item_name, l.ink_series, l.rate, l.amount,
          l.description, l.ordered_qty, l.unit, l.ordered_ltr,
          ${fifo("ship_ltr", "prev_ltr", "ordered_ltr")} as ship_ltr,
          ${fifo("ship_return_ltr", "prev_ltr", "ordered_ltr")} as ship_return_ltr,
          ${fifo("purchased_qty")} as purchased_qty,
          ${fifo("ship_qty")} as ship_qty,
          ${fifo("ship_return_qty")} as ship_return_qty,
          ${fifo("returned_qty")} as returned_qty,
          ${fifo("net_received")} as net_received
        FROM so_lines l
        LEFT JOIN ship s ON s.order_no = l.order_no AND s.itcd = l.itcd
        WHERE 1 = 1
          ${status === "pending"
        ? Prisma.sql`AND l.od_status = 1`
        : status === "complete"
          ? Prisma.sql`AND l.od_status = 2`
          : Prisma.empty
      }
      )
      SELECT 
        order_no,
        order_date,
        party_code,
        customer_name,
        sales_person_id,
        sales_person_name,
        delivery_location,
        region,
        sale_po,
        itcd,
        item_code,
        item_name,
        ink_series,
        rate::numeric as rate,
        amount::numeric as amount,
        description,
        ordered_qty::numeric as ordered_qty,
        ship_qty::numeric as ship_qty,
        ship_return_qty::numeric as ship_return_qty,
        unit,
        ordered_ltr::numeric as ordered_ltr,
        ship_ltr::numeric as ship_ltr,
        ship_return_ltr::numeric as ship_return_ltr,
        purchased_qty::numeric as purchased_qty,
        returned_qty::numeric as returned_qty,
        net_received::numeric as net_received,
 
        -- Additional verification columns
        (ordered_qty - net_received)::numeric as pending_qty,
 
        CASE 
          WHEN net_received = ordered_qty THEN 'COMPLETE'
          WHEN net_received > ordered_qty THEN 'OVER_RECEIVED'
          WHEN net_received < ordered_qty AND net_received > 0 THEN 'PARTIAL'
          WHEN net_received = 0 THEN 'PENDING'
          ELSE 'ERROR'
        END as status,
 
        ROUND(
          CASE 
            WHEN ordered_qty > 0 THEN (net_received * 100.0 / ordered_qty)::numeric
            ELSE 0
          END, 2
        ) as completion_percentage
 
      FROM po_verification
      -- WHERE (ordered_qty - net_received) != 0  -- Only show items with balance
      ORDER BY order_date DESC, order_no DESC
    `;

    // Group by order for the final response
    const result = orderBalances.map((row) => {
      const orderedQty = parseFloat(row.ordered_qty) || 0;
      const purchasedQty = parseFloat(row.purchased_qty) || 0;
      const returnedQty = parseFloat(row.returned_qty) || 0;
      const netReceived = parseFloat(row.net_received) || 0;
      const pendingQty = parseFloat(row.pending_qty) || 0;
      const shipQty = parseFloat(row.ship_qty) || 0;
      const shipReturnQty = parseFloat(row.ship_return_qty) || 0;

      // Litres, only on a line ordered in LTR (null on KG lines so the
      // report shows them blank instead of 0).
      const unit = String(row.unit || "KG").toUpperCase() === "LTR" ? "LTR" : "KG";
      const isLtr = unit === "LTR";
      const orderedQtyLtr = isLtr ? parseFloat(row.ordered_ltr) || 0 : null;
      const shipQtyLtr = isLtr
        ? (parseFloat(row.ship_ltr) || 0) - (parseFloat(row.ship_return_ltr) || 0)
        : null;
      const pendingQtyLtr = isLtr ? orderedQtyLtr - shipQtyLtr : null;

      return {
        unit,
        orderedQtyLtr,
        shipQtyLtr,
        pendingQtyLtr,
        // Order drill (CLAUDE.md rule 15): 400 Purchase Order / 600 Sale Order.
        order_no: Number(row.order_no),
        tran_code: parseInt(orderType) * 100,
        orderNo: Number(row.order_no),
        orderDate: row.order_date,
        partyCode: row.party_code,
        customer: row.customer_name,
        salesPersonId: row.sales_person_id || null,
        salesPerson: row.sales_person_name || (row.sales_person_id ? row.sales_person_id : "OPEN"),
        deliveryLocation: row.delivery_location,
        region: row.region || "Not Specified",
        sale_po: row.sale_po,

        itemCode: Number(row.itcd),
        code: row.item_code,
        itemName: row.item_name,
        inkSeries: row.ink_series || "",
        description: row.description,

        orderedQty,
        purchasedQty,
        returnedQty,
        netReceived,
        pendingQty,
        shipQty,
        shipReturnQty,

        rate: parseFloat(row.rate) || 0,
        amount: parseFloat(row.amount) || 0,

        status: row.status,
        completionPercentage: parseFloat(row.completion_percentage) || 0,
      };
    });

    return result;

    //   // success: true,
    //   result,
    //   // summary: {
    //   //   totalOrders: result.length,
    //   //   totalItems: orderBalances.length,
    //   //   orderType: isPurchaseOrder ? 'Purchase Orders' : 'Sales Orders'
    //   // }
    // };
  } catch (error) {
    console.error("Error in getOrderBalanceReport:", error);
    throw new Error(
      `Failed to generate order balance report: ${error.message}`
    );
  }
}

function calculateOrderBalanceSummary(data = []) {
  const uniqueOrders = new Set(data.map((d) => d.orderNo));

  return {
    // Counts
    totalOrders: uniqueOrders.size,
    totalItems: data.length,

    // Quantity totals
    totalOrdered: data.reduce((sum, i) => sum + (i.orderedQty || 0), 0),
    totalPurchased: data.reduce((sum, i) => sum + (i.purchasedQty || 0), 0),
    totalReturned: data.reduce((sum, i) => sum + (i.returnedQty || 0), 0),
    totalNetReceived: data.reduce((sum, i) => sum + (i.netReceived || 0), 0),
    totalPending: data.reduce((sum, i) => sum + (i.pendingQty || 0), 0),
    totalShip: data.reduce((sum, i) => sum + (i.shipQty || 0), 0),
    totalShipReturn: data.reduce((sum, i) => sum + (i.shipReturnQty || 0), 0),

    // Litres — LTR lines only
    totalOrderedLtr: data.reduce((sum, i) => sum + (i.orderedQtyLtr || 0), 0),
    totalShipLtr: data.reduce((sum, i) => sum + (i.shipQtyLtr || 0), 0),
    totalPendingLtr: data.reduce((sum, i) => sum + (i.pendingQtyLtr || 0), 0),

    // Status-based item metrics
    completeItems: data.filter((i) => i.status === "COMPLETE").length,
    partialItems: data.filter((i) => i.status === "PARTIAL").length,
    pendingItems: data.filter((i) => i.status === "PENDING").length,
    overReceivedItems: data.filter((i) => i.status === "OVER_RECEIVED").length,

    // Average completion percentage (item-wise)
    averageCompletion:
      data.length > 0
        ? (
          data.reduce(
            (sum, i) => sum + (i.completionPercentage || 0),
            0
          ) / data.length
        ).toFixed(2)
        : 0,
  };
}

// ── Sales Order Balance: grouped detail views ───────────────────────────────
// Flat row_type rows for config.groupedDetailView (ReportViewer renders,
// prints and exports them from the config alone). Layout mirrors the classic
// register: the first line of an order carries the SO columns, its remaining
// item lines leave them blank, and an "SO Total" closes the order. With
// bySalesPerson the orders sit under a sales-person header and total.
const ORDER_BALANCE_GROUPED_VIEWS = new Set(["groupDetail", "groupSalesPerson"]);

const fmtShortDate = (d) => {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${String(dt.getFullYear()).slice(-2)}`;
};

function buildOrderBalanceGroupedRows(data = [], { bySalesPerson = false } = {}) {
  const sorted = [...data].sort((a, b) => {
    if (bySalesPerson) {
      const sp = (a.salesPerson || "").localeCompare(b.salesPerson || "");
      if (sp !== 0) return sp;
    }
    // Latest first
    const d = new Date(b.orderDate) - new Date(a.orderDate);
    if (d !== 0) return d;
    if (a.orderNo !== b.orderNo) return b.orderNo - a.orderNo;
    return (a.code || "").localeCompare(b.code || "");
  });

  const rows = [];
  const zero = () => ({
    orderedQty: 0, amount: 0, shipQty: 0, pendingQty: 0,
    orderedQtyLtr: 0, shipQtyLtr: 0, pendingQtyLtr: 0,
  });
  const add = (t, r) => {
    t.orderedQty += r.orderedQty || 0;
    t.amount += r.amount || 0;
    t.shipQty += r.shipQty || 0;
    t.pendingQty += r.pendingQty || 0;
    t.orderedQtyLtr += r.orderedQtyLtr || 0;
    t.shipQtyLtr += r.shipQtyLtr || 0;
    t.pendingQtyLtr += r.pendingQtyLtr || 0;
  };
  // Item lines show litres only when the line is LTR; blank otherwise.
  const ltrCell = (r, v) => (r.unit === "LTR" ? v ?? 0 : "");

  let curSp = null;
  let curOrder = null;
  let spTotal = zero();
  let soTotal = zero();
  let spOrders = 0;
  let soLines = 0;

  const closeOrder = () => {
    if (curOrder == null) return;
    rows.push({ row_type: "so_total", orderNo: curOrder, ...soTotal });
    soTotal = zero();
    curOrder = null;
  };
  const closeSalesPerson = () => {
    if (!bySalesPerson || curSp == null) return;
    closeOrder();
    rows.push({ row_type: "sales_person_total", salesPerson: curSp, orders: spOrders, ...spTotal });
    spTotal = zero();
    spOrders = 0;
    curSp = null;
  };

  for (const r of sorted) {
    if (bySalesPerson && r.salesPerson !== curSp) {
      closeSalesPerson();
      curSp = r.salesPerson;
      rows.push({ row_type: "sales_person_header", salesPerson: curSp });
    }
    if (r.orderNo !== curOrder) {
      closeOrder();
      curOrder = r.orderNo;
      spOrders += 1;
      soLines = 0;
    }
    const first = soLines === 0;
    soLines += 1;
    rows.push({
      row_type: "so_line",
      // SO columns only on the order's first line
      orderNo: first ? r.orderNo : "",
      orderDate: first ? fmtShortDate(r.orderDate) : "",
      partyCode: first ? r.partyCode : "",
      customer: first ? r.customer : "",
      sale_po: first ? (r.sale_po || "") : "",
      salesPerson: r.salesPerson,
      _orderNo: r.orderNo,
      order_no: r.order_no,
      tran_code: r.tran_code,
      code: r.code,
      itemName: r.itemName,
      orderedQty: r.orderedQty || 0,
      rate: r.rate || 0,
      amount: r.amount || 0,
      shipQty: r.shipQty || 0,
      pendingQty: r.pendingQty || 0,
      unit: r.unit || "KG",
      orderedQtyLtr: ltrCell(r, r.orderedQtyLtr),
      shipQtyLtr: ltrCell(r, r.shipQtyLtr),
      pendingQtyLtr: ltrCell(r, r.pendingQtyLtr),
    });
    add(soTotal, r);
    add(spTotal, r);
  }
  closeOrder();
  closeSalesPerson();
  return rows;
}

function groupOrderBalanceByOrder(data = [], view = "customer") {
  const grouped = {};

  data.forEach((item) => {
    // Changed: Group by Order No + Item Code
    const key = `${item.orderNo}_${item.itemCode}`;

    if (!grouped[key]) {
      grouped[key] = {
        customer: item.customer,
        order_no: item.order_no,
        tran_code: item.tran_code,
        orderNo: item.orderNo,
        orderDate: item.orderDate,
        sale_po: item.sale_po,
        totalOrdered: 0,
        totalShip: 0,
        totalPending: 0,
        // Grouped per order + item, so one unit per row. LTR figures stay
        // null on KG rows so the report shows them blank.
        unit: item.unit || "KG",
        totalOrderedLtr: item.unit === "LTR" ? 0 : null,
        totalShipLtr: item.unit === "LTR" ? 0 : null,
        totalPendingLtr: item.unit === "LTR" ? 0 : null,
        transactions: [],
      };
    }
    grouped[key].totalOrdered += item.orderedQty || 0;
    grouped[key].totalShip += item.shipQty || 0;
    grouped[key].totalPending += item.pendingQty || 0;
    if (item.unit === "LTR") {
      grouped[key].totalOrderedLtr += item.orderedQtyLtr || 0;
      grouped[key].totalShipLtr += item.shipQtyLtr || 0;
      grouped[key].totalPendingLtr += item.pendingQtyLtr || 0;
    }
    grouped[key].transactions.push(item);
  });

  const groupedArray = Object.values(grouped);

  // Latest date first everywhere.
  if (view === "datewise") {
    return groupedArray.sort((a, b) => {
      const dateA = new Date(a.orderDate);
      const dateB = new Date(b.orderDate);
      if (dateB - dateA !== 0) {
        return dateB - dateA;
      }
      if (a.orderNo !== b.orderNo) {
        return b.orderNo - a.orderNo;
      }
      return (a.customer || "").localeCompare(b.customer || "");
    });
  }

  // Newest orderDate for each customer to determine their global order
  const customerMaxDates = {};
  groupedArray.forEach((item) => {
    const cust = (item.customer || "").trim().toLowerCase();
    const d = new Date(item.orderDate);
    if (!customerMaxDates[cust] || d > customerMaxDates[cust]) {
      customerMaxDates[cust] = d;
    }
  });

  return groupedArray.sort((a, b) => {
    const custA = (a.customer || "").trim().toLowerCase();
    const custB = (b.customer || "").trim().toLowerCase();

    // 1. Customer with the newest order first
    const maxDateA = customerMaxDates[custA];
    const maxDateB = customerMaxDates[custB];
    if (maxDateB - maxDateA !== 0) {
      return maxDateB - maxDateA;
    }

    // 2. Sort by customer name alphabetically if their newest dates match
    if (custA !== custB) {
      return custA.localeCompare(custB);
    }

    // 3. Within a customer, newest order first
    const dateA = new Date(a.orderDate);
    const dateB = new Date(b.orderDate);
    if (dateB - dateA !== 0) {
      return dateB - dateA;
    }

    // 4. Then by order number, highest first
    return b.orderNo - a.orderNo;
  });
}

async function getCustomerAgingReport(filters) {
  let { reportDate, customer, region, po_no, view, city, sale_person } = filters;
  const customerMacnos = await getAccountGroup("customers");

  const asOfDate = reportDate ? new Date(reportDate) : new Date();
  const noInterval = view === "noInterval" || view === "consolidateInterval";

  if (!reportDate) {
    reportDate = new Date().toISOString().split("T")[0];
  }

  // Sales person filter resolution (supports multi-select array, comma-separated IDs, or single string)
  const spParam = filters.sale_person ?? filters.salesPersonIds ?? filters.salesPerson ?? filters.salesPersonId;
  const salesPersonFilter = Array.isArray(spParam)
    ? spParam.map(String).filter(Boolean)
    : typeof spParam === "string" && spParam.trim().length > 0 && spParam.trim() !== "all"
    ? spParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  let allowedSalesPersons = null;
  if (salesPersonFilter && salesPersonFilter.length > 0) {
    const matchingUsers = await prisma.user.findMany({
      where: {
        OR: [
          { id: { in: salesPersonFilter } },
          { username: { in: salesPersonFilter } },
          { name: { in: salesPersonFilter } },
        ],
      },
      select: { id: true, username: true },
    });

    const keysSet = new Set(salesPersonFilter);
    matchingUsers.forEach((u) => {
      if (u.id) keysSet.add(u.id);
      if (u.username) keysSet.add(u.username);
    });
    allowedSalesPersons = Array.from(keysSet);
  }

  // due_date SQL fragment: noInterval = invoice date, else invoice date + customer cr_days
  const dueDateExpr = noInterval
    ? Prisma.sql`il.dated`
    : Prisma.sql`il.dated + (COALESCE(ci.cr_days, 0) * INTERVAL '1 day')`;

  // Region / PO are properties of a sale order, so they can only narrow
  // invoice lines. The per-customer "On Account" residual (see below) has no
  // order and is dropped while either is active — the report then
  // deliberately does NOT foot to the ledger.
  //
  // Sales person is NOT an order filter: it means the customers assigned to
  // that person (ACNO.salesArea), the same rule as Sales Team MIS and Sales
  // Targets. It narrows customer_info, so each customer keeps every invoice
  // and its On Account line and still foots to the ledger.
  const orderFilterActive =
    (region && region !== "all") ||
    (po_no && po_no !== "");

  // ── Reconciliation contract ──────────────────────────────────────────────
  // Per customer:  Σ outstanding (this report)  ==  account-ledger balance as
  // of `reportDate`. Three things make that hold:
  //   1. An aging line is one invoice DOCUMENT (tran_id). invoice_no is not
  //      unique per customer (series restart every 1 July, and duplicate
  //      postings exist), so keying by number double-subtracted receipts.
  //   2. Settlements come from INVOICE_KNOCKOFF — the allocation table kept
  //      by lib/ledger/invoiceMatcher.js — which resolves a receipt/JV to an
  //      invoice_tran_id. JV debit notes sit there as negative allocations,
  //      so they are never listed as a second "invoice" for the same number.
  //   3. Everything the ledger carries that is NOT on an invoice (receipts
  //      posted without an invoice number and not yet knocked off, opening
  //      JVs, payments, returns naming no invoice …) is emitted as ONE
  //      "On Account" line per customer = ledger balance − Σ invoice
  //      outstanding. Negative = unapplied credit, positive = un-invoiced
  //      debit. It ages as "current".
  try {
    const agingReport = await prisma.$queryRaw`

    WITH customer_info AS (
      SELECT DISTINCT
        a.acno,
        a.acname AS customer_name,
        a.cr_days
      FROM "acno" a
      WHERE a.macno IN (${macnoInSql(customerMacnos)})
      ${customer && customer !== ""
        ? Prisma.sql`AND a.acno = ${Number(customer)}`
        : Prisma.empty
      }
      ${city && city !== ""
        ? Prisma.sql`AND a.city = ${city}`
        : Prisma.empty
      }
      ${allowedSalesPersons && allowedSalesPersons.length > 0
        ? Prisma.sql`AND a.sales_ares IN (${Prisma.join(allowedSalesPersons)})`
        : Prisma.empty
      }
    ),

    /* Ledger balance per customer as of the report date — the exact Dr/Cr
       rules of getAccountLedger, so the aging total is forced to agree. */
    ledger_balance AS (
      SELECT
        t.acno AS customer_code,
        SUM(
          CASE
            WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt, 0)
            WHEN tm.tran_code = 2 AND t.sub_tran_id = 1      THEN COALESCE(t.damt, 0)
            WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN COALESCE(t.damt, 0)
            ELSE 0
          END
          -
          CASE
            WHEN tm.tran_code = 1 AND t.sub_tran_id = 1      THEN COALESCE(t.camt, 0)
            WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt, 0)
            WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN COALESCE(t.camt, 0)
            ELSE 0
          END
        ) AS balance
      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      INNER JOIN customer_info ci ON ci.acno = t.acno
      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        AND tm.dated <= ${asOfDate}::date
      GROUP BY t.acno
    ),

    /* GST per sales invoice: sum st_amount from product lines (sub_tran_id=1) */
    sales_tax AS (
      SELECT tran_id, SUM(COALESCE(st_amount, 0)) AS total_gst
      FROM "Transactions"
      WHERE sub_tran_id = 1
      GROUP BY tran_id
    ),

    /* ===============================
       INVOICE LINES — one per document
       tran_code 6 = Sales Invoice (customer via tm.pycd)
       tran_code 3 = JV-raised receivable carrying an invoice_no
    =============================== */
    invoice_lines AS (
      SELECT
        tm.tran_id,
        tm.invoice_no,
        tm.dated,
        tm.vr_no,
        tm.tran_code,
        tm.pycd                      AS customer_code,
        tm.so_no,
        tm.dispatch_no,
        SUM(COALESCE(t.damt, 0))     AS invoice_amount
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t
        ON t.tran_id = tm.tran_id
       AND t.acno    = tm.pycd
      INNER JOIN customer_info ci ON ci.acno = tm.pycd
      WHERE tm.tran_code = 6
        AND tm.dated <= ${asOfDate}::date
      GROUP BY
        tm.tran_id, tm.invoice_no, tm.dated, tm.vr_no, tm.tran_code,
        tm.pycd, tm.so_no, tm.dispatch_no

      UNION ALL

      /* A JV debit line the knock-off engine already ALLOCATED onto an
         invoice is a settlement (debit note), not a new receivable — it is
         netted through knockoff_settlements below, so exclude it here. */
      SELECT
        tm.tran_id,
        t.invoice_no,
        tm.dated,
        tm.vr_no,
        tm.tran_code,
        t.acno,
        NULL::int,
        NULL::int,
        SUM(COALESCE(t.damt, 0))
      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      INNER JOIN customer_info ci ON ci.acno = t.acno
      WHERE tm.tran_code = 3
        AND tm.dated <= ${asOfDate}::date
        AND t.invoice_no IS NOT NULL
        AND t.invoice_no <> ''
        AND COALESCE(t.damt, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "INVOICE_KNOCKOFF" k
          WHERE k.source_line_id = t.id AND k.reversed_at IS NULL
        )
      GROUP BY tm.tran_id, t.invoice_no, tm.dated, tm.vr_no, tm.tran_code, t.acno
    ),

    /* ===============================
       SETTLEMENTS
       Receipts / JV credits / JV debit notes (negative) per invoice document,
       from the allocation table, dated up to the report date.
    =============================== */
    knockoff_settlements AS (
      SELECT
        k.invoice_tran_id        AS tran_id,
        SUM(k.allocated_amount)  AS amt
      FROM "INVOICE_KNOCKOFF" k
      INNER JOIN "TRANSACTIONS_MASTER" src ON src.tran_id = k.source_tran_id
      WHERE k.reversed_at IS NULL
        AND k.invoice_tran_id IS NOT NULL
        AND src.dated <= ${asOfDate}::date
      GROUP BY k.invoice_tran_id
    ),

    /* Sale Returns (10) are not auto-matched; they always name the invoice.
       When a number is shared by several documents the earliest takes it. */
    return_settlements AS (
      SELECT
        il.tran_id,
        SUM(COALESCE(t.camt, 0)) AS amt
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t
        ON t.tran_id = tm.tran_id
       AND t.acno    = tm.pycd
      CROSS JOIN LATERAL (
        SELECT il.tran_id
        FROM invoice_lines il
        WHERE il.customer_code = tm.pycd
          AND il.invoice_no    = tm.invoice_no
        ORDER BY il.dated, il.tran_id
        LIMIT 1
      ) il
      WHERE tm.tran_code = 10
        AND tm.dated <= ${asOfDate}::date
        AND tm.invoice_no IS NOT NULL
        AND tm.invoice_no <> ''
      GROUP BY il.tran_id
    ),

    invoice_outstanding AS (
      SELECT
        il.*,
        COALESCE(ks.amt, 0) + COALESCE(rs.amt, 0)                     AS direct_receipts,
        il.invoice_amount - COALESCE(ks.amt, 0) - COALESCE(rs.amt, 0) AS outstanding_amount,
        ci.customer_name,
        ci.cr_days,
        om.sale_po                                                    AS sale_po_number,
        om.region,
        om.order_no                                                   AS po_number,
        om.userid,
        COALESCE(stx.total_gst, 0)                                    AS gst_amount,
        CASE WHEN il.tran_code = 6 THEN ${dueDateExpr} ELSE il.dated END AS due_date
      FROM invoice_lines il
      INNER JOIN customer_info ci        ON ci.acno    = il.customer_code
      LEFT  JOIN knockoff_settlements ks ON ks.tran_id = il.tran_id
      LEFT  JOIN return_settlements   rs ON rs.tran_id = il.tran_id
      LEFT  JOIN "OrderMaster" om        ON om.order_no = il.so_no
      LEFT  JOIN sales_tax stx           ON stx.tran_id = il.tran_id
    ),

    /* Ledger − Σ invoice outstanding: what is on the account but not on any
       invoice. One line per customer, so the report foots to the ledger. */
    unallocated AS (
      SELECT
        lb.customer_code,
        ci.customer_name,
        ci.cr_days,
        lb.balance - COALESCE(io.total_outstanding, 0) AS amount
      FROM ledger_balance lb
      INNER JOIN customer_info ci ON ci.acno = lb.customer_code
      LEFT JOIN (
        SELECT customer_code, SUM(outstanding_amount) AS total_outstanding
        FROM invoice_outstanding
        GROUP BY customer_code
      ) io ON io.customer_code = lb.customer_code
    ),

    final_aging AS (
      SELECT
        customer_name, customer_code, cr_days,
        dated       AS invoice_date,
        vr_no       AS voucher_no,
        tran_code, dispatch_no, so_no, invoice_no,
        sale_po_number, region, po_number,
        invoice_amount, gst_amount, direct_receipts, outstanding_amount, due_date,
        FALSE       AS is_unallocated,
        tran_id
      FROM invoice_outstanding
      WHERE ABS(outstanding_amount) >= 0.005
        ${region && region !== "all"
        ? Prisma.sql`AND region = ${region}`
        : Prisma.empty
      }
        ${po_no && po_no !== ""
        ? Prisma.sql`AND so_no = ${Number(po_no)}`
        : Prisma.empty
      }

      ${orderFilterActive
        ? Prisma.empty
        : Prisma.sql`
      UNION ALL
      SELECT
        customer_name, customer_code, cr_days,
        ${asOfDate}::date, NULL::int, NULL::int, NULL::int, NULL::int,
        'UNALLOCATED', NULL, NULL, NULL,
        CASE WHEN amount > 0 THEN  amount ELSE 0 END,   -- un-invoiced debit
        0,
        CASE WHEN amount < 0 THEN -amount ELSE 0 END,   -- unapplied credit
        amount,
        ${asOfDate}::date,
        TRUE,
        NULL::int
      FROM unallocated
      WHERE ABS(amount) >= 0.005`
      }
    )

    SELECT
      customer_name,
      customer_code,
      invoice_date,
      voucher_no,
      tran_code,
      dispatch_no,
      sale_po_number,
      cr_days,
      is_unallocated,
      tran_id,

      CASE tran_code
        WHEN 6 THEN 'Sale Invoice'
        WHEN 3 THEN 'Journal'
        ELSE        'On Account'
      END AS tran_type,

      COALESCE(invoice_no, voucher_no::text) AS invoice_no,

      due_date,
      so_no AS sales_order_no,
      po_number,
      region,

      invoice_amount::numeric,
      gst_amount::numeric,
      (invoice_amount - gst_amount)::numeric AS amount_without_gst,
      direct_receipts::numeric,
      outstanding_amount::numeric,
      EXTRACT(DAY FROM (${asOfDate}::date - due_date))::numeric AS days_outstanding

    FROM final_aging

    ORDER BY
    (
      SELECT MAX(f2.invoice_date)
      FROM final_aging f2
      WHERE f2.customer_code = final_aging.customer_code
        -- On Account line is dated the As of Date; keep it out of the newest date
        AND f2.is_unallocated = FALSE
    ) DESC NULLS LAST,
    customer_name ASC,
    is_unallocated ASC,
    invoice_date DESC NULLS LAST,
    voucher_no DESC
    `;

    // Aging buckets are derived here (not in SQL) so the "On Account" line
    // and invoice lines share one definition.
    const bucket = (days, amt) => ({
      currentAmount: days <= 0 ? amt : 0,
      days1To30: days >= 1 && days <= 30 ? amt : 0,
      days31To60: days >= 31 && days <= 60 ? amt : 0,
      days61To90: days >= 61 && days <= 90 ? amt : 0,
      days91To120: days >= 91 && days <= 120 ? amt : 0,
      daysOver120: days > 120 ? amt : 0,
    });

    const processedResults = agingReport.map((row) => {
      const outstanding = parseFloat(row.outstanding_amount) || 0;
      const days = parseInt(row.days_outstanding) || 0;
      return {
        customerName: row.customer_name,
        customerCode: row.customer_code,
        crDays: row.cr_days,
        dispatchNo: row.dispatch_no,
        salePoNumber: row.sale_po_number,
        invoiceDate: row.invoice_date,
        voucherNo: row.voucher_no != null ? parseInt(row.voucher_no) : null,
        invoiceNo: row.invoice_no,
        tranType: row.tran_type,
        isUnallocated: !!row.is_unallocated,
        tran_id: row.tran_id != null ? Number(row.tran_id) : null, // voucher drill (rule 15)
        tran_code: row.tran_code != null ? Number(row.tran_code) : null,
        dueDate: row.due_date,
        salesOrderNo: row.sales_order_no,
        poNumber: row.po_number,
        region: row.region || "Not Specified",
        invoiceAmount: parseFloat(row.invoice_amount) || 0,
        gstAmount: parseFloat(row.gst_amount) || 0,
        amountWithoutGST: parseFloat(row.amount_without_gst) || 0,
        directReceipts: parseFloat(row.direct_receipts) || 0,
        outstandingAmount: outstanding,
        daysOutstanding: days,
        // The credit period split, asked for alongside the aging breakup.
        // due_date is already invoice date + the customer's cr_days, and
        // daysOutstanding is measured from it, so the test is simply whether
        // that date has passed:
        //   days <= 0  the credit period still has time to run  → current due
        //   days >  0  the credit period has expired            → overdue
        // The two always add back to outstandingAmount, and overdue is the
        // sum of the 1-7 … over-120 buckets, so the breakup still foots.
        currentDueAmount: days <= 0 ? outstanding : 0,
        overdueAmount: days > 0 ? outstanding : 0,
        ...bucket(days, outstanding),
      };
    });

    if (view === "summary" || view === "noInterval") {
      return calculateCustomerWiseSummary(processedResults);
    }

    return processedResults;

  } catch (error) {
    console.error("Error in getCustomerAgingReport:", error);
    throw new Error(
      `Failed to generate customer aging report: ${error.message}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR AGING — getCustomerAgingReport mirrored for payables.
//   bill         = Purchase Invoice (4): the vendor line (t.acno = tm.pycd,
//                  sub_tran_id 3) is a CREDIT (camt)
//   settlements  = INVOICE_KNOCKOFF onto that bill (Payments (2) +, JV −),
//                  plus Purchase Returns (9) naming the bill's invoice_no
//   JV payable   = a JV CREDIT on a vendor carrying an invoice_no that is not
//                  itself a knock-off source
//   On Account   = payable ledger balance − Σ bill outstanding, one line per
//                  vendor, so Σ outstanding == the vendor's ledger balance
// Amounts are PAYABLE (credit − debit), so a positive outstanding is what we
// owe. Rows keep the customer field names so calculateCustomerWiseSummary /
// calculateAgingSummary and the shared columns work unchanged.
// ─────────────────────────────────────────────────────────────────────────────
async function getVendorAgingReport(filters) {
  let { reportDate, vendor, region, po_no, view, city } = filters;
  const vendorMacnos = await getAccountGroup("vendors");

  const asOfDate = reportDate ? new Date(reportDate) : new Date();
  const noInterval = view === "noInterval" || view === "consolidateInterval";

  if (!reportDate) {
    reportDate = new Date().toISOString().split("T")[0];
  }

  // Sales person filter resolution — same as Customer Aging
  const spParam = filters.sale_person ?? filters.salesPersonIds ?? filters.salesPerson ?? filters.salesPersonId;
  const salesPersonFilter = Array.isArray(spParam)
    ? spParam.map(String).filter(Boolean)
    : typeof spParam === "string" && spParam.trim().length > 0 && spParam.trim() !== "all"
    ? spParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  let allowedSalesPersons = null;
  if (salesPersonFilter && salesPersonFilter.length > 0) {
    const matchingUsers = await prisma.user.findMany({
      where: {
        OR: [
          { id: { in: salesPersonFilter } },
          { username: { in: salesPersonFilter } },
          { name: { in: salesPersonFilter } },
        ],
      },
      select: { id: true, username: true },
    });

    const keysSet = new Set(salesPersonFilter);
    matchingUsers.forEach((u) => {
      if (u.id) keysSet.add(u.id);
      if (u.username) keysSet.add(u.username);
    });
    allowedSalesPersons = Array.from(keysSet);
  }

  // due_date: noInterval = bill date, else bill date + vendor cr_days
  const dueDateExpr = noInterval
    ? Prisma.sql`il.dated`
    : Prisma.sql`il.dated + (COALESCE(vi.cr_days, 0) * INTERVAL '1 day')`;

  // Region / PO / sales-person narrow bill lines only; the On Account
  // residual has no order and is dropped while any of them is active.
  const orderFilterActive =
    (region && region !== "all") ||
    (po_no && po_no !== "") ||
    (allowedSalesPersons && allowedSalesPersons.length > 0);

  try {
    const agingReport = await prisma.$queryRaw`

    WITH vendor_info AS (
      SELECT DISTINCT
        a.acno,
        a.acname AS vendor_name,
        a.cr_days
      FROM "acno" a
      WHERE a.macno IN (${macnoInSql(vendorMacnos)})
      ${vendor && vendor !== ""
        ? Prisma.sql`AND a.acno = ${Number(vendor)}`
        : Prisma.empty
      }
      ${city && city !== ""
        ? Prisma.sql`AND a.city = ${city}`
        : Prisma.empty
      }
      ${allowedSalesPersons && allowedSalesPersons.length > 0
        ? Prisma.sql`AND (a.sales_ares IN (${Prisma.join(allowedSalesPersons)}) OR a.acno IN (SELECT party_code FROM "OrderMaster" WHERE userid IN (${Prisma.join(allowedSalesPersons)})))`
        : Prisma.empty
      }
    ),

    /* Payable balance per vendor as of the report date — getAccountLedger's
       Dr/Cr rules, signed credit − debit (what we owe). */
    ledger_balance AS (
      SELECT
        t.acno AS vendor_code,
        SUM(
          CASE
            WHEN tm.tran_code = 1 AND t.sub_tran_id = 1      THEN COALESCE(t.camt, 0)
            WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt, 0)
            WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN COALESCE(t.camt, 0)
            ELSE 0
          END
          -
          CASE
            WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt, 0)
            WHEN tm.tran_code = 2 AND t.sub_tran_id = 1      THEN COALESCE(t.damt, 0)
            WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)           THEN COALESCE(t.damt, 0)
            ELSE 0
          END
        ) AS balance
      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      INNER JOIN vendor_info vi ON vi.acno = t.acno
      WHERE tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
        AND tm.dated <= ${asOfDate}::date
      GROUP BY t.acno
    ),

    /* GST per purchase invoice: st_amount on the item lines (sub_tran_id=1) */
    purchase_tax AS (
      SELECT tran_id, SUM(COALESCE(st_amount, 0)) AS total_gst
      FROM "Transactions"
      WHERE sub_tran_id = 1
      GROUP BY tran_id
    ),

    /* BILL LINES — one per document
       tran_code 4 = Purchase Invoice (vendor via tm.pycd, credited)
       tran_code 3 = JV-raised payable carrying an invoice_no */
    invoice_lines AS (
      SELECT
        tm.tran_id,
        tm.invoice_no,
        tm.dated,
        tm.vr_no,
        tm.tran_code,
        tm.pycd                      AS vendor_code,
        tm.po_no,
        tm.grn_no,
        SUM(COALESCE(t.camt, 0))     AS invoice_amount
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t
        ON t.tran_id = tm.tran_id
       AND t.acno    = tm.pycd
      INNER JOIN vendor_info vi ON vi.acno = tm.pycd
      WHERE tm.tran_code = 4
        AND tm.dated <= ${asOfDate}::date
      GROUP BY
        tm.tran_id, tm.invoice_no, tm.dated, tm.vr_no, tm.tran_code,
        tm.pycd, tm.po_no, tm.grn_no

      UNION ALL

      /* A JV credit line already ALLOCATED onto a bill is a settlement, not a
         new payable — it is netted through knockoff_settlements below. */
      SELECT
        tm.tran_id,
        t.invoice_no,
        tm.dated,
        tm.vr_no,
        tm.tran_code,
        t.acno,
        NULL::int,
        NULL::int,
        SUM(COALESCE(t.camt, 0))
      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      INNER JOIN vendor_info vi ON vi.acno = t.acno
      WHERE tm.tran_code = 3
        AND tm.dated <= ${asOfDate}::date
        AND t.invoice_no IS NOT NULL
        AND t.invoice_no <> ''
        AND COALESCE(t.camt, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "INVOICE_KNOCKOFF" k
          WHERE k.source_line_id = t.id AND k.reversed_at IS NULL
        )
      GROUP BY tm.tran_id, t.invoice_no, tm.dated, tm.vr_no, tm.tran_code, t.acno
    ),

    /* SETTLEMENTS — payments / JVs per bill from the allocation table */
    knockoff_settlements AS (
      SELECT
        k.invoice_tran_id        AS tran_id,
        SUM(k.allocated_amount)  AS amt
      FROM "INVOICE_KNOCKOFF" k
      INNER JOIN "TRANSACTIONS_MASTER" src ON src.tran_id = k.source_tran_id
      WHERE k.reversed_at IS NULL
        AND k.invoice_tran_id IS NOT NULL
        AND src.dated <= ${asOfDate}::date
      GROUP BY k.invoice_tran_id
    ),

    /* Purchase Returns (9) naming the bill; earliest document takes a shared number */
    return_settlements AS (
      SELECT
        il.tran_id,
        SUM(COALESCE(t.damt, 0)) AS amt
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t
        ON t.tran_id = tm.tran_id
       AND t.acno    = tm.pycd
      CROSS JOIN LATERAL (
        SELECT il.tran_id
        FROM invoice_lines il
        WHERE il.vendor_code = tm.pycd
          AND il.invoice_no  = tm.invoice_no
        ORDER BY il.dated, il.tran_id
        LIMIT 1
      ) il
      WHERE tm.tran_code = 9
        AND tm.dated <= ${asOfDate}::date
        AND tm.invoice_no IS NOT NULL
        AND tm.invoice_no <> ''
      GROUP BY il.tran_id
    ),

    invoice_outstanding AS (
      SELECT
        il.*,
        COALESCE(ks.amt, 0) + COALESCE(rs.amt, 0)                     AS direct_payments,
        il.invoice_amount - COALESCE(ks.amt, 0) - COALESCE(rs.amt, 0) AS outstanding_amount,
        vi.vendor_name,
        vi.cr_days,
        om.region,
        om.userid,
        COALESCE(ptx.total_gst, 0)                                    AS gst_amount,
        CASE WHEN il.tran_code = 4 THEN ${dueDateExpr} ELSE il.dated END AS due_date
      FROM invoice_lines il
      INNER JOIN vendor_info vi          ON vi.acno    = il.vendor_code
      LEFT  JOIN knockoff_settlements ks ON ks.tran_id = il.tran_id
      LEFT  JOIN return_settlements   rs ON rs.tran_id = il.tran_id
      LEFT  JOIN "OrderMaster" om        ON om.order_no = il.po_no
      LEFT  JOIN purchase_tax ptx        ON ptx.tran_id = il.tran_id
    ),

    /* Ledger − Σ bill outstanding: one On Account line per vendor */
    unallocated AS (
      SELECT
        lb.vendor_code,
        vi.vendor_name,
        vi.cr_days,
        lb.balance - COALESCE(io.total_outstanding, 0) AS amount
      FROM ledger_balance lb
      INNER JOIN vendor_info vi ON vi.acno = lb.vendor_code
      LEFT JOIN (
        SELECT vendor_code, SUM(outstanding_amount) AS total_outstanding
        FROM invoice_outstanding
        GROUP BY vendor_code
      ) io ON io.vendor_code = lb.vendor_code
    ),

    final_aging AS (
      SELECT
        vendor_name, vendor_code, cr_days,
        dated       AS invoice_date,
        vr_no       AS voucher_no,
        tran_code, grn_no, po_no, invoice_no, region,
        invoice_amount, gst_amount, direct_payments, outstanding_amount, due_date,
        FALSE       AS is_unallocated,
        tran_id
      FROM invoice_outstanding
      WHERE ABS(outstanding_amount) >= 0.005
        ${region && region !== "all"
        ? Prisma.sql`AND region = ${region}`
        : Prisma.empty
      }
        ${po_no && po_no !== ""
        ? Prisma.sql`AND po_no = ${Number(po_no)}`
        : Prisma.empty
      }
        ${allowedSalesPersons && allowedSalesPersons.length > 0
        ? Prisma.sql`AND (userid IN (${Prisma.join(allowedSalesPersons)}) OR vendor_code IN (SELECT acno FROM "acno" WHERE sales_ares IN (${Prisma.join(allowedSalesPersons)})))`
        : Prisma.empty
      }

      ${orderFilterActive
        ? Prisma.empty
        : Prisma.sql`
      UNION ALL
      SELECT
        vendor_name, vendor_code, cr_days,
        ${asOfDate}::date, NULL::int, NULL::int, NULL::int, NULL::int,
        'UNALLOCATED', NULL,
        CASE WHEN amount > 0 THEN  amount ELSE 0 END,   -- un-billed credit (we owe)
        0,
        CASE WHEN amount < 0 THEN -amount ELSE 0 END,   -- advance / unapplied payment
        amount,
        ${asOfDate}::date,
        TRUE,
        NULL::int
      FROM unallocated
      WHERE ABS(amount) >= 0.005`
      }
    )

    SELECT
      vendor_name,
      vendor_code,
      invoice_date,
      voucher_no,
      tran_code,
      grn_no,
      po_no,
      cr_days,
      is_unallocated,
      tran_id,

      CASE tran_code
        WHEN 4 THEN 'Purchase Invoice'
        WHEN 3 THEN 'Journal'
        ELSE        'On Account'
      END AS tran_type,

      COALESCE(invoice_no, voucher_no::text) AS invoice_no,

      due_date,
      region,

      invoice_amount::numeric,
      gst_amount::numeric,
      (invoice_amount - gst_amount)::numeric AS amount_without_gst,
      direct_payments::numeric,
      outstanding_amount::numeric,
      EXTRACT(DAY FROM (${asOfDate}::date - due_date))::numeric AS days_outstanding

    FROM final_aging
    ORDER BY
    (
      SELECT MAX(f2.invoice_date)
      FROM final_aging f2
      WHERE f2.vendor_code = final_aging.vendor_code
        -- On Account line is dated the As of Date; keep it out of the newest date
        AND f2.is_unallocated = FALSE
    ) DESC NULLS LAST,
    vendor_name ASC,
    is_unallocated ASC,
    invoice_date DESC NULLS LAST,
    voucher_no DESC
    `;

    // Same buckets as Customer Aging
    const bucket = (days, amt) => ({
      currentAmount: days <= 0 ? amt : 0,
      days1To30: days >= 1 && days <= 30 ? amt : 0,
      days31To60: days >= 31 && days <= 60 ? amt : 0,
      days61To90: days >= 61 && days <= 90 ? amt : 0,
      days91To120: days >= 91 && days <= 120 ? amt : 0,
      daysOver120: days > 120 ? amt : 0,
    });

    const processedResults = agingReport.map((row) => {
      const outstanding = parseFloat(row.outstanding_amount) || 0;
      const days = parseInt(row.days_outstanding) || 0;
      return {
        customerName: row.vendor_name,
        customerCode: row.vendor_code,
        crDays: row.cr_days,
        dispatchNo: row.grn_no,      // shown as "GRN NO"
        salePoNumber: row.po_no,     // shown as "P.O NO"
        invoiceDate: row.invoice_date,
        voucherNo: row.voucher_no != null ? parseInt(row.voucher_no) : null,
        invoiceNo: row.invoice_no,
        tranType: row.tran_type,
        isUnallocated: !!row.is_unallocated,
        tran_id: row.tran_id != null ? Number(row.tran_id) : null, // voucher drill (rule 15)
        tran_code: row.tran_code != null ? Number(row.tran_code) : null,
        dueDate: row.due_date,
        poNumber: row.po_no,
        region: row.region || "Not Specified",
        invoiceAmount: parseFloat(row.invoice_amount) || 0,
        gstAmount: parseFloat(row.gst_amount) || 0,
        amountWithoutGST: parseFloat(row.amount_without_gst) || 0,
        directReceipts: parseFloat(row.direct_payments) || 0, // shown as "PAID"
        outstandingAmount: outstanding,
        daysOutstanding: days,
        currentDueAmount: days <= 0 ? outstanding : 0,
        overdueAmount: days > 0 ? outstanding : 0,
        ...bucket(days, outstanding),
      };
    });

    if (view === "summary" || view === "noInterval") {
      return calculateCustomerWiseSummary(processedResults);
    }

    return processedResults;

  } catch (error) {
    console.error("Error in getVendorAgingReport:", error);
    throw new Error(
      `Failed to generate vendor aging report: ${error.message}`
    );
  }
}

function calculateCustomerWiseSummary(data) {
  if (!Array.isArray(data)) return [];

  const customerMap = {};

  data.forEach((item) => {
    const key = item.customerCode;

    if (!customerMap[key]) {
      customerMap[key] = {
        customerName: item.customerName,
        customerCode: item.customerCode,
        totalInvoices: 0,
        totalInvoiceAmount: 0,
        totalDirectReceipts: 0,
        totalOutstanding: 0,
        currentDueAmount: 0,
        overdueAmount: 0,
        currentAmount: 0,
        days1To30: 0,
        days31To60: 0,
        days61To90: 0,
        days91To120: 0,
        daysOver120: 0,
        oldestInvoiceDays: 0,
      };
    }

    const c = customerMap[key];

    // The per-customer "On Account" residual is not an invoice
    if (!item.isUnallocated) c.totalInvoices += 1;
    c.totalInvoiceAmount += item.invoiceAmount;
    c.totalDirectReceipts += item.directReceipts;
    c.totalOutstanding += item.outstandingAmount;
    c.currentDueAmount += item.currentDueAmount || 0;
    c.overdueAmount += item.overdueAmount || 0;
    c.currentAmount += item.currentAmount;
    c.days1To30 += item.days1To30;
    c.days31To60 += item.days31To60;
    c.days61To90 += item.days61To90;
    c.days91To120 += item.days91To120;
    c.daysOver120 += item.daysOver120;

    if (item.daysOutstanding > c.oldestInvoiceDays) {
      c.oldestInvoiceDays = item.daysOutstanding;
    }
  });

  return Object.values(customerMap).map((row) => {
    Object.keys(row).forEach((k) => {
      if (typeof row[k] === "number") {
        row[k] = Math.round(row[k] * 100) / 100;
      }
    });
    return row;
  });
}


function calculateAgingSummary(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      totalInvoices: 0,
      totalInvoiceAmount: 0,
      totalGST: 0,
      totalAmountWithoutGST: 0,
      totalDirectReceipts: 0,
      totalOutstanding: 0,
      currentAmount: 0,
      days1To30: 0,
      days31To60: 0,
      days61To90: 0,
      days91To120: 0,
      daysOver120: 0,
      averageDaysOutstanding: 0,
      oldestInvoiceDays: 0,
    };
  }

  const summary = {
    totalInvoices: data.length,
    totalInvoiceAmount: data.reduce((sum, item) => sum + (item.invoiceAmount || item.totalInvoiceAmount), 0),
    totalGST: data.reduce((sum, item) => sum + (item.gstAmount || 0), 0),
    totalAmountWithoutGST: data.reduce((sum, item) => sum + (item.amountWithoutGST || item.invoiceAmount || item.totalInvoiceAmount || 0), 0),
    totalDirectReceipts: data.reduce(
      (sum, item) => sum + item.directReceipts,
      0
    ),
    totalOutstanding: data.reduce(
      (sum, item) => sum + (item.outstandingAmount || item.totalOutstanding || 0),
      0
    ),
    currentAmount: data.reduce((sum, item) => sum + item.currentAmount, 0),
    days1To30: data.reduce((sum, item) => sum + item.days1To30, 0),
    days31To60: data.reduce((sum, item) => sum + item.days31To60, 0),
    days61To90: data.reduce((sum, item) => sum + item.days61To90, 0),
    days91To120: data.reduce((sum, item) => sum + item.days91To120, 0),
    daysOver120: data.reduce((sum, item) => sum + item.daysOver120, 0),

    // Calculate average days outstanding (weighted by outstanding amount)
    averageDaysOutstanding:
      data.length > 0
        ? data.reduce(
          (sum, item) => sum + item.daysOutstanding * item.outstandingAmount,
          0
        ) / data.reduce((sum, item) => sum + item.outstandingAmount, 0) || 0
        : 0,

    // Find oldest invoice
    oldestInvoiceDays:
      data.length > 0
        ? Math.max(...data.map((item) => item.daysOutstanding))
        : 0,
  };

  // Round all numeric values to 2 decimal places
  Object.keys(summary).forEach((key) => {
    if (typeof summary[key] === "number") {
      summary[key] = Math.round(summary[key] * 100) / 100;
    }
  });

  return summary;
}

async function getBOMReport(filters = {}) {
  let { dateFrom, dateTo, finishedItem, materialItem } = filters;

  // Defaults
  if (!dateFrom) dateFrom = "2000-01-01";
  if (!dateTo) dateTo = new Date().toISOString().split("T")[0];

  if (finishedItem) finishedItem = Number(finishedItem);
  if (materialItem) materialItem = Number(materialItem);

  try {
    const bomData = await prisma.$queryRaw`
      WITH bom_calc AS (
        SELECT 
          bm.id AS bom_id,
          bm.dated AS bom_date,
          bm.finished_id,
          fp.item AS finished_name,
          bd.material_id,
          mp.item AS material_name,
          bd.material_percentage,
 
          CONCAT('BOM #', bm.id, ' Material ', bd.material_id) AS description
 
        FROM "BomMaster" bm
        JOIN "BomDetail" bd ON bm.id = bd.bom_id
        JOIN "Item" fp ON bm.finished_id = fp.itcd
        JOIN "Item" mp ON bd.material_id = mp.itcd
 
        WHERE 
          bm.dated >= ${new Date(dateFrom)}::timestamp
          AND bm.dated <= ${new Date(dateTo)}::timestamp
          ${finishedItem
        ? Prisma.sql`AND bm.finished_id = ${finishedItem}`
        : Prisma.empty
      }
          ${materialItem
        ? Prisma.sql`AND bd.material_id = ${materialItem}`
        : Prisma.empty
      }
      )
 
      SELECT 
        bom_id,
        bom_date,
        finished_id,
        finished_name,
        material_id,
        material_name,
        material_percentage,
        description
      FROM bom_calc
      ORDER BY bom_id
    `;

    // Grouping BOM wise
    const bomMap = new Map();

    bomData.forEach((row) => {
      const bomId = Number(row.bom_id);

      if (!bomMap.has(bomId)) {
        bomMap.set(bomId, {
          bomId,
          bomDate: row.bom_date,
          finishedId: row.finished_id,
          finishedItem: row.finished_name,
          instructions: row.instructions,
          materials: [],
          totalPercentage: 0,
          totalMaterials: 0,
        });
      }

      const bom = bomMap.get(bomId);
      const percentage = parseFloat(row.material_percentage) || 0;

      bom.materials.push({
        bom_id: bomId,
        materialId: row.material_id,
        materialName: row.material_name,
        percentage,
        description: row.description,
      });

      bom.totalPercentage += percentage;
      bom.totalMaterials += 1;
    });

    return Array.from(bomMap.values());
  } catch (err) {
    console.error("Error in getBOMBalanceReport:", err);
    throw new Error("Failed to generate BOM Balance Report: " + err.message);
  }
}

function calculateBOMSummary(data) {
  return {
    totalBOMs: data.length,

    totalMaterialsUsed: data.reduce((sum, b) => sum + b.totalMaterials, 0),

    fullyAllocatedBOMs: data.filter((b) => b.totalPercentage === 100).length,
    overAllocatedBOMs: data.filter((b) => b.totalPercentage > 100).length,
    underAllocatedBOMs: data.filter((b) => b.totalPercentage < 100).length,

    avgMaterialCount:
      data.length > 0
        ? data.reduce((sum, b) => sum + b.totalMaterials, 0) / data.length
        : 0,

    avgPercentage:
      data.length > 0
        ? data.reduce((sum, b) => sum + b.totalPercentage, 0) / data.length
        : 0,
  };
}

// A QC realized value belongs to its QualityDetail row by detail_id (or parameter_name);
// position is only the last resort for very old rows that have neither.
function realizedFor(realized, detail, index) {
  return (
    realized.find((r) => r.detail_id && r.detail_id === detail.id) ||
    realized.find((r) => r.parameter_name && r.parameter_name === detail.parameter_name) ||
    (realized.every((r) => !r.detail_id && !r.parameter_name) ? realized[index] : undefined)
  );
}

async function getQCReport(filters) {
  const where = {
    proc_ord_no: { not: null }, // Only Production QC
    order_no: null, // Exclude Order QC
  };

  // Filter by item
  if (filters.item) {
    where.itcd = parseInt(filters.item);
  }

  // Filter by status
  if (filters.status && filters.status !== "all" && filters.status !== "") {
    where.status = filters.status;
  }

  // Filter by batchNo
  if (filters.batchNo) {
    where.batch_no = parseInt(filters.batchNo);
  }

  // Fetch QC master records for production only
  const qcRecords = await prisma.qualityMaster.findMany({
    where,
    include: {
      item: true,
      productionPlanMaster: {
        include: {
          item: true,
        },
      },
      details: {
        take: 1,
      },
    },
    orderBy: [{ batch_no: "desc" }, { mfg_date: "desc" }, { proc_ord_no: "desc" }],
  });

  // Filter by date range (based on mfg_date)
  let filteredRecords = qcRecords;
  if (filters.dateFrom || filters.dateTo) {
    filteredRecords = qcRecords.filter((record) => {
      if (!record.mfg_date) return false;

      const recordDate = new Date(record.mfg_date);
      const fromDate = filters.dateFrom ? new Date(filters.dateFrom) : null;
      const toDate = filters.dateTo ? new Date(filters.dateTo) : null;

      if (fromDate && recordDate < fromDate) return false;
      if (toDate) {
        // Include the entire day
        const toDateEnd = new Date(toDate);
        toDateEnd.setHours(23, 59, 59, 999);
        if (recordDate > toDateEnd) return false;
      }

      return true;
    });
  }

  // Get all unique parameters across all items to create dynamic columns
  const allParameters = await prisma.quality_parameters.findMany({
    orderBy: { parameter_name: "asc" },
  });
  const parameterNames = allParameters.map((p) => p.parameter_name);

  // Get status for each QC record (from QualityDetailDetail with attempt_no = itcd * 1000)
  const enrichedData = await Promise.all(
    filteredRecords.map(async (qc) => {
      // Get status attempt_no (itcd * 1000)
      const statusAttemptNo = qc.itcd * 1000;

      // Get all details for this QC record (excluding status records)
      const allDetails = await prisma.qualityDetail.findMany({
        where: {
          master_id: qc.id,
          proc_ord_no: qc.proc_ord_no,
          attempt_no: { not: statusAttemptNo }, // Exclude status attempt
        },
        orderBy: [{ attempt_no: "desc" }, { parameter_name: "asc" }],
      });

      // Get all realized values (excluding status)
      const allRealized = await prisma.qualityDetailDetail.findMany({
        where: {
          master_id: qc.id,
          proc_ord_no: qc.proc_ord_no,
          attempt_no: { not: statusAttemptNo }, // Exclude status attempt
        },
        orderBy: [{ attempt_no: "desc" }, { id: "asc" }],
      });

      // Get status from QualityDetailDetail
      const statusRecord = await prisma.qualityDetailDetail.findFirst({
        where: {
          master_id: qc.id,
          proc_ord_no: qc.proc_ord_no,
          attempt_no: statusAttemptNo,
        },
        orderBy: { id: "desc" },
      });

      // Map status enum to readable format
      let itemStatus = statusRecord?.quality_realized || qc.status || "DRAFT";
      if (itemStatus === "approve") itemStatus = "APPROVED";
      if (itemStatus === "reject") itemStatus = "REJECTED";
      if (itemStatus === "draft") itemStatus = "DRAFT";
      if (itemStatus === "rework") itemStatus = "REWORK";

      // For display in report: show actual status value
      const displayStatus = itemStatus;

      // Get reject_reason from the latest detail with reject_reason
      const latestDetailWithReason = allDetails.find((d) => d.reject_reason);
      const rejectReason = latestDetailWithReason?.reject_reason || "";

      // Get the latest attempt number (highest attempt_no, excluding status)
      const latestAttemptNo =
        allDetails.length > 0 ? allDetails[0].attempt_no : null;

      // Create a map of parameter_name -> quality_realized for the latest attempt
      const parameterMap = {};
      if (latestAttemptNo) {
        // Get details and realized values for latest attempt
        const latestDetails = allDetails.filter(
          (d) => d.attempt_no === latestAttemptNo
        );
        const latestRealized = allRealized.filter(
          (r) => r.attempt_no === latestAttemptNo
        );

        // Match realized values with details by order
        latestDetails.forEach((detail, index) => {
          if (realizedFor(latestRealized, detail, index)) {
            parameterMap[detail.parameter_name] =
              realizedFor(latestRealized, detail, index).quality_realized || "";
          }
        });
      }

      // Build the row with parameters as columns
      // Use productionPlanMaster values if available to ensure correctness
      const procOrdNo = qc.productionPlanMaster?.id || qc.proc_ord_no;
      const itcdValue = qc.productionPlanMaster?.finished_id || qc.itcd;

      const row = {
        id: qc.id,
        mfg_date: qc.mfg_date,
        proc_ord_no: procOrdNo,
        itcd: itcdValue,
        item_name: qc.item?.item || "",
        batch_no: qc.batch_no || "",
        batch_size: qc.batch_size || 0,
        status: itemStatus, // Keep original status for filtering
        display_status: displayStatus, // Display status for report (actual status value)
        reject_reason: rejectReason, // Reject reason for export
      };

      // Add parameter columns
      parameterNames.forEach((paramName) => {
        row[paramName] = parameterMap[paramName] || "";
      });

      // Create transactions array for detail view
      // If there are no attempts, get parameters from item_Quality
      let transactions = [];

      if (allDetails.length > 0) {
        // Group details by attempt_no
        const detailsByAttempt = new Map();
        allDetails.forEach((detail) => {
          const attemptNo = detail.attempt_no;
          if (!detailsByAttempt.has(attemptNo)) {
            detailsByAttempt.set(attemptNo, []);
          }
          detailsByAttempt.get(attemptNo).push(detail);
        });

        // Sort attempts by attempt_no (descending - latest first)
        const sortedAttemptNos = Array.from(detailsByAttempt.keys()).sort(
          (a, b) => b - a
        );

        sortedAttemptNos.forEach((attemptNo) => {
          const attemptDetails = detailsByAttempt.get(attemptNo);

          // Sort attemptDetails by id to match the order of realized values
          const sortedDetails = [...attemptDetails].sort((a, b) => a.id - b.id);

          // Get realized values for this attempt, sorted by id (which matches insertion order)
          const attemptRealized = allRealized
            .filter((r) => r.attempt_no === attemptNo)
            .sort((a, b) => a.id - b.id);

          // Match realized values with details by index/order
          sortedDetails.forEach((detail, index) => {
            const realized = realizedFor(attemptRealized, detail, index);

            transactions.push({
              parameter_name: detail.parameter_name,
              quality_standard: detail.quality_standard,
              quality_realized: realized?.quality_realized || "",
              attempt_no: attemptNo,
              attempt_date: detail.attempt_date,
              reject_reason: detail.reject_reason || null,
            });
          });
        });
      } else {
        // If no attempts, get parameters from item_Quality for this item
        const itemQualityParams = await prisma.item_Quality.findMany({
          where: { itcd: itcdValue },
          orderBy: { parameter_name: "asc" },
        });

        transactions = itemQualityParams.map((param) => ({
          parameter_name: param.parameter_name,
          quality_standard: param.quality_standard || "",
          quality_realized: "",
          attempt_no: null,
          attempt_date: null,
          reject_reason: null,
        }));
      }

      return {
        ...row,
        transactions: transactions,
      };
    })
  );

  return {
    data: enrichedData,
    parameterColumns: parameterNames.map((paramName) => ({
      field: paramName,
      headerName: paramName.toUpperCase(),
      width: 60,
    })),
    // Add STATUS column at the end
    statusColumn: {
      field: "display_status",
      headerName: "STATUS",
      width: 60,
      valueGetter: (params) => params.row.display_status || "",
    },
  };
}

function calculateQCSummary(data) {
  if (!data || data.length === 0) {
    return {
      total_qc_records: 0,
      total_batch_size: 0,
      approved_count: 0,
      rejected_count: 0,
      draft_count: 0,
      rework_count: 0,
    };
  }

  const total_qc_records = data.length;
  const total_batch_size = data.reduce(
    (sum, qc) => sum + (qc.batch_size || 0),
    0
  );

  const statusCounts = {
    DRAFT: 0,
    APPROVED: 0,
    REJECTED: 0,
    REWORK: 0,
  };

  data.forEach((qc) => {
    const status = qc.status || "DRAFT";
    if (statusCounts.hasOwnProperty(status)) {
      statusCounts[status]++;
    }
  });

  return {
    total_qc_records,
    total_batch_size,
    approved_count: statusCounts.APPROVED,
    rejected_count: statusCounts.REJECTED,
    draft_count: statusCounts.DRAFT,
    rework_count: statusCounts.REWORK,
  };
}

// Helper function to decode attempt_no (itcd * 1000 + attempt_no)
function decodeAttemptNo(encodedAttemptNo) {
  const itcd = Math.floor(encodedAttemptNo / 1000);
  const attemptNo = encodedAttemptNo % 1000;
  return { itcd, attemptNo };
}

// Helper function to get status attempt_no for an item
function getStatusAttemptNo(itcd) {
  return itcd * 1000;
}

async function getOrderQCReport(filters) {
  // One row per receipt (QualityMaster with order_no, made on QA Entry) of a
  // purchase order dated in the period. Status is the receipt's own status;
  // parameter values come from its latest tested attempt, tied by detail_id /
  // parameter_name. The row drills to the receipt's QC sheet and the order.
  const where = { order_no: { not: null }, proc_ord_no: null, orderMaster: { order_catagory: 4 } };
  if (filters.dateFrom || filters.dateTo) {
    where.orderMaster.dated = {};
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      from.setHours(0, 0, 0, 0);
      where.orderMaster.dated.gte = from;
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      where.orderMaster.dated.lte = to;
    }
  }
  if (filters.item) where.itcd = parseInt(filters.item);
  if (filters.status && filters.status !== "all") where.status = filters.status;

  const receipts = await prisma.qualityMaster.findMany({
    where,
    include: {
      item: { select: { item: true, code: true } },
      orderMaster: { select: { dated: true, acno: { select: { acname: true } } } },
      details: { orderBy: [{ attempt_no: "desc" }, { id: "asc" }] },
      detailDetails: { orderBy: { id: "desc" } },
    },
    orderBy: [{ order_no: "desc" }, { id: "desc" }],
  });
  const allParameters = await prisma.quality_parameters.findMany({ orderBy: { parameter_name: "asc" } });
  const parameterNames = allParameters.map((p) => p.parameter_name);
  const isAttempt = (n) => Number.isInteger(n) && n > 0 && n < 1000;

  const data = receipts.map((qc) => {
    const tested = qc.details.filter((d) => isAttempt(d.attempt_no) && d.parameter_name !== "store_receiving_entry");
    const latest = tested.length ? Math.max(...tested.map((d) => d.attempt_no)) : null;
    const decision = qc.details.find((d) => d.attempt_no === 0 && d.parameter_name === "qa_decision");
    const transactions = tested
      .sort((a, b) => b.attempt_no - a.attempt_no || a.parameter_name.localeCompare(b.parameter_name))
      .map((d) => {
        const realized = realizedFor(qc.detailDetails.filter((r) => r.attempt_no === d.attempt_no), d, 0);
        return {
          parameter_name: d.parameter_name,
          quality_standard: d.quality_standard,
          quality_realized: realized?.quality_realized || "",
          attempt_no: d.attempt_no,
          attempt_date: d.attempt_date,
          reject_reason: d.reject_reason || null,
        };
      });
    const row = {
      id: qc.id,
      order_date: qc.orderMaster?.dated || null,
      order_no: qc.order_no,
      tran_code: 400, // Purchase Order drill (CLAUDE.md rule 15)
      tran_id: qc.order_no,
      itcd: qc.itcd,
      item_name: qc.item?.item || "",
      vendor_name: qc.orderMaster?.acno?.acname || "",
      batch_no: qc.batch_no ? String(qc.batch_no) : "",
      batch_size: qc.batch_size || 0,
      grn_no: qc.grn_no ?? null,
      status: qc.status,
      display_status: qc.status,
      reject_reason: decision?.reject_reason || "",
    };
    for (const name of parameterNames) {
      row[name] = transactions.find((t) => t.attempt_no === latest && t.parameter_name === name)?.quality_realized || "";
    }
    return { ...row, transactions };
  });

  return {
    data,
    parameterColumns: parameterNames.map((paramName) => ({ field: paramName, headerName: paramName.toUpperCase(), width: 60 })),
  };
}

function calculateOrderQCSummary(data) {
  if (!data || data.length === 0) {
    return {
      total_qc_records: 0,
      total_batch_size: 0,
      approved_count: 0,
      rejected_count: 0,
      draft_count: 0,
      rework_count: 0,
    };
  }

  const total_qc_records = data.length;
  const total_batch_size = data.reduce(
    (sum, qc) => sum + (qc.batch_size || 0),
    0
  );

  const statusCounts = {
    DRAFT: 0,
    APPROVED: 0,
    REJECTED: 0,
    REWORK: 0,
  };

  data.forEach((qc) => {
    const status = qc.status || "DRAFT";
    if (statusCounts.hasOwnProperty(status)) {
      statusCounts[status]++;
    }
  });

  return {
    total_qc_records,
    total_batch_size,
    approved_count: statusCounts.APPROVED,
    rejected_count: statusCounts.REJECTED,
    draft_count: statusCounts.DRAFT,
    rework_count: statusCounts.REWORK,
  };
}

async function getMaterialProductionReport(filters) {
  const where = {
    tran_code: 8, // Production transaction code
    dated: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
  };

  const whereTransactions = {};

  if (filters.processOrder) {
    where.rmk5 = parseInt(filters.processOrder);
  }

  if (filters.salesOrder) {
    where.so_no = parseInt(filters.salesOrder);
  }

  if (filters.batchNo) {
    where.rmk3 = filters.batchNo.toString();
  }

  if (filters.item) {
    whereTransactions.itcd = parseInt(filters.item);
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      godownDetails: true,
      transactions: {
        where: whereTransactions,
        include: {
          itemDetails: true,
          godownDetails: true,
        },
      },
    },
    orderBy: {
      dated: "desc",
    },
  });

  // Enrich with production plan data if available
  const enrichedData = await Promise.all(
    transactions.map(async (t) => {
      let productionPlan = null;
      let productionItem = null;
      let batchNo = t.rmk3;

      // Get production plan details if process order exists
      if (t.rmk5) {
        productionPlan = await prisma.productionPlanMaster.findFirst({
          where: { id: parseInt(t.rmk5) },
          include: {
            item: true,
          },
        });

        if (productionPlan?.item) {
          productionItem = productionPlan.item;
        }

        // Get batch from quality master if available
        if (!batchNo && productionPlan) {
          const qualityRecord = await prisma.qualityMaster.findFirst({
            where: {
              proc_ord_no: productionPlan.id,
            },
            select: {
              batch_no: true,
            },
          });
          if (qualityRecord?.batch_no) {
            batchNo = qualityRecord.batch_no;
          }
        }
      }

      const totalQty = t.transactions.reduce((sum, line) => sum + (line.qty || 0), 0);
      const totalAmount = t.transactions.reduce((sum, line) => sum + (line.amount || 0), 0);

      return {
        ...t,
        productionPlan,
        production_item: productionItem,
        batch_no: batchNo,
        process_order_no: t.rmk5,
        sales_order_no: t.so_no || productionPlan?.sale_ord_no, // the plan stores the Sale Order no itself
        actual_yield_qty: totalQty,
        total_amount: totalAmount,
      };
    })
  );

  return enrichedData;
}

function calculateMaterialProductionSummary(data) {
  const totalTransactions = data.length;
  const totalYieldQty = data.reduce((sum, t) => sum + t.actual_yield_qty, 0);
  const totalAmount = data.reduce((sum, t) => sum + (t.total_amount || 0), 0);

  return {
    total_transactions: totalTransactions,
    total_yield_qty: totalYieldQty,
    total_amount: totalAmount,
  };
}

async function getMaterialIssuanceReport(filters) {
  const where = {
    tran_code: 7, // Issuance transaction code
    dated: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
  };

  const whereTransactions = {};

  if (filters.processOrder) {
    where.rmk5 = parseInt(filters.processOrder);
  }

  if (filters.salesOrder) {
    where.so_no = parseInt(filters.salesOrder);
  }

  if (filters.item) {
    whereTransactions.itcd = parseInt(filters.item);
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      godownDetails: true,
      transactions: {
        where: whereTransactions,
        include: {
          itemDetails: true,
          godownDetails: true,
        },
      },
    },
    orderBy: {
      dated: "desc",
    },
  });

  // Enrich with production plan data if available
  const enrichedData = await Promise.all(
    transactions.map(async (t) => {
      let productionPlan = null;
      let issuedItems = [];

      // Get all issued items
      if (t.transactions.length > 0) {
        issuedItems = t.transactions.map(tran => tran.itemDetails);
      }

      // Get production plan details if process order exists
      // rmk5 is a process order id only when numeric — a direct issue carries
      // "CLEANING" / "LAB QC" there (Direct Material Issuance Cost), which made
      // parseInt NaN and the whole report fail.
      if (/^\d+$/.test(String(t.rmk5 ?? "").trim())) {
        productionPlan = await prisma.productionPlanMaster.findFirst({
          where: { id: parseInt(t.rmk5, 10) },
        });
      }

      const totalQty = t.transactions.reduce((sum, line) => sum + (line.qty || 0), 0);
      const totalAmount = t.transactions.reduce((sum, line) => sum + (line.amount || 0), 0);

      return {
        ...t,
        productionPlan,
        issued_items: issuedItems,
        issued_item: issuedItems[0] || null, // First item for main view
        process_order_no: t.rmk5,
        sales_order_no: t.so_no || productionPlan?.sale_ord_no, // the plan stores the Sale Order no itself
        issued_qty: totalQty,
        total_amount: totalAmount,
      };
    })
  );

  return enrichedData;
}

function calculateMaterialIssuanceSummary(data) {
  const totalTransactions = data.length;
  const totalIssuedQty = data.reduce((sum, t) => sum + t.issued_qty, 0);
  const totalAmount = data.reduce((sum, t) => sum + (t.total_amount || 0), 0);

  return {
    total_transactions: totalTransactions,
    total_issued_qty: totalIssuedQty,
    total_amount: totalAmount,
  };
}

async function getMaterialTransferReport(filters) {
  try {
    const {
      dateFrom,
      dateTo,
      product,
      godown,
      transferFrom,
      transferTo,
    } = filters;

    const where = {
      tran_code: 11,
    };

    // Date filter
    if (dateFrom && dateTo) {
      where.dated = {
        gte: new Date(dateFrom),
        lte: new Date(dateTo),
      };
    }

    const whereTransactions = {};

    if (product) {
      whereTransactions.itcd = parseInt(product, 10);
    }

    if (godown) {
      where.godown = parseInt(godown, 10);
    }

    if (transferFrom) {
      where.godown = parseInt(transferFrom, 10);
    }

    if (transferTo) {
      where.godown2 = parseInt(transferTo, 10);
    }

    const transactions = await prisma.transactionsMaster.findMany({
      where,
      include: {
        godownDetails: true,  // Transfer from
        godown2Details: true, // Transfer to
        transactions: {
          where: whereTransactions,
          include: {
            itemDetails: true,
          },
        },
      },
      orderBy: {
        dated: "desc",
      },
    });

    const rows = [];
    for (const t of transactions) {
      for (const line of t.transactions) {
        rows.push({
          dated: t.dated,
          tran_id: t.tran_id,
          tran_code: t.tran_code,
          mm_code: line.itcd || "",
          productName: line.itemDetails?.item || "",
          ink_code: line.itemDetails?.code || "",
          //batch_no: line.batch_no || "",
          req_no: t.req_no,
          transfer_qty: Number(line.qty || 0),
          transfer_from: t.godownDetails?.godown || `Godown #${t.godown}`,
          transfer_to: t.godown2Details?.godown || `Godown #${t.godown2}`,
          narration1: line.narration1 || t.narration1 || "",
        });
      }
    }

    return rows;
  } catch (error) {
    console.error("Material Transfer Report Error:", error);
    throw error;
  }
}

function calculateMaterialTransferSummary(data) {
  return {
    total_transfer_qty: data.reduce(
      (sum, r) => sum + (Number(r.transfer_qty) || 0),
      0
    ),
    total_transactions: data.length,
  };
}

async function getQCParametersReport(filters) {
  // Build where clause
  const where = {
    proc_ord_no: { not: null },
    order_no: null,
  };

  if (filters.item) {
    where.itcd = parseInt(filters.item);
  }

  if (filters.status && filters.status !== "all" && filters.status !== "") {
    where.status = filters.status;
  }

  if (filters.batchNo) {
    where.batch_no = parseInt(filters.batchNo);
  }

  const qcRecords = await prisma.qualityMaster.findMany({
    where,
    include: {
      item: true,
      productionPlanMaster: {
        include: {
          item: true,
        },
      },
    },
    orderBy: [{ batch_no: "desc" }, { mfg_date: "desc" }, { proc_ord_no: "desc" }],
  });

  let filteredRecords = qcRecords;

  if (filters.dateFrom || filters.dateTo) {
    filteredRecords = qcRecords.filter((record) => {
      if (!record.mfg_date) return false;

      const recordDate = new Date(record.mfg_date);
      const fromDate = filters.dateFrom ? new Date(filters.dateFrom) : null;
      const toDate = filters.dateTo ? new Date(filters.dateTo) : null;

      if (fromDate && recordDate < fromDate) return false;

      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        if (recordDate > endDate) return false;
      }

      return true;
    });
  }

  const itcds = filteredRecords
    .map((qc) => qc.productionPlanMaster?.finished_id || qc.itcd)
    .filter(Boolean);

  let allParameters = [];

  if (itcds.length > 0) {
    allParameters = await prisma.item_Quality.findMany({
      where: {
        itcd: { in: itcds },
      },
      distinct: ["parameter_name"],
      select: {
        parameter_name: true,
      },
      orderBy: {
        parameter_name: "asc",
      },
    });
  }

  if (allParameters.length === 0) {
    allParameters = await prisma.quality_parameters.findMany({
      select: {
        parameter_name: true,
      },
      orderBy: {
        parameter_name: "asc",
      },
    });
  }

  // Preferred Order
  const preferredOrder = [
    "VISCOSITY",
    "SOLID",
    "ADHESION",
    "OPACITY",
    "ΔE",
    "FINENESS",
  ];

  // Sort Parameters
  allParameters = allParameters.sort((a, b) => {
    const nameA = a.parameter_name.toUpperCase().trim();
    const nameB = b.parameter_name.toUpperCase().trim();

    const indexA = preferredOrder.indexOf(nameA);
    const indexB = preferredOrder.indexOf(nameB);

    const posA = indexA === -1 ? 999 : indexA;
    const posB = indexB === -1 ? 999 : indexB;

    return posA - posB || nameA.localeCompare(nameB);
  });

  // Bulk-fetch every QualityDetail + QualityDetailDetail row for all matched
  // QC masters in two round trips total, instead of 3-4 sequential queries
  // PER record inside Promise.all — which exhausts the DB connection pool
  // once there are more matched records than the pool's connection limit.
  const qcIds = filteredRecords.map((qc) => qc.id);

  const [allDetailsFlat, allRealizedFlat] = qcIds.length > 0
    ? await Promise.all([
      prisma.qualityDetail.findMany({
        where: { master_id: { in: qcIds } },
        orderBy: [{ master_id: "asc" }, { attempt_no: "desc" }],
      }),
      prisma.qualityDetailDetail.findMany({
        where: { master_id: { in: qcIds } },
        include: { detail: { select: { parameter_name: true } } },
      }),
    ])
    : [[], []];

  const detailsByMaster = new Map();
  for (const d of allDetailsFlat) {
    if (!detailsByMaster.has(d.master_id)) detailsByMaster.set(d.master_id, []);
    detailsByMaster.get(d.master_id).push(d);
  }

  const realizedByMasterAttempt = new Map();
  for (const r of allRealizedFlat) {
    const key = `${r.master_id}:${r.attempt_no}`;
    if (!realizedByMasterAttempt.has(key)) realizedByMasterAttempt.set(key, []);
    realizedByMasterAttempt.get(key).push(r);
  }

  const enrichedData = filteredRecords.map((qc) => {
    const itcdValue = qc.productionPlanMaster?.finished_id || qc.itcd;
    // Sorted attempt_no desc within this master via the bulk query's orderBy.
    const allDetails = detailsByMaster.get(qc.id) || [];

    let bestAttemptNo = null;
    let bestAttemptDate = null;

    for (const detail of allDetails) {
      const realizedForAttempt =
        realizedByMasterAttempt.get(`${qc.id}:${detail.attempt_no}`) || [];
      const hasRealized = realizedForAttempt.some(
        (r) => r.quality_realized && r.quality_realized.trim() !== ""
      );

      if (hasRealized) {
        bestAttemptNo = detail.attempt_no;
        bestAttemptDate = detail.attempt_date;
        break;
      }
    }

    if (!bestAttemptNo && allDetails.length > 0) {
      bestAttemptNo = allDetails[0].attempt_no;
      bestAttemptDate = allDetails[0].attempt_date;
    }

    // Linked via detail_id -> QualityDetail.parameter_name, not array
    // position, so a realized value always lands on its actual
    // parameter regardless of how the attempt's rows were saved.
    const parameterMap = {};
    if (bestAttemptNo) {
      const realizedValues = realizedByMasterAttempt.get(`${qc.id}:${bestAttemptNo}`) || [];
      realizedValues.forEach((rv) => {
        const value = rv.quality_realized || "";
        if (rv.detail?.parameter_name && value.trim() !== "") {
          parameterMap[rv.detail.parameter_name] = value;
        }
      });
    }

    const rejectDetail = allDetails.find(
      (d) => d.reject_reason !== null && d.reject_reason !== undefined
    );

    const row = {
      id: qc.id,
      mfg_date: qc.mfg_date,
      proc_ord_no: qc.productionPlanMaster?.id || qc.proc_ord_no,
      itcd: itcdValue,
      item_name:
        qc.item?.item ||
        qc.productionPlanMaster?.item?.item ||
        "",
      batch_no: qc.batch_no || "",
      batch_size: qc.batch_size || 0,
      attempt_no: bestAttemptNo,
      attempt_date: bestAttemptDate,
      status: qc.status || "DRAFT",
      reject_reason: rejectDetail?.reject_reason || "",
    };

    allParameters.forEach((param) => {
      row[param.parameter_name] =
        parameterMap[param.parameter_name] || "";
    });

    return row;
  });

  const parameterColumns = allParameters.map((param) => ({
    field: param.parameter_name,
    headerName: param.parameter_name.toUpperCase(),
    width: 25,
  }));

  return {
    data: enrichedData,
    parameterColumns,
  };
}
async function getMonthlyStockReport(filters = {}) {
  try {
    const { year, month, item, category, godown } = filters;

    // Determine date range for the month
    const yearNum = parseInt(year) || new Date().getFullYear();
    const monthNum = parseInt(month) || new Date().getMonth() + 1;

    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0);
    endDate.setHours(23, 59, 59, 999);

    const results = await prisma.$queryRaw`
      WITH monthly_stock AS (
        -- Opening stock (balance at start of month)
        SELECT 
          i.itcd,
          i.item,
          ic.ic_name AS category,
          COALESCE(SUM(
            CASE 
              WHEN tm.tran_code IN (4, 10, 12) THEN t.qty
              WHEN tm.tran_code IN (6, 9, 5) THEN -t.qty
              ELSE 0
            END
          ), 0) AS opening_stock,
          
          -- Calculate opening value
          CASE 
            WHEN SUM(CASE WHEN tm.tran_code IN (4) THEN t.qty ELSE 0 END) > 0
            THEN COALESCE(SUM(CASE WHEN tm.tran_code IN (4) THEN t.damt ELSE 0 END), 0) /
                 NULLIF(SUM(CASE WHEN tm.tran_code IN (4) THEN t.qty ELSE 0 END), 0)
            ELSE 0
          END AS opening_rate
          
        FROM "Item" i
        LEFT JOIN "ItemCategory" ic ON i.ic_id = ic.id
        LEFT JOIN "Transactions" t ON t.itcd = i.itcd
        LEFT JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE 1=1
          ${item ? Prisma.sql`AND i.itcd = ${parseInt(item)}` : Prisma.empty}
          ${category ? Prisma.sql`AND i.ic_id = ${parseInt(category)}` : Prisma.empty}
          ${godown ? Prisma.sql`AND (tm.godown = ${parseInt(godown)} OR tm.godown IS NULL)` : Prisma.empty}
          AND (tm.dated < ${startDate} OR tm.dated IS NULL)
        GROUP BY i.itcd, i.item, ic.ic_name
      ),
      
      monthly_transactions AS (
        -- Monthly transactions
        SELECT 
          i.itcd,
          -- Purchases
          COALESCE(SUM(CASE WHEN tm.tran_code = 4 THEN t.qty ELSE 0 END), 0) AS purchase_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 4 THEN t.damt ELSE 0 END), 0) AS purchase_value,
          
          -- Sales
          COALESCE(SUM(CASE WHEN tm.tran_code = 6 THEN t.qty ELSE 0 END), 0) AS sale_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 6 THEN t.camt ELSE 0 END), 0) AS sale_value,
          
          -- Purchase Returns
          COALESCE(SUM(CASE WHEN tm.tran_code = 9 THEN t.qty ELSE 0 END), 0) AS purchase_return_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 9 THEN t.camt ELSE 0 END), 0) AS purchase_return_value,
          
          -- Sale Returns
          COALESCE(SUM(CASE WHEN tm.tran_code = 10 THEN t.qty ELSE 0 END), 0) AS sale_return_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 10 THEN t.damt ELSE 0 END), 0) AS sale_return_value,
          
          -- POS Sales
          COALESCE(SUM(CASE WHEN tm.tran_code = 5 THEN t.qty ELSE 0 END), 0) AS pos_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 5 THEN t.gross_amount ELSE 0 END), 0) AS pos_value,
          
          -- POS Returns
          COALESCE(SUM(CASE WHEN tm.tran_code = 12 THEN t.qty ELSE 0 END), 0) AS pos_return_qty,
          COALESCE(SUM(CASE WHEN tm.tran_code = 12 THEN t.damt ELSE 0 END), 0) AS pos_return_value
          
        FROM "Item" i
        LEFT JOIN "Transactions" t ON t.itcd = i.itcd
        LEFT JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE 1=1
          ${item ? Prisma.sql`AND i.itcd = ${parseInt(item)}` : Prisma.empty}
          ${godown ? Prisma.sql`AND (tm.godown = ${parseInt(godown)} OR tm.godown IS NULL)` : Prisma.empty}
          AND tm.dated >= ${startDate}
          AND tm.dated <= ${endDate}
        GROUP BY i.itcd
      )
      
      SELECT 
        ms.itcd,
        ms.item,
        ms.category,
        ms.opening_stock,
        ms.opening_rate,
        -- Calculate opening value from opening stock and rate
        (ms.opening_stock * ms.opening_rate) AS opening_value,
        
        COALESCE(mt.purchase_qty, 0) AS purchase_qty,
        COALESCE(mt.purchase_value, 0) AS purchase_value,
        COALESCE(mt.sale_qty, 0) AS sale_qty,
        COALESCE(mt.sale_value, 0) AS sale_value,
        COALESCE(mt.purchase_return_qty, 0) AS purchase_return_qty,
        COALESCE(mt.purchase_return_value, 0) AS purchase_return_value,
        COALESCE(mt.sale_return_qty, 0) AS sale_return_qty,
        COALESCE(mt.sale_return_value, 0) AS sale_return_value,
        COALESCE(mt.pos_qty, 0) AS pos_qty,
        COALESCE(mt.pos_value, 0) AS pos_value,
        COALESCE(mt.pos_return_qty, 0) AS pos_return_qty,
        COALESCE(mt.pos_return_value, 0) AS pos_return_value,
        
        -- Net movements
        (COALESCE(mt.purchase_qty, 0) - COALESCE(mt.purchase_return_qty, 0)) AS net_purchase_qty,
        (COALESCE(mt.sale_qty, 0) + COALESCE(mt.pos_qty, 0) - 
         COALESCE(mt.sale_return_qty, 0) - COALESCE(mt.pos_return_qty, 0)) AS net_sale_qty,
        
        -- Closing stock calculation
        (ms.opening_stock + 
         COALESCE(mt.purchase_qty, 0) - COALESCE(mt.purchase_return_qty, 0) +
         COALESCE(mt.sale_return_qty, 0) + COALESCE(mt.pos_return_qty, 0) -
         COALESCE(mt.sale_qty, 0) - COALESCE(mt.pos_qty, 0)) AS closing_stock,
        
        -- Weighted average rate for closing
        CASE 
          WHEN (ms.opening_stock + COALESCE(mt.purchase_qty, 0) - COALESCE(mt.purchase_return_qty, 0)) > 0
          THEN ((ms.opening_stock * ms.opening_rate) + COALESCE(mt.purchase_value, 0) - COALESCE(mt.purchase_return_value, 0)) /
               NULLIF((ms.opening_stock + COALESCE(mt.purchase_qty, 0) - COALESCE(mt.purchase_return_qty, 0)), 0)
          ELSE ms.opening_rate
        END AS closing_rate,
        
        -- Closing value
        ((ms.opening_stock + 
          COALESCE(mt.purchase_qty, 0) - COALESCE(mt.purchase_return_qty, 0) +
          COALESCE(mt.sale_return_qty, 0) + COALESCE(mt.pos_return_qty, 0) -
          COALESCE(mt.sale_qty, 0) - COALESCE(mt.pos_qty, 0)) *
         CASE 
           WHEN (ms.opening_stock + COALESCE(mt.purchase_qty, 0) - COALESCE(mt.purchase_return_qty, 0)) > 0
           THEN ((ms.opening_stock * ms.opening_rate) + COALESCE(mt.purchase_value, 0) - COALESCE(mt.purchase_return_value, 0)) /
                NULLIF((ms.opening_stock + COALESCE(mt.purchase_qty, 0) - COALESCE(mt.purchase_return_qty, 0)), 0)
           ELSE ms.opening_rate
         END) AS closing_value
        
      FROM monthly_stock ms
      LEFT JOIN monthly_transactions mt ON ms.itcd = mt.itcd
      WHERE ms.opening_stock != 0 OR 
            COALESCE(mt.purchase_qty, 0) != 0 OR 
            COALESCE(mt.sale_qty, 0) != 0
      ORDER BY ms.item ASC
    `;

    return results;
  } catch (error) {
    console.error("Error generating monthly stock report:", error);
    throw error; // Re-throw to see the actual error
  }
}

function calculateMonthlyStockSummary(data) {
  const summary = {
    total_items: data.length,
    opening_stock_value: data.reduce((sum, item) => sum + (item.opening_value || 0), 0),
    purchase_value: data.reduce((sum, item) => sum + (item.purchase_value || 0), 0),
    sale_value: data.reduce((sum, item) => sum + (item.sale_value || 0), 0),
    closing_stock_value: data.reduce((sum, item) => sum + (item.closing_value || 0), 0),
    net_purchase_qty: data.reduce((sum, item) => sum + (item.net_purchase_qty || 0), 0),
    net_sale_qty: data.reduce((sum, item) => sum + (item.net_sale_qty || 0), 0),
  };

  return summary;
}

async function getBatchCostingReport(filters = {}) {
  try {
    const { batchNo, processOrder, dateFrom, dateTo, item } = filters;

    const results = await prisma.$queryRaw`
      WITH batch_costing AS (
        SELECT 
          -- Production Plan Info
          ppm.id AS process_order_no,
          ppm.batch_no,
          ppm.dated AS production_date,
          ppm.finished_id,
          fi.item AS finished_item,
          ppm.qty AS planned_qty,
          ppm.actual_yield AS actual_yield,
          
          -- Material Issuance (tran_code 7)
          (SELECT COALESCE(SUM(t2.qty), 0)
           FROM "Transactions" t2
           JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
           WHERE tm2.tran_code = 7 
             AND CAST(tm2.rmk5 AS TEXT) = CAST(ppm.id AS TEXT)
             ${item ? Prisma.sql`AND t2.itcd = ${parseInt(item)}` : Prisma.empty}) AS material_issued_qty,
          
          -- Material Cost from Issuance
          (SELECT COALESCE(SUM(
            CASE 
              WHEN t2.damt > 0 THEN t2.damt 
              WHEN t2.camt > 0 THEN t2.camt 
              ELSE 0 
            END), 0)
           FROM "Transactions" t2
           JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
           WHERE tm2.tran_code = 7 
             AND CAST(tm2.rmk5 AS TEXT) = CAST(ppm.id AS TEXT)
             ${item ? Prisma.sql`AND t2.itcd = ${parseInt(item)}` : Prisma.empty}) AS material_cost,
           
          -- Finished Goods Produced (tran_code 8)
          (SELECT COALESCE(SUM(t3.qty), 0)
           FROM "Transactions" t3
           JOIN "TRANSACTIONS_MASTER" tm3 ON t3.tran_id = tm3.tran_id
           WHERE tm3.tran_code = 8 
             AND CAST(tm3.rmk5 AS TEXT) = CAST(ppm.id AS TEXT)) AS finished_produced_qty,
             
          -- Finished Goods Value
          (SELECT COALESCE(SUM(
            CASE 
              WHEN t3.damt > 0 THEN t3.damt 
              WHEN t3.camt > 0 THEN t3.camt 
              ELSE 0 
            END), 0)
           FROM "Transactions" t3
           JOIN "TRANSACTIONS_MASTER" tm3 ON t3.tran_id = tm3.tran_id
           WHERE tm3.tran_code = 8 
             AND CAST(tm3.rmk5 AS TEXT) = CAST(ppm.id AS TEXT)) AS finished_value,
             
          -- BOM Reference
          bm.id AS bom_id,
          bm.instructions,
          
          -- Production Efficiency
          CASE 
            WHEN ppm.qty > 0 THEN (ppm.actual_yield * 100.0 / ppm.qty)
            ELSE 0 
          END AS yield_percentage
          
        FROM "productionPlanMaster" ppm
        JOIN "Item" fi ON ppm.finished_id = fi.itcd
        LEFT JOIN "BomMaster" bm ON ppm.bom_id = bm.id
        
        WHERE 1=1
          ${batchNo ? Prisma.sql`AND ppm.batch_no = ${batchNo}` : Prisma.empty}
          ${processOrder ? Prisma.sql`AND ppm.id = ${parseInt(processOrder)}` : Prisma.empty}
          ${dateFrom ? Prisma.sql`AND ppm.dated >= ${new Date(dateFrom)}` : Prisma.empty}
          ${dateTo ? Prisma.sql`AND ppm.dated <= ${new Date(dateTo)}` : Prisma.empty}
          ${item ? Prisma.sql`AND (ppm.finished_id = ${parseInt(item)} OR EXISTS (
              SELECT 1 FROM "Transactions" t 
              JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
              WHERE tm.tran_code = 7 
                AND CAST(tm.rmk5 AS TEXT) = CAST(ppm.id AS TEXT)
                AND t.itcd = ${parseInt(item)}
            ))` : Prisma.empty}
      )
      
      SELECT 
        *,
        -- Unit Cost Calculations
        CASE 
          WHEN actual_yield > 0 THEN material_cost / NULLIF(actual_yield, 0)
          ELSE 0 
        END AS material_cost_per_unit,
        
        CASE 
          WHEN actual_yield > 0 THEN finished_value / NULLIF(actual_yield, 0)
          ELSE 0 
        END AS production_cost_per_unit,
        
        -- Variance Analysis
        (actual_yield - planned_qty) AS yield_variance,
        CASE 
          WHEN planned_qty > 0 THEN ((actual_yield - planned_qty) * 100.0 / planned_qty)
          ELSE 0 
        END AS yield_variance_percentage
        
      FROM batch_costing
      ORDER BY production_date DESC
    `;

    return results;
  } catch (error) {
    console.error("Error generating batch costing report:", error);
    console.error("Full error details:", error);
    return [];
  }
}

function calculateBatchCostingSummary(data) {
  const summary = {
    total_batches: data.length,
    total_planned_qty: data.reduce((sum, batch) => sum + (batch.planned_qty || 0), 0),
    total_actual_yield: data.reduce((sum, batch) => sum + (batch.actual_yield || 0), 0),
    total_material_cost: data.reduce((sum, batch) => sum + (batch.material_cost || 0), 0),
    total_finished_value: data.reduce((sum, batch) => sum + (batch.finished_value || 0), 0),
    average_yield_percentage: data.length > 0 ?
      data.reduce((sum, batch) => sum + (batch.yield_percentage || 0), 0) / data.length : 0,
  };

  return summary;
}

async function getMonthlyStockValuationReport(filters = {}) {
  try {
    const { year, month, valuationMethod = 'FIFO' } = filters;

    // Default to current month if not specified
    const yearNum = parseInt(year) || new Date().getFullYear();
    const monthNum = parseInt(month) || new Date().getMonth() + 1;
    const monthName = new Date(yearNum, monthNum - 1, 1).toLocaleString('default', { month: 'long' });

    const results = await prisma.$queryRaw`
      WITH monthly_stock_val AS (
        SELECT 
          i.itcd,
          i.item,
          ic.ic_name AS category,
          
          -- Opening Stock (at beginning of month)
          (SELECT COALESCE(SUM(
            CASE 
              WHEN tm2.tran_code IN (4, 10, 12) THEN t2.qty
              WHEN tm2.tran_code IN (6, 9, 5) THEN -t2.qty
              ELSE 0
            END), 0)
           FROM "Transactions" t2
           JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
           WHERE t2.itcd = i.itcd
             AND tm2.dated < DATE_TRUNC('month', ${new Date(yearNum, monthNum - 1, 1)})::date
          ) AS opening_qty,
          
          -- Opening Value (Weighted Average)
          (SELECT COALESCE(SUM(
            CASE 
              WHEN tm2.tran_code IN (4) THEN COALESCE(t2.damt,0)
              WHEN tm2.tran_code IN (9) THEN -COALESCE(t2.camt,0)
              ELSE 0
            END), 0)
           FROM "Transactions" t2
           JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
           WHERE t2.itcd = i.itcd
             AND tm2.dated < DATE_TRUNC('month', ${new Date(yearNum, monthNum - 1, 1)})::date
          ) AS opening_value,
          
          -- Monthly Purchases
          (SELECT COALESCE(SUM(t2.qty), 0)
           FROM "Transactions" t2
           JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
           WHERE t2.itcd = i.itcd
             AND tm2.tran_code = 4
             AND tm2.dated >= DATE_TRUNC('month', ${new Date(yearNum, monthNum - 1, 1)})::date
             AND tm2.dated < DATE_TRUNC('month', ${new Date(yearNum, monthNum, 1)})::date
          ) AS purchase_qty,
          
          -- Purchase Value
          (SELECT COALESCE(SUM(t2.damt), 0)
           FROM "Transactions" t2
           JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
           WHERE t2.itcd = i.itcd
             AND tm2.tran_code = 4
             AND tm2.dated >= DATE_TRUNC('month', ${new Date(yearNum, monthNum - 1, 1)})::date
             AND tm2.dated < DATE_TRUNC('month', ${new Date(yearNum, monthNum, 1)})::date
          ) AS purchase_value,
          
          -- Monthly Sales
          (SELECT COALESCE(SUM(t2.qty), 0)
           FROM "Transactions" t2
           JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
           WHERE t2.itcd = i.itcd
             AND tm2.tran_code IN (6, 5)
             AND tm2.dated >= DATE_TRUNC('month', ${new Date(yearNum, monthNum - 1, 1)})::date
             AND tm2.dated < DATE_TRUNC('month', ${new Date(yearNum, monthNum, 1)})::date
          ) AS sale_qty,
          
          -- Sale Value
          (SELECT COALESCE(SUM(
            CASE 
              WHEN tm2.tran_code = 6 THEN COALESCE(t2.camt,0)
              WHEN tm2.tran_code = 5 THEN COALESCE(t2.gross_amount,0)
              ELSE 0
            END), 0)
           FROM "Transactions" t2
           JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
           WHERE t2.itcd = i.itcd
             AND tm2.tran_code IN (6, 5)
             AND tm2.dated >= DATE_TRUNC('month', ${new Date(yearNum, monthNum - 1, 1)})::date
             AND tm2.dated < DATE_TRUNC('month', ${new Date(yearNum, monthNum, 1)})::date
          ) AS sale_value
          
        FROM "Item" i
        JOIN "ItemCategory" ic ON i.ic_id = ic.id
        WHERE EXISTS (
          SELECT 1 FROM "Transactions" t
          JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
          WHERE t.itcd = i.itcd
            AND tm.dated < DATE_TRUNC('month', ${new Date(yearNum, monthNum, 1)})::date
        )
      )
      
      SELECT 
        *,
        -- Closing Qty
        (opening_qty + purchase_qty - sale_qty) AS closing_qty,
        
        -- Weighted Average Rate
        CASE 
          WHEN (opening_qty + purchase_qty) > 0
          THEN (opening_value + purchase_value) / NULLIF((opening_qty + purchase_qty), 0)
          ELSE 0
        END AS weighted_avg_rate,
        
        -- Closing Value (Weighted Average Method)
        ((opening_qty + purchase_qty - sale_qty) * 
         CASE 
           WHEN (opening_qty + purchase_qty) > 0
           THEN (opening_value + purchase_value) / NULLIF((opening_qty + purchase_qty), 0)
           ELSE 0
         END) AS closing_value_weighted_avg,
         
        -- Cost of Goods Sold (Weighted Average)
        (sale_qty * 
         CASE 
           WHEN (opening_qty + purchase_qty) > 0
           THEN (opening_value + purchase_value) / NULLIF((opening_qty + purchase_qty), 0)
           ELSE 0
         END) AS cogs_weighted_avg,
         
        -- Gross Profit (Weighted Average)
        (sale_value - 
         (sale_qty * 
          CASE 
            WHEN (opening_qty + purchase_qty) > 0
            THEN (opening_value + purchase_value) / NULLIF((opening_qty + purchase_qty), 0)
            ELSE 0
          END)) AS gross_profit_weighted_avg,
          
        -- Gross Profit Percentage
        CASE 
          WHEN sale_value > 0
          THEN ((sale_value - 
                (sale_qty * 
                 CASE 
                   WHEN (opening_qty + purchase_qty) > 0
                   THEN (opening_value + purchase_value) / NULLIF((opening_qty + purchase_qty), 0)
                   ELSE 0
                 END)) * 100.0 / sale_value)
          ELSE 0
        END AS gross_profit_percentage
        
      FROM monthly_stock_val
      WHERE (opening_qty + purchase_qty - sale_qty) != 0
        OR purchase_qty != 0
        OR sale_qty != 0
      ORDER BY category, item
    `;

    // Add month info to each row
    return results.map(row => ({
      ...row,
      month: monthName,
      year: yearNum
    }));

  } catch (error) {
    console.error("Error generating monthly stock valuation report:", error);
    return [];
  }
}

function calculateMonthlyStockValuationSummary(data) {
  const summary = {
    month: data.length > 0 ? data[0].month : '',
    year: data.length > 0 ? data[0].year : new Date().getFullYear(),
    total_items: data.length,
    total_opening_value: data.reduce((sum, item) => sum + (item.opening_value || 0), 0),
    total_purchase_value: data.reduce((sum, item) => sum + (item.purchase_value || 0), 0),
    total_sale_value: data.reduce((sum, item) => sum + (item.sale_value || 0), 0),
    total_closing_value: data.reduce((sum, item) => sum + (item.closing_value_weighted_avg || 0), 0),
    total_cogs: data.reduce((sum, item) => sum + (item.cogs_weighted_avg || 0), 0),
    total_gross_profit: data.reduce((sum, item) => sum + (item.gross_profit_weighted_avg || 0), 0),
    overall_gross_profit_percentage: data.reduce((sum, item) => sum + (item.sale_value || 0), 0) > 0 ?
      (data.reduce((sum, item) => sum + (item.gross_profit_weighted_avg || 0), 0) * 100.0 /
        data.reduce((sum, item) => sum + (item.sale_value || 0), 0)) : 0
  };

  return summary;
}

// async function getStockActivityWithRateReport(filters = {}) {
//   try {
//     const { dateFrom, dateTo, product, category, godown, viewMode, showZeroStock } = filters;

//     // Month/year for opening stock lookup (derived from dateFrom)
//     const reportDate = dateFrom ? new Date(dateFrom) : new Date();
//     const month = reportDate.getMonth() + 1;
//     const year = reportDate.getFullYear();

//     // ── 1. Opening stock map ──────────────────────────────────────────────────
//     // Fetched once here; never re-queried inside SQL (avoids N+1 subqueries).
//     const openingStocks = await prisma.monthlyOpeningStock.findMany({
//       where: {
//         month,
//         year,
//         godown: godown ? parseInt(godown) : null,
//         ...(product && { itcd: parseInt(product) }),
//       },
//       include: { item: true, godownDetails: true },
//     });

//     const openingStockMap = new Map();
//     openingStocks.forEach(s => {
//       openingStockMap.set(s.itcd, {
//         opening_qty: Number(s.opening_qty || 0),
//         opening_rate: Number(s.opening_rate || 0),
//         opening_value: Number(s.opening_value || 0),
//         product_name: s.item?.item || '',
//         category: s.item?.ic_name || '',
//         category_id: s.item?.ic_id || 0,
//       });
//     });

//     // ── 2. Production cost per unit (raw, from ProductionCostEntry) ───────────
//     // pce.itcd is always populated (denormalized from T8 transaction at costing time),
//     // so no PPM join is needed. Covers both plan-linked and orphan PCEs.
//     // Date-filter by PCE's own month/year (costing period).
//     const ymFrom = dateFrom
//       ? (() => { const d = new Date(dateFrom); return d.getFullYear() * 100 + (d.getMonth() + 1); })()
//       : null;
//     const ymTo = dateTo
//       ? (() => { const d = new Date(dateTo); return d.getFullYear() * 100 + (d.getMonth() + 1); })()
//       : null;

//     const productionCostRaw = await prisma.$queryRaw`
//       SELECT
//         pce.itcd                                                                   AS finished_id,
//         CASE
//           WHEN SUM(pce.qty_costed) > 0
//           THEN SUM(COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0) * pce.qty_costed)
//                / SUM(pce.qty_costed)
//           ELSE 0
//         END AS production_cost_per_unit
//       FROM "ProductionCostEntry" pce
//       WHERE pce.qty_costed > 0
//         AND COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0) > 0
//         AND pce.itcd IS NOT NULL
//         ${product ? Prisma.sql`AND pce.itcd = ${parseInt(product)}` : Prisma.empty}
//         ${ymFrom  ? Prisma.sql`AND (pce.year * 100 + pce.month) >= ${ymFrom}` : Prisma.empty}
//         ${ymTo    ? Prisma.sql`AND (pce.year * 100 + pce.month) <= ${ymTo}`   : Prisma.empty}
//       GROUP BY pce.itcd
//     `;
//     const productionCostMap = new Map(
//       productionCostRaw.map(r => [Number(r.finished_id), Number(r.production_cost_per_unit) || 0])
//     );

//     // ── 3. Period stock movements ─────────────────────────────────────────────
//     // Returns only items that have at least one transaction matching the filters.
//     // Items with opening stock but no period transactions are merged in step 4.
//     // Issuance (7) and production (8) amounts are NOT taken from transaction damt/camt
//     // because those fields are unreliable — they are re-valued in JS (step 5).
//     const movements = await prisma.$queryRaw`
//       SELECT
//         i.itcd                             AS product_code,
//         i.item                             AS product_name,
//         COALESCE(ic.ic_name, '')           AS category,
//         COALESCE(ic.id,      0)            AS category_id,

//         -- Purchases (4) — sub_tran_id = 1 line items only
//         COALESCE(SUM(CASE WHEN tm.tran_code = 4  AND t.sub_tran_id = 1 THEN t.qty              ELSE 0 END), 0) AS purchase_qty,
//         COALESCE(SUM(CASE WHEN tm.tran_code = 4  AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0) ELSE 0 END), 0) AS purchase_amount,

//         -- Purchase Returns (9)
//         COALESCE(SUM(CASE WHEN tm.tran_code = 9  AND t.sub_tran_id = 1 THEN t.qty              ELSE 0 END), 0) AS purchase_ret_qty,
//         COALESCE(SUM(CASE WHEN tm.tran_code = 9  AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0) ELSE 0 END), 0) AS purchase_ret_amount,

//         -- Sales (6)
//         COALESCE(SUM(CASE WHEN tm.tran_code = 6  THEN t.qty                      ELSE 0 END), 0) AS sale_qty,
//         COALESCE(SUM(CASE WHEN tm.tran_code = 6  THEN COALESCE(t.camt,0)         ELSE 0 END), 0) AS sale_amount,

//         -- Sale Returns (10)
//         COALESCE(SUM(CASE WHEN tm.tran_code = 10 THEN t.qty                      ELSE 0 END), 0) AS sale_ret_qty,
//         COALESCE(SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)         ELSE 0 END), 0) AS sale_ret_amount,

//         -- POS (5)
//         COALESCE(SUM(CASE WHEN tm.tran_code = 5  THEN t.qty                      ELSE 0 END), 0) AS pos_qty,
//         COALESCE(SUM(CASE WHEN tm.tran_code = 5  THEN COALESCE(t.gross_amount,0) ELSE 0 END), 0) AS pos_amount,

//         -- POS Returns (12)
//         COALESCE(SUM(CASE WHEN tm.tran_code = 12 THEN t.qty                      ELSE 0 END), 0) AS pos_ret_qty,
//         COALESCE(SUM(CASE WHEN tm.tran_code = 12 THEN COALESCE(t.damt,0)         ELSE 0 END), 0) AS pos_ret_amount,

//         -- Material Issuance (7) — qty only; amount re-valued in JS at blended avg rate
//         COALESCE(SUM(CASE WHEN tm.tran_code = 7  THEN t.qty ELSE 0 END), 0) AS material_issuance_qty,

//         -- Production Receipt (8) — qty only; amount re-valued in JS via PCE → opening_rate → wtd_avg
//         -- damt is intentionally excluded: T8 receipts often have no meaningful damt value
//         COALESCE(SUM(CASE WHEN tm.tran_code = 8  THEN t.qty ELSE 0 END), 0) AS material_production_qty,

//         -- Transfers (11) — direction relative to the filtered godown
//         COALESCE(SUM(CASE WHEN tm.tran_code = 11
//           AND ${godown ? Prisma.sql`${parseInt(godown)}` : Prisma.sql`NULL`} = tm.godown2
//           THEN t.qty ELSE 0 END), 0) AS transfer_in_qty,
//         COALESCE(SUM(CASE WHEN tm.tran_code = 11
//           AND ${godown ? Prisma.sql`${parseInt(godown)}` : Prisma.sql`NULL`} = tm.godown
//           THEN t.qty ELSE 0 END), 0) AS transfer_out_qty

//       FROM "Item" i
//       LEFT JOIN "ItemCategory" ic ON i.ic_id = ic.id
//       LEFT JOIN "Transactions" t ON i.itcd = t.itcd
//       LEFT JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id

//       WHERE i.itcd IS NOT NULL
//         ${product ? Prisma.sql`AND i.itcd  = ${parseInt(product)}` : Prisma.empty}
//         ${category ? Prisma.sql`AND i.ic_id = ${parseInt(category)}` : Prisma.empty}
//         ${godown ? Prisma.sql`AND (tm.godown = ${parseInt(godown)} OR tm.godown2 = ${parseInt(godown)})` : Prisma.empty}
//         ${dateFrom ? Prisma.sql`AND tm.dated >= ${new Date(dateFrom)}` : Prisma.empty}
//         ${dateTo ? Prisma.sql`AND tm.dated <= ${new Date(dateTo)}` : Prisma.empty}
//         AND t.qty IS NOT NULL
//         AND tm.tran_code IS NOT NULL
//         AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)

//       GROUP BY i.itcd, i.item, ic.ic_name, ic.id
//       ORDER BY i.item ASC
//     `;

//     // ── 4. Add opening-stock-only items (no period transactions) ─────────────
//     // The SQL above acts as an INNER JOIN for items with no period activity.
//     // Items with opening stock but zero movements must still appear in the report.
//     const movementCodes = new Set(movements.map(r => Number(r.product_code)));
//     const allRows = [...movements];

//     for (const [itcd, os] of openingStockMap) {
//       if (!movementCodes.has(itcd)) {
//         allRows.push({
//           product_code: itcd,
//           product_name: os.product_name,
//           category: os.category,
//           category_id: os.category_id,
//           purchase_qty: 0, purchase_amount: 0,
//           purchase_ret_qty: 0, purchase_ret_amount: 0,
//           sale_qty: 0, sale_amount: 0,
//           sale_ret_qty: 0, sale_ret_amount: 0,
//           pos_qty: 0, pos_amount: 0,
//           pos_ret_qty: 0, pos_ret_amount: 0,
//           material_issuance_qty: 0,
//           material_production_qty: 0,
//           transfer_in_qty: 0,
//           transfer_out_qty: 0,
//         });
//       }
//     }

//     // ── 2.5. Batch-fetch period purchase avg for produced items without PCE ──────
//     // For items that have T8 receipts but no ProductionCostEntry, we fall back to
//     // (opening_rate) then (period purchase weighted avg).  t8.damt is intentionally
//     // NOT used — production receipt transactions often have zero or nominal damt.
//     const producedItcds = [
//       ...new Set(
//         allRows
//           .filter(r => Number(r.material_production_qty || 0) > 0
//             && !productionCostMap.has(Number(r.product_code)))
//           .map(r => Number(r.product_code))
//           .filter(Boolean)
//       ),
//     ];

//     const purchaseAvgMap = new Map(); // itcd → period weighted-avg purchase rate
//     if (producedItcds.length > 0) {
//       const pAvgRows = await prisma.$queryRaw`
//         SELECT
//           t.itcd,
//           COALESCE(SUM(t.damt), 0) AS total_amt,
//           COALESCE(SUM(t.qty),  0) AS total_qty
//         FROM "Transactions" t
//         JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
//         WHERE t.itcd = ANY(${producedItcds})
//           AND tm.tran_code = 4
//           AND t.sub_tran_id = 1
//           AND t.qty > 0
//           ${dateFrom ? Prisma.sql`AND tm.dated >= ${new Date(dateFrom)}` : Prisma.empty}
//           ${dateTo ? Prisma.sql`AND tm.dated <= ${new Date(dateTo)}` : Prisma.empty}
//         GROUP BY t.itcd
//       `;
//       for (const r of pAvgRows) {
//         const qty = Number(r.total_qty || 0);
//         const amt = Number(r.total_amt || 0);
//         if (qty > 0 && amt > 0) purchaseAvgMap.set(Number(r.itcd), amt / qty);
//       }
//     }

//     // ── 2.6. CC Rate per unit (overhead for finished goods, ic_id = 1) ─────────
//     const ccDateFrom = dateFrom ? new Date(dateFrom) : new Date(year, month - 1, 1);
//     const ccDateTo   = dateTo   ? new Date(dateTo)   : new Date(year, month, 0, 23, 59, 59);
//     ccDateFrom.setHours(0, 0, 0, 0);
//     ccDateTo.setHours(23, 59, 59, 999);
//     const cc_rate_per_unit = await _calcCcRate(ccDateFrom, ccDateTo);

//     // ── 5. Enrich: derive all rates and computed values ───────────────────────
//     const enrichedResults = allRows.map(item => {
//       const os = openingStockMap.get(Number(item.product_code)) ?? { opening_qty: 0, opening_rate: 0, opening_value: 0 };
//       const opening_stock = Number(os.opening_qty || 0);
//       const opening_rate = Number(os.opening_rate || 0);
//       const opening_value = opening_stock * opening_rate;

//       // Quantities
//       const net_purchase_qty = Number(item.purchase_qty || 0) - Number(item.purchase_ret_qty || 0);
//       const production_qty = Number(item.material_production_qty || 0);
//       const issuance_qty = Number(item.material_issuance_qty || 0);
//       const net_production_qty = production_qty - issuance_qty;
//       const net_sale_qty = Number(item.sale_qty || 0) + Number(item.pos_qty || 0)
//         - Number(item.sale_ret_qty || 0) - Number(item.pos_ret_qty || 0);
//       const net_transfer_qty = Number(item.transfer_in_qty || 0) - Number(item.transfer_out_qty || 0);

//       // Closing stock balance
//       const stock_balance =
//         opening_stock
//         + net_purchase_qty
//         + production_qty
//         + Number(item.sale_ret_qty || 0) + Number(item.pos_ret_qty || 0)
//         + Number(item.transfer_in_qty || 0)
//         - Number(item.sale_qty || 0) - Number(item.pos_qty || 0)
//         - issuance_qty
//         - Number(item.transfer_out_qty || 0);

//       // Actual per-unit rates from transaction amounts (raw invoice/sale rates)
//       const purchase_rate = Number(item.purchase_qty || 0) > 0 ? Number(item.purchase_amount || 0) / Number(item.purchase_qty) : 0;
//       const purchase_ret_rate = Number(item.purchase_ret_qty || 0) > 0 ? Number(item.purchase_ret_amount || 0) / Number(item.purchase_ret_qty) : 0;
//       const sale_rate = Number(item.sale_qty || 0) > 0 ? Number(item.sale_amount || 0) / Number(item.sale_qty) : 0;
//       const sale_ret_rate = Number(item.sale_ret_qty || 0) > 0 ? Number(item.sale_ret_amount || 0) / Number(item.sale_ret_qty) : 0;
//       const pos_rate = Number(item.pos_qty || 0) > 0 ? Number(item.pos_amount || 0) / Number(item.pos_qty) : 0;
//       const pos_ret_rate = Number(item.pos_ret_qty || 0) > 0 ? Number(item.pos_ret_amount || 0) / Number(item.pos_ret_qty) : 0;

//       // Blended average cost rate: (Opening + Net Purchase + Production) / Total qty
//       // Production rate priority: PCE → opening_rate → period purchase avg → 0
//       // t8.damt is intentionally NOT used: T8 damt is unreliable for costing.
//       const net_purchase_value = Number(item.purchase_amount || 0) - Number(item.purchase_ret_amount || 0);
//       const raw_production_rate = productionCostMap.get(Number(item.product_code)) || 0;
//       const purch_avg_rate = purchaseAvgMap.get(Number(item.product_code)) || 0;
//       const effective_production_rate = raw_production_rate || 0;

//       // CC overhead: applied to finished goods (ic_id = 1) only
//       const is_fg   = Number(item.category_id) === 1;
//       const cc_rate = is_fg ? cc_rate_per_unit : 0;

//       // Blended rate = (open_value + pur_amt − pur_ret_amt + production_qty × (PCE_rate + CC))
//       //              / (open_qty   + pur_qty  − pur_ret_qty + production_qty)
//       const production_value     = production_qty * (effective_production_rate + cc_rate);
//       const total_qty_for_rate   = opening_stock
//                                  + Number(item.purchase_qty     || 0)
//                                  - Number(item.purchase_ret_qty || 0)
//                                  + production_qty;
//       const total_value_for_rate = opening_value
//                                  + Number(item.purchase_amount     || 0)
//                                  - Number(item.purchase_ret_amount || 0)
//                                  + production_value;
//       const avg_rate_after_purchase = total_qty_for_rate > 0 ? total_value_for_rate / total_qty_for_rate : 0;
//       const total_cost_rate = avg_rate_after_purchase; // CC already baked into production_value

//       // Re-valued amounts at authoritative cost rates (+ CC overhead for FG items)
//       const material_production_rate   = effective_production_rate + cc_rate;
//       const material_production_amount = production_qty * material_production_rate;
//       // Source label for UI display
//       const production_cost_source = raw_production_rate > 0 ? 'pce'
//         : opening_rate > 0 ? 'opening_rate'
//           : purch_avg_rate > 0 ? 'weighted_avg'
//             : 'no_cost';
//       const material_issuance_rate   = avg_rate_after_purchase || opening_rate; // blended cost rate (no CC on issues)
//       const material_issuance_amount = issuance_qty * material_issuance_rate;
//       // Sale/POS: blended cost + CC overhead for FG items
//       const sale_cost_rate   = total_cost_rate;
//       const sale_cost_amount = Number(item.sale_qty || 0) * sale_cost_rate;
//       const pos_cost_rate    = total_cost_rate;
//       const pos_cost_amount  = Number(item.pos_qty  || 0) * pos_cost_rate;
//       const transfer_in_rate    = total_cost_rate;
//       const transfer_in_amount  = Number(item.transfer_in_qty  || 0) * transfer_in_rate;
//       const transfer_out_rate   = total_cost_rate;
//       const transfer_out_amount = Number(item.transfer_out_qty || 0) * transfer_out_rate;
//       const stock_value = stock_balance * total_cost_rate;

//       // Item type
//       let item_type = 'OTHER';
//       if (production_qty > 0) item_type = 'FINISHED_GOOD';
//       else if (issuance_qty > 0) item_type = 'RAW_MATERIAL';
//       else if (Number(item.purchase_qty || 0) > 0 && Number(item.sale_qty || 0) === 0) item_type = 'CONSUMABLE';

//       const total_in_qty = Number(item.purchase_qty || 0) + Number(item.sale_ret_qty || 0)
//         + Number(item.pos_ret_qty || 0) + production_qty
//         + Number(item.transfer_in_qty || 0);
//       const total_out_qty = Number(item.sale_qty || 0) + Number(item.pos_qty || 0)
//         + Number(item.purchase_ret_qty || 0) + issuance_qty
//         + Number(item.transfer_out_qty || 0);

//       return {
//         ...item,
//         opening_stock,
//         opening_rate,
//         opening_value,
//         purchase_rate,
//         purchase_ret_rate,
//         sale_rate,
//         sale_ret_rate,
//         pos_rate,
//         pos_ret_rate,
//         sale_cost_rate,
//         sale_cost_amount,
//         pos_cost_rate,
//         pos_cost_amount,
//         material_issuance_rate,
//         material_issuance_amount,
//         material_production_rate,
//         material_production_amount,
//         production_cost_source,              // 'pce' | 'opening_rate' | 'weighted_avg' | 'no_cost'
//         transfer_in_rate,
//         transfer_in_amount,
//         transfer_out_rate,
//         transfer_out_amount,
//         net_purchase_qty,
//         net_sale_qty,
//         net_production_qty,
//         net_transfer_qty,
//         cc_rate,
//         stock_balance,
//         avg_rate_after_purchase,
//         total_cost_rate,
//         stock_value,
//         closing_qty:   stock_balance,
//         closing_rate:  total_cost_rate,
//         closing_value: stock_value,
//         total_in_qty,
//         total_out_qty,
//         item_type,
//         profit_margin: Number(item.sale_amount || 0) > 0 && total_cost_rate > 0
//           ? (Number(item.sale_amount) / Math.max(Number(item.sale_qty || 1), 1)) - total_cost_rate
//           : 0,
//         stock_turnover_percentage: opening_stock > 0
//           ? (Number(item.sale_qty || 0) * 100.0 / opening_stock)
//           : 0,
//       };
//     });

//     // ── 6. Zero-stock filter ─────────────────────────────────────────────────
//     const visibleResults = showZeroStock === 'false'
//       ? enrichedResults.filter(item =>
//         item.opening_stock !== 0 ||
//         item.purchase_qty !== 0 ||
//         item.sale_qty !== 0 ||
//         item.material_issuance_qty !== 0 ||
//         item.material_production_qty !== 0 ||
//         item.transfer_in_qty !== 0 ||
//         item.transfer_out_qty !== 0
//       )
//       : enrichedResults;

//     // ── 7. View-mode filter ───────────────────────────────────────────────────
//     const viewFilters = {
//       finished: item => item.item_type === 'FINISHED_GOOD',
//       raw: item => item.item_type === 'RAW_MATERIAL',
//       consumable: item => item.item_type === 'CONSUMABLE',
//     };
//     return viewMode && viewFilters[viewMode]
//       ? visibleResults.filter(viewFilters[viewMode])
//       : visibleResults;

//   } catch (error) {
//     console.error("Error generating stock activity report:", error);
//     console.error("Error details:", error.message);
//     return [];
//   }
// }
// function calculateStockActivityWithRateSummary(data) {
//   const summary = {
//     // Basic counts
//     total_items: data.length,
//     finished_goods: data.filter(item => item.item_type === 'FINISHED_GOOD').length,
//     raw_materials: data.filter(item => item.item_type === 'RAW_MATERIAL').length,
//     consumables: data.filter(item => item.item_type === 'CONSUMABLE').length,

//     // Opening stock
//     opening_stock_total: data.reduce((sum, item) => sum + (item.opening_stock || 0), 0),
//     opening_value_total: data.reduce((sum, item) => sum + (item.opening_value || 0), 0),

//     // Purchase summary
//     total_purchase_qty: data.reduce((sum, item) => sum + (item.purchase_qty || 0), 0),
//     total_purchase_amount: data.reduce((sum, item) => sum + (item.purchase_amount || 0), 0),

//     // Sale summary
//     total_sale_qty: data.reduce((sum, item) => sum + (item.sale_qty || 0), 0),
//     total_sale_amount: data.reduce((sum, item) => sum + (item.sale_amount || 0), 0),

//     // Production summary
//     total_production_qty: data.reduce((sum, item) => sum + (item.material_production_qty || 0), 0),
//     total_production_value: data.reduce((sum, item) => sum + (item.material_production_amount || 0), 0),
//     total_raw_material_used: data.reduce((sum, item) => sum + (item.material_issuance_qty || 0), 0),
//     total_raw_material_cost: data.reduce((sum, item) => sum + (item.material_issuance_amount || 0), 0),

//     // Value summaries (for financial totals panel)
//     total_purchase_value: data.reduce((sum, item) =>
//       sum + (Number(item.purchase_amount || 0) - Number(item.purchase_ret_amount || 0)), 0),
//     total_issue_value: data.reduce((sum, item) => sum + (item.material_issuance_amount || 0), 0),
//     total_sales_cost_value: data.reduce((sum, item) =>
//       sum + (item.sale_cost_amount || 0) + (item.pos_cost_amount || 0), 0),

//     // Transfer summary
//     total_transfer_in: data.reduce((sum, item) => sum + (item.transfer_in_qty || 0), 0),
//     total_transfer_out: data.reduce((sum, item) => sum + (item.transfer_out_qty || 0), 0),

//     // Closing stock
//     closing_stock_total: data.reduce((sum, item) => sum + (item.stock_balance || 0), 0),
//     closing_value_total: data.reduce((sum, item) => sum + (item.stock_value || 0), 0),

//     // Performance metrics
//     total_stock_turnover: data.reduce((sum, item) => {
//       const avg_stock = (item.opening_stock + item.stock_balance) / 2;
//       const sales = item.sale_qty + item.pos_qty;
//       return avg_stock > 0 ? sum + (sales / avg_stock) : sum;
//     }, 0),

//     // Production efficiency
//     average_production_yield: data.length > 0 ?
//       data.filter(item => item.production_plans && item.production_plans.length > 0)
//         .reduce((sum, item) => {
//           const plans = JSON.parse(item.production_plans || '[]');
//           const totalYield = plans.reduce((s, plan) => s + (plan.actual_yield || 0), 0);
//           const totalPlanned = plans.reduce((s, plan) => s + (plan.planned_qty || 0), 0);
//           return totalPlanned > 0 ? sum + (totalYield * 100 / totalPlanned) : sum;
//         }, 0) : 0,

//     // Profitability
//     gross_profit: data.reduce((sum, item) => {
//       const sales = item.sale_amount + item.pos_amount;
//       const cogs = (item.sale_qty + item.pos_qty) * (item.avg_rate_after_purchase || 0);
//       return sum + (sales - cogs);
//     }, 0),

//     // Stock days on hand
//     average_stock_days: data.length > 0 ?
//       (data.reduce((sum, item) => sum + (item.stock_balance || 0), 0) * 30) /
//       (data.reduce((sum, item) => sum + (item.sale_qty + item.pos_qty || 0), 0) || 1) : 0
//   };

//   return summary;
// }

// =============================================================================
//  STOCK ACTIVITY WITH RATE REPORT  +  COGS  +  COGM
//
//  KEY CHANGE FROM PREVIOUS VERSION:
//  ─────────────────────────────────
//  Previously, a single global CC (Conversion Cost) rate was calculated once
//  via _calcCcRate() by dividing total overhead (Account Settings "conversion_overheads") by total FG qty.
//  That single rate was then applied to EVERY finished good uniformly.
//
//  NOW: Each ProductionCostEntry row already stores its own cc_rate and cc_cost
//  fields.  Because the same itcd can appear 10+ times in ProductionCostEntry
//  (one row per production order / costing run), we:
//    1. Fetch ALL PCE rows for the period.
//    2. SUM(cc_cost) and SUM(qty_costed) per itcd.
//    3. Derive a weighted-average cc_rate = total_cc_cost / total_qty per item.
//  This gives each finished good its own accurate CC rate instead of a shared one.
//
//  _calcCcRate() has been DELETED — it is no longer called anywhere.
// =============================================================================


// ─────────────────────────────────────────────────────────────────────────────
//  MAIN FUNCTION: Stock Activity With Rate Report
// ─────────────────────────────────────────────────────────────────────────────
export async function getStockActivityWithRateReport(filters = {}) {
  try {
    const { dateFrom, dateTo, product, category, godown, viewMode } = filters;
    const inProcessRate = filters.inProcessRate === true;
    // Purchases, purchase returns and sale returns at their Net Amount (gross +
    // sales tax, the Purchase report's "Net Amount") — the report screen only.
    // Month-end opening (lib/openingStockGenerate.js) and COGS call without it.
    const withTax = filters.withTax === true;

    // Month/year derived from dateFrom — used for opening stock lookup
    const reportDate = dateFrom ? new Date(dateFrom) : new Date();
    const month = reportDate.getMonth() + 1;
    const year = reportDate.getFullYear();


    // ── 1. Opening stock map ──────────────────────────────────────────────────
    // Fetched once here as a Map; never re-queried inside SQL (avoids N+1).
    // godown filter → that godown's qty; none → qty summed over all godowns.
    // Rate is item-level either way (lib/openingStock.js).
    const openingStocks = await getOpening(month, year, {
      godown,
      ...(product && { itcds: [parseInt(product)] }),
      ...(category && { itemWhere: { ic_id: parseInt(category) } }),
      include: { item: true },
    });

    // Map: itcd (number) → opening stock details
    const openingStockMap = new Map();
    openingStocks.forEach(s => {
      openingStockMap.set(s.itcd, {
        opening_qty: Number(s.opening_qty || 0),
        opening_rate: Number(s.opening_rate || 0),
        opening_cc_rate: Number(s.cc_rate || 0),
        opening_rm_rate: Number(s.rm_rate || 0),
        opening_value: Number(s.opening_value || 0),
        product_name: s.item?.item || '',
        ink_code: s.item?.code || '',
        category: s.item?.itemCategories?.ic_name || '',
        category_id: s.item?.ic_id || 0,
      });
    });


    // ── 2. Production cost per unit (RM rate) from ProductionCostEntry ────────
    // pce.itcd is denormalized from the T8 transaction at costing time so no
    // PPM join is needed.  Covers both plan-linked and orphan PCEs.
    // Date-filter by PCE's own month/year (the costing period).
    //
    // NOTE: The same itcd can appear many times (one row per production order).
    //       We use a weighted average: SUM(cost_per_unit * qty) / SUM(qty).
    const ymFrom = dateFrom
      ? (() => { const d = new Date(dateFrom); return d.getFullYear() * 100 + (d.getMonth() + 1); })()
      : null;
    const ymTo = dateTo
      ? (() => { const d = new Date(dateTo); return d.getFullYear() * 100 + (d.getMonth() + 1); })()
      : null;

    const productionCostRaw = await prisma.$queryRaw`
      SELECT
        pce.itcd                                                                   AS finished_id,
        -- Weighted average RM cost per unit across all production orders for this item
        CASE
          WHEN SUM(pce.qty_costed) > 0
          THEN SUM(COALESCE(pce.cost_per_unit, 0) * pce.qty_costed)
               / SUM(pce.qty_costed)
          ELSE 0
        END AS production_cost_per_unit
      FROM "ProductionCostEntry" pce
      WHERE 
      pce.qty_costed > 0
        AND COALESCE(pce.cost_per_unit, 0) > 0
        AND pce.itcd IS NOT NULL
        ${product ? Prisma.sql`AND pce.itcd = ${parseInt(product)}` : Prisma.empty}
        ${ymFrom ? Prisma.sql`AND (pce.year * 100 + pce.month) >= ${ymFrom}` : Prisma.empty}
        ${ymTo ? Prisma.sql`AND (pce.year * 100 + pce.month) <= ${ymTo}` : Prisma.empty}
      GROUP BY pce.itcd
    `;

    // Map: itcd → weighted avg RM cost per unit
    const productionCostMap = new Map(
      productionCostRaw.map(r => [Number(r.finished_id), Number(r.production_cost_per_unit) || 0])
    );


    // ── 3. Period stock movements ─────────────────────────────────────────────
    // Returns only items that have at least one transaction matching the filters.
    // Items with opening stock but no period transactions are merged in step 4.
    // Issuance (7) and production (8) amounts are NOT taken from damt/camt
    // because those fields are unreliable — they are re-valued in JS (step 5).
    const movements = await prisma.$queryRaw`
      SELECT
        i.itcd                             AS product_code,
        i.item                             AS product_name,
        COALESCE(i.code, '')               AS ink_code,
        COALESCE(ic.ic_name, '')           AS category,
        COALESCE(ic.id,      0)            AS category_id,

        -- Purchases (tran_code=4), sub_tran_id=1 lines only
        COALESCE(SUM(CASE WHEN tm.tran_code = 4  AND t.sub_tran_id = 1 THEN t.qty              ELSE 0 END), 0) AS purchase_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 4  AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0) ELSE 0 END), 0) AS purchase_amount,
        COALESCE(SUM(CASE WHEN tm.tran_code = 4  AND t.sub_tran_id = 1 THEN COALESCE(t.st_amount,0) ELSE 0 END), 0) AS purchase_tax_amount,

        -- Purchase Returns (9)
        COALESCE(SUM(CASE WHEN tm.tran_code = 9  AND t.sub_tran_id = 1 THEN t.qty              ELSE 0 END), 0) AS purchase_ret_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 9  AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0) ELSE 0 END), 0) AS purchase_ret_amount,
        COALESCE(SUM(CASE WHEN tm.tran_code = 9  AND t.sub_tran_id = 1 THEN COALESCE(t.st_amount,0) ELSE 0 END), 0) AS purchase_ret_tax_amount,

        -- Sales (6)
        COALESCE(SUM(CASE WHEN tm.tran_code = 6  THEN t.qty                      ELSE 0 END), 0) AS sale_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 6  THEN COALESCE(t.camt,0)         ELSE 0 END), 0) AS sale_amount,

        -- Sale Returns (10)
        COALESCE(SUM(CASE WHEN tm.tran_code = 10 THEN t.qty                      ELSE 0 END), 0) AS sale_ret_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.damt,0)         ELSE 0 END), 0) AS sale_ret_amount,
        COALESCE(SUM(CASE WHEN tm.tran_code = 10 THEN COALESCE(t.st_amount,0)    ELSE 0 END), 0) AS sale_ret_tax_amount,

        -- POS (5)
        COALESCE(SUM(CASE WHEN tm.tran_code = 5  THEN t.qty                      ELSE 0 END), 0) AS pos_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 5  THEN COALESCE(t.gross_amount,0) ELSE 0 END), 0) AS pos_amount,

        -- POS Returns (12)
        COALESCE(SUM(CASE WHEN tm.tran_code = 12 THEN t.qty                      ELSE 0 END), 0) AS pos_ret_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 12 THEN COALESCE(t.damt,0)         ELSE 0 END), 0) AS pos_ret_amount,

        -- Material Issuance (7) — qty only; amount re-valued in JS at blended avg rate
        COALESCE(SUM(CASE WHEN tm.tran_code = 7  THEN t.qty ELSE 0 END), 0) AS material_issuance_qty,

        -- Production Receipt (8) — qty only; amount re-valued in JS via PCE → opening_rate
        -- damt intentionally excluded: T8 receipts often have no meaningful damt value
        COALESCE(SUM(CASE WHEN tm.tran_code = 8  THEN t.qty ELSE 0 END), 0) AS material_production_qty,

        -- Transfers (11) — direction relative to the filtered godown
        COALESCE(SUM(CASE WHEN tm.tran_code = 11
          AND ${godown ? Prisma.sql`${parseInt(godown)}` : Prisma.sql`NULL`} = tm.godown2
          THEN t.qty ELSE 0 END), 0) AS transfer_in_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 11
          AND ${godown ? Prisma.sql`${parseInt(godown)}` : Prisma.sql`NULL`} = tm.godown
          THEN t.qty ELSE 0 END), 0) AS transfer_out_qty

      FROM "Item" i
      LEFT JOIN "ItemCategory"       ic ON i.ic_id    = ic.id
      LEFT JOIN "Transactions"        t ON i.itcd     = t.itcd
      LEFT JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id

      WHERE i.itcd IS NOT NULL
        ${product ? Prisma.sql`AND i.itcd  = ${parseInt(product)}` : Prisma.empty}
        ${category ? Prisma.sql`AND i.ic_id = ${parseInt(category)}` : Prisma.empty}
        ${godown ? Prisma.sql`AND (tm.godown = ${parseInt(godown)} OR tm.godown2 = ${parseInt(godown)})` : Prisma.empty}
        ${dateFrom ? Prisma.sql`AND tm.dated >= ${new Date(dateFrom)}` : Prisma.empty}
        ${dateTo ? Prisma.sql`AND tm.dated <= ${new Date(dateTo)}` : Prisma.empty}
        AND t.qty IS NOT NULL
        AND tm.tran_code IS NOT NULL
        AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)

      GROUP BY i.itcd, i.item, i.code, ic.ic_name, ic.id
      ORDER BY i.itcd ASC
    `;


    // Services spread onto the items (lib/service/landedCost.js): GRN services
    // are landed cost (into the purchase value → average / closing rate);
    // dispatch and sale-return services are cost of those goods sold.
    const servicesOf = await servicesByItem({ dateFrom, dateTo, item: product, category, godown });

    // ── 4. Add opening-stock-only items (no period transactions) ─────────────
    // The SQL above acts like an INNER JOIN — items with no period activity are
    // missing.  We add them from the opening stock map so they still appear.
    const movementCodes = new Set(movements.map(r => Number(r.product_code)));
    const allRows = [...movements];

    for (const [itcd, os] of openingStockMap) {
      if (!movementCodes.has(itcd)) {
        allRows.push({
          product_code: itcd,
          product_name: os.product_name,
          ink_code: os.ink_code,
          category: os.category,
          category_id: os.category_id,
          purchase_qty: 0, purchase_amount: 0,
          purchase_ret_qty: 0, purchase_ret_amount: 0,
          sale_qty: 0, sale_amount: 0,
          sale_ret_qty: 0, sale_ret_amount: 0,
          pos_qty: 0, pos_amount: 0,
          pos_ret_qty: 0, pos_ret_amount: 0,
          material_issuance_qty: 0,
          material_production_qty: 0,
          transfer_in_qty: 0,
          transfer_out_qty: 0,
        });
      }
    }


    // ── 4b. In-process items (Item.plant_id — lib/items/processLink.js) ──────
    // e.g. 172 ETHYL ACETATE – IN PROCESS shows the materials issued for
    // making 16 ETHYL ACETATE (PRODUCTION) — by process order, or the old
    // ERP's PAY_CODE — as "Linked production": qty, and cost at each
    // material's issue rate (worked out after step 5). Separate columns, never
    // in its stock or the report totals; it goes into its blended rate. The
    // report screen only (inProcessRate) — month-end opening and COGS: none.
    const linkedProduction = inProcessRate
      ? await linkedIssuesFor(prisma, { itcds: allRows.map((r) => r.product_code), dateFrom, dateTo, godown })
      : new Map();

    // ── 2.5. Batch-fetch period purchase avg for produced items without PCE ──
    // For items with T8 receipts but no ProductionCostEntry, we fall back to:
    //   opening_rate  →  period purchase weighted avg  →  0
    // t8.damt is intentionally NOT used — it is unreliable for costing.
    const producedItcds = [
      ...new Set(
        allRows
          .filter(r =>
            Number(r.material_production_qty || 0) > 0 &&
            !productionCostMap.has(Number(r.product_code))
          )
          .map(r => Number(r.product_code))
          .filter(Boolean)
      ),
    ];

    // Map: itcd → period weighted-avg purchase rate (fallback for produced items)
    const purchaseAvgMap = new Map();
    if (producedItcds.length > 0) {
      const pAvgRows = await prisma.$queryRaw`
        SELECT
          t.itcd,
          COALESCE(SUM(t.damt), 0) AS total_amt,
          COALESCE(SUM(t.qty),  0) AS total_qty
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE t.itcd = ANY(${producedItcds})
          AND tm.tran_code = 4
          AND t.sub_tran_id = 1
          -- AND t.qty > 0
          ${dateFrom ? Prisma.sql`AND tm.dated >= ${new Date(dateFrom)}` : Prisma.empty}
          ${dateTo ? Prisma.sql`AND tm.dated <= ${new Date(dateTo)}` : Prisma.empty}
        GROUP BY t.itcd
      `;
      for (const r of pAvgRows) {
        const qty = Number(r.total_qty || 0);
        const amt = Number(r.total_amt || 0);
        // if (qty > 0 && amt > 0) 
        purchaseAvgMap.set(Number(r.itcd), amt / qty);
      }
    }


    // ── 2.6. Per-item CC rate from ProductionCostEntry ────────────────────────
    //
    // CHANGED: Previously we called _calcCcRate() which computed ONE global CC
    // rate = total overhead / total FG qty, then applied it to all FG items.
    //
    // NOW: Each PCE row has its own cc_rate and cc_cost fields.
    // Because the same itcd appears many times in PCE (one row per production
    // order / costing run), we must AGGREGATE per itcd:
    //
    //   weighted_avg_cc_rate(itcd) = SUM(cc_cost) / SUM(qty_costed)
    //
    // This correctly reflects each item's actual conversion cost overhead
    // instead of an average blended across all products.
    // ─────────────────────────────────────────────────────────────────────────

    // Fetch PCE rows for THIS month only (same month/year used for opening stock).
    // Using the full ymFrom/ymTo range was accumulating CC costs from multiple
    // months, inflating the blended cc_rate.  We need only the current period.
    const pceForCc = await prisma.productionCostEntry.findMany({
      where: {
        month,   // same `month` derived from dateFrom at the top of the function
        year,    // same `year`  derived from dateFrom at the top of the function
        ...(product ? { itcd: parseInt(product) } : {}),
      },
      // Only fetch the columns we need — keeps the payload small
      select: {
        itcd: true,   // finished good item code
        qty_costed: true,   // qty produced in this costing run
        cc_rate: true,   // CC rate per unit stored on this PCE row
        cc_cost: true,   // total CC cost for this costing run
      },
    });

    // Aggregate: SUM cc_cost and SUM qty_costed per itcd
    // Because same itcd can appear 10+ times, we collect totals first,
    // then derive the weighted avg rate in one pass afterwards.
    const ccAggByItcd = new Map(); // itcd → { total_cc_cost: number, total_qty: number }

    for (const row of pceForCc) {
      if (!row.itcd) continue; // skip orphan PCEs with no itcd

      const id = Number(row.itcd);
      const qty = Number(row.qty_costed || 0);
      const cc = Number(row.cc_cost || 0);

      if (!ccAggByItcd.has(id)) {
        ccAggByItcd.set(id, { total_cc_cost: 0, total_qty: 0 });
      }
      const agg = ccAggByItcd.get(id);
      agg.total_cc_cost += cc;
      agg.total_qty += qty;

    }

    // Derive weighted avg cc_rate per unit for each itcd
    // Map: itcd → weighted_avg_cc_rate_per_unit
    const itemCcRateMap = new Map();
    for (const [id, agg] of ccAggByItcd) {
      // Guard against division by zero: if no qty was costed, cc rate = 0
      itemCcRateMap.set(id, agg.total_qty > 0 ? agg.total_cc_cost / agg.total_qty : 0);
    }
    // itemCcRateMap is now ready — replaces the old single cc_rate_per_unit scalar


    // ── 4b. Returns of earlier months' dispatches (Settings → Features
    // "saleReturn.costAtOriginalMonth", lib/costing/saleReturnCost.js): their
    // stock comes back at the cost the original month charged and enters this
    // month's average at that cost. A source month that is not locked yet is
    // computed from its own report; _priorDepth stops that chain.
    const priorDepth = Number(filters._priorDepth || 0);
    const priorReturns = priorDepth < 2 && (await feature("saleReturn.costAtOriginalMonth"))
      ? await getPriorMonthReturns(
        {
          dateFrom: dateFrom ? new Date(dateFrom) : null,
          dateTo: dateTo ? new Date(dateTo) : null,
          monthStart: new Date(year, month - 1, 1, 0, 0, 0, 0),
          product, category, godown,
        },
        (f) => getStockActivityWithRateReport({ ...f, _priorDepth: priorDepth + 1 }),
      )
      : new Map();
    // ── 4c. Net Amount (with sales tax) on the screen ─────────────────────────
    // Without withTax the amounts stay gross (before tax) — unchanged for the
    // month-end opening and COGS. Every rate below follows these amounts.
    if (withTax) {
      for (const r of allRows) {
        r.purchase_amount = Number(r.purchase_amount || 0) + Number(r.purchase_tax_amount || 0);
        r.purchase_ret_amount = Number(r.purchase_ret_amount || 0) + Number(r.purchase_ret_tax_amount || 0);
        r.sale_ret_amount = Number(r.sale_ret_amount || 0) + Number(r.sale_ret_tax_amount || 0);
      }
    } else {
      // Gross: the tax columns stay empty (hidden on the screen).
      for (const r of allRows) {
        delete r.purchase_tax_amount;
        delete r.purchase_ret_tax_amount;
        delete r.sale_ret_tax_amount;
      }
    }

    // ── 5. Enrich: derive all rates and computed values ───────────────────────
    // Categories that carry CC this month: finished goods, plus semi-finished
    // while "costing.semiFinishedCC" applies (lib/costing/ccPolicy.js).
    // "costing.method" = blendedCC → CC carried in by semi-finished / finished
    // inputs is tracked through every stage (lib/costing/ccRates.js).
    const ccCategoryIds = await ccCategoryIdsFor(month, year);
    const ccComponents = (await isBlendedCosting()) ? await getCcComponents({ month, year }) : null;
    const enrichRow = (item) => {
      const os = openingStockMap.get(Number(item.product_code))
        ?? { opening_qty: 0, opening_rate: 0, opening_value: 0 };

      const opening_stock = Number(os.opening_qty || 0);
      const opening_rate = Number(os.opening_rate || 0);
      const opening_cc_rate = Number(os.opening_cc_rate || 0);
      const opening_rm_rate = Number(os.opening_rm_rate || 0);
      const opening_value = opening_stock * opening_rate;

      // Earlier months' returns at their original cost (0 while the feature is off)
      const pr = priorReturns.get(Number(item.product_code));
      const prior_ret_qty = pr ? pr.qty : 0;
      const prior_ret_sale_amount = pr ? pr.sale_amount : 0;
      const prior_ret_cost_value = pr ? pr.cost_value : 0;
      const prior_ret_cc_value = pr ? pr.cc_value : 0;
      const prior_ret_rm_value = pr ? pr.rm_value : 0;

      // ── Quantities ──────────────────────────────────────────────────────────
      const net_purchase_qty = Number(item.purchase_qty || 0) - Number(item.purchase_ret_qty || 0);
      const production_qty = Number(item.material_production_qty || 0);
      const issuance_qty = Number(item.material_issuance_qty || 0);
      const net_production_qty = production_qty - issuance_qty;
      const net_sale_qty = Number(item.sale_qty || 0) + Number(item.pos_qty || 0)
        - Number(item.sale_ret_qty || 0) - Number(item.pos_ret_qty || 0);
      const net_transfer_qty = Number(item.transfer_in_qty || 0) - Number(item.transfer_out_qty || 0);

      // ── Closing stock balance ───────────────────────────────────────────────
      const stock_balance =
        opening_stock
        + net_purchase_qty
        + production_qty
        + Number(item.sale_ret_qty || 0) + Number(item.pos_ret_qty || 0)
        + Number(item.transfer_in_qty || 0)
        - Number(item.sale_qty || 0) - Number(item.pos_qty || 0)
        - issuance_qty
        - Number(item.transfer_out_qty || 0);

      // ── Actual per-unit rates from raw transaction amounts ──────────────────
      const purchase_rate = Number(item.purchase_qty || 0) > 0 ? Number(item.purchase_amount || 0) / Number(item.purchase_qty) : 0;
      const purchase_ret_rate = Number(item.purchase_ret_qty || 0) > 0 ? Number(item.purchase_ret_amount || 0) / Number(item.purchase_ret_qty) : 0;
      const sale_rate = Number(item.sale_qty || 0) > 0 ? Number(item.sale_amount || 0) / Number(item.sale_qty) : 0;
      const sale_ret_rate = Number(item.sale_ret_qty || 0) > 0 ? Number(item.sale_ret_amount || 0) / Number(item.sale_ret_qty) : 0;
      const pos_rate = Number(item.pos_qty || 0) > 0 ? Number(item.pos_amount || 0) / Number(item.pos_qty) : 0;
      const pos_ret_rate = Number(item.pos_ret_qty || 0) > 0 ? Number(item.pos_ret_amount || 0) / Number(item.pos_ret_qty) : 0;

      // ── CC rate: PER-ITEM from PCE (CHANGED from global cc_rate_per_unit) ──
      // carries_cc: finished goods (Production setup), plus semi-finished while
      // "costing.semiFinishedCC" applies, carry a CC overhead.
      // cc_rate is looked up from itemCcRateMap using this item's product_code.
      // If the item has no PCE rows (not produced), cc_rate = 0.
      const carries_cc = ccCategoryIds.includes(Number(item.category_id));
      let cc_rate = 0;
      let cc_own_cost = 0;
      let cc_input_cost = 0;
      if (carries_cc && ccComponents) {
        // Blended: own CC of this month's costing + CC carried in by inputs
        const ccc = ccComponents.has(item.product_code) ? ccComponents.get(item.product_code) : null;
        cc_own_cost = ccc ? ccc.own_cost : 0;
        cc_input_cost = ccc ? ccc.input_cost : 0;
        const blended_qty = opening_stock + (ccc ? ccc.qty : 0) + prior_ret_qty;
        const blended_cost = opening_stock * opening_cc_rate + cc_own_cost + cc_input_cost + prior_ret_cc_value;
        cc_rate = blended_qty > 0 ? blended_cost / blended_qty : 0;
      } else if (carries_cc) {
        const pceAgg = ccAggByItcd.get(Number(item.product_code));

        const prod_cc_cost = pceAgg ? pceAgg.total_cc_cost : 0;
        const prod_qty = production_qty || 0;

        const opening_cc_cost = opening_stock * opening_cc_rate;

        // Returned units carry the CC of the month they were sold in.
        const blended_qty = prod_qty + opening_stock + prior_ret_qty;
        const blended_cost = prod_cc_cost + opening_cc_cost + prior_ret_cc_value;


        cc_rate = blended_qty > 0 ? blended_cost / blended_qty : 0;
      }
      // ── (END CHANGE) ─────────────────────────────────────────────────────────

      // ── Services (landed cost on purchases, cost of sales on dispatches) ────
      const svc = servicesOf.get(Number(item.product_code)) || { purchase: 0, sale: 0 };
      const purchase_services_amount = svc.purchase;
      const sale_services_amount = svc.sale;
      const purchase_landed_amount = Number(item.purchase_amount || 0) + purchase_services_amount;
      const purchase_landed_rate = Number(item.purchase_qty || 0) > 0 ? purchase_landed_amount / Number(item.purchase_qty) : 0;

      // ── Linked production (in-process item ← its production item) ─────────
      const lp = linkedProduction.get(Number(item.product_code));
      const linked_production_qty = lp?.qty || 0;
      const linked_production_rate = lp?.rate || 0;
      const linked_production_amount = lp?.amount || 0;
      // In the rate only on the screen, and only once it has a cost (step 5b).
      const linked_in_rate = inProcessRate && linked_production_qty > 0 && linked_production_amount > 0;

      // ── RM production rate: PCE → opening_rate → purchase_avg → 0 ──────────
      const net_purchase_value = Number(item.purchase_amount || 0) - Number(item.purchase_ret_amount || 0);
      const raw_production_rate = productionCostMap.get(Number(item.product_code)) || 0;
      const purch_avg_rate = purchaseAvgMap.get(Number(item.product_code)) || 0;
      // effective_production_rate = RM cost per unit (CC is added separately)
      const effective_production_rate = raw_production_rate || 0;

      // production_value includes BOTH RM and CC overhead for this item
      const production_value = production_qty * (effective_production_rate);

      // ── Blended average cost rate ───────────────────────────────────────────
      // Formula: (opening_value + net_purchase_value + production_value)
      //        / (opening_qty   + net_purchase_qty   + production_qty)
      // CC is already baked into production_value, so no separate CC addition needed.
      const total_qty_for_rate = opening_stock
        + Number(item.purchase_qty || 0)
        - Number(item.purchase_ret_qty || 0)
        + production_qty
        + prior_ret_qty
        + (linked_in_rate ? linked_production_qty : 0);
      const total_value_for_rate = opening_value
        + Number(item.purchase_amount || 0)
        + purchase_services_amount
        - Number(item.purchase_ret_amount || 0)
        + production_value
        + prior_ret_cost_value
        + (linked_in_rate ? linked_production_amount : 0);
      const avg_rate_after_purchase = total_qty_for_rate > 0
        ? total_value_for_rate / total_qty_for_rate
        : 0;
      const total_cost_rate = avg_rate_after_purchase; // CC already baked in
      // The same rate WITHOUT the GRN services — what the books carry: the
      // services stay expenses (their Service Invoices post them there), so a
      // journal that moves stock (COGS JV) must use this one.
      const book_cost_rate = total_qty_for_rate > 0
        ? (total_value_for_rate - purchase_services_amount) / total_qty_for_rate
        : 0;

      // ── Re-valued amounts at authoritative cost rates ───────────────────────
      const material_production_rate = effective_production_rate;
      const material_production_amount = production_qty * material_production_rate;

      // Source label for UI — tells the frontend where production rate came from
      const production_cost_source = raw_production_rate > 0 ? 'pce'
        : opening_rate > 0 ? 'opening_rate'
          : purch_avg_rate > 0 ? 'weighted_avg'
            : 'no_cost';

      // Issuance is valued at blended cost rate (no CC markup on raw material issues)
      const material_issuance_rate = avg_rate_after_purchase || opening_rate;
      const material_issuance_amount = issuance_qty * material_issuance_rate;

      // Sales and POS valued at full blended cost rate (includes CC for FG items)
      const sale_cost_rate = total_cost_rate;
      // + the services of those dispatches / sale returns (freight out, weighing …)
      const sale_cost_amount = Number(item.sale_qty || 0) * sale_cost_rate + sale_services_amount;
      const pos_cost_rate = total_cost_rate;
      const pos_cost_amount = Number(item.pos_qty || 0) * pos_cost_rate;

      // Transfers valued at blended cost rate
      const transfer_in_rate = total_cost_rate;
      const transfer_in_amount = Number(item.transfer_in_qty || 0) * transfer_in_rate;
      const transfer_out_rate = total_cost_rate;
      const transfer_out_amount = Number(item.transfer_out_qty || 0) * transfer_out_rate;

      // Closing stock value
      const stock_value = stock_balance * total_cost_rate;

      // Services by SERVICE CATEGORY (lib/service/landedCost.js):
      // pur_svc_c<id> / sale_svc_c<id> columns (serviceCategoryColumns), and
      // each category's share of the cost rate, for COGS (not sent to the screen).
      const svcCatFields = {};
      for (const [c, a] of Object.entries(svc.purchaseBy || {})) svcCatFields[`pur_svc_c${c}`] = a;
      for (const [c, a] of Object.entries(svc.saleBy || {})) svcCatFields[`sale_svc_c${c}`] = a;
      const landedRateByCat = Object.fromEntries(
        Object.entries(svc.purchaseBy || {}).map(([c, a]) => [c, total_qty_for_rate > 0 ? a / total_qty_for_rate : 0]),
      );

      // ── Item type classification ────────────────────────────────────────────
      let item_type = 'OTHER';
      if (production_qty > 0) item_type = 'FINISHED_GOOD';
      else if (issuance_qty > 0) item_type = 'RAW_MATERIAL';
      else if (Number(item.purchase_qty || 0) > 0 && Number(item.sale_qty || 0) === 0) item_type = 'CONSUMABLE';

      const total_in_qty = Number(item.purchase_qty || 0) + Number(item.sale_ret_qty || 0)
        + Number(item.pos_ret_qty || 0) + production_qty
        + Number(item.transfer_in_qty || 0);
      const total_out_qty = Number(item.sale_qty || 0) + Number(item.pos_qty || 0)
        + Number(item.purchase_ret_qty || 0) + issuance_qty
        + Number(item.transfer_out_qty || 0);

      const row = {
        ...item,
        ...svcCatFields,
        opening_stock,
        opening_rate,
        opening_value,
        purchase_rate,
        purchase_services_amount,
        purchase_landed_amount,
        purchase_landed_rate,
        sale_services_amount,
        purchase_ret_rate,
        sale_rate,
        sale_ret_rate,
        pos_rate,
        pos_ret_rate,
        sale_cost_rate,
        sale_cost_amount,
        pos_cost_rate,
        pos_cost_amount,
        material_issuance_rate,
        material_issuance_amount,
        material_production_rate,
        material_production_amount,
        production_cost_source,          // 'pce' | 'opening_rate' | 'weighted_avg' | 'no_cost'
        ...(lp ? {
          linked_production_item: lp.plant_item,
          linked_production_qty,
          linked_production_rate,
          linked_production_amount,
          linked_in_rate,
        } : {}),
        transfer_in_rate,
        transfer_in_amount,
        transfer_out_rate,
        transfer_out_amount,
        net_purchase_qty,
        net_sale_qty,
        net_production_qty,
        net_transfer_qty,
        cc_rate,
        opening_cc_rate,                         // NOW: per-item from PCE (not global)
        carries_cc,                              // category carries CC this month (COGS split reads it)
        cc_own_cost,
        cc_input_cost,
        opening_rm_rate,                         // NOW: per-item from PCE (not global)
        stock_balance,
        prior_ret_qty,
        prior_ret_sale_amount,
        prior_ret_cost_value,
        prior_ret_rm_value,
        prior_ret_cc_value,
        prior_ret_sources: pr ? [...new Set(pr.sources)].join(", ") : "",
        avg_rate_after_purchase,
        total_cost_rate,
        book_cost_rate,
        stock_value,
        closing_qty: stock_balance,
        closing_rate: total_cost_rate,
        closing_value: stock_value,
        total_in_qty,
        total_out_qty,
        item_type,
        profit_margin: Number(item.sale_amount || 0) > 0 && total_cost_rate > 0
          ? (Number(item.sale_amount) / Math.max(Number(item.sale_qty || 1), 1)) - total_cost_rate
          : 0,
        stock_turnover_percentage: opening_stock > 0
          ? (Number(item.sale_qty || 0) * 100.0 / opening_stock)
          : 0,
      };
      // Read by getCostOfGoodsSoldReport; not enumerable, so never in the JSON.
      Object.defineProperty(row, "landedRateByCat", { value: landedRateByCat, enumerable: false });
      return row;
    };
    let enrichedResults = allRows.map(enrichRow);

    // ── 5b. Cost of the linked issues: each material at its issue rate ───────
    // (this report's Issue Rate for that material — from this run, or a run
    // for just that material when the filters left it out), then the
    // in-process rows are worked out again with that cost in their rate.
    if (linkedProduction.size) {
      const issueRate = new Map(enrichedResults.map((r) => [Number(r.product_code), Number(r.material_issuance_rate) || 0]));
      const materials = [...new Set([...linkedProduction.values()].flatMap((l) => [...l.byMaterial.keys()]))];
      for (const m of materials.filter((m) => !issueRate.has(m))) {
        const [one] = await getStockActivityWithRateReport({ dateFrom, dateTo, godown, product: String(m), withTax });
        issueRate.set(m, Number(one?.material_issuance_rate) || 0);
      }
      for (const l of linkedProduction.values()) {
        l.amount = [...l.byMaterial].reduce((s, [m, q]) => s + q * (issueRate.get(m) || 0), 0);
        l.rate = l.qty ? l.amount / l.qty : 0;
      }
      enrichedResults = allRows.map((item, i) =>
        linkedProduction.has(Number(item.product_code)) ? enrichRow(item) : enrichedResults[i],
      );
    }


    const visibleResults = enrichedResults.sort((a, b) =>
      (Number(a.product_code) || 0) - (Number(b.product_code) || 0)
    );


    // ── 7. View-mode filter ───────────────────────────────────────────────────
    const viewFilters = {
      finished: item => item.item_type === 'FINISHED_GOOD',
      raw: item => item.item_type === 'RAW_MATERIAL',
      consumable: item => item.item_type === 'CONSUMABLE',
    };
    return viewMode && viewFilters[viewMode]
      ? visibleResults.filter(viewFilters[viewMode])
      : visibleResults;

  } catch (error) {
    console.error("Error generating stock activity report:", error);
    console.error("Error details:", error.message);
    return [];
  }
}


// ─────────────────────────────────────────────────────────────────────────────
//  SUMMARY: Stock Activity With Rate
// ─────────────────────────────────────────────────────────────────────────────
function calculateStockActivityWithRateSummary(data) {
  const summary = {
    total_items: data.length,
    finished_goods: data.filter(item => item.item_type === 'FINISHED_GOOD').length,
    raw_materials: data.filter(item => item.item_type === 'RAW_MATERIAL').length,
    consumables: data.filter(item => item.item_type === 'CONSUMABLE').length,

    opening_stock_total: data.reduce((sum, item) => sum + (item.opening_stock || 0), 0),
    opening_value_total: data.reduce((sum, item) => sum + (item.opening_value || 0), 0),

    total_purchase_qty: data.reduce((sum, item) => sum + (item.purchase_qty || 0), 0),
    total_purchase_amount: data.reduce((sum, item) => sum + (item.purchase_amount || 0), 0),

    total_sale_qty: data.reduce((sum, item) => sum + (item.sale_qty || 0), 0),
    total_sale_amount: data.reduce((sum, item) => sum + (item.sale_amount || 0), 0),

    total_production_qty: data.reduce((sum, item) => sum + (item.material_production_qty || 0), 0),
    total_production_value: data.reduce((sum, item) => sum + (item.material_production_amount || 0), 0),
    total_raw_material_used: data.reduce((sum, item) => sum + (item.material_issuance_qty || 0), 0),
    total_raw_material_cost: data.reduce((sum, item) => sum + (item.material_issuance_amount || 0), 0),

    total_purchase_value: data.reduce((sum, item) =>
      sum + (Number(item.purchase_amount || 0) - Number(item.purchase_ret_amount || 0)), 0),
    total_issue_value: data.reduce((sum, item) => sum + (item.material_issuance_amount || 0), 0),
    total_sales_cost_value: data.reduce((sum, item) =>
      sum + (item.sale_cost_amount || 0) + (item.pos_cost_amount || 0), 0),

    total_transfer_in: data.reduce((sum, item) => sum + (item.transfer_in_qty || 0), 0),
    total_transfer_out: data.reduce((sum, item) => sum + (item.transfer_out_qty || 0), 0),

    closing_stock_total: data.reduce((sum, item) => sum + (item.stock_balance || 0), 0),
    closing_value_total: data.reduce((sum, item) => sum + (item.stock_value || 0), 0),

    total_stock_turnover: data.reduce((sum, item) => {
      const avg_stock = (item.opening_stock + item.stock_balance) / 2;
      const sales = item.sale_qty + item.pos_qty;
      return avg_stock > 0 ? sum + (sales / avg_stock) : sum;
    }, 0),

    average_production_yield: data.length > 0
      ? data
        .filter(item => item.production_plans && item.production_plans.length > 0)
        .reduce((sum, item) => {
          const plans = JSON.parse(item.production_plans || '[]');
          const totalYield = plans.reduce((s, plan) => s + (plan.actual_yield || 0), 0);
          const totalPlanned = plans.reduce((s, plan) => s + (plan.planned_qty || 0), 0);
          return totalPlanned > 0 ? sum + (totalYield * 100 / totalPlanned) : sum;
        }, 0)
      : 0,

    gross_profit: data.reduce((sum, item) => {
      const sales = item.sale_amount + item.pos_amount;
      const cogs = (item.sale_qty + item.pos_qty) * (item.avg_rate_after_purchase || 0);
      return sum + (sales - cogs);
    }, 0),

    average_stock_days: data.length > 0
      ? (data.reduce((sum, item) => sum + (item.stock_balance || 0), 0) * 30)
      / (data.reduce((sum, item) => sum + (item.sale_qty + item.pos_qty || 0), 0) || 1)
      : 0,
  };

  return summary;
}


// ─────────────────────────────────────────────────────────────────────────────
//  COST OF GOODS SOLD REPORT
// ─────────────────────────────────────────────────────────────────────────────
// Columns: Product, Qty, Sale Rate, Sale Amt, RM Rate, RM Cost,
//          CC Rate (FG only), CC Cost (FG only), Total Cost Rate,
//          Total Cost, Margin Rate, Margin
//
// NOTE: CC rate here also comes from PCE (via getStockActivityWithRateReport
//       which now uses itemCcRateMap).  No change needed in this function
//       because it delegates all costing to getStockActivityWithRateReport.
// ─────────────────────────────────────────────────────────────────────────────
export async function getCostOfGoodsSoldReport(filters = {}) {
  try {
    const { dateFrom, dateTo } = filters;
    const dFrom = dateFrom ? new Date(dateFrom) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const dTo = dateTo ? new Date(dateTo) : new Date();
    dFrom.setHours(0, 0, 0, 0);
    dTo.setHours(23, 59, 59, 999);

    // getStockActivityWithRateReport already uses per-item CC from PCE
    const rawData = await getStockActivityWithRateReport(filters);
    const prodSetup = await getProductionSetup();

    // Settings → Features "saleReturn.costAtOriginalMonth": this period's sales
    // net only with returns of THIS period's dispatches; returns of earlier
    // months are reversed separately at their own month's cost (ret_*). The
    // stock activity rows carry prior_ret_* only while the feature is on.
    const costReturns = await feature("saleReturn.costAtOriginalMonth");
    const currentSold = (item) => {
      const priorQty = costReturns ? Number(item.prior_ret_qty || 0) : 0;
      const priorAmt = costReturns ? Number(item.prior_ret_sale_amount || 0) : 0;
      const qty = (Number(item.sale_qty || 0) + Number(item.pos_qty || 0))
        - (Number(item.sale_ret_qty || 0) - priorQty + Number(item.pos_ret_qty || 0));
      const amount = (Number(item.sale_amount || 0) + Number(item.pos_amount || 0))
        - (Number(item.sale_ret_amount || 0) - priorAmt + Number(item.pos_ret_amount || 0));
      return qty > 0 ? { qty, amount } : { qty: 0, amount: 0 };
    };

    return rawData
      .filter(item => {
        // Only include items that had net sales in the period (or, with
        // returns at their original cost, a return of an earlier month)
        return currentSold(item).qty > 0 || (costReturns && Number(item.prior_ret_qty || 0) > 0);
      })
      .map(item => {
        const is_fg = isFinishedCategory(prodSetup, item.category_id);
        const { qty: sold_qty, amount: sale_amt } = currentSold(item);
        const sale_rate = sold_qty > 0 ? sale_amt / sold_qty : 0;
        // Return reversal at the original month's cost (0 while the feature is off)
        const ret_qty = costReturns ? Number(item.prior_ret_qty || 0) : 0;
        const ret_sale_amount = costReturns ? Number(item.prior_ret_sale_amount || 0) : 0;
        const ret_rm_amount = costReturns ? Number(item.prior_ret_rm_value || 0) : 0;
        const ret_cc_amount = costReturns ? Number(item.prior_ret_cc_value || 0) : 0;
        const ret_cost_amount = costReturns ? Number(item.prior_ret_cost_value || 0) : 0;

        // avg_rate_after_purchase = blended cost rate (RM + CC already baked in).
        // We back out CC to show RM and CC as separate columns in the UI.
        const total_cost_rate = Number(item.avg_rate_after_purchase || 0);
        // carries_cc comes from the stock activity row (CC categories this month)
        const cc_rate = (item.carries_cc ?? is_fg) ? Number(item.cc_rate || item.opening_cc_rate || 0) : 0;
        const rm_rate = total_cost_rate - cc_rate;

        const rm_cost_amount = rm_rate * sold_qty;
        const cc_cost_amount = cc_rate * sold_qty;
        // Services of these dispatches / sale returns (freight out, weighing …) —
        // cost of the goods sold (lib/service/landedCost.js). GRN services are
        // already in the cost rate (landed cost).
        const services_cost_amount = Number(item.sale_services_amount || 0);
        const services_cost_rate = sold_qty > 0 ? services_cost_amount / sold_qty : 0;
        const total_cost_amount = total_cost_rate * sold_qty + services_cost_amount;
        // For the COGS JV: goods at the book rate (no landed services — those
        // are expenses already, and so are the dispatch services above).
        const book_cost_amount = Number(item.book_cost_rate ?? total_cost_rate) * sold_qty;

        // Margin = gross margin BEFORE conversion cost (Revenue − RM − services)
        const margin_rate = sale_rate - rm_rate - services_cost_rate;
        const margin_amount = sale_amt - rm_cost_amount - services_cost_amount;
        const gross_margin_pct = sale_amt > 0 ? (margin_amount / sale_amt * 100) : 0;

        // Gross Profit = AFTER deducting conversion cost (Revenue − RM − CC)
        const gross_profit_rate = sale_rate - total_cost_rate - services_cost_rate;
        const gross_profit_amount = sale_amt - total_cost_amount;
        const gross_profit_pct = sale_amt > 0 ? (gross_profit_amount / sale_amt * 100) : 0;

        // By service category (lib/service/landedCost.js serviceCategoryColumns):
        //   sale_svc_c<id>   services on these dispatches / returns (in services_cost_amount)
        //   landed_svc_c<id> what that category's GRN services add to the cost of
        //                    the goods sold — its share of the cost rate × qty sold
        //                    (already inside RM cost; shown, never added again)
        const svcCat = {};
        for (const [k, v] of Object.entries(item)) if (k.startsWith("sale_svc_c")) svcCat[k] = Number(v) || 0;
        for (const [c, rate] of Object.entries(item.landedRateByCat || {})) svcCat[`landed_svc_c${c}`] = rate * sold_qty;

        return {
          ...svcCat,
          product_code: item.product_code,
          ink_code: item.ink_code || '',
          product_name: item.product_name,
          category: item.category,
          item_type: item.item_type,
          is_finished_good: is_fg,
          // Sales
          qty: sold_qty,
          sale_rate,
          sale_amount: sale_amt,
          // RM Cost
          rm_rate,
          rm_cost_amount,
          // CC (Conversion) Cost — finished goods only, now per-item from PCE
          cc_rate,
          cc_cost_amount,
          // Services on the dispatches / returns
          services_cost_rate,
          services_cost_amount,
          book_cost_amount,
          // Total Cost
          total_cost_rate: total_cost_rate + services_cost_rate,
          total_cost_amount,
          // Margin (before CC)
          margin_rate,
          margin_amount,
          gross_margin_pct,
          // Gross Profit (after CC)
          gross_profit_rate,
          gross_profit_amount,
          gross_profit_pct,
          // Return reversal at the original month's cost + net (saleReturn.costAtOriginalMonth)
          ret_qty,
          ret_source_months: costReturns ? item.prior_ret_sources || "" : "",
          ret_sale_amount,
          ret_cost_rate: ret_qty > 0 ? ret_cost_amount / ret_qty : 0,
          ret_rm_amount,
          ret_cc_amount,
          ret_cost_amount,
          net_sale_amount: sale_amt - ret_sale_amount,
          net_cost_amount: total_cost_amount - ret_cost_amount,
          net_book_cost_amount: book_cost_amount - ret_cost_amount,
          net_gross_profit: (sale_amt - ret_sale_amount) - (total_cost_amount - ret_cost_amount),
          // Supporting columns
          opening_qty: item.opening_stock || 0,
          opening_rate: item.opening_rate || 0,
          opening_value: item.opening_value || 0,
          purchase_qty: Number(item.purchase_qty || 0),
          purchase_amount: Number(item.purchase_amount || 0),
          closing_qty: item.stock_balance || 0,
          closing_value: item.stock_value || 0,
        };
      });
  } catch (err) {
    console.error("COGS report error:", err);
    return [];
  }
}

function calculateCOGSSummary(data) {
  const total_revenue = data.reduce((s, r) => s + (r.sale_amount || 0), 0);
  const total_rm = data.reduce((s, r) => s + (r.rm_cost_amount || 0), 0);
  const total_cc = data.reduce((s, r) => s + (r.cc_cost_amount || 0), 0);
  const total_services = data.reduce((s, r) => s + (r.services_cost_amount || 0), 0);
  const total_cost = data.reduce((s, r) => s + (r.total_cost_amount || 0), 0);
  const total_margin = data.reduce((s, r) => s + (r.margin_amount || 0), 0);            // before CC
  const total_gross_profit = data.reduce((s, r) => s + (r.gross_profit_amount || 0), 0); // after CC
  return {
    total_items: data.length,
    total_sold_qty: data.reduce((s, r) => s + (r.qty || 0), 0),
    total_revenue,
    total_rm_cost: total_rm,
    total_cc_cost: total_cc,
    total_services_cost: total_services,
    total_cost,
    total_margin,
    avg_gross_margin: total_revenue > 0 ? (total_margin / total_revenue * 100) : 0,
    total_gross_profit,
    avg_gross_profit_pct: total_revenue > 0 ? (total_gross_profit / total_revenue * 100) : 0,
    total_closing_value: data.reduce((s, r) => s + (r.closing_value || 0), 0),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  COST OF GOODS MANUFACTURED REPORT
// ─────────────────────────────────────────────────────────────────────────────
// Summary view : one row per finished good
//   Columns: MM#, MM Description, Qty, RM Rate, RM Cost,
//            CC Rate (FG only), CC Cost (FG only), Net Rate, Net Cost
// Detail view  : product_header → po_header → materials → po_total (hierarchical)
//
// CHANGED: Removed _calcCcRate() call.
//   CC is now aggregated directly from PCE rows that are already fetched in
//   step 2 of this function.  No extra DB round-trip needed.
//
//   Because the same itcd appears 10+ times in PCE, we accumulate
//   SUM(cc_cost) and SUM(qty_costed) per finished_id into cogmCcMap,
//   then derive weighted avg cc_rate = total_cc_cost / total_qty.
// ─────────────────────────────────────────────────────────────────────────────
export async function getCostOfGoodsManufacturedReport(filters = {}) {
  try {
    const { month, year, product, category, viewMode, plan_id } = filters;
    const m = parseInt(month) || (new Date().getMonth() + 1);
    const y = parseInt(year) || new Date().getFullYear();
    const isDetail = viewMode === 'detail';
    const planIdFilter = plan_id ? parseInt(plan_id) : null;

    // ── 1. Fetch PCE entries ──────────────────────────────────────────────────
    const entries = await prisma.productionCostEntry.findMany({
      where: {
        month: m,
        year: y,
        ...(planIdFilter ? { plan_id: planIdFilter } : {}),
      },
      include: {
        plan: { include: { item: { include: { itemCategories: true } } } },
        details: { orderBy: { material_name: 'asc' } },
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });

    // ── 2. Resolve orphan items ───────────────────────────────────────────────
    const orphanItcds = [...new Set(
      entries.filter(e => !e.plan && e.itcd).map(e => e.itcd)
    )];
    const orphanItemMap = new Map();
    if (orphanItcds.length > 0) {
      const orphanItems = await prisma.item.findMany({
        where: { itcd: { in: orphanItcds } },
        include: { itemCategories: true },
      });
      orphanItems.forEach(i => orphanItemMap.set(i.itcd, i));
    }

    // ── 3. Group PCE entries by finished_id ───────────────────────────────────
    const itemMap = new Map();
    const prodSetup = await getProductionSetup();
    // CC categories this month (finished, + semi-finished while
    // "costing.semiFinishedCC" applies) and, with "costing.method" = blendedCC,
    // the CC carried in by inputs — shown as its own split (lib/costing/ccRates.js).
    const ccCategoryIds = await ccCategoryIdsFor(m, y);
    const carriesCc = (icId) => ccCategoryIds.includes(Number(icId));
    const ccComponents = (await isBlendedCosting()) ? await getCcComponents({ month: m, year: y }) : null;

    for (const entry of entries) {
      const finished_id = entry.plan?.finished_id ?? entry.itcd;
      if (!finished_id) continue;

      const id = Number(finished_id);
      const item = entry.plan?.item ?? orphanItemMap.get(id) ?? null;
      const ic_id = Number(item?.ic_id ?? 0);
      const ic_name = item?.itemCategories?.ic_name ?? '';
      const is_fg = isFinishedCategory(prodSetup, ic_id);

      if (category && ic_id !== parseInt(category)) continue;
      if (product && id !== parseInt(product)) continue;

      if (!itemMap.has(id)) {
        itemMap.set(id, {
          mm_no: id,
          mm_description: item?.item ?? `Item ${id}`,
          mm_code: item?.code ?? '',
          category: ic_name,
          ic_id,
          is_finished_good: is_fg,
          production_orders: 0,
          // accumulators
          total_qty: 0,
          total_rm_cost: 0,   // SUM(actual_issued_cost ?? total_cost)
          total_cc_cost: 0,   // SUM(cc_cost)
          total_cc_input: 0,  // CC carried in by inputs (inside total_rm_cost; blendedCC only)
          raw_entries: [],
          material_map: {},
        });
      }

      const g = itemMap.get(id);
      g.production_orders++;

      const qty = Number(entry.qty_costed || 0);
      // ── RM cost: actual if available, else theoretical ────────────────────
      // actual_cost_per_unit = pure RM only (no CC)
      // cost_per_unit        = RM + CC baked in — DO NOT use for rm_cost
      const rm_cost = qty * Number(
        entry.actual_cost_per_unit              // RM only ✅
        ?? (Number(entry.cost_per_unit || 0) - Number(entry.cc_rate || 0))  // fallback: strip CC
      );
      const cc_cost = Number(entry.cc_cost || 0);

      g.total_qty += qty;
      g.total_rm_cost += rm_cost;
      g.total_cc_cost += cc_cost;
      const cc_input = ccComponents && carriesCc(ic_id) ? ccComponents.entryInputCost(entry) : 0;
      g.total_cc_input += cc_input;
      entry.__cc_input = cc_input;
      g.raw_entries.push(entry);

      // Accumulate merged materials for summary view
      for (const detail of entry.details) {
        const mk = detail.material_id;
        const d_qty = Number(detail.actual_qty ?? detail.qty ?? 0);
        const d_cost = Number(detail.actual_cost ?? detail.total_cost ?? 0);
        const d_rate = Number(detail.actual_unit_cost ?? detail.unit_cost ?? 0);
        if (!g.material_map[mk]) {
          g.material_map[mk] = {
            material_itcd: mk,
            material_name: detail.material_name,
            material_code: detail.material_code ?? '',
            total_qty: 0, total_cost: 0, unit_cost: d_rate,
          };
        }
        g.material_map[mk].total_qty += d_qty;
        g.material_map[mk].total_cost += d_cost;
        if (g.material_map[mk].total_qty > 0) {
          g.material_map[mk].unit_cost =
            g.material_map[mk].total_cost / g.material_map[mk].total_qty;
        }
      }
    }

    // ── 4. Sort ───────────────────────────────────────────────────────────────
    const sortedItems = [...itemMap.values()].sort((a, b) =>
      a.ic_id !== b.ic_id ? a.ic_id - b.ic_id : a.mm_no - b.mm_no
    );

    // ── 5. Build output ───────────────────────────────────────────────────────
    const result = [];

    for (const g of sortedItems) {
      const id = g.mm_no;

      const qty = g.total_qty;
      const rm_cost = g.total_rm_cost;
      const cc_cost = carriesCc(g.ic_id) ? g.total_cc_cost : 0;
      const rm_rate = qty > 0 ? rm_cost / qty : 0;
      const cc_rate = qty > 0 ? cc_cost / qty : 0;
      const net_rate = rm_rate + cc_rate;
      const net_cost = rm_cost + cc_cost;
      // RM pure / CC total split (CC carried in by inputs moved out of RM)
      const cc_input_cost = g.total_cc_input;
      const split = {
        rm_pure_cost: rm_cost - cc_input_cost,
        rm_pure_rate: qty > 0 ? (rm_cost - cc_input_cost) / qty : 0,
        cc_input_cost,
        cc_input_rate: qty > 0 ? cc_input_cost / qty : 0,
        cc_total_cost: cc_cost + cc_input_cost,
        cc_total_rate: qty > 0 ? (cc_cost + cc_input_cost) / qty : 0,
      };

      if (isDetail) {
        result.push({
          row_type: 'product_header',
          mm_no: id,
          mm_description: g.mm_description,
          mm_code: g.mm_code,
          category: g.category,
          ic_id: g.ic_id,
          is_finished_good: g.is_finished_good,
          qty,
          rm_rate,
          rm_cost,
          cc_rate,
          cc_cost,
          ...split,
          net_rate,
          net_cost,
          production_orders: g.production_orders,
        });

        for (const entry of g.raw_entries) {
          const po_id = entry.plan_id ?? entry.id;
          const po_qty = Number(entry.qty_costed || 0);

          // Per-PO RM cost (actual if available, else strip CC from cost_per_unit)
          const po_rm_rate = Number(
            entry.actual_cost_per_unit
            ?? (Number(entry.cost_per_unit || 0) - Number(entry.cc_rate || 0))
          );
          const po_rm_cost = po_qty * po_rm_rate;
          const po_cc_cost = Number(entry.cc_cost || 0);

          result.push({ row_type: 'po_header', plan_id: po_id, mm_no: id });

          for (const detail of entry.details) {
            result.push({
              row_type: 'material',
              plan_id: po_id,
              mm_no: id,
              material_itcd: detail.material_id,
              material_name: detail.material_name,
              material_code: detail.material_code ?? '',
              qty: Number(detail.actual_qty ?? detail.qty ?? 0),
              rm_rate: Number(detail.actual_unit_cost ?? detail.unit_cost ?? 0),
              rm_cost: Number(detail.actual_cost ?? detail.total_cost ?? 0),
            });
          }

          result.push({
            row_type: 'po_total',
            plan_id: po_id,
            mm_no: id,
            qty: po_qty,
            rm_cost: po_rm_cost,
            cc_cost: po_cc_cost,
            rm_pure_cost: po_rm_cost - Number(entry.__cc_input || 0),
            cc_input_cost: Number(entry.__cc_input || 0),
            cc_total_cost: po_cc_cost + Number(entry.__cc_input || 0),
            net_cost: po_rm_cost + po_cc_cost,
          });
        }

      } else {
        result.push({
          mm_no: id,
          mm_description: g.mm_description,
          mm_code: g.mm_code,
          category: g.category,
          ic_id: g.ic_id,
          is_finished_good: g.is_finished_good,
          production_orders: g.production_orders,
          qty,
          rm_rate,
          rm_cost,
          cc_rate,
          cc_cost,
          ...split,
          net_rate,
          net_cost,
          material_details: JSON.stringify(Object.values(g.material_map)),
          view_type: 'summary',
        });
      }
    }

    return result;

  } catch (err) {
    console.error("COGM report error:", err);
    return [];
  }
}

function calculateCOGMSummary(data) {
  // Works for both summary rows and detail product_header rows
  const rows = data.filter(r => r.view_type === 'summary' || r.row_type === 'product_header');
  const total_qty = rows.reduce((s, r) => s + (r.qty || 0), 0);
  const total_rm = rows.reduce((s, r) => s + (r.rm_cost || 0), 0);
  const total_cc = rows.reduce((s, r) => s + (r.cc_cost || 0), 0);
  const total_net = rows.reduce((s, r) => s + (r.net_cost || 0), 0);
  return {
    total_items: rows.length,
    total_production_orders: rows.reduce((s, r) => s + (r.production_orders || 0), 0),
    total_qty,
    total_rm_cost: total_rm,
    total_cc_cost: total_cc,
    total_net_cost: total_net,
    avg_net_rate: total_qty > 0 ? total_net / total_qty : 0,
    // cc_rate_per_unit removed from summary — each item now has its own cc_rate.
    // The UI should display per-row cc_rate instead of a single shared rate.
  };
}

// =============================================================================
//  _calcCcRate — DELETED
//
//  This function previously calculated a single global CC rate:
//    CC Total = SUM(damt) − SUM(camt) for the conversion_overheads group (excl. the conversion_cost account)
//    CC Rate  = CC Total / total FG qty produced (ic_id=1)
//
//  It is no longer needed because CC rate and CC cost are now read directly
//  from ProductionCostEntry.cc_rate / cc_cost per production order and then
//  aggregated as a weighted average per itcd.
// =============================================================================

// ─── Stock Report With Cost ──────────────────────────────────────────────────
// Shows current stock position for every item, valued at opening stock rate
// (from lib/openingStock.js) with weighted average fallback.
async function getStockWithCostReport(filters = {}) {
  try {
    const { product, category, godown, showZeroStock } = filters;

    // Opening stock is stored per month/year → filter by Month + Year.
    const now = new Date();
    const month = filters.month ? parseInt(filters.month) : now.getMonth() + 1;
    const year = filters.year ? parseInt(filters.year) : now.getFullYear();

    // godown filter → one row per item for that godown; none → one row per
    // item with qty summed over all godowns (lib/openingStock.js).
    const rows = await getOpening(month, year, {
      godown,
      ...(product && { itcds: [parseInt(product)] }),
      ...(category && { itemWhere: { ic_id: parseInt(category) } }),
      include: { item: true },
    });

    let godownName = "";
    if (godown) {
      const g = await prisma.godown.findUnique({ where: { id: parseInt(godown) }, select: { godown: true } });
      godownName = g?.godown || "";
    }

    return rows
      .filter((s) => showZeroStock === "true" || showZeroStock === true || s.opening_qty !== 0)
      .map((s) => ({
        product_code: s.itcd,
        product_name: s.item?.item || "",
        product_sku: s.item?.code || "",
        unit: s.item?.unit || "",
        category: s.item?.itemCategories?.ic_name || "",
        godown_id: godown ? parseInt(godown) : null,
        godown_name: godownName,
        month,
        year,
        opening_qty: s.opening_qty,
        rm_rate: s.rm_rate,              // Raw-material portion of rate
        cc_rate: s.cc_rate,              // CC overhead portion of rate
        opening_rate: s.opening_rate,    // Weighted-average opening rate (net)
        rm_value: s.rm_value,
        cc_cost: s.cc_cost,
        opening_value: s.opening_value,
      }));
  } catch (err) {
    console.error("stockWithCost error:", err);
    return [];
  }
}

async function getDiscardReport() {
  try {
    const items = await prisma.$queryRaw`
      SELECT
        i.itcd,
        i.item,
        i.code,
        i.alternate_id,
        i.cdate,
        NOT EXISTS (
          SELECT 1 FROM "productionPlanMaster" ppm
          WHERE ppm.finished_id = i.itcd
            AND ppm.dated BETWEEN i.cdate AND (i.cdate + INTERVAL '1 year')
        )
        AND NOT EXISTS (
          SELECT 1 FROM "productionPlanDetail" ppd
          JOIN "productionPlanMaster" ppm2 ON ppm2.id = ppd.plan_id
          WHERE ppd.material_id = i.itcd
            AND ppm2.dated BETWEEN i.cdate AND (i.cdate + INTERVAL '1 year')
        ) AS "canDiscard"
      FROM "Item" i
      WHERE i.ic_id = 2
        AND i.discard = false
        AND i.cdate <= (NOW() - INTERVAL '1 year')
      ORDER BY i.itcd DESC
    `;
    return items.map((item) => ({
      id: item.itcd,
      itcd: item.itcd,
      item_name: item.item || "",
      code: item.code || "",
      alternate_id: item.alternate_id || "",
      cdate: item.cdate,
      canDiscard: item.canDiscard,
    }));
  } catch (error) {
    console.error("itemCreation report error:", error);
    return [];
  }
}

// async function getMasterSampleReport(filters) {
//   // Build where clause
//   const where = {
//     proc_ord_no: { not: null },
//     order_no: null,
//   };

//   if (filters.item) {
//     where.itcd = parseInt(filters.item);
//   }

//   if (filters.status && filters.status !== "all" && filters.status !== "") {
//     where.status = filters.status;
//   }

//   if (filters.batchNo) {
//     where.batch_no = parseInt(filters.batchNo);
//   }

//   const qcRecords = await prisma.qualityMaster.findMany({
//     where,
//     include: {
//       item: true,
//       productionPlanMaster: {
//         include: {
//           item: true,
//         },
//       },
//     },
//     orderBy: [{ batch_no: "desc" }, { mfg_date: "desc" }, { proc_ord_no: "desc" }],
//   });

//   let filteredRecords = qcRecords;

//   if (filters.dateFrom || filters.dateTo) {
//     filteredRecords = qcRecords.filter((record) => {
//       if (!record.mfg_date) return false;

//       const recordDate = new Date(record.mfg_date);
//       const fromDate = filters.dateFrom ? new Date(filters.dateFrom) : null;
//       const toDate = filters.dateTo ? new Date(filters.dateTo) : null;

//       if (fromDate && recordDate < fromDate) return false;

//       if (toDate) {
//         const endDate = new Date(toDate);
//         endDate.setHours(23, 59, 59, 999);
//         if (recordDate > endDate) return false;
//       }

//       return true;
//     });
//   }

//   const itcds = filteredRecords
//     .map((item) => item.productionPlanMaster?.finished_id || item.itcd)
//     .filter(Boolean);

//   let allParameters = [];

//   if (itcds.length > 0) {
//     allParameters = await prisma.item_Quality.findMany({
//       where: {
//         itcd: { in: itcds },
//       },
//       distinct: ["parameter_name"],
//       select: {
//         parameter_name: true,
//       },
//       orderBy: {
//         parameter_name: "asc",
//       },
//     });
//   }

//   if (allParameters.length === 0) {
//     allParameters = await prisma.quality_parameters.findMany({
//       select: {
//         parameter_name: true,
//       },
//       orderBy: {
//         parameter_name: "asc",
//       },
//     });
//   }

//   // Preferred Order
//   const preferredOrder = [
//     "VISCOSITY",
//     "SOLID",
//     "ADHESION",
//     "OPACITY",
//     "AE",
//     "FINENESS",
//   ];

//   // Sort Parameters
//   allParameters = allParameters.sort((a, b) => {
//     const nameA = a.parameter_name.toUpperCase().trim();
//     const nameB = b.parameter_name.toUpperCase().trim();

//     const indexA = preferredOrder.indexOf(nameA);
//     const indexB = preferredOrder.indexOf(nameB);

//     const posA = indexA === -1 ? 999 : indexA;
//     const posB = indexB === -1 ? 999 : indexB;

//     return posA - posB || nameA.localeCompare(nameB);
//   });

//   const enrichedData = await Promise.all(
//     filteredRecords.map(async (item) => {
//       const itcdValue = item.productionPlanMaster?.finished_id || item.itcd;

//       const allDetails = await prisma.qualityDetail.findMany({
//         where: {
//           master_id: item.id,
//           proc_ord_no: item.proc_ord_no,
//         },
//         orderBy: {
//           attempt_no: "desc",
//         },
//       });

//       let bestAttemptNo = null;
//       let bestAttemptDate = null;

//       for (const detail of allDetails) {
//         const realized = await prisma.qualityDetailDetail.findFirst({
//           where: {
//             master_id: qc.id,
//             proc_ord_no: qc.proc_ord_no,
//             attempt_no: detail.attempt_no,
//           },
//         });

//         if (
//           realized &&
//           realized.quality_realized &&
//           realized.quality_realized.trim() !== ""
//         ) {
//           bestAttemptNo = detail.attempt_no;
//           bestAttemptDate = detail.attempt_date;
//           break;
//         }
//       }

//       if (!bestAttemptNo && allDetails.length > 0) {
//         bestAttemptNo = allDetails[0].attempt_no;
//         bestAttemptDate = allDetails[0].attempt_date;
//       }

//       const parameterMap = {};

//       if (bestAttemptNo) {
//         const details = await prisma.qualityDetail.findMany({
//           where: {
//             master_id: qc.id,
//             proc_ord_no: qc.proc_ord_no,
//             attempt_no: bestAttemptNo,
//           },
//           orderBy: { id: "asc" },
//         });

//         const realizedValues = await prisma.qualityDetailDetail.findMany({
//           where: {
//             master_id: qc.id,
//             proc_ord_no: qc.proc_ord_no,
//             attempt_no: bestAttemptNo,
//           },
//           orderBy: { id: "asc" },
//         });

//         details.forEach((detail, index) => {
//           if (realizedValues[index]) {
//             const value = realizedValues[index].quality_realized || "";

//             if (value.trim() !== "") {
//               parameterMap[detail.parameter_name] = value;
//             }
//           }
//         });
//       }

//       const rejectDetail = await prisma.qualityDetail.findFirst({
//         where: {
//           master_id: qc.id,
//           proc_ord_no: qc.proc_ord_no,
//           NOT: {
//             reject_reason: null,
//           },
//         },
//         orderBy: {
//           attempt_no: "desc",
//         },
//       });

//       const row = {
//         id: item.id,
//         mfg_date: item.mfg_date,
//         alternate_id:item.alternate_id,
//         itcd: itcdValue,
//         item_name:
//           item.item?.item ||
//           item.productionPlanMaster?.item?.item ||
//           "",
//         batch_no: item.batch_no || "",
//         batch_size: item.batch_size || 0,
//         viscosity: item.viscosity || "",
//         solid:  item.solid || "",
//         adhesion:  item.adhesion || "",
//         opacity: item.opacity || "",
//         e:  item.e || "",
//         fineness:  Item.fineness || "",
//         attempt_no: bestAttemptNo,
//         attempt_date: bestAttemptDate,
//         status: Item.status || "DRAFT",
//         reject_reason: rejectDetail?.reject_reason || "",
//       };

//       allParameters.forEach((param) => {
//         row[param.parameter_name] =
//           parameterMap[param.parameter_name] || "";
//       });

//       return row;
//     })
//   );

//   const parameterColumns = allParameters.map((param) => ({
//     field: param.parameter_name,
//     headerName: param.parameter_name.toUpperCase(),
//     width: 25,
//   }));

//   return {
//     data: enrichedData,
//     parameterColumns,
//   };
// }

async function getMasterSampleReport(filters) {
  // Build where clause
  const where = {
    proc_ord_no: { not: null },
    order_no: null,
  };

  if (filters.item) {
    where.itcd = parseInt(filters.item);
  }

  if (filters.status && filters.status !== "all" && filters.status !== "") {
    where.status = filters.status;
  }

  if (filters.batchNo) {
    where.batch_no = parseInt(filters.batchNo);
  }

  const qcRecords = await prisma.qualityMaster.findMany({
    where,
    include: {
      item: true,
      productionPlanMaster: {
        include: {
          item: true,
        },
      },
    },
    orderBy: [{ batch_no: "desc" }, { mfg_date: "desc" }, { proc_ord_no: "desc" }],
  });

  let filteredRecords = qcRecords;

  if (filters.dateFrom || filters.dateTo) {
    filteredRecords = qcRecords.filter((record) => {
      if (!record.mfg_date) return false;

      const recordDate = new Date(record.mfg_date);
      const fromDate = filters.dateFrom ? new Date(filters.dateFrom) : null;
      const toDate = filters.dateTo ? new Date(filters.dateTo) : null;

      if (fromDate && recordDate < fromDate) return false;

      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        if (recordDate > endDate) return false;
      }

      return true;
    });
  }

  const itcds = filteredRecords
    .map((qc) => qc.productionPlanMaster?.finished_id || qc.itcd)
    .filter(Boolean);

  let allParameters = [];

  if (itcds.length > 0) {
    allParameters = await prisma.item_Quality.findMany({
      where: {
        itcd: { in: itcds },
      },
      distinct: ["parameter_name"],
      select: {
        parameter_name: true,
      },
      orderBy: {
        parameter_name: "asc",
      },
    });
  }

  if (allParameters.length === 0) {
    allParameters = await prisma.quality_parameters.findMany({
      select: {
        parameter_name: true,
      },
      orderBy: {
        parameter_name: "asc",
      },
    });
  }

  // Preferred Order
  const preferredOrder = [
    "VISCOSITY",
    "SOLID",
    "ADHESION",
    "OPACITY",
    "ΔE",
    "FINENESS",
  ];

  // Sort Parameters
  allParameters = allParameters.sort((a, b) => {
    const nameA = a.parameter_name.toUpperCase().trim();
    const nameB = b.parameter_name.toUpperCase().trim();

    const indexA = preferredOrder.indexOf(nameA);
    const indexB = preferredOrder.indexOf(nameB);

    const posA = indexA === -1 ? 999 : indexA;
    const posB = indexB === -1 ? 999 : indexB;

    return posA - posB || nameA.localeCompare(nameB);
  });

  // Bulk-fetch every QualityDetail + QualityDetailDetail row for all matched
  // QC masters in two round trips total, instead of 3-4 sequential queries
  // PER record inside Promise.all — which exhausts the DB connection pool
  // once there are more matched records than the pool's connection limit.
  const qcIds = filteredRecords.map((qc) => qc.id);

  const [allDetailsFlat, allRealizedFlat] = qcIds.length > 0
    ? await Promise.all([
      prisma.qualityDetail.findMany({
        where: { master_id: { in: qcIds } },
        orderBy: [{ master_id: "asc" }, { attempt_no: "desc" }],
      }),
      prisma.qualityDetailDetail.findMany({
        where: { master_id: { in: qcIds } },
        include: { detail: { select: { parameter_name: true } } },
      }),
    ])
    : [[], []];

  const detailsByMaster = new Map();
  for (const d of allDetailsFlat) {
    if (!detailsByMaster.has(d.master_id)) detailsByMaster.set(d.master_id, []);
    detailsByMaster.get(d.master_id).push(d);
  }

  const realizedByMasterAttempt = new Map();
  for (const r of allRealizedFlat) {
    const key = `${r.master_id}:${r.attempt_no}`;
    if (!realizedByMasterAttempt.has(key)) realizedByMasterAttempt.set(key, []);
    realizedByMasterAttempt.get(key).push(r);
  }

  const enrichedData = filteredRecords.map((qc) => {
    const itcdValue = qc.productionPlanMaster?.finished_id || qc.itcd;
    // Sorted attempt_no desc within this master via the bulk query's orderBy.
    const allDetails = detailsByMaster.get(qc.id) || [];

    let bestAttemptNo = null;
    let bestAttemptDate = null;

    for (const detail of allDetails) {
      const realizedForAttempt =
        realizedByMasterAttempt.get(`${qc.id}:${detail.attempt_no}`) || [];
      const hasRealized = realizedForAttempt.some(
        (r) => r.quality_realized && r.quality_realized.trim() !== ""
      );

      if (hasRealized) {
        bestAttemptNo = detail.attempt_no;
        bestAttemptDate = detail.attempt_date;
        break;
      }
    }

    if (!bestAttemptNo && allDetails.length > 0) {
      bestAttemptNo = allDetails[0].attempt_no;
      bestAttemptDate = allDetails[0].attempt_date;
    }

    // Linked via detail_id -> QualityDetail.parameter_name, not array
    // position, so a realized value always lands on its actual
    // parameter regardless of how the attempt's rows were saved.
    const parameterMap = {};
    if (bestAttemptNo) {
      const realizedValues = realizedByMasterAttempt.get(`${qc.id}:${bestAttemptNo}`) || [];
      realizedValues.forEach((rv) => {
        const value = rv.quality_realized || "";
        if (rv.detail?.parameter_name && value.trim() !== "") {
          parameterMap[rv.detail.parameter_name] = value;
        }
      });
    }

    const rejectDetail = allDetails.find(
      (d) => d.reject_reason !== null && d.reject_reason !== undefined
    );

    const row = {
      id: qc.id,
      mfg_date: qc.mfg_date,
      expiry_date: qc.expiry_date,
      master_sample: qc.item?.alternate_id,
      proc_ord_no: qc.productionPlanMaster?.id || qc.proc_ord_no,
      itcd: itcdValue,
      item_name:
        qc.item?.item ||
        qc.productionPlanMaster?.item?.item ||
        "",
      batch_no: qc.batch_no || "",
      batch_size: qc.batch_size || 0,
      attempt_no: bestAttemptNo,
      attempt_date: bestAttemptDate,
      status: qc.status || "DRAFT",
      reject_reason: rejectDetail?.reject_reason || "",
    };

    allParameters.forEach((param) => {
      row[param.parameter_name] =
        parameterMap[param.parameter_name] || "";
    });

    return row;
  });

  const parameterColumns = allParameters.map((param) => ({
    field: param.parameter_name,
    headerName: param.parameter_name.toUpperCase(),
    width: 25,
  }));

  return {
    data: enrichedData,
    parameterColumns,
  };
}
function calculateMasterSampleSummary(data) {
  const summary = {
    total_items: data.length,
  };

  return summary;
}


function calculateStockWithCostSummary(data) {
  return {
    total_items: data.length,
    total_opening_qty: data.reduce((s, r) => s + (r.opening_qty || 0), 0),
    total_rm_value: data.reduce((s, r) => s + (r.rm_value || 0), 0),
    total_cc_cost: data.reduce((s, r) => s + (r.cc_cost || 0), 0),
    total_opening_value: data.reduce((s, r) => s + (r.opening_value || 0), 0),
  };
}

// ─── Cost of Sales (transaction-level) ──────────────────────────────────────
// Each sale voucher line with cost rate, COGS and margin
async function getCostOfSalesReport(filters = {}) {
  try {
    const { dateFrom, dateTo, product, category, godown } = filters;

    const periodEnd = dateTo ? new Date(dateTo) : new Date();
    const periodStart = dateFrom ? new Date(dateFrom) : new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
    const month = periodEnd.getMonth() + 1;
    const year = periodEnd.getFullYear();

    // Opening rates from costing module (item-level, lib/openingStock.js)
    const openingRates = await getOpeningRates(month, year);
    const rateMap = new Map();
    openingRates.forEach((r, itcd) => rateMap.set(itcd, Number(r.opening_rate || 0)));

    // If no opening stock rates, fall back to weighted avg purchase rate up to period
    const fallbackRates = await prisma.$queryRaw`
      SELECT
        t.itcd,
        CASE WHEN SUM(t.qty) > 0 THEN SUM(COALESCE(t.damt,0)) / SUM(t.qty) ELSE 0 END AS avg_rate
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 4
        AND tm.dated <= ${periodEnd}
        ${product ? Prisma.sql`AND t.itcd   = ${parseInt(product)}` : Prisma.empty}
      GROUP BY t.itcd
    `;
    fallbackRates.forEach(r => {
      if (!rateMap.has(r.itcd)) rateMap.set(r.itcd, Number(r.avg_rate || 0));
    });

    // Sale + POS transactions in period
    const sales = await prisma.$queryRaw`
      SELECT
        tm.tran_id,
        tm.tran_code,
        tm.dated,
        tm.vr_no,
        tm.invoice_no,
        COALESCE(a.acname, '') AS party_name,
        g.godown                      AS godown_name,
        t.itcd                        AS product_code,
        i.item                        AS product_name,
        i.code                        AS product_sku,
        i.unit,
        ic.ic_name                    AS category,
        t.qty,
        CASE
          WHEN tm.tran_code = 6 THEN COALESCE(t.camt,0) + COALESCE(t.st_amount,0)
          WHEN tm.tran_code = 5 THEN COALESCE(t.gross_amount,0)
          ELSE 0
        END AS sale_amount,
        CASE
          WHEN tm.tran_code = 6 AND t.qty > 0
            THEN (COALESCE(t.camt,0) + COALESCE(t.st_amount,0)) / t.qty
          WHEN tm.tran_code = 5 AND t.qty > 0
            THEN COALESCE(t.gross_amount,0) / t.qty
          ELSE 0
        END AS sale_rate

      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      JOIN "Item"         i  ON i.itcd    = t.itcd
      JOIN "ItemCategory" ic ON ic.id     = i.ic_id
      LEFT JOIN "acno"          a  ON a.acno   = tm.pycd
      LEFT JOIN "Godown"        g  ON g.id      = tm.godown

      WHERE tm.tran_code IN (6, 5)
        AND tm.dated >= ${periodStart}
        AND tm.dated <= ${periodEnd}
        AND t.qty   IS NOT NULL
        AND t.qty    > 0
        ${product ? Prisma.sql`AND t.itcd  = ${parseInt(product)}` : Prisma.empty}
        ${category ? Prisma.sql`AND i.ic_id = ${parseInt(category)}` : Prisma.empty}
        ${godown ? Prisma.sql`AND tm.godown = ${parseInt(godown)}` : Prisma.empty}

      ORDER BY tm.dated DESC, tm.tran_id
    `;

    return sales.map(row => {
      const qty = Number(row.qty || 0);
      const saleAmt = Number(row.sale_amount || 0);
      const saleRate = Number(row.sale_rate || 0);
      const costRate = rateMap.get(row.product_code) || 0;
      const cogs = qty * costRate;
      const gross_profit = saleAmt - cogs;
      const gross_margin = saleAmt > 0 ? (gross_profit / saleAmt * 100) : 0;
      const tran_type = row.tran_code === 5 ? 'POS' : 'Sale';

      return {
        tran_id: row.tran_id,
        tran_type,
        dated: row.dated,
        vr_no: row.vr_no || '',
        invoice_no: row.invoice_no || '',
        party_name: row.party_name,
        godown_name: row.godown_name || '',
        product_code: row.product_code,
        product_name: row.product_name,
        product_sku: row.product_sku || '',
        unit: row.unit || '',
        category: row.category,
        qty,
        sale_rate: saleRate,
        sale_amount: saleAmt,
        cost_rate: costRate,
        cogs,
        gross_profit,
        gross_margin_pct: gross_margin,
      };
    });
  } catch (err) {
    console.error("costOfSales error:", err);
    return [];
  }
}

function calculateCostOfSalesSummary(data) {
  const total_sale = data.reduce((s, r) => s + (r.sale_amount || 0), 0);
  const total_cogs = data.reduce((s, r) => s + (r.cogs || 0), 0);
  const total_profit = data.reduce((s, r) => s + (r.gross_profit || 0), 0);
  return {
    total_transactions: data.length,
    total_qty: data.reduce((s, r) => s + (r.qty || 0), 0),
    total_sale_amount: total_sale,
    total_cogs,
    total_gross_profit: total_profit,
    avg_gross_margin: total_sale > 0 ? (total_profit / total_sale * 100) : 0,
    total_pos: data.filter(r => r.tran_type === 'POS').length,
    total_invoices: data.filter(r => r.tran_type === 'Sale').length,
  };
}

async function getSaleOrderToDispatchReport(filters) {
  const where = {
    order_catagory: 6, // Sale Order
  };

  if (filters.dateFrom || filters.dateTo) {
    where.dated = {};
    if (filters.dateFrom) where.dated.gte = filters.dateFrom instanceof Date ? filters.dateFrom : new Date(filters.dateFrom);
    if (filters.dateTo) where.dated.lte = filters.dateTo instanceof Date ? filters.dateTo : new Date(filters.dateTo);
  }

  if (filters.vendor) {
    where.party_code = Number(filters.vendor);
  }

  if (filters.so_no) {
    where.order_no = Number(filters.so_no);
  }

  if (filters.item) {
    where.orderDetails = {
      some: {
        itcd: Number(filters.item),
      },
    };
  }

  const orders = await prisma.orderMaster.findMany({
    where,
    include: {
      acno: true,
      orderDetails: {
        where: filters.item ? { itcd: Number(filters.item) } : undefined,
        include: {
          items: true,
        },
      },
    },
    orderBy: {
      dated: "desc",
    },
  });

  if (orders.length === 0) return [];

  const orderNos = orders.map((o) => o.order_no);

  // 1. Dispatches against these SOs (tran_code 6)
  const dispatches = await prisma.transactionsMaster.findMany({
    where: {
      tran_code: 6,
      so_no: { in: orderNos },
    },
    include: {
      transactions: {
        select: {
          itcd: true,
          qty: true,
        },
      },
    },
  });

  const dispatchedQtyMap = new Map();
  for (const d of dispatches) {
    const soNo = d.so_no;
    if (!soNo) continue;
    if (!dispatchedQtyMap.has(soNo)) {
      dispatchedQtyMap.set(soNo, new Map());
    }
    const itemMap = dispatchedQtyMap.get(soNo);
    for (const t of d.transactions) {
      if (t.itcd != null) {
        const cur = itemMap.get(t.itcd) || 0;
        itemMap.set(t.itcd, cur + (t.qty || 0));
      }
    }
  }

  // 2. Production Plans for these SOs
  const prodPlans = await prisma.productionPlanMaster.findMany({
    where: {
      sale_ord_no: { in: orderNos },
    },
    include: {
      item: true,
    },
    orderBy: { id: "desc" },
  });

  const prodPlanMap = new Map();
  const planIds = [];
  for (const p of prodPlans) {
    const soNo = p.sale_ord_no;
    const finishedId = p.finished_id;
    if (soNo && finishedId) {
      if (!prodPlanMap.has(soNo)) {
        prodPlanMap.set(soNo, new Map());
      }
      const itemMap = prodPlanMap.get(soNo);
      if (!itemMap.has(finishedId)) {
        itemMap.set(finishedId, p);
      }
    }
    if (p.id) planIds.push(p.id);
  }

  // 3. Requisitions for these plans or Sale Orders
  const reqWhereConditions = [];
  if (planIds.length > 0) {
    reqWhereConditions.push({ plan_id: { in: planIds } });
  }
  if (orderNos.length > 0) {
    reqWhereConditions.push({ so_no: { in: orderNos } });
  }

  const requisitions = reqWhereConditions.length > 0
    ? await prisma.reqMaster.findMany({
        where: {
          OR: reqWhereConditions,
        },
        include: {
          details: true,
        },
        orderBy: { tran_id: "desc" },
      })
    : [];

  const reqByPlanMap = new Map();
  const reqBySoNoMap = new Map();
  for (const req of requisitions) {
    if (req.plan_id && !reqByPlanMap.has(req.plan_id)) {
      reqByPlanMap.set(req.plan_id, req);
    }
    if (req.so_no && !reqBySoNoMap.has(req.so_no)) {
      reqBySoNoMap.set(req.so_no, req);
    }
  }

  const reqByItemMap = new Map();
  for (const req of requisitions) {
    for (const d of req.details || []) {
      if (d.itcd && !reqByItemMap.has(d.itcd)) {
        reqByItemMap.set(d.itcd, req);
      }
    }
  }

  const resultRows = [];

  for (const order of orders) {
    const customerName = order.acno?.acname || "Unknown Customer";
    const orderDateStr = order.dated ? new Date(order.dated).toISOString().split("T")[0] : "";
    const soNo = order.order_no;
    const itemDispatches = dispatchedQtyMap.get(soNo) || new Map();
    const itemProdPlans = prodPlanMap.get(soNo) || new Map();

    for (const detail of order.orderDetails || []) {
      const itcd = detail.itcd;
      const itemName = detail.items?.item || `Item #${itcd}`;
      const itemCode = detail.items?.code || String(itcd || "");
      const orderedQty = detail.qty || 0;
      const dispatchedQty = itemDispatches.get(itcd) || 0;
      const remainingQty = Math.max(0, orderedQty - dispatchedQty);

      const prodPlan = itemProdPlans.get(itcd) || null;
      const prodPlanId = prodPlan ? prodPlan.id : null;
      const prodStatusRaw = prodPlan ? (prodPlan.status || "Scheduled") : null;

      const req = (prodPlanId ? reqByPlanMap.get(prodPlanId) : null) || reqBySoNoMap.get(soNo) || reqByItemMap.get(itcd) || null;
      const reqNo = req ? req.tran_id : null;
      const reqStatusRaw = req ? (req.status || "Pending") : null;

      let currentStatus = "Dispatch Pending";

      if (orderedQty > 0 && dispatchedQty >= orderedQty) {
        currentStatus = "Dispatch Completed";
      } else {
        const isReqPending = req && (reqStatusRaw === "Pending" || reqStatusRaw === "Open" || reqStatusRaw === "Draft");
        const isProdInProcess = prodPlan && (
          prodStatusRaw === "In Process" ||
          prodStatusRaw === "Scheduled" ||
          prodStatusRaw === "Draft" ||
          prodStatusRaw === "Sent to Production"
        );
        const isProdReady = prodPlan && (
          prodStatusRaw === "Completed" ||
          prodStatusRaw === "Posted" ||
          prodStatusRaw === "Production Ready" ||
          prodStatusRaw === "Finished"
        );

        if (isReqPending || reqStatusRaw === "Material Required") {
          currentStatus = "Material Required / Requisition Pending";
        } else if (isProdInProcess) {
          currentStatus = "Production in Process";
        } else if (isProdReady) {
          currentStatus = "Production Ready";
        } else if (req) {
          if (reqStatusRaw === "Completed" || reqStatusRaw === "Approved") {
            currentStatus = "Production in Process";
          } else {
            currentStatus = "Material Required / Requisition Pending";
          }
        } else {
          currentStatus = "Dispatch Pending";
        }
      }

      if (filters.status && filters.status !== "" && filters.status !== "all") {
        if (currentStatus.toLowerCase() !== filters.status.toLowerCase()) {
          continue;
        }
      }

      resultRows.push({
        id: `${soNo}_${itcd}`,
        order_no: soNo,
        tran_code: 600, // Sale Order drill (rule 15)
        dated: orderDateStr,
        customer_name: customerName,
        itcd: itcd,
        item_code: itemCode,
        item_name: itemName,
        ordered_qty: orderedQty,
        dispatched_qty: dispatchedQty,
        remaining_qty: remainingQty,
        req_no: reqNo || "-",
        req_status: reqStatusRaw || "-",
        prod_plan_id: prodPlanId || "-",
        prod_status: prodStatusRaw || "-",
        status: currentStatus,
      });
    }
  }

  return resultRows;
}

function calculateSaleOrderToDispatchSummary(data) {
  const uniqueOrders = new Set(data.map((r) => r.order_no));
  return {
    total_orders: uniqueOrders.size,
    total_ordered_qty: data.reduce((sum, r) => sum + (r.ordered_qty || 0), 0),
    total_dispatched_qty: data.reduce((sum, r) => sum + (r.dispatched_qty || 0), 0),
    total_remaining_qty: data.reduce((sum, r) => sum + (r.remaining_qty || 0), 0),
  };
}

async function getSalesPerformanceWeeklyReport(filters = {}) {
  const month = parseInt(filters.month) || (new Date().getMonth() + 1);
  const year = parseInt(filters.year) || new Date().getFullYear();
  const customerVal = filters.customer;

  const customerMacnos = await getAccountGroup("customers");
  const dated = new Date(year, month - 1, 1);

  // 1. Fetch customers
  const customers = await prisma.aCNO.findMany({
    where: {
      macno: { in: customerMacnos },
      ...(customerVal && customerVal !== "all" ? { acno: parseInt(customerVal) } : {})
    },
    select: {
      acno: true,
      acname: true
    },
    orderBy: {
      acname: "asc"
    }
  });

  if (customers.length === 0) {
    return { data: [], summary: {} };
  }

  const acnoArray = customers.map(c => c.acno);

  // 2. Fetch targets
  const targets = await prisma.customerMonthlyTarget.findMany({
    where: {
      dated,
      acno: { in: acnoArray }
    }
  });
  const targetMap = new Map(targets.map(t => [t.acno, t]));

  // Month date boundaries (for querying the full month)
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const getWeekNumber = (d) => {
    const day = new Date(d).getDate();
    if (day >= 1 && day <= 7) return 1;
    if (day >= 8 && day <= 14) return 2;
    if (day >= 15 && day <= 21) return 3;
    return 4;
  };

  // 3. Sale actual: sub_tran_id=3 row identifies the customer (t3.acno = customer, damt = total invoice amount).
  //    Qty is aggregated from sub_tran_id=1 item lines of the same tran_id.
  const sales = await prisma.$queryRaw`
    SELECT
      t3.acno                                                         AS acno,
      tm.dated                                                        AS dated,
      COALESCE(SUM(CASE WHEN t.sub_tran_id = 1 THEN t.qty    ELSE 0 END), 0) AS qty,
      COALESCE(SUM(CASE WHEN t.sub_tran_id = 3 AND t.acno = t3.acno
                        THEN t.damt ELSE 0 END), 0)                   AS sale_amount
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t3 ON t3.tran_id = tm.tran_id AND t3.sub_tran_id = 3
    JOIN "Transactions" t  ON t.tran_id  = tm.tran_id
    WHERE tm.tran_code = 6
      AND tm.dated >= ${monthStart}
      AND tm.dated <= ${monthEnd}
      AND t3.acno = ANY(${acnoArray}::int[])
    GROUP BY t3.acno, tm.tran_id, tm.dated
  `;

  // 4. Query actual recovery: tran_code=1 (Receipt), sub_tran_id=1 — camt on customer line
  const recoveries = await prisma.$queryRaw`
    SELECT
      t.acno           AS acno,
      tm.dated         AS dated,
      COALESCE(t.camt, 0) AS camt
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    WHERE tm.tran_code = 1
      AND t.sub_tran_id = 1
      AND tm.dated >= ${monthStart}
      AND tm.dated <= ${monthEnd}
      AND t.acno = ANY(${acnoArray}::int[])
      AND t.camt IS NOT NULL
      AND t.camt > 0
  `;

  // Initialize data map for each customer
  const customerData = new Map();
  customers.forEach(c => {
    customerData.set(c.acno, {
      acno: c.acno,
      customerName: `${c.acname}`,
      
      saleTargetQtyMonth: 0,
      recTargetAmtMonth: 0,
      saleActualQtyMonth: 0,
      recActualAmtMonth: 0,

      // Week 1
      saleTargetQtyWeek1: 0,
      recTargetAmtWeek1: 0,
      saleActualQtyWeek1: 0,
      recActualAmtWeek1: 0,

      // Week 2
      saleTargetQtyWeek2: 0,
      recTargetAmtWeek2: 0,
      saleActualQtyWeek2: 0,
      recActualAmtWeek2: 0,

      // Week 3
      saleTargetQtyWeek3: 0,
      recTargetAmtWeek3: 0,
      saleActualQtyWeek3: 0,
      recActualAmtWeek3: 0,

      // Week 4
      saleTargetQtyWeek4: 0,
      recTargetAmtWeek4: 0,
      saleActualQtyWeek4: 0,
      recActualAmtWeek4: 0,
    });
  });

  // Populate Targets
  targets.forEach(t => {
    const cData = customerData.get(t.acno);
    if (cData) {
      cData.saleTargetQtyMonth = Number(t.targetQty || 0);
      cData.recTargetAmtMonth = Number(t.targetRecovery || 0);
    }
  });

  // Process Sales: sub_tran_id=3 identifies customer; qty from sub_tran_id=1
  sales.forEach(s => {
    const pycd = Number(s.acno);
    if (!pycd) return;
    const cData = customerData.get(pycd);
    if (!cData) return;

    const qty = Number(s.qty || 0);
    const week = getWeekNumber(s.dated);

    cData.saleActualQtyMonth += qty;
    cData[`saleActualQtyWeek${week}`] += qty;
  });

  // Process Recoveries Actual Amt — $queryRaw returns flat rows: { acno, dated, camt }
  recoveries.forEach(r => {
    const acno = Number(r.acno);
    if (!acno) return;
    const cData = customerData.get(acno);
    if (!cData) return;

    const amount = Number(r.camt || 0);
    const week = getWeekNumber(r.dated);

    cData.recActualAmtMonth += amount;
    cData[`recActualAmtWeek${week}`] += amount;
  });

  // Calculate dynamic weekly targets (Recursive Shortfall carry forward)
  customerData.forEach(c => {
    const baseSale = c.saleTargetQtyMonth / 4;
    const baseRec = c.recTargetAmtMonth / 4;

    // Week 1
    c.saleTargetQtyWeek1 = baseSale;
    c.recTargetAmtWeek1 = baseRec;

    // Week 2
    if (c.saleActualQtyWeek1 >= c.saleTargetQtyWeek1) {
      c.saleTargetQtyWeek2 = baseSale;
    } else {
      c.saleTargetQtyWeek2 = c.saleTargetQtyWeek1 + (c.saleTargetQtyWeek1 - c.saleActualQtyWeek1);
    }

    if (c.recActualAmtWeek1 >= c.recTargetAmtWeek1) {
      c.recTargetAmtWeek2 = baseRec;
    } else {
      c.recTargetAmtWeek2 = c.recTargetAmtWeek1 + (c.recTargetAmtWeek1 - c.recActualAmtWeek1);
    }

    // Week 3
    if (c.saleActualQtyWeek2 >= c.saleTargetQtyWeek2) {
      c.saleTargetQtyWeek3 = baseSale;
    } else {
      c.saleTargetQtyWeek3 = c.saleTargetQtyWeek2 + (c.saleTargetQtyWeek2 - c.saleActualQtyWeek2);
    }

    if (c.recActualAmtWeek2 >= c.recTargetAmtWeek2) {
      c.recTargetAmtWeek3 = baseRec;
    } else {
      c.recTargetAmtWeek3 = c.recTargetAmtWeek2 + (c.recTargetAmtWeek2 - c.recActualAmtWeek2);
    }

    // Week 4
    if (c.saleActualQtyWeek3 >= c.saleTargetQtyWeek3) {
      c.saleTargetQtyWeek4 = baseSale;
    } else {
      c.saleTargetQtyWeek4 = c.saleTargetQtyWeek3 + (c.saleTargetQtyWeek3 - c.saleActualQtyWeek3);
    }

    if (c.recActualAmtWeek3 >= c.recTargetAmtWeek3) {
      c.recTargetAmtWeek4 = baseRec;
    } else {
      c.recTargetAmtWeek4 = c.recTargetAmtWeek3 + (c.recTargetAmtWeek3 - c.recActualAmtWeek3);
    }
  });

  // Filter out customers that have all targets & actuals as 0
  let rows = Array.from(customerData.values());
  if (!customerVal || customerVal === "all") {
    rows = rows.filter(c => {
      return (
        c.saleTargetQtyMonth > 0 ||
        c.recTargetAmtMonth > 0 ||
        c.saleActualQtyMonth > 0 ||
        c.recActualAmtMonth > 0
      );
    });
  }

  return {
    data: rows,
    summary: calculateSalesPerformanceWeeklySummary(rows)
  };
}

function calculateSalesPerformanceWeeklySummary(data) {
  return {
    saleTargetQtyMonth: data.reduce((sum, r) => sum + (r.saleTargetQtyMonth || 0), 0),
    recTargetAmtMonth: data.reduce((sum, r) => sum + (r.recTargetAmtMonth || 0), 0),
    saleActualQtyMonth: data.reduce((sum, r) => sum + (r.saleActualQtyMonth || 0), 0),
    recActualAmtMonth: data.reduce((sum, r) => sum + (r.recActualAmtMonth || 0), 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Material Procurement Enquiry — one product, read down the page.
//
//  The user picks a MONTH (not a date range) and how many months of purchases
//  to look back over (default 6; 3 / 12 / 18 / 24 / 36 on request):
//    · Current Stock      — as of the end of that month (today if it is the
//                           current month): latest Monthly Opening Stock on or
//                           before it + movements since, all godowns.
//    · 6 Month Avg Cons.  — Material Issue (tran_code 7) in the 6 months before
//                           the chosen month ÷ 6 (house convention).
//    · MTD Consumption    — Material Issue inside the chosen month.
//    · Min / Max / Avg    — purchases (tran_code 4) in the look-back window,
//                           each shown with the GRN, date and vendor behind it,
//                           followed by the full purchase list so every figure
//                           can be traced.
//    · Last Purchase      — the latest purchase on or before the month end,
//                           even when older than the window.
//
//  Three small indexed queries for one item (run together) instead of the old
//  scan of every line the item ever had.
// ─────────────────────────────────────────────────────────────────────────────
const ENQUIRY_PURCHASE_MONTHS = [3, 6, 12, 18, 24, 36];
const ENQUIRY_AVG_MONTHS = 6;

async function getMaterialProcurementEnquiryReport(filters) {
  const itcd = Number(filters.product?.value ?? filters.product);
  if (!itcd) return [];

  const now = new Date();
  const fm = Number(filters.month);
  const fy = Number(filters.year);
  const month = fm >= 1 && fm <= 12 ? fm : now.getMonth() + 1;
  const year = fy > 0 ? fy : now.getFullYear();
  const lookBack = ENQUIRY_PURCHASE_MONTHS.includes(Number(filters.purchase_months))
    ? Number(filters.purchase_months)
    : 6;

  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  // Stock / MTD can't run past today.
  const asOf = monthEnd > now ? now : monthEnd;
  const purchaseFrom = new Date(year, month - lookBack, 1, 0, 0, 0, 0);
  const consFrom = new Date(year, month - 1 - ENQUIRY_AVG_MONTHS, 1, 0, 0, 0, 0);

  const openingPeriod = await getLatestOpeningPeriod(asOf);
  const periodStart = openingPeriod
    ? new Date(openingPeriod.year, openingPeriod.month - 1, 1, 0, 0, 0, 0)
    : null;

  const [itemRows, statRows, purchases, lastRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT i.itcd, i.code, i.item, i.unit, i.import_type, i.re_order
      FROM "Item" i
      WHERE i.itcd = ${itcd}
    `,
    // Stock (opening + movements, control rows excluded; transfers cancel
    // across godowns) and consumption, in one pass over this item's lines.
    prisma.$queryRaw`
      WITH mv AS (
        SELECT t.qty, tm.tran_code, tm.dated
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        WHERE t.itcd = ${itcd}
          AND COALESCE(t.sub_tran_id, 1) <> 3
          AND tm.dated <= ${asOf}
          AND tm.tran_code IN (4, 5, 6, 7, 8, 9, 10, 12)
      ),
      opening AS (
        ${openingPeriod
          ? openingQtySql(openingPeriod.month, openingPeriod.year)
          : Prisma.sql`SELECT NULL::int AS itcd, 0::double precision AS opening_qty WHERE FALSE`}
      )
      SELECT
        COALESCE((SELECT opening_qty FROM opening WHERE itcd = ${itcd}), 0)::float
        + COALESCE(SUM(CASE
            WHEN tran_code IN (4, 8, 10, 12) THEN qty
            WHEN tran_code IN (5, 6, 7, 9) THEN -qty
            ELSE 0 END)
          FILTER (WHERE ${periodStart ? Prisma.sql`dated >= ${periodStart}` : Prisma.sql`TRUE`}), 0)::float AS stock,
        COALESCE(SUM(qty) FILTER (WHERE tran_code = 7 AND dated >= ${consFrom} AND dated < ${monthStart}), 0)::float AS six_month,
        COALESCE(SUM(qty) FILTER (WHERE tran_code = 7 AND dated >= ${monthStart}), 0)::float AS mtd
      FROM mv
    `,
    // Every purchase line in the look-back window — the evidence for min/max/avg.
    prisma.$queryRaw`
      SELECT tm.tran_id, tm.dated, tm.vr_no, tm.pycd, a.acname AS vendor,
             t.qty::float AS qty, t.rate::float AS rate
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "acno" a ON a.acno = tm.pycd
      WHERE t.itcd = ${itcd}
        AND tm.tran_code = 4
        AND COALESCE(t.sub_tran_id, 1) = 1
        AND tm.dated >= ${purchaseFrom}
        AND tm.dated <= ${monthEnd}
      ORDER BY tm.dated DESC, tm.vr_no DESC, t.id
    `,
    // Last PRICED purchase — GRNs booked at rate 0 (free / rate pending)
    // would otherwise show a last rate of 0.
    prisma.$queryRaw`
      SELECT tm.dated, tm.vr_no, a.acname AS vendor, t.qty::float AS qty, t.rate::float AS rate
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "acno" a ON a.acno = tm.pycd
      WHERE t.itcd = ${itcd}
        AND tm.tran_code = 4
        AND COALESCE(t.sub_tran_id, 1) = 1
        AND t.rate > 0
        AND tm.dated <= ${monthEnd}
      ORDER BY tm.dated DESC, tm.vr_no DESC, t.id
      LIMIT 1
    `,
  ]);

  const item = itemRows[0];
  if (!item) return [];
  const st = statRows[0] || {};

  const n = (v) => Number(v) || 0;
  const fmtNum = (v, dp = 2) =>
    n(v).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: dp });
  const fmtRate = (v) =>
    n(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d) => (d ? format(new Date(d), "dd-MM-yy") : "");
  const fmtMon = (d) => format(d, "MMM-yy");

  // Min / max on priced lines only; a tie goes to the most recent purchase
  // (the list is already newest first).
  const priced = purchases.filter((p) => n(p.rate) > 0);
  const minP = priced.reduce((m, p) => (!m || n(p.rate) < n(m.rate) ? p : m), null);
  const maxP = priced.reduce((m, p) => (!m || n(p.rate) > n(m.rate) ? p : m), null);
  const pricedQty = priced.reduce((s, p) => s + n(p.qty), 0);
  const pricedAmt = priced.reduce((s, p) => s + n(p.qty) * n(p.rate), 0);
  const avgRate = pricedQty > 0 ? pricedAmt / pricedQty : 0;
  const totalQty = purchases.reduce((s, p) => s + n(p.qty), 0);
  const totalAmt = purchases.reduce((s, p) => s + n(p.qty) * n(p.rate), 0);
  const last = lastRows[0];

  const windowText = `${fmtMon(purchaseFrom)} to ${fmtMon(monthStart)}`;
  const consText = `${fmtMon(consFrom)} to ${fmtMon(new Date(year, month - 2, 1))}`;
  const unit = item.unit || "KG";

  const rateRow = (label, p, note = "") => ({
    row_type: "info_row",
    label,
    value: p ? fmtRate(p.rate) : "—",
    date: p ? fmtDate(p.dated) : "",
    ref: p?.vr_no != null ? `GRN ${p.vr_no}` : "",
    vendor: p?.vendor || "",
    qty: p ? fmtNum(p.qty) : note,
  });

  const rows = [
    { row_type: "product_header", label: `${item.code || item.itcd} — ${item.item || ""}` },

    { row_type: "section_header", c1: "Stock & Consumption", c2: "Value", c3: "", c4: "", c5: "", c6: "" },
    { row_type: "info_row", label: "Origin", value: item.import_type || "—", date: "", ref: "", vendor: "", qty: "" },
    { row_type: "info_row", label: "Unit", value: unit, date: "", ref: "", vendor: "", qty: "" },
    { row_type: "info_row", label: "Current Stock", value: fmtNum(st.stock, 3), date: `as of ${fmtDate(asOf)}`, ref: "", vendor: "", qty: "" },
    { row_type: "info_row", label: "Re Order Level", value: item.re_order != null ? fmtNum(item.re_order) : "—", date: "", ref: "", vendor: "", qty: "" },
    {
      row_type: "info_row",
      label: `${ENQUIRY_AVG_MONTHS} Month Avg Consumption`,
      // Total rounded to 6 dp first so a float sum like 626.9999999 still gives 105.
      value: fmtNum(Math.round(Number(n(st.six_month).toFixed(6)) / ENQUIRY_AVG_MONTHS), 0),
      date: consText,
      ref: "",
      vendor: "",
      qty: `Total ${fmtNum(st.six_month)}`,
    },
    { row_type: "info_row", label: "MTD Consumption", value: fmtNum(st.mtd), date: fmtMon(monthStart), ref: "", vendor: "", qty: "" },

    { row_type: "section_header", c1: `Purchase Rates — last ${lookBack} months (${windowText})`, c2: "Rate", c3: "Date", c4: "GRN No", c5: "Vendor", c6: "Qty" },
    rateRow("Last Purchase Rate", last, "No priced purchase"),
    rateRow("Min Purchase Rate", minP, "No purchase in period"),
    rateRow("Max Purchase Rate", maxP, "No purchase in period"),
    {
      row_type: "info_row",
      label: "Average Rate (qty weighted)",
      value: priced.length ? fmtRate(avgRate) : "—",
      date: "",
      ref: "",
      vendor: `${priced.length} priced line(s)${purchases.length > priced.length ? `, ${purchases.length - priced.length} at rate 0` : ""}`,
      qty: fmtNum(pricedQty),
    },
  ];

  // ── Vendor comparison: who sold it, at what rates — cheapest average first,
  // so the buying decision can be read straight off the top row.
  const byVendor = new Map();
  priced.forEach((p) => {
    const key = p.pycd ?? p.vendor ?? "";
    if (!byVendor.has(key)) {
      byVendor.set(key, { vendor: p.vendor || "—", lines: 0, qty: 0, amt: 0, min: Infinity, max: 0, last: p });
    }
    const v = byVendor.get(key); // purchases are newest first → `last` is the first seen
    v.lines += 1;
    v.qty += n(p.qty);
    v.amt += n(p.qty) * n(p.rate);
    v.min = Math.min(v.min, n(p.rate));
    v.max = Math.max(v.max, n(p.rate));
  });
  const vendors = [...byVendor.values()]
    .map((v) => ({ ...v, avg: v.qty > 0 ? v.amt / v.qty : v.min }))
    .sort((a, b) => a.avg - b.avg);

  rows.push({
    row_type: "section_header",
    c1: `Vendor Rates — last ${lookBack} months (cheapest first)`,
    c2: "Avg Rate",
    c3: "Min – Max",
    c4: "Last Rate",
    c5: "Last Purchase",
    c6: "Qty (lines)",
  });
  if (vendors.length) {
    vendors.forEach((v, i) => {
      rows.push({
        row_type: "vendor_row",
        vendor: `${v.vendor}${i === 0 && vendors.length > 1 ? "  ★ Lowest" : ""}`,
        avg: fmtRate(v.avg),
        range: v.min === v.max ? fmtRate(v.min) : `${fmtRate(v.min)} – ${fmtRate(v.max)}`,
        last_rate: fmtRate(v.last.rate),
        last_date: `${fmtDate(v.last.dated)}${v.last.vr_no != null ? ` · GRN ${v.last.vr_no}` : ""}`,
        qty: `${fmtNum(v.qty)} (${v.lines})`,
      });
    });
  } else {
    rows.push({ row_type: "purchase_total", label: `No priced purchases from ${windowText}`, qty: "", rate: "", amount: "" });
  }

  // ── Every purchase in the window, newest first — the evidence.
  rows.push({ row_type: "section_header", c1: `All Purchases — ${windowText}`, c2: "GRN No", c3: "Vendor", c4: "Qty", c5: "Rate", c6: "Amount" });

  if (purchases.length) {
    purchases.forEach((p) => {
      const tag = n(p.rate) <= 0 ? " (no rate)" : p === minP ? " ▼ Min" : p === maxP ? " ▲ Max" : "";
      rows.push({
        row_type: "purchase_row",
        // The GRN behind the line — voucher drill (CLAUDE.md rule 15)
        tran_id: p.tran_id != null ? Number(p.tran_id) : null,
        tran_code: 4,
        date: fmtDate(p.dated),
        ref: p.vr_no != null ? `GRN ${p.vr_no}` : "",
        vendor: p.vendor || "",
        qty: fmtNum(p.qty),
        rate: `${fmtRate(p.rate)}${tag}`,
        amount: fmtRate(n(p.qty) * n(p.rate)),
      });
    });
    rows.push({
      row_type: "purchase_total",
      label: `Total — ${purchases.length} purchase line(s)`,
      qty: fmtNum(totalQty),
      rate: priced.length ? fmtRate(avgRate) : "",
      amount: fmtRate(totalAmt),
    });
  } else {
    rows.push({ row_type: "purchase_total", label: `No purchases from ${windowText}`, qty: "", rate: "", amount: "" });
  }

  return rows;
}
// ─────────────────────────────────────────────────────────────────────────────
//  Imported Material Stock (in Bonded Warehouse) — as of a date
//
//  Flow:  L/C  →  In-Bond entry (InboundMaster/InboundDetail) puts goods INTO bond
//              →  Ex-Bond GRN (TRANSACTIONS_MASTER tran_code=4, bond_id = InboundMaster.id)
//                 takes them OUT of bond into the factory.
//
//  Balance in bond = In-Bond qty − Ex-Bond GRN qty, per (bond entry, item),
//  counting only documents dated on/before the As Of Date.
//
//  InboundMaster.lc_no is the L/C *GL account* (ACNO, macno 36/37) — the same
//  account stored in LCMaster.lc_gl. lCMasterId is not filled by the In-Bond
//  form, so the LC is resolved by lCMasterId first, then by lc_gl.
// ─────────────────────────────────────────────────────────────────────────────
const IMS_STATUS = {
  IN_BOND: "In Bond",
  PARTIAL: "Partially Released",
  EXPIRED: "Bond Limit Expired",
  RELEASED: "Fully Released",
  OVER: "Over Released",
};

// Status filter value → SQL predicate on the computed status
const IMS_STATUS_FILTER = {
  pending: Prisma.sql`status IN (${IMS_STATUS.IN_BOND}, ${IMS_STATUS.PARTIAL}, ${IMS_STATUS.EXPIRED})`,
  in_bond: Prisma.sql`status = ${IMS_STATUS.IN_BOND}`,
  partial: Prisma.sql`status = ${IMS_STATUS.PARTIAL}`,
  expired: Prisma.sql`status = ${IMS_STATUS.EXPIRED}`,
  released: Prisma.sql`status = ${IMS_STATUS.RELEASED}`,
  over: Prisma.sql`status = ${IMS_STATUS.OVER}`,
};

// Select filters send "all" when the user picks the "All …" option
const imsVal = (v) => (v === undefined || v === null || v === "" || v === "all" ? null : v);

async function getImportedMaterialStockReport(filters) {
  const asOf = filters.dateTo ? new Date(filters.dateTo) : new Date();
  asOf.setHours(23, 59, 59, 999);
  const asOfDay = new Date(asOf);
  asOfDay.setHours(0, 0, 0, 0);

  const lcNo = imsVal(filters.lc_no);
  const bondId = imsVal(filters.bond_id) != null ? parseInt(filters.bond_id, 10) : null;
  const locationId = imsVal(filters.bond_location_id) != null ? parseInt(filters.bond_location_id, 10) : null;
  const itcd = imsVal(filters.itcd) != null ? parseInt(filters.itcd, 10) : null;
  const importType = imsVal(filters.import_type);
  const statusKey = imsVal(filters.status) ?? (filters.status === "all" ? null : "pending");

  // Filters pushed down into the CTEs (index-friendly)
  const bondWhere = [Prisma.sql`im.dated <= ${asOf}`];
  if (Number.isInteger(bondId)) bondWhere.push(Prisma.sql`im.id = ${bondId}`);
  if (Number.isInteger(locationId)) bondWhere.push(Prisma.sql`im.bond_location_id = ${locationId}`);
  const itemSql = (col) => (Number.isInteger(itcd) ? Prisma.sql`AND ${Prisma.raw(col)} = ${itcd}` : Prisma.empty);

  // Filters that need the resolved L/C
  const lcWhere = [];
  if (lcNo) lcWhere.push(Prisma.sql`lc.lc_no = ${lcNo}`);
  if (importType) lcWhere.push(Prisma.sql`lc.import_type = ${importType}`);

  const statusWhere = statusKey && IMS_STATUS_FILTER[statusKey]
    ? Prisma.sql`WHERE ${IMS_STATUS_FILTER[statusKey]}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw`
    WITH bonds AS (
      -- Bond entries that exist on the As Of Date
      SELECT im.id FROM "InboundMaster" im
      WHERE ${Prisma.join(bondWhere, " AND ")}
    ),
    inb AS (
      -- Goods put INTO bond, per bond entry + item
      SELECT d.inbound_id, d.itcd, SUM(d.qty) AS inbond_qty
      FROM "InboundDetail" d
      WHERE d.inbound_id IN (SELECT id FROM bonds) ${itemSql("d.itcd")}
      GROUP BY d.inbound_id, d.itcd
    ),
    rel AS (
      -- Goods taken OUT of bond: Ex-Bond GRNs (tran_code 4) posted against the bond entry
      SELECT tm.bond_id AS inbound_id,
             t.itcd,
             SUM(COALESCE(t.qty, 0))     AS released_qty,
             MAX(tm.dated)               AS last_grn_date,
             COUNT(DISTINCT tm.tran_id)  AS grn_count
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 4
        AND tm.bond_id IN (SELECT id FROM bonds)
        AND tm.dated <= ${asOf}
        AND t.itcd IS NOT NULL
        AND COALESCE(t.sub_tran_id, 1) <> 3
        ${itemSql("t.itcd")}
      GROUP BY tm.bond_id, t.itcd
    ),
    stock AS (
      -- FULL JOIN so a GRN line for an item that is not on the bond entry still
      -- shows (as Over Released) instead of silently disappearing
      SELECT COALESCE(inb.inbound_id, rel.inbound_id) AS inbound_id,
             COALESCE(inb.itcd, rel.itcd)             AS itcd,
             COALESCE(inb.inbond_qty, 0)              AS inbond_qty,
             COALESCE(rel.released_qty, 0)            AS released_qty,
             rel.last_grn_date,
             COALESCE(rel.grn_count, 0)               AS grn_count
      FROM inb
      FULL JOIN rel ON rel.inbound_id = inb.inbound_id AND rel.itcd = inb.itcd
    ),
    lc_rate AS (
      -- Weighted FC / PKR rate per L/C item (an L/C can carry the same item on several lines)
      SELECT lcm_id, itcd,
             SUM(fc_amount) / NULLIF(SUM(qty), 0)  AS fc_rate,
             SUM(pkr_amount) / NULLIF(SUM(qty), 0) AS pkr_rate,
             SUM(pkr_amount) / NULLIF(SUM(fc_amount), 0) AS exc_rate
      FROM "LCDetail"
      GROUP BY lcm_id, itcd
    ),
    base AS (
      SELECT
        im.id                              AS inbound_id,
        im.bond_id                         AS bond_no,
        im.dated                           AS into_bond_date,
        im.bond_limit,
        bl.location                        AS bond_location,
        lc.lc_no,
        lc.lc_date,
        lc.import_type,
        lc.doc_rtd_date,
        lc.curr,
        COALESCE(bank.acname, 'No Bank')   AS bank_name,
        lcacc.acname                       AS lc_account,
        it.code,
        it.item                            AS material_description,
        it.unit,
        s.inbond_qty,
        s.released_qty,
        s.inbond_qty - s.released_qty      AS balance_qty,
        s.last_grn_date,
        s.grn_count,
        lr.fc_rate,
        lr.exc_rate,
        lr.pkr_rate
      FROM stock s
      JOIN "InboundMaster" im   ON im.id = s.inbound_id
      JOIN "Item" it            ON it.itcd = s.itcd
      LEFT JOIN "BondLocation" bl ON bl.id = im.bond_location_id
      LEFT JOIN acno lcacc      ON lcacc.acno = im.lc_no
      LEFT JOIN LATERAL (
        SELECT l.id, l.lc_no, l.lc_date, l.import_type, l.doc_rtd_date, l.curr, l.bank
        FROM "LCMaster" l
        WHERE l.id = im."lCMasterId" OR l.lc_gl = im.lc_no
        ORDER BY (l.id = im."lCMasterId") DESC NULLS LAST, l.lc_date DESC NULLS LAST
        LIMIT 1
      ) lc ON TRUE
      LEFT JOIN acno bank       ON bank.acno = lc.bank
      LEFT JOIN lc_rate lr      ON lr.lcm_id = lc.id AND lr.itcd = s.itcd
      ${lcWhere.length ? Prisma.sql`WHERE ${Prisma.join(lcWhere, " AND ")}` : Prisma.empty}
    ),
    final AS (
      SELECT base.*,
        CASE
          WHEN balance_qty < -0.0001 THEN ${IMS_STATUS.OVER}::text
          WHEN balance_qty <= 0.0001 THEN ${IMS_STATUS.RELEASED}::text
          WHEN bond_limit IS NOT NULL AND bond_limit < ${asOfDay} THEN ${IMS_STATUS.EXPIRED}::text
          WHEN released_qty > 0 THEN ${IMS_STATUS.PARTIAL}::text
          ELSE ${IMS_STATUS.IN_BOND}::text
        END AS status
      FROM base
    )
    SELECT * FROM final
    ${statusWhere}
    ORDER BY bank_name, lc_no NULLS LAST, into_bond_date, bond_no, code
  `;

  const fmt = (d) => (d ? format(new Date(d), "dd-MM-yy") : "");
  const DAY = 24 * 60 * 60 * 1000;

  return rows.map((r) => {
    const balance = Number(r.balance_qty) || 0;
    const fcRate = r.fc_rate != null ? Number(r.fc_rate) : 0;
    const pkrRate = r.pkr_rate != null ? Number(r.pkr_rate) : 0;
    const openQty = balance > 0 ? balance : 0;
    const daysInBond = r.into_bond_date
      ? Math.max(0, Math.floor((asOfDay - new Date(r.into_bond_date).setHours(0, 0, 0, 0)) / DAY))
      : "";
    const daysToLimit = r.bond_limit && balance > 0
      ? Math.floor((new Date(r.bond_limit).setHours(0, 0, 0, 0) - asOfDay) / DAY)
      : "";

    return {
      bank_name: r.bank_name,
      lc_no: r.lc_no || r.lc_account || "",
      lc_date: fmt(r.lc_date),
      import_type: r.import_type || "",
      doc_rtd_date: fmt(r.doc_rtd_date),
      bond_no: r.bond_no || "",
      bond_location: r.bond_location || "",
      into_bond_date: fmt(r.into_bond_date),
      bond_limit: fmt(r.bond_limit),
      days_in_bond: daysInBond,
      days_to_limit: daysToLimit,
      code: r.code || "",
      material_description: r.material_description || "",
      unit: r.unit || "",
      inbond_qty: Number(r.inbond_qty) || 0,
      released_qty: Number(r.released_qty) || 0,
      balance_qty: balance,
      grn_count: Number(r.grn_count) || 0,
      last_grn_date: fmt(r.last_grn_date),
      curr: r.curr || "",
      rate: Number(fcRate.toFixed(4)),
      exc_rate: r.exc_rate != null ? Number(Number(r.exc_rate).toFixed(4)) : 0,
      fc_amount: Number((openQty * fcRate).toFixed(2)),
      pkr_amount: Number((openQty * pkrRate).toFixed(2)),
      status: r.status,
    };
  });
}

function calculateImportedMaterialStockSummary(data) {
  const sum = (f) => data.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const count = (st) => data.filter((r) => r.status === st).length;
  return {
    total_inbond_qty: sum("inbond_qty"),
    total_released_qty: sum("released_qty"),
    total_balance_qty: sum("balance_qty"),
    total_fc_amount: Number(sum("fc_amount").toFixed(2)),
    total_pkr_amount: Number(sum("pkr_amount").toFixed(2)),
    in_bond_lines: count(IMS_STATUS.IN_BOND),
    partial_lines: count(IMS_STATUS.PARTIAL),
    expired_lines: count(IMS_STATUS.EXPIRED),
    released_lines: count(IMS_STATUS.RELEASED) + count(IMS_STATUS.OVER),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Imported Material In Transit / Deals in Process — LCMaster + LCDetail
//
//  Stage of an L/C is decided by BL Date:
//    bl_date filled  →  shipped      → "In Transit" report
//    bl_date empty   →  not shipped  → "Deals in Process" report
//
//  Each report also carries a Status per L/C for readability:
//    In Transit : Received (GRN) · Arrived – In Bond · Docs Arrived · ETA Passed · In Transit
//    Deals      : LC Expired · Expiring Soon (≤ 15 days) · Open Deal
//
//  Arrival is detected from the documents that follow the L/C:
//    In-Bond entry → InboundMaster linked by lCMasterId or by lc_gl (= InboundMaster.lc_no)
//    GRN           → TRANSACTIONS_MASTER tran_code 4 with lc_no = L/C no, or bond_id = one of its In-Bond entries
// ─────────────────────────────────────────────────────────────────────────────
const LC_STATUS = {
  RECEIVED: "Received (GRN)",
  IN_BOND: "Arrived - In Bond",
  DOCS: "Docs Arrived",
  ETA_PASSED: "ETA Passed",
  TRANSIT: "In Transit",
  EXPIRED: "LC Expired",
  EXPIRING: "Expiring Soon",
  OPEN: "Open Deal",
};


// Select filters send "all" when the user picks the "All …" option
const lcVal = (v) => (v === undefined || v === null || v === "" || v === "all" ? null : v);

const round2n = (n) => Number((Number(n) || 0).toFixed(2));

/**
 * One row per L/C detail line, for either stage.
 *
 *   stage "transit" — the L/C has sailed (bl_date is set) and has not landed
 *   stage "deals"   — it has not sailed (bl_date is null)
 *
 * Status is a column, never a filter.
 *
 * An L/C leaves the transit report the moment it lands — that is, as soon as
 * it has an In-Bond entry, or a GRN posted against it. The test is made per
 * L/C, not per quantity: a part-delivered L/C is off the report entirely
 * rather than lingering with a remainder. (Only tran_code 4 ever carries
 * lc_no or bond_id, so "appears in TRANSACTIONS_MASTER" and "has a GRN" are
 * the same test here.)
 *
 * While a shipment is still at sea its status merges every stage it has
 * reached, so a line reads "In Transit, ETA Passed, Docs Arrived" rather
 * than collapsing to whichever label happened to win.
 */
async function getLcStageRows(filters, stage) {
  // As Of Date (dateTo): every stage test is made as on that date, like
  // Imported Material Stock. `today` is that day's start, so ETA / expiry /
  // day counts are all measured against it.
  const asOf = filters.dateTo ? new Date(filters.dateTo) : new Date();
  asOf.setHours(23, 59, 59, 999);
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);
  const expiringBy = new Date(today);
  expiringBy.setDate(expiringBy.getDate() + 15);

  // Opened by the As Of Date; sailed by then (transit) or not yet (deals)
  const where = [
    Prisma.sql`l.lc_date <= ${asOf}`,
    stage === "transit" ? Prisma.sql`l.bl_date IS NOT NULL AND l.bl_date <= ${asOf}`
      : Prisma.sql`(l.bl_date IS NULL OR l.bl_date > ${asOf})`,
  ];
  // In Transit only: L/Cs marked LCMaster.is_hidden are left off the report
  // (still in the DB). NULL / false still show.
  if (stage === "transit") where.push(Prisma.sql`l.is_hidden IS NOT TRUE`);

  const lcNo = lcVal(filters.lc_no);
  const bank = lcVal(filters.bank) != null ? parseInt(filters.bank, 10) : null;
  const beneficiary = lcVal(filters.beneficiary) != null ? parseInt(filters.beneficiary, 10) : null;
  const itcd = lcVal(filters.itcd) != null ? parseInt(filters.itcd, 10) : null;
  const importType = lcVal(filters.import_type);
  if (lcNo) where.push(Prisma.sql`l.lc_no = ${lcNo}`);
  if (Number.isInteger(bank)) where.push(Prisma.sql`l.bank = ${bank}`);
  if (Number.isInteger(beneficiary)) where.push(Prisma.sql`l.beneficiary = ${beneficiary}`);
  if (importType) where.push(Prisma.sql`UPPER(l.import_type) = UPPER(${importType})`);

  // Deals have not shipped, so they carry the single expiry label.
  const dealStatusCase = Prisma.sql`
    CASE
      WHEN lf.lc_exp_date IS NOT NULL AND lf.lc_exp_date < ${today} THEN ${LC_STATUS.EXPIRED}::text
      WHEN lf.lc_exp_date IS NOT NULL AND lf.lc_exp_date <= ${expiringBy} THEN ${LC_STATUS.EXPIRING}::text
      ELSE ${LC_STATUS.OPEN}::text
    END`;

  // Landed L/Cs are dropped from transit; on the deals side nothing has
  // shipped, so there is nothing to drop.
  const landedFilter =
    stage === "transit"
      ? Prisma.sql`
        AND l.id NOT IN (SELECT lcm_id FROM bonds)
        AND l.id NOT IN (SELECT lcm_id FROM grn)`
      : Prisma.empty;

  const rows = await prisma.$queryRaw`
    WITH lcs AS (
      SELECT l.* FROM "LCMaster" l
      WHERE ${Prisma.join(where, " AND ")}
    ),
    bonds AS (
      -- In-Bond entries of the selected L/Cs (linked by id, or by L/C GL account).
      -- made by the As Of Date. UNION instead of OR so each side can use its index.
      SELECT l.id AS lcm_id, im.id AS inbound_id
      FROM lcs l JOIN "InboundMaster" im ON im."lCMasterId" = l.id
      WHERE im.dated <= ${asOf}
      UNION
      SELECT l.id, im.id
      FROM lcs l JOIN "InboundMaster" im ON im.lc_no = l.lc_gl
      WHERE im.dated <= ${asOf}
    ),
    grn AS (
      -- L/Cs with a GRN by the As Of Date: Direct GRN on the L/C, or Ex-Bond
      -- GRN on one of its bond entries
      SELECT l.id AS lcm_id
      FROM lcs l JOIN "TRANSACTIONS_MASTER" tm ON tm.lc_no = l.lc_no AND tm.tran_code = 4
      WHERE tm.dated <= ${asOf}
      UNION
      SELECT b.lcm_id
      FROM bonds b JOIN "TRANSACTIONS_MASTER" tm ON tm.bond_id = b.inbound_id AND tm.tran_code = 4
      WHERE tm.dated <= ${asOf}
    ),
    lf AS (
      SELECT l.* FROM lcs l
      WHERE TRUE ${landedFilter}
    ),
    final AS (
      SELECT
        lf.id, lf.lc_no, lf.lc_date, lf.import_type, lf.lc_exp_date, lf.curr,
        lf.terms, lf.indent_no, lf.per_inv_no, lf.per_inv_date, lf.inc_no, lf.roi_no,
        lf.vessel, lf.voyage, lf.etd, lf.eta, lf.bl_no AS lc_bl_no, lf.bl_date,
        lf.ship_company, lf.doc_arr_date, lf.doc_rtd_due_date, lf.doc_rtd_date, lf.remarks,
        COALESCE(bank.acname, 'No Bank') AS bank_name,
        ben.acname                       AS beneficiary,
        d.bl_no, d.qty, d.fc_rate, d.fc_amount, d.exc_rate, d.pkr_amount,
        it.code, it.item AS material_description, it.unit,
        ${stage === "transit" ? Prisma.sql`NULL::text` : dealStatusCase} AS status
      FROM lf
      JOIN "LCDetail" d     ON d.lcm_id = lf.id
      LEFT JOIN "Item" it   ON it.itcd = d.itcd
      LEFT JOIN acno bank   ON bank.acno = lf.bank
      LEFT JOIN acno ben    ON ben.acno = lf.beneficiary
      ${Number.isInteger(itcd) ? Prisma.sql`WHERE d.itcd = ${itcd}` : Prisma.empty}
    )
    SELECT * FROM final
    ORDER BY bank_name, lc_date, lc_no, code
  `;

  const fmt = (d) => (d ? format(new Date(d), "dd-MM-yy") : "");
  const DAY = 24 * 60 * 60 * 1000;
  const daysFrom = (d) => (d ? Math.floor((today - new Date(d).setHours(0, 0, 0, 0)) / DAY) : "");
  const daysTo = (d) => (d ? Math.floor((new Date(d).setHours(0, 0, 0, 0) - today) / DAY) : "");

  return rows.map((r) => {
    const etaPassed = Boolean(r.eta && new Date(r.eta) < today);
    const docsArrived = Boolean(r.doc_arr_date && new Date(r.doc_arr_date) <= asOf);

    let status = r.status;
    if (stage === "transit") {
      // Everything here is still at sea, so "In Transit" always leads; the
      // later stages are appended as they are reached.
      const parts = [LC_STATUS.TRANSIT];
      if (etaPassed) parts.push(LC_STATUS.ETA_PASSED);
      if (docsArrived) parts.push(LC_STATUS.DOCS);
      status = parts.join(", ");
    }

    return {
      bank_name: r.bank_name,
      lc_no: r.lc_no || "",
      lc_date: fmt(r.lc_date),
      import_type: r.import_type || "",
      lc_exp_date: fmt(r.lc_exp_date),
      days_to_expiry: daysTo(r.lc_exp_date),
      lc_age_days: daysFrom(r.lc_date),
      beneficiary: r.beneficiary || "",
      // Deals
      terms: r.terms || "",
      indent_no: r.indent_no || "",
      per_inv_no: r.per_inv_no || "",
      per_inv_date: fmt(r.per_inv_date),
      inc_no: r.inc_no || "",
      roi_no: r.roi_no || "",
      // Transit
      vessel: r.vessel || "",
      voyage: r.voyage || "",
      bl_no: r.bl_no || r.lc_bl_no || "",
      bl_date: fmt(r.bl_date),
      days_since_shipment: daysFrom(r.bl_date),
      etd: fmt(r.etd),
      eta: fmt(r.eta),
      ship_company: r.ship_company || "",
      doc_arr_date: fmt(r.doc_arr_date),
      doc_rtd_due_date: fmt(r.doc_rtd_due_date),
      doc_rtd_date: fmt(r.doc_rtd_date),
      remarks: r.remarks || "",
      // Lines
      code: r.code || "",
      material_description: r.material_description || "",
      unit: r.unit || "",
      qty: Number(r.qty) || 0,
      rate: Number(r.fc_rate) || 0,
      curr: r.curr || "",
      fc_amount: Number(r.fc_amount) || 0,
      exc_rate: Number(r.exc_rate) || 0,
      pkr_amount: Number(r.pkr_amount) || 0,
      status,
      // Not shown as columns — the summary counts on these, because the
      // merged status string is no longer a single value to match on.
      eta_passed: etaPassed,
      docs_arrived: docsArrived,
    };
  });
}

function summarizeLcStage(data, statuses) {
  const sum = (f) => data.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const lcCount = (st) => new Set(data.filter((r) => !st || r.status === st).map((r) => r.lc_no)).size;
  const summary = {
    total_lcs: lcCount(),
    total_qty: round2n(sum("qty")),
    total_fc_amount: round2n(sum("fc_amount")),
    total_pkr_amount: round2n(sum("pkr_amount")),
  };
  for (const [key, st] of Object.entries(statuses)) summary[key] = lcCount(st);
  return summary;
}

async function getImportedMaterialInTransitReport(filters) {
  return getLcStageRows(filters, "transit");
}

function calculateImportedMaterialInTransitSummary(data) {
  const sum = (f) => data.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  // The status string now merges several stages, so it cannot be matched
  // whole; each card counts the L/Cs that have reached that stage.
  const lcsWhere = (fn) => new Set(data.filter(fn).map((r) => r.lc_no)).size;

  return {
    total_lcs: new Set(data.map((r) => r.lc_no)).size,
    total_qty: round2n(sum("qty")),
    total_fc_amount: round2n(sum("fc_amount")),
    total_pkr_amount: round2n(sum("pkr_amount")),
    transit_lcs: new Set(data.map((r) => r.lc_no)).size,
    eta_passed_lcs: lcsWhere((r) => r.eta_passed),
    docs_arrived_lcs: lcsWhere((r) => r.docs_arrived),
  };
}

async function getImportedMaterialDealsReport(filters) {
  return getLcStageRows(filters, "deals");
}

function calculateImportedMaterialDealsSummary(data) {
  return summarizeLcStage(data, {
    open_lcs: LC_STATUS.OPEN,
    expiring_lcs: LC_STATUS.EXPIRING,
    expired_lcs: LC_STATUS.EXPIRED,
  });
}

//  SALES MATRIX MONTHWISE REPORT
// Every amount column the matrix carries, per month and in total.
// margin = sale_amt − sale_cost; margin_pct is derived, never summed.
// sale_amt is the invoice value INCLUDING sales tax (what the customer owes
// and pays — so it is comparable with recovery). net_sale_amt is the same
// sale WITHOUT tax; margin and margin % are worked out from it, since tax is
// not the company's income. net_sale_amt is not shown as a column.
const SALES_MATRIX_METRICS = ["tons", "kg", "qty", "sale_amt", "net_sale_amt", "sale_cost", "margin", "recovery"];

const marginPct = (margin, saleAmt) =>
  saleAmt ? Math.round((margin / saleAmt) * 10000) / 100 : 0;

// The months of the report as SQL rows (key, month, year, from, to). Bounds are
// built from local Dates exactly like the old JS bucketing (getMonth()), so a
// document lands in the same month column it always did.
function salesMatrixMonthsSql(monthsList) {
  return Prisma.join(
    monthsList.map((m) => {
      const from = new Date(m.year, m.month - 1, 1, 0, 0, 0, 0);
      const to = new Date(m.year, m.month, 0, 23, 59, 59, 999);
      return Prisma.sql`(${m.key}::text, ${m.month}::int, ${m.year}::int, ${from}::timestamp, ${to}::timestamp)`;
    }),
  );
}

// parseMultiFilter() → plain int list for SQL IN (...), or null when unset.
const filterList = (val) =>
  val === null || val === undefined ? null : typeof val === "object" && val.in ? val.in : [val];

async function getSalesMatrixMonthwiseReport(filters = {}) {
  try {
    const customerMacnos = await getAccountGroup("customers");
    const { type = "customerSummary" } = filters;
    const isDetail = type === "customerDetail" || type === "productDetail";

    // Handle monthFrom, monthTo, and year filters (or fallback to dateFrom/dateTo if passed)
    const year = parseInt(filters.year) || (filters.dateFrom ? new Date(filters.dateFrom).getFullYear() : new Date().getFullYear());
    let mFrom = parseInt(filters.monthFrom) || (filters.dateFrom ? new Date(filters.dateFrom).getMonth() + 1 : 1);
    let mTo = parseInt(filters.monthTo) || (filters.dateTo ? new Date(filters.dateTo).getMonth() + 1 : new Date().getMonth() + 1);

    if (mFrom > mTo) {
      const tmp = mFrom;
      mFrom = mTo;
      mTo = tmp;
    }

    const dFrom = new Date(year, mFrom - 1, 1, 0, 0, 0, 0);
    const dTo = new Date(year, mTo, 0, 23, 59, 59, 999);

    // 1. Build months list between mFrom and mTo
    const monthsList = [];
    for (let m = mFrom; m <= mTo; m++) {
      const key = `${String(m).padStart(2, "0")}-${year}`;
      monthsList.push({ key, month: m, year, label: key });
    }
    const monthsSql = salesMatrixMonthsSql(monthsList);

    // 2. Filters → SQL fragments
    const customers = filterList(parseMultiFilter(filters.customer || filters.acno, true));
    const items = filterList(parseMultiFilter(filters.item || filters.itcd, true));
    // Ink Series filter = Main Category ids (Item.mc_id)
    const seriesIds = (filterList(parseMultiFilter(filters.category, true)) || [])
      .filter((n) => Number.isFinite(n));

    // Sales person → the ACNO.sales_ares values (user id or username) it covers.
    let salesAreas = null;
    const salePersonVal = filterList(parseMultiFilter(filters.sale_person || filters.salesperson || filters.salesPerson, false));
    if (salePersonVal !== null) {
      const resolvedUsers = await prisma.user.findMany({
        where: { OR: [{ id: { in: salePersonVal } }, { username: { in: salePersonVal } }] },
        select: { id: true, username: true },
      });
      salesAreas = resolvedUsers.flatMap((u) => [u.id, u.username].filter(Boolean));
      // No matching user → nothing can match.
      if (salesAreas.length === 0) salesAreas = ["__NON_EXISTENT__"];
    }

    const pycdSql = customers ? Prisma.sql`AND tm.pycd IN (${Prisma.join(customers)})` : Prisma.empty;
    const areaSql = salesAreas ? Prisma.sql`AND a.sales_ares IN (${Prisma.join(salesAreas)})` : Prisma.empty;
    const itemSql = items ? Prisma.sql`AND t.itcd IN (${Prisma.join(items)})` : Prisma.empty;
    // Like the Item filter, narrows the sales lines only (recovery is per
    // customer, not per item).
    const seriesSql = seriesIds.length
      ? Prisma.sql`AND t.itcd IN (SELECT itcd FROM "Item" WHERE mc_id IN (${Prisma.join(seriesIds)}))`
      : Prisma.empty;

    // 3. All three source queries aggregate inside Postgres and run in parallel;
    //    only one row per (month, customer, item) comes back to Node.
    const [salesRows, knockoffRows, recoveryRows] = await Promise.all([
      // Sales (6) and Sale Returns (10), lines 1–2. A return negates qty and
      // amount. Amount falls back camt → gross → damt (damt first on a
      // return); cost = qty × that month's opening rate, else the item's
      // future cost rate, else its price.
      prisma.$queryRaw`
        WITH months(mkey, m, y, d_from, d_to) AS (VALUES ${monthsSql}),
        lines AS (
          SELECT mo.mkey, mo.m, mo.y, tm.pycd, t.itcd,
                 CASE WHEN tm.tran_code = 10 THEN -COALESCE(t.qty, 0) ELSE COALESCE(t.qty, 0) END AS qty,
                 CASE WHEN tm.tran_code = 10
                      THEN -COALESCE(NULLIF(t.damt, 0), NULLIF(t.gross_amount, 0), NULLIF(t.camt, 0), 0)
                      ELSE  COALESCE(NULLIF(t.camt, 0), NULLIF(t.gross_amount, 0), NULLIF(t.damt, 0), 0)
                 END AS amt,
                 -- Sales tax on the line (negated on a return, like amt)
                 CASE WHEN tm.tran_code = 10
                      THEN -(COALESCE(t.st_amount, 0) + COALESCE(t.additional_tax_amount, 0))
                      ELSE  (COALESCE(t.st_amount, 0) + COALESCE(t.additional_tax_amount, 0))
                 END AS tax
          FROM "TRANSACTIONS_MASTER" tm
          JOIN months mo ON tm.dated >= mo.d_from AND tm.dated <= mo.d_to
          JOIN "Transactions" t ON t.tran_id = tm.tran_id AND t.sub_tran_id IN (1, 2)
          LEFT JOIN "acno" a ON a.acno = tm.pycd
          WHERE tm.tran_code IN (6, 10)
            AND tm.dated >= ${dFrom} AND tm.dated <= ${dTo}
            ${pycdSql} ${areaSql} ${itemSql} ${seriesSql}
        )
        SELECT l.mkey, l.pycd, l.itcd,
               a.acname, i.item, i.code,
               COALESCE(NULLIF(mc.mc_name, ''), NULLIF(i.series, ''), '-') AS mc_name,
               SUM(l.qty)::float AS qty,
               SUM(l.qty * COALESCE(NULLIF(i.weight, 0), 1))::float AS kg,
               SUM(l.amt)::float AS sale_amt,
               SUM(l.tax)::float AS tax_amt,
               SUM(l.qty * COALESCE(r.opening_rate, NULLIF(i.future_cost_rate, 0), NULLIF(i.price, 0), 0))::float AS sale_cost
        FROM lines l
        LEFT JOIN "acno" a ON a.acno = l.pycd
        LEFT JOIN "Item" i ON i.itcd = l.itcd
        LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
        LEFT JOIN "MonthlyOpeningRate" r ON r.month = l.m AND r.year = l.y AND r.itcd = l.itcd
        GROUP BY l.mkey, l.pycd, l.itcd, a.acname, i.item, i.code, mc.mc_name, i.series
        ORDER BY a.acname NULLS LAST, l.pycd, i.code NULLS LAST, l.itcd
      `,

      // Recovery allocated to invoices (live knock-offs), in the month of
      // the receipt that paid them. Name and Sales Person come from the
      // customer the allocation resolves to — st.pycd on a receipt is the
      // BANK, so joining acno on it put bank names on customer rows.
      prisma.$queryRaw`
        WITH months(mkey, m, y, d_from, d_to) AS (VALUES ${monthsSql})
        SELECT mo.mkey,
               x.cust,
               a.acname,
               sl.itcd,
               SUM(k.allocated_amount)::float AS amt
        FROM "INVOICE_KNOCKOFF" k
        JOIN "TRANSACTIONS_MASTER" st ON st.tran_id = k.source_tran_id
        JOIN months mo ON st.dated >= mo.d_from AND st.dated <= mo.d_to
        CROSS JOIN LATERAL (
          SELECT COALESCE(NULLIF(k.invoice_party_acno, 0), NULLIF(k.source_acno, 0), st.pycd) AS cust
        ) x
        LEFT JOIN "Transactions" sl ON sl.id = k.source_line_id
        LEFT JOIN "acno" sa ON sa.acno = sl.acno
        LEFT JOIN "acno" a ON a.acno = x.cust
        WHERE k.reversed_at IS NULL
          AND k.allocated_amount > 0
          AND st.dated >= ${dFrom} AND st.dated <= ${dTo}
          -- A Payment (2) knocking off an invoice is money going OUT (e.g. a
          -- refund) — never recovery.
          AND st.tran_code <> 2
          -- Only money received INTO a customer account: the knock-off's
          -- source line must be a customer credit. (JV knock-offs made from
          -- other accounts' debit lines are not recovery.)
          AND (k.source_line_id IS NULL
               OR (sa.macno IN (${macnoInSql(customerMacnos)}) AND COALESCE(sl.camt, 0) > 0))
          ${customers
            ? Prisma.sql`AND (k.invoice_party_acno IN (${Prisma.join(customers)})
                          OR k.source_acno IN (${Prisma.join(customers)})
                          OR st.pycd IN (${Prisma.join(customers)}))`
            : Prisma.empty}
          ${areaSql}
        GROUP BY 1, 2, 3, 4
        ORDER BY 2, 4 NULLS FIRST
      `,

      // Receipts / JVs / adjustments (1, 3, 13): the part of each CUSTOMER
      // credit line that the knock-offs above did not already count, credited
      // to that customer (t.acno):
      //   remainder = line credit − live allocations made FROM that line
      // Line-level, so a receipt with several customer lines no longer drops
      // the lines that were never knocked off (it used to skip the whole
      // voucher as soon as any one line was), and nothing is counted twice.
      //   • sub_tran_id 3 (the receipt's bank/control row) is never counted —
      //     it mirrors the party line and used to double every receipt
      //   • a JV's expense / bank / payable lines are not recovery
      //   • on a receipt tm.pycd is the bank, so it cannot be the customer
      //   • a voucher with a knock-off not tied to a line is skipped, as
      //     before, since its allocation cannot be matched to a line
      prisma.$queryRaw`
        WITH months(mkey, m, y, d_from, d_to) AS (VALUES ${monthsSql}),
        line_alloc AS (
          SELECT k.source_line_id AS line_id, SUM(k.allocated_amount) AS amt
          FROM "INVOICE_KNOCKOFF" k
          JOIN "TRANSACTIONS_MASTER" st ON st.tran_id = k.source_tran_id
          WHERE k.reversed_at IS NULL
            AND k.allocated_amount > 0
            AND k.source_line_id IS NOT NULL
            AND st.dated >= ${dFrom} AND st.dated <= ${dTo}
          GROUP BY 1
        )
        SELECT mo.mkey, t.acno AS cust, a.acname, t.itcd,
               SUM(GREATEST(t.camt - COALESCE(la.amt, 0), 0))::float AS amt
        FROM "TRANSACTIONS_MASTER" tm
        JOIN months mo ON tm.dated >= mo.d_from AND tm.dated <= mo.d_to
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
        JOIN "acno" a ON a.acno = t.acno
        LEFT JOIN line_alloc la ON la.line_id = t.id
        WHERE tm.tran_code IN (1, 3, 13)
          AND tm.dated >= ${dFrom} AND tm.dated <= ${dTo}
          AND COALESCE(t.sub_tran_id, 1) <> 3
          AND t.camt > 0
          AND a.macno IN (${macnoInSql(customerMacnos)})
          AND NOT EXISTS (
            SELECT 1 FROM "INVOICE_KNOCKOFF" k
            WHERE k.source_tran_id = tm.tran_id AND k.reversed_at IS NULL
            AND k.source_line_id IS NULL
          )
          ${customers ? Prisma.sql`AND t.acno IN (${Prisma.join(customers)})` : Prisma.empty}
          ${areaSql}
        GROUP BY 1, 2, 3, 4
        HAVING SUM(GREATEST(t.camt - COALESCE(la.amt, 0), 0)) > 0
        ORDER BY 2, 4 NULLS FIRST
      `,

      // OLD — summed camt-or-damt of EVERY line of every receipt / JV (both
      // sides, every account) and put it on tm.pycd (the bank on a receipt).
      // prisma.$queryRaw`
      //   WITH months(mkey, m, y, d_from, d_to) AS (VALUES ${monthsSql})
      //   SELECT mo.mkey, tm.pycd AS cust, a.acname, t.itcd,
      //          SUM(COALESCE(NULLIF(t.camt, 0), NULLIF(t.damt, 0), 0))::float AS amt
      //   FROM "TRANSACTIONS_MASTER" tm
      //   JOIN months mo ON tm.dated >= mo.d_from AND tm.dated <= mo.d_to
      //   JOIN "Transactions" t ON t.tran_id = tm.tran_id
      //   LEFT JOIN "acno" a ON a.acno = tm.pycd
      //   WHERE tm.tran_code IN (1, 3, 13)
      //     AND tm.dated >= ${dFrom} AND tm.dated <= ${dTo}
      //     AND COALESCE(NULLIF(t.camt, 0), NULLIF(t.damt, 0), 0) > 0
      //     AND NOT EXISTS (
      //       SELECT 1 FROM "INVOICE_KNOCKOFF" k
      //       WHERE k.source_tran_id = tm.tran_id AND k.reversed_at IS NULL
      //     )
      //     ${pycdSql} ${areaSql}
      //   GROUP BY 1, 2, 3, 4
      //   ORDER BY 2, 4 NULLS FIRST
      // `,
    ]);

    // 4. Fold the aggregated rows into report rows
    const groupMap = new Map();
    // Detail views put a customer's recovery on that customer's first row.
    const firstKeyByCustomer = new Map();

    const getGroupKey = (acno, acname, itcd, itemName, code, mc_name) => {
      const formattedItemName = code ? `${code} - ${itemName || ''}` : (itemName || (itcd ? `Product ${itcd}` : '-'));
      if (type === "productSummary") {
        return { key: `prod_${itcd}`, label: formattedItemName, acno: null, acname: null, itcd, itemName: formattedItemName, code, mc_name };
      } else if (type === "seriesSummary") {
        // One row per Ink Series — every item of the same series is merged.
        // Recovery is called with no series (it is not per item), so it lands
        // on its own "-" row, as Product Summary does with its prod_null row.
        return { key: `series_${mc_name ?? ""}`, label: mc_name || "-", acno: null, acname: null, itcd: null, itemName: null, code: null, mc_name: mc_name || "-" };
      } else if (isDetail) {
        return { key: `cust_${acno}_prod_${itcd}`, label: acname || `Customer ${acno}`, acno, acname, itcd, itemName: formattedItemName, code, mc_name };
      } else {
        // Default: customerSummary
        return { key: `cust_${acno}`, label: acname || `Customer ${acno}`, acno, acname, itcd: null, itemName: null, code: null, mc_name: null };
      }
    };

    const getOrCreateRow = (g) => {
      if (!groupMap.has(g.key)) {
        const row = {
          id: g.key,
          customerCode: g.acno || "-",
          customerName: g.acname || "-",
          productCode: g.itcd,
          productName: g.itemName || "-",
          code: g.code || "-",
          mc_name: g.mc_name || "-",
          label: g.label,
        };
        for (const metric of SALES_MATRIX_METRICS) {
          row[`total_${metric}`] = 0;
          monthsList.forEach((m) => { row[`${m.key}_${metric}`] = 0; });
        }
        groupMap.set(g.key, row);
        if (isDetail && g.acno != null && !firstKeyByCustomer.has(String(g.acno))) {
          firstKeyByCustomer.set(String(g.acno), g.key);
        }
      }
      return groupMap.get(g.key);
    };

    const add = (row, mKey, metric, value) => {
      if (row[`${mKey}_${metric}`] === undefined) return;
      row[`${mKey}_${metric}`] += value;
      row[`total_${metric}`] += value;
    };

    for (const s of salesRows) {
      const row = getOrCreateRow(getGroupKey(s.pycd, s.acname, s.itcd, s.item, s.code, s.mc_name));
      const kg = Number(s.kg) || 0;
      const netSaleAmt = Number(s.sale_amt) || 0;          // without tax
      const saleAmt = netSaleAmt + (Number(s.tax_amt) || 0); // with sales tax
      const saleCost = Number(s.sale_cost) || 0;
      add(row, s.mkey, "tons", kg / 1000);
      add(row, s.mkey, "kg", kg);
      add(row, s.mkey, "qty", Number(s.qty) || 0);
      add(row, s.mkey, "sale_amt", saleAmt);
      add(row, s.mkey, "net_sale_amt", netSaleAmt);
      add(row, s.mkey, "sale_cost", saleCost);
      // Margin stays on the sale WITHOUT tax — tax is not income
      add(row, s.mkey, "margin", netSaleAmt - saleCost);
    }

    const addRecovery = (r) => {
      const amt = Number(r.amt) || 0;
      if (amt <= 0) return;
      let row;
      if (isDetail) {
        const existing = firstKeyByCustomer.get(String(r.cust));
        row = existing
          ? groupMap.get(existing)
          : getOrCreateRow({ ...getGroupKey(r.cust, r.acname, r.itcd || 0, null, null), itemName: "-", code: "-" });
      } else {
        row = getOrCreateRow(getGroupKey(r.cust, r.acname, null, null, null));
      }
      add(row, r.mkey, "recovery", amt);
    };
    knockoffRows.forEach(addRecovery);
    recoveryRows.forEach(addRecovery);

    const data = Array.from(groupMap.values());

    // Ink Series Summary: series A→Z, the recovery-only row last
    if (type === "seriesSummary") {
      const isRecoveryRow = (r) => r.id === "series_";
      data.sort((a, b) =>
        isRecoveryRow(a) !== isRecoveryRow(b)
          ? (isRecoveryRow(a) ? 1 : -1)
          : String(a.mc_name).localeCompare(String(b.mc_name)),
      );
    }

    // Round to 2 decimals and derive margin % from the rounded figures
    data.forEach((r) => {
      for (const metric of SALES_MATRIX_METRICS) {
        r[`total_${metric}`] = round2(r[`total_${metric}`]);
        monthsList.forEach((m) => { r[`${m.key}_${metric}`] = round2(r[`${m.key}_${metric}`]); });
      }
      r.total_margin_pct = marginPct(r.total_margin, r.total_net_sale_amt);
      monthsList.forEach((m) => {
        r[`${m.key}_margin_pct`] = marginPct(r[`${m.key}_margin`], r[`${m.key}_net_sale_amt`]);
      });
    });

    return data;
  } catch (err) {
    console.error("Error in getSalesMatrixMonthwiseReport:", err);
    return [];
  }
}

function calculateSalesMatrixMonthwiseSummary(data = [], monthsList = []) {
  const summary = {};
  const keys = ["total", ...monthsList.map((m) => m.key)];

  for (const k of keys) {
    for (const metric of SALES_MATRIX_METRICS) {
      summary[`${k}_${metric}`] = round2(
        data.reduce((s, r) => s + (Number(r[`${k}_${metric}`]) || 0), 0),
      );
    }
    // A % is never summed — it is worked out again from the summed figures.
    summary[`${k}_margin_pct`] = marginPct(summary[`${k}_margin`], summary[`${k}_net_sale_amt`]);
  }

  // Headline counts for the summary strip
  summary.row_count = data.length;
  summary.recovery_pct = summary.total_sale_amt
    ? Math.round((summary.total_recovery / summary.total_sale_amt) * 10000) / 100
    : 0;

  return summary;
}


// ============================================================
// Reports ported from the Accounting system
// ============================================================
// Raw material item category (the SMS code base keeps raw materials in category 3).
const RM_IC_ID = 3;

async function getCustomerFileReport(filters) {
  // The principal's codes (Settings "distributorFileCodes", lib/reports/distributorFiles.js)
  const codes = await distributorFileCodes();
  // Every account of the Customers group (Finance → Account Settings → Parties)
  const emptyRow = {
    customer_code: "",
    customer_status: "",
    customer_name: "",
    country_code: "",
    country_name: "",
    zip_code: "",
    city: "",
    address: "",
    customer_type: "",
    customer_sub_group_code: "",
    customer_sub_group_description: "",
    subsidiary_code: "",
    salesman_code: "",
  };

  const accounts = await prisma.aCNO.findMany({
    where: {
      macno: { in: await getAccountGroup("customers") },
    },
    select: {
      acno: true,
      acname: true,
      address: true,
      city: true,
      country: true,
      category: true,
      subCategory: false,
      salesArea: true,
      lock: true,
    },
    orderBy: { acno: 'asc' },
  });

  if (accounts.length === 0) {
    return [emptyRow];
  }

  const rows = accounts.map((acno) => ({
    customer_code: String(acno.acno),
    // customer_status: acno.lock ? "Inactive" : "Active",
    customer_status: codes.customerStatus,
    customer_name: acno.acname || "",
    country_code: codes.countryCode,
    country_name: codes.countryName,
    zip_code: "",
    city: acno.city || "",
    address: acno.address || "",
    customer_type: codes.partyType,
    customer_sub_group_code: acno.subCategory || "",
    customer_sub_group_description: acno.subCategory || "",
    subsidiary_code: codes.subsidiaryCode,
    salesman_code: acno.salesArea || "",
  }));

  if (rows.length === 0) {
    return [emptyRow];
  }

  return rows;
}

async function getDailyProductionReport(filters) {

  const where = {
    // Sirf woh process orders jo production mein gaye (status = "Posted")
    status: "Posted",
  };

  // Date Filter
  if (filters.dateFrom || filters.dateTo) {
    where.dated = {
      gte: filters.dateFrom
        ? new Date(
          new Date(filters.dateFrom).setUTCHours(0, 0, 0, 0)
        )
        : undefined,
      lte: filters.dateTo
        ? new Date(
          new Date(filters.dateTo).setUTCHours(23, 59, 59, 999)
        )
        : undefined,
    };
  }

  // Process Order Filter
  if (filters.processOrderNo) {
    where.id = Number(filters.processOrderNo);
  }

  // Finished Product Filter
  if (filters.item) {
    where.finished_id = Number(filters.item);
  }

  // Semi-finished production (was a fixed ic_id 2): the categories come from
  // Settings → Production setup, so a company whose ids differ still gets rows.
  const prodSetup = await getProductionSetup();
  const plans = await prisma.productionPlanMaster.findMany({
    where: {
      ...where,
      item: {
        ic_id: { in: prodSetup.semiFinishedCategoryIds },
      },
    },
    include: {
      item: {
        select: {
          itcd: true,
          item: true,
          code: true,
          packing_material_code: true
        },
      },
    },
    orderBy: {
      batch_no: "asc"
    },
  });

  const rows = [];

  plans.forEach(master => {

    const planned = Number(master.qty || 0);

    const actual = Number(master.actual_yield || 0);

    const addition =
      actual > planned
        ? actual - planned
        : 0;

    const totalPlanned = planned + addition;

    rows.push({
      process_order_no: master.id,

      material_code: master.finished_id || "",

      product:
        (master.item?.code ? master.item.code + " " : "") +
        (master.item?.item || ""),

      batch_no: master.batch_no || "",

      actual_yield: actual,

      planned_yield: planned,

      addition: addition,

      total_planned_yield: totalPlanned,

      wastage:
        totalPlanned > 0
          ? Number(
            (
              ((totalPlanned - actual) / totalPlanned) *
              100
            ).toFixed(2)
          )
          : 0,

      packaging: master.item?.packing_material_code || "",

      against: master.sale_ord_no
        ? `Against Sale Order No: ${master.sale_ord_no}`
        : "Against Sale Order",
    });

  });

  return rows;
}

async function getDigitalInvoiceReport(filters) {
  const where = {
    tran_code: 6, // Sale/Dispatch transaction code
    invoice_no: {
      not: null,
      notIn: ["", "null", "undefined"],
    },
    dated: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
  };

  const whereTransactions = {
    sub_tran_id: { in: [1, 2] },
  };

  // Optional item filter
  if (filters.item) {
    const itemId = parseInt(filters.item);
    whereTransactions.itcd = itemId;
    where.transactions = { some: { itcd: itemId } };
  }

  const transactions = await prisma.transactionsMaster.findMany({
    where,
    include: {
      acno: true,
      ordersSO: true,
      transactions: {
        where: whereTransactions,
        include: { itemDetails: true },
      },
    },
    orderBy: [{ check_date: "asc" }, { tran_id: "asc" }],
  });

  // Flatten: one row per transaction line item
  const rows = [];

  for (const t of transactions) {
    if (!t.invoice_no || !t.invoice_no.toString().trim()) continue;

    const formatYMD = (value) => {
      if (!value) return "";
      const d = new Date(value);
      if (isNaN(d.getTime())) return "";
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    const invoiceDateFormatted = formatYMD(t.check_date);
    const deliveryDateFormatted = formatYMD(t.dated); 

    // Group line items within the same invoice by item code/id and taxRate
    const lineMap = new Map();

    for (const line of t.transactions) {
      const itemCode = line.itemDetails?.code ?? line.itcd ?? "";
      const taxRate = line.st_rate ?? 0;
      const key = `${itemCode}_${taxRate}`;

      const grossAmt = line.camt ?? 0;
      const stAmt = (line.tax_amount != null && line.tax_amount > 0)
        ? line.tax_amount
        : line.st_rate
          ? (grossAmt * line.st_rate) / 100
          : (line.st_amount ?? 0);
      const furtherTax = (line.additional_tax_amount != null && line.additional_tax_amount > 0)
        ? line.additional_tax_amount
        : line.additional_tax
          ? (grossAmt * line.additional_tax) / 100
          : 0;
      const totalVal = grossAmt + stAmt + furtherTax;
      const qty = line.qty ?? 0;

      if (!lineMap.has(key)) {
        lineMap.set(key, {
          line,
          grossAmt,
          stAmt,
          furtherTax,
          totalVal,
          qty,
        });
      } else {
        const existing = lineMap.get(key);
        existing.grossAmt += grossAmt;
        existing.stAmt += stAmt;
        existing.furtherTax += furtherTax;
        existing.totalVal += totalVal;
        existing.qty += qty;
      }
    }

    for (const itemGroup of lineMap.values()) {
      const line = itemGroup.line;

      rows.push({
        // ── Hardcoded / Fixed seller fields ─────────────────────────────────
        Scenario: "SN001",
        sellerTransactionId: t.invoice_no,
        invoiceDate: invoiceDateFormatted,
        invoiceTypeId: "Sale Invoice",
        sellerCode: "00212",
        sellerBusinessName: "Siegwerk Pakistan Pvt Ltd",
        sellerAddress: "Suite No. 003 and 004, Plot No. C-43, Ground Floor, Block 4, Federal B Area, Karachi, Pakistan",
        sellerProvince: "Sindh",
        sellerNtnCnic: "4559581",

        // ── Fixed zeros ──────────────────────────────────────────────────────
        PONo: t.ordersSO?.sale_po ?? "",
        PODate: 0,
        DONo: t.dispatch_no ?? "",
        DeliveryDate: deliveryDateFormatted,

        // ── Dynamic buyer fields ─────────────────────────────────────────────
        buyerBusinessName: t.acno?.acname ?? "",
        buyerNtnCnic: t.acno?.ntnNo ?? "",
        buyerAddress: t.acno?.address?.trim() || t.acno?.customerBankAddr?.trim() || "",
        buyerProvince: t.acno?.country,
        buyerRegistrationType: t.acno?.tax_filing_status === "Filer" ? "Registered" : (t.acno?.tax_filing_status === "Non-Filer" || t.acno?.tax_filing_status === "NonFiler") ? "Unregistered" : (t.acno?.tax_filing_status ?? ""),

        // ── Dynamic product fields ───────────────────────────────────────────
        sellerItemCode: line.itemDetails?.code ?? "",
        hsCode: "3215.1110",
        productDescription: line.itemDetails?.item ?? "",
        Quantity: itemGroup.qty,
        UoM: line.itemDetails?.unit ?? line.unit ?? "",

        // ── Tax / amount fields ──────────────────────────────────────────────
        valueSalesExcludingST: itemGroup.grossAmt,
        taxRate: line.st_rate ?? 0,
        salesTaxApplicable: itemGroup.stAmt,
        furtherTax: itemGroup.furtherTax,

        // ── Fixed zeros ──────────────────────────────────────────────────────
        extraTax: 0,
        fedPayable: 0,
        totalValues: itemGroup.totalVal,
        discount: 0,
        salesTaxWithheldAtSource: 0,
        fixedNotifiedValueOrRetailPrice: 0,
        SpecialDiscount: 0,
        AdvanceTaxRate: 0,
        AdvanceTax: 0,

        // ── Hardcoded / Fixed ────────────────────────────────────────────────
        saleType: "Goods at standard rate (default)",
        sroScheduleNo: 0,
        sroItemSerialNo: 0,
        NoteTemplateName: 0,
      });
    }
  }

  return rows;
}

async function getILFileReport(filters) {
  // The principal's codes (Settings "distributorFileCodes", lib/reports/distributorFiles.js)
  const codes = await distributorFileCodes();

  const records = await prisma.transactions.findMany({
    where: {
      sub_tran_id: 1,
      transactionsMaster: {
        tran_code: 6,
        NOT: {
          OR: [
            { invoice_no: "" },
            { invoice_no: null },
          ],
        },
        ...(filters.dateFrom || filters.dateTo
          ? {
            dated: {
              ...(filters.dateFrom && { gte: filters.dateFrom }),
              ...(filters.dateTo && { lte: filters.dateTo }),
            },

          }
          : {}),
      },
    },
    include: {
      acnoDetails: true,
      itemDetails: true,
      transactionsMaster: {
        include: {
          acno: true
        }
      },
    },
    orderBy: {
      tran_id: "desc",
    },
  });
  const emptyRow = {
  };

  if (records.length === 0) {
    return [emptyRow];
  }

  const invoiceCounters = {};
  const soCounters = {};

  const rows = records.map((record) => {
    const master = record.transactionsMaster || {};
    const acnoDetails = record.acnoDetails || {};
    const itemDetails = record.itemDetails || {};

    const invoiceNo = master.invoice_no || "";
    const soNo = master.so_no || "";

    if (invoiceNo) {
      invoiceCounters[invoiceNo] =
        (invoiceCounters[invoiceNo] || 0) + 1;
    }

    if (soNo) {
      soCounters[soNo] =
        (soCounters[soNo] || 0) + 1;
    }

    return {
      invoice_line_number: invoiceNo
        ? invoiceCounters[invoiceNo]
        : "",

      invoice_number: invoiceNo || "",

      product_code:
        String(record.itcd || ""),

      adjustment: "",

      salesman_code: master.acno.salesArea,

      customer_code: master.pycd,


      transition_Currency_code: "PKR",
      local_currency_code: "PKR",

      invoice_date: master.dated
        ? new Date(master.dated)
          .toISOString()
          .split("T")[0]
        : "",

      quantity: Number(record.qty) || 0,

      sale_amount_transac:
        Number(record.camt) || 0,

      sale_amount_local:
        Number(record.camt) || 0,

      line_type_code: "PR",

      data_type: master.dated
        ? `AC${new Date(master.dated).getFullYear()}`
        : "",

      subsidiary_code: codes.subsidiaryCode,

      business_group_code: "FP",
      business_group_segment_code: "FP",

      business_unit_code: "CL",

      customer_order_number: soNo
        ? String(soNo)
        : "",

      customer_order_line_number: soNo
        ? soCounters[soNo]
        : "",

      document_number: master.dispatch_no,

      incoterm: "DAP",
      incoterm_location: "KHI",

      payment_terms: master.acno.crDays,
    };
  });

  return rows;
}

async function getMonthWiseRMMovingAverageReport(filters) {
  // Build start/end from monthFrom/yearFrom and monthTo/yearTo
  const monthFrom = parseInt(filters.monthFrom || (new Date().getMonth() - 5)) || 1;
  const yearFrom  = parseInt(filters.yearFrom)  || new Date().getFullYear();
  const monthTo   = parseInt(filters.monthTo)   || (new Date().getMonth() + 1);
  const yearTo    = parseInt(filters.yearTo)    || new Date().getFullYear();

  const start = new Date(yearFrom, monthFrom - 1, 1, 0, 0, 0, 0);       // first day of "from" month
  const end   = new Date(yearTo,   monthTo,       0, 23, 59, 59, 999);   // last day of "to" month


  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthsList = [];
  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    const y = current.getFullYear();
    const m = current.getMonth();
    const yearShort = String(y).slice(-2);
    monthsList.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: `${monthNames[m]}-${yearShort}`,
      year: y,
      month: m
    });
    current.setMonth(current.getMonth() + 1);
  }

  const where = {
    transactionsMaster: {
      tran_code: 7,
      dated: {
        gte: start,
        lte: end,
      },
    },
    itemDetails: {
      ic_id: 3,
    },
  };

  if (filters.item) {
    where.itcd = parseInt(filters.item);
  }

  const txs = await prisma.transactions.findMany({
    where,
    include: {
      transactionsMaster: {
        select: {
          dated: true,
        },
      },
      itemDetails: {
        select: {
          itcd: true,
          item: true,
          code: true,
        },
      },
    },
  });

  const itemsMap = {};

  txs.forEach((tx) => {
    const itcd = tx.itcd;
    if (!itcd) return;

    if (!itemsMap[itcd]) {
      itemsMap[itcd] = {
        itcd: itcd,
        item_code: tx.itemDetails?.code || "-",
        item_name: tx.itemDetails?.item || "Unknown",
        monthlyQty: {},
      };
      monthsList.forEach((m) => {
        itemsMap[itcd].monthlyQty[m.key] = 0;
      });
    }

    const date = new Date(tx.transactionsMaster.dated);
    const key = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, "0")}`;
    if (itemsMap[itcd].monthlyQty[key] !== undefined) {
      itemsMap[itcd].monthlyQty[key] += tx.qty || 0;
    }
  });

  const resultRows = Object.values(itemsMap).map((row) => {
    const newRow = {
      id: String(row.itcd),
      itcd: row.itcd,
      item_code: row.item_code,
      item_name: row.item_name,
    };

    let totalAbsolute = 0;
    monthsList.forEach((m) => {
      const val = row.monthlyQty[m.key] || 0;
      newRow[`abs_${m.key}`] = val;
      totalAbsolute += val;
    });
    newRow[`abs_total`] = totalAbsolute;

    let sumSoFar = 0;
    monthsList.forEach((m, idx) => {
      sumSoFar += row.monthlyQty[m.key] || 0;
      const avg = sumSoFar / (idx + 1);
      newRow[`avg_${m.key}`] = avg;
    });

    return newRow;
  });

  const dynamicColumns = [
    { field: "itcd", headerName: "Item Code ID", width: 15 },
    { field: "item_code", headerName: "Item Code", width: 15 },
    { field: "item_name", headerName: "Item Name", width: 40 },
  ];

  monthsList.forEach((m) => {
    dynamicColumns.push({
      field: `abs_${m.key}`,
      headerName: `${m.label}`,
      width: 15,
      type: "number",
    });
  });
  dynamicColumns.push({
    field: "abs_total",
    headerName: "TOTAL",
    width: 15,
    type: "number",
  });

  monthsList.forEach((m) => {
    dynamicColumns.push({
      field: `avg_${m.key}`,
      headerName: `${m.label} Avg`,
      width: 15,
      type: "number",
    });
  });

  return {
    rows: resultRows,
    columns: dynamicColumns,
  };
}

async function getPCFileReport(filters) {
  // The principal's codes (Settings "distributorFileCodes", lib/reports/distributorFiles.js)
  const codes = await distributorFileCodes();
  // Step 1: Get tran_ids from transactionsMaster where tran_code = 6
  const masterWhere = { tran_code: 6 };

  if (filters.dateFrom && filters.dateTo) {
    masterWhere.dated = { gte: filters.dateFrom, lte: filters.dateTo };
  } else if (filters.dateFrom) {
    masterWhere.dated = { gte: filters.dateFrom };
  } else if (filters.dateTo) {
    masterWhere.dated = { lte: filters.dateTo };
  }

  const masters = await prisma.transactionsMaster.findMany({
    where: masterWhere,
    select: {
      tran_id: true,
      dated: true,
      invoice_no: true,
      pycd: true,
      acno: {
        select: { acno: true, acname: true },
      },
    },
    orderBy: { dated: 'desc' },
  });

  const emptyRow = {
    invoice_line_number: "",
    invoice_number: "",
    product_code: "",
    customer_code: "",
    invoice_date: "",
    product_cost_budget: 0,
    product_cost_conv_budget: 0,
    product_material_cost_budget: 0,
    product_cost_standard: 0,
    product_conv_cost_standard: 0,
    product_material_cost_standard: 0,
    product_cost_actual: 0,
    product_conv_cost_actual: 0,
    product_material_cost_actual: 0,
    subsidiary_code: "",
  };

  if (masters.length === 0) {
    return [emptyRow];
  }

  const masterMap = {};
  masters.forEach((m) => { masterMap[m.tran_id] = m; });

  // Step 2: Get transaction lines for those tran_ids
  const records = await prisma.transactions.findMany({
    where: {
      tran_id: { in: masters.map((m) => m.tran_id) },
    },
    include: {
      itemDetails: {
        select: { itcd: true, item: true, code: true, price: true },
      },
    },
  });

  const rows = records.map((record) => {
    const master = masterMap[record.tran_id] || {};
    const item = record.itemDetails || {};
    const supplier = master.acno || {};

    const invoiceDate = master.dated
      ? new Date(master.dated).toISOString().split('T')[0]
      : "";

    const actualCost = Number(record.damt) || Number(record.camt) || 0;
    const qty = Number(record.qty) || 1;
    const rate = Number(record.rate) || 0;
    const standardPrice = Number(item.price) || 0;

    return {
      invoice_line_number: String(record.sub_tran_id || record.id || ""),
      invoice_number: master.invoice_no || "",
      product_code: item.code || (record.itcd ? String(record.itcd) : ""),
      customer_code: supplier.acno
        ? String(supplier.acno)
        : master.pycd
          ? String(master.pycd)
          : "",
      invoice_date: invoiceDate,
      product_cost_budget: 0,
      product_cost_conv_budget: 0,
      product_material_cost_budget: 0,
      product_cost_standard: standardPrice,
      product_conv_cost_standard: 0,
      product_material_cost_standard: standardPrice * qty,
      product_cost_actual: actualCost,
      product_conv_cost_actual: 0,
      product_material_cost_actual: rate * qty,
      subsidiary_code: "",
    };
  });

  if (rows.length === 0) {
    return [emptyRow];
  }

  return rows;
}

async function getPRFileReport(filters) {
  // The principal's codes (Settings "distributorFileCodes", lib/reports/distributorFiles.js)
  const codes = await distributorFileCodes();
  const emptyRow = {
    product_code: "",
    product_status: "",
    product_name: "",
    generic_product_code: "",
    packing_code: "",
    measure_unit_code: "",
    business_unit_code: "",
    product_line_code: "",
    product_family_code: "",
    product_type_code: "",
    product_series_code: "",
    product_line_name: "",
    product_family_name: "",
    product_type_name: "",
    product_series_name: "",
    product_color_code: "",
    product_class_code: "",
    product_class_name: "",
    free1: "",
    free2: "",
    free3: "",
    subsidiary_code: "",
    un_code: "",
    hazard_class: "",
    packaging_group: "",
    freezing_point: "",
    heat_sensitivity: "",
    standard_cost: 0,
    manufactured_locally: "",
    make_to_stock: "",
  };

  const items = await prisma.item.findMany({
    include: {
      itemCategories: true,
    },
    orderBy: {
      itcd: "asc",
    },
  });

  if (items.length === 0) {
    return [emptyRow];
  }

  const rows = items.map((item) => ({
    product_code: item.code || String(item.itcd || ""),

    product_status: item.discard
      ? "Inactive"
      : "Active",

    product_name: item.item || "",

    generic_product_code:
      item.sku ||
      (item.itcd
        ? String(item.itcd)
        : ""),

    packing_code: item.packing_material_code
      ? String(item.packing_material_code)
      : "1",
    measure_unit_code: item.unit || "KG",
    business_unit_code: item.business_unit || "CL",
    product_line_code: "NC",
    product_family_code: "NC",
    product_type_code: "NC",
    product_series_code: item.series || "NC",
    product_line_name: "NC",
    product_family_name: "NC",
    product_type_name: "NC",
    product_series_name: item.series || "NC",
    product_color_code: item.color || "NC",
    product_class_code: item.ic_id
      ? String(item.ic_id)
      : "NC",
    product_class_name:
      item.itemCategories?.name || "NC",
    free1: "",
    free2: "",
    free3: "",
    subsidiary_code: codes.subsidiaryCode,
    un_code: "",
    hazard_class: "",
    packaging_group: "",
    freezing_point: "",
    heat_sensitivity: "",
    standard_cost: Number(item.price) || 0,
    manufactured_locally: "",
    make_to_stock: "",
  }));

  return rows.length ? rows : [emptyRow];
}

async function getPurchasingFileReport(filters) {
  // The principal's codes (Settings "distributorFileCodes", lib/reports/distributorFiles.js)
  const codes = await distributorFileCodes();
  // Step 1: Get tran_ids from transactionsMaster where tran_code = 6
  const masterWhere = { tran_code: 6 };

  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setHours(0, 0, 0, 0))
    : undefined;

  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999))
    : undefined;

  const masters = await prisma.transactionsMaster.findMany({
    where: masterWhere,
    select: {
      tran_id: true,
      dated: true,
      invoice_no: true,
      pycd: true,
      rmk5: true,
      acno: {
        select: { acno: true, acname: true, category: true },
      },
    },
    orderBy: {
      dated: 'desc',
    }
  });

  const emptyRow = {
    site_order: "",
    period_start: "",
    period_end: "",
    local_raw_material_code: "",
    local_raw_material_description: "",
    local_supplier_code: "",
    local_supplier_description: "",
    purchased_qty_in_kilograms: 0,
    total_cost: 0,
    material_price_per_kilogram: 0,
    last_mat_price_per_kilogram: 0,
    currency_code_iso: "",
    incoterm: "",
    material_type: "",
    supplier_type: "",
  };

  if (masters.length === 0) {
    return [emptyRow];
  }

  const masterMap = {};
  masters.forEach((m) => { masterMap[m.tran_id] = m; });

  // Step 2: Get transactions for those tran_ids, including item and currency details
  const records = await prisma.transactions.findMany({
    where: {
      tran_id: { in: masters.map((m) => m.tran_id) },
    },
    include: {
      itemDetails: {
        select: { itcd: true, item: true, code: true, itemCategories: { select: { id: true } } },
      },
      currencyDetails: {
        select: { currency: true },
      },
    },
  });

  // Step 3: Collect all itcds to get the last purchase rate per item
  const itcdSet = new Set();
  records.forEach((r) => { if (r.itcd) itcdSet.add(r.itcd); });

  // Build a map of last purchase rate per itcd (latest dated purchase transaction)
  const lastRateMap = {};
  if (itcdSet.size > 0) {
    const lastPurchases = await prisma.transactions.findMany({
      where: {
        itcd: { in: [...itcdSet] },
        transactionsMaster: { tran_code: 6 },
        rate: { not: null },
      },
      select: { itcd: true, rate: true, tran_id: true },
      orderBy: { tran_id: 'desc' },
    });
    lastPurchases.forEach((lp) => {
      if (lp.itcd && !(lp.itcd in lastRateMap)) {
        lastRateMap[lp.itcd] = Number(lp.rate) || 0;
      }
    });
  }

  const rows = records.map((record) => {
    const master = masterMap[record.tran_id] || {};
    const item = record.itemDetails || {};
    const currency = record.currencyDetails || {};
    const supplier = master.acno || {};

    const datedObj = master.dated ? new Date(master.dated) : null;
    const dateStr = datedObj ? datedObj.toISOString().split('T')[0] : "";

    // Derive period start/end from dated (first and last day of that month)
    let periodStart = "";
    let periodEnd = "";
    if (datedObj) {
      const y = datedObj.getFullYear();
      const mo = datedObj.getMonth();
      periodStart = new Date(y, mo, 1).toISOString().split('T')[0];
      periodEnd = new Date(y, mo + 1, 0).toISOString().split('T')[0];
    }

    const qty = Number(record.qty) || 0;
    const rate = Number(record.rate) || 0;
    const totalCost = Number(record.damt) || (qty * rate);
    const lastRate = record.itcd ? (lastRateMap[record.itcd] ?? rate) : rate;

    return {
      // site_order: master.invoice_no || "",
      site_order: codes.subsidiaryCode,
      period_start: periodStart,
      period_end: periodEnd,
      local_raw_material_code: item.code || (record.itcd ? String(record.itcd) : ""),
      local_raw_material_description: item.item || "",
      local_supplier_code: supplier.acno ? String(supplier.acno) : (master.pycd ? String(master.pycd) : ""),
      local_supplier_description: supplier.acname || "",
      purchased_qty_in_kilograms: qty,
      total_cost: totalCost,
      material_price_per_kilogram: rate,
      last_mat_price_per_kilogram: lastRate,
      currency_code_iso: currency.currency || "PKR",
      incoterm: master.rmk5 || "DAP",
      material_type: "RM",
      supplier_type: codes.partyType,

      // currency_code_iso: currency.currency || "PKR",
      // incoterm: master.rmk5 || "DAP",
      // material_type: item.itemCategories ? String(item.itemCategories.id) : "RM",
      // supplier_type: supplier.category || "TP",
    };
  });

  if (rows.length === 0) {
    return [emptyRow];
  }

  return rows;
}

// Raw material opening stock and rate of a month, with the rate change on the
// month before. Opening stock is read through lib/openingStock.js (qty summed
// over every godown, rate per item) — never from MonthlyOpeningStock directly.
async function getRMCostingReport(filters = {}) {
  const now = new Date();
  const month = parseInt(filters.month) || now.getMonth() + 1;
  const year = parseInt(filters.year) || now.getFullYear();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const items = await prisma.item.findMany({
    where: { ic_id: RM_IC_ID, OR: [{ discard: false }, { discard: null }] },
    select: { itcd: true, item: true, code: true, unit: true },
    orderBy: { item: "asc" },
  });
  const itcds = items.map((i) => i.itcd);
  if (!itcds.length) return [];

  const [current, prevRates] = await Promise.all([
    getOpening(month, year, { itcds }),
    getOpeningRates(prevMonth, prevYear, { itcds }),
  ]);
  const currentMap = new Map(current.map((r) => [r.itcd, r]));

  return items.map((item) => {
    const row = currentMap.get(item.itcd) || null;
    const prevRate = prevRates.get(item.itcd)?.opening_rate ?? null;
    return {
      itcd: item.itcd,
      item_name: item.item,
      code: item.code || "",
      unit: item.unit || "",
      opening_qty: row?.opening_qty ?? null,
      opening_rate: row?.opening_rate ?? null,
      opening_value: row?.opening_value ?? null,
      rate_change_pct: pctChangeRM(row?.opening_rate ?? null, prevRate),
    };
  });
}

async function getWithHoldingTaxReport(filters) {
  const startDate = filters.dateFrom
    ? new Date(new Date(filters.dateFrom).setHours(0, 0, 0, 0))
    : undefined;

  const endDate = filters.dateTo
    ? new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999))
    : undefined;

  const transactions = await prisma.transactions.findMany({
    where: {
      sub_tran_id: { in: [1, 2] },
      transactionsMaster: {
        tran_code: 2,
        dated: {
          gte: filters.dateFrom ? startDate : undefined,
          lte: filters.dateTo ? endDate : undefined,
        },
      }
    },
    include: {
      acnoDetails: true,
      transactionsMaster: true
    },
    orderBy: [
      { tran_id: 'asc' },
      { narration5: 'asc' }
    ]
  });

  // Group by tran_id + narration5 (the shared line index)
  const grouped = new Map();

  for (const tr of transactions) {
    // key combines voucher id + the matching index from narration5
    const key = `${tr.tran_id}__${tr.narration5}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        master: tr.transactionsMaster,
        vendorName: "Unknown Vendor",
        ntnNo: "-",
        totalInvoiceAmount: 0,
        taxAmount: 0,
      });
    }

    const row = grouped.get(key);

    if (tr.sub_tran_id === 1) {
      row.vendorName = tr.acnoDetails?.acname || "Unknown Vendor";
      row.ntnNo = tr.acnoDetails?.ntnNo || "-";
      row.totalInvoiceAmount += Number(tr.damt || 0);
    } else if (tr.sub_tran_id === 2) {
      row.taxAmount += Number(tr.camt || 0);
    }
  }

  const reportRows = Array.from(grouped.values()).map((row, index) => ({
    sNo: index + 1,
    date: row.master?.dated
      ? format(row.master.dated, "dd-MM-yyyy")
      : "",
    vendorName: row.vendorName,
    ntnNo: row.ntnNo,
    totalInvoiceAmount: row.totalInvoiceAmount,
    taxAmount: row.taxAmount,
    chqAmount: row.totalInvoiceAmount - row.taxAmount,
  }));

  return reportRows;
}

function calculateDailyProductionSummary(rows) {
  const totalPlanned = rows.reduce((sum, row) => sum +
    Number(row.total_planned_yield || 0), 0);
  const totalActual =
    rows.reduce(
      (sum, row) =>
        sum +
        Number(row.actual_yield || 0),
      0
    );
  return {
    semiFinishProductivity:
      totalPlanned
        ? Number(
          (
            (totalActual / totalPlanned)
            *
            100
          ).toFixed(2)
        )
        : 0,
    finishedInkProductivity:
      totalPlanned
        ? Number(
          (
            (totalActual / totalPlanned)
            *
            100
          ).toFixed(2)
        )
        : 0,
    total_orders:
      rows.length,
    total_actual_yield:
      totalActual,
    total_planned_yield:
      totalPlanned
  };
}

function calculateMonthWiseRMMovingAverageSummary(data) {
  return {
    total_items: data.length,
    overall_total_consumption: data.reduce((sum, r) => sum + (r.abs_total || 0), 0),
  };
}

function calculateRMCostingSummary(data) {
  const withRate = data.filter((d) => d.opening_rate != null);
  const rates = withRate.map((d) => d.opening_rate);

  return {
    total_items: data.length,
    items_with_data: withRate.length,
    items_missing: data.length - withRate.length,
    total_value: Number(data.reduce((s, d) => s + (d.opening_value || 0), 0).toFixed(2)),
    avg_rate: rates.length ? Number((rates.reduce((s, v) => s + v, 0) / rates.length).toFixed(4)) : null,
    min_rate: rates.length ? Math.min(...rates) : null,
    max_rate: rates.length ? Math.max(...rates) : null,
  };
}

function pctChangeRM(curr, prev) {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
