-- Employee payment method "Through a person": the salary is handed to another
-- employee who pays the person (record only — lib/hr/paymentMethods.js).
-- Feature hr.paidThroughPerson (Settings → Features, default OFF) — from SMS.
-- NOTE: ALTER TYPE … ADD VALUE cannot run inside a transaction block on older
-- PostgreSQL; run this file as it is (no BEGIN / COMMIT).
-- Additive and re-runnable.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'THROUGH_PERSON';

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS paid_through_id INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_paid_through_id_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_paid_through_id_fkey"
      FOREIGN KEY (paid_through_id) REFERENCES "Employee"(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Employee_paid_through_id_idx" ON "Employee"(paid_through_id);
