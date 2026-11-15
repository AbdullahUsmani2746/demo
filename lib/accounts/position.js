// lib/accounts/position.js
// ============================================================
// ACCOUNT POSITION — the one-line summary shown under an account picker on a
// voucher form (components/Category/AccountPosition.jsx):
//
//   cash / bank  → balance today
//   customer     → balance · overdue · credit left · open invoices
//   vendor       → payable · open bills
//   anything else→ balance
//
// Read-only. Nothing new is calculated here:
//   balance       the Dr/Cr rules of the account ledger (same CASE as
//                 lib/reports/customerAging.js ledger_balance)
//   overdue       getCustomerOverdueTotals — the aging report's own figures
//   open invoices getCustomerOutstanding / getVendorOutstanding
//                 (the Receipt / Payment invoice pickers' source)
// ============================================================
import prisma from "@/lib/prisma";
import { getCustomerMacnos, getVendorMacnos, getCashBankMacnos } from "@/lib/accounts/partyMacnos";
import { getCustomerOverdueTotals } from "@/lib/reports/customerAging";
import { getCustomerOutstanding, getVendorOutstanding } from "@/lib/ledger/outstandingInvoices";
import { customerScopeWhere } from "@/lib/auth/salesScope";

const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(num(n) * 100) / 100;

/** Ledger balance (Dr − Cr) of one account up to today. */
async function ledgerBalance(acno) {
  const asOf = new Date();
  asOf.setHours(23, 59, 59, 999);
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(
      CASE
        WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.damt, 0)
        WHEN tm.tran_code = 2 AND t.sub_tran_id = 1      THEN COALESCE(t.damt, 0)
        WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)        THEN COALESCE(t.damt, 0)
        ELSE 0
      END
      -
      CASE
        WHEN tm.tran_code = 1 AND t.sub_tran_id = 1      THEN COALESCE(t.camt, 0)
        WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2,3) THEN COALESCE(t.camt, 0)
        WHEN tm.tran_code IN (3,4,5,6,9,10,12,21)        THEN COALESCE(t.camt, 0)
        ELSE 0
      END
    ), 0)::float8 AS balance
    FROM "Transactions" t
    INNER JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    WHERE t.acno = ${Number(acno)}
      AND tm.tran_code IN (1,2,3,4,5,6,9,10,12,21)
      AND tm.dated <= ${asOf}`;
  return round2(rows[0]?.balance);
}

/** Open invoices of a party: { count, amount, oldestDays }. */
function summariseOpen(rows) {
  const open = (rows || []).filter((r) => num(r.outstanding) > 0.005);
  return {
    count: open.length,
    amount: round2(open.reduce((s, r) => s + num(r.outstanding), 0)),
    oldestDays: open.reduce((m, r) => Math.max(m, num(r.days_outstanding)), 0),
  };
}

/**
 * @returns {Promise<null | { acno, acname, kind, balance, overdue?, current?,
 *   crLimit?, creditLeft?, crDays?, open? }>} null when the account does not
 *   exist or is a customer outside the session's sales scope.
 */
export async function getAccountPosition(acno, session) {
  const id = Number(acno);
  if (!Number.isInteger(id) || id <= 0) return null;

  const account = await prisma.aCNO.findUnique({
    where: { acno: id },
    select: { acno: true, acname: true, macno: true, crDays: true, crLimit: true },
  });
  if (!account) return null;

  const [customerMacnos, vendorMacnos, cashBankMacnos] = await Promise.all([
    getCustomerMacnos(),
    getVendorMacnos(),
    getCashBankMacnos(),
  ]);
  const kind = customerMacnos.includes(account.macno)
    ? "customer"
    : vendorMacnos.includes(account.macno)
      ? "vendor"
      : cashBankMacnos.includes(account.macno)
        ? "cash_bank"
        : "other";

  // A sales person sees only their own customers' figures.
  if (kind === "customer") {
    const visible = await prisma.aCNO.findFirst({
      where: { acno: id, ...(await customerScopeWhere(session)) },
      select: { acno: true },
    });
    if (!visible) return null;
  }

  const base = { acno: account.acno, acname: account.acname, kind };

  if (kind === "customer") {
    const [[aging], open] = await Promise.all([
      getCustomerOverdueTotals({ acnos: [id] }),
      getCustomerOutstanding(id).then(summariseOpen),
    ]);
    const balance = round2(aging?.totalOutstanding ?? (await ledgerBalance(id)));
    const crLimit = account.crLimit ? num(account.crLimit) : null;
    return {
      ...base,
      balance,
      overdue: round2(aging?.overdueAmount),
      current: round2(aging?.currentAmount),
      crDays: account.crDays ?? null,
      crLimit,
      creditLeft: crLimit != null ? round2(crLimit - balance) : null,
      open,
    };
  }

  if (kind === "vendor") {
    const [balance, open] = await Promise.all([
      ledgerBalance(id),
      getVendorOutstanding(id).then(summariseOpen),
    ]);
    return { ...base, balance, open };
  }

  return { ...base, balance: await ledgerBalance(id) };
}
