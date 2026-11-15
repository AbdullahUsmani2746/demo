// /api/hr/payroll/eligible?month=&department= — how many could go in a new run.
import { NextResponse } from "next/server";
import { employeeScopeWhere, HR_PERMS } from "@/lib/hr/access";
import { hrRoute } from "@/lib/hr/route";
import { eligibleEmployees } from "@/lib/hr/payroll/run";

export const GET = hrRoute([HR_PERMS.payrollManage], async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const dept = Number(sp.get("department"));
  const where = { AND: [await employeeScopeWhere(session), ...(Number.isInteger(dept) && dept > 0 ? [{ departmentId: dept }] : [])] };
  const { employees, taken } = await eligibleEmployees({ month: sp.get("month"), employeeWhere: where });
  return NextResponse.json({ eligible: employees.length, already: taken.size });
});
