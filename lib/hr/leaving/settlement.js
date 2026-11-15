// lib/hr/leaving/settlement.js — full & final settlement of a leaving
// (feature hr.leavingProcess). Every figure comes from the rules (HR → Payroll
// → Rules), the books (posted payroll) and the employee's records:
//
//   last salary        gross ÷ days divisor × days, from the day after the last
//                      month in a live payroll to the last working day (payroll
//                      leaves those months out — run.js settledIn), less unpaid days
//   leave encashment   available days of encashable leave types × (basic | gross)
//                      ÷ divisor, capped (rules leaveEncash*)
//   gratuity           feature hr.gratuity: benefits.js gratuityFor at the last day
//                      — out of the provision the books hold, the rest expensed
//   provident fund     feature hr.providentFund: employee + employer shares of
//                      posted payroll; the employer share only after the vesting
//                      months, otherwise forfeited back to PF expense
//   notice             short notice: resignation → recovered, termination → paid
//                      (rules noticeRecovery / noticePayTermination), unless waived
//   loans / advances   everything still owed on loans that were paid out
//   tax, other         entered by HR (inputs.tax, inputs.adjustments)
//
// DRAFT (recalculated at will) → PENDING (Approvals, hrSettlement) → APPROVED →
// POSTED: one system journal (HR_SETTLEMENT) through lib/hr/vouchers.js, with
// the loan recoveries, in one transaction → paid: a Payment voucher
// (HR_SETTLEMENT_PAY). Undo = reversal journals; nothing is edited or deleted.
import prisma from "@/lib/prisma";
import { getAccount } from "@/lib/accounts/accountSettings";
import { ACCOUNT_SETTING_BY_KEY } from "@/lib/accounts/accountSettingDefs";
import { employeeName, getHrSettings } from "@/lib/hr/access";
import { createHrRequest } from "@/lib/hr/approvals";
import { feature } from "@/lib/features/server";
import { gratuityFor, serviceMonths } from "@/lib/hr/benefits";
import { salaryOn, totalsOf } from "@/lib/hr/salary/service";
import { balancesFor, leaveYearStart } from "@/lib/hr/leave/balance";
import { leaveYearOf } from "@/lib/hr/leave/policy";
import { addMonths, LOAN_KINDS, loanAccountKey, outstandingOf, ownLoanAcno } from "@/lib/hr/loans/schedule";
import { pfWithdrawnBy } from "@/lib/hr/loans/pf";
import { cleanAdjustments, LIVE } from "@/lib/hr/payroll/run";
import { monthLabel } from "@/lib/hr/payroll/post";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { assertCashBank, checkVoucherDate, postCashVoucher, postJournal, postReversal, TRAN } from "@/lib/hr/vouchers";
import { LeavingError, noticeShort, SEP_STATUS, SEPARATION_KINDS } from "@/lib/hr/leaving/separation";
import { dayKeyOfDb, daysBetween, dbDay, monthRange } from "@/lib/hr/time";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const SETTLEMENT_STATUS = { DRAFT: "DRAFT", PENDING: "PENDING", APPROVED: "APPROVED", POSTED: "POSTED", REVERSED: "REVERSED" };

/** Inputs from the screen → clean. */
export function cleanInputs(b = {}) {
  const unpaid = Number(b.unpaid_days ?? 0);
  if (!Number.isFinite(unpaid) || unpaid < 0 || unpaid > 62) throw new LeavingError("Unpaid days: 0 to 62.");
  const tax = Number(b.tax ?? 0);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100_000_000) throw new LeavingError("Income tax: an amount of 0 or more.");
  let adjustments = [];
  try {
    adjustments = cleanAdjustments(Array.isArray(b.adjustments) ? b.adjustments : []);
  } catch (e) {
    throw new LeavingError(e.message);
  }
  return { unpaid_days: Math.round(unpaid * 2) / 2, tax: r2(tax), adjustments, note: b.note ? String(b.note).slice(0, 500) : null };
}

