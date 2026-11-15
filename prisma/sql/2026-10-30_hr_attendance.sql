-- ============================================================
-- HRMS Phase 1: shifts, holidays, attendance, punches, machines (2026-10-30)
-- ============================================================
--   hr_shifts             shift times and rules (grace, half day, overtime,
--                         lates-per-day cut, weekly off)
--   hr_shift_assignments  employee → shift from a date
--   hr_holidays           paid / unpaid holidays
--   hr_attendance         one row per employee per day that has anything recorded
--                         (a working day without a row is ABSENT; computed)
--   hr_punches            raw clock-ins from ZKTeco machines / imported files
--   hr_devices            ZKTeco machines (TCP 4370)
--   "Employee"."attendanceId"  user id on the machine (blank = employee id)
--
-- Also:
--   · shifts seeded from the legacy per-employee ON/OFF_DUTY_TIME and every
--     employee assigned to theirs (employees with no times → 08:00–17:00)
--   · HR permission codes (same as scripts/seed-permissions.mjs), granted to
--     the HR_MANAGER role; ADMIN / ACCOUNTANT pass every check anyway
--   · Settings hr.attendance.direct_edit_days = 2
--
-- Not applied by itself: run it, then `npx prisma generate`, then
--   node scripts/build-menus-sql.mjs && apply scripts/sql/menus-seed.sql
-- Do NOT use `prisma db push`. Wrapped in one transaction.
-- ============================================================

BEGIN;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "attendanceId" VARCHAR(30);

