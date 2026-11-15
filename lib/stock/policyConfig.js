// lib/stock/policyConfig.js
// ============================================================
// STOCK CHECK POLICY — the pure part (no database), shared by the server
// (lib/stock/policy.js, lib/stock/checkStock.js) and the screens
// (hooks/useStockPolicy.js, lib/stock/policyClient.js).
//
// Stored in the Settings table, key "stockCheckPolicy", value JSON:
//   {
//     default: "off" | "warn" | "block" | null,   // "Set all to"
//     types:   { <type key>: "off" | "warn" | "block" },
//     allowNegativeGodowns: [godown id, …]        // never checked
//   }
// No row (or an empty one) = exactly how the system behaved before this
// setting existed — see `default` / `screen` on each type below.
//
// Modes
//   off   → no stock check at all (screen nor save)
//   warn  → the shortage is shown (amber) and returned with the save as a
//           warning, but the document is saved
//   block → the document is refused (422) while any item is short
// ============================================================

export const STOCK_POLICY_KEY = "stockCheckPolicy";
export const STOCK_MODES = ["off", "warn", "block"];
export const MODE_LABELS = { off: "No check", warn: "Warn", block: "Block" };
const RANK = { off: 0, warn: 1, block: 2 };

/**
 * Every document that takes stock out of a godown.
 *   default    — the mode a SAVE gets while the owner has not chosen one
 *                (= what the server did before this setting existed)
 *   screen     — the mode the FORM gets while not chosen, when it differed
 *                from the save (the form hard-limited, the save never checked)
 *   modes      — the choices offered (all three unless listed)
 *   screenOnly — no stock leaves on save (a plan); only the form is affected
 */
export const STOCK_CHECK_TYPES = [
  {
    key: "dispatch",
    label: "Dispatch",
    tranCodes: [6],
    covers: "Dispatch and Dispatch Edit — finished goods taken out of the dispatch godown (lines without BOM materials).",
    default: "block",
  },
  {
    key: "dispatchBom",
    label: "Dispatch — BOM materials",
    tranCodes: [7],
    covers: "Produce-on-dispatch: the BOM materials issued from the \"Issue Materials From\" godown.",
    default: "block",
  },
  {
    key: "packing",
    label: "Dispatch — packing material",
    tranCodes: [7],
    covers: "Packing material consumed by a dispatch (the automatic packing consumption entry).",
    default: "warn",
  },
  {
    key: "sale",
    label: "Sale Invoice (direct)",
    tranCodes: [6],
    covers: "A Sale Invoice keyed directly as a voucher (not through Dispatch).",
    default: "off",
  },
  {
    key: "materialIssue",
    label: "Material Issue",
    tranCodes: [7],
    covers: "Material Issue vouchers — raw material issued out of a godown.",
    default: "off",
  },
  {
    key: "materialIssueLanded",
    label: "Material Issue (landed cost)",
    tranCodes: [7],
    covers: "Material Issue with landed cost (and its automatic JV).",
    default: "off",
  },
  {
    key: "processOrder",
    label: "Process Order — send to production",
    tranCodes: [7],
    covers: "Materials issued when a process order is sent to production (packing material is never checked).",
    default: "block",
  },
  {
    key: "transfer",
    label: "Godown Transfer",
    tranCodes: [11],
    covers: "Godown Transfer and Transfer Edit — stock leaving the From godown.",
    default: "warn",
    screen: "block",
  },
  {
    key: "fgTransfer",
    label: "FG Transfer",
    tranCodes: [11],
    covers: "FG Transfer against a requisition, and accepting an FG Transfer requisition (production floor → FG).",
    default: "warn",
    screen: "block",
  },
  {
    key: "dispatchTransfer",
    label: "Production Plan (dispatch)",
    tranCodes: [],
    covers: "Production Plan for dispatch — the stock hint shown when an item is picked. A plan moves no stock, so it can only show or hide the hint.",
    default: "warn",
    modes: ["off", "warn"],
    screenOnly: true,
  },
  {
    key: "grnReturn",
    label: "GRN Return",
    tranCodes: [9],
    covers: "GRN Return — goods sent back to the vendor out of a godown.",
    default: "off",
  },
  {
    key: "purchaseReturn",
    label: "Purchase Return",
    tranCodes: [9],
    covers: "Purchase Return vouchers.",
    default: "off",
  },
  {
    key: "pos",
    label: "POS",
    tranCodes: [5],
    covers: "Point-of-sale checkout (godown 1).",
    default: "off",
    screen: "block",
  },
];