/** The settlement's numbers for a separation (reads the DB, writes nothing). */
export async function computeSettlement(sep, inputs) {
  const warnings = [];
  const [settings, gratuityOn, pfOn] = await Promise.all([getHrSettings(), feature("hr.gratuity"), feature("hr.providentFund")]);
  const emp = await prisma.employee.findUnique({ where: { id: sep.employee_id }, select: { id: true, hireDate: true, costCenterId: true, advanceAcno: true, loanAcno: true } });
  const dor = dayKeyOfDb(sep.last_working_day);
  const hired = dayKeyOfDb(emp.hireDate);
  const structure = (await salaryOn([emp.id], dor)).get(emp.id);
  const t = totalsOf(structure);
  if (!t) warnings.push("No salary is set for the last working day — salary, leave and gratuity are 0.");
  const basic = t?.basic ?? 0;
  const gross = t?.gross ?? 0;
  const lines = [];
  const add = (l) => l.amount > 0 && lines.push({ ...l, amount: r2(l.amount) });

  // ── last salary ──────────────────────────────────────────────────────────
  const last = await prisma.hrPayslip.findFirst({ where: { employee_id: emp.id, run: { status: { in: LIVE } } }, orderBy: { month: "desc" }, select: { month: true } });
  let salaryFrom = last ? `${addMonths(last.month, 1)}-01` : hired.slice(0, 7) + "-01";
  if (salaryFrom < hired) salaryFrom = hired;
  const salary = { from: salaryFrom, to: dor, days: 0, segments: [], gross: r2(gross), unpaid_days: inputs.unpaid_days, amount: 0 };
  if (salaryFrom <= dor && gross > 0) {
    let m = salaryFrom.slice(0, 7);
    let lastRate = 0;
    while (m <= dor.slice(0, 7)) {
      const range = monthRange(m);
      const from = salaryFrom > range.from ? salaryFrom : range.from;
      const to = dor < range.to ? dor : range.to;
      const inMonth = daysBetween(range.from, range.to) + 1;
      const days = daysBetween(from, to) + 1;
      const divisor = settings.payrollDaysDivisor > 0 ? settings.payrollDaysDivisor : inMonth;
      lastRate = gross / divisor;
      const amount = days >= inMonth ? gross : Math.min(gross, lastRate * days);
      salary.segments.push({ month: m, label: monthLabel(m), from, to, days, amount: r2(amount) });
      salary.days += days;
      m = addMonths(m, 1);
    }
    if (salary.segments.length > 2) warnings.push(`The last salary covers ${salary.segments.length} months (${salary.segments[0].label} onward) — check no payroll is missing.`);
    salary.amount = r2(Math.max(0, salary.segments.reduce((s, x) => s + x.amount, 0) - lastRate * inputs.unpaid_days));
  } else if (salaryFrom > dor) {
    warnings.push(`The last working day's month is already in a payroll — no salary here.`);
  }
  add({ key: "salary", kind: "EARNING", label: `Salary ${salary.from} to ${salary.to}${inputs.unpaid_days ? ` less ${inputs.unpaid_days} unpaid day(s)` : ""}`, amount: salary.amount, account: "payroll_salary_expense", cc: true, taxable: true });

  // ── leave encashment ─────────────────────────────────────────────────────
  const leave = { days: 0, rate: 0, amount: 0, types: [] };
  if (settings.leaveEncash > 0) {
    const types = await prisma.hrLeaveType.findMany({ where: { encashable: true }, select: { id: true, name: true } });
    if (types.length) {
      const sm = await leaveYearStart();
      const bal = await balancesFor({ employeeIds: [emp.id], year: leaveYearOf(dor, sm), startMonth: sm, typeIds: types.map((x) => x.id) });
      for (const ty of types) {
        const b = bal.rows.get(`${emp.id}|${ty.id}`);
        const days = b && !b.unlimited ? Math.max(0, b.available) : 0;
        if (days) leave.types.push({ name: ty.name, days });
        leave.days += days;
      }
      if (settings.leaveEncashMaxDays > 0 && leave.days > settings.leaveEncashMaxDays) leave.days = settings.leaveEncashMaxDays;
      leave.rate = r2((settings.leaveEncash === 2 ? gross : basic) / (settings.leaveEncashDivisor || 30));
      leave.amount = r2(leave.rate * leave.days);
    }
  }
  add({ key: "leave", kind: "EARNING", label: `Leave encashment — ${leave.days} day(s) × ${fmtMoney(leave.rate)}`, amount: leave.amount, account: "payroll_leave_encashment_expense", fallback: "payroll_salary_expense", cc: true, taxable: true });

  // ── notice ───────────────────────────────────────────────────────────────
  const short = noticeShort(sep);
  const dayRate = gross / (settings.payrollDaysDivisor > 0 ? settings.payrollDaysDivisor : 30);
  const notice = { required: sep.notice_days, short, waived: sep.waive_notice, rate: r2(dayRate), amount: 0, kind: null };
  if (short > 0 && sep.kind === "RESIGNATION" && settings.noticeRecovery) {
    notice.kind = "recover";
    notice.amount = r2(dayRate * short);
    add({ key: "notice", kind: "DEDUCTION", label: `Short notice recovered — ${short} day(s)`, amount: notice.amount, account: "payroll_notice_recovery", fallback: "payroll_other_deductions" });
  } else if (short > 0 && sep.kind === "TERMINATION" && settings.noticePayTermination) {
    notice.kind = "pay";
    notice.amount = r2(dayRate * short);
    add({ key: "notice", kind: "EARNING", label: `Notice pay — ${short} day(s)`, amount: notice.amount, account: "payroll_salary_expense", cc: true, taxable: true });
  }

  // ── gratuity ─────────────────────────────────────────────────────────────
  let gratuity = null;
  if (gratuityOn) {
    const g = gratuityFor({ hireDate: hired, asOf: dor, basic, gross, settings });
    const prov = await prisma.hrPayslip.aggregate({ where: { employee_id: emp.id, run: { status: "POSTED" } }, _sum: { gratuity: true } });
    const provided = r2(prov._sum.gratuity || 0);
    const fromProvision = r2(Math.min(provided, g.payable));
    gratuity = { ...g, provided, from_provision: fromProvision, expense: r2(g.payable - fromProvision), write_back: r2(Math.max(0, provided - g.payable)) };
    if (!g.eligible) warnings.push(`Gratuity: ${g.months} month(s) of service, ${settings.gratuityMinServiceMonths} needed — nothing payable.`);
    add({ key: "gratuity_provision", kind: "EARNING", label: `Gratuity (${g.years} year(s)) — from the provision`, amount: gratuity.from_provision, account: "payroll_gratuity_payable" });
    add({ key: "gratuity", kind: "EARNING", label: `Gratuity (${g.years} year(s))${fromProvision ? " — beyond the provision" : ""}`, amount: gratuity.expense, account: "payroll_gratuity_expense", cc: true });
  }

  // ── provident fund ───────────────────────────────────────────────────────
  let pf = null;
  if (pfOn) {
    const agg = await prisma.hrPayslip.aggregate({ where: { employee_id: emp.id, run: { status: "POSTED" } }, _sum: { pf_employee: true, pf_employer: true } });
    const employee = r2(agg._sum.pf_employee || 0);
    const employer = r2(agg._sum.pf_employer || 0);
    const months = serviceMonths(hired, dor);
    const vested = months >= (settings.pfVestingMonths || 0);
    // PF withdrawals already paid out (feature hr.pfLoans) left the fund: they
    // come off what is paid now, then off what would be forfeited.
    const withdrawn = (await pfWithdrawnBy([emp.id])).get(emp.id) ?? 0;
    const due = r2(employee + (vested ? employer : 0));
    const paidNow = r2(Math.max(0, due - withdrawn));
    const forfeited = r2(Math.max(0, (vested ? 0 : employer) - Math.max(0, withdrawn - due)));
    pf = { employee, employer, vested, months, withdrawn, paid: paidNow, forfeited };
    if (withdrawn) warnings.push(`Provident fund: ${fmtMoney(withdrawn)} already withdrawn — taken off the fund paid now.`);
    if (!vested && employer) warnings.push(`Provident fund: ${months} month(s) of service, ${settings.pfVestingMonths} needed for the employer share — ${fmtMoney(employer)} forfeited.`);
    add({ key: "pf", kind: "EARNING", label: `Provident fund — own ${fmtMoney(employee)}${vested ? ` + employer ${fmtMoney(employer)}` : ""}`, amount: pf.paid, account: "payroll_pf_payable" });
  }

  // ── loans / advances still owed ──────────────────────────────────────────
  const loans = await prisma.hrLoan.findMany({ where: { employee_id: emp.id, status: "active", disbursed_on: { not: null } }, include: { recoveries: { select: { amount: true } } } });
  const loanRows = loans.map((l) => ({ loan_id: l.id, kind: l.kind, outstanding: outstandingOf(l, l.recoveries), acno: ownLoanAcno(l.kind, emp) })).filter((l) => l.outstanding > 0);
  for (const l of loanRows) {
    add({ key: `loan:${l.loan_id}`, kind: "DEDUCTION", label: `${LOAN_KINDS[l.kind]?.short ?? "Loan"} #A-${l.loan_id} recovered`, amount: l.outstanding, acno: l.acno, account: loanAccountKey(l.kind) });
  }
  const pendingLoans = await prisma.hrLoan.count({ where: { employee_id: emp.id, status: { in: ["pending", "active"] }, disbursed_on: null } });
  if (pendingLoans) warnings.push(`${pendingLoans} advance / loan(s) approved or waiting but not paid out — cancel them on Advances & loans.`);

  // ── entered by HR ────────────────────────────────────────────────────────
  add({ key: "tax", kind: "DEDUCTION", label: "Income tax", amount: inputs.tax, account: "payroll_tax_payable" });
  inputs.adjustments.forEach((x, i) =>
    add({ key: `adj:${i}`, kind: x.kind, label: x.label, amount: x.amount, acno: x.acno, account: x.kind === "EARNING" ? "payroll_salary_expense" : "payroll_other_deductions", cc: x.kind === "EARNING", taxable: x.kind === "EARNING" && x.taxable !== false }),
  );

  const totalEarnings = r2(lines.filter((l) => l.kind === "EARNING").reduce((s, l) => s + l.amount, 0));
  const totalDeductions = r2(lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => s + l.amount, 0));
  const net = r2(totalEarnings - totalDeductions);
  if (net < 0) warnings.push(`The employee owes ${fmtMoney(-net)} — reduce the recoveries or take the balance as a receipt before posting.`);
  return {
    kind: sep.kind,
    kind_label: SEPARATION_KINDS[sep.kind]?.label ?? sep.kind,
    dor,
    hired,
    service_months: serviceMonths(hired, dor),
    salary_basic: r2(basic),
    salary_gross: r2(gross),
    cost_center: emp.costCenterId ?? null,
    salary,
    leave,
    notice,
    gratuity,
    pf,
    loans: loanRows,
    tax: inputs.tax,
    lines,
    taxable_earnings: r2(lines.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0)),
    total_earnings: totalEarnings,
    total_deductions: totalDeductions,
    net,
    warnings,
  };
}

