-- ============================================================
-- Bizlogist ERP — columns and tables the features merged from the Eastland and
-- Accounting systems need (docs/merge/*.md). Every new behaviour is switched
-- on / off on Settings → Features (lib/features/catalog.js); with the features
-- at their defaults nothing here changes how the system behaves.
--
-- Additive and re-runnable (IF NOT EXISTS). Matches prisma/schema.prisma.
--   npx prisma db execute --file prisma/sql/2026-11-19_merge_eastland_accounting.sql --schema prisma/schema.prisma
-- ============================================================

-- Knock-off: returns naming no invoice are FIFO-matched (knockoff.matchReturns)
ALTER TYPE "KnockoffSourceType" ADD VALUE IF NOT EXISTS 'RETURN';

-- Sale Order lines: line type (trial billing), plan date / qty (plan from order), edit audit
ALTER TABLE "OrderDetail"
  ADD COLUMN IF NOT EXISTS "line_type"  VARCHAR(10) DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "plan_date"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "plan_qty"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "prev_qty"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "prev_rate"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "edited_by"  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "edited_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OrderMaster"
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Production Plan lines: Lab nature, rejected qty, timestamps (ISO timeline)
ALTER TABLE "ReqDetail"
  ADD COLUMN IF NOT EXISTS "nature"       VARCHAR(25),
  ADD COLUMN IF NOT EXISTS "nature_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_qty" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "created_at"   TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at"   TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ReqMaster"
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Voucher lines / documents
ALTER TABLE "Transactions"
  ADD COLUMN IF NOT EXISTS "line_type"        VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "plan_no"          INTEGER,
  ADD COLUMN IF NOT EXISTS "process_order_no" INTEGER,
  ADD COLUMN IF NOT EXISTS "sub_account"      VARCHAR(250),
  ADD COLUMN IF NOT EXISTS "cost_rate"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "tax_law_code"     INTEGER;
ALTER TABLE "TRANSACTIONS_MASTER"
  ADD COLUMN IF NOT EXISTS "dispatch_part" INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "invoiced_at"   TIMESTAMP(3);

-- Customer price list: shown on the Sale Order / ISO
ALTER TABLE "SALES_ITEM_CUST"
  ADD COLUMN IF NOT EXISTS "checked"    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS "updated_by" VARCHAR(50);

-- Items: GRN direct rate (grn.directRateByItem), reorder level, MOQ
ALTER TABLE "Item"
  ADD COLUMN IF NOT EXISTS "grn_direct_rate"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "re_order_level"         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "minimum_order_quantity" DOUBLE PRECISION;
ALTER TABLE "ItemCategory"
  ADD COLUMN IF NOT EXISTS "grn_direct_rate" BOOLEAN NOT NULL DEFAULT false;

-- Withholding tax: fractional rates, payable account per law
ALTER TABLE "TaxLaws"
  ADD COLUMN IF NOT EXISTS "tax_acno" INTEGER,
  ALTER COLUMN "rate_filer"     SET DATA TYPE DOUBLE PRECISION,
  ALTER COLUMN "rate_non_filer" SET DATA TYPE DOUBLE PRECISION;

-- Process orders: reprocessing that waits for Send to Production
ALTER TABLE "productionPlanMaster"
  ADD COLUMN IF NOT EXISTS "batch_required" BOOLEAN DEFAULT false;

-- New tables
CREATE TABLE IF NOT EXISTS "subAccount" (
  "id"     SERIAL       PRIMARY KEY,
  "acno"   INTEGER      NOT NULL,
  "acname" VARCHAR(250) NOT NULL
);
CREATE INDEX IF NOT EXISTS "subAccount_acno_idx" ON "subAccount"("acno");

CREATE TABLE IF NOT EXISTS "RmcInputRate" (
  "id"         SERIAL           PRIMARY KEY,
  "itcd"       INTEGER          NOT NULL,
  "rate"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updated_by" VARCHAR(50),
  "created_at" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "RmcInputRate_itcd_key" ON "RmcInputRate"("itcd");

CREATE TABLE IF NOT EXISTS "INPUT_FOR_PP" (
  "id"          SERIAL           PRIMARY KEY,
  "itcd"        INTEGER          NOT NULL,
  "period_type" TEXT             NOT NULL DEFAULT 'MONTHLY',
  "month"       INTEGER          NOT NULL DEFAULT 0,
  "quarter"     INTEGER          NOT NULL DEFAULT 0,
  "year"        INTEGER          NOT NULL,
  "qty"         DOUBLE PRECISION NOT NULL,
  "created_at"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "INPUT_FOR_PP_itcd_idx" ON "INPUT_FOR_PP"("itcd");
CREATE INDEX IF NOT EXISTS "INPUT_FOR_PP_month_year_idx" ON "INPUT_FOR_PP"("month", "year");
CREATE INDEX IF NOT EXISTS "INPUT_FOR_PP_quarter_year_idx" ON "INPUT_FOR_PP"("quarter", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "INPUT_FOR_PP_itcd_period_type_month_year_quarter_key"
  ON "INPUT_FOR_PP"("itcd", "period_type", "month", "year", "quarter");

-- Foreign keys (added once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Transactions_tax_law_code_fkey') THEN
    ALTER TABLE "Transactions" ADD CONSTRAINT "Transactions_tax_law_code_fkey"
      FOREIGN KEY ("tax_law_code") REFERENCES "TaxLaws"("tax_law_code") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxLaws_tax_acno_fkey') THEN
    ALTER TABLE "TaxLaws" ADD CONSTRAINT "TaxLaws_tax_acno_fkey"
      FOREIGN KEY ("tax_acno") REFERENCES "acno"("acno") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subAccount_acno_fkey') THEN
    ALTER TABLE "subAccount" ADD CONSTRAINT "subAccount_acno_fkey"
      FOREIGN KEY ("acno") REFERENCES "acno"("acno") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RmcInputRate_itcd_fkey') THEN
    ALTER TABLE "RmcInputRate" ADD CONSTRAINT "RmcInputRate_itcd_fkey"
      FOREIGN KEY ("itcd") REFERENCES "Item"("itcd") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'INPUT_FOR_PP_itcd_fkey') THEN
    ALTER TABLE "INPUT_FOR_PP" ADD CONSTRAINT "INPUT_FOR_PP_itcd_fkey"
      FOREIGN KEY ("itcd") REFERENCES "Item"("itcd") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