export const STOCK_TYPE_KEYS = STOCK_CHECK_TYPES.map((t) => t.key);
const TYPE_BY_KEY = new Map(STOCK_CHECK_TYPES.map((t) => [t.key, t]));
export const stockCheckType = (key) => TYPE_BY_KEY.get(key) || null;

/** Voucher route type (VOUCHER_CONFIG key) → policy type. Dispatch types are
 *  checked by lib/dispatch/bomProduction.js (dispatch + dispatchBom). */
export const VOUCHER_STOCK_TYPES = {
  sale: "sale",
  materialIssue: "materialIssue",
  materialIssueLanded: "materialIssueLanded",
  transfer: "transfer",
  transferEdit: "transfer",
  fgTransfer: "fgTransfer",
  grnReturn: "grnReturn",
  purchaseReturn: "purchaseReturn",
};
// A stock-out voucher type not named above still gets checked by its tran_code.
const TRAN_CODE_FALLBACK = { 5: "pos", 6: "sale", 7: "materialIssue", 9: "purchaseReturn", 11: "transfer" };

/** The policy type of a voucher save, or null when it takes no stock out. */
export function stockTypeForVoucher(voucherType, tranCode) {
  if (voucherType === "dispatch" || voucherType === "dispatchEdit") return null;
  return VOUCHER_STOCK_TYPES[voucherType] ?? TRAN_CODE_FALLBACK[Number(tranCode)] ?? null;
}

const validMode = (m) => (STOCK_MODES.includes(m) ? m : null);
const allowedFor = (type, mode) => {
  if (!mode) return null;
  const allowed = type.modes || STOCK_MODES;
  if (allowed.includes(mode)) return mode;
  // A mode the type does not offer (e.g. "block" on a plan) → the closest it does.
  return [...allowed].sort((a, b) => RANK[b] - RANK[a]).find((m) => RANK[m] <= RANK[mode]) || allowed[0];
};

