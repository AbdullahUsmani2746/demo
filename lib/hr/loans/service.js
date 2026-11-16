// lib/hr/loans/service.js — advances and loans on the server.
//
//   loanData()     validate an application (amount, instalment, first month)
//   policyFlags()  what an approver should know: over the advance / loan
//                  limit (HR → Rules), other loans still running, no salary
//   activate()     approved → recovered by payroll from start_month
//   disburse()     paid out → Payment voucher (Dr staff account, Cr cash / bank)
//   recordCash()   a repayment outside payroll → Receipt voucher
//   reversePayout() / reverseRepayment()  undone by a reversal journal
//   skipMonth() / reschedule()
// Every change is written to hr_loan_events (the loan's timeline). Money is
// posted through lib/hr/vouchers.js; a posted voucher is never edited.
import prisma from "@/lib/prisma";
import { employeeName, getHrSettings } from "@/lib/hr/access";
import { installmentsFor, isMonthKey, isPfKind, isRefundable, LOAN_KINDS, outstandingOf } from "@/lib/hr/loans/schedule";
import { assertPfLimit, assertPfLoansOn, pfPosition } from "@/lib/hr/loans/pf";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { salaryOn, totalsOf } from "@/lib/hr/salary/service";
import { dbDay, dayKeyOfDb, isDayKey, todayKey } from "@/lib/hr/time";
import { assertCashBank, checkVoucherDate, postCashVoucher, postReversal, staffAccount, TRAN, voucherLabel } from "@/lib/hr/vouchers";

export class LoanError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const thisMonth = () => todayKey().slice(0, 7);
const money = (v) => Math.round(Number(v) * 100) / 100;

export const logEvent = (loan_id, action, detail, actor, db = prisma) =>
  db.hrLoanEvent.create({ data: { loan_id, action, detail: detail ? String(detail).slice(0, 500) : null, created_by: actor ?? null } });

export async function loanData(b) {
  const employee_id = Number(b?.employee_id);
  const kind = Object.prototype.hasOwnProperty.call(LOAN_KINDS, b?.kind) ? b.kind : null;
  if (!kind) throw new LoanError("Choose salary advance, loan, PF loan or PF withdrawal.");
  await assertPfLoansOn(kind);
  const amount = money(b.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) throw new LoanError("Amount: enter more than 0.");
  if (kind === "PF_WDL") {
    // Paid once, never recovered: no instalments.
    await assertPfLimit(employee_id, amount);
    const reason = b.reason ? String(b.reason).trim().slice(0, 500) || null : null;
    return { employee_id, kind, amount, installment: amount, start_month: thisMonth(), reason, count: 0 };
  }
  const installment = money(b.installment || amount);
  if (!Number.isFinite(installment) || installment <= 0) throw new LoanError("Monthly instalment: enter more than 0.");
  if (installment > amount) throw new LoanError("The monthly instalment cannot be more than the amount.");
  if (!isMonthKey(b.start_month)) throw new LoanError("First recovery month is required.");
  if (b.start_month < thisMonth()) throw new LoanError("The first recovery cannot be in a past month.");
  const { loanMaxInstallments, pfLoanMaxInstallments } = await getHrSettings();
  const maxCount = kind === "PF_LOAN" ? pfLoanMaxInstallments : loanMaxInstallments;
  const count = installmentsFor(amount, installment);
  if (count > maxCount) {
    throw new LoanError(`That is ${count} instalments — at most ${maxCount} are allowed (HR → Rules). Raise the instalment.`);
  }
  if (kind === "PF_LOAN") await assertPfLimit(employee_id, amount);
  const reason = b.reason ? String(b.reason).trim().slice(0, 500) || null : null;
  return { employee_id, kind, amount, installment, start_month: b.start_month, reason, count };
}

