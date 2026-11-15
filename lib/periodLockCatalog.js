// lib/periodLockCatalog.js
// ============================================================
// Every document type a period lock can cover, grouped for the UI.
// Client-safe (no prisma) — used by lib/periodLock.js on the server and by
// the Period Lock page for its document-type pickers.
//
// When you add a voucher type to VOUCHER_CONFIG, add its tran_code here,
// otherwise routes calling checkPeriodLock silently get "not locked" back.
// ============================================================

export const LOCKABLE_DOCUMENTS = [
  { group: "Cash, bank & ledger", items: [
    { code: 1, label: "Receipt" },
    { code: 2, label: "Payment" },
    { code: 3, label: "Journal Voucher" },
    { code: 19, label: "Debit Note" },
    { code: 20, label: "Credit Note / Service Entry" },
    { code: 21, label: "Service Invoice" },
  ] },
  { group: "Stock", items: [
    { code: 4, label: "Purchase / GRN" },
    { code: 5, label: "POS" },
    { code: 6, label: "Sale / Dispatch" },
    { code: 7, label: "Material Issue" },
    { code: 8, label: "Production" },
    { code: 9, label: "Purchase Return" },
    { code: 10, label: "Sale Return" },
    { code: 11, label: "Stock Transfer" },
    { code: 12, label: "Miscellaneous IN" },
    { code: 14, label: "Fixed Assets GRN" },
  ] },
  { group: "Fixed assets", items: [
    { code: 15, label: "Fixed Asset Disposal" },
    { code: 16, label: "Fixed Asset Relocation" },
  ] },
  { group: "Orders & requisitions", items: [
    { code: 400, label: "Purchase Order" },
    { code: 500, label: "Service Order" },
    { code: 600, label: "Sale Order" },
    { code: 1000, label: "Requisition" },
  ] },
];

export const LOCKABLE_CODES = LOCKABLE_DOCUMENTS.flatMap((g) => g.items.map((i) => i.code));

const LABELS = new Map(LOCKABLE_DOCUMENTS.flatMap((g) => g.items.map((i) => [i.code, i.label])));
export const documentLabel = (code) => LABELS.get(Number(code)) ?? `Type ${code}`;

/** "All documents" for an empty list, else the labels joined. */
export const documentsSummary = (codes) =>
  !codes?.length ? "All documents" : codes.map(documentLabel).join(", ");

export const LOCK_ACTIONS = [
  { key: "create", label: "Create", field: "can_create" },
  { key: "update", label: "Edit", field: "can_update" },
  { key: "delete", label: "Delete", field: "can_delete" },
];

// ── Input parsing shared by the period-lock APIs ────────────────────────────

/** "YYYY-MM-DD" → {year, month, day}, or null if malformed / not a real date. */
export function parseDay(value) {
  const m = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Optional tran_code list → sorted unique ints ([] = all), or null if any is unknown. */
export function parseTranCodes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const codes = [...new Set(value.map(Number))];
  if (codes.some((c) => !LOCKABLE_CODES.includes(c))) return null;
  return codes.sort((a, b) => a - b);
}
