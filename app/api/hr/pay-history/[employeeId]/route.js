// /api/hr/pay-history/[employeeId] — one employee's pay over the years
// (feature hr.payHistory): every payslip month by month, salary structure
// changes, advances / loans and final settlements. Payroll or salary rights,
// inside the person's HR scope. Payslips link to their payroll
// (/accounting/hr/payroll/<run>?slip=<employee>).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, requireFeature } from "@/lib/hr/route";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { STRUCTURE_INCLUDE, totalsOf } from "@/lib/hr/salary/service";
import { LOAN_KINDS, LOAN_STATUS, outstandingOf, recoveredTotal } from "@/lib/hr/loans/schedule";
import { monthLabel } from "@/lib/hr/payroll/post";
import { dayKeyOfDb } from "@/lib/hr/time";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const VIEW = [HR_PERMS.payrollView, HR_PERMS.payrollManage, HR_PERMS.payrollApprove, HR_PERMS.payrollPost, HR_PERMS.payrollPay, HR_PERMS.salaryView, HR_PERMS.salaryManage, HR_PERMS.salaryApprove];

export const GET = hrRoute(VIEW, async (req, { params, session }) => {
  await requireFeature("hr.payHistory");
  const employeeId = intParam((await params).employeeId, "employee");
  await assertEmployeesInScope(session, [employeeId]);
  const [emp, slips, structures, loans, settlements] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { ...EMPLOYEE_SELECT, cnicNumber: true } }),
    prisma.hrPayslip.findMany({
      where: { employee_id: employeeId, run: { status: { not: "REVERSED" } } },
      select: { run_id: true, month: true, paid_days: true, total_earnings: true, total_deductions: true, net: true, income_tax: true, eobi_employee: true, pf_employee: true, pf_employer: true, gratuity: true, hold: true, data: true, run: { select: { status: true } } },
      orderBy: { month: "desc" },
    }),
    prisma.hrSalaryStructure.findMany({ where: { employee_id: employeeId, status: { in: ["active", "pending"] } }, include: STRUCTURE_INCLUDE, orderBy: [{ effective_from: "desc" }, { id: "desc" }] }),
    prisma.hrLoan.findMany({ where: { employee_id: employeeId, status: { in: ["active", "settled", "pending"] } }, include: { recoveries: { select: { amount: true } } }, orderBy: { requested_at: "desc" } }),
    prisma.hrSettlement.findMany({ where: { employee_id: employeeId }, select: { id: true, status: true, dor: true, net: true, separation_id: true }, orderBy: { id: "desc" } }),
  ]);
  if (!emp) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  const payslips = slips.map((p) => ({
    run_id: p.run_id,
    month: p.month,
    label: monthLabel(p.month),
    status: p.run.status,
    paid_days: p.paid_days,
    gross: r2(p.data?.salary?.gross),
    earnings: r2(p.total_earnings),
    tax: r2(p.income_tax),
    eobi: r2(p.eobi_employee),
    pf: r2(p.pf_employee),
    loans: r2((p.data?.loans ?? []).reduce((t, l) => t + (Number(l.amount) || 0), 0)),
    deductions: r2(p.total_deductions),
    net: r2(p.net),
    hold: p.hold,
  }));
  const posted = payslips.filter((p) => p.status === "POSTED");
  const sum = (k) => r2(posted.reduce((t, p) => t + p[k], 0));
  // Oldest first to work out each change against the one before.
  const ordered = [...structures].reverse();
  const salary = ordered
    .map((s, i) => {
      const t = totalsOf(s);
      const prev = i > 0 ? totalsOf(ordered[i - 1]) : null;
      return {
        id: s.id,
        from: dayKeyOfDb(s.effective_from),
        status: s.status,
        basic: r2(t.basic),
        gross: r2(t.gross),
        change: prev ? r2(t.gross - prev.gross) : null,
        change_pct: prev?.gross ? Math.round(((t.gross - prev.gross) / prev.gross) * 1000) / 10 : null,
        reason: s.reason,
      };
    })
    .reverse();
  return NextResponse.json({
    employee: { ...employeeLite(emp), hired: dayKeyOfDb(emp.hireDate), left: emp.dor ? dayKeyOfDb(emp.dor) : null, cnic: emp.cnicNumber ?? null },
    totals: { months: posted.length, earnings: sum("earnings"), tax: sum("tax"), pf: sum("pf"), deductions: sum("deductions"), net: sum("net") },
    payslips,
    salary,
    loans: loans.map((l) => ({
      id: l.id,
      kind: LOAN_KINDS[l.kind]?.short ?? l.kind,
      amount: r2(l.amount),
      installment: r2(l.installment),
      disbursed: l.disbursed_on ? dayKeyOfDb(l.disbursed_on) : null,
      status: LOAN_STATUS[l.status]?.label ?? l.status,
      recovered: recoveredTotal(l.recoveries),
      outstanding: outstandingOf(l, l.recoveries),
    })),
    settlements: settlements.map((s) => ({ id: s.id, status: s.status, dor: dayKeyOfDb(s.dor), net: r2(s.net), separation_id: s.separation_id })),
  });
});
