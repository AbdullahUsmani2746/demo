-- =====================================================================
-- HR payroll additions — bank disbursement files, pay history, tax
-- certificates, provident fund, gratuity, leaving process and full & final
-- settlement (lib/hr/*, CLAUDE.md rules 1-5, 8, 10-12, 16).
--
-- Every flow is a feature switch (lib/features/catalog.js, group "hr"),
-- default OFF, so nothing changes until a company switches it on:
--   hr.bankDisbursement  hr.payHistory  hr.taxCertificate
--   hr.providentFund     hr.gratuity    hr.leavingProcess
--
--   1. Tables / columns (prisma/schema.prisma)
--        hr_separations        resignation / termination / retirement + clearance
--        hr_settlements        full & final settlement (JV + payment voucher)
--        hr_payslips.pf_employee / pf_employer / gratuity   (per-month figures)
--        hr_loan_recoveries.settlement_id                   (recovered at exit)
--        hr_leave_types.encashable                          (paid out at exit)
--   2. Rules (Settings "hr.*", HR → Payroll → Rules / Leaving)
--   3. Account Settings, section PAYROLL (lib/accounts/accountSettingDefs.js),
--      seeded empty — set them on Finance → Account Settings.
--   4. System vouchers HR_SETTLEMENT (journal) and HR_SETTLEMENT_PAY (payment)
--      MERGED into system_voucher_markers() — other modules' markers are kept.
--   5. Permissions + grants (HR prepares, approvers approve, finance posts).
--
-- Additive and re-runnable. Apply (after the owner approves this run):
--   npx prisma db execute --file prisma/sql/2026-11-21_hr_payroll_additions.sql --schema prisma/schema.prisma
-- =====================================================================
BEGIN;

-- 1 ── tables and columns ────────────────────────────────────────────────
ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS pf_employee DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS pf_employer DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS gratuity DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE hr_loan_recoveries ADD COLUMN IF NOT EXISTS settlement_id INTEGER;
ALTER TABLE hr_leave_types ADD COLUMN IF NOT EXISTS encashable BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS hr_separations (
  id                  SERIAL PRIMARY KEY,
  employee_id         INTEGER NOT NULL REFERENCES "Employee"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  kind                VARCHAR(12) NOT NULL,
  notice_date         DATE NOT NULL,
  notice_days         INTEGER NOT NULL DEFAULT 0,
  last_working_day    DATE NOT NULL,
  waive_notice        BOOLEAN NOT NULL DEFAULT false,
  reason              VARCHAR(500),
  status              VARCHAR(10) NOT NULL DEFAULT 'pending',
  clearance           JSONB NOT NULL DEFAULT '[]',
  approval_request_id INTEGER,
  requested_by        VARCHAR(50) NOT NULL,
  requested_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by          VARCHAR(50),
  decided_at          TIMESTAMP(3),
  decision_note       VARCHAR(500),
  completed_by        VARCHAR(50),
  completed_at        TIMESTAMP(3),
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS hr_separations_employee_id_idx ON hr_separations (employee_id);
CREATE INDEX IF NOT EXISTS hr_separations_status_idx ON hr_separations (status);
-- One open separation per employee.
CREATE UNIQUE INDEX IF NOT EXISTS hr_separations_one_open
  ON hr_separations (employee_id) WHERE status IN ('pending', 'approved');

CREATE TABLE IF NOT EXISTS hr_settlements (
  id                   SERIAL PRIMARY KEY,
  separation_id        INTEGER NOT NULL REFERENCES hr_separations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  employee_id          INTEGER NOT NULL REFERENCES "Employee"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  dor                  DATE NOT NULL,
  salary_from          DATE,
  status               VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
  inputs               JSONB NOT NULL DEFAULT '{}',
  data                 JSONB NOT NULL DEFAULT '{}',
  total_earnings       DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_deductions     DOUBLE PRECISION NOT NULL DEFAULT 0,
  net                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  approval_request_id  INTEGER,
  jv_tran_id           INTEGER,
  reversal_tran_id     INTEGER,
  pay_tran_id          INTEGER,
  pay_acno             INTEGER,
  paid_on              DATE,
  pay_reversal_tran_id INTEGER,
  created_by           VARCHAR(50),
  created_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_by         VARCHAR(50),
  submitted_at         TIMESTAMP(3),
  decided_by           VARCHAR(50),
  decided_at           TIMESTAMP(3),
  decision_note        VARCHAR(500),
  posted_by            VARCHAR(50),
  posted_at            TIMESTAMP(3),
  paid_by              VARCHAR(50),
  reversed_by          VARCHAR(50),
  reversed_at          TIMESTAMP(3),
  reverse_reason       VARCHAR(500),
  updated_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS hr_settlements_separation_id_idx ON hr_settlements (separation_id);
CREATE INDEX IF NOT EXISTS hr_settlements_employee_id_idx ON hr_settlements (employee_id);
CREATE INDEX IF NOT EXISTS hr_settlements_status_idx ON hr_settlements (status);
-- One live (not reversed) settlement per separation.
CREATE UNIQUE INDEX IF NOT EXISTS hr_settlements_one_live
  ON hr_settlements (separation_id) WHERE status <> 'REVERSED';

-- 2 ── rules (Settings) ──────────────────────────────────────────────────
INSERT INTO "Settings" (key, value, description, last_updated) VALUES
  ('hr.tax.year_start_month',             '7',    'HR: month the tax year starts (7 = July; tax deduction and tax certificates)', CURRENT_TIMESTAMP),
  ('hr.pf.employee_percent',              '8.33', 'HR: provident fund, employee share (% of basic or gross earned)', CURRENT_TIMESTAMP),
  ('hr.pf.employer_percent',              '8.33', 'HR: provident fund, employer share (% of basic or gross earned)', CURRENT_TIMESTAMP),
  ('hr.pf.base_gross',                    '0',    'HR: provident fund worked on 1 = gross earned, 0 = basic earned', CURRENT_TIMESTAMP),
  ('hr.pf.eligible_months',               '0',    'HR: months of service before provident fund starts', CURRENT_TIMESTAMP),
  ('hr.pf.vesting_months',                '0',    'HR: months of service before the employer share is paid out at exit', CURRENT_TIMESTAMP),
  ('hr.gratuity.base_gross',              '0',    'HR: gratuity on 1 = last gross salary, 0 = last basic', CURRENT_TIMESTAMP),
  ('hr.gratuity.days_per_year',           '30',   'HR: gratuity days of salary per year of service', CURRENT_TIMESTAMP),
  ('hr.gratuity.month_days',              '30',   'HR: a day of salary for gratuity = monthly ÷ this', CURRENT_TIMESTAMP),
  ('hr.gratuity.min_service_months',      '12',   'HR: months of service before gratuity is payable', CURRENT_TIMESTAMP),
  ('hr.gratuity.part_year',               '0',    'HR: part year: 0 = exact fraction, 1 = 6 months or more counts as a year, 2 = completed years only', CURRENT_TIMESTAMP),
  ('hr.gratuity.provision_monthly',       '0',    'HR: gratuity 1 = provided every month in the payroll journal, 0 = paid at exit only', CURRENT_TIMESTAMP),
  ('hr.leaving.notice_days',              '30',   'HR: notice days on resignation', CURRENT_TIMESTAMP),
  ('hr.leaving.notice_days_termination',  '30',   'HR: notice days on termination', CURRENT_TIMESTAMP),
  ('hr.leaving.notice_recovery',          '1',    'HR: resignation with short notice — 1 = recover the short days, 0 = no', CURRENT_TIMESTAMP),
  ('hr.leaving.notice_pay_termination',   '1',    'HR: termination with short notice — 1 = pay the short days, 0 = no', CURRENT_TIMESTAMP),
  ('hr.settlement.leave_encash',          '1',    'HR: leave encashment at exit — 0 = none, 1 = on basic, 2 = on gross', CURRENT_TIMESTAMP),
  ('hr.settlement.leave_encash_divisor',  '30',   'HR: a day of leave encashed = monthly ÷ this', CURRENT_TIMESTAMP),
  ('hr.settlement.leave_encash_max_days', '0',    'HR: most leave days encashed (0 = no limit)', CURRENT_TIMESTAMP),
  ('hr.bank_file_formats',
   '{"default":"standard","formats":[{"id":"standard","name":"Standard (CSV)","bank_ids":[],"file":"csv","delimiter":",","header":true,"date_format":"DD/MM/YYYY","amount_format":"0.00","columns":[{"field":"account","header":"Account Number"},{"field":"title","header":"Account Title"},{"field":"amount","header":"Amount"},{"field":"emp_id","header":"Employee No"},{"field":"cnic","header":"CNIC"},{"field":"reference","header":"Reference"}]}]}',
   'HR: bank transfer file layouts (HR → Payroll → Bank files)', CURRENT_TIMESTAMP),
  ('hr.leaving.clearance_items',
   '[{"key":"handover","label":"Work handed over"},{"key":"assets","label":"Company assets returned (laptop, phone, ID card)"},{"key":"finance","label":"Finance — no dues"},{"key":"department","label":"Department head clearance"},{"key":"hr","label":"HR exit interview"}]',
   'HR: clearance checklist of the leaving process', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

-- 3 ── Account Settings (PAYROLL), empty until set on the screen ──────────
INSERT INTO account_settings (key, kind, section, label, acno, updated_at) VALUES
  ('payroll_pf_payable',               'ACCOUNT', 'PAYROLL', 'Provident Fund Payable', NULL, CURRENT_TIMESTAMP),
  ('payroll_pf_expense',               'ACCOUNT', 'PAYROLL', 'Provident Fund — Employer Contribution (expense)', NULL, CURRENT_TIMESTAMP),
  ('payroll_gratuity_expense',         'ACCOUNT', 'PAYROLL', 'Gratuity Expense', NULL, CURRENT_TIMESTAMP),
  ('payroll_gratuity_payable',         'ACCOUNT', 'PAYROLL', 'Gratuity Payable (provision)', NULL, CURRENT_TIMESTAMP),
  ('payroll_leave_encashment_expense', 'ACCOUNT', 'PAYROLL', 'Leave Encashment Expense', NULL, CURRENT_TIMESTAMP),
  ('payroll_notice_recovery',          'ACCOUNT', 'PAYROLL', 'Notice Pay Recovered', NULL, CURRENT_TIMESTAMP),
  ('payroll_settlement_payable',       'ACCOUNT', 'PAYROLL', 'Final Settlements Payable', NULL, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

-- 4 ── system vouchers: merge the settlement markers into the read-only list ──
-- Keep in step with SYSTEM_VOUCHER_MARKERS in lib/vouchers/systemVouchers.js.
DO $$
DECLARE
  cur    TEXT[] := ARRAY[]::TEXT[];
  merged TEXT[];
BEGIN
  BEGIN
    SELECT system_voucher_markers() INTO cur;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'Run prisma/sql/2026-11-04_hr_accounting.sql first (it installs the system voucher trigger).';
  END;
  SELECT ARRAY(
    SELECT DISTINCT m FROM unnest(cur || ARRAY['HR_SETTLEMENT', 'HR_SETTLEMENT_PAY']::TEXT[]) AS m
    ORDER BY m
  ) INTO merged;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION system_voucher_markers() RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::TEXT[] $f$',
    merged
  );
END $$;

-- 5 ── permissions and grants ────────────────────────────────────────────
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.payroll.bankfile',   'HR', 'Download bank transfer files and bank advice letters of a payroll; edit bank file layouts', 178),
  ('hr.leaving.apply',      'HR', 'Resign (own leaving request, goes to approval)', 179),
  ('hr.leaving.manage',     'HR', 'Record resignations / terminations for employees, run the clearance checklist, complete the leaving', 180),
  ('hr.leaving.approve',    'HR', 'Approve or reject resignations / terminations', 181),
  ('hr.settlement.manage',  'HR', 'Prepare full & final settlements and submit them for approval', 182),
  ('hr.settlement.approve', 'HR', 'Approve or reject full & final settlements', 183),
  ('hr.settlement.post',    'HR', 'Post full & final settlements to accounts, pay and reverse them (posts vouchers)', 184),
  ('report.hrPayHistory.view',        'Reports · HR', 'View Hr Pay History report',        5090),
  ('report.hrPfLedger.view',          'Reports · HR', 'View Hr Pf Ledger report',          5091),
  ('report.hrGratuityProvision.view', 'Reports · HR', 'View Hr Gratuity Provision report', 5092)
ON CONFLICT (code) DO NOTHING;

-- Fixed grants.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, g.role, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('HR_MANAGER', 'hr.payroll.bankfile'),
    ('ACCOUNTS_MANAGER', 'hr.payroll.bankfile'),
    ('HR_MANAGER', 'hr.leaving.manage'),
    ('HR_MANAGER', 'hr.settlement.manage'),
    ('ACCOUNTS_MANAGER', 'hr.settlement.post'),
    ('HR_MANAGER', 'report.hrPayHistory.view'),
    ('HR_MANAGER', 'report.hrPfLedger.view'),
    ('HR_MANAGER', 'report.hrGratuityProvision.view')
  ) AS g(role, code)
  JOIN "Permission" p ON p.code = g.code
 WHERE EXISTS (SELECT 1 FROM app_roles r WHERE r.code = g.role)
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- Copied grants: a new right goes to the roles that hold its counterpart today.
--   hr.leaving.apply      ← hr.payslip.own (every employee role)
--   hr.leaving.approve    ← hr.payroll.approve
--   hr.settlement.approve ← hr.payroll.approve
--   hr.settlement.post    ← hr.payroll.post (never HR_MANAGER: rule 5)
--   the three reports     ← report.hrPayrollSummary.view
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT np.id, g.role, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('hr.leaving.apply', 'hr.payslip.own'),
    ('hr.leaving.approve', 'hr.payroll.approve'),
    ('hr.settlement.approve', 'hr.payroll.approve'),
    ('hr.settlement.post', 'hr.payroll.post'),
    ('report.hrPayHistory.view', 'report.hrPayrollSummary.view'),
    ('report.hrPfLedger.view', 'report.hrPayrollSummary.view'),
    ('report.hrGratuityProvision.view', 'report.hrPayrollSummary.view')
  ) AS m(new_code, from_code)
  JOIN "Permission" fp ON fp.code = m.from_code
  JOIN "PermissionGrant" g ON g."permissionId" = fp.id AND g.allow AND g.role IS NOT NULL AND g."userId" IS NULL
  JOIN "Permission" np ON np.code = m.new_code
 WHERE NOT (m.new_code = 'hr.settlement.post' AND g.role = 'HR_MANAGER')
ON CONFLICT ("permissionId", "role") DO NOTHING;

COMMIT;
