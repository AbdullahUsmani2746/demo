-- ============================================================
-- Accounting features ported to Bizlogist — 2026-11-21
-- (docs/merge/ACCOUNTING_vs_SMS.md). The columns came with the Accounting
-- schema merge (Item.grn_direct_rate / re_order_level / minimum_order_quantity,
-- ItemCategory.grn_direct_rate, Transactions.cost_rate / tax_law_code,
-- TaxLaws.tax_acno, ReqDetail.rejected_qty, productionPlanMaster.batch_required,
-- INPUT_FOR_PP). The behaviours are Settings → Features (lib/features/catalog.js),
-- all off by default. This file only adds data:
--   1. Grants for plannedQty.manage (Production → Planned Quantities) — copied
--      from the roles that may create production plans or maintain BOMs.
--      (scripts/seed-permissions.mjs --apply adds the code first.)
--   2. One re-order level: Item.re_order is the item's re-order level (Item
--      form, Material Procurement, BI). Accounting kept it in re_order_level;
--      a value there is copied into re_order where re_order is still empty.
--      re_order_level is not read anywhere.
--
-- Re-runnable: WHERE NOT EXISTS / only empty values are filled.
-- ============================================================

-- 1. Permission grants
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT np.id, g.role, true, now(), now()
FROM (VALUES
  ('plannedQty.manage', 'productionPlan.create'),
  ('plannedQty.manage', 'bom.manage')
) AS m(new_code, like_code)
JOIN "Permission" np ON np.code = m.new_code
JOIN "Permission" lp ON lp.code = m.like_code
JOIN "PermissionGrant" g ON g."permissionId" = lp.id AND g.role IS NOT NULL AND g.allow = true
WHERE NOT EXISTS (
  SELECT 1 FROM "PermissionGrant" x WHERE x."permissionId" = np.id AND x.role = g.role
);

-- 2. Re-order level: one column (Item.re_order)
-- Raw SQL is not audited (rule 10): a one-off fill of empty values only.
UPDATE "Item"
SET re_order = ROUND(re_order_level)::int
WHERE re_order IS NULL
  AND re_order_level IS NOT NULL
  AND re_order_level > 0;
