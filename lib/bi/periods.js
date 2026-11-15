// lib/bi/periods.js — dashboard periods. Pure (no imports), shared by the
// engine, the API and the period bar, so every part reads a period the same way.
//
// A period is one short string:
//   today · yday · w7 · mtd · pm · ytd · m3 · m6 · m12 · all
//   custom:YYYY-MM-DD:YYYY-MM-DD   (Pick dates; one day = the same date twice)
// parsePeriod() turns it into { from, to } plus the ranges it is compared
// with: the previous period of the same length, and the same dates last year.

/** The period bar, in order. m3 / m6 stay valid (Designer defaults). */
export const BAR_PERIODS = ["today", "yday", "w7", "mtd", "pm", "ytd", "m12"];

export const PERIOD_INFO = {
  today: { label: "Today", short: "Today", key: "t" },
  yday: { label: "Yesterday", short: "Yesterday", key: "y" },
  w7: { label: "Last 7 days", short: "7 days" },
  mtd: { label: "This month", short: "This month", key: "m" },
  pm: { label: "Last month", short: "Last month" },
  ytd: { label: "Year to date", short: "Year" },
  m3: { label: "Last 3 months", short: "3 months" },
  m6: { label: "Last 6 months", short: "6 months" },
  m12: { label: "Last 12 months", short: "12 months" },
  all: { label: "All time", short: "All time" },
};

/** Longest custom range: 3 years. */
export const MAX_CUSTOM_DAYS = 3 * 366;

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-12" for a local date. */
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local date from "2026-11-12", or null. */
export function fromDayKey(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/** Whole days in a range (inclusive). */
export const rangeDays = (r) => Math.round((startOfDay(r.to) - startOfDay(r.from)) / DAY) + 1;

/** The same dates a year earlier (29 Feb → 28 Feb). */
function lastYear(r) {
  const shift = (d, end) => {
    const y = d.getFullYear() - 1;
    const last = new Date(y, d.getMonth() + 1, 0).getDate();
    const nd = new Date(y, d.getMonth(), Math.min(d.getDate(), last));
    return end ? endOfDay(nd) : startOfDay(nd);
  };
  return { from: shift(r.from, false), to: shift(r.to, true) };
}

/** The period just before, of the same length (calendar months stay months). */
function previous(key, r) {
  if (key === "pm") return { from: new Date(r.from.getFullYear(), r.from.getMonth() - 1, 1), to: new Date(r.from.getFullYear(), r.from.getMonth(), 0, 23, 59, 59, 999) };
  if (key === "mtd") {
    const f = new Date(r.from.getFullYear(), r.from.getMonth() - 1, 1);
    const lastDay = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
    return { from: f, to: endOfDay(new Date(f.getFullYear(), f.getMonth(), Math.min(r.to.getDate(), lastDay))) };
  }
  if (key === "ytd") return lastYear(r);
  const n = rangeDays(r);
  return { from: startOfDay(addDays(r.from, -n)), to: endOfDay(addDays(r.from, -1)) };
}

/**
 * Read a period string. Returns null for "all" (no date limit) or an invalid
 * string; otherwise { key, from, to, days, prev, ly, custom }.
 */
export function parsePeriod(str, now = new Date()) {
  const s = String(str || "");
  const y = now.getFullYear();
  const m = now.getMonth();
  let range = null;
  let key = s;
  if (s.startsWith("custom:")) {
    const [, a, b] = s.split(":");
    const from = fromDayKey(a);
    const to = fromDayKey(b);
    if (!from || !to || from > to || to > endOfDay(now)) return null;
    range = { from: startOfDay(from), to: endOfDay(to) };
    if (rangeDays(range) > MAX_CUSTOM_DAYS) return null;
    key = "custom";
  } else {
    const monthsBack = (n) => ({ from: new Date(y, m - (n - 1), 1), to: endOfDay(now) });
    switch (s) {
      case "today": range = { from: startOfDay(now), to: endOfDay(now) }; break;
      case "yday": { const d = addDays(now, -1); range = { from: startOfDay(d), to: endOfDay(d) }; break; }
      case "w7": range = { from: startOfDay(addDays(now, -6)), to: endOfDay(now) }; break;
      case "mtd": range = { from: new Date(y, m, 1), to: endOfDay(now) }; break;
      case "pm": range = { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59, 999) }; break;
      case "ytd": range = { from: new Date(y, 0, 1), to: endOfDay(now) }; break;
      case "m3": range = monthsBack(3); break;
      case "m6": range = monthsBack(6); break;
      case "m12": range = monthsBack(12); break;
      default: return null;
    }
  }
  return { key, ...range, days: rangeDays(range), prev: previous(key, range), ly: lastYear(range), custom: key === "custom" };
}

/** True for a period the API accepts. */
export const isValidPeriod = (s, now = new Date()) => s === "all" || Boolean(parsePeriod(s, now));

/** "custom:2026-11-01:2026-11-12" */
export const customPeriod = (from, to) => `custom:${dayKey(from)}:${dayKey(to)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Thu 12 Nov 2026" · "1 – 12 Nov 2026" · "28 Oct – 3 Nov 2026" · "Oct 2025 – Nov 2026" */
export function rangeText(r, { weekday = true, year = true } = {}) {
  if (!r) return "";
  const a = r.from;
  const b = r.to;
  const yr = (d) => (year ? ` ${d.getFullYear()}` : "");
  if (dayKey(a) === dayKey(b)) return `${weekday ? `${WEEKDAYS[a.getDay()]} ` : ""}${a.getDate()} ${MONTHS[a.getMonth()]}${yr(a)}`;
  const wholeMonths = a.getDate() === 1 && b.getDate() === new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate();
  if (wholeMonths && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${MONTHS[a.getMonth()]}${yr(a)}`;
  if (a.getFullYear() !== b.getFullYear()) return `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS[b.getMonth()]}${yr(b)}`;
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]}${yr(b)}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}${yr(b)}`;
}

/** Title for a period: "Yesterday", "Custom range"… */
export const periodTitle = (str) => (String(str).startsWith("custom:") ? "Selected dates" : PERIOD_INFO[str]?.label ?? str);

/** Short label for the bar / chip. */
export function periodShort(str, now = new Date()) {
  if (String(str).startsWith("custom:")) return rangeText(parsePeriod(str, now), { weekday: false, year: false });
  return PERIOD_INFO[str]?.short ?? str;
}

/**
 * A monthly target spread over the period's days: each day counts
 * 1 / (days in its month). 650 m a month → 21 m for one November day.
 */
export function prorateMonthly(monthly, r) {
  const t = Number(monthly);
  if (!t || !r) return null;
  let share = 0;
  for (let d = startOfDay(r.from); d <= r.to; d = addDays(d, 1)) {
    share += 1 / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }
  return t * share;
}
