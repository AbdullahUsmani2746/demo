import prisma from "@/lib/prisma";

// ============================================================
// Account Ledger Summary — the Account Ledger with the items of every Sale /
// Purchase Invoice and Return shown as columns (Code, Item, Rate, Qty, Unit,
// ST, Amount), plus the voucher's narration and its total ST Amount.
// Summary (default): one row per voucher; Detailed: one row per voucher line
// (the Account Ledger's "Detail" option, lib/reports/ledgerDetail.js).
// Same report as Eastland's, laid out for the wide report engine:
//
//   · a voucher split per invoice (a receipt paying three invoices) shows
//     once per account — Debit / Credit added up, invoice numbers listed
//     together, the balance of its last line (mergeVoucherLines);
//   · an invoice with several items: its own row carries the first item and
//     the Debit / Credit / Balance, each further item is a row under it with
//     only the item columns (expandItemRows). Every row keeps tran_id +
//     tran_code, so each one opens the voucher.
//
// Item figures match the Account Ledger's item narration: a LTR line's qty is
// its litres; Amount = gross (else rate × qty) + ST.
// ============================================================

const ITEM_TYPES = new Set(["Sale Invoice", "Purchase Invoice", "Sale Return", "Purchase Return"]);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Item lines of the invoice / return rows, keyed by tran_id (one query). */
async function itemLinesByTran(rows) {
  const tranIds = [
    ...new Set(rows.filter((r) => ITEM_TYPES.has(r.tran_type) && r.tran_id).map((r) => Number(r.tran_id))),
  ];
  if (!tranIds.length) return new Map();
  const lines = await prisma.transactions.findMany({
    where: { tran_id: { in: tranIds }, sub_tran_id: 1, itcd: { not: null } },
    select: {
      tran_id: true,
      qty: true,
      qty_ltr: true,
      unit: true,
      rate: true,
      st_amount: true,
      gross_amount: true,
      itemDetails: { select: { code: true, item: true } },
    },
    orderBy: { id: "asc" },
  });
  const byTran = new Map();
  for (const l of lines) {
    const isLtr = String(l.unit || "").toUpperCase() === "LTR";
    const qty = Number(isLtr ? l.qty_ltr : l.qty) || 0;
    const st = Number(l.st_amount) || 0;
    const gross = l.gross_amount != null ? Number(l.gross_amount) : (Number(l.rate) || 0) * qty;
    const item = {
      item_code: l.itemDetails?.code ?? "",
      item_name: l.itemDetails?.item ?? "",
      item_rate: l.rate == null ? null : round2(l.rate),
      item_qty: round2(qty),
      item_unit: isLtr ? "LTR" : "KG",
      item_st: round2(st),
      item_amount: round2(gross + st),
    };
    if (!byTran.has(l.tran_id)) byTran.set(l.tran_id, []);
    byTran.get(l.tran_id).push(item);
  }
  return byTran;
}

/**
 * One row per voucher and account: the lines of a voucher split per invoice
 * are added up and sit where the voucher's last line was (its balance).
 */
export function mergeVoucherLines(rows) {
  const lastIndex = new Map();
  rows.forEach((r, i) => {
    if (!r.isOpening && r.tran_id) lastIndex.set(`${r.acno}|${r.tran_id}`, i);
  });

  const merged = new Map();
  rows.forEach((r) => {
    if (r.isOpening || !r.tran_id) return;
    const key = `${r.acno}|${r.tran_id}`;
    const m = merged.get(key);
    if (!m) {
      merged.set(key, { ...r, _invoices: [r.detail_invoice_no].filter(Boolean), _narrations: [r.narration].filter(Boolean) });
      return;
    }
    if (r.narration && !m._narrations.includes(r.narration)) m._narrations.push(r.narration);
    m.debit = round2((Number(m.debit) || 0) + (Number(r.debit) || 0));
    m.credit = round2((Number(m.credit) || 0) + (Number(r.credit) || 0));
    if (r.detail_invoice_no && !m._invoices.includes(r.detail_invoice_no)) m._invoices.push(r.detail_invoice_no);
  });

  const out = [];
  rows.forEach((r, i) => {
    if (r.isOpening || !r.tran_id) return out.push(r);
    const key = `${r.acno}|${r.tran_id}`;
    if (lastIndex.get(key) !== i) return; // folded into this voucher's row
    const { _invoices, _narrations, ...m } = merged.get(key);
    out.push({ ...m, detail_invoice_no: _invoices.join(", ") || null, narration: _narrations.join(" · "), balance: r.balance });
  });
  return out;
}

/**
 * Item columns on invoice / return rows; one extra row per further item. The
 * voucher row also carries st_amount = the invoice's total ST. In the
 * Detailed view a voucher may have several rows per account: only its first
 * carries the items and the ST.
 */
export async function expandItemRows(rows) {
  const byTran = await itemLinesByTran(rows);
  const done = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.acno}|${r.tran_id}`;
    const items = ITEM_TYPES.has(r.tran_type) && !done.has(key) ? byTran.get(Number(r.tran_id)) : null;
    if (!items?.length) {
      out.push(r);
      continue;
    }
    done.add(key);
    const st_amount = round2(items.reduce((s, i) => s + (Number(i.item_st) || 0), 0));
    out.push({ ...r, ...items[0], st_amount });
    for (const item of items.slice(1)) {
      // Continuation row: only the item; the amounts stay on the voucher row.
      out.push({
        tran_id: r.tran_id,
        tran_code: r.tran_code,
        acno: r.acno,
        acname: r.acname,
        item_line: true,
        ...item,
      });
    }
  }
  return out;
}
