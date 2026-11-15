// /api/hr/payroll/[id] — one payroll run.
//   GET   the run, its payslips (inside the person's departments) and what they may do
//   POST  { action, ... }
//     recalculate                      DRAFT, hr.payroll.manage
//     add { employee_ids? }            DRAFT — eligible people (all when blank)
//     remove { employee_id }           DRAFT
//     submit                           DRAFT → PENDING (Approvals, hrPayroll)
//     withdraw                         PENDING → DRAFT (submitter or manager)
//     approve | reject { note }        PENDING, hr.payroll.approve (same as the inbox)
//     post                             APPROVED → POSTED, hr.payroll.post (journal voucher)
//     reverse { note }                 POSTED → REVERSED, hr.payroll.post (no live salary payment)
//     pay { date, cash_acno, employee_ids?, reference }   POSTED, hr.payroll.pay → Payment voucher
//     reverse_payment { payment_id, date, note }          hr.payroll.pay → reversal journal
//     delete                           DRAFT, hr.payroll.manage
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeScopeWhere, hrRights, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { calculateRun, eligibleEmployees, PayrollError, refreshTotals, RUN_STATUS } from "@/lib/hr/payroll/run";
import { monthLabel, postRun, reverseRun } from "@/lib/hr/payroll/post";
import { paymentState, payRun, reversePayment } from "@/lib/hr/payroll/pay";
import { canDecideHr, createHrRequest, decideHrRequest, hrSelfError } from "@/lib/hr/approvals";
import { REQUEST_STATUS } from "@/lib/approvals/rules";
import { getCompany } from "@/lib/company";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dayKeyOfDb, monthRange, todayKey } from "@/lib/hr/time";

export const maxDuration = 300;
const VIEW = [HR_PERMS.payrollView, HR_PERMS.payrollManage, HR_PERMS.payrollApprove, HR_PERMS.payrollPost, HR_PERMS.payrollPay];

