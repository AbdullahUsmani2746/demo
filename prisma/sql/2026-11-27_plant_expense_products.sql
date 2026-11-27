-- =====================================================================
-- Which products get plant expenses (overhead) in Costing → Production —
-- data, not code:
--   Item.gets_plant_expenses          tick a product (Item setup)
--   ItemCategory.gets_plant_expenses  tick a whole group (Item Category setup)
-- A product made on a process order shares the month's plant expenses when it
-- OR its category is ticked; nothing ticked anywhere = every process-order
-- product shares. Read only through lib/costing/plantExpenseProducts.js.
-- Plant expenses as a whole: Settings → Features "costing.plantOverhead";
-- used by the "item" costing engine (Settings → Features "costing.engine").
-- Nothing is ticked here — each company ticks its own. Additive, re-runnable.
-- =====================================================================
BEGIN;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS gets_plant_expenses BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ItemCategory" ADD COLUMN IF NOT EXISTS gets_plant_expenses BOOLEAN NOT NULL DEFAULT false;
COMMIT;