const loadSep = (id) => prisma.hrSeparation.findUnique({ where: { id } });

/** Make or recalculate the DRAFT settlement of a separation. */
export async function calculateSettlement(separationId, { inputs, actor }) {
  const sep = await loadSep(separationId);
  if (!sep) throw new LeavingError("Leaving request not found.", 404);
  if (![SEP_STATUS.APPROVED, SEP_STATUS.COMPLETED].includes(sep.status)) throw new LeavingError("The settlement is worked out once the leaving is approved.", 409);
  const clean = cleanInputs(inputs);
  const live = await prisma.hrSettlement.findFirst({ where: { separation_id: separationId, status: { not: SETTLEMENT_STATUS.REVERSED } } });
  if (live && live.status !== SETTLEMENT_STATUS.DRAFT) throw new LeavingError(`The settlement is ${live.status.toLowerCase()} — it changes only as a draft.`, 409);
  const data = await computeSettlement(sep, clean);
  const fields = {
    dor: sep.last_working_day,
    salary_from: data.salary.amount > 0 ? dbDay(data.salary.from) : null,
    inputs: clean,
    data,
    total_earnings: data.total_earnings,
    total_deductions: data.total_deductions,
    net: data.net,
  };
  if (live) return prisma.hrSettlement.update({ where: { id: live.id }, data: fields });
  return prisma.hrSettlement.create({ data: { separation_id: separationId, employee_id: sep.employee_id, status: SETTLEMENT_STATUS.DRAFT, created_by: actor, ...fields } });
}

