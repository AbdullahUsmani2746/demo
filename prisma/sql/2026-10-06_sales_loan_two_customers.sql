-- ============================================================
-- Sales Loan Register: loans are between TWO customers — 2026-10-06
-- ============================================================
-- Goods out of customer A's (acno) Sale Order are given to customer B
-- (to_acno). to_sales_person lets B's sales person see the loan too.
-- Additive only and safe to re-run.
--   npx prisma db execute --file prisma/sql/2026-10-06_sales_loan_two_customers.sql --schema prisma/schema.prisma
-- Do NOT use `prisma db push` (it would drop stg_tran_detail / stg_tran_master).
-- ============================================================

ALTER TABLE "SALES_LOAN" ADD COLUMN IF NOT EXISTS "to_acno" INTEGER;
ALTER TABLE "SALES_LOAN" ADD COLUMN IF NOT EXISTS "to_sales_person" VARCHAR(50);
CREATE INDEX IF NOT EXISTS "SALES_LOAN_to_acno_idx" ON "SALES_LOAN"("to_acno");
CREATE INDEX IF NOT EXISTS "SALES_LOAN_to_sales_person_idx" ON "SALES_LOAN"("to_sales_person");
