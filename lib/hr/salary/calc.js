// lib/hr/salary/calc.js — what a salary structure comes to. Pure: the form
// previews with the same numbers the server and payroll use.
//
//   earning / deduction line = FIXED amount, or PERCENT_BASIC % of basic
//   gross = basic + earnings;  net (before payroll items) = gross − deductions
// Payroll (Phase 4) adds attendance (prorate), overtime, loan instalments,
// EOBI and income tax on top of this.

export const COMPONENT_KINDS = { EARNING: "EARNING", DEDUCTION: "DEDUCTION" };
export const COMPONENT_CALCS = [
  { key: "FIXED", label: "Fixed amount" },
  { key: "PERCENT_BASIC", label: "% of basic" },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Rupees a line comes to. */
export function lineAmount(component, value, basic) {
  const v = Number(value) || 0;
  return round2(component.calc === "PERCENT_BASIC" ? (Number(basic) || 0) * (v / 100) : v);
}

/**
 * @param {number} basic
 * @param {Array<{ component, value }>} lines
 * @returns {{ basic, earnings: [{ component, value, amount }], deductions: [...], totalEarnings, totalDeductions, gross, net }}
 */
export function salaryTotals(basic, lines) {
  const b = round2(basic);
  const earnings = [];
  const deductions = [];
  for (const l of lines) {
    if (!l?.component) continue;
    const row = { component: l.component, value: Number(l.value) || 0, amount: lineAmount(l.component, l.value, b) };
    (l.component.kind === COMPONENT_KINDS.DEDUCTION ? deductions : earnings).push(row);
  }
  const totalEarnings = round2(earnings.reduce((s, r) => s + r.amount, 0));
  const totalDeductions = round2(deductions.reduce((s, r) => s + r.amount, 0));
  const gross = round2(b + totalEarnings);
  return { basic: b, earnings, deductions, totalEarnings, totalDeductions, gross, net: round2(gross - totalDeductions) };
}

export const fmtMoney = (n) =>
  (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
