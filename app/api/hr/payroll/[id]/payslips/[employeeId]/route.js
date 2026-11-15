// /api/hr/payroll/[id]/payslips/[employeeId]
//   PUT { adjustments: [{ kind, label, amount, taxable, acno }], loan_overrides: { loanId: amount }, hold }
//   One-off earnings / deductions, a different instalment this month, or
//   salary on hold — on a DRAFT run (hr.payroll.manage). The payslip is
//   recalculated at once.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { calculateRun, cleanAdjustments, PayrollError, RUN_STATUS } from "@/lib/hr/payroll/run";

export const PUT = hrRoute([HR_PERMS.payrollManage], async (req, { params, session }) => {
  const p = await params;
  const runId = intParam(p.id);
  const employeeId = intParam(p.employeeId, "employee");
  await assertEmployeesInScope(session, [employeeId]);
  const run = await prisma.hrPayrollRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!run) return NextResponse.json({ error: "Payroll not found." }, { status: 404 });
  if (run.status !== RUN_STATUS.DRAFT) throw new PayrollError("Only payslips of a draft payroll can be changed.", 409);
  const slip = await prisma.hrPayslip.findUnique({ where: { run_id_employee_id: { run_id: runId, employee_id: employeeId } } });
  if (!slip) return NextResponse.json({ error: "This employee is not in the payroll." }, { status: 404 });

  const b = await jsonBody(req);
  const adjustments = cleanAdjustments(b.adjustments ?? slip.adjustments);
  const overrides = {};
  for (const [k, v] of Object.entries(b.loan_overrides ?? slip.loan_overrides ?? {})) {
    if (v === "" || v === null || v === undefined) continue;
    const n = Math.round(Number(v) * 100) / 100;
    if (!Number.isFinite(n) || n < 0) throw new PayrollError("A loan instalment must be 0 or more.");
    overrides[Number(k)] = n;
  }
  await prisma.hrPayslip.update({
    where: { id: slip.id },
    data: { adjustments, loan_overrides: overrides, hold: b.hold === undefined ? slip.hold : Boolean(b.hold) },
  });
  // Rewrites just this payslip; the run totals are refreshed inside.
  await calculateRun(runId, { onlyEmployeeIds: [employeeId] });
  return NextResponse.json({ success: true, message: "Payslip updated." });
});
