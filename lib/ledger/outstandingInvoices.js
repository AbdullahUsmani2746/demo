import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCustomerMacnos, getVendorMacnos } from "@/lib/accounts/partyMacnos";

// `IN (...)` over a configured group; an unset group matches nothing.
const sqlIn = (list) => Prisma.join(list.length ? list : [null]);

// ============================================================
// Outstanding invoices — Customer (receivables) & Vendor (payables)
// ------------------------------------------------------------
// Invoice identity is (party acno, invoice_no string) — an "invoice"
// can originate from a Sale/Purchase Invoice (tran_code 6/4) OR from a
// JV line (tran_code 3) that already carries a non-null invoice_no
// (e.g. an opening-balance JV or debit note). Both are itemized here;
// `ledger_combined` nets them by invoice_no regardless of which
// tran_id they came from.
//
// Settlement netting (how much of each invoice has been paid off) is
// sourced from INVOICE_KNOCKOFF — the allocation table populated by
// the auto-matching cron (lib/ledger/invoiceMatcher.js) and manual
// overrides (app/api/invoice-knockoff). Sale Return (10) / Purchase
// Return (9) netting stays a direct read against Transactions for returns
// traced to their invoice. A return traced to none is FIFO-matched when
// Settings → Features "knockoff.matchReturns" is on, and then arrives
// through INVOICE_KNOCKOFF instead (never both).
//
// Voucher tran_codes: RV 1, PV 2, JV 3, PI 4, SI 6, PR 9, SR 10,
// Service Invoice 21 (a vendor bill, treated like PI 4).
//
// Both are ordered by date ASC so callers can allocate FIFO
// (oldest invoice first).
// ============================================================

