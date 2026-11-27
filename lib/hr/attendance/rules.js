// lib/hr/attendance/rules.js — what a day's attendance comes to.
//
// One pure function (computeDay) turns a shift, a day and the in / out times
// into a status and minutes. The daily register, device sync, file import,
// the monthly sheet and (later) payroll all go through it, so a rule is only
// ever written once. No database, no imports beyond the clock — the browser
// previews a row with exactly what the server will save.
//
// Rules, all set per shift on HR → Shifts:
//   late          in after start + grace          → LATE (late_minutes = full lateness)
//   very late     late more than half_day_late    → HALF_DAY
//   short day     worked < half_day_minutes        → ABSENT
//                 worked < full-day minimum        → HALF_DAY
//                 (full-day minimum = full_day_minutes, or shift length − break − 2h)
//   early out     out before end − early grace    → early_minutes (counts toward the
//                                                    lates cut when early_counts_as_late)
//   overtime      out ≥ end + overtime_after       → overtime_minutes = out − end
//   week-off / holiday worked (no swap)            → PRESENT + comp-off earned (1 / ½), or all
//                                                    worked time is overtime (shift off_day_work OVERTIME)
//   one punch only on a finished day               → needs_review
// Every N lates (lates_per_day_cut) in a month cost one day (monthSummary).
import { hmToMinutes, instantAt, todayKey } from "@/lib/hr/time";

export const STATUS = {
  PRESENT: "PRESENT",
  LATE: "LATE",
  HALF_DAY: "HALF_DAY",
  ABSENT: "ABSENT",
  LEAVE: "LEAVE",
  OFF: "OFF",
  HOLIDAY: "HOLIDAY",
  PENDING: "PENDING", // today / future with nothing recorded — never stored
};

