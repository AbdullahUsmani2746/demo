// lib/vouchers/systemVouchers.js — vouchers that a module posts by itself.
//
// THE STANDARD (applies to people, scripts and AI assistants alike):
//   A voucher a module posts (payroll journal, advance / loan pay-out, loan
//   repayment, salary payment …) is never edited or deleted. Its owning screen
//   is the only way to change it, and that screen never rewrites it either: it
//   posts a reversal (the mirror entry, dated and explained) and keeps both.
//
// It is enforced three times over:
//   1. here — every voucher write route (app/api/voucher/…) refuses an edit or
//      delete of a voucher whose rmk4 is listed below, naming the screen to use
//   2. the database — prisma/sql/2026-11-04_hr_accounting.sql installs a
//      trigger that rejects UPDATE / DELETE of their amounts, accounts and
//      dates, whatever client sends it
//   3. CLAUDE.md — the rule is written down for anyone working on the code
//
// A new module that posts on its own adds its marker here AND to the trigger's
// list (in a new SQL file), and writes it to TRANSACTIONS_MASTER.rmk4 with its
// own record id in rmk5.
//
// Pure data + one helper — no imports — so screens can read it too.

export const SYSTEM_VOUCHERS = {
  PAYROLL: { label: "Payroll journal", screen: "HR → Payroll" },
  PAYROLL_REVERSAL: { label: "Payroll reversal", screen: "HR → Payroll" },
  HR_LOAN_PAYOUT: { label: "Advance / loan pay-out", screen: "HR → Advances & loans" },
  HR_LOAN_REPAY: { label: "Advance / loan repayment", screen: "HR → Advances & loans" },
  HR_SALARY_PAY: { label: "Salary payment", screen: "HR → Payroll" },
  HR_REVERSAL: { label: "HR reversal", screen: "HR" },
  // Full & final settlement (lib/hr/leaving/settlement.js, prisma/sql/2026-11-21_hr_payroll_additions.sql)
  HR_SETTLEMENT: { label: "Final settlement journal", screen: "HR → Leaving & settlement" },
  HR_SETTLEMENT_PAY: { label: "Final settlement payment", screen: "HR → Leaving & settlement" },
  // Fixed assets (lib/fixedAssets/*, prisma/sql/2026-11-20_fixed_assets.sql)
  FA_CAPITALISATION: { label: "Fixed asset capitalisation", screen: "Fixed Assets → Register" },
  FA_DEPRECIATION: { label: "Depreciation journal", screen: "Fixed Assets → Depreciation" },
  FA_DEPRECIATION_REVERSAL: { label: "Depreciation reversal", screen: "Fixed Assets → Depreciation" },
  FA_DISPOSAL: { label: "Fixed asset disposal journal", screen: "Fixed Assets → Register" },
  FA_DISPOSAL_REVERSAL: { label: "Fixed asset disposal reversal", screen: "Fixed Assets → Register" },
};

export const SYSTEM_VOUCHER_MARKERS = Object.keys(SYSTEM_VOUCHERS);

export const isSystemVoucher = (master) => Boolean(master?.rmk4 && SYSTEM_VOUCHERS[master.rmk4]);

/** Why this voucher may not be edited / deleted by hand, or null. */
export function systemVoucherError(master) {
  if (!isSystemVoucher(master)) return null;
  const v = SYSTEM_VOUCHERS[master.rmk4];
  return `This is a ${v.label.toLowerCase()} posted by ${v.screen}. Posted entries are never edited or deleted — reverse it from ${v.screen} instead.`;
}