export async function getCustomerOutstanding(customerNumber) {
  return prisma.$queryRaw`

WITH sales_invoices AS (

  -- tran_code 6: classic sales invoice, customer via TRANSACTIONS_MASTER.pycd
  SELECT
    tm.tran_id,
    tm.invoice_no,
    tm.dated,
    tm.vr_no,
    tm.pycd                      AS party_code,
    SUM(COALESCE(t.damt, 0))     AS invoice_amount
  FROM "TRANSACTIONS_MASTER" tm
  JOIN "Transactions" t ON t.tran_id = tm.tran_id
  WHERE tm.tran_code = 6
    AND tm.pycd = ${customerNumber}
    AND tm.invoice_no IS NOT NULL
  GROUP BY tm.tran_id, tm.invoice_no, tm.dated, tm.vr_no, tm.pycd

  UNION ALL

  -- tran_code 3: JV debit lines, customer via Transactions.acno, invoice_no via Transactions
  -- A JV debit line that the knock-off engine ALLOCATED (a debit note pushed
  -- onto an existing invoice) also carries an invoice_no now, but it is a
  -- settlement, not a new receivable — it is already counted in the ledger
  -- CTE below. Counting it here too would double it, so allocated lines are
  -- excluded and only genuine JV-raised invoices remain.
  SELECT
    tm.tran_id,
    t.invoice_no,
    tm.dated,
    tm.vr_no,
    t.acno                       AS party_code,
    SUM(COALESCE(t.damt, 0))     AS invoice_amount
  FROM "Transactions" t
  JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
  WHERE tm.tran_code = 3
    AND t.acno = ${customerNumber}
    AND t.invoice_no IS NOT NULL
    AND t.damt > 0
    AND NOT EXISTS (
      SELECT 1 FROM "INVOICE_KNOCKOFF" k
      WHERE k.source_line_id = t.id AND k.reversed_at IS NULL
    )
  GROUP BY tm.tran_id, t.invoice_no, tm.dated, tm.vr_no, t.acno

),

ledger AS (

  -- Receipt/Payment/JV settlements now come from INVOICE_KNOCKOFF (the
  -- allocation table), not directly from Transactions.invoice_no — this
  -- is what lets a single settlement line split across multiple invoices.
  SELECT
    k.invoice_no,
    SUM(k.allocated_amount)      AS total_adjusted
  FROM "INVOICE_KNOCKOFF" k
  WHERE k.invoice_party_acno = ${customerNumber}
    AND k.reversed_at IS NULL
  GROUP BY k.invoice_no

  UNION ALL

  -- tran_code 10 (Sale Return): invoice_no from TRANSACTIONS_MASTER, customer from pycd
  -- Returns always carry an explicit invoice_no at entry — out of scope for auto-matching.
  -- 10 is what VOUCHER_CONFIG.saleReturn posts (constants.js) and what CLAUDE.md
  -- documents; this read 13 and so never netted a single sale return.
  --
  -- Since 2026-10-25 a sale return's OWN invoice_no is its credit-note number
  -- from Invoicing (lib/invoicing/core.js), not the invoice it returns against.
  -- Only legacy rows (invoice_series 'L') still carry the original invoice
  -- number there; a new return nets against the invoice of the dispatch it
  -- names (dispatch_no → tran_code 6).
  SELECT
    CASE WHEN tm.invoice_series = 'L' THEN tm.invoice_no ELSE orig.invoice_no END AS invoice_no,
    SUM(COALESCE(t.camt, 0))     AS total_adjusted
  FROM "TRANSACTIONS_MASTER" tm
  JOIN "Transactions" t ON t.tran_id = tm.tran_id
  LEFT JOIN LATERAL (
    SELECT o.invoice_no FROM "TRANSACTIONS_MASTER" o
    WHERE o.tran_code = 6 AND o.dispatch_no = tm.dispatch_no
      AND o.invoice_no IS NOT NULL AND o.invoice_no <> ''
    ORDER BY o.tran_id DESC LIMIT 1
  ) orig ON TRUE
  WHERE tm.tran_code = 10
    AND tm.pycd = ${customerNumber}
    AND tm.invoice_no IS NOT NULL
    -- A return the knock-off matched (Features: knockoff.matchReturns) is
    -- already in INVOICE_KNOCKOFF above; never net it twice.
    AND NOT EXISTS (
      SELECT 1 FROM "INVOICE_KNOCKOFF" k
      WHERE k.source_tran_id = tm.tran_id AND k.reversed_at IS NULL
    )
  GROUP BY 1

),

ledger_combined AS (
  SELECT invoice_no, SUM(total_adjusted) AS total_adjusted
  FROM ledger
  GROUP BY invoice_no
)

SELECT
  si.tran_id,
  si.invoice_no,
  si.dated,
  si.vr_no,
  si.party_code,
  a.acname                                              AS party_name,
  si.invoice_amount,
  COALESCE(lc.total_adjusted, 0)                        AS total_adjusted,
  si.invoice_amount - COALESCE(lc.total_adjusted, 0)    AS outstanding,
  EXTRACT(DAY FROM (CURRENT_DATE - si.dated))           AS days_outstanding
FROM sales_invoices si
LEFT JOIN ledger_combined lc
  ON lc.invoice_no = si.invoice_no
LEFT JOIN "acno" a
  ON a.acno = si.party_code
 AND a.macno IN (${sqlIn(await getCustomerMacnos())})
WHERE si.invoice_amount - COALESCE(lc.total_adjusted, 0) > 0.01
ORDER BY si.dated ASC;

`;
}

