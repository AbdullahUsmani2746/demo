// /api/hr/dashboard — HR at a glance, for the departments this person may see.
//
// Each block is there only with the right behind it (lib/hr/access.js):
//   people     any HR "view" right   headcount, joiners / leavers, birthdays, anniversaries
//   today      attendance view       today's statuses, who is late / on leave / not in
//   month      attendance view       most late marks this month
//   leave      leave view            applications waiting, approved leave in the next 7 days
//   loans      loan view             active advances / loans, outstanding
//   payroll    payroll view          net pay of the last 6 posted months, this month's payroll
//   approvals  any                   HR requests waiting for this person
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { employeeScopeWhere, hrRights, HR_TEAM_PERMS } from "@/lib/hr/access";
import { hrRoute } from "@/lib/hr/route";
import { employeeLite, EMPLOYEE_SELECT, loadContext, resolveDay, summaryShift } from "@/lib/hr/attendance/sheet";
import { monthSummary, STATUS } from "@/lib/hr/attendance/rules";
import { hrTypesDecidableBy } from "@/lib/hr/approvals";
import { HR_APPROVAL_TYPES, HR_KIND } from "@/lib/hr/approvalTypes";
import { REQUEST_STATUS } from "@/lib/approvals/rules";
import { addMonths, outstandingOf } from "@/lib/hr/loans/schedule";
import { monthLabel } from "@/lib/hr/payroll/post";
import { addDays, dayKeyOfDb, dbDay, eachDay, monthRange, todayKey } from "@/lib/hr/time";


/** Days from `today` to the next yearly recurrence of a date (0 = today). */
function daysToNext(date, today) {
  const [ty, tm, td] = today.split("-").map(Number);
  const d = new Date(date);
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const base = Date.UTC(ty, tm - 1, td);
  let next = Date.UTC(ty, m, day);
  if (next < base) next = Date.UTC(ty + 1, m, day);
  return { days: Math.round((next - base) / 86400000), year: new Date(next).getUTCFullYear() };
}

