// lib/hr/payroll/compute.js — one employee's payslip for a month. Pure: the
// server calculates with it and the tests check it; nothing here reads the DB.
//
// 1. Days. paid = attendance paid days (rules.js monthSummary: present, late,
//    off, paid holidays, paid leave, ½ half days, − late cuts) + days not yet
//    due. Nothing marked all month → the full month (setting) with a warning.
//    unpaid = employed days − paid.
// 2. Day's pay = amount ÷ divisor (setting; 0 = days in the month).
//    Whole month employed: amount − day's pay × unpaid. Joined / left in the
//    month: day's pay × paid days (never above the amount).
//    Basic and every "paid by days worked" component are cut like this; the
//    others are paid in full when anything at all is paid.
// 3. Overtime = hours × (gross or basic ÷ divisor ÷ hours a day) × rate %.
// 4. EOBI (registered employees): employee / employer % of the minimum wage.
// 5. Income tax (fiscal year July–June, salaried slabs + surcharge):
//      projected = taxable so far this year + this month × months left
//      this month = (tax on projected − tax already deducted) ÷ months left
// 6. Loan / advance instalments come last, out of what is left, never below 0.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Fiscal year (starts July) a month falls in: 2026-10 → 2026, 2027-03 → 2026. */
export const fiscalYearOf = (monthKey) => {
  const [y, m] = monthKey.split("-").map(Number);
  return m >= 7 ? y : y - 1;
};

/** Months of the fiscal year left, this one included (July → 12, June → 1). */
export const monthsLeftInFiscalYear = (monthKey) => 12 - ((Number(monthKey.slice(5, 7)) - 7 + 12) % 12);

/** First month of the fiscal year a month is in. */
export const fiscalYearStart = (monthKey) => `${fiscalYearOf(monthKey)}-07`;

/** Yearly tax on yearly taxable income. */
export function slabTax(income, slabs, { surchargeThreshold = 0, surchargePercent = 0 } = {}) {
  if (!(income > 0) || !slabs?.length) return 0;
  const sorted = [...slabs].sort((a, b) => a.from_amount - b.from_amount);
  let slab = null;
  for (const s of sorted) if (income > s.from_amount || (s.from_amount === 0 && income >= 0)) slab = s;
  if (!slab) return 0;
  let tax = (Number(slab.fixed_amount) || 0) + (income - slab.from_amount) * ((Number(slab.rate_percent) || 0) / 100);
  if (surchargeThreshold > 0 && surchargePercent > 0 && income > surchargeThreshold) tax *= 1 + surchargePercent / 100;
  return r2(Math.max(0, tax));
}

/**
 * @param {object} a
 * @param {string} a.month                "YYYY-MM"
 * @param {number} a.daysInMonth
 * @param {number} a.employedDays         days of the month the person was employed
 * @param {object|null} a.summary         rules.js monthSummary of the employed days
 * @param {boolean} a.hasAttendance       anything recorded this month
 * @param {object} a.settings             getHrSettings()
 * @param {object|null} a.salary          calc.js salaryTotals (basic, earnings[], deductions[], gross)
 * @param {Array}  a.loans                [{ id, kind, due, acno }] — due from schedule.js dueInMonth
 * @param {object} a.loanOverrides        { loanId: amount }
 * @param {Array}  a.adjustments          [{ kind: "EARNING"|"DEDUCTION", label, amount, taxable }]
 * @param {boolean} a.eobiRegistered
 * @param {object} a.tax                  { slabs, ytdTaxable, ytdTax }
 */
