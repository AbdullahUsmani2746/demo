// lib/hr/payroll/run.js — payroll runs: who is in them and what each is paid.
//
//   eligibleEmployees()  employed in the month, inside the person's departments,
//                        and not already in another live run of that month
//   calculateRun()       (re)builds every payslip of a DRAFT run from attendance
//                        (lib/hr/attendance), salary (lib/hr/salary), loans
//                        (lib/hr/loans) and earlier payslips of the fiscal year
//                        (income tax). Adjustments, loan overrides and holds
//                        entered on a payslip survive a recalculation.
// A run is live unless it is REVERSED; an employee is in at most one live run a month.
// An employee whose final settlement (lib/hr/leaving/settlement.js) pays the
// last salary of a month is not put in that month's run — the settlement does it.
import prisma from "@/lib/prisma";
import { getHrSettings } from "@/lib/hr/access";
import { loadContext, resolveDay, summaryShift } from "@/lib/hr/attendance/sheet";
import { monthSummary } from "@/lib/hr/attendance/rules";
import { salaryOn, totalsOf } from "@/lib/hr/salary/service";
import { dueInMonth, isRefundable, outstandingOf, ownLoanAcno } from "@/lib/hr/loans/schedule";
import { computePayslip, fiscalYearOf, fiscalYearStart } from "@/lib/hr/payroll/compute";
import { gratuityProvision, pfEligible } from "@/lib/hr/benefits";
import { feature } from "@/lib/features/server";
import { dayKeyOfDb, eachDay, monthRange, todayKey } from "@/lib/hr/time";

export class PayrollError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const RUN_STATUS = {
  DRAFT: "DRAFT",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  POSTED: "POSTED",
  REVERSED: "REVERSED",
};
export const LIVE = [RUN_STATUS.DRAFT, RUN_STATUS.PENDING, RUN_STATUS.APPROVED, RUN_STATUS.POSTED];

/** Employees who could be put in a run of this month. */
export async function eligibleEmployees({ month, employeeWhere, excludeRunId = null }) {
  const range = monthRange(month);
  if (!range) throw new PayrollError("Pick a valid month.");
  const ctx = await loadContext({ employeeWhere, from: range.from, to: range.to });
  const taken = await prisma.hrPayslip.findMany({
    where: { month, employee_id: { in: ctx.employees.map((e) => e.id) }, run: { status: { in: LIVE }, ...(excludeRunId ? { NOT: { id: excludeRunId } } : {}) } },
    select: { employee_id: true, run_id: true },
  });
  const takenBy = new Map(taken.map((t) => [t.employee_id, t.run_id]));
  const settled = new Set(await settledIn(month, ctx.employees.map((e) => e.id)));
  return { employees: ctx.employees.filter((e) => !takenBy.has(e.id) && !settled.has(e.id)), taken: takenBy, settled: [...settled] };
}

/** Employees whose live final settlement pays this month's salary. */
export async function settledIn(month, employeeIds) {
  if (!employeeIds.length) return [];
  const range = monthRange(month);
  const rows = await prisma.hrSettlement.findMany({
    where: { employee_id: { in: employeeIds }, status: { not: "REVERSED" }, salary_from: { not: null, lte: new Date(`${range.to}T00:00:00.000Z`) }, dor: { gte: new Date(`${range.from}T00:00:00.000Z`) } },
    select: { employee_id: true },
  });
  return rows.map((r) => r.employee_id);
}

