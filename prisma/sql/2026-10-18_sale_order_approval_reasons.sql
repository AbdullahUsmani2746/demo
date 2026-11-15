-- ============================================================
-- Sale Order approval reasons — 2026-10-18
-- ============================================================
-- New reasons that send a Sale Order to CEO approval (status 3):
--   · No Godown               (OrderMaster.noGodown)
--   · Rate Under Negotiation  (OrderMaster.rateUnderNegotiation)
--   · Customer Bad Debt / Bad Payment (from acno.customer_status, not stored)
-- OrderMaster.approval_reasons keeps the reasons as text for the approval
-- screen and notifications. Rules: lib/orders/saleOrderApprovalRules.js
--
-- Additive only and safe to re-run.
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-18_sale_order_approval_reasons.sql --schema prisma/schema.prisma
-- then:
--   npx prisma generate
--
-- Do NOT use `prisma db push`: the live database holds tables that are not
-- in schema.prisma (stg_tran_detail, stg_tran_master) and db push drops them.
-- ============================================================

ALTER TABLE "OrderMaster" ADD COLUMN IF NOT EXISTS "noGodown" BOOLEAN DEFAULT false;
ALTER TABLE "OrderMaster" ADD COLUMN IF NOT EXISTS "rateUnderNegotiation" BOOLEAN DEFAULT false;
ALTER TABLE "OrderMaster" ADD COLUMN IF NOT EXISTS "approval_reasons" VARCHAR(300);

-- Orders already waiting: record why, from their existing flags.
UPDATE "OrderMaster"
SET "approval_reasons" = CASE WHEN "trialProcess" = true THEN 'Trial Process' ELSE 'Free of Cost' END
WHERE "order_catagory" = 6 AND "status" = 3 AND "approval_reasons" IS NULL;

-- Permission label now covers every reason.
UPDATE "Permission"
SET "label" = 'Approve sale orders needing CEO approval (Free of Cost, Trial, No Godown, Rate Under Negotiation, Bad Debt / Bad Payment customer)'
WHERE "code" = 'saleOrder.approve';
