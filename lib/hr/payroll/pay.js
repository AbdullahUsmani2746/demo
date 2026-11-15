// lib/hr/payroll/pay.js — paying the net salaries of a POSTED payroll.
//
// The payroll journal credits "salaries payable" with every net pay; paying
// clears it: a Payment voucher (2), Dr salaries payable per employee, Cr the
// cash / bank account. A run is usually paid in parts — plant workers in cash,
// office staff by bank transfer — so each payment names its employees and an
// employee is paid once (until that payment is reversed). Held payslips are
// left out unless picked by name.
//
// A payment is undone by a reversal journal (lib/hr/vouchers.js); a payroll
// with a live payment cannot be reversed until the payment is.
import prisma from "@/lib/prisma";
import { employeeName } from "@/lib/hr/access";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { PayrollError, RUN_STATUS } from "@/lib/hr/payroll/run";
import { monthLabel } from "@/lib/hr/payroll/post";
import { assertCashBank, checkVoucherDate, payrollAccount, postCashVoucher, postReversal, TRAN, voucherLabel } from "@/lib/hr/vouchers";
import { dayKeyOfDb } from "@/lib/hr/time";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Who in the run is paid (and by which payment), and what is still to pay. */
export async function paymentState(runId, db = prisma) {
  const [payslips, payments] = await Promise.all([
    db.hrPayslip.findMany({
      where: { run_id: runId },
      select: { employee_id: true, net: true, hold: true, data: true, employee: { select: { id: true, firstName: true, middleName: true, surname: true } } },
    }),
    db.hrPayrollPayment.findMany({ where: { run_id: runId }, orderBy: { id: "asc" } }),
  ]);
  const paidBy = new Map();
  for (const p of payments) if (!p.reversal_tran_id) for (const id of p.employees) paidBy.set(id, p.id);
  const rows = payslips.map((p) => ({
    employee_id: p.employee_id,
    name: employeeName(p.employee),
    net: r2(p.net),
    hold: p.hold,
    method: p.data?.bank?.method ?? null,
    paid_by: paidBy.get(p.employee_id) ?? null,
  }));
  const total = r2(rows.reduce((s, r) => s + r.net, 0));
  const paid = r2(rows.filter((r) => r.paid_by).reduce((s, r) => s + r.net, 0));
  return { rows, payments, total, paid, unpaid: r2(total - paid) };
}

/**
 * Pay `employeeIds` (or everyone unpaid and not held when empty) from
 * `cashAcno`. Returns { tran_id, amount, count }.
 */
export async function payRun(runId, { date, cashAcno, employeeIds = [], reference, session }) {
  const actor = session.user.id;
  const run = await prisma.hrPayrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new PayrollError("Payroll not found.", 404);
  if (run.status !== RUN_STATUS.POSTED) throw new PayrollError("Only a posted payroll is paid — post it first.", 409);
  await checkVoucherDate(date, TRAN.PAYMENT);
  if (date < dayKeyOfDb(run.pay_date)) throw new PayrollError(`Pay on or after the payroll date (${dayKeyOfDb(run.pay_date)}).`);
  const cash = await assertCashBank(session, cashAcno);
  const payable = await payrollAccount("payroll_salary_payable");
  const ref = reference ? String(reference).trim().slice(0, 60) || null : null;
  const wanted = new Set(employeeIds.map(Number).filter(Number.isInteger));
  const label = monthLabel(run.month);

  return prisma.$transaction(
    async (tx) => {
      // One payment of a run at a time: two clicks must not pay someone twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4005, ${runId})`;
      const state = await paymentState(runId, tx);
      const pick = state.rows.filter((r) => (wanted.size ? wanted.has(r.employee_id) : !r.hold) && r.net > 0);
      if (wanted.size && pick.length !== wanted.size) throw new PayrollError("Some of the chosen people are not in this payroll or have nothing to be paid.", 400);
      const twice = pick.filter((r) => r.paid_by);
      if (twice.length) throw new PayrollError(`Already paid: ${twice.slice(0, 5).map((r) => r.name).join(", ")}${twice.length > 5 ? ` and ${twice.length - 5} more` : ""}.`, 409);
      if (!pick.length) throw new PayrollError("Nobody is left to pay.", 409);
      const amount = r2(pick.reduce((s, r) => s + r.net, 0));
      const v = await postCashVoucher(tx, {
        tranCode: TRAN.PAYMENT,
        date,
        cashAcno: cash.acno,
        lines: pick.map((r) => ({ acno: payable, amount: r.net, narration: `Salary ${label} — ${r.name} (${r.employee_id})${ref ? ` · ${ref}` : ""}` })),
        remarks: `Salaries ${label} (#P-${runId}) paid — ${pick.length} employee(s)`,
        marker: "HR_SALARY_PAY",
        ref: runId,
        actor,
      });
      await tx.hrPayrollPayment.create({
        data: { run_id: runId, date: new Date(`${date}T00:00:00.000Z`), acno: cash.acno, amount, employees: pick.map((r) => r.employee_id), reference: ref, tran_id: v.tran_id, created_by: actor },
      });
      return { tran_id: v.tran_id, amount, count: pick.length, account: cash.name };
    },
    { timeout: 60000, maxWait: 20000 },
  );
}

/** Undo one salary payment: reversal journal; those employees are unpaid again. */
export async function reversePayment(runId, paymentId, { date, reason, session }) {
  const actor = session.user.id;
  if (!reason) throw new PayrollError("Say why the payment is reversed.");
  const p = await prisma.hrPayrollPayment.findFirst({ where: { id: paymentId, run_id: runId } });
  if (!p) throw new PayrollError("Payment not found.", 404);
  if (p.reversal_tran_id) throw new PayrollError("This payment is already reversed.", 409);
  await checkVoucherDate(date, TRAN.JOURNAL);
  return prisma.$transaction(async (tx) => {
    const v = await postReversal(tx, { tranId: p.tran_id, date, reason, ref: runId, actor });
    const claimed = await tx.hrPayrollPayment.updateMany({
      where: { id: p.id, reversal_tran_id: null },
      data: { reversal_tran_id: v.tran_id, reversed_by: actor, reversed_at: new Date(), reverse_reason: reason },
    });
    if (claimed.count !== 1) throw new PayrollError("This payment changed a moment ago — refresh.", 409);
    return { tran_id: v.tran_id, label: `${voucherLabel(TRAN.PAYMENT, p.tran_id)} (${fmtMoney(p.amount)})` };
  });
}
