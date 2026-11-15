import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";


/**
 * Per-customer receivable position as at a date.
 *
 * Returns, for each acno asked for:
 *   totalOutstanding — the AR balance (foots to the account ledger)
 *   currentAmount    — the part not yet past the customer's credit terms
 *   overdueAmount    — the rest
 *
 * This mirrors getCustomerAgingReport exactly, and it has to: the Sales Team
 * MIS shows these beside the aging report and they must agree.
 *
 * It previously did NOT. Invoices were keyed by invoice_no, and receipts were
 * summed per (invoice_no, customer) — but an invoice number is not unique per
 * customer (the series restarts every 1 July, and duplicate postings exist),
 * so where a number appeared on several documents the same receipt was
 * subtracted from every one of them. Against live data that returned
 * -389,303,300 outstanding where the aging report showed +724,957,755, with
 * 115 of 272 customers reporting a negative balance.
 *
 * Three things fix it, the same three the aging report relies on:
 *   1. An invoice is one DOCUMENT (tran_id), never a number.
 *   2. Settlements come from INVOICE_KNOCKOFF, which resolves a receipt to a
 *      specific invoice_tran_id.
 *   3. Anything on the ledger that is not on an invoice — unapplied receipts,
 *      opening JVs, payments — is added back as a per-customer residual, so
 *      the total foots to the ledger. It ages as current.
 */
export async function getCustomerOverdueTotals({ acnos, asOfDate }) {
  if (!acnos || acnos.length === 0) return [];
  const customerMacnos = await getCustomerMacnos();
  if (!customerMacnos.length) return [];

  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  asOf.setHours(23, 59, 59, 999);
  const acnoArray = acnos.map((a) => Number(a));

  const rows = await prisma.$queryRaw`
    WITH customer_info AS (
      SELECT DISTINCT a.acno, a.cr_days
      FROM "acno" a
      WHERE a.macno IN (${Prisma.join(customerMacnos)})
        AND a.acno = ANY(${acnoArray}::int[])
    ),

    /* Ledger balance per customer — the Dr/Cr rules of getAccountLedger. */
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
        AND tm.dated <= ${asOf}::date
      GROUP BY t.acno
    ),

    /* One row per invoice DOCUMENT. */
    invoice_lines AS (
      SELECT
        tm.tran_id,
        tm.invoice_no,
        tm.dated,
        tm.pycd AS customer_code,
        SUM(COALESCE(t.damt, 0)) AS invoice_amount
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t ON t.tran_id = tm.tran_id AND t.acno = tm.pycd
      INNER JOIN customer_info ci ON ci.acno = tm.pycd
      WHERE tm.tran_code = 6 AND tm.dated <= ${asOf}::date
      GROUP BY tm.tran_id, tm.invoice_no, tm.dated, tm.pycd

      UNION ALL

      /* A JV debit already allocated onto an invoice is a settlement, not a
         new receivable — it nets through knockoff_settlements instead. */
      SELECT
        tm.tran_id, t.invoice_no, tm.dated, t.acno,
        SUM(COALESCE(t.damt, 0))
      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      INNER JOIN customer_info ci ON ci.acno = t.acno
      WHERE tm.tran_code = 3
        AND tm.dated <= ${asOf}::date
        AND t.invoice_no IS NOT NULL AND t.invoice_no <> ''
        AND COALESCE(t.damt, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "INVOICE_KNOCKOFF" k
          WHERE k.source_line_id = t.id AND k.reversed_at IS NULL
        )
      GROUP BY tm.tran_id, t.invoice_no, tm.dated, t.acno
    ),

    knockoff_settlements AS (
      SELECT k.invoice_tran_id AS tran_id, SUM(k.allocated_amount) AS amt
      FROM "INVOICE_KNOCKOFF" k
      INNER JOIN "TRANSACTIONS_MASTER" src ON src.tran_id = k.source_tran_id
      WHERE k.reversed_at IS NULL
        AND k.invoice_tran_id IS NOT NULL
        AND src.dated <= ${asOf}::date
      GROUP BY k.invoice_tran_id
    ),

    /* Sale returns are not auto-matched but always name the invoice; where a
       number is shared, the earliest document takes it. */
    return_settlements AS (
      SELECT il.tran_id, SUM(COALESCE(t.camt, 0)) AS amt
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t ON t.tran_id = tm.tran_id AND t.acno = tm.pycd
      CROSS JOIN LATERAL (
        SELECT il.tran_id
        FROM invoice_lines il
        WHERE il.customer_code = tm.pycd AND il.invoice_no = tm.invoice_no
        ORDER BY il.dated, il.tran_id
        LIMIT 1
      ) il
      WHERE tm.tran_code = 10
        AND tm.dated <= ${asOf}::date
        AND tm.invoice_no IS NOT NULL AND tm.invoice_no <> ''
      GROUP BY il.tran_id
    ),

    invoice_outstanding AS (
      SELECT
        il.customer_code,
        il.invoice_amount - COALESCE(ks.amt, 0) - COALESCE(rs.amt, 0) AS outstanding_amount,
        EXTRACT(
          DAY FROM (${asOf}::date - (il.dated + (COALESCE(ci.cr_days, 0) * INTERVAL '1 day')))
        ) AS days_outstanding
      FROM invoice_lines il
      INNER JOIN customer_info ci        ON ci.acno    = il.customer_code
      LEFT  JOIN knockoff_settlements ks ON ks.tran_id = il.tran_id
      LEFT  JOIN return_settlements   rs ON rs.tran_id = il.tran_id
    ),

    per_customer AS (
      SELECT
        customer_code,
        COALESCE(SUM(outstanding_amount), 0) AS invoiced_outstanding,
        COALESCE(SUM(CASE WHEN days_outstanding <= 0 THEN outstanding_amount ELSE 0 END), 0) AS invoiced_current
      FROM invoice_outstanding
      WHERE ABS(outstanding_amount) >= 0.005
      GROUP BY customer_code
    )

    /* Ledger balance is the truth; the residual is whatever is not on an
       invoice, and it ages as current. */
    SELECT
      lb.customer_code AS acno,
      lb.balance::float8 AS total_outstanding,
      (
        COALESCE(pc.invoiced_current, 0)
        + (lb.balance - COALESCE(pc.invoiced_outstanding, 0))
      )::float8 AS current_amount
    FROM ledger_balance lb
    LEFT JOIN per_customer pc ON pc.customer_code = lb.customer_code
  `;

  return rows.map((r) => {
    const totalOutstanding = Number(r.total_outstanding) || 0;
    const currentAmount = Number(r.current_amount) || 0;
    return {
      acno: Number(r.acno),
      totalOutstanding,
      currentAmount,
      overdueAmount: totalOutstanding - currentAmount,
    };
  });
}

