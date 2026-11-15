// /api/hr/punches — raw punches and machine-id mapping.
//
//   GET  ?date=YYYY-MM-DD    punches of that Karachi day (with employee names)
//   GET  ?unmapped=1         machine user ids with no employee: punch count, last punch
//   POST { device_user_id, employee_id }
//        map a machine id to an employee (Employee.attendanceId), attach its
//        punches and rebuild those days
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeName, employeeScopeWhere, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { rebuildFromPunches } from "@/lib/hr/attendance/save";
import { dayKeyOf, hmOf, instantAt, isDayKey, todayKey } from "@/lib/hr/time";

// Machines & punches tab only — for those who run the machines, not every HR viewer.
export const GET = hrRoute([HR_PERMS.import, HR_PERMS.devices], async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  if (sp.get("unmapped")) {
    const rows = await prisma.hrPunch.groupBy({
      by: ["device_user_id"],
      where: { employee_id: null },
      _count: { _all: true },
      _max: { punch_time: true },
      orderBy: { device_user_id: "asc" },
    });
    return NextResponse.json({
      unmapped: rows.map((r) => ({ device_user_id: r.device_user_id, punches: r._count._all, last: r._max.punch_time })),
    });
  }
  const date = isDayKey(sp.get("date")) ? sp.get("date") : todayKey();
  const scope = await employeeScopeWhere(session);
  const punches = await prisma.hrPunch.findMany({
    where: {
      punch_time: { gte: instantAt(date, 0), lt: instantAt(date, 1440) },
      // Unmapped punches are shown only to those who see every department.
      ...(Object.keys(scope).length ? { employee_id: { in: (await prisma.employee.findMany({ where: scope, select: { id: true } })).map((e) => e.id) } } : {}),
    },
    orderBy: { punch_time: "asc" },
    take: 5000,
    include: { device: { select: { name: true } } },
  });
  const ids = [...new Set(punches.map((p) => p.employee_id).filter(Boolean))];
  const emps = ids.length
    ? await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, middleName: true, surname: true } })
    : [];
  const name = new Map(emps.map((e) => [e.id, employeeName(e)]));
  return NextResponse.json({
    date,
    punches: punches.map((p) => ({
      id: p.id,
      device_user_id: p.device_user_id,
      employee_id: p.employee_id,
      employee: p.employee_id ? name.get(p.employee_id) ?? null : null,
      time: hmOf(p.punch_time),
      day: dayKeyOf(p.punch_time),
      source: p.source,
      device: p.device?.name ?? null,
    })),
  });
});

export const POST = hrRoute([HR_PERMS.devices], async (req, { session }) => {
  const body = await jsonBody(req);
  const code = String(body.device_user_id ?? "").trim();
  const employeeId = Number(body.employee_id);
  if (!code || code.length > 30) return NextResponse.json({ error: "Machine user id is required." }, { status: 400 });
  if (!Number.isInteger(employeeId)) return NextResponse.json({ error: "Pick an employee." }, { status: 400 });
  await assertEmployeesInScope(session, [employeeId]);

  const taken = await prisma.employee.findFirst({ where: { attendanceId: code, NOT: { id: employeeId } }, select: { id: true, firstName: true, surname: true } });
  if (taken) return NextResponse.json({ error: `Machine id ${code} already belongs to ${employeeName(taken)} (${taken.id}).` }, { status: 409 });

  const range = await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { attendanceId: code } });
    await tx.hrPunch.updateMany({ where: { device_user_id: code }, data: { employee_id: employeeId } });
    return tx.hrPunch.aggregate({ where: { device_user_id: code }, _min: { punch_time: true }, _max: { punch_time: true } });
  });
  let rebuilt = { days: 0 };
  if (range._min.punch_time) {
    const to = dayKeyOf(range._max.punch_time);
    rebuilt = await rebuildFromPunches({
      employeeIds: [employeeId],
      from: dayKeyOf(range._min.punch_time),
      to: to > todayKey() ? todayKey() : to,
      actor: session.user.id,
    });
  }
  return NextResponse.json({ success: true, message: `Machine id ${code} → employee ${employeeId}; ${rebuilt.days} day(s) rebuilt.` });
});
