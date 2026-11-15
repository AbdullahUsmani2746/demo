// /api/hr/tax-certificate — yearly salary & income-tax certificates
// (feature hr.taxCertificate; lib/hr/taxCertificate.js).
//   GET ?fy=2026                    employees with salary that year (payroll rights, HR scope)
//   GET ?fy=2026&employee=12        one certificate (payroll rights, HR scope)
//   GET ?fy=2026&mine=1             the signed-in employee's own (hr.payslip.own)
// fy = the year the tax year starts in (rule taxYearStartMonth, July by default).
import { NextResponse } from "next/server";
import { assertEmployeesInScope, employeeScopeWhere, getHrSettings, hrRights, HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { ForbiddenError } from "@/lib/auth/permissions";
import { hrRoute, requireFeature } from "@/lib/hr/route";
import { fiscalYearOf } from "@/lib/hr/payroll/compute";
import { certificateFor, certificateList, fyName } from "@/lib/hr/taxCertificate";
import { getCompany } from "@/lib/company";
import { todayKey } from "@/lib/hr/time";

export const GET = hrRoute([HR_PERMS.payrollView, HR_PERMS.payrollManage, HR_PERMS.payrollApprove, HR_PERMS.payrollPost, HR_PERMS.payrollPay, HR_PERMS.payslipOwn], async (req, { session }) => {
  await requireFeature("hr.taxCertificate");
  const sp = new URL(req.url).searchParams;
  const settings = await getHrSettings();
  const startMonth = settings.taxYearStartMonth || 7;
  const current = fiscalYearOf(todayKey().slice(0, 7), startMonth);
  const fy = Number(sp.get("fy")) || current;
  if (!Number.isInteger(fy) || fy < 2000 || fy > current + 1) return NextResponse.json({ error: "Pick a tax year." }, { status: 400 });
  const years = Array.from({ length: 6 }, (_, i) => ({ value: current - i, label: fyName(current - i, startMonth) }));
  const company = await getCompany().catch(() => null);
  const companyLite = company ? { name: company.name, address: (company.address ?? []).filter(Boolean).join(", ") || null } : null;
  const rights = await hrRights(session);

  if (sp.get("mine")) {
    if (!rights.payslipOwn) throw new ForbiddenError("You may not see your own payslips.", HR_PERMS.payslipOwn);
    const me = await sessionEmployeeId(session);
    if (!me) return NextResponse.json({ error: "Your login is not linked to an employee." }, { status: 404 });
    return NextResponse.json({ years, company: companyLite, certificate: await certificateFor({ employeeId: me, fy, startMonth }) });
  }
  if (!rights.payrollView) throw new ForbiddenError("You do not have access to payroll.", HR_PERMS.payrollView);
  const employeeId = Number(sp.get("employee"));
  if (Number.isInteger(employeeId) && employeeId > 0) {
    await assertEmployeesInScope(session, [employeeId]);
    return NextResponse.json({ years, company: companyLite, certificate: await certificateFor({ employeeId, fy, startMonth }) });
  }
  return NextResponse.json({ years, fy, fy_label: fyName(fy, startMonth), rows: await certificateList({ fy, startMonth, employeeWhere: await employeeScopeWhere(session) }) });
});
