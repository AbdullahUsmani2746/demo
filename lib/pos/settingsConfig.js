// lib/pos/settingsConfig.js
// ============================================================
// POINT OF SALE SETTINGS — the till's choices that belong to the company.
// Client-safe (no Prisma): the settings screen and the till read it; the
// server reads the stored values through lib/pos/settings.js.
//
// One Settings row, key "posSettings", value JSON { field: value } — only the
// fields that differ from the default are stored. The defaults are what the
// POS always did (godown 1, the sale's party = the POS Cash / Card account, no
// tax, no rounding), so a company that changes nothing gets the old behaviour.
//
// Posting accounts stay in Account Settings → POS (POS Sales, POS Cash, POS
// Card, POS Sales Tax, POS Round Off). Short stock follows Settings → Stock
// checking, document type "POS". Company-wide flows (credit sales, shifts
// required) are Settings → Features, group "Point of sale".
// ============================================================

export const POS_SETTINGS_KEY = "posSettings";

export const POS_SETTINGS_FIELDS = [
  {
    key: "godown",
    type: "godown",
    section: "Till",
    label: "Sells from godown",
    description: "Stock of POS sales leaves this godown; POS returns come back into it.",
    default: 1,
  },
  {
    key: "categoryIds",
    type: "categories",
    section: "Till",
    label: "Item categories sold at the till",
    description: "Only items of these categories are offered at the till (tiles, search and scan). None picked: every item.",
    default: [],
  },
  {
    key: "walkInAccount",
    type: "account",
    section: "Till",
    label: "Walk-in customer account",
    description:
      "The party of a bill with no customer picked. Empty: the POS Cash / POS Card account the bill is paid into (as before).",
    default: null,
  },
  {
    key: "walkInName",
    type: "text",
    section: "Till",
    label: "Walk-in customer name",
    description: "Printed on receipts with no customer.",
    default: "Walk-in Customer",
    max: 60,
  },
  {
    key: "taxPercent",
    type: "number",
    section: "Pricing",
    label: "Sales tax %",
    description: "Added on top of the bill after discounts and credited to Account Settings → POS Sales Tax Payable. 0 = no tax.",
    default: 0,
    min: 0,
    max: 100,
  },
  {
    key: "roundTo",
    type: "choice",
    section: "Pricing",
    label: "Round bills to",
    description: "The bill total is rounded to the nearest step; the difference goes to Account Settings → POS Round Off.",
    options: [
      { value: 0, label: "No rounding" },
      { value: 0.5, label: "0.50" },
      { value: 1, label: "1" },
      { value: 5, label: "5" },
      { value: 10, label: "10" },
    ],
    default: 0,
  },
  {
    key: "allowDiscounts",
    type: "toggle",
    section: "Pricing",
    label: "Discounts at the till",
    description: "People with the pos.discount right may give a line or bill discount.",
    default: true,
  },
  {
    key: "maxDiscountPercent",
    type: "number",
    section: "Pricing",
    label: "Largest discount %",
    description: "No line and no bill may be discounted by more than this share of its price.",
    default: 100,
    min: 0,
    max: 100,
  },
  {
    key: "allowPriceChange",
    type: "toggle",
    section: "Pricing",
    label: "Cashier may change a price",
    description: "Off: the item's price is used (an item with no price asks for one). On: people with pos.discount may type a price.",
    default: false,
  },
  {
    key: "returnDays",
    type: "number",
    section: "Returns",
    label: "Returns accepted within (days)",
    description: "A receipt older than this cannot be refunded at the till. 0 = no limit.",
    default: 0,
    min: 0,
    max: 3650,
  },
  {
    key: "receiptHeader",
    type: "textarea",
    section: "Receipt",
    label: "Receipt header",
    description: "Printed under the company name and address (e.g. branch, phone, tax no).",
    default: "",
    max: 400,
  },
  {
    key: "receiptFooter",
    type: "textarea",
    section: "Receipt",
    label: "Receipt footer",
    description: "Printed at the bottom of every receipt (e.g. return policy).",
    default: "Thank you for your purchase!",
    max: 400,
  },
  {
    key: "paperWidth",
    type: "choice",
    section: "Receipt",
    label: "Receipt paper",
    description: "The thermal roll of the till printer. An A4 invoice can always be printed from the receipt.",
    options: [
      { value: 80, label: "80 mm" },
      { value: 58, label: "58 mm" },
    ],
    default: 80,
  },
  {
    key: "printAfterSale",
    type: "toggle",
    section: "Receipt",
    label: "Open the receipt after every sale",
    description: "The receipt opens ready to print as soon as a sale is saved.",
    default: true,
  },
];

const BY_KEY = new Map(POS_SETTINGS_FIELDS.map((f) => [f.key, f]));

export const POS_SETTINGS_DEFAULTS = Object.freeze(Object.fromEntries(POS_SETTINGS_FIELDS.map((f) => [f.key, f.default])));

const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** A raw value → the field's value, or undefined when not valid. */
function parse(def, raw) {
  switch (def.type) {
    case "godown":
      return posInt(raw) ?? undefined;
    case "categories": {
      if (!Array.isArray(raw)) return undefined;
      const ids = raw.map(posInt);
      if (ids.some((id) => id === null)) return undefined;
      return [...new Set(ids)].sort((a, b) => a - b);
    }
    case "account":
      if (raw === null || raw === "" || raw === undefined) return null;
      return posInt(raw) ?? undefined;
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < (def.min ?? -Infinity) || n > (def.max ?? Infinity)) return undefined;
      return n;
    }
    case "choice": {
      const opt = def.options.find((o) => String(o.value) === String(raw));
      return opt ? opt.value : undefined;
    }
    case "toggle":
      return typeof raw === "boolean" ? raw : undefined;
    case "text":
    case "textarea":
      if (typeof raw !== "string") return undefined;
      return raw.slice(0, def.max ?? 400);
    default:
      return undefined;
  }
}

/** Stored JSON (string / object / null) → the full settings { field: value }. */
export function resolvePosSettings(raw) {
  let stored = {};
  if (typeof raw === "string" && raw.trim()) {
    try { stored = JSON.parse(raw) || {}; } catch { stored = {}; }
  } else if (raw && typeof raw === "object") {
    stored = raw;
  }
  return Object.fromEntries(
    POS_SETTINGS_FIELDS.map((f) => {
      const v = f.key in stored ? parse(f, stored[f.key]) : undefined;
      return [f.key, v === undefined ? f.default : v];
    }),
  );
}

/** What to store: only known fields whose value differs from the default. */
export function normalizePosSettings(values) {
  const full = resolvePosSettings(values);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return Object.fromEntries(POS_SETTINGS_FIELDS.filter((f) => !same(full[f.key], f.default)).map((f) => [f.key, full[f.key]]));
}

/** 400 message for a PUT body that is not a valid (partial) settings object, or null. */
export function posSettingsShapeError(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "values must be an object of field: value";
  for (const [key, v] of Object.entries(values)) {
    const def = BY_KEY.get(key);
    if (!def) return `Unknown point of sale setting "${key}"`;
    if (parse(def, v) === undefined) return `"${def.label}" is not valid`;
  }
  return null;
}
