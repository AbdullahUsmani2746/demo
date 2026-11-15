// lib/orders/lineTypes.js — Sale Order line type (feature "orders.trialLineBilling",
// ported from Eastland). Client-safe: no imports, used by the form and the orders route.
//
// Each Sale Order line is NORMAL, TRIAL (rate 0, waits for the client's
// result) or RATE_NEG (rate under negotiation, billed once agreed). The
// order-level flags trialProcess / rateUnderNegotiation are worked out from
// the lines, so approval rules, flag reasons, follow-ups and BI keep reading
// the order as before. Free of Cost stays on the whole order: every line is
// free, and the lines stay NORMAL.
//
// With the feature off nothing here runs on a save: the "Order Type" applies
// to the whole order (SMS) and OrderDetail.line_type keeps its stored value.

export const LINE_TYPE = { NORMAL: "NORMAL", TRIAL: "TRIAL", RATE_NEG: "RATE_NEG" };

export const LINE_TYPE_OPTIONS = [
  { value: LINE_TYPE.NORMAL, label: "Normal" },
  { value: LINE_TYPE.TRIAL, label: "Trial" },
  { value: LINE_TYPE.RATE_NEG, label: "Rate Negotiation" },
];

export const LINE_TYPE_LABEL = Object.fromEntries(LINE_TYPE_OPTIONS.map((o) => [o.value, o.label]));

/** Trial / Rate Negotiation — the line types that wait for the client. */
export const WAITING_LINE_TYPES = [LINE_TYPE.TRIAL, LINE_TYPE.RATE_NEG];

const isOn = (v) => v === true || v === "true";

/** The type a line was given (string or select option), or null. */
export const lineTypeOf = (line) => {
  const v = line?.line_type?.value ?? line?.line_type;
  return v && LINE_TYPE[v] ? v : null;
};

/** The type a new line gets from the order's "Order Type" dropdown. */
export const defaultLineType = (order) =>
  isOn(order?.trialProcess) ? LINE_TYPE.TRIAL : isOn(order?.rateUnderNegotiation) ? LINE_TYPE.RATE_NEG : LINE_TYPE.NORMAL;

/** A line's type on this order: Free of Cost → NORMAL; unset → the order's default. */
export const effectiveLineType = (order, line) =>
  isOn(order?.freeOfCost) ? LINE_TYPE.NORMAL : lineTypeOf(line) ?? defaultLineType(order);

/** Rate forced to 0: every line of a Free of Cost order, and Trial lines. */
export const freeLine = (order, line) =>
  isOn(order?.freeOfCost) || effectiveLineType(order, line) === LINE_TYPE.TRIAL;

/** Waiting for the client (Trial) or for a rate (Rate Negotiation). */
export const isWaitingLine = (line) => WAITING_LINE_TYPES.includes(lineTypeOf(line));

/** Order flags from the lines. */
export const lineTypeFlags = (lines) => ({
  trialProcess: lines.some((l) => lineTypeOf(l) === LINE_TYPE.TRIAL),
  rateUnderNegotiation: lines.some((l) => lineTypeOf(l) === LINE_TYPE.RATE_NEG),
});

const itemOf = (line) => {
  const v = line?.itcd?.value ?? line?.itcd;
  return v == null || v === "" ? null : Number(v);
};

/**
 * Sale Order body as saved (feature on): every line gets its type, Free of
 * Cost / Trial lines rate 0, and master.trialProcess / rateUnderNegotiation
 * follow the lines. Changes `body` in place and is safe to run twice.
 * Returns an error message when an order with Trial / Rate Negotiation lines
 * has an item twice (billing matches dispatch lines to order lines by item).
 */
export function applySaleOrderLineTypes(body) {
  const master = body?.master;
  if (!master || !Array.isArray(body.lines)) return null;
  body.lines = body.lines.map((line) => {
    const line_type = effectiveLineType(master, line);
    const next = { ...line, line_type };
    return freeLine(master, next) ? { ...next, rate: 0, st_rate: 0, amount: 0, st_amount: 0 } : next;
  });
  if (!isOn(master.freeOfCost)) Object.assign(master, lineTypeFlags(body.lines));

  if (!body.lines.some(isWaitingLine)) return null;
  const seen = new Map(); // itcd → name from the first line with it
  const twice = new Set();
  body.lines.forEach((l) => {
    const it = itemOf(l);
    if (it == null) return;
    const name = l.item_name || l.itcd?.label || seen.get(it) || it;
    if (seen.has(it)) twice.add(seen.get(it));
    else seen.set(it, name);
  });
  return twice.size
    ? `An order with Trial or Rate Negotiation lines cannot have the same item twice (${[...twice].join(", ")}). Put the quantity on one line.`
    : null;
}
