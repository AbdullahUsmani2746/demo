// lib/hr/attendance/sheet.js — attendance as it stands, for any set of days.
//
// Only days with something recorded are stored (hr_attendance). Everything
// else is worked out here, the same way for every screen and for payroll:
//   · a day before the hire date or after the leaving date → not employed
//   · a holiday or the employee's week-off with no punch     → HOLIDAY / OFF
//   · an approved off-day swap (hr_off_swaps) moves the off: its work_date
//     is a working day, its off_date a week-off (lib/hr/attendance/swaps.js)
//   · worked a week-off / holiday without a swap → comp_off_earned (1 or ½)
//     when the shift says COMP_OFF (lib/hr/leave/compOff.js spends it)
//   · a working day with no record                           → ABSENT (PENDING today)
// A stored row is re-computed from its times with today's shift rules, so a
// rule change applies to every open day. Locked rows (payroll posted) and
// statuses set by hand stay exactly as saved.
import prisma from "@/lib/prisma";
import { computeDay, weekOffOf } from "@/lib/hr/attendance/rules";
import { dayKeyOfDb, dbDay, eachDay, weekdayOf } from "@/lib/hr/time";
import { employeeName } from "@/lib/hr/access";

export const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  middleName: true,
  surname: true,
  status: true,
  hireDate: true,
  dor: true,
  attendanceId: true,
  photographUrl: true,
  departmentId: true,
  department: { select: { dept_name: true } },
  Designation: { select: { desg_name: true } },
  workLocationId: true,
  workLocation: { select: { location_name: true } },
};

export const SHIFT_SELECT = {
  id: true, code: true, name: true, start_time: true, end_time: true, break_minutes: true,
  grace_minutes: true, early_grace_minutes: true, half_day_late_minutes: true, half_day_minutes: true,
  full_day_minutes: true, overtime_enabled: true, overtime_after_minutes: true, lates_per_day_cut: true,
  early_counts_as_late: true, week_off_days: true, off_day_work: true, color: true, is_active: true,
};

export const employeeLite = (e) => ({
  id: e.id,
  name: employeeName(e),
  department: e.department?.dept_name ?? null,
  departmentId: e.departmentId,
  designation: e.Designation?.desg_name ?? null,
  location: e.workLocation?.location_name ?? null,
  locationId: e.workLocationId ?? null,
  attendanceId: e.attendanceId,
  photo: e.photographUrl ?? null,
  active: e.status === "ACTIVE",
});

export const shiftLite = (s) => (s ? { id: s.id, code: s.code, name: s.name, start_time: s.start_time, end_time: s.end_time, color: s.color } : null);

/**
 * Everything needed to resolve these employees over [from, to].
 * @param {object} a
 * @param {object} a.employeeWhere  Prisma where on Employee (scope + filters)
 * @param {string} a.from, a.to     day keys
 */
export async function loadContext({ employeeWhere, from, to }) {
  const employees = await prisma.employee.findMany({
    // Joined the company by the end of the range, and still with it at its
    // start: active, or left (dor) on / after the first day.
    where: {
      AND: [
        employeeWhere || {},
        { hireDate: { lte: dbDay(to) } },
        { OR: [{ dor: null }, { dor: { gte: dbDay(from) } }] },
        { OR: [{ status: "ACTIVE" }, { dor: { gte: dbDay(from) } }] },
      ],
    },
    select: EMPLOYEE_SELECT,
    orderBy: [{ departmentId: "asc" }, { firstName: "asc" }, { id: "asc" }],
  });
  const ids = employees.map((e) => e.id);
  const [assignments, shifts, holidays, rows, leaveTypes, swaps] = await Promise.all([
    ids.length
      ? prisma.hrShiftAssignment.findMany({
          where: { employee_id: { in: ids }, effective_from: { lte: dbDay(to) } },
          orderBy: { effective_from: "asc" },
        })
      : [],
    prisma.hrShift.findMany({ select: SHIFT_SELECT }),
    prisma.hrHoliday.findMany({ where: { date: { gte: dbDay(from), lte: dbDay(to) } } }),
    ids.length
      ? prisma.hrAttendance.findMany({ where: { employee_id: { in: ids }, date: { gte: dbDay(from), lte: dbDay(to) } } })
      : [],
    prisma.hrLeaveType.findMany({ select: { id: true, code: true, name: true, is_paid: true, color: true } }),
    ids.length
      ? prisma.hrOffSwap.findMany({
          where: {
            employee_id: { in: ids },
            status: "approved",
            OR: [{ work_date: { gte: dbDay(from), lte: dbDay(to) } }, { off_date: { gte: dbDay(from), lte: dbDay(to) } }],
          },
          select: { id: true, employee_id: true, work_date: true, off_date: true },
        })
      : [],
  ]);
  // "emp|day" → { type: WORK | OFF, swap_id, other } for approved swaps.
  const swapOn = new Map();
  for (const s of swaps) {
    const w = dayKeyOfDb(s.work_date);
    const o = dayKeyOfDb(s.off_date);
    swapOn.set(`${s.employee_id}|${w}`, { type: "WORK", swap_id: s.id, other: o });
    swapOn.set(`${s.employee_id}|${o}`, { type: "OFF", swap_id: s.id, other: w });
  }

  const assignmentsOf = new Map();
  for (const a of assignments) {
    const k = a.employee_id;
    if (!assignmentsOf.has(k)) assignmentsOf.set(k, []);
    assignmentsOf.get(k).push({ ...a, from: dayKeyOfDb(a.effective_from) });
  }
  return {
    from,
    to,
    employees,
    assignmentsOf,
    shiftById: new Map(shifts.map((s) => [s.id, s])),
    holidayOn: new Map(holidays.map((h) => [dayKeyOfDb(h.date), h])),
    leaveTypeById: new Map(leaveTypes.map((t) => [t.id, t])),
    rowOf: new Map(rows.map((r) => [`${r.employee_id}|${dayKeyOfDb(r.date)}`, r])),
    swapOn,
  };
}

