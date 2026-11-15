// lib/grn/directRate.js
// ============================================================
// GRN direct rate — Settings → Features "grn.directRateByItem" (from Accounting).
//
// Items whose GRN rate is typed on the GRN instead of taken from the Purchase
// Order (e.g. wood, priced at receipt). Ticked per item (Item.grn_direct_rate)
// or per item category (ItemCategory.grn_direct_rate) — either is enough.
//
// A GRN stays a physical, quantity-only document (no amounts, no ledger rows):
// the typed rate is kept on the line's `rate` and Purchase Invoicing proposes
// it as the "saved" rate (lib/invoicing/rates.js) instead of the PO rate. An
// empty / 0 rate falls back to the PO rate there, as before.
//
//   grnDirectRateItems(itcds)          Set of itcds that take the GRN rate
//   markGrnDirectRates(lines, opts)    flags lines whose typed rate is kept
//                                      (line.__directRate) — read by the voucher
//                                      route's mapLine; dropped by its field filter
// ============================================================
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";

export const GRN_DIRECT_RATE_FEATURE = "grn.directRateByItem";

const itcdOf = (l) => {
  const n = parseInt(l?.itcd?.value ?? l?.itcd, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Set of itcds (from the given list) whose rate is typed on the GRN. */
export async function grnDirectRateItems(itcds) {
  const ids = [...new Set((itcds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return new Set();
  const rows = await prisma.item.findMany({
    where: {
      itcd: { in: ids },
      OR: [{ grn_direct_rate: true }, { itemCategories: { grn_direct_rate: true } }],
    },
    select: { itcd: true },
  });
  return new Set(rows.map((r) => Number(r.itcd)));
}

/**
 * Mark the GRN lines whose typed rate is kept (line.__directRate = true).
 *   feature on  → lines of ticked items keep the rate typed on the line
 *   feature off → nothing new is typed; on an edit (storedTranId) a line keeps
 *                 the rate its item already had on this GRN (switching off
 *                 never deletes data) — taken from the database, not the request
 */
export async function markGrnDirectRates(lines, { tranCode, storedTranId = null } = {}) {
  if (Number(tranCode) !== 4 || !Array.isArray(lines) || !lines.length) return lines;
  if (await feature(GRN_DIRECT_RATE_FEATURE)) {
    const direct = await grnDirectRateItems(lines.map(itcdOf));
    for (const l of lines) {
      const rate = Number(l?.rate);
      if (direct.has(itcdOf(l)) && Number.isFinite(rate) && rate > 0) l.__directRate = true;
    }
    return lines;
  }
  if (!storedTranId) return lines;
  const stored = await prisma.transactions.findMany({
    where: { tran_id: Number(storedTranId), sub_tran_id: 1, rate: { gt: 0 }, itcd: { not: null } },
    select: { itcd: true, rate: true },
  });
  const keep = new Map(stored.map((s) => [Number(s.itcd), Number(s.rate)]));
  for (const l of lines) {
    const rate = keep.get(itcdOf(l));
    if (rate) {
      l.rate = rate;
      l.__directRate = true;
    }
  }
  return lines;
}
