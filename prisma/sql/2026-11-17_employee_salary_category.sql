-- Salary category per employee: DIRECT / INDIRECT (labour working on the
-- product vs. support staff). Employee page → Job. Optional.
-- Additive and re-runnable.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS salary_category VARCHAR(10);
