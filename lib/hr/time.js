// lib/hr/time.js — attendance clock: days and times of day in Asia/Karachi.
//
// Attendance is read in Karachi whatever the server's own timezone is: a
// shift "08:00–17:00" means 08:00 in Karachi, and a punch at 07:55 Karachi is
// stored as 02:55 UTC. Pakistan has no daylight saving, so the offset is fixed.
//
//   day key  "YYYY-MM-DD"  a calendar day in Karachi
//   hm       "HH:MM"       a time of day in Karachi
//   instant  Date          a moment (what Prisma stores)
//
// Pure — no imports — so the browser uses the same helpers.

export const HR_TIMEZONE = "Asia/Karachi";
export const HR_UTC_OFFSET_MINUTES = 5 * 60;

const pad = (n) => String(n).padStart(2, "0");
const MS_MIN = 60 * 1000;
const MS_DAY = 24 * 60 * MS_MIN;

/** "08:30" → 510; anything that is not a valid time → null. */
export function hmToMinutes(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 510 → "08:30" (wraps past midnight). */
export function minutesToHm(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Loose time entry → "HH:MM": "8" → 08:00, "830" → 08:30, "8.3" → 08:30, "17:5" → 17:05. */
export function normalizeHm(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  let h, m;
  if (/^\d{1,2}$/.test(s)) [h, m] = [Number(s), 0];
  else if (/^\d{3,4}$/.test(s)) [h, m] = [Number(s.slice(0, -2)), Number(s.slice(-2))];
  else {
    const parts = /^(\d{1,2})[:.](\d{1,2})$/.exec(s);
    if (!parts) return null;
    h = Number(parts[1]);
    // "8.3" is 08:30 as typed on the legacy screens; "17:5" is 17:05.
    m = s.includes(".") && parts[2].length === 1 ? Number(parts[2]) * 10 : Number(parts[2]);
  }
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** Is this a "YYYY-MM-DD" that names a real day? */
export function isDayKey(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""))) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The Karachi day an instant falls on. */
export function dayKeyOf(instant) {
  const t = new Date(new Date(instant).getTime() + HR_UTC_OFFSET_MINUTES * MS_MIN);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Today in Karachi. */
export const todayKey = () => dayKeyOf(new Date());

/** The Karachi time of day of an instant, "HH:MM". */
export function hmOf(instant) {
  if (!instant) return null;
  const t = new Date(new Date(instant).getTime() + HR_UTC_OFFSET_MINUTES * MS_MIN);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Karachi day + minutes after its midnight (may exceed 1440) → instant. */
export function instantAt(dayKey, minutes) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + (minutes - HR_UTC_OFFSET_MINUTES) * MS_MIN);
}

/** Karachi wall-clock parts (as a device or a file gives them) → instant. */
export function instantFromWall(y, mo, d, h = 0, mi = 0, s = 0) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - HR_UTC_OFFSET_MINUTES * MS_MIN);
}

/** Midnight UTC of a day key — what a Prisma @db.Date column takes and returns. */
export function dbDay(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** A @db.Date value read back from Prisma → day key. */
export const dayKeyOfDb = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

export function addDays(dayKey, n) {
  return new Date(dbDay(dayKey).getTime() + n * MS_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (dayKey) => dbDay(dayKey).getUTCDay();

/** Every day key from `from` to `to`, inclusive. */
export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whole days from a to b (b − a). */
export const daysBetween = (a, b) => Math.round((dbDay(b) - dbDay(a)) / MS_DAY);

/** "2026-10" → { from: "2026-10-01", to: "2026-10-31" }; null when invalid. */
export function monthRange(monthKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${pad(last)}` };
}

export const WEEKDAYS = [
  { value: 0, short: "Sun", label: "Sunday" },
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
];

/** 125 → "2h 05m"; 0 → "—". */
export function fmtMinutes(min) {
  const n = Math.max(0, Math.round(Number(min) || 0));
  if (!n) return "—";
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}
