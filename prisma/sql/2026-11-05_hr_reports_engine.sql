-- =====================================================================
-- HR reports move onto the main report engine (/accounting/reports/<key>)
-- Run after 2026-11-03_hr_self_service.sql. No new tables.
--   · one report.<key>.view per HR report (module "Reports · HR"), the same
--     codes scripts/seed-permissions.mjs derives from REPORT_CONFIG
--   · granted to every role / user that today holds an HR right which
--     unlocks that report (lib/hr/reports/catalog.js canRunReport), and to
--     HR_MANAGER outright. ADMIN / ACCOUNTANT bypass permission checks.
-- The HR right is still checked on every run (lib/reports/hr.js); this only
-- opens the report route. The standalone page /accounting/hr/reports and
-- /api/hr/reports/[key] are gone — the menu entry "HR REPORTS" (245) needs
-- to become a group of the report links (scripts/build-menus-sql.mjs).
-- =====================================================================
BEGIN;

INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('report.hrAttendanceSummary.view',    'Reports · HR', 'View Hr Attendance Summary report',    5079),
  ('report.hrAttendanceExceptions.view', 'Reports · HR', 'View Hr Attendance Exceptions report', 5080),
  ('report.hrOvertime.view',             'Reports · HR', 'View Hr Overtime report',              5081),
  ('report.hrLeaveRegister.view',        'Reports · HR', 'View Hr Leave Register report',        5082),
  ('report.hrLeaveTaken.view',           'Reports · HR', 'View Hr Leave Taken report',           5083),
  ('report.hrPayrollSummary.view',       'Reports · HR', 'View Hr Payroll Summary report',       5084),
  ('report.hrPayrollByDepartment.view',  'Reports · HR', 'View Hr Payroll By Department report', 5085),
  ('report.hrIncomeTax.view',            'Reports · HR', 'View Hr Income Tax report',            5086),
  ('report.hrSalaryRegister.view',       'Reports · HR', 'View Hr Salary Register report',       5087),
  ('report.hrLoansOutstanding.view',     'Reports · HR', 'View Hr Loans Outstanding report',     5088),
  ('report.hrHeadcount.view',            'Reports · HR', 'View Hr Headcount report',             5089)
ON CONFLICT (code) DO NOTHING;

-- Which HR rights unlock which report (catalog.js `right`; hrRights() counts
-- manage / approve / post / pay / disburse as seeing).
CREATE TEMP TABLE hr_report_rights (report text, hr_code text) ON COMMIT DROP;
INSERT INTO hr_report_rights (report, hr_code)
SELECT r.report, c.hr_code
  FROM (VALUES
    ('report.hrAttendanceSummary.view',    'view'),
    ('report.hrAttendanceExceptions.view', 'view'),
    ('report.hrOvertime.view',             'view'),
    ('report.hrLeaveRegister.view',        'leaveView'),
    ('report.hrLeaveTaken.view',           'leaveView'),
    ('report.hrPayrollSummary.view',       'payrollView'),
    ('report.hrPayrollByDepartment.view',  'payrollView'),
    ('report.hrIncomeTax.view',            'payrollView'),
    ('report.hrSalaryRegister.view',       'salaryView'),
    ('report.hrLoansOutstanding.view',     'loanView'),
    ('report.hrHeadcount.view',            'any')
  ) AS r(report, right_key)
  JOIN (VALUES
    ('view', 'hr.attendance.view'), ('view', 'hr.attendance.mark'), ('view', 'hr.attendance.approve'),
    ('leaveView', 'hr.leave.view'), ('leaveView', 'hr.leave.manage'), ('leaveView', 'hr.leave.approve'),
    ('salaryView', 'hr.salary.view'), ('salaryView', 'hr.salary.manage'), ('salaryView', 'hr.salary.approve'),
    ('loanView', 'hr.loan.view'), ('loanView', 'hr.loan.manage'), ('loanView', 'hr.loan.approve'), ('loanView', 'hr.loan.disburse'),
    ('payrollView', 'hr.payroll.view'), ('payrollView', 'hr.payroll.manage'), ('payrollView', 'hr.payroll.approve'),
    ('payrollView', 'hr.payroll.post'), ('payrollView', 'hr.payroll.pay')
  ) AS c(right_key, hr_code)
    ON c.right_key = r.right_key OR r.right_key = 'any';

-- HR_MANAGER: every HR report.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, 'HR_MANAGER'::"Role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" p
 WHERE p.code IN (SELECT report FROM hr_report_rights)
ON CONFLICT DO NOTHING;

-- Roles holding a matching HR right today.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT rp.id, g."role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM hr_report_rights m
  JOIN "Permission" hp ON hp.code = m.hr_code
  JOIN "PermissionGrant" g ON g."permissionId" = hp.id AND g.allow AND g."role" IS NOT NULL AND g."userId" IS NULL
  JOIN "Permission" rp ON rp.code = m.report
ON CONFLICT DO NOTHING;

-- Users granted a matching HR right individually.
INSERT INTO "PermissionGrant" ("permissionId", "userId", "allow", "createdAt", "updatedAt")
SELECT DISTINCT rp.id, g."userId", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM hr_report_rights m
  JOIN "Permission" hp ON hp.code = m.hr_code
  JOIN "PermissionGrant" g ON g."permissionId" = hp.id AND g.allow AND g."userId" IS NOT NULL
  JOIN "Permission" rp ON rp.code = m.report
ON CONFLICT DO NOTHING;

COMMIT;