/** The assignment in force on a day (latest effective_from ≤ day), or null. */
export function assignmentOn(ctx, employeeId, dayKey) {
  const list = ctx.assignmentsOf.get(employeeId) || [];
  let hit = null;
  for (const a of list) if (a.from <= dayKey) hit = a;
  return hit;
}

/** "WORK" | "OFF" | "HOLIDAY" for an employee on a day — an approved swap first. */
export function dayTypeOf(ctx, employeeId, dayKey) {
  const swap = ctx.swapOn?.get(`${employeeId}|${dayKey}`);
  if (swap) return swap.type;
  return baseDayTypeOf(ctx, employeeId, dayKey);
}

/** The day type from holidays and the shift's week-offs alone (no swaps). */
export function baseDayTypeOf(ctx, employeeId, dayKey) {
  if (ctx.holidayOn.has(dayKey)) return "HOLIDAY";
  const a = assignmentOn(ctx, employeeId, dayKey);
  const shift = a ? ctx.shiftById.get(a.shift_id) : null;
  return weekOffOf(a, shift).includes(weekdayOf(dayKey)) ? "OFF" : "WORK";
}

const employedOn = (e, dayKey) =>
  dayKeyOfDb(e.hireDate) <= dayKey && (!e.dor || dayKeyOfDb(e.dor) >= dayKey);

/** One employee-day, resolved. `employed: false` days carry no status. */
export function resolveDay(ctx, emp, dayKey, today) {
  if (!employedOn(emp, dayKey)) return { day: dayKey, employed: false, status: null };
  const row = ctx.rowOf.get(`${emp.id}|${dayKey}`) || null;
  const assignment = assignmentOn(ctx, emp.id, dayKey);
  // The assignment in force decides (a shift re-assigned from a past date
  // re-reads those days); a locked row keeps the shift it was paid under.
  const shift = ctx.shiftById.get(row?.locked ? row.shift_id : assignment?.shift_id ?? row?.shift_id) ?? null;
  const dayType = dayTypeOf(ctx, emp.id, dayKey);
  const holiday = ctx.holidayOn.get(dayKey) || null;

  const base = {
    day: dayKey,
    employed: true,
    dayType,
    holiday: holiday ? { name: holiday.name, is_paid: holiday.is_paid } : null,
    holiday_paid: holiday ? holiday.is_paid : undefined,
    shift_id: shift?.id ?? null,
    row_id: row?.id ?? null,
    check_in: row?.check_in ?? null,
    check_out: row?.check_out ?? null,
    source: row?.source ?? null,
    remarks: row?.remarks ?? null,
    status_override: row?.status_override ?? false,
    locked: row?.locked ?? false,
    leave_type_id: row?.leave_type_id ?? null,
    leave_half: row?.leave_half ?? false,
    leave_request_id: row?.leave_request_id ?? null,
    // Approved off-day swap on this day: { type: WORK | OFF, swap_id, other } (other = the paired day).
    swap: ctx.swapOn?.get(`${emp.id}|${dayKey}`) ?? null,
    // A LEAVE with no type (should not happen) is treated as paid.
    leave_paid: row?.leave_type_id ? ctx.leaveTypeById.get(row.leave_type_id)?.is_paid !== false : true,
  };

  if (row?.locked) {
    return {
      ...base,
      status: row.status,
      late_minutes: row.late_minutes,
      early_minutes: row.early_minutes,
      worked_minutes: row.worked_minutes,
      overtime_minutes: row.overtime_minutes,
      needs_review: row.needs_review,
      // A paid (locked) day still earns its comp-off.
      comp_off_earned:
        dayType !== "WORK" && row.check_in
          ? computeDay({ shift, dayKey, dayType, checkIn: row.check_in, checkOut: row.check_out, today }).comp_off_earned
          : 0,
    };
  }
  const computed = computeDay({
    shift,
    dayKey,
    dayType,
    checkIn: row?.check_in ?? null,
    checkOut: row?.check_out ?? null,
    manualStatus: row?.status_override ? row.status : null,
    today,
  });
  return { ...base, ...computed };
}

/** Every employee × every day of the context. */
export function resolveAll(ctx, today) {
  const days = eachDay(ctx.from, ctx.to);
  return ctx.employees.map((emp) => ({
    employee: emp,
    days: days.map((d) => resolveDay(ctx, emp, d, today)),
  }));
}

/** The shift whose lates rule applies to a range: in force on its last employed day. */
export function summaryShift(ctx, emp) {
  const a = assignmentOn(ctx, emp.id, emp.dor && dayKeyOfDb(emp.dor) < ctx.to ? dayKeyOfDb(emp.dor) : ctx.to);
  return a ? ctx.shiftById.get(a.shift_id) ?? null : null;
}