/** Points for whoever decides it. */
export async function policyFlags({ employee_id, kind, amount, excludeLoanId = null }) {
  const [settings, salary, running] = await Promise.all([
    getHrSettings(),
    salaryOn([employee_id], todayKey()),
    prisma.hrLoan.findMany({
      where: { employee_id, status: { in: ["active", "pending"] }, ...(excludeLoanId ? { NOT: { id: excludeLoanId } } : {}) },
      include: { recoveries: { select: { amount: true } } },
    }),
  ]);
  const gross = totalsOf(salary.get(employee_id))?.gross ?? 0;
  const flags = [];
  if (isPfKind(kind)) {
    // The hard limit is checked on applying and on paying out; show where it stands.
    const p = await pfPosition(employee_id, { excludeLoanId });
    flags.push(`PF balance ${fmtMoney(p.fund)} — ${p.percent}% limit ${fmtMoney(p.limit)}, ${fmtMoney(p.available)} still available${p.owed ? ` (${fmtMoney(p.owed)} PF loan owed)` : ""}.`);
    if (amount > p.available + 0.004) flags.push(`Above the PF limit by ${fmtMoney(amount - p.available)}.`);
  }
  if (!gross && isRefundable(kind)) flags.push("No salary is set for this employee — instalments cannot be recovered by payroll until one is.");
  if (gross && kind === "ADVANCE" && settings.advanceLimitPercent > 0 && amount > (gross * settings.advanceLimitPercent) / 100) {
    flags.push(`Above the advance limit: ${fmtMoney(amount)} is more than ${settings.advanceLimitPercent}% of gross salary (${fmtMoney(gross)}).`);
  }
  if (gross && kind === "LOAN" && settings.loanLimitMonths > 0 && amount > gross * settings.loanLimitMonths) {
    flags.push(`Above the loan limit: ${fmtMoney(amount)} is more than ${settings.loanLimitMonths} month(s) of gross salary (${fmtMoney(gross * settings.loanLimitMonths)}).`);
  }
  for (const l of running) {
    flags.push(`${LOAN_KINDS[l.kind].label} #A-${l.id} is ${l.status}${l.status === "active" ? ` — ${fmtMoney(outstandingOf(l, l.recoveries))} still owed` : ""}.`);
  }
  return { flags, gross };
}

/** Approved → active. */
export async function activate(loanId, { actor, note = null }) {
  const loan = await prisma.hrLoan.findUnique({ where: { id: loanId } });
  if (!loan) throw new LoanError("Not found.", 404);
  if (loan.status !== "pending") throw new LoanError(`#A-${loan.id} is already ${loan.status}.`, 409);
  // The first month may have passed while it waited for approval.
  const start = loan.start_month < thisMonth() ? thisMonth() : loan.start_month;
  await prisma.$transaction([
    prisma.hrLoan.update({ where: { id: loanId }, data: { status: "active", start_month: start, decided_by: actor, decided_at: new Date(), decision_note: note } }),
    prisma.hrLoanEvent.create({
      data: { loan_id: loanId, action: "approved", detail: `${note ? `${note} · ` : ""}recovery from ${start}${start !== loan.start_month ? ` (was ${loan.start_month})` : ""}`, created_by: actor },
    }),
  ]);
  return { ...loan, start_month: start };
}

/**
 * A repayment outside payroll (cash or bank), as a Receipt voucher into
 * `cashAcno`. Settles the loan when nothing is left.
 */
