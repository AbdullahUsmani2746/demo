// /api/hr/payroll/mine — the signed-in employee's posted payslips (hr.payslip.own).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { hrRoute } from "@/lib/hr/route";
import { getCompany } from "@/lib/company";
import { monthLabel } from "@/lib/hr/payroll/post";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";

export const GET = hrRoute([HR_PERMS.payslipOwn], async (req, { session }) => {
  const me = await sessionEmployeeId(session);
  if (!me) return NextResponse.json({ payslips: [], employee: null });
  const [slips, company, emp] = await Promise.all([
    prisma.hrPayslip.findMany({ where: { employee_id: me, run: { status: "POSTED" } }, orderBy: { month: "desc" }, take: 36 }),
    getCompany().catch(() => null),
    prisma.employee.findUnique({ where: { id: me }, select: { ...EMPLOYEE_SELECT, cnicNumber: true, eobiNo: true } }),
  ]);
  return NextResponse.json({
    company: company ? { name: company.name, address: (company.address ?? []).filter(Boolean).join(", ") || null } : null,
    employee: emp ? { ...employeeLite(emp), cnic: emp.cnicNumber, eobi_no: emp.eobiNo } : null,
    payslips: slips.map((p) => ({
      id: p.id,
      month: p.month,
      label: monthLabel(p.month),
      data: p.data,
      net: p.net,
      total_earnings: p.total_earnings,
      total_deductions: p.total_deductions,
    })),
  });
});
