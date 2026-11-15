// lib/hr/shifts.js — validating shifts and shift assignments from the screens.
import { hmToMinutes, isDayKey, normalizeHm } from "@/lib/hr/time";

export class ShiftError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const int = (v, label, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ShiftError(`${label}: enter a whole number from ${min} to ${max}.`);
  return n;
};

export const weekDays = (v) => {
  const list = Array.isArray(v) ? v : [];
  const out = [...new Set(list.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (out.length !== list.length) throw new ShiftError("Week-off days must be 0 (Sunday) to 6 (Saturday), each once.");
  if (out.length === 7) throw new ShiftError("A shift needs at least one working day.");
  return out;
};

/** Body from the shift form → hr_shifts data. */
export function shiftData(b) {
  const code = String(b?.code ?? "").trim().toUpperCase();
  const name = String(b?.name ?? "").trim();
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) throw new ShiftError("Code: 1–20 letters, digits, - or _.");
  if (!name || name.length > 100) throw new ShiftError("Name is required (100 characters at most).");
  const start_time = normalizeHm(b.start_time);
  const end_time = normalizeHm(b.end_time);
  if (!start_time) throw new ShiftError("Start time is not a valid time.");
  if (!end_time) throw new ShiftError("End time is not a valid time.");
  if (start_time === end_time) throw new ShiftError("Start and end cannot be the same time.");
  let length = hmToMinutes(end_time) - hmToMinutes(start_time);
  if (length <= 0) length += 1440;
  const data = {
    code,
    name,
    start_time,
    end_time,
    break_minutes: int(b.break_minutes ?? 0, "Break", 0, 240),
    grace_minutes: int(b.grace_minutes ?? 0, "Late grace", 0, 240),
    early_grace_minutes: int(b.early_grace_minutes ?? 0, "Early-out grace", 0, 240),
    half_day_late_minutes: int(b.half_day_late_minutes ?? 0, "Half day if late by", 0, 720),
    half_day_minutes: int(b.half_day_minutes ?? 0, "Absent if worked under", 0, 1440),
    full_day_minutes: int(b.full_day_minutes ?? 0, "Full day needs", 0, 1440),
    overtime_enabled: Boolean(b.overtime_enabled),
    overtime_after_minutes: int(b.overtime_after_minutes ?? 0, "Overtime after", 0, 720),
    lates_per_day_cut: int(b.lates_per_day_cut ?? 0, "Lates per day cut", 0, 31),
    early_counts_as_late: Boolean(b.early_counts_as_late),
    week_off_days: weekDays(b.week_off_days),
    // Unplanned work on a week-off / holiday: earns a comp-off day, or overtime.
    off_day_work: b.off_day_work === "OVERTIME" ? "OVERTIME" : "COMP_OFF",
    color: /^#[0-9a-fA-F]{6}$/.test(String(b.color ?? "")) ? b.color : "#800000",
    is_active: b.is_active !== false,
  };
  if (data.break_minutes >= length) throw new ShiftError("The break is longer than the shift.");
  if (data.full_day_minutes > length) throw new ShiftError("Full day needs more minutes than the shift has.");
  if (data.half_day_minutes && data.full_day_minutes && data.half_day_minutes > data.full_day_minutes) {
    throw new ShiftError("\"Absent if worked under\" cannot be more than \"Full day needs\".");
  }
  return data;
}

/** Body from the assign dialog → { employeeIds, shift_id, effective_from, week_off_override, week_off_days }. */
export function assignmentData(b) {
  const employeeIds = [...new Set((Array.isArray(b?.employeeIds) ? b.employeeIds : []).map(Number))].filter(Number.isInteger);
  if (!employeeIds.length) throw new ShiftError("Pick at least one employee.");
  if (employeeIds.length > 2000) throw new ShiftError("Too many employees at once.");
  const shift_id = Number(b.shift_id);
  if (!Number.isInteger(shift_id)) throw new ShiftError("Pick a shift.");
  if (!isDayKey(b.effective_from)) throw new ShiftError("Effective from must be a date.");
  const week_off_override = Boolean(b.week_off_override);
  return {
    employeeIds,
    shift_id,
    effective_from: b.effective_from,
    week_off_override,
    week_off_days: week_off_override ? weekDays(b.week_off_days) : [],
  };
}
