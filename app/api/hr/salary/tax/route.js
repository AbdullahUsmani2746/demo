// /api/hr/salary/tax — income tax per employee (HR → Salary → Income tax).
//   PUT { employee_id, mode: "SLAB" | "NONE" }
//       SLAB = deducted by the tax slabs (default), NONE = not deducted.
// Salary rights (hr.salary.manage / approve), within the person's HR scope,
// never on their own record. Payroll uses it from the next compute.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, HR_PERMS, userIdsOfEmployee } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";

const MODES = ["SLAB", "NONE"];

export const PUT = hrRoute([HR_PERMS.salaryManage, HR_PERMS.salaryApprove], async (req, { session }) => {
  const b = await jsonBody(req);
  const id = Number(b.employee_id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Pick the employee." }, { status: 400 });
  if (!MODES.includes(b.mode)) return NextResponse.json({ error: "Income tax must be By slabs or Not deducted." }, { status: 400 });
  await assertEmployeesInScope(session, [id]);
  if ((await userIdsOfEmployee(id)).includes(session.user.id)) {
    return NextResponse.json({ error: "You cannot change the income tax setting on your own record." }, { status: 403 });
  }
  const e = await prisma.employee.update({ where: { id }, data: { incomeTaxMode: b.mode }, select: { id: true, incomeTaxMode: true } });
  return NextResponse.json({
    employee_id: e.id,
    mode: e.incomeTaxMode,
    message: e.incomeTaxMode === "NONE" ? "Income tax will not be deducted for this employee." : "Income tax will be deducted by the slabs.",
  });
});
