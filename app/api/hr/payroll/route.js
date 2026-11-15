// /api/hr/payroll — payroll runs.
//   GET   ?year=   runs, newest first (hr.payroll.view / manage / approve / post)
//   POST  { month, pay_date, title, department, notes }  (hr.payroll.manage)
//         a DRAFT run of everyone employed that month in the person's
//         departments (one department if given) who is not already in another
//         live run of the month — calculated at once.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { employeeScopeWhere, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { calculateRun, eligibleEmployees, PayrollError } from "@/lib/hr/payroll/run";
import { monthLabel } from "@/lib/hr/payroll/post";
import { dayKeyOfDb, dbDay, isDayKey, monthRange } from "@/lib/hr/time";

export const maxDuration = 300;
const VIEW = [HR_PERMS.payrollView, HR_PERMS.payrollManage, HR_PERMS.payrollApprove, HR_PERMS.payrollPost];

export const GET = hrRoute(VIEW, async (req) => {
  const y = Number(new URL(req.url).searchParams.get("year"));
  const runs = await prisma.hrPayrollRun.findMany({
    where: Number.isInteger(y) && y > 2000 ? { month: { startsWith: `${y}-` } } : {},
    orderBy: [{ month: "desc" }, { id: "desc" }],
    take: 200,
  });
  return NextResponse.json({
    runs: runs.map((r) => ({ ...r, pay_date: dayKeyOfDb(r.pay_date), label: monthLabel(r.month) })),
  });
});

export const POST = hrRoute([HR_PERMS.payrollManage], async (req, { session }) => {
  const b = await jsonBody(req);
  const range = monthRange(b.month);
  if (!range) throw new PayrollError("Pick the month.");
  const payDate = isDayKey(b.pay_date) ? b.pay_date : range.to;
  const dept = Number(b.department);
  const where = { AND: [await employeeScopeWhere(session), ...(Number.isInteger(dept) && dept > 0 ? [{ departmentId: dept }] : [])] };
  const { employees, taken } = await eligibleEmployees({ month: b.month, employeeWhere: where });
  if (!employees.length) {
    throw new PayrollError(taken.size ? "Everyone is already in another payroll of this month." : "Nobody was employed in that month.", 409);
  }
  const run = await prisma.hrPayrollRun.create({
    data: {
      month: b.month,
      pay_date: dbDay(payDate),
      title: b.title ? String(b.title).trim().slice(0, 150) || null : null,
      notes: b.notes ? String(b.notes).trim().slice(0, 500) || null : null,
      created_by: session.user.id,
    },
  });
  await calculateRun(run.id, { addEmployeeIds: employees.map((e) => e.id) });
  return NextResponse.json(
    { id: run.id, message: `Payroll ${monthLabel(b.month)} created for ${employees.length} employee(s)${taken.size ? ` (${taken.size} already in another payroll)` : ""}.` },
    { status: 201 },
  );
});