async function names(ids) {
  const users = await prisma.user.findMany({ where: { id: { in: ids.filter(Boolean) } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

export const GET = hrRoute(VIEW, async (req, { params, session }) => {
  const id = intParam((await params).id);
  const run = await prisma.hrPayrollRun.findUnique({ where: { id } });
  if (!run) return NextResponse.json({ error: "Payroll not found." }, { status: 404 });
  const scope = await employeeScopeWhere(session);
  const [payslips, rights, company, nameOf] = await Promise.all([
    prisma.hrPayslip.findMany({
      where: { run_id: id, employee: scope },
      include: { employee: { select: { ...EMPLOYEE_SELECT, cnicNumber: true, eobiNo: true } } },
      orderBy: [{ employee: { departmentId: "asc" } }, { employee: { firstName: "asc" } }],
    }),
    hrRights(session),
    getCompany().catch(() => null),
    names([run.created_by, run.submitted_by, run.decided_by, run.posted_by, run.reversed_by]),
  ]);
  const pay = run.status === RUN_STATUS.POSTED || run.status === RUN_STATUS.REVERSED ? await paymentState(id) : null;
  const payNames = pay ? await names(pay.payments.flatMap((p) => [p.created_by, p.reversed_by])) : new Map();
  const accounts = pay?.payments.length
    ? new Map((await prisma.aCNO.findMany({ where: { acno: { in: [...new Set(pay.payments.map((p) => p.acno))] } }, select: { acno: true, acname: true } })).map((a) => [a.acno, a.acname]))
    : new Map();
  const request = run.approval_request_id ? await prisma.approvalRequest.findUnique({ where: { id: run.approval_request_id } }) : null;
  const selfBlock = request ? await hrSelfError(request, session) : null;
  const ended = monthRange(run.month).to < todayKey();
  const s = run.status;
  return NextResponse.json({
    company: company ? { name: company.name, address: (company.address ?? []).filter(Boolean).join(", ") || null } : null,
    run: {
      ...run,
      pay_date: dayKeyOfDb(run.pay_date),
      label: monthLabel(run.month),
      created_by: nameOf.get(run.created_by) ?? run.created_by,
      submitted_by: nameOf.get(run.submitted_by) ?? run.submitted_by,
      decided_by: nameOf.get(run.decided_by) ?? run.decided_by,
      posted_by: nameOf.get(run.posted_by) ?? run.posted_by,
      reversed_by: nameOf.get(run.reversed_by) ?? run.reversed_by,
      month_ended: ended,
    },
    payments: pay && {
      total: pay.total,
      paid: pay.paid,
      unpaid: pay.unpaid,
      paid_by: Object.fromEntries(pay.rows.filter((r) => r.paid_by).map((r) => [r.employee_id, r.paid_by])),
      list: pay.payments.map((p) => ({
        id: p.id,
        date: dayKeyOfDb(p.date),
        account: accounts.get(p.acno) ?? String(p.acno),
        amount: p.amount,
        count: p.employees.length,
        reference: p.reference,
        tran_id: p.tran_id,
        reversal_tran_id: p.reversal_tran_id,
        reverse_reason: p.reverse_reason,
        by: payNames.get(p.created_by) ?? p.created_by,
        reversed_by: p.reversed_by ? payNames.get(p.reversed_by) ?? p.reversed_by : null,
      })),
    },
    payslips: payslips.map((p) => ({
      id: p.id,
      employee: { ...employeeLite(p.employee), cnic: p.employee.cnicNumber, eobi_no: p.employee.eobiNo },
      data: p.data,
      adjustments: p.adjustments,
      loan_overrides: p.loan_overrides,
      hold: p.hold,
      paid_days: p.paid_days,
      total_earnings: p.total_earnings,
      total_deductions: p.total_deductions,
      net: p.net,
      warnings: p.warnings,
    })),
    can: {
      edit: s === RUN_STATUS.DRAFT && rights.payrollManage,
      submit: s === RUN_STATUS.DRAFT && rights.payrollManage && run.employees > 0,
      withdraw: s === RUN_STATUS.PENDING && (run.submitted_by === session.user.id || rights.payrollManage),
      decide: s === RUN_STATUS.PENDING && rights.payrollApprove && !selfBlock,
      self_block: selfBlock,
      post: s === RUN_STATUS.APPROVED && rights.payrollPost,
      post_blocked: s === RUN_STATUS.APPROVED && !ended ? `${monthLabel(run.month)} is not over yet.` : null,
      reverse: s === RUN_STATUS.POSTED && rights.payrollPost,
      pay: s === RUN_STATUS.POSTED && rights.payrollPay && (pay?.unpaid ?? 0) > 0,
      reverse_payment: rights.payrollPay,
      delete: s === RUN_STATUS.DRAFT && rights.payrollManage,
    },
  });
});

export const POST = hrRoute(VIEW, async (req, { params, session }) => {
  const id = intParam((await params).id);
  const b = await jsonBody(req);
  const run = await prisma.hrPayrollRun.findUnique({ where: { id } });
  if (!run) return NextResponse.json({ error: "Payroll not found." }, { status: 404 });
  const rights = await hrRights(session);
  const note = b.note ? String(b.note).trim().slice(0, 500) || null : null;
  const actor = session.user.id;
  const must = (ok, message = "You may not do this.") => {
    if (!ok) throw new PayrollError(message, 403);
  };
  const draft = () => {
    if (run.status !== RUN_STATUS.DRAFT) throw new PayrollError(`This payroll is ${run.status.toLowerCase()} — only a draft can be changed.`, 409);
  };

  switch (b.action) {
    case "recalculate": {
      must(rights.payrollManage);
      draft();
      const r = await calculateRun(id);
      return NextResponse.json({ success: true, message: `Recalculated ${r.count} payslip(s)${r.removed ? `; ${r.removed} no longer employed this month were taken out` : ""}.` });
    }
    case "add": {
      must(rights.payrollManage);
      draft();
      const { employees } = await eligibleEmployees({ month: run.month, employeeWhere: await employeeScopeWhere(session), excludeRunId: id });
      const inRun = new Set((await prisma.hrPayslip.findMany({ where: { run_id: id }, select: { employee_id: true } })).map((p) => p.employee_id));
      const wanted = Array.isArray(b.employee_ids) && b.employee_ids.length ? new Set(b.employee_ids.map(Number)) : null;
      const add = employees.filter((e) => !inRun.has(e.id) && (!wanted || wanted.has(e.id))).map((e) => e.id);
      if (!add.length) return NextResponse.json({ error: "Nobody else can be added — everyone eligible is already in a payroll of this month." }, { status: 409 });
      await calculateRun(id, { addEmployeeIds: add });
      return NextResponse.json({ success: true, message: `${add.length} employee(s) added.` });
    }
    case "remove": {
      must(rights.payrollManage);
      draft();
      await prisma.hrPayslip.deleteMany({ where: { run_id: id, employee_id: Number(b.employee_id) } });
      await refreshTotals(id);
      return NextResponse.json({ success: true, message: "Taken out of this payroll." });
    }
    case "submit": {
      must(rights.payrollManage);
      draft();
      if (!run.employees) throw new PayrollError("There is nobody in this payroll.", 409);
      const claimed = await prisma.hrPayrollRun.updateMany({ where: { id, status: RUN_STATUS.DRAFT }, data: { status: RUN_STATUS.PENDING, submitted_by: actor, submitted_at: new Date(), decision_note: null } });
      if (claimed.count !== 1) throw new PayrollError("This payroll changed a moment ago — refresh.", 409);
      const request = await createHrRequest({
        docType: "hrPayroll",
        payload: { run_id: id },
        summary: `Payroll ${monthLabel(run.month)} (#P-${id}) · ${run.employees} employee(s) · net ${fmtMoney(run.total_net)}${note ? ` — ${note}` : ""}`,
        session,
      });
      await prisma.hrPayrollRun.update({ where: { id }, data: { approval_request_id: request.id } });
      return NextResponse.json({ success: true, message: "Sent for approval." });
    }
    case "withdraw": {
      must(run.status === RUN_STATUS.PENDING && (run.submitted_by === actor || rights.payrollManage));
      await prisma.hrPayrollRun.updateMany({ where: { id, status: RUN_STATUS.PENDING }, data: { status: RUN_STATUS.DRAFT, approval_request_id: null, decision_note: "Withdrawn" } });
      if (run.approval_request_id) {
        await prisma.approvalRequest.updateMany({
          where: { id: run.approval_request_id, status: REQUEST_STATUS.PENDING },
          data: { status: REQUEST_STATUS.CANCELLED, decided_by: actor, decided_at: new Date(), remarks: "Withdrawn to change it" },
        });
      }
      return NextResponse.json({ success: true, message: "Withdrawn — the payroll is a draft again." });
    }
    case "approve":
    case "reject": {
      if (run.status !== RUN_STATUS.PENDING) throw new PayrollError("This payroll is not waiting for approval.", 409);
      const request = run.approval_request_id ? await prisma.approvalRequest.findUnique({ where: { id: run.approval_request_id } }) : null;
      if (!request || request.status !== REQUEST_STATUS.PENDING) throw new PayrollError("Its approval request is not waiting any more — refresh.", 409);
      must(await canDecideHr(session, "hrPayroll"), "You may not approve payroll.");
      const { status, body } = await decideHrRequest({ request, action: b.action, note, session });
      return NextResponse.json(body, { status });
    }
    case "post": {
      must(rights.payrollPost, "You may not post payroll to accounts.");
      const jv = await postRun(id, { actor });
      return NextResponse.json({ success: true, message: `Posted to accounts — journal voucher #${jv.tran_id}. Pay the salaries from "Payments" when they are paid.`, ...jv });
    }
    case "reverse": {
      must(rights.payrollPost, "You may not reverse payroll.");
      const r = await reverseRun(id, { actor, reason: note });
      return NextResponse.json({ success: true, message: `Reversed${r.tran_id ? ` — reversal journal voucher #${r.tran_id}` : ""}. Attendance of the month is open again and loan recoveries are undone.` });
    }
    case "pay": {
      must(rights.payrollPay, "You may not pay salaries.");
      const ids = Array.isArray(b.employee_ids) ? b.employee_ids : [];
      if (ids.length) await assertEmployeesInScope(session, ids.map(Number));
      const r = await payRun(id, { date: b.date, cashAcno: b.cash_acno, employeeIds: ids, reference: b.reference, session });
      return NextResponse.json({ success: true, message: `${fmtMoney(r.amount)} paid to ${r.count} employee(s) from ${r.account} — payment voucher #${r.tran_id}.` });
    }
    case "reverse_payment": {
      must(rights.payrollPay, "You may not reverse salary payments.");
      const r = await reversePayment(id, Number(b.payment_id), { date: b.date, reason: note, session });
      return NextResponse.json({ success: true, message: `${r.label} reversed — journal voucher #${r.tran_id}. Those employees show as unpaid again.` });
    }
    case "delete": {
      must(rights.payrollManage);
      draft();
      await prisma.hrPayrollRun.delete({ where: { id } });
      return NextResponse.json({ success: true, message: "Draft payroll deleted." });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
});
