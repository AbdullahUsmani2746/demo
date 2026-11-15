// lib/hr/taxCertificate.js — yearly certificate of salary paid and income tax
// deducted (feature hr.taxCertificate). From posted payslips and posted final
// settlements only; the tax year starts in the month of rule taxYearStartMonth.
import prisma from "@/lib/prisma";
import { employeeName } from "@/lib/hr/access";
import { fiscalYearEnd } from "@/lib/hr/payroll/compute";
import { monthLabel } from "@/lib/hr/payroll/post";
import { dayKeyOfDb, monthRange } from "@/lib/hr/time";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const fyMonths = (fy, startMonth) => ({ from: `${fy}-${String(startMonth).padStart(2, "0")}`, to: fiscalYearEnd(fy, startMonth) });
export const fyName = (fy, startMonth) => (startMonth === 1 ? String(fy) : `${fy}–${String(fy + 1).slice(2)}`);

/** Employees with salary in the year (inside `employeeWhere`), with totals — the list on the screen. */
export async function certificateList({ fy, startMonth, employeeWhere }) {
  const { from, to } = fyMonths(fy, startMonth);
  const rows = await prisma.hrPayslip.groupBy({
    by: ["employee_id"],
    where: { month: { gte: from, lte: to }, run: { status: "POSTED" }, employee: employeeWhere },
    _sum: { total_earnings: true, taxable: true, income_tax: true },
    _count: { _all: true },
  });
  const emps = await prisma.employee.findMany({
    where: { id: { in: rows.map((r) => r.employee_id) } },
    select: { id: true, firstName: true, middleName: true, surname: true, cnicNumber: true },
  });
  const byId = new Map(emps.map((e) => [e.id, e]));
  return rows
    .map((r) => ({
      employee_id: r.employee_id,
      name: employeeName(byId.get(r.employee_id)),
      cnic: byId.get(r.employee_id)?.cnicNumber ?? "",
      months: r._count._all,
      gross: r2(r._sum.total_earnings),
      taxable: r2(r._sum.taxable),
      tax: r2(r._sum.income_tax),
    }))
    .sort((a, b) => a.employee_id - b.employee_id);
}

/** One employee's certificate for fiscal year `fy`. */
export async function certificateFor({ employeeId, fy, startMonth }) {
  const { from, to } = fyMonths(fy, startMonth);
  const [emp, slips, settlements] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true, firstName: true, middleName: true, surname: true, cnicNumber: true, fatherName: true, hireDate: true, dor: true,
        department: { select: { dept_name: true } }, Designation: { select: { desg_name: true } },
      },
    }),
    prisma.hrPayslip.findMany({
      where: { employee_id: employeeId, month: { gte: from, lte: to }, run: { status: "POSTED" } },
      select: { month: true, run_id: true, total_earnings: true, taxable: true, income_tax: true, total_deductions: true, net: true },
      orderBy: { month: "asc" },
    }),
    prisma.hrSettlement.findMany({
      where: { employee_id: employeeId, status: "POSTED", dor: { gte: new Date(`${from}-01T00:00:00.000Z`), lte: new Date(`${monthRange(to).to}T00:00:00.000Z`) } },
      select: { id: true, dor: true, total_earnings: true, data: true },
    }),
  ]);
  if (!emp) throw Object.assign(new Error("Employee not found."), { status: 404 });
  const months = slips.map((s) => ({ month: s.month, label: monthLabel(s.month), ref: `Payroll #P-${s.run_id}`, gross: r2(s.total_earnings), taxable: r2(s.taxable), tax: r2(s.income_tax) }));
  for (const s of settlements) {
    const tax = r2(s.data?.tax);
    months.push({ month: dayKeyOfDb(s.dor).slice(0, 7), label: `Final settlement (${dayKeyOfDb(s.dor)})`, ref: `Settlement #S-${s.id}`, gross: r2(s.data?.taxable_earnings ?? s.total_earnings), taxable: r2(s.data?.taxable_earnings ?? 0), tax });
  }
  const total = (k) => r2(months.reduce((t, m) => t + m[k], 0));
  return {
    fy,
    fy_label: fyName(fy, startMonth),
    from,
    to,
    period: `${monthLabel(from)} – ${monthLabel(to)}`,
    employee: {
      id: emp.id,
      name: employeeName(emp),
      father: emp.fatherName ?? null,
      cnic: emp.cnicNumber ?? null,
      department: emp.department?.dept_name ?? null,
      designation: emp.Designation?.desg_name ?? null,
      hired: dayKeyOfDb(emp.hireDate),
      left: emp.dor ? dayKeyOfDb(emp.dor) : null,
    },
    months,
    totals: { gross: total("gross"), taxable: total("taxable"), tax: total("tax") },
  };
}