export const GET = hrRoute(HR_TEAM_PERMS, async (req, { session }) => {
  const today = todayKey();
  const month = today.slice(0, 7);
  const mRange = monthRange(month);
  const [rights, scope] = await Promise.all([hrRights(session), employeeScopeWhere(session)]);
  const out = { today, month, rights: { attendance: rights.view, leave: rights.leaveView, loans: rights.loanView, payroll: rights.payrollView, salary: rights.salaryView } };

  // ── People ────────────────────────────────────────────────────────────────
  const people = await prisma.employee.findMany({
    where: { AND: [scope, { OR: [{ status: "ACTIVE" }, { dor: { gte: dbDay(mRange.from) } }] }] },
    select: { ...EMPLOYEE_SELECT, dob: true, gender: true },
  });
  const active = people.filter((e) => e.status === "ACTIVE" && (!e.dor || dayKeyOfDb(e.dor) >= today));
  const byDept = new Map();
  for (const e of active) {
    const k = e.department?.dept_name ?? "—";
    byDept.set(k, (byDept.get(k) || 0) + 1);
  }
  const soon = (field, minYears) =>
    active
      .filter((e) => e[field])
      .map((e) => {
        const n = daysToNext(e[field], today);
        return { employee: employeeLite(e), in_days: n.days, years: n.year - new Date(e[field]).getUTCFullYear() };
      })
      .filter((x) => x.in_days <= 14 && x.years >= minYears)
      .sort((a, b) => a.in_days - b.in_days)
      .slice(0, 8);
  out.people = {
    active: active.length,
    male: active.filter((e) => /^m/i.test(e.gender || "")).length,
    female: active.filter((e) => /^f/i.test(e.gender || "")).length,
    joined: people.filter((e) => dayKeyOfDb(e.hireDate) >= mRange.from && dayKeyOfDb(e.hireDate) <= mRange.to).map((e) => employeeLite(e)),
    left: people.filter((e) => e.dor && dayKeyOfDb(e.dor) >= mRange.from && dayKeyOfDb(e.dor) <= mRange.to).map((e) => employeeLite(e)),
    departments: [...byDept.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    birthdays: soon("dob", 1),
    anniversaries: soon("hireDate", 1),
  };

  const tasks = [];

  // ── Attendance: today and this month ──────────────────────────────────────
  if (rights.view) {
    tasks.push(
      (async () => {
        const ctx = await loadContext({ employeeWhere: scope, from: mRange.from, to: today });
        const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
        const late = [];
        const away = [];
        const lateBoard = [];
        for (const emp of ctx.employees) {
          const days = eachDay(mRange.from, today).map((d) => resolveDay(ctx, emp, d, today));
          const t = days[days.length - 1];
          if (t?.employed) {
            counts[t.status] = (counts[t.status] || 0) + 1;
            if (t.status === STATUS.LATE) late.push({ employee: employeeLite(emp), minutes: t.late_minutes });
            if (t.status === STATUS.LEAVE) away.push({ employee: employeeLite(emp), leave: ctx.leaveTypeById.get(t.leave_type_id)?.name ?? "Leave", half: Boolean(t.leave_half) });
          }
          // Up to yesterday + today so far: today's late mark counts once it happened.
          const s = monthSummary(days.filter((d) => d.employed), summaryShift(ctx, emp));
          if (s.lateMarks > 0) lateBoard.push({ employee: employeeLite(emp), marks: s.lateMarks, minutes: s.lateMinutes, cut: s.lateCutDays });
        }
        out.today_attendance = {
          counts,
          in: counts.PRESENT + counts.LATE + counts.HALF_DAY,
          expected: counts.PRESENT + counts.LATE + counts.HALF_DAY + counts.ABSENT + counts.PENDING + counts.LEAVE,
          late: late.sort((a, b) => b.minutes - a.minutes).slice(0, 8),
          on_leave: away,
        };
        out.month_lates = lateBoard.sort((a, b) => b.marks - a.marks || b.minutes - a.minutes).slice(0, 8);
      })(),
    );
  }

  // ── Leave ─────────────────────────────────────────────────────────────────
  if (rights.leaveView) {
    tasks.push(
      (async () => {
        const [waiting, upcoming] = await Promise.all([
          prisma.hrLeaveRequest.count({ where: { status: "pending", employee: scope } }),
          prisma.hrLeaveRequest.findMany({
            where: { status: "approved", employee: scope, from_date: { lte: dbDay(addDays(today, 7)) }, to_date: { gte: dbDay(addDays(today, 1)) } },
            include: { leaveType: { select: { name: true, color: true } }, employee: { select: EMPLOYEE_SELECT } },
            orderBy: { from_date: "asc" },
            take: 10,
          }),
        ]);
        out.leave = {
          waiting,
          upcoming: upcoming.map((r) => ({
            id: r.id,
            employee: employeeLite(r.employee),
            type: r.leaveType.name,
            color: r.leaveType.color,
            from: dayKeyOfDb(r.from_date),
            to: dayKeyOfDb(r.to_date),
            days: r.days,
          })),
        };
      })(),
    );
  }

  // ── Advances & loans ──────────────────────────────────────────────────────
  if (rights.loanView) {
    tasks.push(
      (async () => {
        const [activeLoans, pending] = await Promise.all([
          prisma.hrLoan.findMany({ where: { status: "active", employee: scope }, select: { id: true, kind: true, amount: true, recoveries: { select: { amount: true } } } }),
          prisma.hrLoan.count({ where: { status: "pending", employee: scope } }),
        ]);
        const sum = (kind) => activeLoans.filter((l) => !kind || l.kind === kind).reduce((s, l) => s + outstandingOf(l, l.recoveries), 0);
        out.loans = { active: activeLoans.length, pending, outstanding: sum(), advances: sum("ADVANCE"), loans: sum("LOAN") };
      })(),
    );
  }

  // ── Payroll ───────────────────────────────────────────────────────────────
  if (rights.payrollView) {
    tasks.push(
      (async () => {
        const from = addMonths(month, -6);
        // Summed from payslips (not run totals) so a department-limited person
        // sees only their departments' cost.
        const [byMonth, runs] = await Promise.all([
          prisma.hrPayslip.groupBy({
            by: ["month"],
            where: { month: { gte: from }, run: { status: "POSTED" }, employee: scope },
            _sum: { net: true, total_earnings: true, income_tax: true, eobi_employer: true },
            _count: { _all: true },
          }),
          prisma.hrPayrollRun.findMany({
            where: { month: { gte: addMonths(month, -1) }, status: { in: ["DRAFT", "PENDING", "APPROVED", "POSTED"] } },
            // No totals: a run covers every department; the months above are scoped.
            select: { id: true, month: true, title: true, status: true, employees: true },
            orderBy: [{ month: "desc" }, { id: "desc" }],
          }),
        ]);
        const months = [];
        for (let m = from; m < month; m = addMonths(m, 1)) {
          const g = byMonth.find((x) => x.month === m);
          months.push({
            month: m,
            label: monthLabel(m),
            employees: g?._count._all ?? 0,
            net: g?._sum.net ?? 0,
            cost: (g?._sum.total_earnings ?? 0) + (g?._sum.eobi_employer ?? 0),
            tax: g?._sum.income_tax ?? 0,
          });
        }
        out.payroll = { months, runs: runs.map((r) => ({ ...r, label: monthLabel(r.month) })) };
      })(),
    );
  }

  // ── Approvals waiting for me ─────────────────────────────────────────────
  tasks.push(
    (async () => {
      const types = await hrTypesDecidableBy(session);
      if (!types.length) return;
      const rows = await prisma.approvalRequest.groupBy({
        by: ["doc_type"],
        where: { kind: HR_KIND, doc_type: { in: types }, status: REQUEST_STATUS.PENDING, requested_by: { not: session.user.id } },
        _count: { _all: true },
      });
      out.approvals = rows.map((r) => ({ doc_type: r.doc_type, label: HR_APPROVAL_TYPES[r.doc_type]?.label ?? r.doc_type, count: r._count._all }));
    })(),
  );

  // ── Holidays ahead ────────────────────────────────────────────────────────
  tasks.push(
    (async () => {
      const hs = await prisma.hrHoliday.findMany({ where: { date: { gte: dbDay(today) } }, orderBy: { date: "asc" }, take: 4 });
      out.holidays = hs.map((h) => ({ date: dayKeyOfDb(h.date), name: h.name, is_paid: h.is_paid }));
    })(),
  );

  await Promise.all(tasks);
  return NextResponse.json(out);
});

