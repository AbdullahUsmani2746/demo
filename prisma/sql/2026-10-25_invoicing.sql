-- ============================================================
-- Invoicing — 2026-10-25
-- ============================================================
-- GRN (tran 4), GRN / purchase return (9), dispatch (6) and dispatch / sale
-- return (10) are now saved with QUANTITY ONLY. They are priced and posted to
-- the ledger later, on the same document, by Invoicing
-- (/api/invoicing/[kind], lib/invoicing/core.js), which stamps invoice_no from
-- one running series per kind (invoice_series stays NULL for new invoices).
--
-- A document counts as INVOICED when invoice_no is set OR invoice_series = 'L'
-- (imported / pre-Invoicing history). Invoiced documents cannot be edited or
-- deleted through the voucher screens until they are unlocked in Invoicing;
-- 'L' rows can only be unlocked by an ADMIN, and are left out of the numbering.
--
-- Additive; a re-run changes nothing (only rows not yet 'L' are touched). Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-25_invoicing.sql --schema prisma/schema.prisma
-- then:
--   npx prisma generate
-- Do NOT use `prisma db push`.
-- ============================================================

BEGIN;

-- ── 1. Vendor bill no ────────────────────────────────────────────────────────
-- Purchase / purchase return: the vendor's own bill number (bill_date already
-- exists). invoice_no is now OUR invoice number from the series.
ALTER TABLE "TRANSACTIONS_MASTER" ADD COLUMN IF NOT EXISTS vendor_bill_no VARCHAR(60);

-- ── 2. Indexes for the uniqueness checks (lib/invoicing/core.js) ────────────
-- invoiceNoConflict():  tran_code + lower(btrim(invoice_no))
CREATE INDEX IF NOT EXISTS "TRANSACTIONS_MASTER_invoice_no_ci_idx"
  ON "TRANSACTIONS_MASTER" (tran_code, lower(btrim(invoice_no)))
  WHERE invoice_no IS NOT NULL;

-- vendorBillConflict(): tran_code + vendor + lower(btrim(vendor_bill_no))
CREATE INDEX IF NOT EXISTS "TRANSACTIONS_MASTER_vendor_bill_no_ci_idx"
  ON "TRANSACTIONS_MASTER" (tran_code, pycd, lower(btrim(vendor_bill_no)))
  WHERE vendor_bill_no IS NOT NULL;

-- ── 3. Imported rows (tran_id 125237..134966) → invoiced legacy history ─────
-- They were imported already priced. Without an invoice number they would show
-- up as pending in Invoicing and could be re-priced; mark them 'L' so they stay
-- invoiced and locked. (tran 6 imported rows are already 'L'.)
-- Only rows not yet marked 'L' are touched, so a re-run changes nothing.

-- 3a. Imported GRNs: copy the vendor's bill no (invoice_no today, 577 rows;
--     else rmk19 = TM_BILL_NO) into vendor_bill_no.
UPDATE "TRANSACTIONS_MASTER"
   SET vendor_bill_no = left(btrim(COALESCE(NULLIF(btrim(invoice_no), ''), NULLIF(btrim(rmk19), ''))), 60)
 WHERE tran_code = 4
   AND tran_id BETWEEN 125237 AND 134966
   AND invoice_series IS NULL
   AND vendor_bill_no IS NULL
   AND COALESCE(NULLIF(btrim(invoice_no), ''), NULLIF(btrim(rmk19), '')) IS NOT NULL;

-- 3b. Mark every imported GRN 'L'. An invoice_no it already carries is KEPT:
--     vendor payments are knocked off against it (INVOICE_KNOCKOFF and the
--     R/P/JV line tags match on party + invoice_no). Only GRNs without one get
--     their legacy document no. New invoice numbers skip every legacy number.
UPDATE "TRANSACTIONS_MASTER"
   SET invoice_series = 'L',
       invoice_no = COALESCE(NULLIF(btrim(invoice_no), ''), NULLIF(btrim(rmk5), ''), tran_id::text)
 WHERE tran_code = 4
   AND tran_id BETWEEN 125237 AND 134966
   AND invoice_series IS NULL;

