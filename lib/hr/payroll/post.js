// lib/hr/payroll/post.js — an approved payroll into the books, and back out.
//
// The journal voucher (tran_code 3), from the payslips:
//   Dr  salary expense        basic + allowances (a component's own account, else
//                             Account Settings → Payroll), per cost centre
//   Dr  overtime expense      overtime (falls back to salary expense)
//   Dr  EOBI expense          employer share
//   Cr  EOBI payable          employee + employer shares
//   Cr  income tax payable    tax withheld
//   Cr  staff advances/loans  each employee's own account, else the default
//   Cr  other deductions      deduction components / one-off deductions
//   Dr  PF expense            employer provident fund share   (feature hr.providentFund)
//   Cr  PF payable            employee + employer shares
//   Dr  gratuity expense      monthly gratuity provision      (feature hr.gratuity, monthly)
//   Cr  gratuity payable      (sides swap when the provision is negative)
//   Cr  salaries payable      net pay
// Posting, the loan recoveries, settling paid-off loans and locking the month's
// attendance happen in ONE transaction: all of it or none. A posted payroll is
// never deleted — reversing posts the mirror journal and undoes the rest.
// Paying the net salaries afterwards: lib/hr/payroll/pay.js.
import prisma from "@/lib/prisma";
import { payrollAccountFor } from "@/lib/accounts/accountSettings";
import { ACCOUNT_SETTING_BY_KEY } from "@/lib/accounts/accountSettingDefs";
import { checkPeriodLock } from "@/lib/periodLock";
import { lockAttendance, unlockAttendance } from "@/lib/hr/attendance/save";
import { employeeName } from "@/lib/hr/access";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { PayrollError, RUN_STATUS } from "@/lib/hr/payroll/run";
import { monthRange, todayKey } from "@/lib/hr/time";
import { LOAN_KINDS, loanAccountKey } from "@/lib/hr/loans/schedule";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const KEYS = [
  "payroll_salary_expense", "payroll_overtime_expense", "payroll_salary_payable", "payroll_eobi_expense", "payroll_eobi_payable", "payroll_tax_payable",
  "payroll_staff_advances", "payroll_staff_loans", "payroll_other_deductions",
  "payroll_pf_payable", "payroll_pf_expense", "payroll_gratuity_expense", "payroll_gratuity_payable",
];

export const monthLabel = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * The journal lines of a run.
 * @returns {{ lines: [{ acno, ccno, damt, camt, narration1 }], missing: string[], debit, credit }}
 */