/** DRAFT → PENDING, into Approvals. Recalculated first so the approver sees today's figures. */
export async function submitSettlement(id, { session }) {
  const s = await prisma.hrSettlement.findUnique({ where: { id }, include: { employee: { select: { id: true, firstName: true, middleName: true, surname: true } } } });
  if (!s) throw new LeavingError("Settlement not found.", 404);
  if (s.status !== SETTLEMENT_STATUS.DRAFT) throw new LeavingError(`Only a draft is submitted — this one is ${s.status.toLowerCase()}.`, 409);
  const fresh = await calculateSettlement(s.separation_id, { inputs: s.inputs, actor: session.user.id });
  if (fresh.net < 0) throw new LeavingError("The employee owes money on this settlement — fix it before submitting.", 409);
  const request = await createHrRequest({
    docType: "hrSettlement",
    payload: { settlement_id: id },
    summary: `Final settlement of ${employeeName(s.employee)} (${s.employee_id}) — net ${fmtMoney(fresh.net)}`,
    session,
  });
  await prisma.hrSettlement.update({ where: { id }, data: { status: SETTLEMENT_STATUS.PENDING, approval_request_id: request.id, submitted_by: session.user.id, submitted_at: new Date() } });
  return request;
}

/** Account of a settlement line: its own, else Account Settings (with fallback). */
async function journalLines(s) {
  const d = s.data;
  const cache = new Map();
  const acc = async (key) => {
    if (!cache.has(key)) cache.set(key, await getAccount(key));
    return cache.get(key);
  };
  const missing = new Set();
  const need = async (key, fallback) => {
    const a = (await acc(key)) ?? (fallback ? await acc(fallback) : null);
    if (a == null) missing.add(ACCOUNT_SETTING_BY_KEY[key]?.label ?? key);
    return a;
  };
  const who = `${d.kind_label} — emp ${s.employee_id}`;
  const out = [];
  for (const l of d.lines) {
    const acno = l.acno ?? (await need(l.account, l.fallback));
    const narration = `Final settlement #S-${s.id} ${who}: ${l.label}`;
    out.push(l.kind === "EARNING" ? { acno, ccno: l.cc ? d.cost_center : null, damt: l.amount, camt: 0, narration } : { acno, damt: 0, camt: l.amount, narration });
  }
  if (d.pf?.forfeited > 0) {
    out.push({ acno: await need("payroll_pf_payable"), damt: d.pf.forfeited, camt: 0, narration: `Final settlement #S-${s.id} ${who}: employer PF forfeited` });
    out.push({ acno: await need("payroll_pf_expense"), ccno: d.cost_center, damt: 0, camt: d.pf.forfeited, narration: `Final settlement #S-${s.id} ${who}: employer PF forfeited` });
  }
  if (d.gratuity?.write_back > 0) {
    out.push({ acno: await need("payroll_gratuity_payable"), damt: d.gratuity.write_back, camt: 0, narration: `Final settlement #S-${s.id} ${who}: gratuity provision written back` });
    out.push({ acno: await need("payroll_gratuity_expense"), ccno: d.cost_center, damt: 0, camt: d.gratuity.write_back, narration: `Final settlement #S-${s.id} ${who}: gratuity provision written back` });
  }
  if (d.net > 0) out.push({ acno: await need("payroll_settlement_payable", "payroll_salary_payable"), damt: 0, camt: d.net, narration: `Final settlement #S-${s.id} ${who}: net payable` });
  return { lines: out, missing: [...missing] };
}

