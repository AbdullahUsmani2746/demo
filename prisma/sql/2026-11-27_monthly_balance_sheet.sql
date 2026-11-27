-- =====================================================================
-- Monthly Balance Sheet (/accounting/reports/monthlyBalanceSheet) — each
-- balance sheet account's closing balance at every month end of the period
-- (components/Reports/config.js monthlyBalanceSheet). Re-runnable. No new tables.
--   · its permission report.monthlyBalanceSheet.view (the code
--     scripts/seed-permissions.mjs derives from REPORT_CONFIG), in the same
--     module as the Balance Sheet's;
--   · granted to every role / user that holds report.trialBalanceSheet.view
--     (same allow and constraints). Super Admin bypasses the check;
--   · menu item next to BALANCE SHEET, given to every employee who has it.
-- Keyed by permission code / menu url, never by database ids.
-- =====================================================================
BEGIN;

INSERT INTO "Permission" (code, module, label, sort)
SELECT 'report.monthlyBalanceSheet.view', p.module, 'View Monthly Balance Sheet report', p.sort
  FROM "Permission" p
 WHERE p.code = 'report.trialBalanceSheet.view'
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "constraints", "createdAt", "updatedAt")
SELECT np.id, g."role", g.allow, g.constraints, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "PermissionGrant" g
  JOIN "Permission" op ON op.id = g."permissionId" AND op.code = 'report.trialBalanceSheet.view'
  JOIN "Permission" np ON np.code = 'report.monthlyBalanceSheet.view'
 WHERE g."role" IS NOT NULL AND g."userId" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "userId", "allow", "constraints", "createdAt", "updatedAt")
SELECT np.id, g."userId", g.allow, g.constraints, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "PermissionGrant" g
  JOIN "Permission" op ON op.id = g."permissionId" AND op.code = 'report.trialBalanceSheet.view'
  JOIN "Permission" np ON np.code = 'report.monthlyBalanceSheet.view'
 WHERE g."userId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "menus" (title, url, parent_id, order_no, icon, is_active)
SELECT 'MONTHLY BALANCE SHEET', '/accounting/reports/monthlyBalanceSheet', m.parent_id, m.order_no, m.icon, true
  FROM "menus" m
 WHERE m.url = '/accounting/reports/trialBalanceSheet'
   AND NOT EXISTS (SELECT 1 FROM "menus" WHERE url = '/accounting/reports/monthlyBalanceSheet')
 LIMIT 1;

INSERT INTO employee_menu (employee_id, menu_id)
SELECT DISTINCT em.employee_id, nm.id
  FROM employee_menu em
  JOIN "menus" om ON om.id = em.menu_id AND om.url = '/accounting/reports/trialBalanceSheet'
  JOIN "menus" nm ON nm.url = '/accounting/reports/monthlyBalanceSheet'
ON CONFLICT DO NOTHING;

COMMIT;
