// lib/vouchers/subAccounts.js
// ============================================================
// Sub Accounts on voucher lines (feature "vouchers.subAccounts",
// lib/features/catalog.js; ported from Eastland).
//
// A sub account is a name kept under one account (table subAccount — e.g.
// "FUEL" and "REPAIRS" under VEHICLE EXPENSES). A Payment / Receipt / Journal
// line may name one; the name is stored on the line (Transactions.sub_account)
// and the Account Ledger can show, filter and total by it.
//
// Which accounts MUST name one is data: Finance → Account Settings →
// "Accounts that need a Sub Account" (GROUP key "sub_account_groups", the main
// accounts whose accounts need it). Empty group = never required.
//
// Feature off: nothing new is written — a line keeps a sub account only when
// the stored voucher already had that same sub account on that same account
// (an edit never wipes what was saved while the feature was on). Values already
// stored are never touched by switching off.
// ============================================================
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { getAccountGroup } from "@/lib/accounts/accountSettings";

export const SUB_ACCOUNT_FEATURE = "vouchers.subAccounts";
export const SUB_ACCOUNT_GROUP_KEY = "sub_account_groups";
/** Receipt, Payment, Journal. */
export const SUB_ACCOUNT_TRAN_CODES = new Set([1, 2, 3]);

const acnoOf = (line) => {
  const v = line?.acno && typeof line.acno === "object" ? line.acno.value : line?.acno;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** A line's sub account as stored: trimmed CAPS text, or null (also for the old "undefined" / "null" text). */
export function cleanSubAccount(value) {
  const raw = value && typeof value === "object" ? value.value ?? value.label : value;
  const s = String(raw ?? "").trim();
  if (!s || /^(undefined|null)$/i.test(s)) return null;
  return s.toUpperCase().slice(0, 250);
}

/** Of these accounts, the ones that must name a sub account (their main account is in the group). */
export async function accountsNeedingSubAccount(acnos) {
  const ids = [...new Set((acnos || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return new Set();
  const macnos = await getAccountGroup(SUB_ACCOUNT_GROUP_KEY);
  if (!macnos.length) return new Set();
  const rows = await prisma.aCNO.findMany({
    where: { acno: { in: ids }, macno: { in: macnos } },
    select: { acno: true },
  });
  return new Set(rows.map((r) => r.acno));
}

/**
 * Settles `sub_account` on every line of a voucher body before it is saved —
 * mutates the line objects (each gets a clean string or null) and returns an
 * error message (422) or null.
 *   tranCode      the voucher's tran_code; other documents never carry one
 *   lines         body.lines
 *   deductions    body.deductions (Payment / Receipt second grid)
 *   storedTranId  on an edit: the voucher being edited
 */
export async function applySubAccounts({ tranCode, lines = [], deductions = [], storedTranId = null }) {
  const all = [...(Array.isArray(lines) ? lines : []), ...(Array.isArray(deductions) ? deductions : [])].filter(
    (l) => l && typeof l === "object",
  );
  if (!SUB_ACCOUNT_TRAN_CODES.has(Number(tranCode))) {
    for (const l of all) delete l.sub_account;
    return null;
  }

  if (!(await feature(SUB_ACCOUNT_FEATURE))) {
    // Off: keep only what the stored voucher already had on the same account.
    const kept = new Set();
    if (storedTranId) {
      const stored = await prisma.transactions.findMany({
        where: { tran_id: Number(storedTranId), sub_account: { not: null } },
        select: { acno: true, sub_account: true },
      });
      for (const s of stored) {
        const name = cleanSubAccount(s.sub_account);
        if (name) kept.add(`${s.acno}|${name}`);
      }
    }
    for (const l of all) {
      const name = cleanSubAccount(l.sub_account);
      l.sub_account = name && kept.has(`${acnoOf(l)}|${name}`) ? name : null;
    }
    return null;
  }

  for (const l of all) l.sub_account = cleanSubAccount(l.sub_account);

  // Every name must be a sub account of its line's account.
  const named = all.filter((l) => l.sub_account);
  if (named.some((l) => !acnoOf(l))) return "A Sub Account was given on a line without an account.";
  if (named.length) {
    const subs = await prisma.subAccount.findMany({
      where: { acno: { in: [...new Set(named.map(acnoOf))] } },
      select: { acno: true, acname: true },
    });
    const known = new Set(subs.map((s) => `${s.acno}|${cleanSubAccount(s.acname)}`));
    const bad = named.find((l) => !known.has(`${acnoOf(l)}|${l.sub_account}`));
    if (bad) return `"${bad.sub_account}" is not a Sub Account of account ${acnoOf(bad)}. Add it first (Finance → Sub Accounts, or "Add new" on the line).`;
  }

  // Accounts in the "need a Sub Account" group must name one.
  const need = await accountsNeedingSubAccount(all.map(acnoOf));
  const missing = all.filter((l) => need.has(acnoOf(l)) && !l.sub_account);
  if (missing.length) {
    const ids = [...new Set(missing.map(acnoOf))];
    const names = await prisma.aCNO.findMany({ where: { acno: { in: ids } }, select: { acno: true, acname: true } });
    const label = names.map((a) => `${a.acno} - ${a.acname}`).join(", ") || ids.join(", ");
    return `Sub Account is required for ${label}.`;
  }
  return null;
}