/** APPROVED → POSTED: the journal and the loan recoveries, together. */
export async function postSettlement(id, { date, actor }) {
  const s = await prisma.hrSettlement.findUnique({ where: { id } });
  if (!s) throw new LeavingError("Settlement not found.", 404);
  if (s.status !== SETTLEMENT_STATUS.APPROVED) throw new LeavingError(`Only an approved settlement is posted — this one is ${s.status.toLowerCase()}.`, 409);
  if (s.data.net < 0) throw new LeavingError("The employee owes money on this settlement — it cannot be posted.", 409);
  await checkVoucherDate(date, TRAN.JOURNAL);
  const jv = await journalLines(s);
  if (jv.missing.length) throw new LeavingError(`Set these first in Finance → Account Settings → Payroll: ${jv.missing.join("; ")}.`, 422);
  const loans = s.data.loans ?? [];
  return prisma.$transaction(
    async (tx) => {
      const claimed = await tx.hrSettlement.updateMany({ where: { id, status: SETTLEMENT_STATUS.APPROVED }, data: { status: SETTLEMENT_STATUS.POSTED } });
      if (claimed.count !== 1) throw new LeavingError("This settlement changed a moment ago — refresh.", 409);
      const v = await postJournal(tx, { date, lines: jv.lines, remarks: `Final settlement #S-${id} — ${s.data.kind_label}, employee ${s.employee_id}, last day ${s.data.dor}`, marker: "HR_SETTLEMENT", ref: id, actor });
      for (const l of loans) {
        await tx.hrLoanRecovery.create({ data: { loan_id: l.loan_id, date: dbDay(date), amount: l.outstanding, source: "SETTLEMENT", reference: `JV #${v.tran_id}`, settlement_id: id, created_by: actor } });
        await tx.hrLoan.update({ where: { id: l.loan_id }, data: { status: "settled" } });
        await tx.hrLoanEvent.create({ data: { loan_id: l.loan_id, action: "settled", detail: `${fmtMoney(l.outstanding)} recovered in final settlement #S-${id} (JV #${v.tran_id})`, created_by: actor } });
      }
      await tx.hrSettlement.update({ where: { id }, data: { jv_tran_id: v.tran_id, posted_by: actor, posted_at: new Date() } });
      return v;
    },
    { timeout: 60000, maxWait: 20000 },
  );
}

