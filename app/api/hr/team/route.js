// /api/hr/team — the reporting line (who reports to whom). lib/hr/team.js.
//
//   GET   ?department=&location=&q=   active employees the person works with,
//         each with who they report to and how many report to them; plus the
//         leaders to pick from (every active employee — a plant manager may sit
//         at head office).
//   POST  { employee_ids, reports_to }   reports_to = employee id, or null for
//         "nobody". hr.team.manage, and only for employees in the person's scope.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeFilter, employeeName, HR_PERMS, HR_TEAM_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { setReportsTo } from "@/lib/hr/team";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";

const NAME = { id: true, firstName: true, middleName: true, surname: true };

export const GET = hrRoute(HR_TEAM_PERMS, async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const [employees, leaders, managers] = await Promise.all([
    prisma.employee.findMany({
      where: { AND: [await employeeFilter(session, sp), { status: "ACTIVE" }] },
      select: { ...EMPLOYEE_SELECT, managerId: true },
      orderBy: [{ departmentId: "asc" }, { firstName: "asc" }],
    }),
    prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { ...NAME, Designation: { select: { desg_name: true } } }, orderBy: { firstName: "asc" } }),
    prisma.manager.findMany({ select: { id: true, employeeId: true, _count: { select: { employees: { where: { status: "ACTIVE" } } } } } }),
  ]);
  const leaderOfManager = new Map(managers.map((m) => [m.id, m.employeeId]));
  const reports = new Map(managers.map((m) => [m.employeeId, m._count.employees]));
  const nameOf = new Map(leaders.map((l) => [l.id, employeeName(l)]));
  return NextResponse.json({
    employees: employees.map((e) => {
      const leader = e.managerId ? leaderOfManager.get(e.managerId) : null;
      return {
        ...employeeLite(e),
        reports_to: leader ? { id: leader, name: nameOf.get(leader) ?? `#${leader}` } : null,
        direct_reports: reports.get(e.id) ?? 0,
      };
    }),
    leaders: leaders.map((l) => ({ id: l.id, name: employeeName(l), designation: l.Designation?.desg_name ?? null })),
  });
});

export const POST = hrRoute([HR_PERMS.team], async (req, { session }) => {
  const b = await jsonBody(req);
  const ids = Array.isArray(b.employee_ids) ? b.employee_ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return NextResponse.json({ error: "Choose at least one employee." }, { status: 400 });
  await assertEmployeesInScope(session, ids);
  const leaderId = b.reports_to == null || b.reports_to === "" ? null : Number(b.reports_to);
  if (leaderId !== null && !Number.isInteger(leaderId)) return NextResponse.json({ error: "Choose who they report to." }, { status: 400 });
  const r = await setReportsTo(ids, leaderId);
  return NextResponse.json({
    success: true,
    message: r.leader ? `${r.count} employee(s) now report to ${r.leader.name}.` : `${r.count} employee(s) no longer report to anyone.`,
  });
});
