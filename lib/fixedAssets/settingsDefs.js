// lib/fixedAssets/settingsDefs.js
// ============================================================
// Settings → Fixed assets — the company's depreciation rules. Client-safe (no
// Prisma): the settings screen, the run screen and the server all read it.
//
// Stored as one Settings row, key "fixedAssetSettings", value JSON with only
// the values that differ from the defaults. Changed by holders of
// settings.manage through /api/fixed-assets/settings (audited).
//
// Resolution for one asset (lib/fixedAssets/calc.js resolveAssetRules):
//   the asset's own value → its category's (fa_category_defaults) → these.
// Accounts are not here: they are Account Settings (section FIXED_ASSETS)
// with a per-category override on the same Fixed assets settings screen.
// ============================================================

export const FA_SETTINGS_KEY = "fixedAssetSettings";

export const DEPRECIATION_METHODS = [
  { value: "SL", label: "Straight line", help: "(cost − salvage) ÷ useful life, the same every month." },
  { value: "RB", label: "Reducing balance", help: "Net book value × rate % ÷ 12 each month — larger at the start." },
];
export const methodLabel = (m) => DEPRECIATION_METHODS.find((x) => x.value === m)?.label ?? m ?? "—";

export const FA_SETTING_DEFS = [
  {
    key: "defaultMethod", group: "method", type: "choice", label: "Depreciation method (default)",
    help: "Used for an asset whose category has no method of its own.",
    options: DEPRECIATION_METHODS, default: "SL",
  },
  {
    key: "defaultLifeMonths", group: "method", type: "number", label: "Useful life, months (default)", min: 1, max: 1200,
    help: "Straight line spreads (cost − salvage) over this many months. Reducing balance writes down to salvage in the last month of it (see below).",
    default: 60,
  },
  {
    key: "defaultRbRate", group: "method", type: "number", label: "Reducing balance rate, % a year (default)", min: 0.01, max: 100,
    help: "Reducing balance: each month's charge = net book value × rate ÷ 12.",
    default: 20,
  },
  {
    key: "defaultSalvagePct", group: "method", type: "number", label: "Salvage value, % of cost (default)", min: 0, max: 100,
    help: "An asset is never depreciated below its salvage value.",
    default: 0,
  },
  {
    key: "firstMonthRule", group: "timing", type: "choice", label: "First month (month the asset is put in service)",
    options: [
      { value: "PRORATA", label: "Pro-rata from the in-service date", help: "Days in service ÷ days in the month — e.g. in service on 16 June: 15/30 of a month." },
      { value: "FULL", label: "Full month", help: "A full month's charge whatever the day." },
      { value: "NEXT", label: "From the next month", help: "Nothing for the in-service month; depreciation starts the month after." },
    ],
    default: "PRORATA",
  },
  {
    key: "lastMonthRule", group: "timing", type: "choice", label: "Last month (month the asset is disposed of)",
    options: [
      { value: "PRORATA", label: "Pro-rata up to the disposal date", help: "Days held ÷ days in the month, charged in the disposal journal." },
      { value: "FULL", label: "Full month", help: "A full month's charge in the disposal journal." },
      { value: "NONE", label: "None", help: "No depreciation for the month of disposal." },
    ],
    default: "PRORATA",
  },
  {
    key: "rbEndOfLife", group: "timing", type: "choice", label: "Reducing balance at the end of useful life",
    options: [
      { value: "WRITE_DOWN", label: "Write down to salvage in the last month", help: "The last month of useful life charges whatever is left above salvage." },
      { value: "CONTINUE", label: "Keep reducing", help: "Useful life is ignored; the charge keeps getting smaller." },
    ],
    default: "WRITE_DOWN",
  },
  {
    key: "grnCapitalisation", group: "grn", type: "choice", label: "When a Fixed Assets GRN registers assets",
    options: [
      { value: "JV", label: "Post the capitalisation journal", help: "Dr the category's asset cost account, Cr the vendor — a system journal, read-only." },
      { value: "NONE", label: "Register only", help: "The cost is booked by your own voucher (e.g. a purchase / journal voucher)." },
    ],
    default: "JV",
  },
  {
    key: "minCapitalisationValue", group: "grn", type: "number", label: "Minimum capitalisation value (unit cost)", min: 0, max: 1e12,
    help: "A unit costing less is not registered as an asset: the capitalisation journal debits the category's depreciation expense account instead. 0 = every unit is capitalised.",
    default: 0,
  },
  {
    key: "assetNoPrefix", group: "numbering", type: "text", label: "Asset number prefix", maxLength: 12,
    help: "Shown in front of the running asset number on screens and reports, e.g. FA- → FA-00042. The stored number does not change.",
    default: "",
  },
  {
    key: "assetNoDigits", group: "numbering", type: "number", label: "Asset number digits (zero padded)", min: 0, max: 10,
    help: "0 = as it is (42); 5 → 00042.",
    default: 0,
  },
];

