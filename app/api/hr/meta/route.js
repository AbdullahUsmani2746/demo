// /api/hr/meta — what every HR screen needs first:
// the person's HR rights, the departments and work locations they may see
// (for the filters), active shifts, rules.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/auth/roles";
import { hrRights, getHrSettings, HR_PERMS, sessionEmployeeId, employeeName } from "@/lib/hr/access";
import { isUnrestricted, scopeFor } from "@/lib/auth/scope";
import { hrRoute } from "@/lib/hr/route";
import { SHIFT_SELECT } from "@/lib/hr/attendance/sheet";
import { todayKey } from "@/lib/hr/time";

export const GET = hrRoute(Object.values(HR_PERMS), async (req, { session }) => {
  const [scope, locScope] = await Promise.all([scopeFor(session, "department"), scopeFor(session, "workLocation")]);
  const [rights, settings, departments, locations, shifts, leaveTypes, selfId] = await Promise.all([
    hrRights(session),
    getHrSettings(),
    prisma.department.findMany({
      where: isUnrestricted(scope) ? {} : { id: { in: scope.values.map(Number).filter(Number.isFinite) } },
      select: { id: true, dept_name: true },
      orderBy: { dept_name: "asc" },
    }),
    prisma.workLocation.findMany({
      where: isUnrestricted(locScope) ? {} : { id: { in: locScope.values.map(Number).filter(Number.isFinite) } },
      select: { id: true, location_name: true },
      orderBy: { location_name: "asc" },
    }),
    prisma.hrShift.findMany({ select: SHIFT_SELECT, orderBy: [{ is_active: "desc" }, { start_time: "asc" }] }),
    prisma.hrLeaveType.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
    sessionEmployeeId(session),
  ]);
  const self = selfId
    ? await prisma.employee.findUnique({ where: { id: selfId }, select: { id: true, firstName: true, middleName: true, surname: true } })
    : null;
  return NextResponse.json({
    rights,
    settings,
    departments,
    locations: locations.map((l) => ({ id: l.id, name: l.location_name || `Location ${l.id}` })),
    shifts,
    leaveTypes,
    self: self ? { id: self.id, name: employeeName(self) } : null,
    today: todayKey(),
    isAdmin: isSuperAdmin(session),
  });
});
