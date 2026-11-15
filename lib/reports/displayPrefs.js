// lib/reports/displayPrefs.js
// ============================================================
// A user's own report Display settings (the "Display" button on every
// report, components/Reports/DisplayMenu.jsx).
//
// Saved per user in Settings:
//   key   = reportDisplay:<userId>
//   value = JSON of the fields below
// Written only by /api/reports/display (audited, through lib/prisma.js).
// The browser keeps a copy (localStorage) so a report draws at once; the
// account copy follows the person to any PC or phone.
//
// Pure — no imports — so the API, the report engine and the exports share it.
// ============================================================

export const DISPLAY_SCALES = ["full", "k", "lakh", "crore"];

export const DEFAULT_DISPLAY = Object.freeze({
  size: "M", // S | M | L — table text size
  weight: "bold", // regular | medium | bold — weight of the bold columns
  bold: Object.freeze({ amount: true, rate: true, qty: false, totals: true }),
  grouping: "lakh", // lakh 12,34,567 | intl 1,234,567
  scale: "full", // full | k (thousand) | lakh | crore — amount columns
  density: "compact", // compact | comfortable
  brackets: false, // negatives as (1,200) instead of -1,200
  decimals: true, // 2 decimals on amounts
  zebra: false, // striped rows
  dateFmt: "short", // short 03 Oct 2026 | numeric 03/10/2026
  hlMin: null, // tint rows with an amount ≥ this (null = off)
  hlNegative: false, // tint rows with a negative amount
  // The user's own highlight rules, per report (HighlightMenu.jsx):
  //   { [reportType]: [{ id, field, op, value, color, scope }] }
  rules: Object.freeze({}),
});

// Highlight rules — "When <column> <op> <value>, colour <the row | the cell> <color>".
export const RULE_OPS = Object.freeze([
  ["lt", "is less than"],
  ["lte", "is at most"],
  ["eq", "is equal to"],
  ["neq", "is not"],
  ["gte", "is at least"],
  ["gt", "is more than"],
  ["contains", "contains"],
  ["empty", "is empty / zero"],
  ["notEmpty", "has a value"],
  ["negative", "is negative"],
]);
export const RULE_OPS_NO_VALUE = new Set(["empty", "notEmpty", "negative"]);
export const RULE_COLORS = Object.freeze(["red", "amber", "green", "blue", "purple"]);
const MAX_RULES = 20;
const MAX_REPORTS = 80;
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "");

function cleanRules(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  const opIds = RULE_OPS.map(([id]) => id);
  Object.entries(input)
    .slice(0, MAX_REPORTS)
    .forEach(([report, list]) => {
      const key = str(report, 80);
      if (!key || !Array.isArray(list)) return;
      const rules = list
        .slice(0, MAX_RULES)
        .map((r) => ({
          id: str(r?.id, 40) || Math.random().toString(36).slice(2, 10),
          field: str(r?.field, 80),
          op: opIds.includes(r?.op) ? r.op : "gte",
          value: str(r?.value, 80),
          color: RULE_COLORS.includes(r?.color) ? r.color : "red",
          scope: r?.scope === "cell" ? "cell" : "row",
        }))
        .filter((r) => r.field && (RULE_OPS_NO_VALUE.has(r.op) || r.value !== ""));
      if (rules.length) out[key] = rules;
    });
  return out;
}

export const displayKey = (userId) => `reportDisplay:${userId}`;

const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** A clean, complete settings object from anything (stored JSON, a request body). */
export function cleanDisplay(input) {
  const d = input && typeof input === "object" ? input : {};
  const D = DEFAULT_DISPLAY;
  const b = d.bold && typeof d.bold === "object" ? d.bold : {};
  const hl = d.hlMin === null || d.hlMin === "" || d.hlMin === undefined ? null : Number(d.hlMin);
  return {
    size: pick(d.size, ["S", "M", "L"], D.size),
    weight: pick(d.weight, ["regular", "medium", "bold"], D.weight),
    bold: {
      amount: typeof b.amount === "boolean" ? b.amount : D.bold.amount,
      rate: typeof b.rate === "boolean" ? b.rate : D.bold.rate,
      qty: typeof b.qty === "boolean" ? b.qty : D.bold.qty,
      totals: typeof b.totals === "boolean" ? b.totals : D.bold.totals,
    },
    grouping: pick(d.grouping, ["lakh", "intl"], D.grouping),
    scale: pick(d.scale, DISPLAY_SCALES, D.scale),
    density: pick(d.density, ["compact", "comfortable"], D.density),
    brackets: typeof d.brackets === "boolean" ? d.brackets : D.brackets,
    decimals: typeof d.decimals === "boolean" ? d.decimals : D.decimals,
    zebra: typeof d.zebra === "boolean" ? d.zebra : D.zebra,
    dateFmt: pick(d.dateFmt, ["short", "numeric"], D.dateFmt),
    hlMin: Number.isFinite(hl) && hl > 0 ? Math.min(hl, 1e13) : null,
    hlNegative: typeof d.hlNegative === "boolean" ? d.hlNegative : D.hlNegative,
    rules: cleanRules(d.rules),
  };
}

/** Parse a stored Settings value (defaults when missing or unreadable). */
export function parseDisplay(value) {
  if (!value) return cleanDisplay({});
  try {
    return cleanDisplay(JSON.parse(value));
  } catch {
    return cleanDisplay({});
  }
}

// ── amount in words, Pakistani system (thousand · lakh · crore) ────────────
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under100(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;
}
function under1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? under100(r) : ""].filter(Boolean).join(" ");
}
function wholeInWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${crore >= 1000 ? wholeInWords(crore) : under1000(crore)} Crore`);
  const lakh = Math.floor((n % 1e7) / 1e5);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  const thousand = Math.floor((n % 1e5) / 1000);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  const rest = n % 1000;
  if (rest) parts.push(under1000(rest));
  return parts.join(" ");
}

/** 1234500.5 → "Rupees Twelve Lakh Thirty-Four Thousand Five Hundred and Fifty Paisa" */
export function amountInWords(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs + 1e-9);
  const paisa = Math.round((abs - whole) * 100);
  const text = `Rupees ${wholeInWords(whole)}${paisa ? ` and ${under100(paisa)} Paisa` : ""}`;
  return n < 0 ? `Minus ${text}` : text;
}
