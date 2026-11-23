-- Returnable Packing (Settings → Features "documents.returnablePacking"):
-- each item's default "Returnable?" for its packing material
-- (Item.packing_material_code is the default packing already). New Dispatch /
-- Dispatch Return / GRN / GRN Return lines pre-fill both while the feature is
-- on; the user may change them on the line. Ported from SMS
-- (2026-11-19_item_packing_returnable.sql). Additive and re-runnable; every
-- existing item starts as not returnable.
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS packing_returnable BOOLEAN NOT NULL DEFAULT false;
