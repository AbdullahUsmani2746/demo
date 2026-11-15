// /api/hr/shifts/assignments — who works which shift, from when.
//
//   GET    ?department=&q=&date=   active employees with the assignment in force
//                                   on `date` (default today), any later one, and history
//   POST   { employeeIds, shift_id, effective_from, week_off_override, week_off_days }
//          one assignment per employee from that date (replaces one on the same date).
//          Days from that date on are read with the new shift (locked days excepted).
//   DELETE ?id=   remove one assignment
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeFilter, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { assignmentData } from "@/lib/hr/shifts";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dayKeyOfDb, dbDay, isDayKey, todayKey } from "@/lib/hr/time";

const lite = (a) => ({
  id: a.id,
  shift_id: a.shift_id,
  effective_from: dayKeyOfDb(a.effective_from),
  week_off_override: a.week_off_override,
  week_off_days: a.week_off_days,
});

export const GET = hrRoute(Object.values(HR_PERMS), async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const on = isDayKey(sp.get("date")) ? sp.get("date") : todayKey();
  const employees = await prisma.employee.findMany({
    where: { AND: [await employeeFilter(session, sp), { status: "ACTIVE" }] },
    select: { ...EMPLOYEE_SELECT, hrShiftAssignments: { orderBy: { effective_from: "asc" } } },
    orderBy: [{ departmentId: "asc" }, { firstName: "asc" }],
  });
  return NextResponse.json({
    date: on,
    employees: employees.map((e) => {
      const all = e.hrShiftAssignments.map(lite);
      const past = all.filter((a) => a.effective_from <= on);
      return {
        employee: employeeLite(e),
        current: past[past.length - 1] ?? null,
        upcoming: all.filter((a) => a.effective_from > on),
        history: all,
      };
    }),
  });
});

export const POST = hrRoute([HR_PERMS.shifts], async (req, { session }) => {
  const d = assignmentData(await jsonBody(req));
  await assertEmployeesInScope(session, d.employeeIds);
  const shift = await prisma.hrShift.findUnique({ where: { id: d.shift_id }, select: { id: true, code: true, is_active: true } });
  if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
  if (!shift.is_active) return NextResponse.json({ error: `Shift ${shift.code} is switched off — switch it on first.` }, { status: 400 });

  const from = dbDay(d.effective_from);
  await prisma.$transaction([
    prisma.hrShiftAssignment.deleteMany({ where: { employee_id: { in: d.employeeIds }, effective_from: from } }),
    prisma.hrShiftAssignment.createMany({
      data: d.employeeIds.map((employee_id) => ({
        employee_id,
        shift_id: d.shift_id,
        effective_from: from,
        week_off_override: d.week_off_override,
        week_off_days: d.week_off_days,
        created_by: session.user.id,
      })),
    }),
  ]);
  return NextResponse.json({
    success: true,
    message: `${d.employeeIds.length} employee(s) on shift ${shift.code} from ${d.effective_from}.`,
  });
});

export const DELETE = hrRoute([HR_PERMS.shifts], async (req, { session }) => {
  const id = intParam(new URL(req.url).searchParams.get("id"));
  const a = await prisma.hrShiftAssignment.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  await assertEmployeesInScope(session, [a.employee_id]);
  await prisma.hrShiftAssignment.delete({ where: { id } });
  return NextResponse.json({ success: true, message: "Assignment removed." });
});