// ============================================================
// Receivables as SQL — for the BI Receivables dataset (lib/bi/datasets.js).
//
// receivableCtes(asOf, acnoArray, customerMacnos) — the receivable CTEs:
//   customer_info, ledger_balance, invoice_lines, knockoff_settlements,
//   return_settlements, invoice_outstanding (one row per open invoice
//   document, with its days past due). acnoArray = null → every customer.
//   customerMacnos: await getCustomerMacnos() (Finance → Account Settings);
//   an empty list matches no customer.
// customerAgingRowsSql(asOfDate) — async; one row per (customer, aging bucket).
//
// Same rules as getCustomerOverdueTotals above, with two refinements the
// bucket split needs: knock-offs are keyed on (invoice document, party) — one
// JV can raise invoices for several customers — and unapplied credit (a
// negative ledger residual) is used up on the OLDEST overdue bucket first, so
// overdue never exceeds what the customer owes.
// getCustomerOverdueTotals is unchanged and does not use these.
// ============================================================

export function receivableCtes(asOf, acnoArray = null, customerMacnos = []) {
  return Prisma.sql`
    WITH customer_info AS (
      SELECT DISTINCT a.acno, a.cr_days
      FROM "acno" a
      WHERE a.macno IN (${Prisma.join(customerMacnos.length ? customerMacnos : [null])})
        ${acnoArray ? Prisma.sql`AND a.acno = ANY(${acnoArray}::int[])` : Prisma.empty}
    ),

    /* Ledger balance per customer — the Dr/Cr rules of getAccountLedger. */
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
        AND tm.dated <= ${asOf}::date
      GROUP BY t.acno
    ),

    /* One row per invoice DOCUMENT. */
    invoice_lines AS (
      SELECT
        tm.tran_id,
        tm.invoice_no,
        tm.dated,
        tm.pycd AS customer_code,
        SUM(COALESCE(t.damt, 0)) AS invoice_amount
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t ON t.tran_id = tm.tran_id AND t.acno = tm.pycd
      INNER JOIN customer_info ci ON ci.acno = tm.pycd
      WHERE tm.tran_code = 6 AND tm.dated <= ${asOf}::date
      GROUP BY tm.tran_id, tm.invoice_no, tm.dated, tm.pycd

      UNION ALL

      /* A JV debit already allocated onto an invoice is a settlement, not a
         new receivable — it nets through knockoff_settlements instead. */
      SELECT
        tm.tran_id, t.invoice_no, tm.dated, t.acno,
        SUM(COALESCE(t.damt, 0))
      FROM "Transactions" t
      INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      INNER JOIN customer_info ci ON ci.acno = t.acno
      WHERE tm.tran_code = 3
        AND tm.dated <= ${asOf}::date
        AND t.invoice_no IS NOT NULL AND t.invoice_no <> ''
        AND COALESCE(t.damt, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "INVOICE_KNOCKOFF" k
          WHERE k.source_line_id = t.id AND k.reversed_at IS NULL
        )
      GROUP BY tm.tran_id, t.invoice_no, tm.dated, t.acno
    ),

    /* Keyed on (document, party): one JV can raise invoices for several
       customers, and each only takes the settlements made against it. */
    knockoff_settlements AS (
      SELECT k.invoice_tran_id AS tran_id, k.invoice_party_acno AS customer_code, SUM(k.allocated_amount) AS amt
      FROM "INVOICE_KNOCKOFF" k
      INNER JOIN "TRANSACTIONS_MASTER" src ON src.tran_id = k.source_tran_id
      WHERE k.reversed_at IS NULL
        AND k.invoice_tran_id IS NOT NULL
        AND src.dated <= ${asOf}::date
      GROUP BY k.invoice_tran_id, k.invoice_party_acno
    ),

    /* Sale returns are not auto-matched but always name the invoice; where a
       number is shared, the earliest document takes it. */
    return_settlements AS (
      SELECT il.tran_id, SUM(COALESCE(t.camt, 0)) AS amt
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t ON t.tran_id = tm.tran_id AND t.acno = tm.pycd
      CROSS JOIN LATERAL (
        SELECT il.tran_id
        FROM invoice_lines il
        WHERE il.customer_code = tm.pycd AND il.invoice_no = tm.invoice_no
        ORDER BY il.dated, il.tran_id
        LIMIT 1
      ) il
      WHERE tm.tran_code = 10
        AND tm.dated <= ${asOf}::date
        AND tm.invoice_no IS NOT NULL AND tm.invoice_no <> ''
      GROUP BY il.tran_id
    ),

    invoice_outstanding AS (
      SELECT
        il.customer_code,
        il.invoice_amount - COALESCE(ks.amt, 0) - COALESCE(rs.amt, 0) AS outstanding_amount,
        EXTRACT(
          DAY FROM (${asOf}::date - (il.dated + (COALESCE(ci.cr_days, 0) * INTERVAL '1 day')))
        ) AS days_outstanding
      FROM invoice_lines il
      INNER JOIN customer_info ci        ON ci.acno    = il.customer_code
      LEFT  JOIN knockoff_settlements ks ON ks.tran_id = il.tran_id AND ks.customer_code = il.customer_code
      LEFT  JOIN return_settlements   rs ON rs.tran_id = il.tran_id
    )
`;
}

