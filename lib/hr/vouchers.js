// lib/hr/vouchers.js — every rupee HR moves goes through the books, here.
//
//   advance / loan paid out    Payment voucher (2)  Dr staff advance|loan  Cr cash / bank
//   PF loan / withdrawal paid  Payment voucher (2)  Dr PF payable          Cr cash / bank
//                              (a PF loan is recovered back to PF payable by payroll)
//   repaid in cash / by bank   Receipt voucher (1)  Dr cash / bank         Cr staff advance|loan
//   salaries paid              Payment voucher (2)  Dr salaries payable    Cr cash / bank
//   recovered by payroll       inside the payroll journal (lib/hr/payroll/post.js)
//   final settlement           Journal voucher (3)  postJournal (lib/hr/leaving/settlement.js),
//                              then a Payment voucher for its net
//   any of these undone        Journal voucher (3), the exact mirror — the
//                              original is never edited or deleted
//
// Vouchers are laid out like the ones keyed on the Payment / Receipt screens
// (party on sub_tran_id 1, the cash / bank "Auto Entry" on sub_tran_id 3,
// TRANSACTIONS_MASTER.pycd = the cash / bank account) so the cash book,
// ledgers and every report read them the same way. rmk4 is the marker of
// lib/vouchers/systemVouchers.js (which makes them read-only everywhere else)
// and rmk5 the HR record id.
//
// Cash / bank accounts: the "Cash & Bank" group of Finance → Account Settings,
// narrowed by the person's "Cash & Bank Accounts" data scope.
import prisma from "@/lib/prisma";
import { getAccount } from "@/lib/accounts/accountSettings";
import { ACCOUNT_SETTING_BY_KEY } from "@/lib/accounts/accountSettingDefs";
import { getCashBankMacnos } from "@/lib/accounts/partyMacnos";
import { checkPeriodLock } from "@/lib/periodLock";
import { isUnrestricted, scopeFor } from "@/lib/auth/scope";
import { dbDay, isDayKey, todayKey } from "@/lib/hr/time";
import { loanAccountKey, ownLoanAcno } from "@/lib/hr/loans/schedule";

export class VoucherError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const TRAN = { RECEIPT: 1, PAYMENT: 2, JOURNAL: 3 };
const LABEL = { 1: "Receipt voucher", 2: "Payment voucher", 3: "Journal voucher" };
export const voucherLabel = (tranCode, tranId) => `${LABEL[tranCode] ?? "Voucher"} #${tranId}`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Cash & bank accounts this person may pay from / receive into. */
export async function cashBankAccounts(session) {
  const [macnos, scope] = await Promise.all([getCashBankMacnos(), scopeFor(session, "cashBank")]);
  if (!macnos.length) return [];
  const rows = await prisma.aCNO.findMany({
    where: {
      macno: { in: macnos },
      ...(isUnrestricted(scope) ? {} : { acno: { in: scope.values.map(Number).filter(Number.isFinite) } }),
    },
    select: { acno: true, acname: true, lock: true },
    orderBy: { acname: "asc" },
  });
  return rows.filter((r) => !r.lock).map((r) => ({ acno: r.acno, name: r.acname }));
}

/** Throws unless `acno` is one of this person's cash / bank accounts. */
export async function assertCashBank(session, acno) {
  const n = Number(acno);
  if (!Number.isInteger(n)) throw new VoucherError("Choose the cash or bank account.");
  const ok = (await cashBankAccounts(session)).find((a) => a.acno === n);
  if (!ok) throw new VoucherError("That cash / bank account is not one you may use (Finance → Account Settings → Cash & Bank, and your Cash & Bank data scope).", 403);
  return ok;
}

/** An Account Settings → Payroll account, or a 422 naming what to set. */
export async function payrollAccount(key) {
  const acno = await getAccount(key);
  if (acno == null) throw new VoucherError(`Set "${ACCOUNT_SETTING_BY_KEY[key]?.label ?? key}" first in Finance → Account Settings → Payroll.`, 422);
  return acno;
}

/**
 * Account of an advance / loan: the employee's own, else the default. A
 * provident fund loan / withdrawal is Provident Fund Payable (the fund lends /
 * pays out of itself; recoveries credit it back).
 */
export async function staffAccount(loan, employee) {
  return ownLoanAcno(loan.kind, employee) ?? payrollAccount(loanAccountKey(loan.kind));
}

/** A posting date: a day key, today or earlier, in an open period. */
export async function checkVoucherDate(date, tranCode, action = "create") {
  if (!isDayKey(date) || date > todayKey()) throw new VoucherError("Date: today or earlier.");
  const lock = await checkPeriodLock(dbDay(date), tranCode, { action });
  if (lock) throw new VoucherError(lock, 422);
}

async function assertAccountsOpen(db, acnos) {
  const list = [...new Set(acnos.filter((a) => a != null))];
  const rows = await db.aCNO.findMany({ where: { acno: { in: list } }, select: { acno: true, acname: true, lock: true } });
  const found = new Map(rows.map((r) => [r.acno, r]));
  for (const a of list) {
    if (!found.has(a)) throw new VoucherError(`Account ${a} does not exist.`, 422);
    if (found.get(a).lock) throw new VoucherError(`Account ${a} (${found.get(a).acname}) is locked — contact Finance.`, 422);
  }
}

