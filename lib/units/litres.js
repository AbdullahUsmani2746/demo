/**
 * LTR ⇄ KG conversion for sale orders and dispatches.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Stock is held in KG. Always. Every stock figure in this system —
 * `Transactions.qty`, `OrderDetail.qty`, the stock formula in CLAUDE.md, the
 * monthly opening snapshot — is kilograms, and nothing here changes that.
 *
 * Some customers order in litres. For those lines:
 *   • the litre quantity is the SOURCE OF TRUTH and lives in `qty_ltr`
 *   • `qty` (KG) is DERIVED from it, and is what moves stock
 *   • the rate is a price PER LITRE, so amount = qty_ltr × rate
 *
 * The conversion factor is `Item.ltr_rate`, which holds KG PER LITRE
 * (density / specific gravity — around 0.9 to 1.4 for inks):
 *
 *      qty_kg = qty_ltr × ltr_rate
 *      qty_ltr = qty_kg / ltr_rate
 *
 * Because KG is always derived, an item whose ltr_rate is corrected later
 * yields the right KG on the next document — the litres never need restating.
 *
 * ── Why an item without ltr_rate is treated differently per document ──────
 * A Sale Order moves no stock, so it is allowed through with a WARNING: the
 * order can be taken while the item master is still being completed.
 * A Dispatch moves stock, so it is BLOCKED: posting it would put a KG figure
 * into inventory that nobody can justify.
 *
 * Callers: app/api/orders/[type]/route.js (sale order),
 *          app/api/voucher/[type]/route.js (dispatch),
 *          lib/invoicing/core.js (Sale / Purchase Invoicing — a line may be
 *            billed per LTR there: litres = KG ÷ density, KG untouched),
 *          components/Category/constants.js (the forms).
 */

export const UNIT_KG = "KG";
export const UNIT_LTR = "LTR";

/** The units a sale-order line may be transacted in. */
export const TRANSACTABLE_UNITS = [UNIT_KG, UNIT_LTR];

/** Normalize whatever the form sent ("ltr", " Ltr ", {value:"LTR"}) to KG/LTR. */
export const normalizeUnit = (unit) => {
  const raw = typeof unit === "object" && unit !== null ? unit.value : unit;
  const cleaned = String(raw ?? "").trim().toUpperCase();
  return cleaned === UNIT_LTR ? UNIT_LTR : UNIT_KG;
};

/** True when this line is transacted in litres. */
export const isLitreUnit = (unit) => normalizeUnit(unit) === UNIT_LTR;

/**
 * True when the item carries a usable conversion factor.
 * Zero is not usable — it would make every litre weigh nothing.
 */
export const hasLtrRate = (ltrRate) => {
  const n = Number(ltrRate);
  return Number.isFinite(n) && n > 0;
};

const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/** Round to 3 decimals — the precision stock quantities are kept at. */
const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** litres → kilograms. Returns null when the item has no ltr_rate. */
export const litresToKg = (litres, ltrRate) =>
  hasLtrRate(ltrRate) ? round3(toNumber(litres) * Number(ltrRate)) : null;

/** kilograms → litres. Returns null when the item has no ltr_rate. */
export const kgToLitres = (kg, ltrRate) =>
  hasLtrRate(ltrRate) ? round3(toNumber(kg) / Number(ltrRate)) : null;

/**
 * Resolve one line into what the database should hold.
 *
 * Give it whichever quantity the user typed — `qty` for a KG line, `qty_ltr`
 * for a litre line — plus the item's ltr_rate and the rate on the line.
 *
 * Returns:
 *   unit      normalized, "KG" or "LTR"
 *   qty       KILOGRAMS — what moves stock. null on a litre line with no
 *             ltr_rate, because there is no honest number to put there.
 *   qty_ltr   LITRES — filled on a litre line; also filled on a KG line when
 *             the item has an ltr_rate, so litre reporting works either way.
 *   amount    qty_ltr × rate on a litre line, qty × rate on a KG line.
 *   convertible  false when the line is in litres and the item has no rate.
 */
export function resolveLineQuantities({ unit, qty, qty_ltr, ltr_rate, rate }) {
  const normalizedUnit = normalizeUnit(unit);
  const litre = normalizedUnit === UNIT_LTR;
  const convertible = hasLtrRate(ltr_rate);
  const lineRate = toNumber(rate);

  if (litre) {
    const litres = round3(toNumber(qty_ltr ?? qty));
    const kg = litresToKg(litres, ltr_rate);
    return {
      unit: UNIT_LTR,
      qty: kg, // null when not convertible — the caller decides what to do
      qty_ltr: litres,
      amount: round3(litres * lineRate), // rate is per litre
      convertible,
    };
  }

  const kg = round3(toNumber(qty));
  return {
    unit: UNIT_KG,
    qty: kg,
    qty_ltr: convertible ? kgToLitres(kg, ltr_rate) : null,
    amount: round3(kg * lineRate), // rate is per KG
    convertible,
  };
}

/**
 * The message shown when a litre line's item has no ltr_rate. Same wording
 * everywhere so a warning on the sale order and the block on the dispatch
 * read as the same problem.
 */
export const missingLtrRateMessage = (itemLabel) =>
  `${itemLabel || "This item"} has no LTR Rate set, so litres cannot be converted to KG. ` +
  `Set the item's LTR Rate (KG per litre) in the Item master.`;