// Display: short code for the monthly sheet, colours for chips and cells.
export const STATUS_META = {
  PRESENT: { label: "Present", short: "P", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", cell: "bg-emerald-500 text-white", dot: "bg-emerald-500" },
  LATE: { label: "Late", short: "L", chip: "bg-amber-50 text-amber-700 ring-amber-600/25", cell: "bg-amber-400 text-amber-950", dot: "bg-amber-400" },
  HALF_DAY: { label: "Half day", short: "H", chip: "bg-orange-50 text-orange-700 ring-orange-600/20", cell: "bg-orange-500 text-white", dot: "bg-orange-500" },
  ABSENT: { label: "Absent", short: "A", chip: "bg-red-50 text-red-700 ring-red-600/20", cell: "bg-red-500 text-white", dot: "bg-red-500" },
  LEAVE: { label: "Leave", short: "LV", chip: "bg-sky-50 text-sky-700 ring-sky-600/20", cell: "bg-sky-500 text-white", dot: "bg-sky-500" },
  OFF: { label: "Week off", short: "O", chip: "bg-slate-100 text-slate-600 ring-slate-500/20", cell: "bg-slate-200 text-slate-600", dot: "bg-slate-400" },
  HOLIDAY: { label: "Holiday", short: "HD", chip: "bg-violet-50 text-violet-700 ring-violet-600/20", cell: "bg-violet-500 text-white", dot: "bg-violet-500" },
  PENDING: { label: "Not marked", short: "·", chip: "bg-white text-slate-400 ring-slate-300", cell: "bg-white text-slate-300 ring-1 ring-inset ring-slate-200", dot: "bg-slate-300" },
};

/** Statuses a person may set by hand (LATE and PENDING are only ever computed). */
export const MANUAL_STATUSES = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE", "OFF", "HOLIDAY"];

// LEAVE = written by an approved leave request (lib/hr/leave/requests.js).
// SYSTEM = a computed day stored when payroll locked the month (lockAttendance).
export const SOURCES = { MANUAL: "MANUAL", DEVICE: "DEVICE", IMPORT: "IMPORT", LEAVE: "LEAVE", SYSTEM: "SYSTEM" };

const MS_MIN = 60 * 1000;
const FULL_DAY_TOLERANCE = 120;
// Comp-off on a week-off worked with no shift: a full day is this long.
const NO_SHIFT_FULL_DAY = 360;

/** Start / end of a shift on a day, in minutes after that day's midnight (end may pass 1440). */
export function shiftSpan(shift) {
  if (!shift) return null;
  const start = hmToMinutes(shift.start_time);
  let end = hmToMinutes(shift.end_time);
  if (start === null || end === null) return null;
  if (end <= start) end += 1440;
  return { start, end, length: end - start };
}

/**
 * The stretch of time whose punches belong to this day: 4 h before the shift
 * starts to 20 h after (one 24 h slot, so a night shift's morning punch-out
 * lands on the day it started). Without a shift: the calendar day.
 */
export function punchWindow(shift, dayKey) {
  const span = shiftSpan(shift);
  const from = span ? span.start - 240 : 0;
  return { from: instantAt(dayKey, from), to: instantAt(dayKey, from + 1440) };
}

/** In / out "HH:MM" on a day → instants, reading a night shift's small hours as the next day. */
export function entryInstants(shift, dayKey, inHm, outHm) {
  const span = shiftSpan(shift);
  let inM = inHm ? hmToMinutes(inHm) : null;
  let outM = outHm ? hmToMinutes(outHm) : null;
  // Night shift: an in time long before the shift starts (00:30 for a 19:00
  // shift) is after midnight.
  if (span && span.end > 1440 && inM !== null && inM < span.start - 240) inM += 1440;
  if (outM !== null && inM !== null && outM <= inM) {
    // A day shift (or none) with an out time typed on the 12-hour clock —
    // "6:04" for 18:04 after a 09:57 in — is the same evening, not the next
    // morning. Only when even the evening is not after the in time (or on a
    // night shift) is it the next day.
    const dayShift = !span || span.end <= 1440;
    if (dayShift && outM < 720 && outM + 720 > inM) outM += 720;
    else outM += 1440;
  }
  return {
    checkIn: inM === null ? null : instantAt(dayKey, inM),
    checkOut: outM === null ? null : instantAt(dayKey, outM),
  };
}

/** Full-day minimum for a shift, in minutes worked. */
export function fullDayMinutes(shift) {
  const span = shiftSpan(shift);
  if (!span) return 0;
  if (shift.full_day_minutes > 0) return shift.full_day_minutes;
  return Math.max(0, span.length - (shift.break_minutes || 0) - FULL_DAY_TOLERANCE);
}

const minutesInto = (instant, dayKey) => Math.round((new Date(instant) - instantAt(dayKey, 0)) / MS_MIN);

/**
 * @param {object}  a
 * @param {object?} a.shift        hr_shifts row (null = no shift: no late / overtime rules)
 * @param {string}  a.dayKey       "YYYY-MM-DD"
 * @param {string}  a.dayType      "WORK" | "OFF" | "HOLIDAY"
 * @param {Date?}   a.checkIn
 * @param {Date?}   a.checkOut
 * @param {string?} a.manualStatus a status set by a person (wins over the computed one)
 * @param {string?} a.today        today's key (tests pass it; defaults to Karachi today)
 */
export function computeDay({ shift, dayKey, dayType = "WORK", checkIn = null, checkOut = null, manualStatus = null, today = todayKey() }) {
  const out = { status: STATUS.ABSENT, late_minutes: 0, early_minutes: 0, worked_minutes: 0, overtime_minutes: 0, needs_review: false };
  const span = shiftSpan(shift);

  let inM = checkIn ? minutesInto(checkIn, dayKey) : null;
  let outM = checkOut ? minutesInto(checkOut, dayKey) : null;
  if (inM !== null && outM !== null && outM <= inM) {
    // Out not after in: keep the in time, flag the day for someone to look at.
    outM = null;
    out.needs_review = true;
  }
  if (inM !== null && outM === null && dayKey < today) out.needs_review = true;

  if (inM !== null && outM !== null) {
    const spanWorked = outM - inM;
    // The break is only taken out of a stretch long enough to have had one.
    const brk = span && spanWorked > span.length / 2 ? shift.break_minutes || 0 : 0;
    out.worked_minutes = Math.max(0, spanWorked - brk);
  }

  // Worked on a week-off or holiday (no planned swap): present, and either a
  // comp-off day is earned (shift.off_day_work COMP_OFF, the default — a full
  // day earns 1, half a day ½) or every minute is overtime (OVERTIME).
  out.comp_off_earned = 0;
  if (dayType !== "WORK") {
    if (inM === null) {
      out.status = dayType === "HOLIDAY" ? STATUS.HOLIDAY : STATUS.OFF;
      out.needs_review = false;
    } else {
      out.status = STATUS.PRESENT;
      if (shift?.off_day_work === "OVERTIME") {
        if (shift.overtime_enabled) out.overtime_minutes = out.worked_minutes;
      } else {
        const full = shift ? fullDayMinutes(shift) : NO_SHIFT_FULL_DAY;
        out.comp_off_earned = out.worked_minutes >= full ? 1 : out.worked_minutes >= full / 2 ? 0.5 : 0;
      }
    }
    if (manualStatus) out.status = manualStatus;
    return out;
  }

  if (inM === null) {
    out.status = dayKey >= today ? STATUS.PENDING : STATUS.ABSENT;
    out.needs_review = false;
    if (manualStatus) out.status = manualStatus;
    return out;
  }

  if (!span) {
    out.status = STATUS.PRESENT;
    if (manualStatus) out.status = manualStatus;
    return out;
  }

  const late = Math.max(0, inM - span.start);
  if (late > (shift.grace_minutes || 0)) out.late_minutes = late;

  if (outM !== null) {
    const early = Math.max(0, span.end - outM);
    if (early > (shift.early_grace_minutes || 0)) out.early_minutes = early;
    const extra = outM - span.end;
    if (shift.overtime_enabled && extra > 0 && extra >= (shift.overtime_after_minutes || 0)) out.overtime_minutes = extra;
  }

  let status = out.late_minutes ? STATUS.LATE : STATUS.PRESENT;
  if (shift.half_day_late_minutes > 0 && late > shift.half_day_late_minutes) status = STATUS.HALF_DAY;
  if (outM !== null) {
    if (shift.half_day_minutes > 0 && out.worked_minutes < shift.half_day_minutes) status = STATUS.ABSENT;
    else if (out.worked_minutes < fullDayMinutes(shift)) status = STATUS.HALF_DAY;
  }
  out.status = manualStatus || status;
  return out;
}

/** Week-off days for an employee's assignment: its override, else the shift's. */
export const weekOffOf = (assignment, shift) =>
  assignment?.week_off_override ? assignment.week_off_days || [] : shift?.week_off_days || [0];

/**
 * A month (or any range) of resolved days for one employee → totals.
 * `days` are { status, late_minutes, early_minutes, overtime_minutes, worked_minutes,
 * holiday_paid?, leave_half?, leave_paid? }. A half-day leave is ½ leave and ½ worked.
 * `shift` is the one whose lates_per_day_cut applies (the latest in the range).
 */
export function monthSummary(days, shift) {
  const t = { PRESENT: 0, LATE: 0, HALF_DAY: 0, ABSENT: 0, LEAVE: 0, OFF: 0, HOLIDAY: 0, PENDING: 0 };
  let lateMinutes = 0, earlyCount = 0, overtime = 0, worked = 0, unpaidHolidays = 0;
  let paidLeave = 0, unpaidLeave = 0;
  for (const d of days) {
    if (d.status === STATUS.LEAVE) {
      const share = d.leave_half ? 0.5 : 1;
      t.LEAVE += share;
      if (d.leave_paid === false) unpaidLeave += share;
      else paidLeave += share;
      if (d.leave_half) t.PRESENT += 0.5; // worked the other half
      continue;
    }
    t[d.status] = (t[d.status] || 0) + 1;
    lateMinutes += d.late_minutes || 0;
    if (d.early_minutes > 0 && d.status !== STATUS.HALF_DAY && d.status !== STATUS.ABSENT) earlyCount += 1;
    overtime += d.overtime_minutes || 0;
    worked += d.worked_minutes || 0;
    if (d.status === STATUS.HOLIDAY && d.holiday_paid === false) unpaidHolidays += 1;
  }
  const lateMarks = t.LATE + (shift?.early_counts_as_late === false ? 0 : earlyCount);
  const perDay = shift?.lates_per_day_cut || 0;
  const lateCutDays = perDay > 0 ? Math.floor(lateMarks / perDay) : 0;
  const paidDays = t.PRESENT + t.LATE + t.OFF + (t.HOLIDAY - unpaidHolidays) + paidLeave + t.HALF_DAY * 0.5 - lateCutDays;
  return {
    counts: t,
    days: days.length,
    lateMarks,
    lateMinutes,
    lateCutDays,
    paidLeave,
    unpaidLeave,
    overtimeMinutes: overtime,
    workedMinutes: worked,
    paidDays: Math.max(0, paidDays),
  };
}
