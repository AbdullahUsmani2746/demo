import { Prisma } from "@prisma/client";
import { getCashBankMacnos } from "@/lib/accounts/partyMacnos";

/* ============================================================================
   SHARED RULES FOR THE FUNDS REPORTS (Funds Position / Funds Flow)

   Both reports must agree with the Account Ledger and Trial Balance, so they
   read every fund account exactly the way those reports do:

     - the account is taken from Transactions.acno (NOT TRANSACTIONS_MASTER.pycd)
     - same tran_codes as the Trial Balance
     - same Dr/Cr sign rule per tran_code / sub_tran_id

   Going through pycd missed everything that only touches a fund account as a
   voucher line: journal vouchers, bank-to-bank / cash-to-bank transfers (the
   receiving fund is a line on a payment voucher, never a pycd), and it double
   counted nothing but also picked up vouchers that never post to the fund
   account at all (no control row).
============================================================================ */

// Fund accounts = the "Cash & Bank" group of Finance → Account Settings.
export const getFundMacnos = () => getCashBankMacnos();

// Same list the Trial Balance / Ledger use.
export const FUND_TRAN_CODES = [1, 2, 3, 4, 5, 6, 9, 10, 12, 21];

// An unset group matches nothing (IN (NULL)) instead of making Prisma.join throw.
export async function fundMacnosSql() {
  const macnos = await getFundMacnos();
  return Prisma.join(macnos.length ? macnos : [null]);
}
export const fundTranCodesSql = () => Prisma.join(FUND_TRAN_CODES);

/* Debit / credit of a Transactions line under the ledger rule.
   Receipt (1): sub 1 → credit party; sub 2,3 → debit.
   Payment (2): sub 1 → debit party;  sub 2,3 → credit.
   Everything else: damt = debit, camt = credit. */
export const debitSql = Prisma.sql`
  CASE
    WHEN tm.tran_code = 1 AND t.sub_tran_id = 1        THEN 0
    WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2, 3)  THEN COALESCE(t.damt, 0)
    WHEN tm.tran_code = 2 AND t.sub_tran_id = 1        THEN COALESCE(t.damt, 0)
    WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2, 3)  THEN 0
    WHEN tm.tran_code IN (3, 4, 5, 6, 9, 10, 12, 21)       THEN COALESCE(t.damt, 0)
    ELSE 0
  END`;

export const creditSql = Prisma.sql`
  CASE
    WHEN tm.tran_code = 1 AND t.sub_tran_id = 1        THEN COALESCE(t.camt, 0)
    WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2, 3)  THEN 0
    WHEN tm.tran_code = 2 AND t.sub_tran_id = 1        THEN 0
    WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2, 3)  THEN COALESCE(t.camt, 0)
    WHEN tm.tran_code IN (3, 4, 5, 6, 9, 10, 12, 21)       THEN COALESCE(t.camt, 0)
    ELSE 0
  END`;

export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/* The route hands dates over as LOCAL-midnight / end-of-day Date objects.
   Comparing those against `dated` (stored at 00:00 UTC) is timezone
   dependent, so — like the Trial Balance — reduce them to a plain
   YYYY-MM-DD built from the local parts and compare as ::date. */
function toDateOnly(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${v}`);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function getDateRange(filters = {}) {
  const from = toDateOnly(filters.dateFrom) ?? "1900-01-01";
  const to = toDateOnly(filters.dateTo) ?? toDateOnly(new Date());
  return { from, to };
}