export async function recordCash(loan, { amount, date, reference, cashAcno, session }) {
  const actor = session.user.id;
  if (loan.status !== "active") throw new LoanError("Only an active loan can be repaid.", 409);
  if (!isRefundable(loan.kind)) throw new LoanError(`A ${LOAN_KINDS[loan.kind].label.toLowerCase()} is not paid back.`, 409);
  if (!loan.disbursed_on) throw new LoanError("It has not been paid out yet — nothing to repay.", 409);
  const a = money(amount);
  if (!Number.isFinite(a) || a <= 0) throw new LoanError("Amount: enter more than 0.");
  await checkVoucherDate(date, TRAN.RECEIPT);
  const cash = await assertCashBank(session, cashAcno);
  const employee = await prisma.employee.findUnique({ where: { id: loan.employee_id }, select: { id: true, firstName: true, middleName: true, surname: true, advanceAcno: true, loanAcno: true } });
  const acno = await staffAccount(loan, employee);
  const ref = reference ? String(reference).trim().slice(0, 60) || null : null;

  return prisma.$transaction(async (tx) => {
    // One repayment of a loan at a time (two clicks must not both pass "owed").
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4004, ${loan.id}::int)`;
    const recs = await tx.hrLoanRecovery.findMany({ where: { loan_id: loan.id }, select: { amount: true } });
    const owed = outstandingOf(loan, recs);
    if (a > owed + 0.004) throw new LoanError(`Only ${fmtMoney(owed)} is still owed.`);
    const settled = owed - a <= 0.004;
    const v = await postCashVoucher(tx, {
      tranCode: TRAN.RECEIPT,
      date,
      cashAcno: cash.acno,
      lines: [{ acno, amount: a, narration: `${LOAN_KINDS[loan.kind].label} #A-${loan.id} repaid — ${employeeName(employee)} (${loan.employee_id})${ref ? ` · ${ref}` : ""}` }],
      remarks: `${LOAN_KINDS[loan.kind].label} #A-${loan.id} repayment — ${employeeName(employee)}`,
      marker: "HR_LOAN_REPAY",
      ref: loan.id,
      actor,
    });
    await tx.hrLoanRecovery.create({
      data: { loan_id: loan.id, date: dbDay(date), amount: a, source: "CASH", reference: ref, tran_id: v.tran_id, cash_acno: cash.acno, created_by: actor },
    });
    if (settled) await tx.hrLoan.update({ where: { id: loan.id }, data: { status: "settled" } });
    await tx.hrLoanEvent.create({
      data: {
        loan_id: loan.id,
        action: "repaid",
        detail: `${fmtMoney(a)} into ${cash.name} on ${date} — ${voucherLabel(TRAN.RECEIPT, v.tran_id)}${ref ? ` (${ref})` : ""}${settled ? " — settled" : ` — ${fmtMoney(owed - a)} left`}`.slice(0, 500),
        created_by: actor,
      },
    });
    return { settled, left: money(owed - a), tran_id: v.tran_id };
  });
}

/** Undo a cash / bank repayment: reversal journal, the repayment is taken off. */
export async function reverseRepayment(loan, recoveryId, { date, reason, session }) {
  const actor = session.user.id;
  if (!reason) throw new LoanError("Say why the repayment is reversed.");
  const rec = await prisma.hrLoanRecovery.findFirst({ where: { id: recoveryId, loan_id: loan.id } });
  if (!rec) throw new LoanError("Repayment not found.", 404);
  if (rec.source !== "CASH") throw new LoanError("A payroll recovery is undone by reversing that payroll.", 409);
  if (!rec.tran_id) throw new LoanError("This repayment has no voucher (recorded before vouchers were posted) — correct it with a journal voucher in Finance.", 409);
  await checkVoucherDate(date, TRAN.JOURNAL);
  return prisma.$transaction(async (tx) => {
    const gone = await tx.hrLoanRecovery.deleteMany({ where: { id: rec.id } });
    if (gone.count !== 1) throw new LoanError("This repayment changed a moment ago — refresh.", 409);
    const v = await postReversal(tx, { tranId: rec.tran_id, date, reason, ref: loan.id, actor });
    await tx.hrLoan.updateMany({ where: { id: loan.id, status: "settled" }, data: { status: "active" } });
    await tx.hrLoanEvent.create({
      data: { loan_id: loan.id, action: "repayment reversed", detail: `${fmtMoney(rec.amount)} of ${dayKeyOfDb(rec.date)} — ${voucherLabel(TRAN.JOURNAL, v.tran_id)} — ${reason}`.slice(0, 500), created_by: actor },
    });
    return v;
  });
}

