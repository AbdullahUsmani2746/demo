// /api/hr/self — is the signed-in person an employee, and which "My HR" parts
// they have (the sidebar's My HR link and the /dashboard/my-hr tabs).
// Kept light: it is called on every page load by the sidebar.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { can } from "@/lib/auth/permissions";
import { employeeName, HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { hrRoute } from "@/lib/hr/route";

const PARTS = {
  attendance: HR_PERMS.attendanceOwn,
  leave: HR_PERMS.leaveApply,
  loans: HR_PERMS.loanApply,
  payslips: HR_PERMS.payslipOwn,
};

export const GET = hrRoute(Object.values(PARTS), async (req, { session }) => {
  const id = await sessionEmployeeId(session);
  const emp = id
    ? await prisma.employee.findUnique({ where: { id }, select: { id: true, firstName: true, middleName: true, surname: true, status: true } })
    : null;
  if (!emp) return NextResponse.json({ employee: null, parts: {} });
  const parts = Object.fromEntries(await Promise.all(Object.entries(PARTS).map(async ([k, code]) => [k, await can(session, code)])));
  return NextResponse.json({ employee: { id: emp.id, name: employeeName(emp), active: emp.status === "ACTIVE" }, parts });
});
