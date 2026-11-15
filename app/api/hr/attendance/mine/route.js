// /api/hr/attendance/mine — the signed-in employee's own attendance (hr.attendance.own).
//
//   GET  ?month=YYYY-MM
//        → { employee, shift, days: [{ day, weekday, holiday, status, in, out, … }], summary }
//   POST { date, check_in, check_out, reason }
//        "I forgot to punch / the machine missed me": files a correction for one
//        of their own days. It always goes to Approvals (hrAttendance) — an
//        employee never changes their own attendance directly, and whoever
//        approves it may not be that same employee (lib/hr/approvals.js).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { employeeLite, loadContext, resolveDay, shiftLite, summaryShift } from "@/lib/hr/attendance/sheet";
import { monthSummary } from "@/lib/hr/attendance/rules";
import { AttendanceError, normalizeEntries } from "@/lib/hr/attendance/save";
import { createHrRequest, openHrRequests } from "@/lib/hr/approvals";
import { dayKeyOfDb, dbDay, eachDay, hmOf, isDayKey, monthRange, todayKey, weekdayOf } from "@/lib/hr/time";

const DOC = "hrAttendance";

/** Own days waiting in open correction requests → request id. */
async function waitingDays(employeeId) {
  const map = new Map();
  for (const r of await openHrRequests(DOC)) {
    for (const e of r.payload?.entries || []) if (Number(e.employee_id) === employeeId) map.set(e.date, r.id);
  }
  return map;
}

export const GET = hrRoute([HR_PERMS.attendanceOwn], async (req, { session }) => {
  const me = await sessionEmployeeId(session);
  if (!me) return NextResponse.json({ employee: null });
  const sp = new URL(req.url).searchParams;
  const today = todayKey();
  const range = monthRange(sp.get("month")) ?? monthRange(today.slice(0, 7));
  const [ctx, waiting] = await Promise.all([loadContext({ employeeWhere: { id: me }, ...range }), waitingDays(me)]);
  const emp = ctx.employees[0];
  if (!emp) return NextResponse.json({ employee: null, month: range.from.slice(0, 7), today, days: [], summary: null });

  const resolved = eachDay(range.from, range.to).map((d) => resolveDay(ctx, emp, d, today));
  const shift = summaryShift(ctx, emp);
  return NextResponse.json({
    employee: employeeLite(emp),
    shift: shiftLite(shift),
    month: range.from.slice(0, 7),
    today,
    days: resolved.map((d) => {
      const h = ctx.holidayOn.get(d.day);
      return {
        day: d.day,
        weekday: weekdayOf(d.day),
        holiday: h ? h.name : null,
        employed: d.employed,
        status: d.status,
        check_in: d.employed ? hmOf(d.check_in) : null,
        check_out: d.employed ? hmOf(d.check_out) : null,
        late_minutes: d.late_minutes || 0,
        early_minutes: d.early_minutes || 0,
        overtime_minutes: d.overtime_minutes || 0,
        worked_minutes: d.worked_minutes || 0,
        needs_review: Boolean(d.needs_review),
        locked: Boolean(d.locked),
        leave: d.leave_type_id ? { name: ctx.leaveTypeById.get(d.leave_type_id)?.name ?? "Leave", half: Boolean(d.leave_half) } : null,
        on_leave_request: Boolean(d.leave_request_id),
        remarks: d.remarks || null,
        waiting_request: waiting.get(d.day) ?? null,
      };
    }),
    summary: monthSummary(resolved.filter((d) => d.employed), shift),
  });
});

export const POST = hrRoute([HR_PERMS.attendanceOwn], async (req, { session }) => {
  const me = await sessionEmployeeId(session);
  if (!me) throw new AttendanceError("Your login is not linked to an employee — ask HR to link it.");
  const b = await jsonBody(req);
  const date = String(b.date ?? "");
  if (!isDayKey(date)) throw new AttendanceError("Pick the day.");
  if (date > todayKey()) throw new AttendanceError("You can only correct a day that has started.");
  const reason = String(b.reason ?? "").trim().slice(0, 300);
  if (!reason) throw new AttendanceError("Say what happened (e.g. “forgot to punch out”) — the approver sees it.");
  if (!b.check_in && !b.check_out) throw new AttendanceError("Enter the time you came in and / or left.");
  const [entry] = normalizeEntries([{ employee_id: me, date, check_in: b.check_in, check_out: b.check_out, status: "AUTO", remarks: reason }]);

  const [emp, row, waiting] = await Promise.all([
    prisma.employee.findUnique({ where: { id: me }, select: { hireDate: true, dor: true } }),
    prisma.hrAttendance.findUnique({ where: { employee_id_date: { employee_id: me, date: dbDay(date) } } }),
    waitingDays(me),
  ]);
  if (!emp || dayKeyOfDb(emp.hireDate) > date || (emp.dor && dayKeyOfDb(emp.dor) < date)) {
    throw new AttendanceError("You were not employed on that day.");
  }
  if (row?.locked) throw new AttendanceError("Payroll for that month is already posted — the day can no longer change. Talk to HR.");
  if (row?.leave_request_id) throw new AttendanceError(`That day is approved leave (#L-${row.leave_request_id}) — withdraw the leave on My HR → Leave instead.`);
  if (waiting.has(date)) {
    return NextResponse.json({ error: `A correction for ${date} is already waiting for approval (#R-${waiting.get(date)}).` }, { status: 409 });
  }

  const times = [entry.check_in && `in ${entry.check_in}`, entry.check_out && `out ${entry.check_out}`].filter(Boolean).join(", ");
  const request = await createHrRequest({
    docType: DOC,
    payload: { entries: [entry], reason, self: true },
    summary: `Own attendance ${date}: ${times} — ${reason}`,
    session,
  });
  return NextResponse.json({ request_id: request.id, message: `Sent for approval as #R-${request.id}.` }, { status: 201 });
});
