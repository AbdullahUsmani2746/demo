// lib/hr/leave/requests.js — leave applications.
//
//   planLeave()     validate an application and work out the days it takes
//                   (week-offs / holidays left out unless the type counts them)
//   applyApproved() write an approved request's days to attendance (status
//                   LEAVE, source LEAVE) — through saveEntries, so the balance
//                   check and locked days apply as everywhere else
//   withdrawLeave() take an approved leave back off attendance; days the
//                   machine had recorded are rebuilt from the punches
//
// Approving happens in the Approvals inbox (lib/hr/approvals.js, doc type
// hrLeave) or with the same call from the Leave screen.
import prisma from "@/lib/prisma";
import { assertLeaveFits, LeaveError, leaveYearStart } from "@/lib/hr/leave/balance";
import { fmtDays, leaveYearLabel, leaveYearOf } from "@/lib/hr/leave/policy";
import { dayTypeOf, loadContext } from "@/lib/hr/attendance/sheet";
import { normalizeEntries, rebuildFromPunches, saveEntries } from "@/lib/hr/attendance/save";
import { SOURCES } from "@/lib/hr/attendance/rules";
import { daysBetween, dayKeyOfDb, dbDay, eachDay, isDayKey } from "@/lib/hr/time";
import { employeeName } from "@/lib/hr/access";

/** Days of a leave that count, for an employee and type. */
export function countedDays(ctx, employeeId, from, to, type) {
  return eachDay(from, to).filter((d) => type.count_off_days || dayTypeOf(ctx, employeeId, d) === "WORK");
}

/**
 * Validate an application. Returns what it would take; throws LeaveError.
 * @returns {{ employee, type, from, to, half_day, dates: string[], days: number, year, startMonth }}
 */
export async function planLeave({ employee_id, leave_type_id, from, to, half_day, ignoreRequestId = null }) {
  const employeeId = Number(employee_id);
  const typeId = Number(leave_type_id);
  if (!Number.isInteger(employeeId)) throw new LeaveError("Pick the employee.");
  if (!Number.isInteger(typeId)) throw new LeaveError("Pick the leave type.");
  if (!isDayKey(from)) throw new LeaveError("From must be a date.");
  const end = to && isDayKey(to) ? to : from;
  if (end < from) throw new LeaveError("To is before From.");
  if (daysBetween(from, end) > 365) throw new LeaveError("A leave cannot be longer than a year — split it.");
  const half = Boolean(half_day);
  if (half && end !== from) throw new LeaveError("A half day is a single day — From and To must be the same.");

  const [type, startMonth] = await Promise.all([prisma.hrLeaveType.findUnique({ where: { id: typeId } }), leaveYearStart()]);
  if (!type) throw new LeaveError("Leave type not found.", 404);
  if (!type.is_active) throw new LeaveError(`${type.name} is switched off.`);
  if (half && !type.allow_half_day) throw new LeaveError(`${type.name} cannot be taken as a half day.`);
  const year = leaveYearOf(from, startMonth);
  if (leaveYearOf(end, startMonth) !== year) {
    throw new LeaveError(`A leave cannot run into the next leave year (${leaveYearLabel(year + 1, startMonth)}) — apply for each year separately.`);
  }

  const ctx = await loadContext({ employeeWhere: { id: employeeId }, from, to: end });
  const employee = ctx.employees[0];
  if (!employee) throw new LeaveError("This employee is not employed on these dates.");
  if (dayKeyOfDb(employee.hireDate) > from || (employee.dor && dayKeyOfDb(employee.dor) < end)) {
    throw new LeaveError(`${employeeName(employee)} is not employed for the whole of these dates.`);
  }
  if (type.gender && type.gender !== (await prisma.employee.findUnique({ where: { id: employeeId }, select: { gender: true } }))?.gender) {
    throw new LeaveError(`${type.name} is for ${type.gender.toLowerCase()} employees only.`);
  }

  const dates = countedDays(ctx, employeeId, from, end, type);
  if (!dates.length) throw new LeaveError("Every day of this leave is a week-off or holiday — there is nothing to take.");
  const days = half ? 0.5 : dates.length;
  if (type.max_days_per_request && days > type.max_days_per_request) {
    throw new LeaveError(`${type.name} allows at most ${fmtDays(type.max_days_per_request)} day(s) per application.`);
  }

  // Not over another leave, and not over days payroll has locked.
  const clash = await prisma.hrLeaveRequest.findFirst({
    where: {
      employee_id: employeeId,
      status: { in: ["pending", "approved"] },
      from_date: { lte: dbDay(end) },
      to_date: { gte: dbDay(from) },
      ...(ignoreRequestId ? { NOT: { id: ignoreRequestId } } : {}),
    },
    include: { leaveType: { select: { name: true } } },
  });
  if (clash) {
    throw new LeaveError(
      `${employeeName(employee)} already has ${clash.leaveType.name} ${dayKeyOfDb(clash.from_date)}${clash.to_date > clash.from_date ? ` → ${dayKeyOfDb(clash.to_date)}` : ""} (${clash.status}, #L-${clash.id}).`,
      409,
    );
  }
  for (const d of dates) {
    const row = ctx.rowOf.get(`${employeeId}|${d}`);
    if (row?.locked) throw new LeaveError(`${d} is locked — payroll for it has been posted.`, 409);
    if (row?.leave_type_id && row.leave_request_id !== ignoreRequestId) {
      throw new LeaveError(`${d} is already marked as leave in the attendance register.`, 409);
    }
  }
  return { employee, type, from, to: end, half_day: half, dates, days, year, startMonth };
}

