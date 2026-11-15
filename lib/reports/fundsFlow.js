import prisma from "@/lib/prisma";
import {
  fundMacnosSql,
  fundTranCodesSql,
  debitSql,
  creditSql,
  toNumber,
  getDateRange,
} from "@/lib/reports/fundsCommon";
import { sortByAccountOrder } from "@/lib/reports/accountOrder";

/* ============================================================================
   FUNDS FLOW
   ============================================================================

   Opening funds
   + Funds received   (credits to the non-fund side of fund vouchers)
   - Funds disbursed  (debits  to the non-fund side of fund vouchers)
   = Closing funds

   Fund accounts and their Dr/Cr are read exactly like the Account Ledger /
   Trial Balance (lib/reports/fundsCommon.js), so opening and closing here
   equal the Trial Balance balance of the fund control accounts.

   A "fund voucher" is any voucher that has at least one line on a fund
   account (Transactions.acno, not MASTER.pycd). Its contra lines are the
   non-fund lines of the same voucher:

     contra credit = money came into the funds  (received)
     contra debit  = money went out of the funds (disbursed)

   Fund-to-fund transfers have no non-fund line, so they net to zero — as
   they should, since total funds do not change.

============================================================================ */

// options.accountOrder = the user's saved account order (lib/reports/accountOrder.js);
// it only reorders accounts inside their control-account group.
export async function getFundsFlowReport(filters = {}, { accountOrder = [] } = {}) {
  const { from, to } = getDateRange(filters);

  const funds = await fundMacnosSql();
  const tranCodes = fundTranCodesSql();

  const [openingRows, movementRows] = await Promise.all([
    /* OPENING FUNDS = ledger balance (Dr - Cr) of every fund account before dateFrom */
    prisma.$queryRaw`
      SELECT COALESCE(SUM(${debitSql} - ${creditSql}), 0)::float8 AS opening
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      JOIN "acno" a ON a.acno = t.acno
      WHERE a.macno IN (${funds})
        AND tm.tran_code IN (${tranCodes})
        AND tm.dated < ${from}::date
    `,

    /* PERIOD FLOW = non-fund lines of vouchers that touch a fund account */
    prisma.$queryRaw`
      WITH fund_vouchers AS (
        SELECT DISTINCT t.tran_id
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        JOIN "acno" a ON a.acno = t.acno
        WHERE a.macno IN (${funds})
          AND tm.tran_code IN (${tranCodes})
          AND tm.dated >= ${from}::date
          AND tm.dated <= ${to}::date
      )
      SELECT
        contra_acno.acno,
        contra_acno.acname,
        contra_acno.macno,
        contra_mac.macname,
        COALESCE(SUM(${debitSql}),  0)::float8 AS total_damt,
        COALESCE(SUM(${creditSql}), 0)::float8 AS total_camt
      FROM "Transactions" t
      JOIN fund_vouchers fv ON fv.tran_id = t.tran_id
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      JOIN "acno"  contra_acno ON contra_acno.acno  = t.acno
      JOIN "MACNO" contra_mac  ON contra_mac.macno  = contra_acno.macno
      WHERE contra_acno.macno NOT IN (${funds})
      GROUP BY contra_acno.acno, contra_acno.acname, contra_acno.macno, contra_mac.macname
      HAVING COALESCE(SUM(${debitSql}), 0) <> 0
          OR COALESCE(SUM(${creditSql}), 0) <> 0
      ORDER BY contra_acno.macno, contra_acno.acno
    `,
  ]);

  const opening = toNumber(
    openingRows?.[0]?.opening
  );

  /* ==========================================================================
     BUILD RECEIVED / DISBURSED DIRECTLY FROM CAMT / DAMT

     IMPORTANT:

        CAMT = RECEIVED
        DAMT = DISBURSED

     We DO NOT infer this from net.
  ========================================================================== */

  const received = [];
  const disbursed = [];

  for (const row of movementRows) {
    const totalDamt = toNumber(row.total_damt);
    const totalCamt = toNumber(row.total_camt);

    if (totalCamt !== 0) {
      received.push({
        ...row,
        amount: totalCamt,
      });
    }

    if (totalDamt !== 0) {
      disbursed.push({
        ...row,
        amount: totalDamt,
      });
    }
  }

  /* ==========================================================================
     GROUP BY CONTROL ACCOUNT
  ========================================================================== */

  const buildGroups = (rows) => {
    const groups = new Map();

    for (const row of rows) {
      const macno = toNumber(row.macno);
      const amount = toNumber(row.amount);

      if (!groups.has(macno)) {
        groups.set(macno, {
          macno,
          macname: row.macname,
          lines: [],
          total: 0,
        });
      }

      const group = groups.get(macno);

      group.lines.push({
        acno: toNumber(row.acno),
        acname: row.acname,
        amount,
      });

      group.total += amount;
    }

    const out = [...groups.values()];
    for (const group of out) group.lines = sortByAccountOrder(group.lines, accountOrder);
    return out;
  };

  const receivedGroups = buildGroups(received);
  const disbursedGroups = buildGroups(disbursed);

  const data = [];

  let totalReceived = 0;
  let totalDisbursed = 0;

  /* ==========================================================================
     OPENING FUNDS
  ========================================================================== */

  data.push({
    row_type: "section_header",
    label: "OPENING FUNDS IN HAND",
    amount: opening,
  });

  /* ==========================================================================
     FUNDS RECEIVED
  ========================================================================== */

  data.push({
    row_type: "section_header",
    label: "FUNDS RECEIVED",
  });

  for (const group of receivedGroups) {
    data.push({
      row_type: "group_header",
      code: String(group.macno),
      label: group.macname,
    });

    for (const line of group.lines) {
      data.push({
        row_type: "detail_row",
        code: String(line.acno),
        label: line.acname,
        amount: line.amount,
      });
    }

    data.push({
      row_type: "group_total",
      label: `Total: ${group.macname}`,
      amount: group.total,
    });

    totalReceived += group.total;
  }

  data.push({
    row_type: "section_total",
    label: "Total: FUNDS RECEIVED",
    amount: totalReceived,
  });

  /* ==========================================================================
     FUNDS DISBURSED
  ========================================================================== */

  data.push({
    row_type: "section_header",
    label: "FUNDS DISBURSED",
  });

  for (const group of disbursedGroups) {
    data.push({
      row_type: "group_header",
      code: String(group.macno),
      label: group.macname,
    });

    for (const line of group.lines) {
      data.push({
        row_type: "detail_row",
        code: String(line.acno),
        label: line.acname,

        /* Print disbursements as negative */
        amount: line.amount,
      });
    }

    data.push({
      row_type: "group_total",
      label: `Total: ${group.macname}`,

      /* Print disbursements as negative */
      amount: group.total,
    });

    totalDisbursed += group.total;
  }

  data.push({
    row_type: "section_total",
    label: "Total: FUNDS DISBURSED",

    /* Print disbursements as negative */
    amount: totalDisbursed,
  });

  /* ==========================================================================
     CLOSING FUNDS
  ========================================================================== */

  const closing =
    opening +
    totalReceived -
    totalDisbursed;

  data.push({
    row_type: "closing_row",
    label: "CLOSING FUNDS IN HAND",
    amount: closing,
  });

  return {
    data,

    summary: {
      openingFunds: opening,
      fundsReceived: totalReceived,
      fundsDisbursed: totalDisbursed,
      closingFunds: closing,
    },
  };
}