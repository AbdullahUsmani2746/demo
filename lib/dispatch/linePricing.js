// lib/dispatch/linePricing.js
// ============================================================
// The rate / GST % a dispatch line carries until it is invoiced.
//
//   default  = the linked Sale Order's line (rate, st_rate)
//              else the customer's price list (SALES_ITEM_CUST: rate, gst_rate,
//              latest by date)
//   override = whatever the user typed — kept only for holders of
//              `dispatch.rate.override`; anyone else gets the default back
//              (with a warning), so a price cannot be changed by editing the
//              request.
//
// Since 2026-10-25 a dispatch is saved with QUANTITY ONLY: the voucher route no
// longer calls applyDispatchRates. defaultDispatchRates / customerPriceLists
// are the DEFAULT rates Invoicing (lib/invoicing/rates.js) proposes for a
// pending dispatch; the user can change them there before generating.
// ============================================================
import prisma from "@/lib/prisma";
import { can } from "@/lib/auth/permissions";

export const RATE_OVERRIDE_PERMISSION = "dispatch.rate.override";

const intOf = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v?.value ?? v);
  return Number.isFinite(n) ? n : null;
};
const differs = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) > 0.00005;

/**
 * Customer price list: Map<itcd, { rate, st_rate }> — the latest entry per item.
 */
export async function customerPriceList(acno, itcds, { db = prisma } = {}) {
  const ids = [...new Set((itcds || []).map(intOf).filter(Boolean))];
  const customer = intOf(acno);
  const out = new Map();
  if (!customer || !ids.length) return out;
  // Latest priced row per item. Undated rows sort last (Postgres puts NULLs
  // first in DESC), and a 0 rate is skipped — the same rule priceDispatch()
  // uses at invoicing, so save and invoice never disagree.
  const rows = await db.sALES_ITEM_CUST.findMany({
    where: { acno: customer, itcd: { in: ids }, rate: { gt: 0 } },
    orderBy: [{ dated: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    select: { itcd: true, rate: true, gst_rate: true },
  });
  for (const r of rows) {
    if (!out.has(r.itcd)) out.set(r.itcd, { rate: Number(r.rate) || 0, st_rate: Number(r.gst_rate) || 0 });
  }
  return out;
}

/**
 * Price lists of SEVERAL customers in one query (the invoicing list prices a
 * whole page of dispatches at once).
 * @returns Map<acno, Map<itcd, { rate, st_rate }>> — latest priced entry per item.
 */
export async function customerPriceLists(acnos, itcds, { db = prisma } = {}) {
  const customers = [...new Set((acnos || []).map(intOf).filter(Boolean))];
  const ids = [...new Set((itcds || []).map(intOf).filter(Boolean))];
  const out = new Map();
  if (!customers.length || !ids.length) return out;
  const rows = await db.sALES_ITEM_CUST.findMany({
    where: { acno: { in: customers }, itcd: { in: ids }, rate: { gt: 0 } },
    orderBy: [{ dated: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    select: { acno: true, itcd: true, rate: true, gst_rate: true },
  });
  for (const r of rows) {
    if (!out.has(r.acno)) out.set(r.acno, new Map());
    const list = out.get(r.acno);
    if (!list.has(r.itcd)) list.set(r.itcd, { rate: Number(r.rate) || 0, st_rate: Number(r.gst_rate) || 0 });
  }
  return out;
}

/** Default { rate, st_rate, source } per item: Sale Order line → price list. */
export async function defaultDispatchRates({ itcds, pycd, so_no, db = prisma }) {
  const out = new Map();
  const ids = [...new Set((itcds || []).map(intOf).filter(Boolean))];
  if (!ids.length) return out;

  const orderNo = intOf(so_no);
  if (orderNo) {
    const details = await db.orderDetail.findMany({
      where: { order_no: orderNo, itcd: { in: ids } },
      select: { itcd: true, rate: true, st_rate: true },
      orderBy: { id: "asc" },
    });
    for (const d of details) {
      if (!out.has(d.itcd) && Number(d.rate) > 0) {
        out.set(d.itcd, { rate: Number(d.rate), st_rate: Number(d.st_rate) || 0, source: "sale_order" });
      }
    }
  }

  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    const list = await customerPriceList(pycd, missing, { db });
    for (const [itcd, p] of list) {
      if (p.rate > 0) out.set(itcd, { ...p, source: "price_list" });
    }
  }
  return out;
}

/**
 * Stamp rate / st_rate / additional_tax on every dispatch line (amounts
 * zeroed) and enforce the override permission. Returns the lines plus
 * warnings for the user.
 *
 * `storedRates` (edit only): Map<itcd, { rate, st_rate, additional_tax }> of
 * what the dispatch already carries. Those values count as the default for
 * whoever edits it, so a store user correcting a qty does not silently undo a
 * rate a manager set — only a NEW change needs the permission.
 */
export async function applyDispatchRates(lines, { session, pycd, so_no, storedRates = null, db = prisma }) {
  const defaults = await defaultDispatchRates({ itcds: (lines || []).map((l) => l?.itcd), pycd, so_no, db });
  const mayOverride = await can(session, RATE_OVERRIDE_PERMISSION);
  const warnings = [];
  let reset = false;
  const unpriced = new Set();

  const out = (lines || []).map((line) => {
    const itcd = intOf(line?.itcd);
    const stored = itcd ? storedRates?.get(itcd) : null;
    const def = stored && Number(stored.rate) > 0
      ? { rate: Number(stored.rate), st_rate: Number(stored.st_rate) || 0, additional_tax: Number(stored.additional_tax) || 0 }
      : (itcd ? defaults.get(itcd) : null);
    const typedRate = numOrNull(line?.rate);
    const typedSt = numOrNull(line?.st_rate);
    const typedAddl = numOrNull(line?.additional_tax);

    let rate = def?.rate ?? 0;
    let st_rate = def?.st_rate ?? 0;
    // Further tax on top of GST is part of the price too: same rule.
    let additional_tax = def?.additional_tax ?? 0;
    const changed =
      (typedRate != null && differs(typedRate, rate)) ||
      (typedSt != null && differs(typedSt, st_rate)) ||
      (typedAddl != null && differs(typedAddl, additional_tax));
    if (changed) {
      if (mayOverride) {
        if (typedRate != null) rate = typedRate;
        if (typedSt != null) st_rate = typedSt;
        if (typedAddl != null) additional_tax = typedAddl;
      } else {
        reset = true;
      }
    }
    if (itcd && !(rate > 0)) unpriced.add(itcd);

    return { ...line, rate, st_rate, additional_tax, gross_amount: 0, st_amount: 0, damt: 0, camt: 0 };
  });

  if (reset) {
    warnings.push("Rates you changed were reset to the Sale Order / customer price list — changing dispatch rates needs the 'Override dispatch rate' permission.");
  }
  if (unpriced.size) {
    warnings.push(`No rate for ${unpriced.size} item(s) on this dispatch — add them to the customer's price list (or enter a rate) before invoicing.`);
  }
  return { lines: out, warnings };
}