/**
 * A Payment (party Dr) or Receipt (party Cr) voucher, inside `tx`.
 * lines: [{ acno, amount, narration, ccno? }] — the party side; the cash /
 * bank side is one "Auto Entry" for the total.
 * @returns {{ tran_id: number }}
 */
export async function postCashVoucher(tx, { tranCode, date, cashAcno, lines, remarks, marker, ref, actor }) {
  if (tranCode !== TRAN.PAYMENT && tranCode !== TRAN.RECEIPT) throw new Error(`postCashVoucher: tran_code ${tranCode}`);
  const party = lines.map((l) => ({ ...l, amount: r2(l.amount) })).filter((l) => l.amount > 0);
  const total = r2(party.reduce((s, l) => s + l.amount, 0));
  if (!total) throw new VoucherError("Nothing to post — the amount is 0.");
  await assertAccountsOpen(tx, [cashAcno, ...party.map((l) => l.acno)]);
  const payment = tranCode === TRAN.PAYMENT;
  const day = dbDay(date);
  const master = await tx.transactionsMaster.create({
    data: { tran_code: tranCode, dated: day, time: day, check_date: day, pycd: cashAcno, rmk1: String(remarks).slice(0, 500), rmk4: marker, rmk5: String(ref), user_id: actor },
  });
  await tx.transactions.createMany({
    data: [
      ...party.map((l) => ({
        tran_id: master.tran_id,
        sub_tran_id: 1,
        acno: l.acno,
        ccno: l.ccno ?? null,
        damt: payment ? l.amount : 0,
        camt: payment ? 0 : l.amount,
        narration1: String(l.narration).slice(0, 250),
      })),
      { tran_id: master.tran_id, sub_tran_id: 3, acno: cashAcno, damt: payment ? 0 : total, camt: payment ? total : 0, narration1: "Auto Entry" },
    ],
  });
  return { tran_id: master.tran_id };
}

/**
 * A system Journal voucher (3), inside `tx`, numbered like the payroll journal
 * (advisory lock 4003, next vr_no). lines: [{ acno, ccno?, damt, camt, narration }]
 * — must balance. rmk4 = marker, rmk5 = the HR record id.
 * @returns {{ tran_id: number, vr_no: number }}
 */
export async function postJournal(tx, { date, lines, remarks, marker, ref, actor }) {
  const list = lines
    .map((l) => ({ ...l, damt: r2(l.damt), camt: r2(l.camt) }))
    .filter((l) => l.acno != null && (l.damt > 0 || l.camt > 0));
  if (!list.length) throw new VoucherError("Nothing to post — the journal is empty.");
  const dr = r2(list.reduce((s, l) => s + l.damt, 0));
  const cr = r2(list.reduce((s, l) => s + l.camt, 0));
  if (Math.abs(dr - cr) > 0.01) throw new VoucherError(`The journal does not balance (Dr ${dr} / Cr ${cr}).`, 409);
  await assertAccountsOpen(tx, list.map((l) => l.acno));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4003)`;
  const last = await tx.transactionsMaster.findFirst({ where: { tran_code: TRAN.JOURNAL }, orderBy: { vr_no: "desc" }, select: { vr_no: true } });
  const vr_no = (last?.vr_no ?? 0) + 1;
  const day = dbDay(date);
  const master = await tx.transactionsMaster.create({
    data: { tran_code: TRAN.JOURNAL, vr_no, dated: day, time: day, check_date: day, rmk1: String(remarks).slice(0, 500), rmk4: marker, rmk5: String(ref), user_id: actor },
  });
  await tx.transactions.createMany({
    data: list.map((l) => ({
      tran_id: master.tran_id,
      sub_tran_id: 1,
      acno: l.acno,
      ccno: l.ccno ?? null,
      damt: l.damt,
      camt: l.camt,
      narration1: String(l.narration ?? "").slice(0, 250),
    })),
  });
  return { tran_id: master.tran_id, vr_no };
}

/**
 * Undo a posted voucher: a Journal voucher with every line's sides swapped,
 * dated `date`. The original stays as it is.
 * @returns {{ tran_id: number }}
 */
export async function postReversal(tx, { tranId, date, reason, ref, actor }) {
  const original = await tx.transactionsMaster.findUnique({ where: { tran_id: tranId }, include: { transactions: true } });
  if (!original) throw new VoucherError(`Voucher #${tranId} is missing.`, 409);
  const day = dbDay(date);
  const master = await tx.transactionsMaster.create({
    data: {
      tran_code: TRAN.JOURNAL,
      dated: day,
      time: day,
      check_date: day,
      rmk1: `Reversal of ${voucherLabel(original.tran_code, tranId)} — ${reason}`.slice(0, 500),
      rmk4: "HR_REVERSAL",
      rmk5: String(ref),
      user_id: actor,
    },
  });
  await tx.transactions.createMany({
    data: original.transactions.map((l) => ({
      tran_id: master.tran_id,
      sub_tran_id: 1,
      acno: l.acno,
      ccno: l.ccno,
      damt: l.camt ?? 0,
      camt: l.damt ?? 0,
      narration1: `Reversal — ${l.narration1 ?? ""}`.slice(0, 250),
    })),
  });
  return { tran_id: master.tran_id };
}