export async function journalFor(run, payslips) {
  // Every account for each salary category on the run (Direct / Indirect
  // accounts fall back to the default — payrollAccountFor).
  const cats = [...new Set(payslips.map((p) => p.data?.salary_category ?? null))];
  const acc = Object.fromEntries(
    await Promise.all(cats.flatMap((c) => KEYS.map(async (k) => [`${k}|${c ?? ""}`, await payrollAccountFor(k, c)]))),
  );
  const missing = new Set();
  const accOf = (key, cat) => acc[`${key}|${cat ?? ""}`] ?? null;
  const needIn = (cat) => (key) => {
    const a = accOf(key, cat);
    if (a == null) missing.add(ACCOUNT_SETTING_BY_KEY[key]?.label ?? key);
    return a;
  };
  const label = monthLabel(run.month);
  const lines = new Map(); // `${side}|${acno}|${ccno}|${narration}` → line
  const add = (side, acno, amount, narration, ccno = null) => {
    const a = r2(amount);
    if (!a) return;
    const k = `${side}|${acno}|${ccno ?? ""}|${narration}`;
    const l = lines.get(k) ?? { acno, ccno, damt: 0, camt: 0, narration1: narration.slice(0, 250) };
    if (side === "Dr") l.damt = r2(l.damt + a);
    else l.camt = r2(l.camt + a);
    lines.set(k, l);
  };

  for (const p of payslips) {
    const d = p.data;
    if (p.net < 0) throw new PayrollError(`${employeeName(p.employee)}: net pay is negative (${fmtMoney(p.net)}) — fix the payslip first.`, 409);
    const cc = d.cost_center ?? null;
    const cat = d.salary_category ?? null;
    const need = needIn(cat);
    const salaryAc = need("payroll_salary_expense");
    add("Dr", salaryAc, d.basic, `Salaries ${label} — basic`, cc);
    for (const e of d.earnings) add("Dr", e.acno ?? salaryAc, e.amount, `Salaries ${label} — ${e.name}`, cc);
    for (const x of d.adjustments.filter((x) => x.kind === "EARNING")) add("Dr", x.acno ?? salaryAc, x.amount, `Salaries ${label} — ${x.label}`, cc);
    if (d.overtime.amount) add("Dr", accOf("payroll_overtime_expense", cat) ?? salaryAc, d.overtime.amount, `Overtime ${label}`, cc);
    if (d.eobi.employer) add("Dr", need("payroll_eobi_expense"), d.eobi.employer, `EOBI employer share ${label}`, cc);
    if (d.eobi.employee + d.eobi.employer) add("Cr", need("payroll_eobi_payable"), d.eobi.employee + d.eobi.employer, `EOBI ${label}`);
    if (d.tax.month) add("Cr", need("payroll_tax_payable"), d.tax.month, `Income tax on salaries ${label}`);
    // Saved with the payslip, so a payroll calculated while a feature was on posts what it shows.
    const pfE = Number(d.pf?.employee) || 0;
    const pfR = Number(d.pf?.employer) || 0;
    if (pfR) add("Dr", need("payroll_pf_expense"), pfR, `Provident fund employer share ${label}`, cc);
    if (pfE + pfR) add("Cr", need("payroll_pf_payable"), pfE + pfR, `Provident fund ${label}`);
    const grat = Number(d.gratuity?.provision) || 0;
    if (grat > 0) {
      add("Dr", need("payroll_gratuity_expense"), grat, `Gratuity provision ${label}`, cc);
      add("Cr", need("payroll_gratuity_payable"), grat, `Gratuity provision ${label}`);
    } else if (grat < 0) {
      add("Dr", need("payroll_gratuity_payable"), -grat, `Gratuity provision written back ${label}`);
      add("Cr", need("payroll_gratuity_expense"), -grat, `Gratuity provision written back ${label}`, cc);
    }
    for (const x of d.deductions) add("Cr", x.acno ?? need("payroll_other_deductions"), x.amount, `Salary deductions ${label} — ${x.name}`);
    for (const x of d.adjustments.filter((x) => x.kind === "DEDUCTION")) add("Cr", x.acno ?? need("payroll_other_deductions"), x.amount, `Salary deductions ${label} — ${x.label}`);
    for (const l of d.loans) {
      if (!l.amount) continue;
      // PF loan recoveries go back to Provident Fund Payable (LOAN_KINDS.account).
      // l.acno = the account it was paid out to; none = paid out before that
      // was kept, to the default account (never the category's).
      const acno = l.acno ?? needIn(null)(loanAccountKey(l.kind));
      add("Cr", acno, l.amount, `${LOAN_KINDS[l.kind]?.short ?? "Loan"} recovery #A-${l.loan_id} — ${employeeName(p.employee)} (${p.employee_id}) ${label}`);
    }
    add("Cr", need("payroll_salary_payable"), p.net, `Net salaries payable ${label}`);
  }

  // Accounts named on components / employees must exist.
  const list = [...lines.values()];
  const acnos = [...new Set(list.map((l) => l.acno).filter((a) => a != null))];
  const found = new Set((await prisma.aCNO.findMany({ where: { acno: { in: acnos } }, select: { acno: true } })).map((a) => a.acno));
  for (const a of acnos) if (!found.has(a)) missing.add(`account ${a} (used on a pay component or employee) does not exist`);

  const debit = r2(list.reduce((s, l) => s + l.damt, 0));
  const credit = r2(list.reduce((s, l) => s + l.camt, 0));
  return { lines: list.filter((l) => l.acno != null), missing: [...missing], debit, credit };
}

const loadRun = (id) =>
  prisma.hrPayrollRun.findUnique({
    where: { id },
    include: { payslips: { include: { employee: { select: { id: true, firstName: true, middleName: true, surname: true } } } } },
  });