/** Parse / clean a stored value (string or object). Never throws. */
export function normalizeStockPolicy(raw) {
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  if (!v || typeof v !== "object") v = {};
  const types = {};
  for (const [k, m] of Object.entries(v.types || {})) {
    if (TYPE_BY_KEY.has(k) && validMode(m)) types[k] = m;
  }
  const godowns = Array.isArray(v.allowNegativeGodowns)
    ? [...new Set(v.allowNegativeGodowns.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  return { default: validMode(v.default), types, allowNegativeGodowns: godowns };
}

/**
 * Validate a policy sent by the Settings screen. Returns an error message,
 * or null when the shape is right.
 */
export function stockPolicyShapeError(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "Policy must be an object";
  if (v.default != null && !validMode(v.default)) return `default must be one of ${STOCK_MODES.join(", ")}`;
  if (v.types != null && (typeof v.types !== "object" || Array.isArray(v.types))) return "types must be an object";
  for (const [k, m] of Object.entries(v.types || {})) {
    const t = TYPE_BY_KEY.get(k);
    if (!t) return `Unknown document type "${k}"`;
    if (!(t.modes || STOCK_MODES).includes(m)) return `${t.label}: mode must be one of ${(t.modes || STOCK_MODES).join(", ")}`;
  }
  if (v.allowNegativeGodowns != null) {
    if (!Array.isArray(v.allowNegativeGodowns)) return "allowNegativeGodowns must be a list of godown ids";
    if (v.allowNegativeGodowns.some((g) => !Number.isInteger(Number(g)) || Number(g) <= 0)) {
      return "allowNegativeGodowns must hold godown ids";
    }
  }
  return null;
}

/**
 * Resolve every type's mode.
 * @returns {{ modes, screen, explicit, allowNegativeGodowns, policy }}
 *   modes[key]    — what a save does
 *   screen[key]   — what the form does
 *   explicit[key] — the owner chose it (per type or via "Set all")
 */
export function resolveStockPolicy(raw) {
  const policy = normalizeStockPolicy(raw);
  const modes = {};
  const screen = {};
  const explicit = {};
  for (const t of STOCK_CHECK_TYPES) {
    const chosen = policy.types[t.key] ?? policy.default ?? null;
    explicit[t.key] = chosen != null;
    modes[t.key] = allowedFor(t, chosen) ?? t.default;
    screen[t.key] = chosen != null ? modes[t.key] : (t.screen ?? t.default);
  }
  return { modes, screen, explicit, allowNegativeGodowns: policy.allowNegativeGodowns, policy };
}

/** Mode of one type from a resolved policy (unknown type → "off"). */
export function modeOf(resolved, key, { screen = false } = {}) {
  const r = resolved || resolveStockPolicy(null);
  return (screen ? r.screen : r.modes)?.[key] ?? "off";
}

/** The stricter of two modes. */
export const stricterMode = (a, b) => (RANK[a] >= RANK[b] ? a : b);

/** Is this godown exempt (allowed to go negative)? */
export function isExemptGodown(resolved, godown) {
  const g = Number(godown?.value ?? godown);
  return (resolved?.allowNegativeGodowns || []).includes(g);
}

// ── Shortage arithmetic (pure — unit-tested) ──────────────────────────────
const EPS = 1e-6;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/**
 * Needed qty per item from save lines (raw form lines or mapped rows).
 * Only main lines (sub_tran_id 1 / unset); lines without an item or a
 * positive qty are ignored. Qty must already be KG.
 * @returns {Map<number, number>}
 */
export function stockNeeds(lines, { qtyKey = "qty", itemKey = "itcd" } = {}) {
  const needs = new Map();
  for (const l of lines ?? []) {
    if (!l) continue;
    if (l.sub_tran_id != null && Number(l.sub_tran_id) !== 1) continue;
    const raw = l[itemKey];
    const itcd = Number(raw?.value ?? raw);
    const qty = Number(l[qtyKey]);
    if (!Number.isInteger(itcd) || itcd <= 0 || !(qty > 0)) continue;
    needs.set(itcd, round3((needs.get(itcd) || 0) + qty));
  }
  return needs;
}

/**
 * Items whose need is above the stock.
 * @param {Map<number, number>} needs
 * @param {Map<number, number>} stock     itcd → available
 * @param {Map<number, {code, name}>} [info]
 */
export function findShortages(needs, stock, info = new Map()) {
  const out = [];
  for (const [itcd, need] of needs) {
    const available = round3(stock.get(itcd) || 0);
    if (need > available + EPS) {
      const i = info.get(itcd) || {};
      out.push({
        itcd,
        code: i.code ?? null,
        name: i.name || `Item #${itcd}`,
        need: round3(need),
        available,
        short: round3(need - available),
      });
    }
  }
  return out;
}

/** One readable line for a list of shortages. */
export function shortageMessage(label, shortages, where = "") {
  if (!shortages?.length) return null;
  const list = shortages
    .map((s) => `${s.code ? `${s.code} ` : ""}${s.name}: need ${s.need}, in stock ${s.available}`)
    .join("; ");
  return `Not enough stock${where ? ` in ${where}` : ""} for this ${label} — ${list}.`;
}
