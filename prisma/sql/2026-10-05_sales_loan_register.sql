-- ============================================================
-- Sales Loan Register — 2026-10-05
-- ============================================================
-- Creates the three SALES_LOAN tables and the menu entry under SALES.
-- Additive only and safe to re-run (IF NOT EXISTS / NOT EXISTS guards).
--
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-05_sales_loan_register.sql --schema prisma/schema.prisma
--
-- Do NOT use `prisma db push` for this: the live database holds tables that
-- are not in schema.prisma (stg_tran_detail, stg_tran_master) and db push
-- would drop them.
-- ============================================================

CREATE TABLE IF NOT EXISTS "SALES_LOAN" (
    "id" SERIAL NOT NULL,
    "acno" INTEGER NOT NULL,
    "sales_person" VARCHAR(50),
    "so_no" INTEGER,
    "dispatch_tran_id" INTEGER,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "expected_return_date" TIMESTAMP(3),
    "purpose" VARCHAR(500),
    "remarks" VARCHAR(1000),
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SALES_LOAN_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SALES_LOAN_LINE" (
    "id" SERIAL NOT NULL,
    "loan_id" INTEGER NOT NULL,
    "itcd" INTEGER NOT NULL,
    "qty_issued" DOUBLE PRECISION NOT NULL,
    "unit" VARCHAR(25),
    CONSTRAINT "SALES_LOAN_LINE_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SALES_LOAN_LINE_loan_id_fkey" FOREIGN KEY ("loan_id")
        REFERENCES "SALES_LOAN"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SALES_LOAN_RETURN" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "return_date" TIMESTAMP(3) NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "remarks" VARCHAR(500),
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SALES_LOAN_RETURN_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SALES_LOAN_RETURN_line_id_fkey" FOREIGN KEY ("line_id")
        REFERENCES "SALES_LOAN_LINE"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SALES_LOAN_acno_idx" ON "SALES_LOAN"("acno");
CREATE INDEX IF NOT EXISTS "SALES_LOAN_sales_person_idx" ON "SALES_LOAN"("sales_person");
CREATE INDEX IF NOT EXISTS "SALES_LOAN_issue_date_idx" ON "SALES_LOAN"("issue_date");
CREATE INDEX IF NOT EXISTS "SALES_LOAN_so_no_idx" ON "SALES_LOAN"("so_no");
CREATE INDEX IF NOT EXISTS "SALES_LOAN_LINE_loan_id_idx" ON "SALES_LOAN_LINE"("loan_id");
CREATE INDEX IF NOT EXISTS "SALES_LOAN_LINE_itcd_idx" ON "SALES_LOAN_LINE"("itcd");
CREATE INDEX IF NOT EXISTS "SALES_LOAN_RETURN_line_id_idx" ON "SALES_LOAN_RETURN"("line_id");
CREATE INDEX IF NOT EXISTS "SALES_LOAN_RETURN_return_date_idx" ON "SALES_LOAN_RETURN"("return_date");

-- Menu: SALES → LOANS, right after TARGETS. Anyone who has the SALES menu
-- gets it automatically (children of an assigned menu are included).
INSERT INTO "menus" ("title", "url", "icon", "parent_id", "order_no", "is_active")
SELECT 'LOANS', '/accounting/forms/salesLoans', 'HandCoins', p.id, 4, true
FROM "menus" p
WHERE p.title = 'SALES' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM "menus" m WHERE m.url = '/accounting/forms/salesLoans');
