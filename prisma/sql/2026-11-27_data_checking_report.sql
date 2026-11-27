-- =====================================================================
-- Data Checking Report (/accounting/reports/dataChecking) — the Cost of
-- Goods Sold figures without the margin columns (components/Reports/config.js
-- dataChecking). Re-runnable. No new tables.
--   · its permission report.dataChecking.view (the code
--     scripts/seed-permissions.mjs derives from REPORT_CONFIG), in the same
--     module as Cost of Goods Sold's;
--   · granted to every role / user that holds report.costOfGoodsSold.view
--     (same allow and constraints). Super Admin bypasses the check;
--   · menu item under FINANCE REPORTS, right after COST OF GOODS SOLD, and
--     given to every employee who has that menu item.
-- =====================================================================
BEGIN;

INSERT INTO "Permission" (code, module, label, sort)
SELECT 'report.dataChecking.view', p.module, 'View Data Checking report', p.sort
  FROM "Permission" p
 WHERE p.code = 'report.costOfGoodsSold.view'
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "constraints", "createdAt", "updatedAt")
SELECT np.id, g."role", g.allow, g.constraints, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "PermissionGrant" g
  JOIN "Permission" op ON op.id = g."permissionId" AND op.code = 'report.costOfGoodsSold.view'
  JOIN "Permission" np ON np.code = 'report.dataChecking.view'
 WHERE g."role" IS NOT NULL AND g."userId" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "userId", "allow", "constraints", "createdAt", "updatedAt")
SELECT np.id, g."userId", g.allow, g.constraints, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "PermissionGrant" g
  JOIN "Permission" op ON op.id = g."permissionId" AND op.code = 'report.costOfGoodsSold.view'
  JOIN "Permission" np ON np.code = 'report.dataChecking.view'
 WHERE g."userId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Menu: next to COST OF GOODS SOLD in FINANCE REPORTS (same order_no; the
-- newer id sorts it right after).
INSERT INTO "menus" (title, url, parent_id, order_no, icon, is_active)
SELECT 'DATA CHECKING REPORT', '/accounting/reports/dataChecking', m.parent_id, m.order_no, m.icon, true
  FROM "menus" m
 WHERE m.url = '/accounting/reports/costOfGoodsSold'
   AND NOT EXISTS (SELECT 1 FROM "menus" WHERE url = '/accounting/reports/dataChecking')
 LIMIT 1;

INSERT INTO employee_menu (employee_id, menu_id)
SELECT DISTINCT em.employee_id, nm.id
  FROM employee_menu em
  JOIN "menus" om ON om.id = em.menu_id AND om.url = '/accounting/reports/costOfGoodsSold'
  JOIN "menus" nm ON nm.url = '/accounting/reports/dataChecking'
ON CONFLICT DO NOTHING;

COMMIT;
