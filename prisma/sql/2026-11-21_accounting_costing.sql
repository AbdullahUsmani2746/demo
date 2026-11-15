-- ============================================================
-- Accounting costing ported to Bizlogist — 2026-11-21
-- (docs/merge/ACCOUNTING_vs_SMS.md). Behaviours are Settings → Features
-- (lib/features/catalog.js): costing.method (average | blendedCC),
-- costing.semiFinishedCC (start month = Settings key costingSemiCcFrom, set on
-- Production Costing), costing.reconciliation (the two read-only screens).
-- No schema change: MonthlyOpeningRate already stores cc_rate / rm_rate,
-- written only by lib/openingStockGenerate.js.
--
-- This file only adds data:
--   Grants for costing.reconcile (Stock ↔ GL reconciliation, Item cost trace)
--   copied from the roles that hold costing.manage or period.lock.
--   (scripts/seed-permissions.mjs --apply adds the code first.)
--
-- Re-runnable: WHERE NOT EXISTS.
-- ============================================================

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT np.id, g.role, true, now(), now()
FROM (VALUES
  ('costing.reconcile', 'costing.manage'),
  ('costing.reconcile', 'period.lock')
) AS m(new_code, like_code)
JOIN "Permission" np ON np.code = m.new_code
JOIN "Permission" lp ON lp.code = m.like_code
JOIN "PermissionGrant" g ON g."permissionId" = lp.id AND g.role IS NOT NULL AND g.allow = true
WHERE NOT EXISTS (
  SELECT 1 FROM "PermissionGrant" x WHERE x."permissionId" = np.id AND x.role = g.role
);