/** Everything one month's payslips need, for these employees. */
async function inputs(month, employeeIds) {
  const range = monthRange(month);
  const today = todayKey();
  const [settings, pfOn, gratuityOn] = await Promise.all([getHrSettings(), feature("hr.providentFund"), feature("hr.gratuity")]);
  const startMonth = settings.taxYearStartMonth || 7;
  const fyStart = fiscalYearStart(month, startMonth);
  const gratuityMonthly = gratuityOn && settings.gratuityProvisionMonthly === 1;
  const [ctx, salaries, loans, emps, slabs, ytd, provided] = await Promise.all([
    loadContext({ employeeWhere: { id: { in: employeeIds } }, from: range.from, to: range.to }),
    salaryOn(employeeIds, range.to),
    prisma.hrLoan.findMany({ where: { employee_id: { in: employeeIds }, status: "active" }, include: { recoveries: { select: { amount: true } } } }),
    prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, hireDate: true, eobiNo: true, advanceAcno: true, loanAcno: true, costCenterId: true, bankId: true, accountNumber: true, accountName: true, bankTitle: true, paymentMethod: true, bank: { select: { name: true } } },
    }),
    prisma.hrTaxSlab.findMany({ where: { fiscal_year: fiscalYearOf(month, startMonth) }, orderBy: { from_amount: "asc" } }),
    // Taxable pay and tax already deducted this fiscal year (posted runs, earlier months).
    prisma.hrPayslip.groupBy({
      by: ["employee_id"],
      where: { employee_id: { in: employeeIds }, month: { gte: fyStart, lt: month }, run: { status: RUN_STATUS.POSTED } },
      _sum: { taxable: true, income_tax: true },
    }),
    // Gratuity already provided in the books (posted runs, earlier months).
    gratuityMonthly
      ? prisma.hrPayslip.groupBy({
          by: ["employee_id"],
          where: { employee_id: { in: employeeIds }, month: { lt: month }, run: { status: RUN_STATUS.POSTED } },
          _sum: { gratuity: true },
        })
      : [],
  ]);
  return {
    range,
    today,
    ctx,
    settings,
    salaries,
    loansOf: groupBy(loans, (l) => l.employee_id),
    empOf: new Map(emps.map((e) => [e.id, e])),
    slabs,
    ytdOf: new Map(ytd.map((y) => [y.employee_id, { ytdTaxable: y._sum.taxable || 0, ytdTax: y._sum.income_tax || 0 }])),
    pfOn,
    gratuityMonthly,
    providedOf: new Map(provided.map((g) => [g.employee_id, g._sum.gratuity || 0])),
  };
}

