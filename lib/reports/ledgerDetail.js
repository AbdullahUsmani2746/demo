// Account Ledger / Cash & Bank Book — "Detail" option (filter `ledgerDetail`).
//
// Pure functions only (no prisma, no imports) so scripts can test them.
//
// Why the cash account shows one row per voucher: a Receipt / Payment / invoice
// stores its header account (TRANSACTIONS_MASTER.pycd — the cash/bank account,
// or the party on an invoice) as ONE auto line (sub_tran_id 3, "Auto Entry")
// carrying the voucher's net total, while each counter account has its own
// line. The ledger lists the viewed account's own Transactions rows, so the
// party sees each of its lines, the header account only its one total line.
//
// Summary (default) keeps that. Detailed replaces such a single aggregated row
// by one row per counter-line of the voucher, each with the counter line's
// amount on THIS account's side, so the rows of a voucher always add up to the
// summary row exactly and the running balance / closing never changes.

// The Dr / Cr rules of the ledger (CLAUDE.md "Account Balance"); same CASE as
// the SQL in getAccountLedger. Returns this line's debit and credit.
export const LEDGER_TRAN_CODES = [1, 2, 3, 4, 5, 6, 9, 10, 12, 21];

export function ledgerDrCr(tranCode, subTranId, damt, camt) {
  const tc = Number(tranCode);
  const sub = Number(subTranId);
  const d = Number(damt) || 0;
  const c = Number(camt) || 0;
  if (tc === 1) return { debit: sub === 2 || sub === 3 ? d : 0, credit: sub === 1 ? c : 0 };
  if (tc === 2) return { debit: sub === 1 ? d : 0, credit: sub === 2 || sub === 3 ? c : 0 };
  if (LEDGER_TRAN_CODES.includes(tc)) return { debit: d, credit: c };
  return { debit: 0, credit: 0 };
}

export function wantsLedgerDetail(filters) {
  const v = filters?.ledgerDetail;
  const value = v && typeof v === "object" ? v.value : v;
  return String(value || "").toLowerCase() === "detailed";
}

const EPS = 0.005;
const sign = (n) => (n > EPS ? 1 : n < -EPS ? -1 : 0);
const round2 = (n) => Number((Number(n) || 0).toFixed(2));

export const accountLabel = (acno, acname) =>
  acno == null ? acname || "" : [acno, acname].filter((x) => x !== null && x !== undefined && x !== "").join(" - ");

// "Against account" for a row that is NOT expanded:
//   a line of a voucher with a header account (pycd) → that header;
//   otherwise the accounts on the opposite side of the voucher.
function againstFor(row, lines, pycd) {
  const acno = Number(row.acno);
  if (pycd != null && Number(pycd) !== acno) {
    const head = lines.find((l) => l.acno === Number(pycd));
    return { acno: Number(pycd), name: head?.acname || "" };
  }
  const e = sign((Number(row.debit) || 0) - (Number(row.credit) || 0));
  const seen = new Map();
  for (const l of lines) {
    if (l.acno === acno) continue;
    if (e !== 0 && sign(l.effect) !== -e) continue;
    if (e === 0 && sign(l.effect) === 0) continue;
    if (!seen.has(l.acno)) seen.set(l.acno, l.acname || "");
  }
  if (seen.size === 0) return { acno: null, name: "" };
  const [[firstNo, firstName]] = seen;
  if (seen.size === 1) return { acno: firstNo, name: firstName };
  return { acno: null, name: `${accountLabel(firstNo, firstName)} +${seen.size - 1} more`, multi: true };
}

/**
 * rows       one account's ledger rows in order (opening row excluded), each
 *            { tran_id, acno, debit, credit, balance, narration, ... } — balance
 *            already the running balance (opening + movement).
 * vouchers   Map/obj tran_id → { pycd, rmk, lines: [{ id, acno, acname,
 *            sub_tran_id, effect (= debit − credit under the ledger rules),
 *            narration }] } — EVERY line of the voucher, any account.
 * detailed   true → expand single header/contra rows per counter-line.
 *
 * Returns new rows: every row gets against_acno / against_name / against;
 * expanded rows carry the counter line's account, narration and amount.
 */
export function buildLedgerRows(rows, vouchers, { detailed = false } = {}) {
  const get = (id) => (vouchers instanceof Map ? vouchers.get(id) : vouchers[id]) || { lines: [] };

  // How many rows this account has per voucher (expand only a single row).
  const countByTran = new Map();
  for (const r of rows) countByTran.set(r.tran_id, (countByTran.get(r.tran_id) || 0) + 1);

  const out = [];
  for (const row of rows) {
    const v = get(row.tran_id);
    const lines = v.lines || [];
    const acno = Number(row.acno);
    const E = (Number(row.debit) || 0) - (Number(row.credit) || 0);
    const ag = againstFor(row, lines, v.pycd);
    // Slip # (receipt / payment lines, narration5): a line keeps its own; the
    // header row (cash / bank, one total line) lists its voucher's slips.
    const isHeaderRow = v.pycd != null && Number(v.pycd) === acno;
    const slips = [
      ...new Set(lines.filter((l) => l.acno !== acno && l.slip_no).map((l) => String(l.slip_no))),
    ];
    const base = {
      ...row,
      slip_no: row.slip_no || (isHeaderRow && slips.length ? slips.join(", ") : null),
      against_acno: ag.acno,
      against_name: ag.name,
      against: ag.multi ? ag.name : accountLabel(ag.acno, ag.name),
      is_detail_line: false,
    };

    if (!detailed || countByTran.get(row.tran_id) !== 1 || sign(E) === 0) {
      out.push(base);
      continue;
    }

    const others = lines.filter((l) => l.acno !== acno && sign(l.effect) !== 0);
    const isHeader = v.pycd != null && Number(v.pycd) === acno;
    const aloneOnSide = !others.some((l) => sign(l.effect) === sign(E));
    const total = others.reduce((s, l) => s - l.effect, 0);
    if (!others.length || !(isHeader || aloneOnSide) || Math.abs(total - E) > 0.01) {
      out.push(base);
      continue;
    }

    // Exact split, in whole cents: each counter line's amount; the last one
    // takes whatever is left so the voucher's rows add up to E to the cent,
    // and its balance is the summary row's balance itself.
    const totalCents = Math.round(E * 100);
    let running = Number(row.balance) - E;
    let usedCents = 0;
    others.forEach((l, i) => {
      const last = i === others.length - 1;
      const cents = last ? totalCents - usedCents : Math.round(-l.effect * 100);
      usedCents += cents;
      const amt = cents / 100;
      running = last ? Number(row.balance) : running + amt;
      out.push({
        ...row,
        debit: amt > 0 ? amt : 0,
        credit: amt < 0 ? -amt : 0,
        balance: round2(running),
        narration: l.narration || v.rmk || row.narration || "",
        slip_no: l.slip_no || null,
        against_acno: l.acno,
        against_name: l.acname || "",
        against: accountLabel(l.acno, l.acname),
        against_sub_tran_id: l.sub_tran_id ?? null,
        is_detail_line: true,
        detail_seq: i + 1,
        transactions: [],
      });
    });
  }
  return out;
}
