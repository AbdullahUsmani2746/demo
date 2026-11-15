// lib/salesTargets/monthKey.js
// ============================================================
// Month helpers for the sales-target family (Sales Targets screen, the
// month-end lock, the Sales Team MIS snapshot cron in instrumentation.js).
//
// The business runs on Pakistan time; the server may not. "Which month just
// ended" must be read in Asia/Karachi, never from new Date() in the server's
// own zone — at 02:30 PKT on the 1st a UTC server is still on the previous
// day, so the cron used to lock the month BEFORE the one that ended.
//
// Pure functions, no imports (safe to load from instrumentation.js).
// ============================================================

/** CustomerMonthlyTarget.dated for a month (1-12): the 1st, 00:00 UTC. */
export const targetMonthKey = (year, month) => new Date(Date.UTC(Number(year), Number(month) - 1, 1));

/** The month containing a date string / Date, as { year, month } — by its calendar date. */
export function monthOf(dateLike) {
  const s = typeof dateLike === "string" ? dateLike : new Date(dateLike).toISOString();
  const [y, m] = s.slice(0, 10).split("-").map(Number);
  return { year: y, month: m };
}

/** Today's year / month / day in Pakistan time (where the business runs). */
export function karachiNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date())
    .reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** The month before the current Pakistan-time month. */
export function previousMonthKarachi() {
  const { year, month } = karachiNow();
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** True once a month has fully ended (Pakistan time). */
export function monthHasEnded(year, month) {
  const now = karachiNow();
  return now.year > year || (now.year === year && now.month > month);
}
