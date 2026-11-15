import prisma from "@/lib/prisma";
import {
  getFundMacnos,
  fundMacnosSql,
  fundTranCodesSql,
  debitSql,
  creditSql,
  toNumber,
  getDateRange,
} from "@/lib/reports/fundsCommon";
import { sortByAccountOrder } from "@/lib/reports/accountOrder";

export { getFundMacnos };

/* ============================================================================
   FUNDS POSITION
   ============================================================================

   One row per fund account (bank / cash / director I.O.U.), grouped by
   control account.

   The figures are the account's own ledger, read with the same rule as the
   Account Ledger and Trial Balance (see lib/reports/fundsCommon.js):

     Receipts = debits to the fund account in the period  (money in)
     Payments = credits to the fund account in the period (money out)
     Opening  = SUM(debit - credit) strictly before dateFrom
     Closing  = Opening + Receipts - Payments
              = Trial Balance closing (debit balance) of that account

============================================================================ */

// options.accountOrder = the user's saved account order (lib/reports/accountOrder.js);
// it only reorders accounts inside their control account.
export async function getFundsPositionReport(filters = {}, { accountOrder = [] } = {}) {
  const { from, to } = getDateRange(filters);
  const funds = await fundMacnosSql();

  const rows = await prisma.$queryRaw`
    WITH lines AS (
      SELECT
        a.acno,
        a.acname,
        a.macno,
        m.macname,
        (tm.dated < ${from}::date) AS is_opening,
        ${debitSql}  AS dr,
        ${creditSql} AS cr
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      JOIN "acno"  a ON a.acno  = t.acno
      JOIN "MACNO" m ON m.macno = a.macno
      WHERE a.macno IN (${funds})
        AND tm.tran_code IN (${fundTranCodesSql()})
        AND tm.dated <= ${to}::date
    )
    SELECT
      acno,
      acname,
      macno,
      macname,
      COALESCE(SUM(CASE WHEN is_opening THEN dr - cr ELSE 0 END), 0)::float8 AS opening,
      COALESCE(SUM(CASE WHEN is_opening THEN 0 ELSE dr END), 0)::float8      AS receipts,
      COALESCE(SUM(CASE WHEN is_opening THEN 0 ELSE cr END), 0)::float8      AS payments
    FROM lines
    GROUP BY acno, acname, macno, macname
    ORDER BY macno, acno
  `;

  const showZero =
    filters.showZeroBalance === true ||
    filters.showZeroBalance === "true";

  const groups = new Map();

  for (const row of rows) {
    const opening = toNumber(row.opening);
    const receipts = toNumber(row.receipts);
    const payments = toNumber(row.payments);
    const closing = opening + receipts - payments;

    if (!showZero && opening === 0 && receipts === 0 && payments === 0) {
      continue;
    }

    const macno = toNumber(row.macno);

    if (!groups.has(macno)) {
      groups.set(macno, {
        macno,
        macname: row.macname,
        accounts: [],
        opening: 0,
        receipts: 0,
        payments: 0,
        closing: 0,
      });
    }

    const group = groups.get(macno);

    group.accounts.push({
      acno: toNumber(row.acno),
      acname: row.acname,
      account: `${String(row.acno).padStart(4, "0")} ${row.acname}`,
      opening,
      receipts,
      payments,
      closing,
    });

    group.opening += opening;
    group.receipts += receipts;
    group.payments += payments;
    group.closing += closing;
  }

  const data = [];
  const totals = { opening: 0, receipts: 0, payments: 0, closing: 0 };

  for (const group of groups.values()) {
    data.push({
      row_type: "control_header",
      macno: group.macno,
      label: `${String(group.macno).padStart(4, "0")} ${group.macname}`,
    });

    for (const account of sortByAccountOrder(group.accounts, accountOrder)) {
      data.push({ row_type: "account_row", ...account });
    }

    data.push({
      row_type: "control_total",
      label: "Control Account Total:",
      opening: group.opening,
      receipts: group.receipts,
      payments: group.payments,
      closing: group.closing,
    });

    totals.opening += group.opening;
    totals.receipts += group.receipts;
    totals.payments += group.payments;
    totals.closing += group.closing;
  }

  data.push({
    row_type: "grand_total",
    label: "Total:",
    opening: totals.opening,
    receipts: totals.receipts,
    payments: totals.payments,
    closing: totals.closing,
  });

  return {
    data,
    summary: {
      openingFunds: totals.opening,
      totalReceipts: totals.receipts,
      totalPayments: totals.payments,
      closingFunds: totals.closing,
    },
  };
}