/** Do not recover in a month (it moves to the end). */
export async function skipMonth(loan, { month, reason, actor }) {
  if (loan.status !== "active") throw new LoanError("Only an active loan's instalments can be skipped.", 409);
  if (!isRefundable(loan.kind)) throw new LoanError(`A ${LOAN_KINDS[loan.kind].label.toLowerCase()} has no instalments.`, 409);
  if (!isMonthKey(month) || month < thisMonth()) throw new LoanError("Pick this month or a later one.");
  if (month < loan.start_month) throw new LoanError(`Recovery only starts in ${loan.start_month}.`);
  const paid = await prisma.hrLoanRecovery.count({ where: { loan_id: loan.id, source: "PAYROLL", month } });
  if (paid) throw new LoanError(`Payroll has already recovered ${month}.`, 409);
  const on = !(loan.skip_months || []).includes(month);
  const skip_months = on ? [...(loan.skip_months || []), month].sort() : loan.skip_months.filter((m) => m !== month);
  await prisma.$transaction([
    prisma.hrLoan.update({ where: { id: loan.id }, data: { skip_months } }),
    prisma.hrLoanEvent.create({ data: { loan_id: loan.id, action: on ? "skipped" : "unskipped", detail: `${month}${reason ? ` — ${reason}` : ""}`, created_by: actor } }),
  ]);
  return on;
}

/** New monthly instalment (and optionally a later restart month). */
export async function reschedule(loan, { installment, start_month, reason, actor }) {
  if (loan.status !== "active" && loan.status !== "pending") throw new LoanError(`#A-${loan.id} is ${loan.status}.`, 409);
  if (!isRefundable(loan.kind)) throw new LoanError(`A ${LOAN_KINDS[loan.kind].label.toLowerCase()} has no instalments.`, 409);
  const inst = money(installment);
  if (!Number.isFinite(inst) || inst <= 0) throw new LoanError("Monthly instalment: enter more than 0.");
  const recs = await prisma.hrLoanRecovery.findMany({ where: { loan_id: loan.id }, select: { amount: true } });
  const owed = outstandingOf(loan, recs);
  const { loanMaxInstallments, pfLoanMaxInstallments } = await getHrSettings();
  const maxCount = loan.kind === "PF_LOAN" ? pfLoanMaxInstallments : loanMaxInstallments;
  if (installmentsFor(owed, inst) > maxCount) throw new LoanError(`That needs more than ${maxCount} instalments — raise it.`);
  let start = loan.start_month;
  if (start_month && start_month !== loan.start_month) {
    if (!isMonthKey(start_month) || start_month < thisMonth()) throw new LoanError("Restart month: this month or later.");
    start = start_month;
  }
  if (!reason) throw new LoanError("Say why it is rescheduled.");
  await prisma.$transaction([
    prisma.hrLoan.update({ where: { id: loan.id }, data: { installment: inst, start_month: start } }),
    prisma.hrLoanEvent.create({
      data: {
        loan_id: loan.id,
        action: "rescheduled",
        detail: `instalment ${fmtMoney(loan.installment)} → ${fmtMoney(inst)}${start !== loan.start_month ? `, from ${start}` : ""} — ${reason}`,
        created_by: actor,
      },
    }),
  ]);
}

/**
 * Pay an approved advance / loan out of `cashAcno`: a Payment voucher, Dr the
 * employee's staff account. Payroll recovers it only once it is paid out.
 */
