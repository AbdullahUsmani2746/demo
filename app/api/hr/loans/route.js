// /api/hr/loans — salary advances and loans.
//
//   GET  ?status=&kind=&department=&q=&mine=1
//        everyone's (hr.loan.view / manage / approve, in their departments) or own
//   POST { employee_id?, kind, amount, installment, start_month, reason, approve_now? }
//        employee_id blank = myself (hr.loan.apply); others need hr.loan.manage.
//        Goes to Approvals (hrLoan); a loan approver entering it for someone
//        else may approve it at once.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { employeeFilter, employeeName, hrRights, HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { loanActor } from "@/lib/hr/loans/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { activate, loanData, logEvent, thisMonth } from "@/lib/hr/loans/service";
import { dueInMonth, isRefundable, LOAN_KINDS, LOAN_STATUS, loanApprovalType, outstandingOf, recoveredTotal } from "@/lib/hr/loans/schedule";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { createHrRequest } from "@/lib/hr/approvals";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dayKeyOfDb } from "@/lib/hr/time";

const ALL = [HR_PERMS.loanApply, HR_PERMS.loanView, HR_PERMS.loanManage, HR_PERMS.loanApprove, HR_PERMS.pfLoanApprove];

export const GET = hrRoute(ALL, async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const [rights, selfId] = await Promise.all([hrRights(session), sessionEmployeeId(session)]);
  const mine = sp.get("mine") === "1" || !rights.loanView;
  if (mine && !selfId) return NextResponse.json({ loans: [], selfId: null });
  const and = [mine ? { employee_id: selfId } : { employee: await employeeFilter(session, sp) }];
  if (LOAN_STATUS[sp.get("status")]) and.push({ status: sp.get("status") });
  if (LOAN_KINDS[sp.get("kind")]) and.push({ kind: sp.get("kind") });

  const loans = await prisma.hrLoan.findMany({
    where: { AND: and },
    orderBy: [{ requested_at: "desc" }],
    take: 500,
    include: { employee: { select: EMPLOYEE_SELECT }, recoveries: { select: { amount: true } } },
  });
  const month = thisMonth();
  return NextResponse.json({
    selfId,
    month,
    loans: loans.map((l) => {
      const owed = outstandingOf(l, l.recoveries);
      return {
        id: l.id,
        employee: employeeLite(l.employee),
        kind: l.kind,
        amount: l.amount,
        installment: l.installment,
        start_month: l.start_month,
        status: l.status,
        reason: l.reason,
        recovered: recoveredTotal(l.recoveries),
        outstanding: owed,
        due_this_month: dueInMonth(l, month, owed),
        disbursed_on: l.disbursed_on ? dayKeyOfDb(l.disbursed_on) : null,
        requested_at: l.requested_at,
        self: l.employee_id === selfId,
      };
    }),
  });
});

export const POST = hrRoute([HR_PERMS.loanApply, HR_PERMS.loanManage], async (req, { session }) => {
  const b = await jsonBody(req);
  const who = await loanActor(session, b.employee_id ? Number(b.employee_id) : null);
  const d = await loanData({ ...b, employee_id: who.employeeId });
  const waiting = await prisma.hrLoan.findFirst({ where: { employee_id: who.employeeId, kind: d.kind, status: "pending" } });
  if (waiting) return NextResponse.json({ error: `A ${LOAN_KINDS[d.kind].label.toLowerCase()} for this employee is already waiting (#A-${waiting.id}).` }, { status: 409 });

  const loan = await prisma.hrLoan.create({
    data: {
      employee_id: who.employeeId,
      kind: d.kind,
      amount: d.amount,
      installment: d.installment,
      start_month: d.start_month,
      reason: d.reason,
      requested_by: session.user.id,
    },
    include: { employee: { select: { firstName: true, middleName: true, surname: true } } },
  });
  const refundable = isRefundable(d.kind);
  const plan = refundable ? `${fmtMoney(d.installment)} × ${d.count} from ${d.start_month}` : "not paid back";
  await logEvent(loan.id, "applied", `${fmtMoney(d.amount)} · ${plan}${d.reason ? ` — ${d.reason}` : ""}`, session.user.id);
  const what = `${employeeName(loan.employee)} · ${LOAN_KINDS[d.kind].label} ${fmtMoney(d.amount)}${refundable ? ` · ${fmtMoney(d.installment)}/month from ${d.start_month}` : ""}`;
  // PF loans / withdrawals have their own approvers (hr.pfloan.approve).
  const docType = loanApprovalType(d.kind);
  const mayApprove = docType === "hrPfLoan" ? who.rights.pfLoanApprove : who.rights.loanApprove;

  if (b.approve_now && !who.self && mayApprove) {
    await activate(loan.id, { actor: session.user.id, note: "Approved when entered" });
    return NextResponse.json({ id: loan.id, status: "active", message: `#A-${loan.id} recorded and approved — ${what}.` }, { status: 201 });
  }
  const request = await createHrRequest({ docType, payload: { loan_id: loan.id }, summary: `${what}${d.reason ? ` — ${d.reason}` : ""}`, session });
  await prisma.hrLoan.update({ where: { id: loan.id }, data: { approval_request_id: request.id } });
  return NextResponse.json({ id: loan.id, status: "pending", message: `#A-${loan.id} sent for approval — ${what}.` }, { status: 201 });
});
