-- ============================================================
-- HRMS: off-day swaps and comp-off (2026-11-14)
-- ============================================================
-- Needs the 2026-10-30 / 2026-10-31 HR files applied first.
--
--   hr_off_swaps                planned: "works <work_date> (a week-off /
--                               holiday), off on <off_date> instead" —
--                               approved through Approvals (hrOffSwap); the
--                               attendance sheet reads <work_date> as a working
--                               day and <off_date> as a week-off
--                               (lib/hr/attendance/swaps.js)
--   hr_shifts.off_day_work      unplanned work on a week-off / holiday:
--                               'COMP_OFF' (default) = earns a comp-off day
--                               (½ for half a day), no overtime;
--                               'OVERTIME' = the old way, every minute overtime
--   hr_leave_types.comp_off     this leave type is spent from comp-off days
--                               earned, not from a yearly entitlement
--   hr_leave_types.comp_off_valid_days
--                               a comp-off day must be taken within this many
--                               days of earning it (30)
--   + leave type COMP_OFF "Comp off" (paid, half days allowed)
--
-- Rights: requesting a swap = hr.attendance.mark, approving = hr.attendance.approve
-- (existing codes — nothing to seed).
--
-- Additive and re-runnable. Apply with:
--   npx prisma db execute --file prisma/sql/2026-11-14_hr_off_swaps_comp_off.sql --schema prisma/schema.prisma
-- ============================================================

BEGIN;

ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "off_day_work" VARCHAR(10) NOT NULL DEFAULT 'COMP_OFF';

ALTER TABLE "hr_leave_types" ADD COLUMN IF NOT EXISTS "comp_off" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_leave_types" ADD COLUMN IF NOT EXISTS "comp_off_valid_days" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS "hr_off_swaps" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "work_date" DATE NOT NULL,
    "off_date" DATE NOT NULL,
    "reason" VARCHAR(500),
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "approval_request_id" INTEGER,
    "requested_by" VARCHAR(50) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" VARCHAR(50),
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(500),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_off_swaps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hr_off_swaps_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "hr_off_swaps_employee_id_work_date_idx" ON "hr_off_swaps"("employee_id", "work_date");
CREATE INDEX IF NOT EXISTS "hr_off_swaps_employee_id_off_date_idx" ON "hr_off_swaps"("employee_id", "off_date");
CREATE INDEX IF NOT EXISTS "hr_off_swaps_status_idx" ON "hr_off_swaps"("status");

INSERT INTO "hr_leave_types" ("code", "name", "is_paid", "annual_days", "accrual", "prorate_joiners", "allow_half_day", "comp_off", "comp_off_valid_days", "color", "sort", "updated_at")
VALUES ('COMP_OFF', 'Comp off', true, 0, 'YEARLY', false, true, true, 30, '#7c3aed', 15, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

COMMIT;
