// lib/production/setupConfig.js
// ============================================================
// PRODUCTION SETUP — which item categories are finished goods, semi finished,
// raw material and packing material, and which godowns production uses.
// Client-safe (no Prisma): the settings screen and every form read it; the
// server reads the stored values through lib/production/setup.js, screens
// through hooks/useProductionSetup.js.
//
// These used to be fixed numbers in the code (category 1 = finished goods,
// godown 2 = production floor, …). They belong to the company, so they are
// data: Settings → Production setup, one Settings row, key "productionSetup",
// value JSON { field: value } — only the fields that differ from the default
// are stored. The defaults are the values the code had, so a company that
// changes nothing gets exactly the old behaviour.
//
// Read it through the helpers below (isFinishedCategory, godownForCategory …),
// never compare an ic_id or a godown id with a literal.
// ============================================================

export const PRODUCTION_SETUP_KEY = "productionSetup";

export const PRODUCTION_SETUP_FIELDS = [
  {
    key: "finishedCategoryIds",
    type: "categories",
    label: "Finished goods",
    description:
      "Item categories that are finished goods: their BOMs may total up to 110 % (BOM rule \"SMS\"), they are produced into the " +
      "finished goods godown, they carry the CC overhead in costing and they are the FG of the FG reports.",
    default: [1],
  },
  {
    key: "semiFinishedCategoryIds",
    type: "categories",
    label: "Semi finished",
    description: "Item categories made in production and used again as a material (costed from their own production).",
    default: [2],
  },
  {
    key: "rawMaterialCategoryIds",
    type: "categories",
    label: "Raw material",
    description: "Item categories bought in and consumed by production (procurement, BOM explosion, future costing).",
    default: [3],
  },
  {
    key: "packingCategoryIds",
    type: "categories",
    label: "Packing material",
    description:
      "Item categories of packing material: offered as an item's / dispatch's packing material, never stock-checked when " +
      "issued for production, left out of the process order reconciliation.",
    default: [4],
  },
  {
    key: "productionGodown",
    type: "godown",
    label: "Production godown",
    description: "Materials are issued from here by default, and everything that is not a finished good is produced into it.",
    default: 2,
  },
  {
    key: "finishedGoodsGodown",
    type: "godown",
    label: "Finished goods godown",
    description: "Finished goods are produced into this godown by default; the FG daily update report reads it.",
    default: 3,
  },
  {
    key: "fgTransferGodown",
    type: "godown",
    label: "FG transfer to",
    description: "Where an SF-to-FG order's FG transfer requisition sends the goods from the production godown.",
    default: 6,
  },
  {
    key: "planFromGodown",
    type: "godown",
    label: "Production plan: required from",
    description:
      "The \"Required From\" godown of a dispatch Production Plan made from a Sale Order line (its \"Required By\" is the " +
      "production godown). Features → Sale Order → Plan production from the Sale Order line.",
    default: 1,
  },
];

const BY_KEY = new Map(PRODUCTION_SETUP_FIELDS.map((f) => [f.key, f]));
export const CATEGORY_FIELDS = PRODUCTION_SETUP_FIELDS.filter((f) => f.type === "categories").map((f) => f.key);

export const PRODUCTION_SETUP_DEFAULTS = Object.freeze(
  Object.fromEntries(PRODUCTION_SETUP_FIELDS.map((f) => [f.key, f.default])),
);

const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const idList = (v) => {
  if (!Array.isArray(v)) return null;
  const ids = v.map(posInt);
  if (ids.some((id) => id === null)) return null;
  return [...new Set(ids)].sort((a, b) => a - b);
};

/** A stored field value, or the default when missing / not valid. */
function fieldValue(def, raw) {
  if (def.type === "categories") return idList(raw) ?? def.default;
  if (def.type === "godown") return posInt(raw) ?? def.default;
  return def.default;
}

/** Stored JSON (string / object / null) → the full setup { field: value }. */
export function resolveProductionSetup(raw) {
  let stored = {};
  if (typeof raw === "string" && raw.trim()) {
    try { stored = JSON.parse(raw) || {}; } catch { stored = {}; }
  } else if (raw && typeof raw === "object") {
    stored = raw;
  }
  return Object.fromEntries(PRODUCTION_SETUP_FIELDS.map((f) => [f.key, fieldValue(f, stored[f.key])]));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** What to store: only known fields whose value differs from the default. */
export function normalizeProductionSetup(values) {
  const full = resolveProductionSetup(values);
  return Object.fromEntries(PRODUCTION_SETUP_FIELDS.filter((f) => !same(full[f.key], f.default)).map((f) => [f.key, full[f.key]]));
}

/** 400 message for a PUT body that is not a valid (partial) setup, or null. */
export function productionSetupShapeError(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "values must be an object of field: value";
  for (const [key, v] of Object.entries(values)) {
    const def = BY_KEY.get(key);
    if (!def) return `Unknown production setup field "${key}"`;
    if (def.type === "categories" && idList(v) === null) return `"${def.label}" must be a list of item category ids`;
    if (def.type === "godown" && posInt(v) === null) return `"${def.label}" must be a godown`;
  }
  return null;
}

/** A category may be one kind only — message for the first overlap, or null. */
export function categoryOverlapError(setup) {
  const seen = new Map();
  for (const key of CATEGORY_FIELDS) {
    for (const id of setup[key] || []) {
      if (seen.has(id)) return `Item category ${id} is both "${BY_KEY.get(seen.get(id)).label}" and "${BY_KEY.get(key).label}" — a category is one kind only.`;
      seen.set(id, key);
    }
  }
  return null;
}

// ── readers ─────────────────────────────────────────────────────────────
const has = (ids, icId) => icId !== null && icId !== undefined && icId !== "" && (ids || []).includes(Number(icId));

export const isFinishedCategory = (setup, icId) => has(setup.finishedCategoryIds, icId);
export const isSemiFinishedCategory = (setup, icId) => has(setup.semiFinishedCategoryIds, icId);
export const isRawMaterialCategory = (setup, icId) => has(setup.rawMaterialCategoryIds, icId);
export const isPackingCategory = (setup, icId) => has(setup.packingCategoryIds, icId);
/** Bought-in materials: raw material + packing material (procurement, BOM explosion leaves). */
export const procuredCategoryIds = (setup) => [...new Set([...setup.rawMaterialCategoryIds, ...setup.packingCategoryIds])];

/** The godown a production item is produced into when none is picked: finished goods → FG godown, else production. */
export const godownForCategory = (setup, icId) =>
  isFinishedCategory(setup, icId) ? setup.finishedGoodsGodown : setup.productionGodown;

/** "Finished" / "Semi Finished" label of a BOM's product. */
export const productKindLabel = (setup, icId) => (isFinishedCategory(setup, icId) ? "Finished" : "Semi Finished");
