-- =====================================================================
-- HR Phase 5 — My HR (self-service), HR dashboard, HR reports
-- Run after 2026-10-30 … 2026-11-02. No new tables: only one permission.
--   · hr.attendance.own — see own attendance on My HR (/dashboard/my-hr) and
--     ask for a correction of an own day (always goes to Approvals) → every role
-- The HR dashboard, reports and employee profile use the existing HR view
-- rights; their menus (244 HR DASHBOARD, 245 HR REPORTS) come with
-- scripts/sql/menus-seed.sql.
-- =====================================================================
BEGIN;

INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.attendance.own', 'HR', 'See own attendance (My HR) and ask for corrections of own days', 175)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, r.role::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 CROSS JOIN (VALUES ('HR_MANAGER'), ('MANAGER'), ('CASHIER'), ('SALES'), ('EMPLOYEE')) AS r(role)
 WHERE p.code = 'hr.attendance.own'
ON CONFLICT ("permissionId", "role") DO NOTHING;

COMMIT;