-- CreateTable
CREATE TABLE "hr_shifts" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "grace_minutes" INTEGER NOT NULL DEFAULT 10,
    "early_grace_minutes" INTEGER NOT NULL DEFAULT 10,
    "half_day_late_minutes" INTEGER NOT NULL DEFAULT 120,
    "half_day_minutes" INTEGER NOT NULL DEFAULT 240,
    "full_day_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_enabled" BOOLEAN NOT NULL DEFAULT true,
    "overtime_after_minutes" INTEGER NOT NULL DEFAULT 30,
    "lates_per_day_cut" INTEGER NOT NULL DEFAULT 3,
    "early_counts_as_late" BOOLEAN NOT NULL DEFAULT true,
    "week_off_days" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
    "color" VARCHAR(9) NOT NULL DEFAULT '#800000',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_shift_assignments" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "shift_id" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "week_off_override" BOOLEAN NOT NULL DEFAULT false,
    "week_off_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_holidays" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "shift_id" INTEGER,
    "check_in" TIMESTAMP(3),
    "check_out" TIMESTAMP(3),
    "status" VARCHAR(12) NOT NULL,
    "status_override" BOOLEAN NOT NULL DEFAULT false,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "early_minutes" INTEGER NOT NULL DEFAULT 0,
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    "remarks" VARCHAR(300),
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_by" VARCHAR(50),
    "updated_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_punches" (
    "id" SERIAL NOT NULL,
    "device_user_id" VARCHAR(30) NOT NULL,
    "employee_id" INTEGER,
    "punch_time" TIMESTAMP(3) NOT NULL,
    "device_id" INTEGER,
    "source" VARCHAR(10) NOT NULL DEFAULT 'DEVICE',
    "batch" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_devices" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "ip" VARCHAR(64) NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 4370,
    "location" VARCHAR(100),
    "auto_sync" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_ok" BOOLEAN,
    "last_sync_count" INTEGER NOT NULL DEFAULT 0,
    "last_sync_error" VARCHAR(300),
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_shifts_code_key" ON "hr_shifts"("code");

-- CreateIndex
CREATE INDEX "hr_shift_assignments_shift_id_idx" ON "hr_shift_assignments"("shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_shift_assignments_employee_id_effective_from_key" ON "hr_shift_assignments"("employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "hr_holidays_date_key" ON "hr_holidays"("date");

-- CreateIndex
CREATE INDEX "hr_attendance_date_idx" ON "hr_attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_employee_id_date_key" ON "hr_attendance"("employee_id", "date");

-- CreateIndex
CREATE INDEX "hr_punches_employee_id_punch_time_idx" ON "hr_punches"("employee_id", "punch_time");

-- CreateIndex
CREATE INDEX "hr_punches_punch_time_idx" ON "hr_punches"("punch_time");

-- CreateIndex
CREATE UNIQUE INDEX "hr_punches_device_user_id_punch_time_key" ON "hr_punches"("device_user_id", "punch_time");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_attendanceId_key" ON "Employee"("attendanceId");

-- AddForeignKey
ALTER TABLE "hr_shift_assignments" ADD CONSTRAINT "hr_shift_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_shift_assignments" ADD CONSTRAINT "hr_shift_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "hr_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "hr_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_punches" ADD CONSTRAINT "hr_punches_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "hr_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Seed shifts from the legacy employee times ──────────────────────────────
-- "8" → 08:00, "6.3" → 06:30, "6.15" → 06:15. An off time before the on time
-- that only makes sense as p.m. ("9" → "5") is read as 17:00; a real night
-- shift ("19" → "7") stays overnight.
CREATE TEMP TABLE _hr_emp_shift ON COMMIT DROP AS
WITH raw AS (
  SELECT e.id,
         NULLIF(btrim(e."onDutyTime"), '')  AS on_t,
         NULLIF(btrim(e."offDutyTime"), '') AS off_t,
         upper(COALESCE(e."weekOffDay", '')) AS wo
    FROM "Employee" e
), mins AS (
  SELECT id, wo,
         CASE WHEN on_t  ~ '^\d{1,2}(\.\d{1,2})?$'
              THEN split_part(on_t, '.', 1)::int * 60 + rpad(COALESCE(NULLIF(split_part(on_t, '.', 2), ''), '0'), 2, '0')::int END AS on_m,
         CASE WHEN off_t ~ '^\d{1,2}(\.\d{1,2})?$'
              THEN split_part(off_t, '.', 1)::int * 60 + rpad(COALESCE(NULLIF(split_part(off_t, '.', 2), ''), '0'), 2, '0')::int END AS off_m
    FROM raw
), fixed AS (
  SELECT id, wo,
         CASE WHEN on_m IS NULL OR off_m IS NULL OR on_m >= 1440 OR off_m >= 1440 THEN 480 ELSE on_m END AS on_m,
         CASE WHEN on_m IS NULL OR off_m IS NULL OR on_m >= 1440 OR off_m >= 1440 THEN 1020
              WHEN off_m < on_m AND on_m < 720 AND off_m + 720 > on_m THEN off_m + 720
              ELSE off_m END AS off_m
    FROM mins
)
SELECT id,
       lpad((on_m / 60)::text, 2, '0') || ':' || lpad((on_m % 60)::text, 2, '0')   AS start_time,
       lpad((off_m / 60)::text, 2, '0') || ':' || lpad((off_m % 60)::text, 2, '0') AS end_time,
       array_remove(ARRAY[
         CASE WHEN wo ~ 'SUN' THEN 0 END, CASE WHEN wo ~ 'MON' THEN 1 END,
         CASE WHEN wo ~ 'TUE' THEN 2 END, CASE WHEN wo ~ 'WED' THEN 3 END,
         CASE WHEN wo ~ 'THU' THEN 4 END, CASE WHEN wo ~ 'FRI' THEN 5 END,
         CASE WHEN wo ~ 'SAT' THEN 6 END], NULL) AS week_off
  FROM fixed;

INSERT INTO "hr_shifts" (code, name, start_time, end_time, color, created_by)
SELECT DISTINCT
       replace(start_time, ':', '') || '-' || replace(end_time, ':', ''),
       CASE WHEN end_time < start_time THEN 'Night ' ELSE 'Shift ' END || start_time || '–' || end_time,
       start_time, end_time,
       CASE WHEN end_time < start_time THEN '#1e3a8a' ELSE '#800000' END,
       'migration'
  FROM _hr_emp_shift
ON CONFLICT (code) DO NOTHING;

-- Everyone on their shift from the start; week-off kept where it differs from
-- the shift's Sunday.
INSERT INTO "hr_shift_assignments" (employee_id, shift_id, effective_from, week_off_override, week_off_days, created_by)
SELECT t.id, s.id, DATE '2000-01-01',
       cardinality(t.week_off) > 0 AND t.week_off <> ARRAY[0],
       CASE WHEN cardinality(t.week_off) > 0 AND t.week_off <> ARRAY[0] THEN t.week_off ELSE ARRAY[]::int[] END,
       'migration'
  FROM _hr_emp_shift t
  JOIN "hr_shifts" s ON s.code = replace(t.start_time, ':', '') || '-' || replace(t.end_time, ':', '')
ON CONFLICT (employee_id, effective_from) DO NOTHING;

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.attendance.view',    'HR', 'View attendance (daily register, monthly sheet, punches)', 152),
  ('hr.attendance.mark',    'HR', 'Mark / correct attendance (older days go for approval)', 153),
  ('hr.attendance.approve', 'HR', 'Approve attendance corrections; edit any day directly', 154),
  ('hr.attendance.import',  'HR', 'Import attendance files and sync attendance machines', 155),
  ('hr.devices.manage',     'HR', 'Add and edit attendance machines; map machine user ids', 156),
  ('hr.shifts.manage',      'HR', 'Create shifts, assign them to employees, set attendance rules', 157),
  ('hr.holidays.manage',    'HR', 'Add and remove holidays', 158)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, 'HR_MANAGER'::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 WHERE p.code LIKE 'hr.%'
ON CONFLICT ("permissionId", "role") DO NOTHING;

-- ── Attendance rules ────────────────────────────────────────────────────────
-- Days back (including today) a holder of hr.attendance.mark may change
-- directly; older days go to Approvals. Edited on HR → Shifts → Rules.
INSERT INTO "Settings" (key, value, description, last_updated)
VALUES ('hr.attendance.direct_edit_days', '2', 'HR: days back attendance may be changed without approval', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

COMMIT;