/** Post an APPROVED run. Returns the journal's { tran_id, vr_no }. */
export async function postRun(runId, { actor }) {
  const run = await loadRun(runId);
  if (!run) throw new PayrollError("Payroll not found.", 404);
  if (run.status !== RUN_STATUS.APPROVED) throw new PayrollError(`Only an approved payroll can be posted — this one is ${run.status.toLowerCase()}.`, 409);
  const range = monthRange(run.month);
  if (range.to >= todayKey()) throw new PayrollError(`${monthLabel(run.month)} is not over yet — it can be posted from ${range.to} onward, once its attendance is final.`, 409);
  if (!run.payslips.length) throw new PayrollError("There is nobody in this payroll.", 409);
  const lockError = await checkPeriodLock(run.pay_date, 3, { action: "create" });
  if (lockError) throw new PayrollError(lockError, 422);

  const jv = await journalFor(run, run.payslips);
  if (jv.missing.length) {
    throw new PayrollError(`Set these first in Finance → Account Settings → Payroll: ${jv.missing.join("; ")}.`, 422);
  }
  if (Math.abs(jv.debit - jv.credit) > 0.01) throw new PayrollError(`The journal does not balance (Dr ${fmtMoney(jv.debit)} / Cr ${fmtMoney(jv.credit)}) — recalculate the payroll.`, 409);

  const employeeIds = run.payslips.map((p) => p.employee_id);
  const recoveries = run.payslips.flatMap((p) => p.data.loans.filter((l) => l.amount > 0).map((l) => ({ ...l, employee: p.employee })));

  return prisma.$transaction(
    async (tx) => {
      // One journal number at a time.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4003)`;
      const claimed = await tx.hrPayrollRun.updateMany({ where: { id: runId, status: RUN_STATUS.APPROVED }, data: { status: RUN_STATUS.POSTED } });
      if (claimed.count !== 1) throw new PayrollError("This payroll was posted a moment ago — refresh.", 409);
      const last = await tx.transactionsMaster.findFirst({ where: { tran_code: 3, vr_no: { not: null } }, orderBy: { vr_no: "desc" }, select: { vr_no: true } });
      const vr_no = (last?.vr_no ?? 0) + 1;
      const master = await tx.transactionsMaster.create({
        data: {
          tran_code: 3,
          vr_no,
          dated: run.pay_date,
          time: run.pay_date,
          check_date: run.pay_date,
          rmk1: `Payroll ${monthLabel(run.month)} (#P-${run.id}) — ${run.payslips.length} employee(s)`,
          rmk4: "PAYROLL",
          rmk5: String(run.id),
          user_id: actor,
        },
      });
      await tx.transactions.createMany({ data: jv.lines.map((l) => ({ ...l, tran_id: master.tran_id, sub_tran_id: 1 })) });

      for (const r of recoveries) {
        await tx.hrLoanRecovery.create({
          data: { loan_id: r.loan_id, date: run.pay_date, month: run.month, amount: r.amount, source: "PAYROLL", reference: `JV #${master.tran_id}`, payroll_id: run.id, created_by: actor },
        });
        await tx.hrLoanEvent.create({ data: { loan_id: r.loan_id, action: "recovered", detail: `${fmtMoney(r.amount)} by payroll ${run.month} (JV #${master.tran_id})`, created_by: actor } });
      }
      // Loans paid off by this payroll are settled.
      const loanIds = [...new Set(recoveries.map((r) => r.loan_id))];
      if (loanIds.length) {
        const loans = await tx.hrLoan.findMany({ where: { id: { in: loanIds } }, include: { recoveries: { select: { amount: true } } } });
        for (const l of loans) {
          const paid = l.recoveries.reduce((s, x) => s + x.amount, 0);
          if (l.status === "active" && l.amount - paid <= 0.004) {
            await tx.hrLoan.update({ where: { id: l.id }, data: { status: "settled" } });
            await tx.hrLoanEvent.create({ data: { loan_id: l.id, action: "settled", detail: `paid off by payroll ${run.month}`, created_by: actor } });
          }
        }
      }

      await lockAttendance({ employeeIds, from: range.from, to: range.to, actor, tx });
      await tx.hrPayrollRun.update({ where: { id: runId }, data: { jv_tran_id: master.tran_id, jv_vr_no: vr_no, posted_by: actor, posted_at: new Date() } });
      return { tran_id: master.tran_id, vr_no };
    },
    { timeout: 120000, maxWait: 20000 },
  );
}