export async function getVendorOutstanding(vendorNumber) {
  return prisma.$queryRaw`

WITH purchase_invoices AS (

  -- tran_code 4 / 21: purchase or service invoice, vendor via TRANSACTIONS_MASTER.pycd.
  -- The vendor payable is the credit line whose acno = the vendor (pycd),
  -- so we sum only that line to avoid counting stock/transport entries.
  SELECT
    tm.tran_id,
    tm.invoice_no,
    tm.dated,
    tm.vr_no,
    tm.pycd                      AS party_code,
    SUM(COALESCE(t.camt, 0))     AS invoice_amount
  FROM "TRANSACTIONS_MASTER" tm
  JOIN "Transactions" t ON t.tran_id = tm.tran_id
  WHERE tm.tran_code IN (4, 21)
    AND tm.pycd = ${vendorNumber}
    AND tm.invoice_no IS NOT NULL
    AND t.acno = ${vendorNumber}
  GROUP BY tm.tran_id, tm.invoice_no, tm.dated, tm.vr_no, tm.pycd

  UNION ALL

  -- tran_code 3: JV credit lines, vendor via Transactions.acno, invoice_no via Transactions
  -- Same exclusion as the customer side: a JV credit line the knock-off
  -- engine allocated is a settlement already counted in the ledger CTE, not
  -- a new payable.
  SELECT
    tm.tran_id,
    t.invoice_no,
    tm.dated,
    tm.vr_no,
    t.acno                       AS party_code,
    SUM(COALESCE(t.camt, 0))     AS invoice_amount
  FROM "Transactions" t
  JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
  WHERE tm.tran_code = 3
    AND t.acno = ${vendorNumber}
    AND t.invoice_no IS NOT NULL
    AND t.camt > 0
    AND NOT EXISTS (
      SELECT 1 FROM "INVOICE_KNOCKOFF" k
      WHERE k.source_line_id = t.id AND k.reversed_at IS NULL
    )
  GROUP BY tm.tran_id, t.invoice_no, tm.dated, tm.vr_no, t.acno

),

ledger AS (

  -- Receipt/Payment/JV settlements now come from INVOICE_KNOCKOFF (the
  -- allocation table), not directly from Transactions.invoice_no — this
  -- is what lets a single settlement line split across multiple invoices.
  SELECT
    k.invoice_no,
    SUM(k.allocated_amount)      AS total_adjusted
  FROM "INVOICE_KNOCKOFF" k
  WHERE k.invoice_party_acno = ${vendorNumber}
    AND k.reversed_at IS NULL
  GROUP BY k.invoice_no

  UNION ALL

  -- tran_code 9 (Purchase Return): debits the vendor (reduces payable).
  -- Returns always carry an explicit invoice_no at entry — out of scope for auto-matching.
  -- Since 2026-10-25 its own invoice_no is a debit-note number from
  -- Invoicing; only legacy rows ('L') carry the original invoice number. A new
  -- return nets against the invoice of the GRN it names (grn_no → tran_code 4).
  SELECT
    CASE WHEN tm.invoice_series = 'L' THEN tm.invoice_no ELSE orig.invoice_no END AS invoice_no,
    SUM(COALESCE(t.damt, 0))     AS total_adjusted
  FROM "TRANSACTIONS_MASTER" tm
  JOIN "Transactions" t ON t.tran_id = tm.tran_id
  LEFT JOIN LATERAL (
    SELECT o.invoice_no FROM "TRANSACTIONS_MASTER" o
    WHERE o.tran_code = 4 AND o.grn_no = tm.grn_no
      AND o.invoice_no IS NOT NULL AND o.invoice_no <> ''
    ORDER BY o.tran_id DESC LIMIT 1
  ) orig ON TRUE
  WHERE tm.tran_code = 9
    AND tm.pycd = ${vendorNumber}
    AND tm.invoice_no IS NOT NULL
    -- Matched by the knock-off (knockoff.matchReturns): counted above.
    AND NOT EXISTS (
      SELECT 1 FROM "INVOICE_KNOCKOFF" k
      WHERE k.source_tran_id = tm.tran_id AND k.reversed_at IS NULL
    )
  GROUP BY 1

),

ledger_combined AS (
  SELECT invoice_no, SUM(total_adjusted) AS total_adjusted
  FROM ledger
  GROUP BY invoice_no
)

SELECT
  pi.tran_id,
  pi.invoice_no,
  pi.dated,
  pi.vr_no,
  pi.party_code,
  a.acname                                              AS party_name,
  pi.invoice_amount,
  COALESCE(lc.total_adjusted, 0)                        AS total_adjusted,
  pi.invoice_amount - COALESCE(lc.total_adjusted, 0)    AS outstanding,
  EXTRACT(DAY FROM (CURRENT_DATE - pi.dated))           AS days_outstanding
FROM purchase_invoices pi
LEFT JOIN ledger_combined lc
  ON lc.invoice_no = pi.invoice_no
LEFT JOIN "acno" a
  ON a.acno = pi.party_code
 AND a.macno IN (${sqlIn(await getVendorMacnos())})
WHERE pi.invoice_amount - COALESCE(lc.total_adjusted, 0) > 0.01
ORDER BY pi.dated ASC;

`;
}