/**
 * One row per (customer, aging bucket) as at a date — the same numbers as
 * getCustomerOverdueTotals, split by how far past the credit terms they are.
 * The ledger residual (unapplied receipts, opening JVs …) ages as Current;
 * when it is a credit it is first used up on the oldest overdue buckets.
 * Columns: customer_id, bucket, bucket_order, amount.
 */
export async function customerAgingRowsSql(asOfDate) {
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  asOf.setHours(23, 59, 59, 999);
  const customerMacnos = await getCustomerMacnos();
  return Prisma.sql`
    ${receivableCtes(asOf, null, customerMacnos)},
    bucketed AS (
      SELECT customer_code,
        CASE
          WHEN days_outstanding <= 0  THEN 'Current'
          WHEN days_outstanding <= 30 THEN '1-30 days'
          WHEN days_outstanding <= 60 THEN '31-60 days'
          WHEN days_outstanding <= 90 THEN '61-90 days'
          ELSE '90+ days'
        END AS bucket,
        outstanding_amount AS amount
      FROM invoice_outstanding
      WHERE ABS(outstanding_amount) >= 0.005
    ),
    per_bucket AS (
      SELECT customer_code, bucket,
             CASE bucket WHEN 'Current' THEN 0 WHEN '1-30 days' THEN 1 WHEN '31-60 days' THEN 2 WHEN '61-90 days' THEN 3 ELSE 4 END AS bucket_order,
             SUM(amount) AS amount
      FROM bucketed
      GROUP BY customer_code, bucket
    ),
    residual AS (
      SELECT lb.customer_code,
             lb.balance - COALESCE((SELECT SUM(pb.amount) FROM per_bucket pb WHERE pb.customer_code = lb.customer_code), 0) AS amount
      FROM ledger_balance lb
    ),
    /* Unapplied credit (negative residual) is used up oldest bucket first. */
    applied AS (
      SELECT pb.*,
             CASE WHEN pb.bucket_order >= 1 THEN
               LEAST(
                 GREATEST(pb.amount, 0),
                 GREATEST(0,
                   GREATEST(0, -COALESCE(r.amount, 0))
                   - COALESCE(SUM(GREATEST(pb.amount, 0)) FILTER (WHERE pb.bucket_order >= 1) OVER (
                       PARTITION BY pb.customer_code ORDER BY pb.bucket_order DESC
                       ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))
               )
             ELSE 0 END AS used
      FROM per_bucket pb
      LEFT JOIN residual r ON r.customer_code = pb.customer_code
    )
    SELECT customer_code AS customer_id, bucket, bucket_order, SUM(amount)::float8 AS amount
    FROM (
      SELECT customer_code, bucket, bucket_order, amount - used AS amount FROM applied
      UNION ALL
      SELECT r.customer_code, 'Current', 0,
             r.amount + COALESCE((SELECT SUM(a.used) FROM applied a WHERE a.customer_code = r.customer_code), 0)
      FROM residual r
    ) x
    GROUP BY customer_code, bucket, bucket_order
    HAVING ABS(SUM(amount)) >= 0.005`;
}
