import prisma from "@/lib/prisma";
import { getCustomerOverdueTotals } from "@/lib/reports/customerAging";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { scopedSalesPersons, parseSalesPersonList } from "@/lib/auth/salesScope";

/**
 * Sales Team MIS Report.
 *
 * Category (BAD-DEBTS / BAD-PAYMENTS / Official / Unofficial) is derived, not stored:
 *   customerStatus === 'BAD-DEBT'    -> 'BAD-DEBTS'
 *   customerStatus === 'BAD-PAYMENT' -> 'BAD-PAYMENTS'
 *   otherwise: ACNO.isActive true -> 'Official', false -> 'Unofficial' (the "dual book" flag)
 *
 * Target Qty / Target Recovery are user-entered per customer/month
 * (CustomerMonthlyTarget). Locked Target Recovery is system-calculated and
 * locked by the month-end snapshot job (utils/monthlySalesTeamSnapshot.js)
 * into the same table - not recomputed live here.
 *
 * Opening/Current Balance AND Opening/Current OverDue both come from
 * getCustomerOverdueTotals (lib/reports/customerAging.js), which mirrors the
 * Customer Aging Report's due-date logic. That helper's totalOutstanding
 * doubles as the AR balance - see the comment at its call site below for why
 * a separately-keyed balance query would be wrong for this schema.
 *
 * Actual Recovery = receipts/JVs knocked off (INVOICE_KNOCKOFF — the same
 * allocations Customer Aging nets invoices with) whose document is dated in
 * the period, against invoices that were already OVERDUE at the opening
 * (due date = invoice date + credit days, before the day before dateFrom —
 * the Opening OverDue rule). That is what Target Recovery is set against, so
 * Recovery % = Actual Recovery ÷ Target Recovery. Payments not yet knocked
 * off (auto knock-off runs on a schedule) are not counted until they are.
 */
