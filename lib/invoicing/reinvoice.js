// lib/invoicing/reinvoice.js
// ============================================================
// SERVER ONLY — editing an INVOICED GRN / dispatch / return directly
// (Settings → Features → "Edit invoiced documents directly", INVOICED_EDIT_FEATURE).
//
// Off (default): an invoiced document is locked until Invoicing reverses it.
// On: the normal edit (PUT /api/voucher/[type]) is allowed and, in the SAME
// transaction as the edit, the document is invoiced again under its own
// invoice number (repriceInTransaction in lib/invoicing/core.js — the very
// pricing and posting Generate uses):
//   - each edited line takes the rate / GST % (and the KG / LTR billing unit)
//     the old invoice had for that item — matched item by item, in order;
//     an acknowledged qty carries over only while the qty is unchanged;
//   - a new item takes its default rate (Sale Order / price list / last
//     purchase …); no rate → the whole save is refused;
//   - the vendor bill no / bill date stay.
// Refused up front: payments / receipts matched to the invoice (undo them on
// the Reverse dialog first — their amounts would no longer fit), and imported
// old-ERP invoices (series 'L'). Deleting stays behind Unlock in Invoicing.
// ============================================================
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { activeKnockoffWhere, InvoicingError, repriceInTransaction } from "@/lib/invoicing/core";
import { INVOICED_EDIT_FEATURE, isInvoicedMaster, kindConfig, kindForTranCode, LEGACY_SERIES } from "@/lib/invoicing/kinds";
import { isLitreUnit } from "@/lib/units/litres";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fail = (message) => new InvoicingError(message, 422);

/**
 * May this stored document be edited although it is invoiced?
 * → null when it is not invoiced (the normal edit), else a plan for
 *   reinvoiceAfterEdit. Throws InvoicingError (422) with the reason when not.
 * `stored` needs tran_id, tran_code, invoice_no, invoice_series, pycd.
 */
export async function planInvoicedEdit(stored) {
  const kind = kindForTranCode(stored?.tran_code);
  if (!kind || !isInvoicedMaster(stored)) return null;
  const invoiceNo = String(stored.invoice_no ?? "").trim();
  if (!(await feature(INVOICED_EDIT_FEATURE))) {
    throw fail(`This document is invoiced as ${invoiceNo || "imported history"} — unlock it in Invoicing first.`);
  }
  if (stored.invoice_series === LEGACY_SERIES || !invoiceNo) {
    throw fail("This is an imported old-ERP invoice — it cannot be edited.");
  }
  const matched = await prisma.invoiceKnockoff.count({ where: activeKnockoffWhere(stored) });
  if (matched) {
    throw fail(
      `Invoice ${invoiceNo} has ${matched} payment${matched === 1 ? "" : "s"} matched to it — undo the match first ` +
        "(Invoicing → Reverse on this invoice → Undo match), then edit.",
    );
  }
  const lines = await prisma.transactions.findMany({
    where: { tran_id: stored.tran_id, sub_tran_id: 1, itcd: { not: null } },
    orderBy: { id: "asc" },
    select: { itcd: true, rate: true, st_rate: true, unit: true, qty: true, qty_ltr: true, ack_qty: true, gross_amount: true, st_amount: true },
  });
  return {
    kind: kind.kind,
    tran_id: stored.tran_id,
    invoiceNo,
    lines,
    total: round2(lines.reduce((s, l) => s + num(l.gross_amount) + num(l.st_amount), 0)),
  };
}

/** Old invoice line → what the new line with the same item carries over. */
function carryOver(old, line, kind) {
  const out = { line_id: line.id, rate: num(old.rate), st_rate: num(old.st_rate) };
  // The KG / LTR billing unit chosen on the invoice — only where the invoice may choose it.
  if (kindConfig(kind)?.unitSwitch) {
    const oldLtr = isLitreUnit(old.unit);
    out.unit = oldLtr ? "LTR" : "KG";
    if (oldLtr && num(old.qty) > 0 && num(old.qty_ltr) > 0) out.density = num(old.qty) / num(old.qty_ltr);
  }
  // Acknowledged qty: only while the physical qty is the same.
  if (old.ack_qty != null && Math.abs(num(old.qty) - num(line.qty)) < 1e-6) out.ack_qty = num(old.ack_qty);
  return out;
}

/**
 * Inside the edit's transaction, after its lines were written: re-check under
 * the row lock (still the same invoice, still nothing matched), then price and
 * post the document again. Returns a line for the save's warnings.
 */
export async function reinvoiceAfterEdit(tx, plan, session) {
  const [row] = await tx.$queryRaw`
    SELECT tran_id, invoice_no, pycd FROM "TRANSACTIONS_MASTER" WHERE tran_id = ${plan.tran_id} FOR UPDATE`;
  if (String(row?.invoice_no ?? "").trim() !== plan.invoiceNo) {
    throw fail("The invoice changed while you were editing — open the document again.");
  }
  const matched = await tx.invoiceKnockoff.count({ where: activeKnockoffWhere({ ...row, tran_id: plan.tran_id }) });
  if (matched) throw fail(`A payment was matched to invoice ${plan.invoiceNo} meanwhile — undo the match first.`);

  const newLines = await tx.transactions.findMany({
    where: { tran_id: plan.tran_id, sub_tran_id: 1, itcd: { not: null } },
    orderBy: { id: "asc" },
    select: { id: true, itcd: true, qty: true },
  });
  const pool = new Map();
  for (const old of plan.lines) {
    if (!pool.has(old.itcd)) pool.set(old.itcd, []);
    pool.get(old.itcd).push(old);
  }
  const lines = [];
  for (const line of newLines) {
    const old = pool.get(line.itcd)?.shift();
    if (old) lines.push(carryOver(old, line, plan.kind));
  }

  let totals;
  try {
    totals = await repriceInTransaction(tx, plan.kind, plan.tran_id, { invoiceNo: plan.invoiceNo, lines }, session);
  } catch (err) {
    if (err instanceof InvoicingError && /^No rate for/.test(err.message)) {
      throw fail(`${err.message.replace(/ — enter one$/, "")} on invoice ${plan.invoiceNo} — reverse it in Invoicing and invoice it again with the rate.`);
    }
    throw err;
  }
  const after = round2(totals.total);
  return after === plan.total
    ? `Invoice ${plan.invoiceNo} kept its total ${after.toLocaleString("en-US")}.`
    : `Invoice ${plan.invoiceNo} re-priced: ${plan.total.toLocaleString("en-US")} → ${after.toLocaleString("en-US")}.`;
}
