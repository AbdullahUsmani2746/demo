-- ============================================================
-- HRMS Phase 2: leave management (2026-10-31)
-- ============================================================
-- Needs 2026-10-30_hr_attendance.sql applied first.
--
--   hr_leave_types       leave types and their policy (paid, days a year,
--                        accrual, service needed, carry-forward, half days …)
--   hr_leave_balances    per employee / type / leave year: carry-forward and
--                        adjustments (entitlement is computed, never stored)
--   hr_leave_requests    applications; approved → days written to hr_attendance
--   hr_attendance        + leave_type_id, leave_half, leave_request_id
--                        (leave USED = attendance rows with a leave type)
--
-- Also:
--   · five starting leave types (all editable on HR → Leave → Leave types)
--   · permissions hr.leave.* — all to HR_MANAGER; "apply for own leave"
--     to every role (ADMIN / ACCOUNTANT pass every check anyway)
--   · Settings hr.leave.year_start_month = 1 (leave year = calendar year)
--   · the old "LEAVES" setup menu is hidden (scripts/sql/menus-seed.sql)
--
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-31_hr_leave.sql --schema prisma/schema.prisma
-- then `npx prisma generate`. Do NOT use `prisma db push`. One transaction.
-- ============================================================

BEGIN;

-- AlterTable
ALTER TABLE "hr_attendance" ADD COLUMN     "leave_half" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leave_request_id" INTEGER,
ADD COLUMN     "leave_type_id" INTEGER;

-- CreateTable
CREATE TABLE "hr_leave_types" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "annual_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accrual" VARCHAR(10) NOT NULL DEFAULT 'YEARLY',
    "prorate_joiners" BOOLEAN NOT NULL DEFAULT true,
    "min_service_days" INTEGER NOT NULL DEFAULT 0,
    "max_carry_forward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "allow_half_day" BOOLEAN NOT NULL DEFAULT true,
    "count_off_days" BOOLEAN NOT NULL DEFAULT false,
    "max_days_per_request" DOUBLE PRECISION,
    "gender" VARCHAR(10),
    "color" VARCHAR(9) NOT NULL DEFAULT '#0284c7',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_balances" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "leave_type_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "carry_forward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" VARCHAR(300),
    "updated_by" VARCHAR(50),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_requests" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "leave_type_id" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "half_day" BOOLEAN NOT NULL DEFAULT false,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" VARCHAR(500),
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "approval_request_id" INTEGER,
    "requested_by" VARCHAR(50) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" VARCHAR(50),
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(500),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_types_code_key" ON "hr_leave_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_balances_employee_id_leave_type_id_year_key" ON "hr_leave_balances"("employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "hr_leave_requests_employee_id_from_date_idx" ON "hr_leave_requests"("employee_id", "from_date");

-- CreateIndex
CREATE INDEX "hr_leave_requests_status_idx" ON "hr_leave_requests"("status");

-- CreateIndex
CREATE INDEX "hr_attendance_leave_type_id_idx" ON "hr_attendance"("leave_type_id");

-- CreateIndex
CREATE INDEX "hr_attendance_leave_request_id_idx" ON "hr_attendance"("leave_request_id");

-- AddForeignKey
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "hr_leave_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Starting leave types ────────────────────────────────────────────────────
INSERT INTO "hr_leave_types"
  (code, name, is_paid, annual_days, accrual, prorate_joiners, min_service_days, max_carry_forward,
   allow_negative, allow_half_day, count_off_days, max_days_per_request, gender, color, sort)
VALUES
  ('CL', 'Casual leave',    true,  10, 'YEARLY', true,  0,   0,  false, true,  false, 3,    NULL,     '#0284c7', 1),
  ('SL', 'Sick leave',      true,   8, 'YEARLY', true,  0,   0,  false, true,  false, NULL, NULL,     '#16a34a', 2),
  ('AL', 'Annual leave',    true,  14, 'YEARLY', true,  365, 14, false, false, false, NULL, NULL,     '#7c3aed', 3),
  ('UL', 'Unpaid leave',    false,  0, 'YEARLY', false, 0,   0,  true,  true,  false, NULL, NULL,     '#64748b', 4),
  ('ML', 'Maternity leave', true,  90, 'YEARLY', false, 0,   0,  false, false, true,  90,   'Female', '#db2777', 5)
ON CONFLICT (code) DO NOTHING;

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.leave.apply',   'HR', 'Apply for own leave; see own balances', 159),
  ('hr.leave.view',    'HR', 'View everyone''s leave, balances and the leave calendar', 160),
  ('hr.leave.manage',  'HR', 'Apply leave for others, adjust balances, carry forward, edit leave types', 161),
  ('hr.leave.approve', 'HR', 'Approve or reject leave requests', 162)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, 'HR_MANAGER'::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 WHERE p.code LIKE 'hr.leave.%'
ON CONFLICT ("permissionId", "role") DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, r.role::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 CROSS JOIN (VALUES ('MANAGER'), ('CASHIER'), ('SALES'), ('EMPLOYEE')) AS r(role)
 WHERE p.code = 'hr.leave.apply'
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- ── Leave year ──────────────────────────────────────────────────────────────
INSERT INTO "Settings" (key, value, description, last_updated)
VALUES ('hr.leave.year_start_month', '1', 'HR: month the leave year starts (1 = January, 7 = July)', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

COMMIT;
