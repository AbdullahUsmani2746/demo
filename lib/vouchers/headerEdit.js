// lib/vouchers/headerEdit.js — header details that may change on a GRN /
// dispatch / return AFTER it is invoiced, without unlocking the invoice.
// Pure (client + server). Only plain paper / logistics text that no stock,
// ledger, tax, BOM, packing or service posting reads: never the date, party,
// godown, items, quantities, invoice no, the transporter account (dispatch
// rmk2) or the legacy / system markers (rmk1, rmk5).
//
// manual_no is always editable this way (the list's Manual No cell); the other
// fields only while Settings → Features → "Edit header details on invoiced
// documents" (HEADER_EDIT_FEATURE) is on. The one writer is
// lib/vouchers/headerEditServer.js (same right as editing the document,
// document scope, period lock, never a system-posted voucher, audited).
// A field with `feature` exists only while that switch is on (the dispatch's
// Manual DC No / City / Route follow "dispatch.extraFields").
export const HEADER_EDIT_FEATURE = "documents.headerEdit";

const NARRATION = { name: "rmk", label: "Narration", type: "textarea", max: 1000 };
const VEHICLE = { name: "rmk4", label: "Vehicle No", upper: true, max: 100 };

/** Editable header fields per tran_code. */
export const HEADER_EDIT_FIELDS = {
  4: [{ name: "manual_no", label: "Manual GRN No", upper: true, max: 50 }, VEHICLE, { name: "rmk3", label: "Vendor DC / Challan No", max: 100 }, NARRATION],
  6: [
    { name: "manual_no", label: "Manual DC No", upper: true, max: 50, feature: "dispatch.extraFields" },
    VEHICLE,
    { name: "city", label: "City (Destination)", upper: true, max: 100, feature: "dispatch.extraFields" },
    { name: "route", label: "Route", upper: true, max: 150, wide: true, feature: "dispatch.extraFields" },
    NARRATION,
  ],
  9: [{ name: "rmk2", label: "Return DC / Challan No", max: 100 }, VEHICLE, NARRATION],
  10: [{ name: "manual_no", label: "Manual GRN No", upper: true, max: 50 }, VEHICLE, NARRATION],
};

export const headerEditFields = (tranCode) => HEADER_EDIT_FIELDS[Number(tranCode)] ?? [];

/** A typed value as it is stored: trimmed, upper-cased where the form does, capped; blank = null. */
export function cleanHeaderValue(field, raw) {
  let v = String(raw ?? "").trim();
  if (field.upper) v = v.toUpperCase();
  v = v.slice(0, field.max ?? 500);
  return v || null;
}