function groupBy(list, keyOf) {
  const m = new Map();
  for (const x of list) {
    const k = keyOf(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/** Bank details of an employee, as they are now (for the bank sheet). */
const bankOf = (e) =>
  e && {
    method: e.paymentMethod,
    bank: e.bank?.name ?? null,
    account: e.accountNumber ?? null,
    title: e.bankTitle || e.accountName || null,
  };

/** One payslip's numbers. */
function payslipFor(inp, emp, keep) {
  const days = eachDay(inp.range.from, inp.range.to).map((d) => resolveDay(inp.ctx, emp, d, inp.today));
  const employed = days.filter((d) => d.employed);
  const summary = monthSummary(employed, summaryShift(inp.ctx, emp));
  const hasAttendance = employed.some((d) => d.row_id);
  const e = inp.empOf.get(emp.id);
  // Only what was actually paid out is recovered: an approved advance not yet
  // paid (no payment voucher) would credit the staff account with no debit.
  const unpaid = (inp.loansOf.get(emp.id) ?? []).filter((l) => !l.disbursed_on);
  // A PF withdrawal is never recovered; a PF loan is (credited back to PF payable).
  const loans = (inp.loansOf.get(emp.id) ?? []).filter((l) => l.disbursed_on && isRefundable(l.kind)).map((l) => ({
    id: l.id,
    kind: l.kind,
    due: dueInMonth(l, inp.range.from.slice(0, 7), outstandingOf(l, l.recoveries)),
    acno: ownLoanAcno(l.kind, e),
  })).filter((l) => l.due > 0 || keep.loan_overrides?.[l.id] !== undefined);

  const salary = totalsOf(inp.salaries.get(emp.id));
  const hireDate = e?.hireDate ? dayKeyOfDb(e.hireDate) : null;
  const monthEnd = emp.dor && dayKeyOfDb(emp.dor) < inp.range.to ? dayKeyOfDb(emp.dor) : inp.range.to;
  const data = computePayslip({
    month: inp.range.from.slice(0, 7),
    daysInMonth: days.length,
    employedDays: employed.length,
    summary,
    hasAttendance,
    settings: inp.settings,
    salary,
    loans,
    loanOverrides: keep.loan_overrides ?? {},
    adjustments: keep.adjustments ?? [],
    eobiRegistered: Boolean(e?.eobiNo && String(e.eobiNo).trim()),
    tax: { slabs: inp.slabs, ...(inp.ytdOf.get(emp.id) ?? { ytdTaxable: 0, ytdTax: 0 }) },
    pf: inp.pfOn ? { eligible: Boolean(hireDate) && pfEligible({ hireDate, asOf: monthEnd, settings: inp.settings }) } : null,
    gratuity:
      inp.gratuityMonthly && hireDate && salary
        ? gratuityProvision({ hireDate, asOf: monthEnd, basic: salary.basic, gross: salary.gross, provided: inp.providedOf.get(emp.id) ?? 0, settings: inp.settings })
        : null,
  });
  for (const l of unpaid) data.warnings.push(`#A-${l.id} is approved but not paid out yet — nothing recovered for it.`);
  data.cost_center = e?.costCenterId ?? null;
  data.bank = bankOf(e);
  return data;
}

/**
 * Recalculate a DRAFT run (all its payslips, or only `employeeIds`).
 * `addEmployeeIds` puts new people in first (they must be eligible).
 */
export async function calculateRun(runId, { addEmployeeIds = [], onlyEmployeeIds = null } = {}) {
  const run = await prisma.hrPayrollRun.findUnique({ where: { id: runId }, include: { payslips: { select: { employee_id: true, adjustments: true, loan_overrides: true, hold: true } } } });
  if (!run) throw new PayrollError("Payroll not found.", 404);
  if (run.status !== RUN_STATUS.DRAFT) throw new PayrollError(`This payroll is ${run.status.toLowerCase()} — only a draft can be recalculated.`, 409);

  const keepOf = new Map(run.payslips.map((p) => [p.employee_id, p]));
  let ids = onlyEmployeeIds ?? [...new Set([...run.payslips.map((p) => p.employee_id), ...addEmployeeIds])];
  if (!ids.length) return { count: 0 };
  const inp = await inputs(run.month, ids);
  const present = new Set(inp.ctx.employees.map((e) => e.id));
  // Someone no longer employed in the month drops out of the run.
  const gone = ids.filter((id) => !present.has(id));
  ids = ids.filter((id) => present.has(id));

  const writes = inp.ctx.employees.map((emp) => {
    const keep = keepOf.get(emp.id) ?? { adjustments: [], loan_overrides: {}, hold: false };
    const d = payslipFor(inp, emp, keep);
    const fields = {
      data: d,
      paid_days: d.days.paid,
      total_earnings: d.total_earnings,
      total_deductions: d.total_deductions,
      net: d.net,
      taxable: d.tax.taxable,
      income_tax: d.tax.month,
      eobi_employee: d.eobi.employee,
      eobi_employer: d.eobi.employer,
      pf_employee: d.pf?.employee ?? 0,
      pf_employer: d.pf?.employer ?? 0,
      gratuity: d.gratuity?.provision ?? 0,
      warnings: d.warnings,
    };
    return prisma.hrPayslip.upsert({
      where: { run_id_employee_id: { run_id: runId, employee_id: emp.id } },
      update: fields,
      create: { run_id: runId, employee_id: emp.id, month: run.month, adjustments: keep.adjustments, loan_overrides: keep.loan_overrides, hold: keep.hold, ...fields },
    });
  });
  for (let i = 0; i < writes.length; i += 100) await prisma.$transaction(writes.slice(i, i + 100));
  if (gone.length) await prisma.hrPayslip.deleteMany({ where: { run_id: runId, employee_id: { in: gone } } });
  await refreshTotals(runId);
  return { count: ids.length, removed: gone.length };
}

export async function refreshTotals(runId, db = prisma) {
  const agg = await db.hrPayslip.aggregate({
    where: { run_id: runId },
    _sum: { total_earnings: true, total_deductions: true, net: true, eobi_employer: true },
    _count: { _all: true },
  });
  await db.hrPayrollRun.update({
    where: { id: runId },
    data: {
      employees: agg._count._all,
      total_earnings: agg._sum.total_earnings || 0,
      total_deductions: agg._sum.total_deductions || 0,
      total_net: agg._sum.net || 0,
      total_employer: agg._sum.eobi_employer || 0,
      computed_at: new Date(),
    },
  });
}

/** Payslip adjustments from the screen → clean list. */
export function cleanAdjustments(list) {
  if (!Array.isArray(list)) throw new PayrollError("Adjustments must be a list.");
  if (list.length > 30) throw new PayrollError("At most 30 adjustments on one payslip.");
  return list.map((x, i) => {
    const kind = x?.kind === "DEDUCTION" ? "DEDUCTION" : x?.kind === "EARNING" ? "EARNING" : null;
    if (!kind) throw new PayrollError(`Adjustment ${i + 1}: earning or deduction?`);
    const label = String(x.label ?? "").trim().slice(0, 80);
    if (!label) throw new PayrollError(`Adjustment ${i + 1}: describe it (e.g. Arrears, Bonus, Fine).`);
    const amount = Math.round(Number(x.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) throw new PayrollError(`${label}: enter an amount above 0.`);
    const acno = x.acno === "" || x.acno == null ? null : Number(x.acno);
    if (acno !== null && (!Number.isInteger(acno) || acno <= 0)) throw new PayrollError(`${label}: account must be an account number.`);
    return { kind, label, amount, taxable: kind === "EARNING" ? x.taxable !== false : false, acno };
  });
}
