// lib/invoicing/kinds.js
// ============================================================
// INVOICING — the four kinds of document that are priced after the fact.
// (Client-safe: no Prisma here.)
//
// Physical documents carry QUANTITY ONLY (decided 2026-10-25): a GRN, a GRN /
// purchase return, a dispatch and a dispatch / sale return are saved without
// rate, amount or ledger rows. Invoicing later prices the SAME document:
// rate / st_rate / gross_amount / st_amount / damt|camt on its sub_tran_id=1
// lines, the sub_tran_id=3 auto entries rebuilt, and an invoice number stamped.
//
//   kind              tran  line side  party            tax row
//   sale              6     camt       Dr goods + tax   output tax Cr
//   sale-return       10    damt       Cr goods + tax   output tax Dr
//   purchase          4     damt       Cr goods + tax   input tax Dr
//   purchase-return   9     camt       Dr goods + tax   input tax Cr
//
// Tax sides come from TAX_RULE (lib/ledger/autoEntryAccounts.js); they agree
// with this table.
// ============================================================

export const INVOICE_KINDS = {
  sale: {
    kind: "sale",
    // Lines may be billed per LTR (KG ÷ density) on the invoice — lib/invoicing/core.js.
    unitSwitch: true,
    tran_code: 6,
    label: "Sale Invoice",
    docLabel: "Dispatch",
    docNoField: "dispatch_no",
    lineSide: "camt",
    partySide: "Dr",
    partyLabel: "Customer",
    purchaseSide: false,
  },
  "sale-return": {
    kind: "sale-return",
    tran_code: 10,
    label: "Sale Return Invoice",
    docLabel: "Return",
    docNoField: "vr_no",
    lineSide: "damt",
    partySide: "Cr",
    partyLabel: "Customer",
    purchaseSide: false,
  },
  purchase: {
    kind: "purchase",
    // Lines may be billed per LTR (KG ÷ density) on the invoice — lib/invoicing/core.js.
    unitSwitch: true,
    tran_code: 4,
    label: "Purchase Invoice",
    docLabel: "GRN",
    docNoField: "grn_no",
    lineSide: "damt",
    partySide: "Cr",
    partyLabel: "Vendor",
    purchaseSide: true,
  },
  "purchase-return": {
    kind: "purchase-return",
    tran_code: 9,
    label: "Purchase Return Invoice",
    docLabel: "Return",
    docNoField: "vr_no",
    lineSide: "camt",
    partySide: "Dr",
    partyLabel: "Vendor",
    purchaseSide: true,
  },
};

export const INVOICE_KIND_NAMES = Object.keys(INVOICE_KINDS);

export const kindConfig = (kind) => INVOICE_KINDS[kind] ?? null;

export const kindForTranCode = (tran_code) =>
  Object.values(INVOICE_KINDS).find((k) => k.tran_code === Number(tran_code)) ?? null;

/** Permission codes: invoicing.<kind>.view | .generate | .unlock */
export const invoicingPermission = (kind, action) => `invoicing.${kind}.${action}`;

/** Imported history: invoice_series 'L'. Counts as invoiced, stays locked. */
export const LEGACY_SERIES = "L";

/** A document is invoiced when it has an invoice number, or is legacy history. */
export function isInvoicedMaster(master) {
  if (!master) return false;
  if (master.invoice_series === LEGACY_SERIES) return true;
  return String(master.invoice_no ?? "").trim() !== "";
}

/** "Dispatch 123" / "GRN 4455" / "Return 17". */
export function docNoOf(master, kind) {
  const cfg = kindConfig(kind);
  const own = cfg ? master?.[cfg.docNoField] : null;
  // A trial billing part of a dispatch: "1234-2" (lib/dispatch/trialBilling.js)
  if (own != null && cfg?.docNoField === "dispatch_no" && Number(master?.dispatch_part) > 1) {
    return `${own}-${master.dispatch_part}`;
  }
  return own ?? master?.vr_no ?? master?.tran_id ?? null;
}

export function docLabelOf(master, kind) {
  const cfg = kindConfig(kind);
  return `${cfg?.docLabel ?? "Document"} ${docNoOf(master, kind) ?? ""}`.trim();
}
