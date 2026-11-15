-- =====================================================================
-- HR Phase 6 — HR money in the books, who works with whom, and posted
-- vouchers that cannot be changed. Run after 2026-11-03_hr_self_service.sql.
-- Adds only: 4 columns, 1 table, 4 permissions, 2 triggers. Drops nothing,
-- changes no existing value — safe to run on live data, and safe to re-run.
--
--   1. Vouchers for HR money (lib/hr/vouchers.js)
--      hr_loans.disburse_tran_id / disburse_acno      the pay-out Payment voucher
--      hr_loan_recoveries.tran_id / cash_acno         a cash repayment's Receipt voucher
--      hr_payroll_payments                            salaries paid (Payment vouchers)
--   2. Permissions (Admin → Permissions, module HR)
--      hr.loan.disburse   pay out advances / loans and take repayments (posts vouchers)
--      hr.payroll.pay     pay the net salaries of a posted payroll (posts vouchers)
--      hr.team.manage     set who reports to whom (HR → Team structure)
--      hr.scope.all       see every employee when no HR data scope is set
--                         (without it: only one's own team) → HR_MANAGER
--      The two money rights go to no role: ACCOUNTANT / ADMIN already hold
--      everything; give them to a cashier by Person if needed.
--   3. Posted system vouchers are read-only in the database itself
--      (lib/vouchers/systemVouchers.js). A voucher whose rmk4 is one of the
--      markers below cannot be deleted, and its date, type, cash/bank account,
--      marker and lines (account, cost centre, amounts) cannot be changed —
--      whoever sends the statement. Lines can be added to it only in the same
--      transaction that created it. Other columns (sync status, attachments …)
--      stay writable. Correct a posted voucher by reversing it on its screen.
-- =====================================================================
BEGIN;

-- 1 ── columns and table ─────────────────────────────────────────────────
ALTER TABLE hr_loans ADD COLUMN IF NOT EXISTS disburse_tran_id INTEGER;
ALTER TABLE hr_loans ADD COLUMN IF NOT EXISTS disburse_acno INTEGER;
ALTER TABLE hr_loan_recoveries ADD COLUMN IF NOT EXISTS tran_id INTEGER;
ALTER TABLE hr_loan_recoveries ADD COLUMN IF NOT EXISTS cash_acno INTEGER;

CREATE TABLE IF NOT EXISTS hr_payroll_payments (
  id               SERIAL PRIMARY KEY,
  run_id           INTEGER NOT NULL REFERENCES hr_payroll_runs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  date             DATE NOT NULL,
  acno             INTEGER NOT NULL,
  amount           DOUBLE PRECISION NOT NULL,
  employees        INTEGER[] DEFAULT '{}',
  reference        VARCHAR(60),
  tran_id          INTEGER NOT NULL,
  reversal_tran_id INTEGER,
  reversed_by      VARCHAR(50),
  reversed_at      TIMESTAMP(3),
  reverse_reason   VARCHAR(500),
  created_by       VARCHAR(50),
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS hr_payroll_payments_run_id_idx ON hr_payroll_payments(run_id);

-- 2 ── permissions ───────────────────────────────────────────────────────
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.loan.disburse', 'HR', 'Pay out advances / loans and receive repayments (posts payment / receipt vouchers)', 176),
  ('hr.payroll.pay',   'HR', 'Pay the net salaries of a posted payroll (posts payment vouchers)', 177),
  ('hr.team.manage',   'HR', 'Set who reports to whom (HR → Team structure)', 178),
  ('hr.scope.all',     'HR', 'See every employee in HR when no HR data scope is set (otherwise only their own team)', 179)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, 'HR_MANAGER'::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 WHERE p.code IN ('hr.team.manage', 'hr.scope.all')
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- 3 ── posted system vouchers are read-only ──────────────────────────────
-- Keep this list equal to SYSTEM_VOUCHER_MARKERS in lib/vouchers/systemVouchers.js.
CREATE OR REPLACE FUNCTION system_voucher_markers() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['PAYROLL', 'PAYROLL_REVERSAL', 'HR_LOAN_PAYOUT', 'HR_LOAN_REPAY', 'HR_SALARY_PAY', 'HR_REVERSAL']::TEXT[]
$$;

CREATE OR REPLACE FUNCTION protect_system_voucher_master() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.rmk4 = ANY (system_voucher_markers()) AND (
       TG_OP = 'DELETE'
       OR NEW.tran_code IS DISTINCT FROM OLD.tran_code
       OR NEW.dated     IS DISTINCT FROM OLD.dated
       OR NEW.pycd      IS DISTINCT FROM OLD.pycd
       OR NEW.rmk4      IS DISTINCT FROM OLD.rmk4
       OR NEW.rmk5      IS DISTINCT FROM OLD.rmk5
     ) THEN
    RAISE EXCEPTION 'Voucher % (%) was posted by the system and is read-only — reverse it from its own screen.', OLD.tran_id, OLD.rmk4
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_system_voucher_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  m RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A line may join a system voucher only in the transaction that created it.
    SELECT tran_id, rmk4, xmin INTO m FROM "TRANSACTIONS_MASTER" WHERE tran_id = NEW.tran_id;
    IF m.rmk4 = ANY (system_voucher_markers()) AND m.xmin::TEXT <> pg_current_xact_id()::xid::TEXT THEN
      RAISE EXCEPTION 'Voucher % (%) was posted by the system and is read-only — lines cannot be added.', m.tran_id, m.rmk4
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT tran_id, rmk4 INTO m FROM "TRANSACTIONS_MASTER" WHERE tran_id = OLD.tran_id;
  IF m.rmk4 = ANY (system_voucher_markers()) AND (
       TG_OP = 'DELETE'
       OR NEW.tran_id     IS DISTINCT FROM OLD.tran_id
       OR NEW.acno        IS DISTINCT FROM OLD.acno
       OR NEW.ccno        IS DISTINCT FROM OLD.ccno
       OR NEW.damt        IS DISTINCT FROM OLD.damt
       OR NEW.camt        IS DISTINCT FROM OLD.camt
       OR NEW.sub_tran_id IS DISTINCT FROM OLD.sub_tran_id
     ) THEN
    RAISE EXCEPTION 'Voucher % (%) was posted by the system and is read-only — reverse it from its own screen.', m.tran_id, m.rmk4
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_system_voucher_master ON "TRANSACTIONS_MASTER";
CREATE TRIGGER protect_system_voucher_master
  BEFORE UPDATE OR DELETE ON "TRANSACTIONS_MASTER"
  FOR EACH ROW EXECUTE FUNCTION protect_system_voucher_master();

DROP TRIGGER IF EXISTS protect_system_voucher_lines ON "Transactions";
CREATE TRIGGER protect_system_voucher_lines
  BEFORE INSERT OR UPDATE OR DELETE ON "Transactions"
  FOR EACH ROW EXECUTE FUNCTION protect_system_voucher_lines();

COMMIT;
