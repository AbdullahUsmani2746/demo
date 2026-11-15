// lib/hr/loans/schedule.js — advances and loans: what is owed and what is due.
// Pure: the screens, the approval page and payroll (Phase 4) use the same rules.
//
//   outstanding        amount − every recovery (payroll and cash)
//   due in month M     min(instalment, outstanding) when the loan is active,
//                      M ≥ start_month and M is not a skipped month
//   schedule           past months: what payroll actually took;
//                      from the current month: the plan until it is paid off

// account     Account Settings key the money sits in (pay-out Dr, recoveries Cr)
// own         Employee field holding the employee's own ledger for it (null = none)
// approval    HR approval type (lib/hr/approvalTypes.js)
// refundable  false = paid once, never recovered (a PF withdrawal)
// pf          provident fund kinds — feature hr.pfLoans (lib/hr/loans/pf.js)
export const LOAN_KINDS = {
  ADVANCE: { label: "Salary advance", short: "Advance", account: "payroll_staff_advances", own: "advanceAcno", approval: "hrLoan", refundable: true },
  LOAN: { label: "Loan", short: "Loan", account: "payroll_staff_loans", own: "loanAcno", approval: "hrLoan", refundable: true },
  PF_LOAN: { label: "Provident fund loan", short: "PF loan", account: "payroll_pf_payable", own: null, approval: "hrPfLoan", refundable: true, pf: true },
  PF_WDL: { label: "Provident fund withdrawal", short: "PF withdrawal", account: "payroll_pf_payable", own: null, approval: "hrPfLoan", refundable: false, pf: true },
};

export const isPfKind = (kind) => Boolean(LOAN_KINDS[kind]?.pf);
export const isRefundable = (kind) => LOAN_KINDS[kind]?.refundable !== false;
export const loanApprovalType = (kind) => LOAN_KINDS[kind]?.approval ?? "hrLoan";
/** Account Settings key of a kind (the default ledger). */
export const loanAccountKey = (kind) => LOAN_KINDS[kind]?.account ?? "payroll_staff_advances";
/** The employee's own ledger for this kind, or null (then the Account Settings default). */
export const ownLoanAcno = (kind, employee) => {
  const field = LOAN_KINDS[kind]?.own;
  return field ? employee?.[field] ?? null : null;
};

export const LOAN_STATUS = {
  pending: { label: "Pending", chip: "bg-amber-50 text-amber-700 ring-amber-600/25" },
  active: { label: "Active", chip: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  settled: { label: "Settled", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  rejected: { label: "Rejected", chip: "bg-red-50 text-red-700 ring-red-600/20" },
  cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-500 ring-slate-500/20" },
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "2026-10" + n months. */
export function addMonths(monthKey, n) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const isMonthKey = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v ?? ""));

export const recoveredTotal = (recoveries) => round2((recoveries || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));

export const outstandingOf = (loan, recoveries) => round2(Math.max(0, (Number(loan.amount) || 0) - recoveredTotal(recoveries)));

/** Due from payroll in a month (before any payroll recovery of that month). */
export function dueInMonth(loan, monthKey, outstanding) {
  if (loan.status !== "active") return 0;
  if (monthKey < loan.start_month) return 0;
  if ((loan.skip_months || []).includes(monthKey)) return 0;
  return round2(Math.min(Number(loan.installment) || 0, outstanding));
}

/** Instalments a plan needs (for the form: amount ÷ instalment). */
export const installmentsFor = (amount, installment) =>
  installment > 0 ? Math.ceil(round2(amount) / round2(installment) - 1e-9) : 0;

/**
 * Month-by-month view.
 * @param loan        { amount, installment, start_month, skip_months, status }
 * @param recoveries  [{ month?, amount, source, date }]
 * @param thisMonth   "YYYY-MM" (Karachi)
 * @returns [{ month, planned, recovered, skipped, balance, past }]
 */
export function schedule(loan, recoveries, thisMonth) {
  const byMonth = new Map();
  for (const r of recoveries || []) {
    if (r.source === "PAYROLL" && r.month) byMonth.set(r.month, round2((byMonth.get(r.month) || 0) + Number(r.amount)));
  }
  const cash = round2((recoveries || []).filter((r) => r.source !== "PAYROLL").reduce((s, r) => s + Number(r.amount), 0));
  const rows = [];
  const skips = new Set(loan.skip_months || []);
  let balance = round2(Number(loan.amount) - cash);
  let m = loan.start_month;
  // Months gone: what payroll actually recovered.
  for (let guard = 0; m < thisMonth && guard < 600; guard++, m = addMonths(m, 1)) {
    const took = byMonth.get(m) || 0;
    if (!took && !skips.has(m)) continue;
    balance = round2(balance - took);
    rows.push({ month: m, planned: null, recovered: took, skipped: skips.has(m), balance: Math.max(0, balance), past: true });
  }
  // From this month on: the plan until it is paid off.
  for (let guard = 0; balance > 0.004 && guard < 600; guard++, m = addMonths(m, 1)) {
    const took = byMonth.get(m) || 0;
    const skipped = skips.has(m);
    const planned = skipped ? 0 : round2(Math.min(Number(loan.installment) || 0, balance));
    if (!skipped && planned <= 0 && !took) break; // no instalment set
    balance = round2(balance - (took || planned));
    rows.push({ month: m, planned, recovered: took, skipped, balance: Math.max(0, balance), past: false });
  }
  return rows;
}

/** Last month of the plan, or null. */
export const lastMonthOf = (rows) => (rows.length ? rows[rows.length - 1].month : null);