export async function getSalesTeamMisReport(filters = {}) {
  const {
    dateFrom, dateTo, salesPersonIds,
    viewMode = "summary", viewBy = "bySalesPerson",
    session = null,
  } = filters;

  const periodStart = dateFrom ? new Date(dateFrom) : new Date();
  const periodEnd = dateTo ? new Date(dateTo) : new Date();
  const dated = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);

  // ── Who may see whose customers ─────────────────────────────────────────
  // lib/auth/salesScope.js: salesTeam.viewAll holders, ADMIN, ACCOUNTANT and
  // salesTeam.viewAll read the whole team; everyone else only the customers
  // assigned to them (ACNO.salesArea), whatever the filter asks for — it can
  // narrow that set but never widen it. No session (cron/internal) = all.
  const salesPersonFilter = session
    ? await scopedSalesPersons(session, salesPersonIds)
    : parseSalesPersonList(salesPersonIds);

  // 1. Customer set
  const customers = await prisma.aCNO.findMany({
    where: {
      macno: { in: await getCustomerMacnos() },
      ...(salesPersonFilter ? { salesArea: { in: salesPersonFilter } } : {}),
    },
    select: {
      acno: true,
      acname: true,
      crDays: true,
      customerStatus: true,
      reconStatus: true,
      reconciliationRemarks: true,
      isActive: true,
      salesArea: true,
    },
    orderBy: { acname: "asc" },
  });

  if (customers.length === 0) {
    return { data: [], summary: emptySummary() };
  }

  const acnoArray = customers.map((c) => c.acno);

  // 2/3. Opening/Current balance AND overdue both come from the same shared
  // helper used by the Customer Aging Report (getCustomerOverdueTotals).
  // Note: for Sale Invoices (tran_code=6) the customer is identified by
  // TRANSACTIONS_MASTER.pycd, NOT Transactions.acno (t.acno on those lines
  // is the revenue/stock GL account being credited, e.g. "SALES LOCAL") -
  // confirmed against real data. getCustomerOverdueTotals already follows
  // that convention (same as getCustomerAgingReport), so totalOutstanding
  // from it doubles as the customer's AR balance - a separate balance query
  // keyed on t.acno (the getAccountActivity pattern) would silently miss
  // every invoice and only capture receipts/JVs.
  const openingAsOf = new Date(periodStart);
  openingAsOf.setDate(openingAsOf.getDate() - 1); // strictly before dateFrom, matching the Opening Balance rule
  const [openingTotals, currentTotals] = await Promise.all([
    getCustomerOverdueTotals({ acnos: acnoArray, asOfDate: openingAsOf }),
    getCustomerOverdueTotals({ acnos: acnoArray, asOfDate: periodEnd }),
  ]);
  const openingByAcno = new Map(openingTotals.map((r) => [r.acno, r]));
  const currentByAcno = new Map(currentTotals.map((r) => [r.acno, r]));

  // 4. Monthly targets / locked actuals
  const targets = await prisma.customerMonthlyTarget.findMany({
    where: { acno: { in: acnoArray }, dated },
  });
  const targetByAcno = new Map(targets.map((t) => [t.acno, t]));

  // 4b. Dispatches (tran_code 6) in the period, per customer (TRANSACTIONS_MASTER.pycd):
  //     qty (KG) and sale amount (camt) on the item lines (sub_tran_id 1) only,
  //     so charge/tax rows are not counted twice.
  const dispFrom = new Date(periodStart);
  dispFrom.setHours(0, 0, 0, 0);
  const dispTo = new Date(periodEnd);
  dispTo.setHours(23, 59, 59, 999);
  const dispatchRows = await prisma.$queryRaw`
    SELECT tm.pycd::int AS acno,
           COALESCE(SUM(t.qty), 0)::float8  AS qty,
           COALESCE(SUM(t.camt), 0)::float8 AS amount
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    WHERE tm.tran_code = 6
      AND tm.pycd = ANY(${acnoArray}::int[])
      AND tm.dated >= ${dispFrom} AND tm.dated <= ${dispTo}
      AND COALESCE(t.sub_tran_id, 1) = 1
    GROUP BY tm.pycd
  `;
  const dispatchByAcno = new Map(dispatchRows.map((r) => [Number(r.acno), r]));

  // 4c. Actual Recovery — knock-offs dated in the period on invoices that
  //     were overdue at the opening (see header).
  const recoveryRows = await prisma.$queryRaw`
    SELECT k.invoice_party_acno::int AS acno,
           COALESCE(SUM(k.allocated_amount), 0)::float8 AS amount
    FROM "INVOICE_KNOCKOFF" k
    JOIN "TRANSACTIONS_MASTER" src ON src.tran_id = k.source_tran_id
    JOIN "TRANSACTIONS_MASTER" inv ON inv.tran_id = k.invoice_tran_id
    JOIN "acno" a ON a.acno = k.invoice_party_acno
    WHERE k.reversed_at IS NULL
      AND k.invoice_party_acno = ANY(${acnoArray}::int[])
      AND src.dated >= ${dispFrom} AND src.dated <= ${dispTo}
      AND (inv.dated::date + COALESCE(a.cr_days, 0)) < ${openingAsOf}::date
    GROUP BY k.invoice_party_acno
  `;
  const recoveryByAcno = new Map(recoveryRows.map((r) => [Number(r.acno), Number(r.amount) || 0]));

  // 5. Sales person names
  const salesPersonIdsInUse = [...new Set(customers.map((c) => c.salesArea).filter(Boolean))];
  const users = salesPersonIdsInUse.length
    ? await prisma.user.findMany({ where: { id: { in: salesPersonIdsInUse } }, select: { id: true, name: true } })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  // 6. Assemble per-customer rows
  const rows = customers.map((c) => {
    const opening = openingByAcno.get(c.acno);
    const current = currentByAcno.get(c.acno);
    const target = targetByAcno.get(c.acno);
    const disp = dispatchByAcno.get(c.acno);
    const dispatchKg = Number(disp?.qty) || 0;

    return {
      acno: c.acno,
      code: c.acno,
      customer: c.acname,
      terms: c.crDays ?? 0,
      customerStatus: c.customerStatus || "",
      reconStatus: c.reconStatus || "",
      reconciliationRemarks: c.reconciliationRemarks || "",
      // Target Qty / Target Recovery are user-entered
      targetQty: target?.targetQty ? Number(target.targetQty) : 0,
      targetRecovery: target?.targetRecovery ? Number(target.targetRecovery) : 0,
      actualRecovery: recoveryByAcno.get(c.acno) || 0,
      // Dispatched in the period (tran_code 6): KG, Ton and sale amount (camt)
      dispatchKg,
      dispatchTon: dispatchKg / 1000,
      saleAmount: Number(disp?.amount) || 0,
      // Locked Target Recovery is system-calculated + locked at month-end
      lockedTargetRecovery: target?.lockedAt ? Number(target.lockedTargetRecovery) || 0 : null,
      // The overdue balance frozen by the same month-end run. currentOverdue
      // below is the live figure and keeps moving as receipts land; this one
      // is what the month actually closed on. Null until the month is locked.
      lockedOverdue: target?.lockedAt ? Number(target.lockedOverdue) || 0 : null,
      isPending: !target?.lockedAt,
      openingBalance: opening?.totalOutstanding || 0,
      currentBalance: current?.totalOutstanding || 0,
      openingOverdue: opening?.overdueAmount || 0,
      currentOverdue: current?.overdueAmount || 0,
      category: deriveCategory(c),
      salesPersonId: c.salesArea || "",
      salesPersonName: (c.salesArea && userNameById.get(c.salesArea)) || "OPEN",
    };
  }).map(withRecoveryPct);

  if (viewMode === "detail") {
    return viewBy === "byCustomer"
      ? { data: buildCustomerWiseDetail(rows), summary: buildSummaryTotals(rows) }
      : { data: buildSalesPersonWiseDetail(rows), summary: buildSummaryTotals(rows) };
  }

  return viewBy === "byCustomer"
    ? { data: buildCustomerSummaryRows(rows), summary: buildSummaryTotals(rows) }
    : { data: buildSummaryRows(rows), summary: buildSummaryTotals(rows) };
}