/** Balance check for a plan (pending of others counted; this request excluded). */
export const assertPlanFits = (plan, excludeRequestId = null) =>
  assertLeaveFits(
    plan.dates.map((d) => ({ employee_id: plan.employee.id, leave_type_id: plan.type.id, date: d, half: plan.half_day })),
    { excludeRequestId },
  );

/** Write an approved request's days to attendance and mark it approved. */
export async function applyApproved(leaveRequestId, { actor, note = null }) {
  const lr = await prisma.hrLeaveRequest.findUnique({ where: { id: leaveRequestId } });
  if (!lr) throw new LeaveError("Leave request not found.", 404);
  if (lr.status !== "pending") throw new LeaveError(`Leave #L-${lr.id} is already ${lr.status}.`, 409);
  const plan = await planLeave({
    employee_id: lr.employee_id,
    leave_type_id: lr.leave_type_id,
    from: dayKeyOfDb(lr.from_date),
    to: dayKeyOfDb(lr.to_date),
    half_day: lr.half_day,
    ignoreRequestId: lr.id,
  });
  const entries = normalizeEntries(
    plan.dates.map((d) => ({
      employee_id: lr.employee_id,
      date: d,
      status: "LEAVE",
      leave_type_id: lr.leave_type_id,
      leave_half: lr.half_day,
      leave_request_id: lr.id,
      remarks: `${plan.type.name} #L-${lr.id}${lr.reason ? ` — ${lr.reason}` : ""}`.slice(0, 300),
    })),
    { internal: true },
  );
  await saveEntries({ entries, actor, source: SOURCES.LEAVE, excludeRequestId: lr.id });
  await prisma.hrLeaveRequest.update({
    where: { id: lr.id },
    data: { status: "approved", days: plan.days, decided_by: actor, decided_at: new Date(), decision_note: note },
  });
  return { days: plan.days, type: plan.type };
}

/** Take an approved leave off attendance (cancel after approval). */
export async function withdrawLeave(lr, { actor }) {
  const rows = await prisma.hrAttendance.findMany({ where: { leave_request_id: lr.id }, select: { id: true, date: true, locked: true } });
  if (rows.some((r) => r.locked)) throw new LeaveError("Payroll has been posted for some of these days — this leave can no longer be cancelled.", 409);
  await prisma.hrAttendance.deleteMany({ where: { leave_request_id: lr.id, locked: false } });
  if (rows.length) {
    const days = rows.map((r) => dayKeyOfDb(r.date)).sort();
    await rebuildFromPunches({ employeeIds: [lr.employee_id], from: days[0], to: days[days.length - 1], actor });
  }
  return rows.length;
}
