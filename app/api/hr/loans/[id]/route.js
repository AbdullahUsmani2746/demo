// /api/hr/loans/[id]
//   GET   the loan with its schedule, repayments, timeline and checks
//   POST  { action, ... }
//     approve | reject { note }       same decision as the Approvals inbox
//     cancel { note }                 pending: requester / employee / manager;
//                                     active with nothing recovered: manager
//     skip { month, reason }                   skip / un-skip a month (hr.loan.manage)
//     reschedule { installment, start_month?, reason }              (hr.loan.manage)
//   Money — posts vouchers (lib/hr/vouchers.js), hr.loan.disburse, never on one's own:
//     disburse { date, cash_acno, reference }        paid out → Payment voucher
//     repay { amount, date, cash_acno, reference }   repaid → Receipt voucher
//     reverse_payout { date, note }                  nothing recovered yet → reversal journal
//     reverse_repayment { recovery_id, date, note }  → reversal journal
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeName, hrRights, HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { disburse, policyFlags, recordCash, reschedule, reversePayout, reverseRepayment, skipMonth, thisMonth } from "@/lib/hr/loans/service";
import { dueInMonth, isPfKind, isRefundable, LOAN_KINDS, loanApprovalType, outstandingOf, ownLoanAcno, recoveredTotal, schedule } from "@/lib/hr/loans/schedule";
import { completePayStep, decideHrRequest, mayDecideHr, mayPayOut, payersOf } from "@/lib/hr/approvals";
import { REQUEST_STATUS } from "@/lib/approvals/rules";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dayKeyOfDb } from "@/lib/hr/time";

const ALL = [HR_PERMS.loanApply, HR_PERMS.loanView, HR_PERMS.loanManage, HR_PERMS.loanApprove, HR_PERMS.loanDisburse, HR_PERMS.pfLoanApprove];

async function access(session, loan) {
  const [rights, selfId] = await Promise.all([hrRights(session), sessionEmployeeId(session)]);
  const self = loan.employee_id === selfId;
  if (!self) {
    if (!rights.loanView) throw Object.assign(new Error("Not yours to see."), { status: 403 });
    await assertEmployeesInScope(session, [loan.employee_id]);
  }
  return { rights, self };
}

