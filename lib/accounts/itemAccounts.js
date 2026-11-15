// lib/accounts/itemAccounts.js
// ============================================================
// Which ledger account an ITEM LINE posts to, and where its sales tax goes.
//
//   item's category column  →  Account Settings default  →  refused (422)
//
//   tran_code  line account                     tax account
//   4  GRN / Purchase     purchase_acno  / purchase          purchase_tax_acno / sales_tax_input
//   9  Purchase Return    purchase_return_acno / purchase_return   (same as 4)
//   6  Dispatch / Sale    sale_acno      / sales              sales_tax_acno    / sales_tax_output
//   6  Despatch Without Godown  nogodown_sale_acno / (no default)  (same as 6)
//   10 Sale Return        sale_return_acno / sales_return      (same as 6)
//   7  Material Issue     stock_acno     / stock              —
//   8  Production         stock_acno     / stock              —
//   11 Transfer           stock_acno     / stock              —
//   5  POS                pos_acno       / pos_sales          —
//
// Resolve BEFORE writing anything, so a missing account refuses the whole
// document instead of leaving half a voucher behind.
// ============================================================
import prisma from "@/lib/prisma";
import { getAllAccountSettings, accountSettingError } from "./accountSettings";
import { ACCOUNT_SETTING_BY_KEY } from "./accountSettingDefs";

const LINE_RULES = {
  4: { column: "purchase_acno", key: "purchase", taxColumn: "purchase_tax_acno", taxKey: "sales_tax_input" },
  9: { column: "purchase_return_acno", key: "purchase_return", taxColumn: "purchase_tax_acno", taxKey: "sales_tax_input" },
  6: { column: "sale_acno", key: "sales", taxColumn: "sales_tax_acno", taxKey: "sales_tax_output" },
  10: { column: "sale_return_acno", key: "sales_return", taxColumn: "sales_tax_acno", taxKey: "sales_tax_output" },
  7: { column: "stock_acno", key: "stock" },
  8: { column: "stock_acno", key: "stock" },
  11: { column: "stock_acno", key: "stock" },
  5: { column: "pos_acno", key: "pos_sales" },
};

// A dispatch of a "Despatch Without Godown" Sale Order credits the category's
// No Godown Sale Acno instead — no Account Settings fallback, so a category
// without one refuses the document (lib/dispatch/withoutGodown.js).
const NO_GODOWN_SALE_RULE = { ...LINE_RULES[6], column: "nogodown_sale_acno", key: null };

export const hasItemAccountRule = (tran_code) => Boolean(LINE_RULES[Number(tran_code)]);

const itcdOf = (line) => {
  const v = Number(line?.itcd?.value ?? line?.itcd);
  return Number.isInteger(v) && v > 0 ? v : null;
};

// Same parse as the voucher route's parseOptionalFloat (parseFloat, 0 when
// blank), so the party row and the tax rows always add up the same amounts.
const amountOf = (v) => parseFloat(v) || 0;

/**
 * Resolve line and tax accounts for every item on a document.
 * @returns {Promise<{ lineAcno: Record<number, number>, taxAcno: Record<number, number> }>}
 * @throws 422 Error when an item has neither a category account nor a default.
 */
export async function resolveItemAccounts(lines, tran_code, { db = prisma, requireTax = true, withoutGodown = false } = {}) {
  const rule = Number(tran_code) === 6 && withoutGodown ? NO_GODOWN_SALE_RULE : LINE_RULES[Number(tran_code)];
  const out = { lineAcno: {}, taxAcno: {} };
  if (!rule) return out;

  const itcds = [...new Set((lines || []).map(itcdOf).filter(Boolean))];
  if (!itcds.length) return out;

  const columns = { [rule.column]: true, ...(rule.taxColumn ? { [rule.taxColumn]: true } : {}) };
  const [items, settings] = await Promise.all([
    db.item.findMany({
      where: { itcd: { in: itcds } },
      select: { itcd: true, item: true, itemCategories: { select: { ic_name: true, ...columns } } },
    }),
    getAllAccountSettings(),
  ]);

  const fallback = rule.key ? settings[rule.key]?.acno ?? null : null;
  const taxFallback = rule.taxKey ? settings[rule.taxKey]?.acno ?? null : null;
  const missing = [];
  const missingTax = [];

  for (const item of items) {
    const cat = item.itemCategories || {};
    const acno = cat[rule.column] ?? fallback;
    if (acno == null) missing.push(rule.key ? item.item || item.itcd : cat.ic_name || "(no category)");
    else out.lineAcno[item.itcd] = Number(acno);

    if (rule.taxColumn) {
      const tax = cat[rule.taxColumn] ?? taxFallback;
      if (tax == null) missingTax.push(item.item || item.itcd);
      else out.taxAcno[item.itcd] = Number(tax);
    }
  }

  if (missing.length && !rule.key) {
    throw Object.assign(
      new Error(`This is a Despatch Without Godown Sale Order, but item category ${[...new Set(missing)].join(", ")} has no "No Godown Sale Acno". Set it in Setup → Item Categories.`),
      { statusCode: 422 },
    );
  }
  if (missing.length) {
    throw accountSettingError(rule.key, `(or give the item category a '${ACCOUNT_SETTING_BY_KEY[rule.key].label}' account) — items: ${missing.slice(0, 5).join(", ")}`);
  }
  // Tax is only needed when a line actually carries tax.
  if (requireTax && missingTax.length) {
    const taxed = new Set(
      (lines || []).filter((l) => amountOf(l?.st_amount)).map(itcdOf),
    );
    const blocking = items.filter((i) => taxed.has(i.itcd) && out.taxAcno[i.itcd] == null);
    if (blocking.length) throw accountSettingError(rule.taxKey);
  }
  return out;
}

/**
 * Sales-tax auto entries grouped by tax account.
 * side "Cr" (sale) puts tax in camt, "Dr" (purchase / sale return) in damt.
 * Lines without an item fall back to `defaultTaxAcno`.
 */
export function buildTaxEntries(lines, taxAcno, side, { tran_id, defaultTaxAcno = null, narration = "ST Auto Entry" } = {}) {
  const byAcno = new Map();
  for (const line of lines || []) {
    const st = amountOf(line?.st_amount);
    if (!st) continue;
    const acno = taxAcno[itcdOf(line)] ?? defaultTaxAcno;
    if (acno == null) continue;
    byAcno.set(acno, (byAcno.get(acno) || 0) + st);
  }
  return [...byAcno].map(([acno, amount]) => ({
    tran_id,
    sub_tran_id: 3,
    narration1: narration,
    acno,
    damt: side === "Dr" ? amount : 0,
    camt: side === "Cr" ? amount : 0,
  }));
}
