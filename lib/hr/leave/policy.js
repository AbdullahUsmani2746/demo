// lib/hr/leave/policy.js — leave years and entitlement. Pure: the server and
// the screens compute the same numbers.
//
// Leave year: starts on the 1st of `startMonth` (Settings
// hr.leave.year_start_month); its label is the calendar year it starts in.
//
// Entitlement of a type for one employee in one leave year:
//   · gender-limited types (maternity …) → 0 for everyone else
//   · usable only once `min_service_days` from the hire date have passed
//   · YEARLY accrual: the full annual_days at once — a joiner (or someone who
//     becomes eligible) during the year gets the months left (prorate_joiners)
//   · MONTHLY accrual: annual_days / 12 for each month started, up to `asOf`
//   Rounded down to half days.
import { addDays } from "@/lib/hr/time";

const pad = (n) => String(n).padStart(2, "0");

export const LEAVE_REQUEST_STATUS = {
  pending: { label: "Pending", chip: "bg-amber-50 text-amber-700 ring-amber-600/25" },
  approved: { label: "Approved", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  rejected: { label: "Rejected", chip: "bg-red-50 text-red-700 ring-red-600/20" },
  cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-500 ring-slate-500/20" },
};

/** { from, to } day keys of leave year `year`. */
export function leaveYearRange(year, startMonth = 1) {
  const from = `${year}-${pad(startMonth)}-01`;
  return { from, to: addDays(`${year + 1}-${pad(startMonth)}-01`, -1) };
}

/** The leave year a day falls in. */
export function leaveYearOf(dayKey, startMonth = 1) {
  const y = Number(dayKey.slice(0, 4));
  return Number(dayKey.slice(5, 7)) >= startMonth ? y : y - 1;
}

/** "2026" or "2026–27" for a July-start year. */
export const leaveYearLabel = (year, startMonth = 1) => (startMonth === 1 ? String(year) : `${year}–${String(year + 1).slice(2)}`);

/** Months from a's month to b's month, both counted (Jan → Mar = 3). */
function monthsInclusive(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))) + 1;
}

const halfDown = (n) => Math.max(0, Math.floor(n * 2 + 1e-9) / 2);

/**
 * @param {object} type      hr_leave_types row
 * @param {object} emp       { hireDate: "YYYY-MM-DD", gender }
 * @param {object} range     leaveYearRange()
 * @param {string} asOf      day key (MONTHLY accrual counts months up to here)
 */
export function entitlement(type, emp, range, asOf) {
  if (type.gender && type.gender !== emp.gender) return 0;
  const base = Number(type.annual_days) || 0;
  if (base <= 0) return 0;
  const eligible = addDays(emp.hireDate, type.min_service_days || 0);
  if (eligible > range.to) return 0;
  const start = eligible > range.from ? eligible : range.from;
  if (type.accrual === "MONTHLY") {
    const end = asOf < range.to ? asOf : range.to;
    if (end < start) return 0;
    return Math.min(base, halfDown((base * monthsInclusive(start, end)) / 12));
  }
  if (type.prorate_joiners && start > range.from) return halfDown((base * monthsInclusive(start, range.to)) / 12);
  return base;
}

/** Days one attendance row of leave uses. */
export const rowLeaveDays = (row) => (row.leave_half ? 0.5 : 1);

/** "1", "0.5", "2.5" — days without float noise. */
export const fmtDays = (n) => {
  const v = Math.round((Number(n) || 0) * 2) / 2;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};