-- 3c. Imported purchase / sale returns: keep any invoice_no they carry.
UPDATE "TRANSACTIONS_MASTER"
   SET invoice_series = 'L',
       invoice_no = COALESCE(NULLIF(btrim(invoice_no), ''), NULLIF(btrim(rmk5), ''), tran_id::text)
 WHERE tran_code IN (9, 10)
   AND tran_id BETWEEN 125237 AND 134966
   AND invoice_series IS NULL;

-- (No app-saved tran 4 / 6 / 9 / 10 rows exist outside the import range
--  today, so nothing else needs backfilling.)

-- ── 5. Permissions ───────────────────────────────────────────────────────────
-- Same codes / labels / sort as scripts/seed-permissions.mjs (module "Invoicing").
-- ADMIN and ACCOUNTANT pass every check (lib/auth/permissions.js FULL_ACCESS_ROLES).
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('invoicing.sale.view',                 'Invoicing', 'View dispatches pending / invoiced as sale invoices', 120),
  ('invoicing.sale.generate',             'Invoicing', 'Price dispatches and generate sale invoices', 121),
  ('invoicing.sale.unlock',               'Invoicing', 'Unlock a sale invoice (reverse its pricing and ledger posting)', 122),
  ('invoicing.sale-return.view',          'Invoicing', 'View sale returns pending / invoiced', 123),
  ('invoicing.sale-return.generate',      'Invoicing', 'Price sale returns and generate credit notes', 124),
  ('invoicing.sale-return.unlock',        'Invoicing', 'Unlock an invoiced sale return', 125),
  ('invoicing.purchase.view',             'Invoicing', 'View GRNs pending / invoiced as purchase invoices', 126),
  ('invoicing.purchase.generate',         'Invoicing', 'Price GRNs and generate purchase invoices', 127),
  ('invoicing.purchase.unlock',           'Invoicing', 'Unlock a purchase invoice (reverse its pricing and ledger posting)', 128),
  ('invoicing.purchase-return.view',      'Invoicing', 'View purchase returns pending / invoiced', 129),
  ('invoicing.purchase-return.generate',  'Invoicing', 'Price purchase returns and generate debit notes', 130),
  ('invoicing.purchase-return.unlock',    'Invoicing', 'Unlock an invoiced purchase return', 131)
ON CONFLICT (code) DO NOTHING;

-- Everything allowed for now (user decision 2026-10-25) for the other roles.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, r.role::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 CROSS JOIN (VALUES ('MANAGER'), ('CASHIER'), ('SALES'), ('EMPLOYEE'), ('HR_MANAGER')) AS r(role)
 WHERE p.code LIKE 'invoicing.%'
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- ── 6. Check: no imported document is left without a number ────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM "TRANSACTIONS_MASTER"
   WHERE tran_code IN (4, 6, 9, 10)
     AND tran_id BETWEEN 125237 AND 134966
     AND COALESCE(btrim(invoice_no), '') = '';
  IF n > 0 THEN
    RAISE EXCEPTION 'Invoicing migration: % imported tran 4/6/9/10 row(s) still have no invoice_no — nothing was applied', n;
  END IF;
END $$;

COMMIT;

-- ── Check ────────────────────────────────────────────────────────────────────
-- SELECT tran_code,
--        COUNT(*) FILTER (WHERE invoice_series = 'L')                                          AS legacy,
--        COUNT(*) FILTER (WHERE invoice_series IS DISTINCT FROM 'L' AND COALESCE(btrim(invoice_no), '') <> '') AS invoiced,
--        COUNT(*) FILTER (WHERE invoice_series IS DISTINCT FROM 'L' AND COALESCE(btrim(invoice_no), '') = '')  AS pending
--   FROM "TRANSACTIONS_MASTER" WHERE tran_code IN (4, 6, 9, 10) GROUP BY 1 ORDER BY 1;
