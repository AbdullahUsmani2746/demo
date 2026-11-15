-- ============================================================
-- Service Invoice — 2026-10-25
-- ============================================================
-- A Service Invoice (tran_code 21, type serviceInvoice) now POSTS:
--   each service line  Dr its expense account (service → category →
--                       Account Settings 'service_expense')
--   sales tax          Dr input tax (Account Settings 'sales_tax_input')
--   vendor             Cr goods + tax
-- and each line can be linked to the GRNs / dispatches it was for
-- (service_invoice_links). Services can be switched off (is_active).
-- Logic: lib/service/serviceInvoice.js
--
-- Additive and safe to re-run. Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-25_service_invoice.sql --schema prisma/schema.prisma
-- then:
--   npx prisma generate
-- Do NOT use `prisma db push`.
-- ============================================================

ALTER TABLE "Service"         ADD COLUMN IF NOT EXISTS expense_acno INTEGER;
ALTER TABLE "Service"         ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "ServiceCategory" ADD COLUMN IF NOT EXISTS expense_acno INTEGER;

CREATE TABLE IF NOT EXISTS service_invoice_links (
  id             SERIAL PRIMARY KEY,
  tran_id        INTEGER      NOT NULL,
  line_no        INTEGER      NOT NULL,
  source_tran_id INTEGER      NOT NULL,
  source_type    VARCHAR(20)  NOT NULL, -- GRN | DISPATCH | SALE_RETURN
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS service_invoice_links_tran_id_line_no_source_tran_id_key
  ON service_invoice_links (tran_id, line_no, source_tran_id);
CREATE INDEX IF NOT EXISTS service_invoice_links_tran_id_idx ON service_invoice_links (tran_id);
CREATE INDEX IF NOT EXISTS service_invoice_links_source_tran_id_idx ON service_invoice_links (source_tran_id);

-- Fallback expense account: listed on Finance → Account Settings, not set.
INSERT INTO account_settings (key, kind, section, label, updated_by)
VALUES ('service_expense', 'ACCOUNT', 'SERVICES', 'Service Expense (default)', 'seed 2026-10-25')
ON CONFLICT (key) DO NOTHING;