export const FA_SETTING_GROUPS = [
  { id: "method", title: "Depreciation defaults", description: "Used when neither the asset nor its category says otherwise." },
  { id: "timing", title: "First and last month", description: "How the months an asset starts and ends in are charged." },
  { id: "grn", title: "Fixed Assets GRN", description: "What happens when a GRN registers assets (Settings → Features → Fixed assets)." },
  { id: "numbering", title: "Asset numbers", description: "How asset numbers are shown." },
];

const BY_KEY = Object.fromEntries(FA_SETTING_DEFS.map((d) => [d.key, d]));
export const FA_DEFAULTS = Object.fromEntries(FA_SETTING_DEFS.map((d) => [d.key, d.default]));

/** One value, checked against its definition; undefined when invalid. */
function cleanValue(def, raw) {
  if (raw === undefined || raw === null) return undefined;
  if (def.type === "choice") return def.options.some((o) => o.value === raw) ? raw : undefined;
  if (def.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < (def.min ?? -Infinity) || n > (def.max ?? Infinity)) return undefined;
    return n;
  }
  if (def.type === "text") return String(raw).slice(0, def.maxLength ?? 100);
  return undefined;
}

/** Stored JSON (string or object) → every setting's value (defaults filled in). */
export function resolveFaSettings(raw) {
  let stored = raw;
  if (typeof raw === "string") {
    try { stored = JSON.parse(raw); } catch { stored = null; }
  }
  const out = { ...FA_DEFAULTS };
  if (stored && typeof stored === "object") {
    for (const def of FA_SETTING_DEFS) {
      const v = cleanValue(def, stored[def.key]);
      if (v !== undefined) out[def.key] = v;
    }
  }
  return out;
}

/** Per-key errors for a submitted settings object (unknown keys refused). */
export function faSettingsErrors(input) {
  const errors = {};
  if (!input || typeof input !== "object") return { _: "Send { settings: { … } }" };
  for (const [k, v] of Object.entries(input)) {
    const def = BY_KEY[k];
    if (!def) { errors[k] = "Unknown setting"; continue; }
    if (cleanValue(def, v) === undefined) {
      errors[k] = def.type === "choice" ? "Choose one of the options" : def.type === "number" ? `A number from ${def.min} to ${def.max}` : "Invalid";
    }
  }
  return errors;
}

/** Only the values that differ from the defaults (what is stored). */
export function compactFaSettings(input) {
  const full = resolveFaSettings(input);
  return Object.fromEntries(Object.entries(full).filter(([k, v]) => v !== FA_DEFAULTS[k]));
}

/** 42 → "FA-00042" per the numbering settings. */
export function formatAssetNo(no, settings = FA_DEFAULTS) {
  if (no == null || no === "") return "";
  const digits = Number(settings?.assetNoDigits) || 0;
  const body = digits > 0 ? String(no).padStart(digits, "0") : String(no);
  return `${settings?.assetNoPrefix || ""}${body}`;
}

// Per-category accounts (fa_category_defaults columns) and the Account
// Settings key each falls back to (section FIXED_ASSETS).
export const FA_CATEGORY_ACCOUNTS = [
  { col: "cost_acno", key: "fa_cost", label: "Asset cost", help: "Dr on capitalisation, Cr on disposal." },
  { col: "accdep_acno", key: "fa_accumulated_depreciation", label: "Accumulated depreciation", help: "Cr by depreciation, Dr on disposal." },
  { col: "depexp_acno", key: "fa_depreciation_expense", label: "Depreciation expense", help: "Dr by depreciation." },
  { col: "gainloss_acno", key: "fa_disposal_gain_loss", label: "Gain / loss on disposal", help: "Cr gain / Dr loss on disposal." },
];