export async function disburse(loan, { date, cashAcno, reference, session }) {
  const actor = session.user.id;
  if (loan.status !== "active") throw new LoanError("Only an approved advance / loan is paid out.", 409);
  if (loan.disbursed_on) throw new LoanError(`#A-${loan.id} was already paid out on ${dayKeyOfDb(loan.disbursed_on)}.`, 409);
  await assertPfLoansOn(loan.kind);
  // The fund may have changed since it was approved (another withdrawal, a reversed payroll).
  if (isPfKind(loan.kind)) await assertPfLimit(loan.employee_id, loan.amount, { excludeLoanId: loan.id });
  await checkVoucherDate(date, TRAN.PAYMENT);
  const cash = await assertCashBank(session, cashAcno);
  const employee = await prisma.employee.findUnique({ where: { id: loan.employee_id }, select: { id: true, firstName: true, middleName: true, surname: true, advanceAcno: true, loanAcno: true } });
  const acno = await staffAccount(loan, employee);
  const ref = reference ? String(reference).trim().slice(0, 60) || null : null;
  const label = LOAN_KINDS[loan.kind].label;

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.hrLoan.updateMany({ where: { id: loan.id, status: "active", disbursed_on: null }, data: { disbursed_on: dbDay(date) } });
    if (claimed.count !== 1) throw new LoanError("It was paid out a moment ago — refresh.", 409);
    const v = await postCashVoucher(tx, {
      tranCode: TRAN.PAYMENT,
      date,
      cashAcno: cash.acno,
      lines: [{ acno, amount: loan.amount, narration: `${label} #A-${loan.id} paid — ${employeeName(employee)} (${loan.employee_id})${ref ? ` · ${ref}` : ""}` }],
      remarks: `${label} #A-${loan.id} paid to ${employeeName(employee)}`,
      marker: "HR_LOAN_PAYOUT",
      ref: loan.id,
      actor,
    });
    // A PF withdrawal is never paid back: settled once paid out.
    const settledNow = !isRefundable(loan.kind);
    await tx.hrLoan.update({ where: { id: loan.id }, data: { disburse_tran_id: v.tran_id, disburse_acno: cash.acno, disbursement_ref: ref, ...(settledNow ? { status: "settled" } : {}) } });
    await tx.hrLoanEvent.create({
      data: { loan_id: loan.id, action: "disbursed", detail: `${fmtMoney(loan.amount)} paid from ${cash.name} on ${date} — ${voucherLabel(TRAN.PAYMENT, v.tran_id)}${ref ? ` (${ref})` : ""}`.slice(0, 500), created_by: actor },
    });
    return v;
  });
}

/** Undo a pay-out (nothing recovered yet): reversal journal, back to "not paid out". */
export async function reversePayout(loan, { date, reason, session }) {
  const actor = session.user.id;
  if (!reason) throw new LoanError("Say why the pay-out is reversed.");
  if (!loan.disbursed_on) throw new LoanError("It has not been paid out.", 409);
  if (!loan.disburse_tran_id) throw new LoanError("This pay-out has no voucher (recorded before vouchers were posted) — correct it with a journal voucher in Finance.", 409);
  await checkVoucherDate(date, TRAN.JOURNAL);
  return prisma.$transaction(async (tx) => {
    if (await tx.hrLoanRecovery.count({ where: { loan_id: loan.id } })) {
      throw new LoanError("Something has already been recovered — reverse those first (a payroll is reversed on its own screen).", 409);
    }
    const claimed = await tx.hrLoan.updateMany({
      where: { id: loan.id, disburse_tran_id: loan.disburse_tran_id },
      // A PF withdrawal (settled when paid out) goes back to approved, not paid.
      data: { disbursed_on: null, disburse_tran_id: null, disburse_acno: null, disbursement_ref: null, ...(isRefundable(loan.kind) ? {} : { status: "active" }) },
    });
    if (claimed.count !== 1) throw new LoanError("It changed a moment ago — refresh.", 409);
    const v = await postReversal(tx, { tranId: loan.disburse_tran_id, date, reason, ref: loan.id, actor });
    await tx.hrLoanEvent.create({
      data: { loan_id: loan.id, action: "pay-out reversed", detail: `${voucherLabel(TRAN.PAYMENT, loan.disburse_tran_id)} reversed by ${voucherLabel(TRAN.JOURNAL, v.tran_id)} — ${reason}`.slice(0, 500), created_by: actor },
    });
    return v;
  });
}
