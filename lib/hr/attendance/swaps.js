// lib/hr/attendance/swaps.js — planned off-day swaps.
//
// "Works <work_date> (a week-off or holiday), off on <off_date> instead."
// Approved (Approvals, doc type hrOffSwap) → the attendance sheet reads
// work_date as a working day (late / absent rules, no overtime, no comp-off)
// and off_date as a week-off (paid like one). Nothing is written to
// hr_attendance: every screen and payroll resolve days through
// lib/hr/attendance/sheet.js, which reads approved swaps. Any pattern is a
// set of swaps — Sunday for a Wednesday, two Sundays for a Saturday + Sunday
// another week, a whole team working one Sunday.
//
// Work NOT planned on a week-off earns comp-off instead (lib/hr/leave/compOff.js).
import prisma from "@/lib/prisma";
import { baseDayTypeOf, loadContext } from "@/lib/hr/attendance/sheet";
import { daysBetween, dayKeyOfDb, dbDay, isDayKey } from "@/lib/hr/time";
import { employeeName } from "@/lib/hr/access";

export class SwapError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const SWAP_STATUS = ["pending", "approved", "rejected", "cancelled"];

/** How far apart the two days may be: the comp-off validity (30), so both rules agree. */
async function maxGapDays() {
  const t = await prisma.hrLeaveType.findFirst({ where: { comp_off: true, is_active: true }, select: { comp_off_valid_days: true } });
  return t?.comp_off_valid_days || 30;
}

const DAY_WORD = { OFF: "a week-off", HOLIDAY: "a holiday", WORK: "a working day" };

/**
 * Validate swaps for these employees. Throws SwapError.
 * @param a.ignoreIds  swap ids being re-checked (their own dates are no clash)
 * @returns {{ employees, work_date, off_date }}
 */
export async function planSwap({ employee_ids, work_date, off_date, ignoreIds = [] }) {
  const ids = [...new Set((Array.isArray(employee_ids) ? employee_ids : [employee_ids]).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new SwapError("Pick the employee(s).");
  if (!isDayKey(work_date)) throw new SwapError("Works on: enter the date.");
  if (!isDayKey(off_date)) throw new SwapError("Off on: enter the date.");
  if (work_date === off_date) throw new SwapError("The two days must be different.");
  const gap = await maxGapDays();
  if (Math.abs(daysBetween(work_date, off_date)) > gap) {
    throw new SwapError(`The off day must be within ${gap} days of the day worked.`);
  }

  const from = work_date < off_date ? work_date : off_date;
  const to = work_date < off_date ? off_date : work_date;
  const ctx = await loadContext({ employeeWhere: { id: { in: ids } }, from, to });
  const byId = new Map(ctx.employees.map((e) => [e.id, e]));
  const clashes = await prisma.hrOffSwap.findMany({
    where: {
      employee_id: { in: ids },
      status: { in: ["pending", "approved"] },
      ...(ignoreIds.length ? { NOT: { id: { in: ignoreIds } } } : {}),
      OR: [
        { work_date: { in: [dbDay(work_date), dbDay(off_date)] } },
        { off_date: { in: [dbDay(work_date), dbDay(off_date)] } },
      ],
    },
    select: { id: true, employee_id: true, work_date: true, off_date: true, status: true },
  });

  for (const id of ids) {
    const emp = byId.get(id);
    if (!emp) throw new SwapError(`Employee #${id} is not employed on these dates.`);
    const name = employeeName(emp);
    const employed = (d) => dayKeyOfDb(emp.hireDate) <= d && (!emp.dor || dayKeyOfDb(emp.dor) >= d);
    if (!employed(work_date) || !employed(off_date)) throw new SwapError(`${name} is not employed on both days.`);
    const w = baseDayTypeOf(ctx, id, work_date);
    const o = baseDayTypeOf(ctx, id, off_date);
    if (w === "WORK") throw new SwapError(`${work_date} is already a working day for ${name} — pick their week-off or a holiday.`);
    if (o !== "WORK") throw new SwapError(`${off_date} is ${DAY_WORD[o]} for ${name} already — the off day must be a working day.`);
    const c = clashes.find((s) => s.employee_id === id);
    if (c) {
      throw new SwapError(
        `${name} already has a swap ${c.status === "pending" ? "waiting for approval" : "approved"}: works ${dayKeyOfDb(c.work_date)}, off ${dayKeyOfDb(c.off_date)} (#S-${c.id}).`,
        409,
      );
    }
    for (const d of [work_date, off_date]) {
      const row = ctx.rowOf.get(`${id}|${d}`);
      if (row?.locked) throw new SwapError(`${d} is locked for ${name} — payroll for it has been posted.`, 409);
    }
    const offRow = ctx.rowOf.get(`${id}|${off_date}`);
    if (offRow?.leave_type_id) throw new SwapError(`${name} is on leave on ${off_date} — cancel the leave first.`, 409);
  }
  return { employees: ctx.employees, work_date, off_date };
}

/** Approve pending swaps (re-checked first). Returns how many. */
export async function approveSwaps(swapIds, { actor, note = null }) {
  const swaps = await prisma.hrOffSwap.findMany({ where: { id: { in: swapIds } } });
  if (!swaps.length) throw new SwapError("Swap not found.", 404);
  const notPending = swaps.find((s) => s.status !== "pending");
  if (notPending) throw new SwapError(`Swap #S-${notPending.id} is already ${notPending.status}.`, 409);
  const first = swaps[0];
  await planSwap({
    employee_ids: swaps.map((s) => s.employee_id),
    work_date: dayKeyOfDb(first.work_date),
    off_date: dayKeyOfDb(first.off_date),
    ignoreIds: swaps.map((s) => s.id),
  });
  const r = await prisma.hrOffSwap.updateMany({
    where: { id: { in: swaps.map((s) => s.id) }, status: "pending" },
    data: { status: "approved", decided_by: actor, decided_at: new Date(), decision_note: note },
  });
  return r.count;
}

/** Take an approved swap back (the days return to normal). */
export async function withdrawSwap(swap, { actor, note }) {
  const locked = await prisma.hrAttendance.count({
    where: { employee_id: swap.employee_id, date: { in: [swap.work_date, swap.off_date] }, locked: true },
  });
  if (locked) throw new SwapError("Payroll has been posted for one of these days — this swap can no longer be cancelled.", 409);
  await prisma.hrOffSwap.update({
    where: { id: swap.id },
    data: { status: "cancelled", decided_by: actor, decided_at: new Date(), decision_note: note },
  });
}