export function computePayslip(a) {
  const warnings = [];
  const s = a.settings;
  const divisor = s.payrollDaysDivisor > 0 ? s.payrollDaysDivisor : a.daysInMonth;
  const employed = a.employedDays;
  const fullMonth = employed >= a.daysInMonth;

  // ── 1. days ───────────────────────────────────────────────────────────────
  let paid;
  if (!a.hasAttendance && s.payNoAttendanceFull) {
    paid = employed;
    if (employed > 0) warnings.push("No attendance was recorded this month — paid for the whole month.");
  } else {
    paid = (a.summary?.paidDays ?? 0) + (a.summary?.counts?.PENDING ?? 0);
    if (a.summary?.counts?.PENDING) warnings.push(`${a.summary.counts.PENDING} day(s) not yet due were counted as paid.`);
  }
  paid = Math.min(employed, Math.max(0, paid));
  const unpaid = r2(Math.max(0, employed - paid));
  const pay = (amount) => {
    const A = Number(amount) || 0;
    if (!A) return 0;
    return fullMonth ? r2(Math.max(0, A - (A / divisor) * unpaid)) : r2(Math.min(A, (A / divisor) * paid));
  };

  if (!a.salary) {
    warnings.push("No salary is set — nothing to pay.");
  }
  const salary = a.salary ?? { basic: 0, earnings: [], deductions: [], gross: 0 };

  // ── 2. earnings ───────────────────────────────────────────────────────────
  const basicPaid = pay(salary.basic);
  const earnings = salary.earnings.map((e) => {
    const amount = e.component.prorate ? pay(e.amount) : paid > 0 ? r2(e.amount) : 0;
    return { component_id: e.component.id, code: e.component.code, name: e.component.name, full: e.amount, amount, taxable: e.component.taxable !== false, acno: e.component.gl_acno ?? null };
  });

  // ── 3. overtime ───────────────────────────────────────────────────────────
  const otMinutes = a.hasAttendance ? a.summary?.overtimeMinutes ?? 0 : 0;
  const otBase = s.otBaseGross ? salary.gross : salary.basic;
  const hourly = otBase > 0 ? otBase / divisor / (s.otHoursPerDay || 8) : 0;
  const overtime = { minutes: otMinutes, hourly: r2(hourly), rate_percent: s.otRatePercent, amount: r2((otMinutes / 60) * hourly * ((s.otRatePercent || 0) / 100)) };

  const adjustments = (a.adjustments || []).map((x) => ({ ...x, amount: r2(x.amount) }));
  const adjEarn = adjustments.filter((x) => x.kind === "EARNING");
  const adjDed = adjustments.filter((x) => x.kind === "DEDUCTION");

  const totalEarnings = r2(basicPaid + earnings.reduce((t, e) => t + e.amount, 0) + overtime.amount + adjEarn.reduce((t, x) => t + x.amount, 0));

  // ── 4. deductions from the salary structure ───────────────────────────────
  const deductions = salary.deductions.map((d) => ({
    component_id: d.component.id, code: d.component.code, name: d.component.name, full: d.amount,
    amount: d.component.prorate ? pay(d.amount) : paid > 0 ? r2(d.amount) : 0,
    acno: d.component.gl_acno ?? null,
  }));

  // ── 5. EOBI ───────────────────────────────────────────────────────────────
  const eobi = { employee: 0, employer: 0 };
  if (a.eobiRegistered && paid > 0) {
    eobi.employee = r2(((s.eobiMinWage || 0) * (s.eobiEmployeePercent || 0)) / 100);
    eobi.employer = r2(((s.eobiMinWage || 0) * (s.eobiEmployerPercent || 0)) / 100);
  }

  // ── 6. income tax ─────────────────────────────────────────────────────────
  const taxable = r2(basicPaid + earnings.filter((e) => e.taxable).reduce((t, e) => t + e.amount, 0) + overtime.amount + adjEarn.filter((x) => x.taxable !== false).reduce((t, x) => t + x.amount, 0));
  const monthsLeft = monthsLeftInFiscalYear(a.month);
  const ytdTaxable = r2(a.tax?.ytdTaxable ?? 0);
  const ytdTax = r2(a.tax?.ytdTax ?? 0);
  const projected = r2(ytdTaxable + taxable * monthsLeft);
  const annualTax = slabTax(projected, a.tax?.slabs ?? [], { surchargeThreshold: s.taxSurchargeThreshold, surchargePercent: s.taxSurchargePercent });
  const incomeTax = taxable > 0 ? r2(Math.max(0, (annualTax - ytdTax) / monthsLeft)) : 0;
  if (taxable > 0 && !(a.tax?.slabs?.length)) warnings.push(`No income-tax slabs for fiscal year ${fiscalYearOf(a.month)}–${String(fiscalYearOf(a.month) + 1).slice(2)} — no tax deducted.`);

  // ── 7. loans, out of what is left ─────────────────────────────────────────
  let left = r2(totalEarnings - deductions.reduce((t, d) => t + d.amount, 0) - eobi.employee - incomeTax - adjDed.reduce((t, x) => t + x.amount, 0));
  if (left < 0) warnings.push("Deductions are more than the earnings — check this payslip.");
  const loans = (a.loans || []).map((l) => {
    const override = a.loanOverrides?.[l.id];
    const wanted = override !== undefined && override !== null && override !== "" ? r2(override) : r2(l.due);
    const amount = r2(Math.max(0, Math.min(wanted, Math.max(0, left))));
    left = r2(left - amount);
    if (amount < wanted) warnings.push(`${l.kind === "LOAN" ? "Loan" : "Advance"} #A-${l.id}: only ${amount.toLocaleString()} of ${wanted.toLocaleString()} could be recovered.`);
    return { loan_id: l.id, kind: l.kind, due: r2(l.due), amount, overridden: override !== undefined && override !== null && override !== "", acno: l.acno ?? null };
  });

  const totalDeductions = r2(
    deductions.reduce((t, d) => t + d.amount, 0) + eobi.employee + incomeTax + adjDed.reduce((t, x) => t + x.amount, 0) + loans.reduce((t, l) => t + l.amount, 0),
  );
  const net = r2(totalEarnings - totalDeductions);

  return {
    days: {
      in_month: a.daysInMonth,
      employed,
      paid: r2(paid),
      unpaid,
      divisor,
      present: a.summary?.counts?.PRESENT ?? 0,
      late: a.summary?.counts?.LATE ?? 0,
      half: a.summary?.counts?.HALF_DAY ?? 0,
      absent: a.summary?.counts?.ABSENT ?? 0,
      leave: a.summary?.counts?.LEAVE ?? 0,
      unpaid_leave: a.summary?.unpaidLeave ?? 0,
      late_cut: a.summary?.lateCutDays ?? 0,
      off: (a.summary?.counts?.OFF ?? 0) + (a.summary?.counts?.HOLIDAY ?? 0),
      pending: a.summary?.counts?.PENDING ?? 0,
      attendance: a.hasAttendance,
    },
    salary: { basic: salary.basic, gross: salary.gross },
    basic: basicPaid,
    earnings,
    overtime,
    adjustments,
    deductions,
    eobi,
    tax: { taxable, months_left: monthsLeft, ytd_taxable: ytdTaxable, ytd_tax: ytdTax, projected, annual: annualTax, month: incomeTax },
    loans,
    total_earnings: totalEarnings,
    total_deductions: totalDeductions,
    net,
    warnings,
  };
}
