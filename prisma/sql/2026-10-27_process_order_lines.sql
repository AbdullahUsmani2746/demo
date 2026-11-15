-- ============================================================
-- Process Order: multiple production items — 2026-10-27
-- ============================================================
-- Process Order screen (/accounting/material?tab=production) lets one process
-- order produce SEVERAL finished items, each with its own issuances.
--
--   "productionPlanOutput"  one row per production (finished) item
--     line_no      1-based; line 1 is mirrored on productionPlanMaster
--                  (finished_id / qty / batch_no / bom_id / actual_yield)
--     godown       godown the finished item is produced into (tran_code 8)
--     unit         display / posting unit (default KG)
--
--   "productionPlanIssue"   issue godown / unit of one productionPlanDetail
--                           row + which production item it is issued for
--     output_line  productionPlanOutput.line_no
--
-- Posted vouchers carry the link in "Transactions".source_line_no
-- (tran_code 7 line → output_line, tran_code 8 line → line_no).
--
-- Process orders saved before this script (and any saved while it is not yet
-- applied) have no rows here: they read as ONE production item = the master,
-- materials issued from PRODUCTION (godown 2), unit KG — exactly as before.
--
-- Additive and idempotent (a re-run changes nothing). Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-27_process_order_lines.sql --schema prisma/schema.prisma
-- then:
--   npx prisma generate
-- Do NOT use `prisma db push`.
-- ============================================================

CREATE TABLE IF NOT EXISTS "productionPlanOutput" (
  id            SERIAL PRIMARY KEY,
  plan_id       INTEGER NOT NULL,
  line_no       INTEGER NOT NULL,
  finished_id   INTEGER,
  bom_id        INTEGER,
  qty           DOUBLE PRECISION,
  actual_yield  DOUBLE PRECISION,
  unit          VARCHAR(25),
  godown        INTEGER,
  batch_no      VARCHAR(50)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productionPlanOutput_plan_id_fkey') THEN
    ALTER TABLE "productionPlanOutput"
      ADD CONSTRAINT "productionPlanOutput_plan_id_fkey"
      FOREIGN KEY (plan_id) REFERENCES "productionPlanMaster"(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "productionPlanOutput_plan_id_line_no_key"
  ON "productionPlanOutput" (plan_id, line_no);
CREATE INDEX IF NOT EXISTS "productionPlanOutput_finished_id_idx"
  ON "productionPlanOutput" (finished_id);

CREATE TABLE IF NOT EXISTS "productionPlanIssue" (
  id           SERIAL PRIMARY KEY,
  plan_id      INTEGER NOT NULL,
  detail_id    INTEGER NOT NULL,
  output_line  INTEGER NOT NULL DEFAULT 1,
  godown       INTEGER,
  unit         VARCHAR(25)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productionPlanIssue_plan_id_fkey') THEN
    ALTER TABLE "productionPlanIssue"
      ADD CONSTRAINT "productionPlanIssue_plan_id_fkey"
      FOREIGN KEY (plan_id) REFERENCES "productionPlanMaster"(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productionPlanIssue_detail_id_fkey') THEN
    ALTER TABLE "productionPlanIssue"
      ADD CONSTRAINT "productionPlanIssue_detail_id_fkey"
      FOREIGN KEY (detail_id) REFERENCES "productionPlanDetail"(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "productionPlanIssue_detail_id_key"
  ON "productionPlanIssue" (detail_id);
CREATE INDEX IF NOT EXISTS "productionPlanIssue_plan_id_idx"
  ON "productionPlanIssue" (plan_id);

COMMENT ON TABLE "productionPlanOutput" IS
  'Production (finished) items of a process order. Line 1 mirrors productionPlanMaster. Posted tran_code 8 lines: Transactions.source_line_no = line_no.';
COMMENT ON TABLE "productionPlanIssue" IS
  'Issue godown / unit of a productionPlanDetail row and the production item (output_line) it is issued for. Posted tran_code 7 lines: Transactions.source_line_no = output_line.';
