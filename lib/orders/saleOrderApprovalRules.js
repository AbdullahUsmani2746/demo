/* ══════════════════════════════════════════════════════════════════════
   SALE ORDER — WHY AN ORDER NEEDS APPROVAL

   One list, used by the Sale Order form, the save route, the approval
   screen and the notifications. To add, remove or rename a reason, edit
   only this file. It has no imports so the browser can use it too.

   A Sale Order needing approval is saved at status 3 and cannot be
   dispatched until approved (see lib/orders/saleOrderApproval.js).
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Approval flags on the Sale Order. Any one set sends it for approval.
 *   key       — OrderMaster column (boolean)
 *   label     — shown on the form, approval screen and notifications
 *   orderType — one of the "Order Type" dropdown choices: these exclude each
 *               other (zero rates vs a typed rate), so only one can be set.
 *               Without it the flag is its own checkbox (combines with any).
 *   zeroRates — rates forced to 0 and locked
 *   ratesEditable — the (normally read-only) customer rate may be typed
 *   noGodown  — the order is saved without a godown
 *   withoutGodown — dispatched from WITHOUT_GODOWN_DISPATCH with no stock
 *               check, no packing / BOM, sale to the category's No Godown
 *               Sale Acno (lib/dispatch/withoutGodown.js)
 */
export const SO_APPROVAL_FLAGS = [
  { key: "freeOfCost", label: "Free of Cost", orderType: true, zeroRates: true },
  { key: "trialProcess", label: "Trial Process", orderType: true, zeroRates: true },
  { key: "rateUnderNegotiation", label: "Rate Under Negotiation", orderType: true, ratesEditable: true },
  { key: "dispatchWithoutGodown", label: "Despatch Without Godown", orderType: true, withoutGodown: true },
  { key: "noGodown", label: "No Godown", noGodown: true },
];

// ── "Order Type" dropdown ────────────────────────────────────────────────
export const SO_ORDER_TYPE_NORMAL = { value: "normal", label: "Normal" };

export const SO_ORDER_TYPE_OPTIONS = [
  SO_ORDER_TYPE_NORMAL,
  ...SO_APPROVAL_FLAGS.filter((f) => f.orderType).map((f) => ({ value: f.key, label: f.label })),
];

/** Dropdown option for a saved order (from its flags). */
export function orderTypeOf(order) {
  const f = SO_APPROVAL_FLAGS.find((x) => x.orderType && isOn(order?.[x.key]));
  return f ? { value: f.key, label: f.label } : SO_ORDER_TYPE_NORMAL;
}

/** Flags for a chosen dropdown value: that one on, the other types off. */
export function orderTypeFlags(value) {
  const v = value?.value ?? value;
  return Object.fromEntries(
    SO_APPROVAL_FLAGS.filter((f) => f.orderType).map((f) => [f.key, f.key === v]),
  );
}

// ── "No Godown" is an option in the Godown dropdown, not a checkbox ───────
export const NO_GODOWN_OPTION = { value: "NONE", label: "No Godown" };

const isNoGodownValue = (godown) => String(godown?.value ?? godown ?? "") === NO_GODOWN_OPTION.value;

// ── "Despatch Without Godown": always dispatched from this one godown ────
// The ONLY place its id is kept. SMS has no such godown yet: create one (e.g.
// "NO PROD DESP"), close it in Setup → Godowns so nothing else posts to it,
// and set its id here, e.g. { value: "6", label: "6 - NO PROD DESP" }.
// While value is null, a Despatch Without Godown order / dispatch is refused.
export const WITHOUT_GODOWN_DISPATCH = { value: null, label: "NO PROD DESP" };

export const withoutGodownConfigured = () => WITHOUT_GODOWN_DISPATCH.value != null;

export const WITHOUT_GODOWN_NOT_SET =
  "Despatch Without Godown is not set up yet: no godown is configured for it (WITHOUT_GODOWN_DISPATCH in lib/orders/saleOrderApprovalRules.js).";

/** Is this godown ({value} or id) the Despatch Without Godown godown? */
export const isWithoutGodownGodown = (godown) =>
  withoutGodownConfigured() &&
  String(godown?.value ?? godown ?? "") === String(WITHOUT_GODOWN_DISPATCH.value);

/** Invoiced without production — fixed godown, stock not checked. */
export const withoutGodownOn = (order) =>
  SO_APPROVAL_FLAGS.some((f) => f.withoutGodown && isOn(order?.[f.key]));

/** Flags that are their own checkbox (none today — kept for new reasons). */
export const SO_CHECKBOX_FLAGS = SO_APPROVAL_FLAGS.filter((f) => !f.orderType && !f.noGodown);

/**
 * Customer statuses (acno.customer_status) that always need approval,
 * whatever is ticked. Spelling variants are folded by customerCategory().
 */
export const SO_APPROVAL_CUSTOMER_STATUSES = {
  "BAD-DEBTS": "Customer Bad Debt",
  "BAD-PAYMENTS": "Customer Bad Payment",
};

const STATUS_ALIASES = {
  "BAD-DEBT": "BAD-DEBTS",
  "BAD DEBT": "BAD-DEBTS",
  "BAD DEBTS": "BAD-DEBTS",
  "BAD-PAYMENT": "BAD-PAYMENTS",
  "BAD PAYMENT": "BAD-PAYMENTS",
  "BAD PAYMENTS": "BAD-PAYMENTS",
};

export const customerCategory = (status) => {
  const s = String(status || "").trim().toUpperCase();
  return STATUS_ALIASES[s] || s;
};

const isOn = (v) => v === true || v === "true";

export const flagOn = (order, key) => isOn(order?.[key]);

/** Rates forced to 0 (Free of Cost / Trial). */
export const zeroRatesOn = (order) =>
  SO_APPROVAL_FLAGS.some((f) => f.zeroRates && flagOn(order, f.key));

/** The customer rate may be typed (Rate Under Negotiation). */
export const ratesEditableOn = (order) =>
  SO_APPROVAL_FLAGS.some((f) => f.ratesEditable && flagOn(order, f.key));

/** Saved without a godown — "No Godown" picked in the Godown dropdown. */
export const noGodownOn = (order) =>
  isNoGodownValue(order?.godown) ||
  SO_APPROVAL_FLAGS.some((f) => f.noGodown && flagOn(order, f.key));

/**
 * Every reason this order needs approval, as labels:
 *   ["Rate Under Negotiation", "Customer Bad Payment"].
 * Empty → no approval needed.
 */
export function approvalReasons(order, { customerStatus } = {}) {
  const reasons = SO_APPROVAL_FLAGS.filter((f) =>
    f.noGodown ? noGodownOn(order) : flagOn(order, f.key),
  ).map((f) => f.label);
  const bad = SO_APPROVAL_CUSTOMER_STATUSES[customerCategory(customerStatus)];
  if (bad) reasons.push(bad);
  return reasons;
}

/** Stored on OrderMaster.approval_reasons as "A, B". */
export const reasonsText = (reasons) => reasons.join(", ");

/** Back from the stored text; falls back to the flags for older orders. */
export function reasonsOf(order) {
  const stored = String(order?.approval_reasons || "").trim();
  if (stored) return stored.split(",").map((s) => s.trim()).filter(Boolean);
  return approvalReasons(order);
}
