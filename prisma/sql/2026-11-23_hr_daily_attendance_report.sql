-- =====================================================================
-- Daily attendance report (lib/hr/reports/catalog.js attendanceDaily,
-- engine key hrAttendanceDaily): one day, every employee — status,
-- check-in / out, late, early, overtime, worked; totals = the day's head count.
--   · right report.hrAttendanceDaily.view — given to every role / user that
--     holds report.hrAttendanceSummary.view today (same audience as the
--     monthly summary; the HR "view" right is still checked on every run)
--   · menu HR REPORTS → DAILY ATTENDANCE, first in the list — under the same
--     group as the Monthly Attendance Summary menu (found by its url, so no
--     database id is assumed; scripts/build-menus-sql.mjs lists it too)
-- Additive and re-runnable.
-- =====================================================================
BEGIN;

INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('report.hrAttendanceDaily.view', 'Reports · HR', 'View Hr Attendance Daily report', 5078)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "userId", "allow", "createdAt", "updatedAt")
SELECT np.id, g.role, g."userId", g.allow, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" fp
  JOIN "PermissionGrant" g ON g."permissionId" = fp.id
  JOIN "Permission" np ON np.code = 'report.hrAttendanceDaily.view'
 WHERE fp.code = 'report.hrAttendanceSummary.view'
   AND NOT EXISTS (SELECT 1 FROM "PermissionGrant" x
                    WHERE x."permissionId" = np.id
                      AND x.role IS NOT DISTINCT FROM g.role AND x."userId" IS NOT DISTINCT FROM g."userId");

INSERT INTO menus (title, url, icon, parent_id, order_no, is_active)
SELECT 'DAILY ATTENDANCE', '/accounting/reports/hrAttendanceDaily', 'FileChartColumn', s.parent_id, 0, true
  FROM (SELECT parent_id FROM menus
         WHERE url = '/accounting/reports/hrAttendanceSummary' AND parent_id IS NOT NULL
         ORDER BY id LIMIT 1) s
 WHERE NOT EXISTS (SELECT 1 FROM menus WHERE url = '/accounting/reports/hrAttendanceDaily');

COMMIT;
