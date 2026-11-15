// /api/hr/employees — employee picker for HR screens (pay history, leaving).
//   GET ?q=&left=1   up to 30 employees inside the person's HR scope, by name
//                    or number; active ones only unless left=1.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { employeeFilter, HR_TEAM_PERMS } from "@/lib/hr/access";
import { hrRoute } from "@/lib/hr/route";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dayKeyOfDb } from "@/lib/hr/time";

export const GET = hrRoute(HR_TEAM_PERMS, async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const and = [await employeeFilter(session, sp)];
  if (!sp.get("left")) and.push({ status: "ACTIVE" });
  const rows = await prisma.employee.findMany({ where: { AND: and }, select: EMPLOYEE_SELECT, orderBy: [{ firstName: "asc" }, { id: "asc" }], take: 30 });
  return NextResponse.json({ employees: rows.map((e) => ({ ...employeeLite(e), hired: dayKeyOfDb(e.hireDate), left: e.dor ? dayKeyOfDb(e.dor) : null })) });
});
