// lib/ledger/autoEntryAccounts.js
// ============================================================
// SERVER ONLY — resolves the ledger accounts the sub_tran_id=3 auto entries
// post to. Nothing here is a hard-coded account any more: sales tax comes from
// each item's category (→ Account Settings default), freight from Finance →
// Account Settings, the transporter from the document itself.
//
// These used to be constants typed into each writer; when the sales-tax
// account moved (commit ca1bf49f, 2026-08-31) only the voucher route was
// updated, and Dispatch Invoicing kept crediting a closed customer account.
// Every writer now resolves through here, BEFORE it writes anything.
//
// Used by:
//   app/api/voucher/[type]/route.js        buildAutoEntries()
//   lib/dispatchInvoicing/applyPricing.js  buildDispatchAutoEntries() (core.js)
//   (app/api/voucher/fix-dispatch-rates is retired — Invoicing posts sales)
// ============================================================
import prisma from "@/lib/prisma";
import { requireAccount, getAccount } from "@/lib/accounts/accountSettings";
import { resolveItemAccounts, buildTaxEntries } from "@/lib/accounts/itemAccounts";

/** Freight account per document type: 4 GRN / purchase inward, 6 dispatch / sale outward. */
const FREIGHT_KEY = { 4: "freight_inward", 6: "freight_outward" };
// Off: freight is billed through Service Invoices (see resolveTransportAccounts).
const POST_TRANSPORT_FROM_DOCUMENTS = false;

/** Which tax setting a tran_code's ST row falls back to, and which side it sits on. */
export const TAX_RULE = {
  4: { key: "sales_tax_input", side: "Dr" },   // input tax claimed on a purchase
  9: { key: "sales_tax_input", side: "Cr" },   // ... reversed on a purchase return
  6: { key: "sales_tax_output", side: "Cr" },  // output tax charged on a sale
  10: { key: "sales_tax_output", side: "Dr" }, // ... reversed on a sale return
};

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const itcdOf = (line) => {
  const v = Number(line?.itcd?.value ?? line?.itcd);
  return Number.isInteger(v) && v > 0 ? v : null;
};

/**
 * Transport pair accounts for a document carrying transport charges, or null
 * when it carries none (no transporter or no amount).
 *   freightAcno      freight_inward (4) / freight_outward (6) — required (422)
 *   transporterAcno  rmk2, which must be an existing account (400 otherwise)
 */
export async function resolveTransportAccounts(tran_code, rmk2, trAmount, { db = prisma } = {}) {
  // Freight, off-loading and weighing are billed as Service Invoices linked to
  // the GRN / dispatch / sale return (lib/service/serviceInvoice.js, decided
  // 2026-10-25). A document no longer posts its own transport pair — posting
  // both would count the freight twice.
  if (POST_TRANSPORT_FROM_DOCUMENTS !== true) return null;
  const key = FREIGHT_KEY[Number(tran_code)];
  const raw = rmk2?.value ?? rmk2;
  if (!key || raw == null || String(raw).trim() === "" || !Number(trAmount)) return null;

  const transporterAcno = Number(raw);
  const account = Number.isInteger(transporterAcno)
    ? await db.aCNO.findUnique({ where: { acno: transporterAcno }, select: { acno: true } })
    : null;
  if (!account) {
    throw httpError(`Transporter account "${raw}" does not exist — pick the transporter again.`, 400);
  }
  return { freightAcno: await requireAccount(key), transporterAcno };
}

/** The two transport auto entries: freight Dr, transporter Cr. */
export function buildTransportEntries(tran_id, transport, trAmount) {
  if (!transport) return [];
  const amount = Number(trAmount) || 0;
  return [
    { tran_id, sub_tran_id: 3, narration1: "Transport Auto Entry", damt: amount, camt: 0, acno: transport.freightAcno },
    { tran_id, sub_tran_id: 3, narration1: "Transport Auto Entry", damt: 0, camt: amount, acno: transport.transporterAcno },
  ];
}

/**
 * Tax accounts for every taxed line, checked up front so the ST rows always
 * carry the whole tax the party row includes. Lines without an item use the
 * Account Settings default; a taxed line with no account at all refuses (422).
 * @returns {Promise<{ taxAcno: Record<number, number>, defaultTaxAcno: number|null }>}
 */
export async function resolveTaxAccounts(lines, tran_code, { db = prisma, taxAcno } = {}) {
  const rule = TAX_RULE[Number(tran_code)];
  if (!rule) return { taxAcno: {}, defaultTaxAcno: null };

  const resolved = taxAcno ?? (await resolveItemAccounts(lines, tran_code, { db })).taxAcno;
  const taxed = (lines || []).filter((l) => parseFloat(l?.st_amount) || 0);
  const needsDefault = taxed.some((l) => resolved[itcdOf(l)] == null);
  const defaultTaxAcno = needsDefault ? await requireAccount(rule.key) : await getAccount(rule.key);
  return { taxAcno: resolved, defaultTaxAcno };
}

/** ST rows for `lines`, grouped per tax account, on the tran_code's side. */
export function buildTaxEntriesFor(lines, tran_code, tran_id, { taxAcno, defaultTaxAcno }) {
  const rule = TAX_RULE[Number(tran_code)];
  if (!rule) return [];
  return buildTaxEntries(lines, taxAcno, rule.side, { tran_id, defaultTaxAcno });
}

/**
 * Everything buildDispatchAutoEntries() (lib/dispatchInvoicing/core.js) needs
 * for an invoiced dispatch, resolved from `priced.lines` (priceDispatch):
 *   { taxEntries: [{ acno, amount }], transport: { freightAcno, transporterAcno } | null }
 */
export async function resolveDispatchAutoAccounts(master, pricedLines, { db = prisma } = {}) {
  const tax = await resolveTaxAccounts(pricedLines, 6, { db });
  const taxEntries = buildTaxEntriesFor(pricedLines, 6, null, tax).map((r) => ({
    acno: r.acno,
    amount: r.camt,
  }));
  const transport = await resolveTransportAccounts(6, master.rmk2, master.tr_amount, { db });
  return { taxEntries, transport };
}

/**
 * Output-tax accounts a dispatch's lines should credit — what
 * savedInvoicePricing() checks the stored ST rows against. Read-only: returns
 * null (skip the check) instead of throwing when accounts are not set up.
 */
export async function expectedOutputTaxAccounts(lines, { db = prisma } = {}) {
  try {
    const { taxAcno, defaultTaxAcno } = await resolveTaxAccounts(lines, 6, { db });
    const out = new Set(Object.values(taxAcno));
    if (defaultTaxAcno != null) out.add(defaultTaxAcno);
    return [...out];
  } catch {
    return null;
  }
}
