// lib/hr/reports/run.js — rows for the HR reports in lib/hr/reports/catalog.js.
//
// runHrReport(key, { employeeWhere, searchParams }) → { columns, rows, subtitle }
// Served by the report engine through lib/reports/hr.js. `employeeWhere` is
// already the person's employees (employeeScopeWhere) + the report's
// department / work location / search filters; every report stays inside it.
// Attendance is resolved exactly like the attendance screens and payroll
// (lib/hr/attendance/sheet.js), so the numbers agree everywhere.
import prisma from "@/lib/prisma";
import { HR_REPORTS } from "@/lib/hr/reports/catalog";
import { assignmentOn, employeeLite, EMPLOYEE_SELECT, loadContext, resolveDay, summaryShift } from "@/lib/hr/attendance/sheet";
import { monthSummary, STATUS, STATUS_META } from "@/lib/hr/attendance/rules";
import { addMonths, isMonthKey, LOAN_KINDS, LOAN_STATUS, outstandingOf, recoveredTotal } from "@/lib/hr/loans/schedule";
import { salaryOn, totalsOf } from "@/lib/hr/salary/service";
import { fiscalYearStart } from "@/lib/hr/payroll/compute";
import { monthLabel } from "@/lib/hr/payroll/post";
import { dayKeyOfDb, daysBetween, dbDay, eachDay, hmOf, isDayKey, monthRange, todayKey } from "@/lib/hr/time";

export class ReportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const MAX_DAYS = 366;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (list, f) => round2(list.reduce((s, x) => s + (Number(f(x)) || 0), 0));
const who = (e) => {
  const l = employeeLite(e);
  return { emp_id: l.id, name: l.name, department: l.department ?? "", designation: l.designation ?? "" };
};

/** Filters → validated values, with defaults (this month / month to date / fiscal year). */
export function reportParams(key, sp) {
  const r = HR_REPORTS[key];
  const today = todayKey();
  const month = today.slice(0, 7);
  const p = {};
  if (r.filters.includes("month")) {
    p.month = isMonthKey(sp.get("month")) ? sp.get("month") : month;
  }
  if (r.filters.includes("range")) {
    p.from = isDayKey(sp.get("from")) ? sp.get("from") : `${month}-01`;
    p.to = isDayKey(sp.get("to")) ? sp.get("to") : today;
    if (p.from > p.to) throw new ReportError("“From” is after “to”.");
    if (daysBetween(p.from, p.to) >= MAX_DAYS) throw new ReportError("Pick a period of a year or less.");
  }
  if (r.filters.includes("monthRange")) {
    p.fromMonth = isMonthKey(sp.get("fromMonth")) ? sp.get("fromMonth") : fiscalYearStart(month);
    p.toMonth = isMonthKey(sp.get("toMonth")) ? sp.get("toMonth") : month;
    if (p.fromMonth > p.toMonth) throw new ReportError("“From” month is after “to” month.");
    if (p.fromMonth < addMonths(p.toMonth, -35)) throw new ReportError("Pick three years or less.");
  }
  if (r.filters.includes("kind")) {
    const kinds = r.kinds.map((k) => k.value);
    p.kind = kinds.includes(sp.get("kind")) ? sp.get("kind") : kinds[0];
  }
  return p;
}

