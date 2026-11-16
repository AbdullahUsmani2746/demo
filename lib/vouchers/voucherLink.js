// lib/vouchers/voucherLink.js — "open this voucher" links (the drill trail).
//
// A report row that comes from a voucher carries tran_id + tran_code; the
// link opens that voucher's list page (app/(pages)/accounting/[category]/[type],
// the same page the menu opens) with ?view=<tran_id>, and the list
// (components/Category/Table.jsx) opens its read-only view window on it —
// fetched by id, so it need not be on the list's page or in its date range.
// Edit / print / delete stay exactly as on the list (period lock, approval
// rules, system vouchers — CLAUDE.md rules 1 and 13).
//
// Pure data + helpers, no imports — usable from client and server.
// Each `type` below is a VOUCHER_CONFIG key (components/Category/constants.js)
// and a CONFIG entry of the [category]/[type] page. When a tran_code gets a
// new list page, add it here.

// type → URL category of its list page (/accounting/<category>/<type>).
const TYPE_CATEGORY = {
  payment: "voucher",
  receipt: "voucher",
  journal: "voucher",
  purchase: "invoice",
  sale: "invoice",
  serviceInvoice: "report",
  debit: "invoice",
  credit: "invoice",
  purchaseReturn: "return",
  saleReturn: "return",
  grnReturn: "return",
  dispatchReturn: "return",
  transfer: "godown",
  transferEdit: "godown",
  grn: "report",
  grnEdit: "report",
  exbond: "report",
  exbondEdit: "report",
  fixedAssetsGrn: "report",
  fixedAssetRelocation: "report",
  fixedAssetDisposal: "report",
  serviceEntry: "report",
  dispatch: "report",
  dispatchEdit: "report",
  purchaseOrderEdit: "order",
  saleOrder: "order",
  serviceOrder: "order",
  materialIssue: "production",
  materialInput: "production",
  materialIssueLanded: "production",
};

// tran_code → the page that lists those documents, and its name.
// Where one tran_code has several pages, `pick(row)` chooses from the row.
// Orders (400 / 500 / 600) are OrderMaster rows: their "tran_id" is order_no.
// POS receipts (5, and the POS returns among 12 — invoice RET-…) open on the
// till's receipt view (/pos/orders/<tran_id>: reprint, refund) — `href`.
// Not linkable (no list page of their own): 12 Miscellaneous IN,
// 1000 requisitions / production plans (separate API, one page per category).
const TRAN_CODE_PAGE = {
  1: { type: "receipt", label: "Receipt Voucher" },
  2: { type: "payment", label: "Payment Voucher" },
  3: { type: "journal", label: "Journal Voucher" },
  4: { type: "grn", label: "GRN" },
  5: { label: "POS Receipt", href: (id) => `/pos/orders/${id}` },
  6: { type: "dispatchEdit", label: "Dispatch Note" },
  7: {
    type: "materialIssue",
    label: "Material Consumption",
    // Landed-cost issues are flagged rmk1 = "Yes" (their own screen).
    pick: (row) =>
      row.rmk1 === "Yes"
        ? { type: "materialIssueLanded", label: "Material Issue for Landed Cost" }
        : null,
  },
  8: { type: "materialInput", label: "Material Input" },
  9: { type: "grnReturn", label: "GRN Return" },
  10: { type: "saleReturn", label: "Dispatch Return" },
  11: { type: "transfer", label: "Godown Transfer" },
  12: {
    label: "Miscellaneous IN",
    // A POS return (lib/pos/posting.js) is numbered RET-n; other 12s have no page.
    pick: (row) => (/^RET-\d+$/.test(String(row.invoice_no || "")) ? { label: "POS Return", href: (id) => `/pos/orders/${id}` } : null),
  },
  14: { type: "fixedAssetsGrn", label: "Fixed Assets GRN" },
  15: { type: "fixedAssetDisposal", label: "Fixed Asset Disposal" },
  16: { type: "fixedAssetRelocation", label: "Fixed Asset Relocation" },
  19: { type: "debit", label: "Debit Note" },
  20: {
    type: "credit",
    label: "Credit Note",
    // Credit notes and service entries share tran_code 20; a service entry
    // carries its service order in service_id.
    pick: (row) =>
      row.service_id != null && row.service_id !== ""
        ? { type: "serviceEntry", label: "Service Entry" }
        : null,
  },
  21: { type: "serviceInvoice", label: "Service Invoice" },
  400: { type: "purchaseOrderEdit", label: "Purchase Order" },
  500: { type: "serviceOrder", label: "Service Order" },
  600: { type: "saleOrder", label: "Sale Order" },
};

const pageFor = (row) => {
  const page = TRAN_CODE_PAGE[Number(row.tran_code)];
  if (!page) return null;
  return (page.pick && page.pick(row)) || page;
};

/** The document's name for a tran_code ("Payment Voucher"), or null. */
export function voucherLabel(tran_code) {
  return TRAN_CODE_PAGE[Number(tran_code)]?.label ?? null;
}

/**
 * URL that opens one voucher read-only on its list page:
 *   /accounting/<category>/<type>?view=<tran_id>
 * Pass the report row as it is — extra fields refine the page where a
 * tran_code has several (rmk1 for tran_code 7, service_id for 20), and
 * `type` (a VOUCHER_CONFIG key with a list page) overrides the choice.
 * For orders (400 / 500 / 600) tran_id is the order_no (order_no accepted too).
 * Returns null when the tran_code has no list page or the id is missing.
 */
export function voucherHref({ tran_code, tran_id, ...extra } = {}) {
  const id = Number(tran_id ?? extra.order_no);
  if (!Number.isInteger(id) || id <= 0) return null;
  const page = pageFor({ tran_code, ...extra });
  if (!page) return null;
  if (page.href) return page.href(id);
  if (!page.type) return null;
  const type = extra.type && TYPE_CATEGORY[extra.type] ? extra.type : page.type;
  return `/accounting/${TYPE_CATEGORY[type]}/${type}?view=${id}`;
}