/** Pay the net of a POSTED settlement: Payment voucher, Dr settlements payable, Cr cash / bank. */
export async function paySettlement(id, { date, cashAcno, reference, session }) {
  const actor = session.user.id;
  const s = await prisma.hrSettlement.findUnique({ where: { id } });
  if (!s) throw new LeavingError("Settlement not found.", 404);
  if (s.status !== SETTLEMENT_STATUS.POSTED) throw new LeavingError("Post the settlement before paying it.", 409);
  if (s.pay_tran_id && !s.pay_reversal_tran_id) throw new LeavingError("This settlement is already paid.", 409);
  if (!(s.net > 0)) throw new LeavingError("Nothing to pay on this settlement.", 409);
  await checkVoucherDate(date, TRAN.PAYMENT);
  const cash = await assertCashBank(session, cashAcno);
  const payable = (await getAccount("payroll_settlement_payable")) ?? (await getAccount("payroll_salary_payable"));
  if (payable == null) throw new LeavingError("Set “Final Settlements Payable” (or Salaries Payable) in Finance → Account Settings → Payroll.", 422);
  const ref = reference ? String(reference).trim().slice(0, 60) : "";
  return prisma.$transaction(async (tx) => {
    const v = await postCashVoucher(tx, {
      tranCode: TRAN.PAYMENT,
      date,
      cashAcno: cash.acno,
      lines: [{ acno: payable, amount: s.net, narration: `Final settlement #S-${id} — employee ${s.employee_id}${ref ? ` · ${ref}` : ""}` }],
      remarks: `Final settlement #S-${id} paid — employee ${s.employee_id}`,
      marker: "HR_SETTLEMENT_PAY",
      ref: id,
      actor,
    });
    const claimed = await tx.hrSettlement.updateMany({
      where: { id, status: SETTLEMENT_STATUS.POSTED, OR: [{ pay_tran_id: null }, { pay_reversal_tran_id: { not: null } }] },
      data: { pay_tran_id: v.tran_id, pay_acno: cash.acno, paid_on: dbDay(date), paid_by: actor, pay_reversal_tran_id: null },
    });
    if (claimed.count !== 1) throw new LeavingError("This settlement was paid a moment ago — refresh.", 409);
    return { ...v, account: cash.name };
  });
}