/** Reverse a POSTED run: mirror journal, loan recoveries removed, attendance unlocked. */
export async function reverseRun(runId, { actor, reason }) {
  if (!reason) throw new PayrollError("Say why the payroll is reversed.");
  const run = await prisma.hrPayrollRun.findUnique({ where: { id: runId }, include: { payslips: { select: { employee_id: true } } } });
  if (!run) throw new PayrollError("Payroll not found.", 404);
  if (run.status !== RUN_STATUS.POSTED) throw new PayrollError("Only a posted payroll can be reversed.", 409);
  const later = await prisma.hrPayrollRun.findFirst({
    where: { status: RUN_STATUS.POSTED, month: { gt: run.month }, payslips: { some: { employee_id: { in: run.payslips.map((p) => p.employee_id) } } } },
    select: { id: true, month: true },
  });
  if (later) throw new PayrollError(`A later payroll (#P-${later.id}, ${later.month}) is posted for some of these employees — reverse that first (its income tax builds on this one).`, 409);
  const paid = await prisma.hrPayrollPayment.count({ where: { run_id: runId, reversal_tran_id: null } });
  if (paid) throw new PayrollError(`${paid} salary payment(s) of this payroll are still in the books — reverse them first (Payments, on this payroll).`, 409);
  const lockError = await checkPeriodLock(run.pay_date, 3, { action: "create" });
  if (lockError) throw new PayrollError(lockError, 422);
  const original = run.jv_tran_id ? await prisma.transactions.findMany({ where: { tran_id: run.jv_tran_id } }) : [];
  const range = monthRange(run.month);

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4003)`;
      const claimed = await tx.hrPayrollRun.updateMany({ where: { id: runId, status: RUN_STATUS.POSTED }, data: { status: RUN_STATUS.REVERSED } });
      if (claimed.count !== 1) throw new PayrollError("This payroll changed a moment ago — refresh.", 409);
      let reversal = null;
      if (original.length) {
        const last = await tx.transactionsMaster.findFirst({ where: { tran_code: 3, vr_no: { not: null } }, orderBy: { vr_no: "desc" }, select: { vr_no: true } });
        reversal = await tx.transactionsMaster.create({
          data: {
            tran_code: 3,
            vr_no: (last?.vr_no ?? 0) + 1,
            dated: run.pay_date,
            time: run.pay_date,
            check_date: run.pay_date,
            rmk1: `Reversal of payroll ${monthLabel(run.month)} (#P-${run.id}, JV #${run.jv_tran_id}) — ${reason}`.slice(0, 500),
            rmk4: "PAYROLL_REVERSAL",
            rmk5: String(run.id),
            user_id: actor,
          },
        });
        await tx.transactions.createMany({
          data: original.map((l) => ({ tran_id: reversal.tran_id, sub_tran_id: 1, acno: l.acno, ccno: l.ccno, damt: l.camt ?? 0, camt: l.damt ?? 0, narration1: `Reversal — ${l.narration1 ?? ""}`.slice(0, 250) })),
        });
      }
      const recs = await tx.hrLoanRecovery.findMany({ where: { payroll_id: run.id } });
      await tx.hrLoanRecovery.deleteMany({ where: { payroll_id: run.id } });
      for (const loanId of [...new Set(recs.map((r) => r.loan_id))]) {
        await tx.hrLoan.updateMany({ where: { id: loanId, status: "settled" }, data: { status: "active" } });
        await tx.hrLoanEvent.create({ data: { loan_id: loanId, action: "recovery reversed", detail: `payroll ${run.month} reversed — ${reason}`, created_by: actor } });
      }
      await unlockAttendance({ employeeIds: run.payslips.map((p) => p.employee_id), from: range.from, to: range.to, tx });
      await tx.hrPayrollRun.update({
        where: { id: runId },
        data: { reversal_tran_id: reversal?.tran_id ?? null, reversed_by: actor, reversed_at: new Date(), reverse_reason: reason },
      });
      return { tran_id: reversal?.tran_id ?? null };
    },
    { timeout: 120000, maxWait: 20000 },
  );
}

