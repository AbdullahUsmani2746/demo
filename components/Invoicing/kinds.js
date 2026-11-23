// components/Invoicing/kinds.js
// Client-side description of the four Invoicing screens. The server's own
// definition (tran_codes, accounts, numbering) is lib/invoicing/kinds.js —
// this only holds what the page shows. Every kind-specific word on the screen
// (Dispatch / GRN / Return, Customer / Vendor, Sale Invoice / Credit Note …)
// comes from here, never from the components.
import {
  CUSTOMER_GROUP_PARAM,
} from "@/lib/accounts/groupParams";

// Vendors on a GRN may sit in any of these groups (see the GRN Vendor field).
const GRN_PARTY_PARAM = "group=customers,vendors,lc_accounts,beneficiaries";

export const INVOICING_KINDS = {
  sale: {
    // tran_code of the document (lib/invoicing/kinds.js) — the "Open" link.
    tranCode: 6,
    title: "Sale Invoicing",
    subtitle: "Price dispatches and post the sale invoice",
    docNoun: "dispatch",
    docNounPlural: "dispatches",
    // Short / long label on the document's own number chip.
    docChip: "DSP",
    docChipLong: "DISPATCH",
    partyLabel: "Customer",
    partyEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
    // The document's own number — not repeated as a reference chip.
    ownRef: "dispatch_no",
    vendorBill: false,
    // What the posting is called, and the chip on its number.
    invoiceNoun: "Sale Invoice",
    invoiceNounPlural: "Sale Invoices",
    invoiceChip: "INV",
    icon: "sale",
  },
  "sale-return": {
    // tran_code of the document (lib/invoicing/kinds.js) — the "Open" link.
    tranCode: 10,
    title: "Sale Return Invoicing",
    subtitle: "Price dispatch returns and post the customer's credit",
    docNoun: "dispatch return",
    docNounPlural: "dispatch returns",
    docChip: "RET",
    docChipLong: "DISPATCH RETURN",
    partyLabel: "Customer",
    partyEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
    ownRef: null,
    vendorBill: false,
    invoiceNoun: "Credit Note",
    invoiceNounPlural: "Credit Notes",
    invoiceChip: "CN",
    icon: "sale-return",
  },
  purchase: {
    // tran_code of the document (lib/invoicing/kinds.js) — the "Open" link.
    tranCode: 4,
    title: "Purchase Invoicing",
    subtitle: "Price GRNs and post the vendor's bill",
    docNoun: "GRN",
    docNounPlural: "GRNs",
    docChip: "GRN",
    docChipLong: "GRN",
    partyLabel: "Vendor",
    partyEndpoint: `/api/accounts/acno?${GRN_PARTY_PARAM}`,
    ownRef: "grn_no",
    vendorBill: true,
    invoiceNoun: "Purchase Invoice",
    invoiceNounPlural: "Purchase Invoices",
    invoiceChip: "PI",
    icon: "purchase",
  },
  "purchase-return": {
    // tran_code of the document (lib/invoicing/kinds.js) — the "Open" link.
    tranCode: 9,
    title: "Purchase Return Invoicing",
    subtitle: "Price GRN returns and post the debit to the vendor",
    docNoun: "GRN return",
    docNounPlural: "GRN returns",
    docChip: "RET",
    docChipLong: "GRN RETURN",
    partyLabel: "Vendor",
    partyEndpoint: `/api/accounts/acno?${GRN_PARTY_PARAM}`,
    ownRef: null,
    vendorBill: true,
    invoiceNoun: "Debit Note",
    invoiceNounPlural: "Debit Notes",
    invoiceChip: "DN",
    icon: "purchase-return",
  },
};

export const INVOICING_KIND_KEYS = Object.keys(INVOICING_KINDS);

// Reference numbers a row may carry: [key, short label, long label, chip tone].
export const REF_LABELS = [
  ["so_no", "SO", "SALE ORDER", "order"],
  ["po_no", "PO", "PURCHASE ORDER", "order"],
  ["dispatch_no", "DSP", "DISPATCH", "source"],
  ["grn_no", "GRN", "GRN", "source"],
  // The user's paper-book numbers (TransactionsMaster.manual_no).
  ["manual_dc", "MDC", "MANUAL DC NO", "source"],
  ["manual_grn", "MGRN", "MANUAL GRN NO", "source"],
];

// Where a suggested rate came from (Line.rate_source).
export const RATE_SOURCES = {
  saved: { label: "Saved", tone: "slate" },
  order: { label: "Order", tone: "blue" },
  price_list: { label: "Price list", tone: "violet" },
  last_purchase: { label: "Last purchase", tone: "teal" },
  original: { label: "Original", tone: "amber" },
  none: { label: "No rate", tone: "red" },
  edited: { label: "Edited", tone: "primary" },
  // A dispatch line sent on Trial / Rate Negotiation (Features: orders.trialLineBilling)
  trial: { label: "On trial · 0", tone: "amber" },
};
