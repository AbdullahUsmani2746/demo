-- =====================================================================
-- ProductionCostEntry.output_line — one cost per process order PER PRODUCTION
-- ITEM (productionPlanOutput.line_no). An order that makes two items (a product and
-- a by-product) was costed as if all its output were the first item.
-- Existing entries become line 1. "One entry per order" becomes "one per
-- order + line". Additive, re-runnable; no figures change.
-- =====================================================================
BEGIN;
ALTER TABLE "ProductionCostEntry" ADD COLUMN IF NOT EXISTS output_line INTEGER NOT NULL DEFAULT 1;
DROP INDEX IF EXISTS "ProductionCostEntry_plan_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ProductionCostEntry_plan_id_output_line_key"
  ON "ProductionCostEntry" (plan_id, output_line);
COMMIT;
