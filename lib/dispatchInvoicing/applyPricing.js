// lib/dispatchInvoicing/applyPricing.js
// ============================================================
// SERVER ONLY — writes a dispatch's pricing to the database.
// (core.js is also imported by the invoicing page, so no Prisma there.)
//
// SUPERSEDED 2026-10-25: invoices are written by lib/invoicing/core.js
// (Invoicing). Nothing in the app calls these any more — the voucher route no
// longer re-prices an edited dispatch (an invoiced dispatch cannot be edited
// until it is unlocked) and /api/dispatch-invoicing/** delegates to Invoicing.
// Kept only so old scripts importing it still resolve.
//
// Before this, editing an invoiced dispatch from the entry screen re-saved
// its lines through the deferred-pricing path, which zeroes every rate and
// drops the auto entries — leaving an invoice number on a dispatch with no
// rate, no amount and nothing in the ledger.
// ============================================================
import { Prisma } from "@prisma/client";
import { priceDispatch, buildDispatchAutoEntries } from "@/lib/dispatchInvoicing/core";
import { resolveDispatchAutoAccounts } from "@/lib/ledger/autoEntryAccounts";

/** The customer's price list as priceDispatch() reads it (latest first). */
export const PRICE_LIST_SELECT = {
  select: { itcd: true, rate: true, gst_rate: true },
  orderBy: [{ dated: { sort: "desc", nulls: "last" } }, { id: "desc" }],
};

/** What priceDispatch() needs loaded on a TransactionsMaster. */
export const DISPATCH_INCLUDE = {
  acno: {
    select: {
      acno: true, acname: true, isActive: true, lock: true,
      mainAccount: { select: { isActive: true } },
      // Customer price list — the last rate source in priceDispatch().
      salesItemCust: PRICE_LIST_SELECT,
    },
  },
  ordersSO: {
    select: {
      order_no: true,
      freeOfCost: true,
      orderDetails: { select: { itcd: true, rate: true, st_rate: true, unit: true } },
    },
  },
  transactions: {
    where: { sub_tran_id: 1 },
    select: {
      id: true,
      itcd: true,
      qty: true,     // KG — the stock movement
      qty_ltr: true, // litres — what a LTR line is priced on
      rate: true,
      st_rate: true,
      additional_tax: true,
      unit: true,
      batch_no: true,
      no_of_pack: true,
      qty_per_pack: true,
      sub_tran_id: true,
      itemDetails: { select: { item: true, code: true, unit: true } },
    },
  },
};

/**
 * Write `priced` (from priceDispatch) onto the dispatch inside `tx`:
 *   1. rate / st_rate / amounts on every priced item line
 *   2. the sub_tran_id=3 auto entries rebuilt from the priced totals
 */
export async function writeDispatchPricing(tx, master, priced, resolved = null) {
  // Raw UPDATE ... FROM (VALUES ...) rather than a loop of
  // tx.transactions.update(): the Prisma client extension in lib/prisma.js
  // wraps every `update` with a before-state findUnique plus an audit-log
  // insert, which on a bulk run would be hundreds of extra round-trips inside
  // the transaction. createMany/deleteMany are unaffected and still audited.
  if (priced.lines.length > 0) {
    const lineValues = priced.lines.map(
      (l) => Prisma.sql`(
        ${l.line_id}::int,
        ${l.rate}::double precision,
        ${l.st_rate}::double precision,
        ${l.gross_amount}::double precision,
        ${l.st_amount}::double precision
      )`,
    );

    await tx.$executeRaw`
      UPDATE "Transactions" AS t
      SET rate         = v.rate,
          st_rate      = v.st_rate,
          gross_amount = v.gross_amount,
          st_amount    = v.st_amount,
          camt         = v.gross_amount,
          damt         = 0
      FROM (VALUES ${Prisma.join(lineValues)})
        AS v(id, rate, st_rate, gross_amount, st_amount)
      WHERE t.id = v.id
    `;
  }

  // Tax / freight / transporter accounts come from Account Settings (and the
  // items' categories). Callers that resolved them up front (the invoicing
  // batch) pass them in; otherwise they are resolved here, before the old rows
  // go, so a missing account (422) rolls the edit back instead of leaving the
  // dispatch without entries.
  const accounts = resolved ?? (await resolveDispatchAutoAccounts(master, priced.lines, { db: tx }));
  await tx.transactions.deleteMany({
    where: { tran_id: master.tran_id, sub_tran_id: 3 },
  });
  await tx.transactions.createMany({
    data: buildDispatchAutoEntries(master.tran_id, master, priced.totals, accounts),
  });
}

/**
 * Re-price an already-invoiced dispatch from its Sale Order, inside `tx`,
 * after its lines were rewritten. Keeps the invoice number.
 * Throws (rolling the edit back) when it can no longer be priced.
 * @returns the priceDispatch() result
 */
export async function repriceInvoicedDispatch(tx, tran_id) {
  const master = await tx.transactionsMaster.findUnique({
    where: { tran_id: Number(tran_id) },
    include: DISPATCH_INCLUDE,
  });
  if (!master) throw new Error("Dispatch not found while re-pricing");

  const priced = priceDispatch(master);
  if (!priced.canInvoice) {
    const reason = priced.issues[0]?.message || "it cannot be priced from its Sale Order";
    const err = new Error(
      `This dispatch is invoiced as ${master.invoice_no}, ` +
      `so it must stay priced — but after this change ${reason}. Nothing was saved.`,
    );
    err.status = 422;
    throw err;
  }

  await writeDispatchPricing(tx, master, priced);
  return priced;
}
