-- =====================================================================
-- Point of Sale (lib/pos/*) — shifts, receipt figures, payments, held bills,
-- the finer POS permissions and the POS reports' view permissions.
--
--   pos_shifts      a cashier's shift (float, cash counted, frozen Z report)
--   pos_receipts    one row per POS receipt (sale = tran_code 5, return = 12)
--   pos_payments    how it was paid / refunded (CASH | CARD | CREDIT)
--   pos_held_bills  bills put on hold at the till
--
-- The books stay in TransactionsMaster / Transactions (the POS voucher).
-- Additive and re-runnable.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS pos_shifts (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  godown        INTEGER,
  opened_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opening_float DOUBLE PRECISION NOT NULL DEFAULT 0,
  closed_at     TIMESTAMP(3),
  closed_by     TEXT,
  expected_cash DOUBLE PRECISION,
  counted_cash  DOUBLE PRECISION,
  difference    DOUBLE PRECISION,
  notes         VARCHAR(500),
  status        VARCHAR(10) NOT NULL DEFAULT 'OPEN',
  summary       JSONB
);
CREATE INDEX IF NOT EXISTS pos_shifts_user_id_status_idx ON pos_shifts (user_id, status);
CREATE INDEX IF NOT EXISTS pos_shifts_opened_at_idx ON pos_shifts (opened_at);
-- One open shift per cashier.
CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open_per_user ON pos_shifts (user_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS pos_receipts (
  tran_id        INTEGER PRIMARY KEY,
  kind           VARCHAR(10) NOT NULL,
  shift_id       INTEGER,
  ref_tran_id    INTEGER,
  customer_name  VARCHAR(150),
  customer_phone VARCHAR(40),
  subtotal       DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount       DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax            DOUBLE PRECISION NOT NULL DEFAULT 0,
  rounding       DOUBLE PRECISION NOT NULL DEFAULT 0,
  total          DOUBLE PRECISION NOT NULL DEFAULT 0,
  tendered       DOUBLE PRECISION NOT NULL DEFAULT 0,
  change_due     DOUBLE PRECISION NOT NULL DEFAULT 0,
  note           VARCHAR(500),
  client_ref     VARCHAR(64),
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_receipts_client_ref_key ON pos_receipts (client_ref);
CREATE INDEX IF NOT EXISTS pos_receipts_shift_id_idx ON pos_receipts (shift_id);
CREATE INDEX IF NOT EXISTS pos_receipts_ref_tran_id_idx ON pos_receipts (ref_tran_id);

CREATE TABLE IF NOT EXISTS pos_payments (
  id        SERIAL PRIMARY KEY,
  tran_id   INTEGER NOT NULL,
  method    VARCHAR(10) NOT NULL,
  acno      INTEGER,
  amount    DOUBLE PRECISION NOT NULL,
  reference VARCHAR(80)
);
CREATE INDEX IF NOT EXISTS pos_payments_tran_id_idx ON pos_payments (tran_id);

CREATE TABLE IF NOT EXISTS pos_held_bills (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  label      VARCHAR(120),
  data       JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pos_held_bills_user_id_idx ON pos_held_bills (user_id);

-- ── Permissions (scripts/seed-permissions.mjs SPECIAL) ─────────────────────
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('pos.sell',      'Sales', 'Sell at the point of sale (ring up, take payment, hold / recall bills)', 186),
  ('pos.refund',    'Sales', 'Refund a point-of-sale receipt (POS return)', 187),
  ('pos.discount',  'Sales', 'Give discounts at the point of sale (up to the maximum in Settings → Point of Sale)', 188),
  ('pos.credit',    'Sales', 'Sell on credit to a customer account at the point of sale', 189),
  ('pos.dayClose',  'Sales', 'Open and close POS shifts (Z report)', 190),
  ('pos.allShifts', 'Sales', 'See and close every cashier''s POS shift and receipts', 191),
  ('report.posDailySales.view',     'Sales Reports', 'View POS Daily Sales report', 5900),
  ('report.posSalesByItem.view',    'Sales Reports', 'View POS Sales By Item report', 5901),
  ('report.posSalesByPayment.view', 'Sales Reports', 'View POS Sales By Payment report', 5902),
  ('report.posSalesByCashier.view', 'Sales Reports', 'View POS Sales By Cashier report', 5903),
  ('report.posReturns.view',        'Sales Reports', 'View POS Returns report', 5904)
ON CONFLICT (code) DO NOTHING;

-- Copied grants: every role that operates the POS today (pos.manage) may sell,
-- refund, discount and close its own shift — what pos.manage allowed before.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT np.id, g.role, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" fp
  JOIN "PermissionGrant" g ON g."permissionId" = fp.id AND g.allow AND g.role IS NOT NULL AND g."userId" IS NULL
  JOIN "Permission" np ON np.code IN ('pos.sell', 'pos.refund', 'pos.discount', 'pos.dayClose')
 WHERE fp.code = 'pos.manage'
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- Whoever sees the POS transactions report sees the new POS reports, and may
-- see every cashier's shifts.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT np.id, g.role, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" fp
  JOIN "PermissionGrant" g ON g."permissionId" = fp.id AND g.allow AND g.role IS NOT NULL AND g."userId" IS NULL
  JOIN "Permission" np ON np.code IN ('report.posDailySales.view', 'report.posSalesByItem.view', 'report.posSalesByPayment.view',
                                      'report.posSalesByCashier.view', 'report.posReturns.view', 'pos.allShifts')
 WHERE fp.code = 'report.posTransactions.view'
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- A cashier sees the POS reports of their own till.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, 'CASHIER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 WHERE p.code IN ('report.posTransactions.view', 'report.posDailySales.view', 'report.posSalesByItem.view', 'report.posSalesByPayment.view', 'report.posReturns.view')
   AND EXISTS (SELECT 1 FROM app_roles r WHERE r.code = 'CASHIER')
ON CONFLICT ("permissionId", "role") DO NOTHING;

COMMIT;