/** Undo the payment: reversal journal; the settlement is unpaid again. */
export async function reverseSettlementPayment(id, { date, reason, actor }) {
  if (!reason) throw new LeavingError("Say why the payment is reversed.");
  const s = await prisma.hrSettlement.findUnique({ where: { id } });
  if (!s?.pay_tran_id || s.pay_reversal_tran_id) throw new LeavingError("This settlement has no payment to reverse.", 409);
  await checkVoucherDate(date, TRAN.JOURNAL);
  return prisma.$transaction(async (tx) => {
    const v = await postReversal(tx, { tranId: s.pay_tran_id, date, reason, ref: id, actor });
    const r = await tx.hrSettlement.updateMany({ where: { id, pay_tran_id: s.pay_tran_id, pay_reversal_tran_id: null }, data: { pay_reversal_tran_id: v.tran_id } });
    if (r.count !== 1) throw new LeavingError("This payment changed a moment ago — refresh.", 409);
    return v;
  });
}

/** POSTED → REVERSED: mirror journal, loan recoveries undone. Payment must be reversed first. */
export async function reverseSettlement(id, { date, reason, actor }) {
  if (!reason) throw new LeavingError("Say why the settlement is reversed.");
  const s = await prisma.hrSettlement.findUnique({ where: { id } });
  if (!s) throw new LeavingError("Settlement not found.", 404);
  if (s.status !== SETTLEMENT_STATUS.POSTED) throw new LeavingError("Only a posted settlement is reversed.", 409);
  if (s.pay_tran_id && !s.pay_reversal_tran_id) throw new LeavingError("Reverse its payment first.", 409);
  await checkVoucherDate(date, TRAN.JOURNAL);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.hrSettlement.updateMany({ where: { id, status: SETTLEMENT_STATUS.POSTED }, data: { status: SETTLEMENT_STATUS.REVERSED } });
    if (claimed.count !== 1) throw new LeavingError("This settlement changed a moment ago — refresh.", 409);
    const v = s.jv_tran_id ? await postReversal(tx, { tranId: s.jv_tran_id, date, reason, ref: id, actor }) : null;
    const recs = await tx.hrLoanRecovery.findMany({ where: { settlement_id: id } });
    await tx.hrLoanRecovery.deleteMany({ where: { settlement_id: id } });
    for (const loanId of [...new Set(recs.map((r) => r.loan_id))]) {
      await tx.hrLoan.updateMany({ where: { id: loanId, status: "settled" }, data: { status: "active" } });
      await tx.hrLoanEvent.create({ data: { loan_id: loanId, action: "recovery reversed", detail: `final settlement #S-${id} reversed — ${reason}`, created_by: actor } });
    }
    await tx.hrSettlement.update({ where: { id }, data: { reversal_tran_id: v?.tran_id ?? null, reversed_by: actor, reversed_at: new Date(), reverse_reason: reason } });
    return v;
  });
}

/** Drop a DRAFT (nothing in the books yet). */
export async function deleteSettlementDraft(id) {
  const r = await prisma.hrSettlement.deleteMany({ where: { id, status: SETTLEMENT_STATUS.DRAFT } });
  if (r.count !== 1) throw new LeavingError("Only a draft settlement can be deleted.", 409);
}
