-- ============================================================
-- HRMS Phase 4: payroll, payslips, income-tax slabs (2026-11-02)
-- ============================================================
-- Needs the Phase 1–3 scripts applied first (2026-10-30, -31, 2026-11-01).
--
--   hr_payroll_runs   a month's payroll: DRAFT → PENDING → APPROVED → POSTED (→ REVERSED)
--   hr_payslips       one employee in a run: full calculation + figures for the journal
--   hr_tax_slabs      salaried income-tax slabs per fiscal year (July–June)
--
-- Also:
--   · tax slabs for FY 2025-26 and FY 2026-27 = the salaried slabs of the
--     Finance Act 2025. CHECK FY 2026-27 against the Finance Act 2026 and
--     correct them on HR → Payroll → Income tax before the first payroll.
--   · permissions hr.payroll.* → HR_MANAGER; hr.payslip.own → every role
--   · payroll rules in Settings (days divisor 30, overtime 200 % of the
--     gross hourly rate at 8 h a day, EOBI 1 % / 5 % of a 40,000 minimum
--     wage, surcharge 9 % above 10,000,000) — all editable on HR → Payroll → Rules
--   · the payroll accounts are NOT seeded: set them on Finance → Account
--     Settings → Payroll (posting is refused, naming what is missing, until then)
--
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-11-02_hr_payroll.sql --schema prisma/schema.prisma
-- then `npx prisma generate`. Do NOT use `prisma db push`. One transaction.
-- ============================================================

BEGIN;

-- CreateTable
CREATE TABLE "hr_payroll_runs" (
    "id" SERIAL NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "title" VARCHAR(150),
    "pay_date" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(500),
    "employees" INTEGER NOT NULL DEFAULT 0,
    "total_earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_net" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_employer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approval_request_id" INTEGER,
    "jv_tran_id" INTEGER,
    "jv_vr_no" INTEGER,
    "reversal_tran_id" INTEGER,
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_at" TIMESTAMP(3),
    "submitted_by" VARCHAR(50),
    "submitted_at" TIMESTAMP(3),
    "decided_by" VARCHAR(50),
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(500),
    "posted_by" VARCHAR(50),
    "posted_at" TIMESTAMP(3),
    "reversed_by" VARCHAR(50),
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" VARCHAR(500),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payslips" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "data" JSONB NOT NULL,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "loan_overrides" JSONB NOT NULL DEFAULT '{}',
    "hold" BOOLEAN NOT NULL DEFAULT false,
    "paid_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "income_tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eobi_employee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eobi_employer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "hr_payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_tax_slabs" (
    "id" SERIAL NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "from_amount" DOUBLE PRECISION NOT NULL,
    "to_amount" DOUBLE PRECISION,
    "fixed_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rate_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "hr_tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_payroll_runs_month_idx" ON "hr_payroll_runs"("month");

-- CreateIndex
CREATE INDEX "hr_payroll_runs_status_idx" ON "hr_payroll_runs"("status");

-- CreateIndex
CREATE INDEX "hr_payslips_employee_id_month_idx" ON "hr_payslips"("employee_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payslips_run_id_employee_id_key" ON "hr_payslips"("run_id", "employee_id");

-- CreateIndex
CREATE INDEX "hr_tax_slabs_fiscal_year_idx" ON "hr_tax_slabs"("fiscal_year");

-- AddForeignKey
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "hr_payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Income-tax slabs (salaried) ─────────────────────────────────────────────
-- tax = fixed_amount + rate_percent % of yearly taxable income above from_amount
INSERT INTO "hr_tax_slabs" (fiscal_year, from_amount, to_amount, fixed_amount, rate_percent)
SELECT fy, s.from_amount, s.to_amount, s.fixed_amount, s.rate_percent
  FROM (VALUES (2025), (2026)) AS y(fy)
 CROSS JOIN (VALUES
   (0::float8,       600000::float8,  0::float8,      0::float8),
   (600000,          1200000,         0,              1),
   (1200000,         2200000,         6000,           11),
   (2200000,         3200000,         116000,         23),
   (3200000,         4100000,         346000,         30),
   (4100000,         NULL,            616000,         35)
 ) AS s(from_amount, to_amount, fixed_amount, rate_percent)
 WHERE NOT EXISTS (SELECT 1 FROM "hr_tax_slabs" t WHERE t.fiscal_year = y.fy);

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.payroll.view',    'HR', 'View payroll runs and payslips', 170),
  ('hr.payroll.manage',  'HR', 'Create and calculate payroll, adjust payslips, submit for approval, income-tax slabs and payroll rules', 171),
  ('hr.payroll.approve', 'HR', 'Approve or reject a payroll run', 172),
  ('hr.payroll.post',    'HR', 'Post an approved payroll to accounts (journal voucher) and reverse it', 173),
  ('hr.payslip.own',     'HR', 'See own payslips', 174)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, 'HR_MANAGER'::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 WHERE p.code LIKE 'hr.payroll.%' OR p.code = 'hr.payslip.own'
ON CONFLICT ("permissionId", "role") DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, r.role::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 CROSS JOIN (VALUES ('MANAGER'), ('CASHIER'), ('SALES'), ('EMPLOYEE')) AS r(role)
 WHERE p.code = 'hr.payslip.own'
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- ── Payroll rules ───────────────────────────────────────────────────────────
INSERT INTO "Settings" (key, value, description, last_updated) VALUES
  ('hr.payroll.days_divisor',       '30',       'HR: a day''s pay = monthly ÷ this (0 = days in the month)', CURRENT_TIMESTAMP),
  ('hr.payroll.no_attendance_full', '1',        'HR: nothing marked all month — 1 = pay the full month, 0 = absent', CURRENT_TIMESTAMP),
  ('hr.ot.rate_percent',            '200',      'HR: overtime rate, % of the ordinary hourly rate', CURRENT_TIMESTAMP),
  ('hr.ot.hours_per_day',           '8',        'HR: hours in a working day (overtime hourly rate)', CURRENT_TIMESTAMP),
  ('hr.ot.base_gross',              '1',        'HR: overtime hourly rate from 1 = gross, 0 = basic', CURRENT_TIMESTAMP),
  ('hr.eobi.min_wage',              '40000',    'HR: minimum wage EOBI is worked on', CURRENT_TIMESTAMP),
  ('hr.eobi.employee_percent',      '1',        'HR: EOBI employee share, % of minimum wage', CURRENT_TIMESTAMP),
  ('hr.eobi.employer_percent',      '5',        'HR: EOBI employer share, % of minimum wage', CURRENT_TIMESTAMP),
  ('hr.tax.surcharge_threshold',    '10000000', 'HR: income-tax surcharge above this yearly taxable income', CURRENT_TIMESTAMP),
  ('hr.tax.surcharge_percent',      '9',        'HR: income-tax surcharge, % of the tax', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

COMMIT;