export const GET = hrRoute(ALL, async (req, { params, session }) => {
  const id = intParam((await params).id);
  const loan = await prisma.hrLoan.findUnique({
    where: { id },
    include: {
      employee: { select: { ...EMPLOYEE_SELECT, advanceAcno: true, loanAcno: true } },
      recoveries: { orderBy: { date: "asc" } },
      events: { orderBy: { created_at: "asc" } },
    },
  });
  if (!loan) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { rights, self } = await access(session, loan);
  const month = thisMonth();
  const owed = outstandingOf(loan, loan.recoveries);
  const userIds = [...new Set([loan.requested_by, loan.decided_by, ...loan.events.map((e) => e.created_by), ...loan.recoveries.map((r) => r.created_by)].filter(Boolean))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  const { flags, gross } = loan.status === "pending" ? await policyFlags({ employee_id: loan.employee_id, kind: loan.kind, amount: loan.amount, excludeLoanId: loan.id }) : { flags: [], gross: null };
  const manage = rights.loanManage && !self;
  const money = rights.loanDisburse && !self;
  // The approval chain may have sent it to someone in particular for payment.
  const payer = (await payersOf([loan.approval_request_id])).get(loan.approval_request_id) ?? null;
  return NextResponse.json({
    month,
    loan: {
      id: loan.id,
      employee: employeeLite(loan.employee),
      acno: ownLoanAcno(loan.kind, loan.employee),
      kind: loan.kind,
      pf: isPfKind(loan.kind),
      refundable: isRefundable(loan.kind),
      amount: loan.amount,
      installment: loan.installment,
      start_month: loan.start_month,
      skip_months: loan.skip_months,
      status: loan.status,
      reason: loan.reason,
      decision_note: loan.decision_note,
      disbursed_on: loan.disbursed_on ? dayKeyOfDb(loan.disbursed_on) : null,
      disbursement_ref: loan.disbursement_ref,
      disburse_tran_id: loan.disburse_tran_id,
      recovered: recoveredTotal(loan.recoveries),
      outstanding: owed,
      due_this_month: dueInMonth(loan, month, owed),
      pay_with: payer ? { names: payer.names, mine: mayPayOut(session, payer) } : null,
      requested_by: nameOf.get(loan.requested_by) ?? loan.requested_by,
      requested_at: loan.requested_at,
    },
    schedule: isRefundable(loan.kind) ? schedule(loan, loan.recoveries, month) : [],
    recoveries: loan.recoveries.map((r) => ({ id: r.id, date: dayKeyOfDb(r.date), month: r.month, amount: r.amount, source: r.source, reference: r.reference, tran_id: r.tran_id, by: nameOf.get(r.created_by) ?? r.created_by })),
    events: loan.events.map((e) => ({ id: e.id, action: e.action, detail: e.detail, at: e.created_at, by: nameOf.get(e.created_by) ?? e.created_by })),
    flags,
    gross,
    can: {
      decide: loan.status === "pending" && (loanApprovalType(loan.kind) === "hrPfLoan" ? rights.pfLoanApprove : rights.loanApprove) && !self,
      cancel: (loan.status === "pending" && (self || loan.requested_by === session.user.id || rights.loanManage)) || (loan.status === "active" && manage && recoveredTotal(loan.recoveries) === 0),
      manage: loan.status === "active" && manage && isRefundable(loan.kind),
      // Money moves are finance's (hr.loan.disburse), never on one's own loan.
      disburse: loan.status === "active" && !loan.disbursed_on && money && mayPayOut(session, payer),
      repay: loan.status === "active" && Boolean(loan.disbursed_on) && money && isRefundable(loan.kind),
      reverse_payout: Boolean(loan.disburse_tran_id) && loan.recoveries.length === 0 && money,
      reverse_repayment: money,
    },
  });
});

export const POST = hrRoute(ALL, async (req, { params, session }) => {
  const id = intParam((await params).id);
  const b = await jsonBody(req);
  const loan = await prisma.hrLoan.findUnique({ where: { id }, include: { recoveries: { select: { amount: true } }, employee: { select: { firstName: true, middleName: true, surname: true } } } });
  if (!loan) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { rights, self } = await access(session, loan);
  const actor = session.user.id;
  const note = b.note ? String(b.note).trim().slice(0, 500) || null : null;
  const managerOnly = () => {
    if (!rights.loanManage || self) throw Object.assign(new Error("Only a loan manager can do this (and not on their own loan)."), { status: 403 });
  };
  const financeOnly = () => {
    if (!rights.loanDisburse || self) throw Object.assign(new Error("Only someone who pays out advances and loans can do this (and not on their own)."), { status: 403 });
  };
  const fullLoan = () => prisma.hrLoan.findUnique({ where: { id } });

  switch (b.action) {
    case "approve":
    case "reject": {
      if (loan.status !== "pending") return NextResponse.json({ error: `#A-${id} is already ${loan.status}.` }, { status: 409 });
      const request = loan.approval_request_id ? await prisma.approvalRequest.findUnique({ where: { id: loan.approval_request_id } }) : null;
      if (!request || request.status !== REQUEST_STATUS.PENDING) return NextResponse.json({ error: "Its approval request is not waiting any more — refresh." }, { status: 409 });
      // The chain's step people, or — without a chain — the type's approvers (PF: hr.pfloan.approve).
      if (!(await mayDecideHr(session, request))) return NextResponse.json({ error: `You may not approve this ${LOAN_KINDS[loan.kind].label.toLowerCase()} (or not at this step).` }, { status: 403 });
      const { status, body } = await decideHrRequest({ request, action: b.action, note, session, nextUsers: b.next_users });
      return NextResponse.json(body, { status });
    }
    case "cancel": {
      if (loan.status === "pending") {
        if (!(self || loan.requested_by === actor || rights.loanManage)) return NextResponse.json({ error: "Not yours to cancel." }, { status: 403 });
      } else if (loan.status === "active") {
        managerOnly();
        if (recoveredTotal(loan.recoveries) > 0) return NextResponse.json({ error: "Something has already been recovered — record the rest as a repayment instead." }, { status: 409 });
        if (loan.disbursed_on) return NextResponse.json({ error: "It has been paid out — reverse the pay-out first, or record the repayment." }, { status: 409 });
        if (!note) return NextResponse.json({ error: "Say why an approved advance / loan is cancelled." }, { status: 400 });
      } else return NextResponse.json({ error: `#A-${id} is already ${loan.status}.` }, { status: 409 });
      await prisma.$transaction([
        prisma.hrLoan.update({ where: { id }, data: { status: "cancelled", decided_by: actor, decided_at: new Date(), decision_note: note || "Cancelled" } }),
        prisma.hrLoanEvent.create({ data: { loan_id: id, action: "cancelled", detail: note, created_by: actor } }),
        ...(loan.approval_request_id
          ? [prisma.approvalRequest.updateMany({ where: { id: loan.approval_request_id, status: REQUEST_STATUS.PENDING }, data: { status: REQUEST_STATUS.CANCELLED, decided_by: actor, decided_at: new Date(), remarks: "Cancelled" } })]
          : []),
      ]);
      return NextResponse.json({ success: true, message: `#A-${id} cancelled.` });
    }
    case "repay": {
      financeOnly();
      const r = await recordCash(await fullLoan(), { amount: b.amount, date: b.date, reference: b.reference, cashAcno: b.cash_acno, session });
      return NextResponse.json({
        success: true,
        message: `Receipt voucher #${r.tran_id} posted — ${r.settled ? `${employeeName(loan.employee)}'s #A-${id} is settled.` : `${r.left.toLocaleString()} left.`}`,
      });
    }
    case "reverse_repayment": {
      financeOnly();
      const v = await reverseRepayment(await fullLoan(), Number(b.recovery_id), { date: b.date, reason: note, session });
      return NextResponse.json({ success: true, message: `Repayment reversed — journal voucher #${v.tran_id}.` });
    }
    case "skip": {
      managerOnly();
      const on = await skipMonth(loan, { month: b.month, reason: note, actor });
      return NextResponse.json({ success: true, message: on ? `${b.month} will not be recovered — it moves to the end.` : `${b.month} will be recovered again.` });
    }
    case "reschedule": {
      managerOnly();
      await reschedule(loan, { installment: b.installment, start_month: b.start_month, reason: note, actor });
      return NextResponse.json({ success: true, message: "Instalments rescheduled." });
    }
    case "disburse": {
      financeOnly();
      {
        const payer = (await payersOf([loan.approval_request_id])).get(loan.approval_request_id);
        if (!mayPayOut(session, payer)) {
          return NextResponse.json({ error: `This was sent to ${payer.names.join(" / ")} for payment — only they can pay it out.` }, { status: 403 });
        }
      }
      const v = await disburse(await fullLoan(), { date: b.date, cashAcno: b.cash_acno, reference: b.reference, session });
      // Its approval chain's "pay" step is done (lib/hr/approvals.js).
      await completePayStep(loan.approval_request_id, session, `payment voucher #${v.tran_id}`);
      return NextResponse.json({ success: true, message: `Paid out — payment voucher #${v.tran_id}.${isRefundable(loan.kind) ? " Payroll recovers it from now on." : ""}` });
    }
    case "reverse_payout": {
      financeOnly();
      const v = await reversePayout(await fullLoan(), { date: b.date, reason: note, session });
      return NextResponse.json({ success: true, message: `Pay-out reversed — journal voucher #${v.tran_id}.` });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
});
