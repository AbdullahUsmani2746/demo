-- Payroll accounts by salary category (Employee → Job → Direct / Indirect).
-- Feature hr.payrollAccountsByCategory (Settings → Features, default OFF =
-- one account each, as before) — ported from SMS.
-- Additive and re-runnable.
--
-- 1. Account Settings → Payroll: a Direct and an Indirect account for each
--    payroll account in PAYROLL_BY_CATEGORY_KEYS (lib/accounts/accountSettingDefs.js).
--    Seeded empty (= use the default); set on the Account Settings screen.
-- 2. hr_loans.staff_acno: the staff account an advance / loan was paid out to,
--    so repayments and payroll recoveries credit that same account even if the
--    employee's category changes later. Loans paid out before this keep NULL
--    and are recovered from the default account they were paid to.

ALTER TABLE hr_loans ADD COLUMN IF NOT EXISTS staff_acno INTEGER;

INSERT INTO account_settings (key, kind, section, label, updated_at)
SELECT k.key || '_' || lower(c.cat), 'ACCOUNT', 'PAYROLL', k.label || ' — ' || initcap(lower(c.cat)), now()
FROM (VALUES
  ('payroll_salary_expense', 'Salaries & Wages Expense'),
  ('payroll_overtime_expense', 'Overtime Expense'),
  ('payroll_leave_encashment_expense', 'Leave Encashment Expense'),
  ('payroll_salary_payable', 'Salaries Payable'),
  ('payroll_settlement_payable', 'Final Settlements Payable'),
  ('payroll_staff_advances', 'Staff Advances'),
  ('payroll_staff_loans', 'Staff Loans'),
  ('payroll_eobi_expense', 'EOBI — Employer Contribution (expense)'),
  ('payroll_pf_expense', 'Provident Fund — Employer Contribution (expense)'),
  ('payroll_gratuity_expense', 'Gratuity Expense')
) AS k(key, label)
CROSS JOIN (VALUES ('DIRECT'), ('INDIRECT')) AS c(cat)
ON CONFLICT (key) DO NOTHING;
