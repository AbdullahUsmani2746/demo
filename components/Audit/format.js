// components/Audit/format.js — small, pure helpers for the Audit Trail screen:
// day keys, presets, field names and value formatting.

export const ACTION_META = {
  create: { label: "Created", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  update: { label: "Changed", chip: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" },
  delete: { label: "Deleted", chip: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500" },
};

const pad = (n) => String(n).padStart(2, "0");

/** Local YYYY-MM-DD of a Date (or anything Date accepts). */
export function dayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
}

/** Quick date presets → { from, to } (same default as the API: the last 7 days). */
export const PRESETS = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "7 days", days: 6 },
  { key: "30d", label: "30 days", days: 29 },
];

export function presetRange(key) {
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[1];
  return { from: daysAgo(p.days), to: daysAgo(0) };
}

/** Which preset (or "custom") a from/to pair is. No dates → the default "7d". */
export function presetOf(from, to) {
  if (!from && !to) return "7d";
  const hit = PRESETS.find((p) => {
    const r = presetRange(p.key);
    return r.from === from && r.to === to;
  });
  return hit ? hit.key : "custom";
}

/** "Mon, 27 Oct 2026" / "Today" / "Yesterday" for a day key. */
export function fmtDayHeading(key) {
  if (key === daysAgo(0)) return "Today";
  if (key === daysAgo(1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDayShort(key) {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export const fmtTime = (value) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export const fmtDateTime = (value) =>
  new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");

/** "tran_id" → "Tran ID", "createdAt" → "Created at", "rmk1" → "Rmk 1". */
export function humanize(name) {
  const words = String(name ?? "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^id$/i.test(w) ? "ID" : w.toLowerCase()));
  if (!words.length) return "";
  words[0] = words[0] === "ID" ? "ID" : words[0][0].toUpperCase() + words[0].slice(1);
  return words.join(" ");
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export const isEmpty = (v) => v === null || v === undefined || v === "";

/** A stored value as text: null → —, booleans Yes/No, ISO dates formatted, objects as JSON. */
export function fmtValue(v) {
  if (isEmpty(v)) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (typeof v === "string" && ISO_RE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const midnight = /T00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(v);
      return midnight
        ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
        : fmtDateTime(d);
    }
  }
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

/** One-line, length-capped version for previews. */
export function fmtShort(v, max = 40) {
  const s = fmtValue(v).replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const initialsOf = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

/** Rows (newest first) → [{ day, items: [{ batch, rows }] }] — adjacent rows of one save grouped. */
export function groupTimeline(rows) {
  const days = [];
  for (const row of rows) {
    const key = dayKey(row.dated);
    let day = days[days.length - 1];
    if (!day || day.day !== key) {
      day = { day: key, items: [] };
      days.push(day);
    }
    const last = day.items[day.items.length - 1];
    if (row.batch_id && last && last.batch === row.batch_id) last.rows.push(row);
    else day.items.push({ batch: row.batch_id || null, rows: [row] });
  }
  return days;
}

/** The URL keys that make up a filter. */
export const FILTER_KEYS = ["from", "to", "module", "model", "action", "user", "source", "q"];
export const SCOPE_KEYS = ["doc_model", "doc_id", "record", "batch"];

export function scopeOf(params) {
  if (params.doc_model && params.doc_id) return "document";
  if (params.batch) return "batch";
  if (params.record && params.model) return "record";
  return null;
}
