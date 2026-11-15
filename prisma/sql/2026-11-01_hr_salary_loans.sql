-- ============================================================
-- HRMS Phase 3: salary structures, pay components, advances & loans (2026-11-01)
-- ============================================================
-- Independent of the Phase 1 / 2 scripts (only needs "Employee").
--
--   hr_pay_components     allowances / deductions (fixed or % of basic)
--   hr_salary_structures  employee salary from a date (revisions wait for approval)
--   hr_salary_lines       its allowances / deductions
--   hr_loans              salary advances and loans, instalment plan
--   hr_loan_recoveries    payroll / cash repayments
--   hr_loan_events        each loan's timeline
--
-- Also:
--   · starting pay components (all editable on HR → Salary → Pay components)
--   · every employee with "Employee".rate > 0 gets a salary structure in force
--     from the start: basic = rate, plus "Other allowance" = the legacy
--     ALLOWNCE ("allowanceAmount") where there is one
--   · permissions hr.salary.* / hr.loan.* — all to HR_MANAGER; "apply for own
--     advance / loan" to every role
--   · Settings hr.loan.max_installments = 24, hr.loan.advance_limit_percent = 50,
--     hr.loan.loan_limit_months = 3
--
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-11-01_hr_salary_loans.sql --schema prisma/schema.prisma
-- then `npx prisma generate`. Do NOT use `prisma db push`. One transaction.
-- ============================================================

BEGIN;

-- CreateTable
CREATE TABLE "hr_pay_components" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "calc" VARCHAR(15) NOT NULL DEFAULT 'FIXED',
    "default_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "prorate" BOOLEAN NOT NULL DEFAULT true,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "gl_acno" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_pay_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_salary_structures" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "basic" DOUBLE PRECISION NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'active',
    "reason" VARCHAR(500),
    "approval_request_id" INTEGER,
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" VARCHAR(50),
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(500),

    CONSTRAINT "hr_salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_salary_lines" (
    "id" SERIAL NOT NULL,
    "structure_id" INTEGER NOT NULL,
    "component_id" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "hr_salary_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_loans" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "installment" DOUBLE PRECISION NOT NULL,
    "start_month" VARCHAR(7) NOT NULL,
    "skip_months" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" VARCHAR(500),
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "approval_request_id" INTEGER,
    "disbursed_on" DATE,
    "disbursement_ref" VARCHAR(60),
    "requested_by" VARCHAR(50) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" VARCHAR(50),
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(500),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_loan_recoveries" (
    "id" SERIAL NOT NULL,
    "loan_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "month" VARCHAR(7),
    "amount" DOUBLE PRECISION NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "reference" VARCHAR(60),
    "payroll_id" INTEGER,
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_loan_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_loan_events" (
    "id" SERIAL NOT NULL,
    "loan_id" INTEGER NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "detail" VARCHAR(500),
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_loan_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_pay_components_code_key" ON "hr_pay_components"("code");

-- CreateIndex
CREATE INDEX "hr_salary_structures_employee_id_effective_from_idx" ON "hr_salary_structures"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "hr_salary_structures_status_idx" ON "hr_salary_structures"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_salary_lines_structure_id_component_id_key" ON "hr_salary_lines"("structure_id", "component_id");

-- CreateIndex
CREATE INDEX "hr_loans_employee_id_idx" ON "hr_loans"("employee_id");

-- CreateIndex
CREATE INDEX "hr_loans_status_idx" ON "hr_loans"("status");

-- CreateIndex
CREATE INDEX "hr_loan_recoveries_loan_id_idx" ON "hr_loan_recoveries"("loan_id");

-- CreateIndex
CREATE INDEX "hr_loan_events_loan_id_idx" ON "hr_loan_events"("loan_id");

-- AddForeignKey
ALTER TABLE "hr_salary_structures" ADD CONSTRAINT "hr_salary_structures_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_lines" ADD CONSTRAINT "hr_salary_lines_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "hr_salary_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_lines" ADD CONSTRAINT "hr_salary_lines_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "hr_pay_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_loans" ADD CONSTRAINT "hr_loans_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_loan_recoveries" ADD CONSTRAINT "hr_loan_recoveries_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "hr_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_loan_events" ADD CONSTRAINT "hr_loan_events_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "hr_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Starting pay components ─────────────────────────────────────────────────
INSERT INTO "hr_pay_components" (code, name, kind, calc, default_value, prorate, taxable, sort) VALUES
  ('HRA',  'House rent allowance', 'EARNING',   'PERCENT_BASIC', 0, true,  true,  1),
  ('CONV', 'Conveyance allowance', 'EARNING',   'FIXED',         0, true,  true,  2),
  ('MED',  'Medical allowance',    'EARNING',   'FIXED',         0, true,  false, 3),
  ('MOB',  'Mobile allowance',     'EARNING',   'FIXED',         0, false, true,  4),
  ('OTH',  'Other allowance',      'EARNING',   'FIXED',         0, true,  true,  5),
  ('OTHD', 'Other deduction',      'DEDUCTION', 'FIXED',         0, false, true,  20)
ON CONFLICT (code) DO NOTHING;

-- ── Current salaries from the employee master ───────────────────────────────
INSERT INTO "hr_salary_structures" (employee_id, effective_from, basic, status, reason, created_by)
SELECT e.id, DATE '2000-01-01', e.rate, 'active', 'Opening salary from the employee master', 'migration'
  FROM "Employee" e
 WHERE e.rate > 0
   AND NOT EXISTS (SELECT 1 FROM "hr_salary_structures" s WHERE s.employee_id = e.id);

INSERT INTO "hr_salary_lines" (structure_id, component_id, value)
SELECT s.id, c.id, e."allowanceAmount"
  FROM "hr_salary_structures" s
  JOIN "Employee" e ON e.id = s.employee_id
  JOIN "hr_pay_components" c ON c.code = 'OTH'
 WHERE s.created_by = 'migration' AND e."allowanceAmount" > 0
ON CONFLICT (structure_id, component_id) DO NOTHING;

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.salary.view',    'HR', 'View salaries and pay components', 163),
  ('hr.salary.manage',  'HR', 'Revise salaries (goes to approval) and edit pay components', 164),
  ('hr.salary.approve', 'HR', 'Approve salary revisions; revise salaries directly', 165),
  ('hr.loan.apply',     'HR', 'Apply for own salary advance / loan; see own loans', 166),
  ('hr.loan.view',      'HR', 'View everyone''s advances and loans', 167),
  ('hr.loan.manage',    'HR', 'Apply for others, record repayments, skip or reschedule instalments', 168),
  ('hr.loan.approve',   'HR', 'Approve or reject advances and loans', 169)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, 'HR_MANAGER'::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 WHERE p.code LIKE 'hr.salary.%' OR p.code LIKE 'hr.loan.%'
ON CONFLICT ("permissionId", "role") DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, r.role::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 CROSS JOIN (VALUES ('MANAGER'), ('CASHIER'), ('SALES'), ('EMPLOYEE')) AS r(role)
 WHERE p.code = 'hr.loan.apply'
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- ── Loan rules ──────────────────────────────────────────────────────────────
INSERT INTO "Settings" (key, value, description, last_updated) VALUES
  ('hr.loan.max_installments',      '24', 'HR: most monthly instalments a loan may run', CURRENT_TIMESTAMP),
  ('hr.loan.advance_limit_percent', '50', 'HR: advances above this % of gross salary are flagged to the approver', CURRENT_TIMESTAMP),
  ('hr.loan.loan_limit_months',     '3',  'HR: loans above this many months of gross salary are flagged to the approver', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

COMMIT;
