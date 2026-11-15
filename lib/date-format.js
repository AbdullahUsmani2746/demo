// ─────────────────────────────────────────────────────────────────────────────
//  Day-first date helpers.
//
//  The whole application shows dates as DD-MM-YYYY (the format this office
//  reads and writes on paper). The wire/storage format stays the unambiguous
//  ISO `yyyy-MM-dd` — every API in the project parses that — so these helpers
//  only ever translate at the edges: ISO in, DD-MM-YYYY on screen, ISO back
//  out. Never send a DD-MM-YYYY string to an API.
// ─────────────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

// Parse anything the app hands us (Date, ISO string, yyyy-MM-dd) into a Date,
// or null. A bare `yyyy-MM-dd` is built in LOCAL time on purpose: `new
// Date("2026-01-31")` is parsed as UTC midnight and prints as the 30th
// anywhere west of Greenwich.
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Display format: 03-09-2026. `fallback` is returned for empty/invalid. */
export function formatDMY(value, fallback = "—") {
  const d = toDate(value);
  if (!d) return fallback;
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Same, two-digit year: 03-09-26. Used where the column has to stay narrow. */
export function formatDMYShort(value, fallback = "—") {
  const d = toDate(value);
  if (!d) return fallback;
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}`;
}

/** Storage/wire format: 2026-09-03. Timezone-safe (uses local Y/M/D). */
export function toISODate(value) {
  const d = toDate(value);
  if (!d) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * DD-MM-YYYY typed by a user -> `yyyy-MM-dd`, or "" when it is not a real
 * date. Rejects out-of-range days (31-02-2026) rather than rolling them over,
 * which is what `new Date(2026, 1, 31)` would silently do.
 */
export function parseDMY(text) {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(String(text ?? "").trim());
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return "";
  }
  return toISODate(d);
}

export const todayISO = () => toISODate(new Date());
