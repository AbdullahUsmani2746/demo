// /api/hr/payroll/[id]/bank-files — what the bank transfer files and the bank
// advice letter of a payroll are made from (feature hr.bankDisbursement,
// right hr.payroll.bankfile). The screen lays each bank's rows out with its
// format (lib/hr/payroll/bankFile.js) — the layouts are data
// (Settings "hr.bank_file_formats", /api/hr/payroll/bank-formats).
//
//   GET → { run, company, formats, banks: [{ bank_id, bank, format_id, rows, total }],
//           cash: [...], cheque: [...], missing: [...] }
// Only an APPROVED or POSTED run, held payslips and nothing-to-pay left out,
// and only the employees the person works with (employeeScopeWhere).
// Bank details are the employee's as they are now (Employee → bank, branch,
// account number, account title).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { employeeName, employeeScopeWhere, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, requireFeature } from "@/lib/hr/route";
import { RUN_STATUS } from "@/lib/hr/payroll/run";
import { monthLabel } from "@/lib/hr/payroll/post";
import { paymentState } from "@/lib/hr/payroll/pay";
import { getBankFormats } from "@/lib/hr/settingsData";
import { formatForBank } from "@/lib/hr/payroll/bankFile";
import { getCompany } from "@/lib/company";
import { dayKeyOfDb } from "@/lib/hr/time";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const GET = hrRoute([HR_PERMS.bankFile], async (req, { params, session }) => {
  await requireFeature("hr.bankDisbursement");
  const id = intParam((await params).id);
  const run = await prisma.hrPayrollRun.findUnique({ where: { id } });
  if (!run) return NextResponse.json({ error: "Payroll not found." }, { status: 404 });
  if (![RUN_STATUS.APPROVED, RUN_STATUS.POSTED].includes(run.status)) {
    return NextResponse.json({ error: `Bank files are made from an approved or posted payroll — this one is ${run.status.toLowerCase()}.` }, { status: 409 });
  }
  const scope = await employeeScopeWhere(session);
  const [slips, formats, company, state] = await Promise.all([
    prisma.hrPayslip.findMany({
      where: { run_id: id, hold: false, net: { gt: 0 }, employee: scope },
      select: {
        employee_id: true,
        net: true,
        employee: {
          select: {
            id: true, firstName: true, middleName: true, surname: true, cnicNumber: true, paymentMethod: true,
            bankId: true, accountNumber: true, accountName: true, bankTitle: true,
            bank: { select: { id: true, name: true } },
            bankBranch: { select: { name: true, branch_code: true } },
            department: { select: { dept_name: true } },
          },
        },
      },
      orderBy: { employee_id: "asc" },
    }),
    getBankFormats(),
    getCompany().catch(() => null),
    paymentState(id),
  ]);
  const paidBy = new Map(state.rows.filter((r) => r.paid_by).map((r) => [r.employee_id, r.paid_by]));
  const row = (p) => {
    const e = p.employee;
    return {
      emp_id: e.id,
      name: employeeName(e),
      cnic: e.cnicNumber ?? "",
      department: e.department?.dept_name ?? "",
      bank: e.bank?.name ?? "",
      branch: e.bankBranch?.name ?? "",
      branch_code: e.bankBranch?.branch_code ?? "",
      account: e.accountNumber ?? "",
      title: e.bankTitle || e.accountName || employeeName(e),
      amount: r2(p.net),
      method: e.paymentMethod,
      paid_by: paidBy.get(e.id) ?? null,
    };
  };
  const banks = new Map();
  const cash = [];
  const cheque = [];
  const missing = [];
  for (const p of slips) {
    const r = row(p);
    if (p.employee.paymentMethod === "CASH") cash.push(r);
    else if (p.employee.paymentMethod === "CHEQUE") cheque.push(r);
    else if (!p.employee.bankId || !String(p.employee.accountNumber ?? "").trim()) missing.push({ ...r, problem: !p.employee.bankId ? "No bank on the employee" : "No account number" });
    else {
      const k = p.employee.bankId;
      if (!banks.has(k)) banks.set(k, { bank_id: k, bank: p.employee.bank?.name ?? `Bank ${k}`, format_id: formatForBank(formats, k).id, rows: [], total: 0 });
      const b = banks.get(k);
      b.rows.push(r);
      b.total = r2(b.total + r.amount);
    }
  }
  const total = (list) => r2(list.reduce((s, r) => s + r.amount, 0));
  return NextResponse.json({
    run: { id: run.id, month: run.month, label: monthLabel(run.month), status: run.status, pay_date: dayKeyOfDb(run.pay_date), jv_tran_id: run.jv_tran_id },
    company: company ? { name: company.name, address: (company.address ?? []).filter(Boolean).join(", ") || null } : null,
    formats,
    banks: [...banks.values()].sort((a, b) => a.bank.localeCompare(b.bank)),
    cash: { rows: cash, total: total(cash) },
    cheque: { rows: cheque, total: total(cheque) },
    missing: { rows: missing, total: total(missing) },
  });
});