const RUNNERS = {
  async attendanceSummary({ employeeWhere, p }) {
    const { from, to } = monthRange(p.month);
    const today = todayKey();
    const last = to < today ? to : today;
    if (from > today) return { rows: [], subtitle: `${monthLabel(p.month)} has not started` };
    const ctx = await loadContext({ employeeWhere, from, to: last });
    const rows = ctx.employees.map((emp) => {
      const days = eachDay(from, last).map((d) => resolveDay(ctx, emp, d, today)).filter((d) => d.employed);
      const shift = summaryShift(ctx, emp);
      const s = monthSummary(days, shift);
      return {
        ...who(emp),
        shift: shift?.code ?? "",
        present: s.counts.PRESENT,
        late: s.counts.LATE,
        half: s.counts.HALF_DAY,
        absent: s.counts.ABSENT,
        leave: s.counts.LEAVE,
        off: s.counts.OFF + s.counts.HOLIDAY,
        late_minutes: s.lateMinutes,
        late_cut: s.lateCutDays,
        overtime: s.overtimeMinutes,
        worked: s.workedMinutes,
        paid_days: s.paidDays,
      };
    });
    return { rows, subtitle: `${monthLabel(p.month)}${last < to ? ` · up to ${last}` : ""}` };
  },

  async attendanceExceptions({ employeeWhere, p }) {
    const today = todayKey();
    const to = p.to < today ? p.to : today;
    const ctx = await loadContext({ employeeWhere, from: p.from, to });
    const want = {
      late: (d) => d.status === STATUS.LATE,
      early: (d) => d.early_minutes > 0 && d.status !== STATUS.ABSENT,
      absent: (d) => d.status === STATUS.ABSENT,
      half: (d) => d.status === STATUS.HALF_DAY,
      review: (d) => d.needs_review,
    };
    const test = p.kind === "all" ? (d) => Object.values(want).some((f) => f(d)) : want[p.kind];
    const rows = [];
    for (const day of eachDay(p.from, to)) {
      for (const emp of ctx.employees) {
        const d = resolveDay(ctx, emp, day, today);
        if (!d.employed || !test(d)) continue;
        const a = assignmentOn(ctx, emp.id, day);
        rows.push({
          date: day,
          ...who(emp),
          shift: ctx.shiftById.get(a?.shift_id)?.code ?? "",
          status: STATUS_META[d.status]?.label ?? d.status,
          check_in: hmOf(d.check_in) ?? "",
          check_out: hmOf(d.check_out) ?? "",
          late_minutes: d.late_minutes || 0,
          early_minutes: d.early_minutes || 0,
          note: [d.needs_review ? "Missed punch" : null, d.remarks].filter(Boolean).join(" · "),
        });
      }
    }
    return { rows, subtitle: `${p.from} → ${to}` };
  },

  async overtime({ employeeWhere, p }) {
    const today = todayKey();
    const to = p.to < today ? p.to : today;
    const ctx = await loadContext({ employeeWhere, from: p.from, to });
    const rows = [];
    for (const emp of ctx.employees) {
      const days = eachDay(p.from, to).map((d) => resolveDay(ctx, emp, d, today)).filter((d) => d.employed);
      const ot = days.filter((d) => d.overtime_minutes > 0);
      if (!ot.length) continue;
      rows.push({ ...who(emp), days: ot.length, overtime: sum(ot, (d) => d.overtime_minutes), worked: sum(days, (d) => d.worked_minutes) });
    }
    rows.sort((a, b) => b.overtime - a.overtime);
    return { rows, subtitle: `${p.from} → ${to}` };
  },

  async leaveRegister({ employeeWhere, p }) {
    const list = await prisma.hrLeaveRequest.findMany({
      where: {
        employee: employeeWhere,
        from_date: { lte: dbDay(p.to) },
        to_date: { gte: dbDay(p.from) },
        ...(p.kind === "all" ? {} : { status: p.kind }),
      },
      include: { leaveType: { select: { name: true } }, employee: { select: EMPLOYEE_SELECT } },
      orderBy: [{ from_date: "asc" }, { id: "asc" }],
    });
    return {
      rows: list.map((r) => ({
        id: `L-${r.id}`,
        ...who(r.employee),
        type: `${r.leaveType.name}${r.half_day ? " (half)" : ""}`,
        from: dayKeyOfDb(r.from_date),
        to: dayKeyOfDb(r.to_date),
        days: r.days,
        status: r.status,
        reason: r.reason ?? "",
      })),
      subtitle: `${p.from} → ${p.to}`,
    };
  },

  async leaveTaken({ employeeWhere, p }) {
    const [types, rows] = await Promise.all([
      prisma.hrLeaveType.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }], select: { id: true, code: true, name: true } }),
      prisma.hrAttendance.findMany({
        where: { status: STATUS.LEAVE, leave_type_id: { not: null }, date: { gte: dbDay(p.from), lte: dbDay(p.to) }, employee: employeeWhere },
        select: { employee_id: true, leave_type_id: true, leave_half: true, employee: { select: EMPLOYEE_SELECT } },
      }),
    ]);
    const byEmp = new Map();
    for (const r of rows) {
      if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, { ...who(r.employee), total: 0 });
      const row = byEmp.get(r.employee_id);
      const k = `t${r.leave_type_id}`;
      row[k] = (row[k] || 0) + (r.leave_half ? 0.5 : 1);
      row.total += r.leave_half ? 0.5 : 1;
    }
    const used = types.filter((t) => rows.some((r) => r.leave_type_id === t.id));
    return {
      columns: [
        { key: "emp_id", label: "Emp No", type: "int" },
        { key: "name", label: "Name" },
        { key: "department", label: "Department" },
        ...used.map((t) => ({ key: `t${t.id}`, label: t.name, type: "num", total: true })),
        { key: "total", label: "Total", type: "num", total: true },
      ],
      rows: [...byEmp.values()].sort((a, b) => b.total - a.total),
      subtitle: `${p.from} → ${p.to}`,
    };
  },

  async payrollSummary({ employeeWhere, p }) {
    const slips = await postedSlips(employeeWhere, { gte: p.fromMonth, lte: p.toMonth });
    const byMonth = new Map();
    for (const s of slips) {
      if (!byMonth.has(s.month)) byMonth.set(s.month, []);
      byMonth.get(s.month).push(s);
    }
    const rows = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, list]) => ({ month: monthLabel(m), employees: list.length, ...money(list) }));
    return { rows, subtitle: `${monthLabel(p.fromMonth)} → ${monthLabel(p.toMonth)} · posted payroll only` };
  },

  async payrollByDepartment({ employeeWhere, p }) {
    const slips = await postedSlips(employeeWhere, p.month);
    const byDept = new Map();
    for (const s of slips) {
      const k = s.employee.department?.dept_name ?? "—";
      if (!byDept.has(k)) byDept.set(k, []);
      byDept.get(k).push(s);
    }
    const rows = [...byDept.entries()]
      .map(([department, list]) => {
        const m = money(list);
        return { department, employees: list.length, ...m, cost: round2(m.earnings + m.employer) };
      })
      .sort((a, b) => b.cost - a.cost);
    return { rows, subtitle: `${monthLabel(p.month)} · posted payroll only` };
  },

  async incomeTax({ employeeWhere, p }) {
    const slips = await postedSlips(employeeWhere, { gte: p.fromMonth, lte: p.toMonth });
    const byEmp = new Map();
    for (const s of slips) {
      if (!byEmp.has(s.employee_id)) byEmp.set(s.employee_id, { ...who(s.employee), cnic: s.employee.cnicNumber ?? "", months: 0, taxable: 0, tax: 0 });
      const r = byEmp.get(s.employee_id);
      r.months += 1;
      r.taxable = round2(r.taxable + s.taxable);
      r.tax = round2(r.tax + s.income_tax);
    }
    return {
      rows: [...byEmp.values()].filter((r) => r.taxable > 0 || r.tax > 0).sort((a, b) => b.tax - a.tax),
      subtitle: `${monthLabel(p.fromMonth)} → ${monthLabel(p.toMonth)} · posted payroll only`,
    };
  },

  async salaryRegister({ employeeWhere }) {
    const today = todayKey();
    const emps = await prisma.employee.findMany({
      where: { AND: [employeeWhere, { status: "ACTIVE" }] },
      select: EMPLOYEE_SELECT,
      orderBy: [{ departmentId: "asc" }, { firstName: "asc" }],
    });
    const structures = await salaryOn(emps.map((e) => e.id), today);
    const rows = emps.map((e) => {
      const s = structures.get(e.id);
      const t = totalsOf(s);
      return {
        ...who(e),
        since: s ? dayKeyOfDb(s.effective_from) : "",
        basic: t?.basic ?? 0,
        allowances: t?.totalEarnings ?? 0,
        gross: t?.gross ?? 0,
        deductions: t?.totalDeductions ?? 0,
        net: t?.net ?? 0,
      };
    });
    return { rows, subtitle: `As on ${today} · active employees` };
  },

  async loansOutstanding({ employeeWhere, p }) {
    const loans = await prisma.hrLoan.findMany({
      where: { employee: employeeWhere, status: p.kind === "all" ? { in: ["active", "settled"] } : p.kind },
      include: { employee: { select: EMPLOYEE_SELECT }, recoveries: { select: { amount: true } } },
      orderBy: [{ status: "asc" }, { requested_at: "asc" }],
    });
    return {
      rows: loans.map((l) => ({
        id: `A-${l.id}`,
        ...who(l.employee),
        kind: LOAN_KINDS[l.kind]?.short ?? l.kind,
        disbursed: l.disbursed_on ? dayKeyOfDb(l.disbursed_on) : "",
        amount: l.amount,
        installment: l.installment,
        recovered: recoveredTotal(l.recoveries),
        outstanding: outstandingOf(l, l.recoveries),
        status: LOAN_STATUS[l.status]?.label ?? l.status,
      })),
      subtitle: `As on ${todayKey()}`,
    };
  },

  async headcount({ employeeWhere, p }) {
    const today = todayKey();
    const and = [employeeWhere];
    if (p.kind === "joined") and.push({ hireDate: { gte: dbDay(p.from), lte: dbDay(p.to) } });
    else if (p.kind === "left") and.push({ dor: { gte: dbDay(p.from), lte: dbDay(p.to) } });
    else and.push({ status: "ACTIVE" }, { hireDate: { lte: dbDay(p.to) } }, { OR: [{ dor: null }, { dor: { gt: dbDay(p.to) } }] });
    const emps = await prisma.employee.findMany({
      where: { AND: and },
      select: { ...EMPLOYEE_SELECT, gender: true, phoneNumber: true, cnicNumber: true },
      orderBy: [{ departmentId: "asc" }, { firstName: "asc" }],
    });
    const rows = emps.map((e) => {
      const hired = dayKeyOfDb(e.hireDate);
      const left = e.dor ? dayKeyOfDb(e.dor) : "";
      const end = left && left < today ? left : today;
      return {
        ...who(e),
        gender: e.gender ?? "",
        hired,
        left,
        service: hired <= end ? Math.round((daysBetween(hired, end) / 365.25) * 10) / 10 : 0,
        phone: e.phoneNumber ?? "",
        cnic: e.cnicNumber ?? "",
      };
    });
    const label = { active: `On the books on ${p.to}`, joined: `Joined ${p.from} → ${p.to}`, left: `Left ${p.from} → ${p.to}` }[p.kind];
    return { rows, subtitle: label };
  },
};

