-- =====================================================================
-- Provident fund loans and withdrawals (feature hr.pfLoans, default OFF,
-- needs hr.providentFund) — lib/hr/loans/pf.js, CLAUDE.md rules 1-5, 8, 12, 16.
--
-- No table changes: a PF loan / withdrawal is an hr_loans row of kind
-- PF_LOAN / PF_WDL (hr_loans.kind is VARCHAR(10)) and runs through the
-- existing loan flow. Pay-out / repayment vouchers keep the existing system
-- markers HR_LOAN_PAYOUT / HR_LOAN_REPAY / HR_REVERSAL (already read-only
-- through lib/vouchers/systemVouchers.js and the trigger), payroll recoveries
-- sit in the payroll journal (HR_PAYROLL).
--
-- Rules (Settings, defaults in lib/hr/access.js HR_SETTINGS, not seeded):
--   hr.pf.loan_limit_percent    80   at most this % of the member's PF balance
--   hr.pf.loan_max_installments 24   most monthly instalments of a PF loan
--
-- Permission: hr.pfloan.approve — decides HR approval type hrPfLoan.
-- Applying / entering / paying out reuse hr.loan.apply / manage / disburse.
-- Re-runnable.
-- =====================================================================
BEGIN;

INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.pfloan.approve', 'HR', 'Approve or reject provident fund loans and withdrawals', 185)
ON CONFLICT (code) DO NOTHING;

-- Copied grant: the roles that approve loans today approve PF loans too.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT np.id, g.role, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Permission" fp
  JOIN "PermissionGrant" g ON g."permissionId" = fp.id AND g.allow AND g.role IS NOT NULL AND g."userId" IS NULL
  JOIN "Permission" np ON np.code = 'hr.pfloan.approve'
 WHERE fp.code = 'hr.loan.approve'
ON CONFLICT ("permissionId", "role") DO NOTHING;

COMMIT;
