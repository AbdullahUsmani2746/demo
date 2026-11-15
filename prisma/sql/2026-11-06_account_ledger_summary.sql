-- =====================================================================
-- Account Ledger Summary report (/accounting/reports/accountLedgerSummary)
-- Re-runnable. No new tables.
--   · its permission report.accountLedgerSummary.view (the code
--     scripts/seed-permissions.mjs derives from REPORT_CONFIG), in the same
--     module as the Account Ledger's;
--   · granted to every role / user that holds report.accountLedger.view
--     (same allow and constraints). ADMIN / ACCOUNTANT bypass the check;
--   · menu item under FINANCE REPORTS, right after ACCOUNT LEDGER, and
--     given to every employee who has that Account Ledger menu item.
-- =====================================================================
BEGIN;

INSERT INTO "Permission" (code, module, label, sort)
SELECT 'report.accountLedgerSummary.view', p.module, 'View Account Ledger Summary report', p.sort
  FROM "Permission" p
 WHERE p.code = 'report.accountLedger.view'
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "constraints", "createdAt", "updatedAt")
SELECT np.id, g."role", g.allow, g.constraints, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "PermissionGrant" g
  JOIN "Permission" op ON op.id = g."permissionId" AND op.code = 'report.accountLedger.view'
  JOIN "Permission" np ON np.code = 'report.accountLedgerSummary.view'
 WHERE g."role" IS NOT NULL AND g."userId" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "userId", "allow", "constraints", "createdAt", "updatedAt")
SELECT np.id, g."userId", g.allow, g.constraints, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "PermissionGrant" g
  JOIN "Permission" op ON op.id = g."permissionId" AND op.code = 'report.accountLedger.view'
  JOIN "Permission" np ON np.code = 'report.accountLedgerSummary.view'
 WHERE g."userId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Menu: next to ACCOUNT LEDGER in FINANCE REPORTS (same order_no; the newer
-- id sorts it right after).
INSERT INTO "menus" (title, url, parent_id, order_no, is_active)
SELECT 'ACCOUNT LEDGER SUMMARY', '/accounting/reports/accountLedgerSummary', m.parent_id, m.order_no, true
  FROM "menus" m
  JOIN "menus" parent ON parent.id = m.parent_id AND parent.title = 'FINANCE REPORTS'
 WHERE m.url = '/accounting/reports/accountLedger'
   AND NOT EXISTS (SELECT 1 FROM "menus" WHERE url = '/accounting/reports/accountLedgerSummary')
 LIMIT 1;

INSERT INTO employee_menu (employee_id, menu_id)
SELECT DISTINCT em.employee_id, nm.id
  FROM employee_menu em
  JOIN "menus" om ON om.id = em.menu_id AND om.url = '/accounting/reports/accountLedger'
  JOIN "menus" nm ON nm.url = '/accounting/reports/accountLedgerSummary'
ON CONFLICT DO NOTHING;

COMMIT;