/** Payslips of posted runs for these months, inside the employee filter. */
function postedSlips(employeeWhere, month) {
  return prisma.hrPayslip.findMany({
    where: { month, run: { status: "POSTED" }, employee: employeeWhere },
    include: { employee: { select: { ...EMPLOYEE_SELECT, cnicNumber: true } } },
  });
}

/** Payslips → money columns. */
function money(list) {
  return {
    earnings: sum(list, (s) => s.total_earnings),
    overtime: sum(list, (s) => s.data?.overtime?.amount),
    tax: sum(list, (s) => s.income_tax),
    eobi: sum(list, (s) => s.eobi_employee),
    loans: sum(list, (s) => (s.data?.loans ?? []).reduce((t, l) => t + (Number(l.amount) || 0), 0)),
    deductions: sum(list, (s) => s.total_deductions),
    net: sum(list, (s) => s.net),
    employer: sum(list, (s) => s.eobi_employer),
  };
}

export async function runHrReport(key, { employeeWhere, searchParams }) {
  const def = HR_REPORTS[key];
  if (!def || !RUNNERS[key]) throw new ReportError("Unknown report.");
  const p = reportParams(key, searchParams);
  const out = await RUNNERS[key]({ employeeWhere, p });
  return { key, title: def.title, params: p, columns: out.columns ?? def.columns, rows: out.rows, subtitle: out.subtitle ?? "" };
}
