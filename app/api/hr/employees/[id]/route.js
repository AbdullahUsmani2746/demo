// /api/hr/employees/[id] — one employee's HR profile (Employees → profile).
//   GET ?month=YYYY-MM
//   → { employee, shift, attendance?, leave?, salary?, loans?, payslips? }
// Each section is there only with the right behind it (lib/hr/access.js),
// and only for an employee inside the person's departments.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, hrRights, HR_TEAM_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam } from "@/lib/hr/route";
import { assignmentOn, employeeLite, EMPLOYEE_SELECT, loadContext, resolveDay, shiftLite, summaryShift } from "@/lib/hr/attendance/sheet";
import { monthSummary } from "@/lib/hr/attendance/rules";
import { balancesFor, leaveYearStart } from "@/lib/hr/leave/balance";
import { leaveYearLabel, leaveYearOf } from "@/lib/hr/leave/policy";
import { STRUCTURE_INCLUDE, totalsOf } from "@/lib/hr/salary/service";
import { outstandingOf, recoveredTotal } from "@/lib/hr/loans/schedule";
import { monthLabel } from "@/lib/hr/payroll/post";
import { dayKeyOfDb, eachDay, hmOf, monthRange, todayKey } from "@/lib/hr/time";

export const GET = hrRoute(HR_TEAM_PERMS, async (req, { session, params }) => {
  const id = intParam((await params).id, "employee");
  await assertEmployeesInScope(session, [id]);
  const today = todayKey();
  const sp = new URL(req.url).searchParams;
  const range = monthRange(sp.get("month")) ?? monthRange(today.slice(0, 7));
  const rights = await hrRights(session);

  const emp = await prisma.employee.findUnique({
    where: { id },
    select: {
      ...EMPLOYEE_SELECT,
      gender: true, dob: true, phoneNumber: true, emailAddress: true, cnicNumber: true, eobiNo: true,
      paymentMethod: true, accountNumber: true, bankTitle: true, accountName: true,
      bank: { select: { name: true } },
      costCenter: { select: { ccname: true } },
      manager: { select: { manager: true } },
      user: { select: { username: true, email: true, role: true, isActive: true } },
    },
  });
  if (!emp) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  const out = {
    rights: { attendance: rights.view, leave: rights.leaveView, salary: rights.salaryView, loans: rights.loanView, payroll: rights.payrollView },
    employee: {
      ...employeeLite(emp),
      status: emp.status,
      gender: emp.gender,
      dob: dayKeyOfDb(emp.dob),
      hired: dayKeyOfDb(emp.hireDate),
      left: emp.dor ? dayKeyOfDb(emp.dor) : null,
      phone: emp.phoneNumber,
      email: emp.emailAddress,
      cnic: emp.cnicNumber,
      eobi_no: emp.eobiNo,
      cost_center: emp.costCenter?.ccname ?? null,
      manager: emp.manager?.manager ?? null,
      // Bank details only to someone who sees pay.
      bank: rights.salaryView || rights.payrollView
        ? { method: emp.paymentMethod, bank: emp.bank?.name ?? null, account: emp.accountNumber, title: emp.bankTitle || emp.accountName }
        : null,
      login: emp.user ? { username: emp.user.username || emp.user.email, role: emp.user.role, active: emp.user.isActive } : null,
    },
  };

  const tasks = [];

  // Attendance for the month, and the shift today.
  tasks.push(
    (async () => {
      const ctx = await loadContext({ employeeWhere: { id }, ...range });
      const e = ctx.employees[0];
      const a = assignmentOn(ctx, id, range.to < today ? range.to : today);
      out.shift = shiftLite(ctx.shiftById.get(a?.shift_id)) ?? shiftLite(e ? summaryShift(ctx, e) : null);
      if (!rights.view) return;
      if (!e) {
        out.attendance = { month: range.from.slice(0, 7), days: [], summary: null };
        return;
      }
      const days = eachDay(range.from, range.to).map((d) => resolveDay(ctx, e, d, today));
      out.attendance = {
        month: range.from.slice(0, 7),
        today,
        days: days.map((d) => ({
          day: d.day,
          status: d.employed ? d.status : null,
          check_in: d.employed ? hmOf(d.check_in) : null,
          check_out: d.employed ? hmOf(d.check_out) : null,
          late_minutes: d.late_minutes || 0,
          overtime_minutes: d.overtime_minutes || 0,
          holiday: ctx.holidayOn.get(d.day)?.name ?? null,
          leave: d.leave_type_id ? ctx.leaveTypeById.get(d.leave_type_id)?.name ?? "Leave" : null,
        })),
        summary: monthSummary(days.filter((d) => d.employed), summaryShift(ctx, e)),
      };
    })(),
  );

  if (rights.leaveView) {
    tasks.push(
      (async () => {
        const sm = await leaveYearStart();
        const year = leaveYearOf(today, sm);
        const [{ types, rows }, requests] = await Promise.all([
          balancesFor({ employeeIds: [id], year, startMonth: sm }),
          prisma.hrLeaveRequest.findMany({
            where: { employee_id: id },
            include: { leaveType: { select: { name: true, color: true } } },
            orderBy: { from_date: "desc" },
            take: 8,
          }),
        ]);
        out.leave = {
          label: leaveYearLabel(year, sm),
          balances: types
            .filter((t) => t.is_active)
            .map((t) => ({ type: { id: t.id, name: t.name, color: t.color, is_paid: t.is_paid }, ...rows.get(`${id}|${t.id}`) }))
            .filter((b) => b.unlimited ? b.used > 0 : b.entitled + b.carry_forward + b.adjustment > 0 || b.used > 0),
          requests: requests.map((r) => ({
            id: r.id,
            type: r.leaveType.name,
            color: r.leaveType.color,
            from: dayKeyOfDb(r.from_date),
            to: dayKeyOfDb(r.to_date),
            days: r.days,
            status: r.status,
          })),
        };
      })(),
    );
  }

  if (rights.salaryView) {
    tasks.push(
      (async () => {
        const list = await prisma.hrSalaryStructure.findMany({
          where: { employee_id: id, status: { in: ["active", "pending"] } },
          include: STRUCTURE_INCLUDE,
          orderBy: [{ effective_from: "desc" }, { id: "desc" }],
          take: 12,
        });
        const current = list.find((s) => s.status === "active" && dayKeyOfDb(s.effective_from) <= today) ?? null;
        const t = totalsOf(current);
        out.salary = {
          current: t
            ? {
                since: dayKeyOfDb(current.effective_from),
                basic: t.basic,
                gross: t.gross,
                net: t.net,
                lines: [...t.earnings, ...t.deductions].map((l) => ({ name: l.component.name, kind: l.component.kind, amount: l.amount })),
              }
            : null,
          history: list.map((s) => ({ id: s.id, from: dayKeyOfDb(s.effective_from), status: s.status, gross: totalsOf(s).gross })),
        };
      })(),
    );
  }

  if (rights.loanView) {
    tasks.push(
      (async () => {
        const loans = await prisma.hrLoan.findMany({
          where: { employee_id: id, status: { in: ["pending", "active", "settled"] } },
          include: { recoveries: { select: { amount: true } } },
          orderBy: { requested_at: "desc" },
          take: 10,
        });
        out.loans = loans.map((l) => ({
          id: l.id,
          kind: l.kind,
          amount: l.amount,
          installment: l.installment,
          status: l.status,
          recovered: recoveredTotal(l.recoveries),
          outstanding: outstandingOf(l, l.recoveries),
        }));
      })(),
    );
  }

  if (rights.payrollView) {
    tasks.push(
      (async () => {
        const slips = await prisma.hrPayslip.findMany({
          where: { employee_id: id, run: { status: "POSTED" } },
          select: { id: true, run_id: true, month: true, net: true, total_earnings: true, total_deductions: true, income_tax: true },
          orderBy: { month: "desc" },
          take: 12,
        });
        out.payslips = slips.map((p) => ({ ...p, label: monthLabel(p.month) }));
      })(),
    );
  }

  await Promise.all(tasks);
  return NextResponse.json(out);
});