/**
 * Category IS the customer's status — it is stored, not inferred.
 *
 * This used to test for "BAD-DEBT" and "BAD-PAYMENT". The column actually
 * holds the plural "BAD-DEBTS" and "BAD-PAYMENTS", so neither test ever
 * matched: all 87 flagged customers fell through to the isActive fallback and
 * were reported as ordinary Official/Unofficial. The two bad-debt categories never
 * appeared in the report at all.
 *
 * The stored status is now used as-is, and isActive is only a fallback for
 * the handful of accounts that have no status recorded. Singular spellings
 * are still accepted so older data does not silently mis-file again.
 */
const CATEGORY_ALIASES = {
  "BAD-DEBT": "BAD-DEBTS",
  "BAD DEBT": "BAD-DEBTS",
  "BAD-DEBTS": "BAD-DEBTS",
  "BAD-PAYMENT": "BAD-PAYMENTS",
  "BAD PAYMENT": "BAD-PAYMENTS",
  "BAD-PAYMENTS": "BAD-PAYMENTS",
};

export function deriveCategory(c) {
  const status = (c.customerStatus || "").trim().toUpperCase();
  if (!status) return c.isActive ? "Official" : "Unofficial";
  return CATEGORY_ALIASES[status] || status;
}

const SUM_FIELDS = [
  "targetQty", "dispatchTon", "dispatchKg", "saleAmount",
  "targetRecovery", "actualRecovery", "lockedTargetRecovery", "lockedOverdue",
  "openingBalance", "currentBalance", "openingOverdue", "currentOverdue",
];

/**
 * Recovery % = Actual Recovery ÷ Target Recovery, as text ("85.3%") so a row
 * with no target shows blank rather than 0. Totals get it from their summed
 * figures, never by adding percentages.
 */
function withRecoveryPct(r) {
  const target = Number(r.targetRecovery) || 0;
  return {
    ...r,
    recoveryPct: target > 0 ? `${(((Number(r.actualRecovery) || 0) / target) * 100).toFixed(1)}%` : "",
  };
}

function sumRows(list, fields = SUM_FIELDS) {
  const totals = {};
  fields.forEach((f) => {
    totals[f] = list.reduce((sum, r) => sum + (Number(r[f]) || 0), 0);
  });
  totals.customerCount = list.length;
  return withRecoveryPct(totals);
}

function emptySummary() {
  return sumRows([]);
}

function buildSummaryTotals(rows) {
  return sumRows(rows);
}

// Flat: one row per (Sales Person x Category), matching SALESTEAM_MIS_SUMMARY.pdf
function buildSummaryRows(rows) {
  const groups = new Map();
  rows.forEach((r) => {
    const key = `${r.salesPersonName}||${r.category}`;
    if (!groups.has(key)) groups.set(key, { salesPersonName: r.salesPersonName, category: r.category, rows: [] });
    groups.get(key).rows.push(r);
  });

  const out = [...groups.values()]
    .sort((a, b) => a.salesPersonName.localeCompare(b.salesPersonName) || a.category.localeCompare(b.category))
    .map((g) => ({ salesPersonName: g.salesPersonName, category: g.category, ...sumRows(g.rows) }));

  out.push({ salesPersonName: "Grand Total", category: "", ...sumRows(rows) });
  return out;
}

// Flat: one row per customer, then a Grand Total row (summary + Customer wise)
function buildCustomerSummaryRows(rows) {
  const out = [...rows].sort((a, b) => (a.customer || "").localeCompare(b.customer || ""));
  out.push({ code: "", customer: "Grand Total", salesPersonName: "", category: "", ...sumRows(rows) });
  return out;
}

// Hierarchical: Sales Person -> Category -> Customer, with subtotal rows, matching SALESTEAM_MIS_DETAIL.pdf
function buildSalesPersonWiseDetail(rows) {
  const bySalesPerson = new Map();
  rows.forEach((r) => {
    if (!bySalesPerson.has(r.salesPersonName)) bySalesPerson.set(r.salesPersonName, []);
    bySalesPerson.get(r.salesPersonName).push(r);
  });

  const out = [];
  [...bySalesPerson.keys()].sort((a, b) => a.localeCompare(b)).forEach((spName) => {
    const spRows = bySalesPerson.get(spName);
    out.push({ row_type: "salesperson_header", salesPersonName: spName, ...sumRows(spRows) });

    const byCategory = new Map();
    spRows.forEach((r) => {
      if (!byCategory.has(r.category)) byCategory.set(r.category, []);
      byCategory.get(r.category).push(r);
    });

    [...byCategory.keys()].sort().forEach((cat) => {
      const catRows = byCategory.get(cat);
      out.push({ row_type: "category_header", category: cat });
      catRows.forEach((r) => out.push({ row_type: "customer_row", ...r }));
      out.push({ row_type: "category_total", category: cat, ...sumRows(catRows) });
    });

    out.push({ row_type: "salesperson_total", salesPersonName: spName, ...sumRows(spRows) });
  });

  return out;
}

// Flat customer list, sales person + category as plain columns, no grouping
function buildCustomerWiseDetail(rows) {
  return [...rows]
    .sort((a, b) => (a.customer || "").localeCompare(b.customer || ""))
    .map((r) => ({ row_type: "customer_row", ...r }));
}
