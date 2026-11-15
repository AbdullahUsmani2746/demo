// lib/hr/leave/compOff.js — comp-off days: earned by working a week-off /
// holiday without a planned swap, spent as leave of a comp_off leave type.
//
//   earned   every resolved day with comp_off_earned (1, or ½ for half a day —
//            lib/hr/attendance/rules.js computeDay, shift off_day_work COMP_OFF)
//   spent    attendance rows of the comp-off type (½ for half days) and
//            pending applications of it
//   rule     a day taken uses the OLDEST earned day that was earned BEFORE it
//            and is still valid on it (earned + comp_off_valid_days, 30)
//
// Nothing is stored: earned days come from attendance, so a corrected punch
// or a swap approved afterwards changes the balance by itself.
import prisma from "@/lib/prisma";
import { loadContext, resolveDay } from "@/lib/hr/attendance/sheet";
import { addDays, dayKeyOfDb, dbDay, eachDay, todayKey } from "@/lib/hr/time";

/** Days looked back for earned days (well past the validity, so the matching settles). */
export const COMP_OFF_LOOKBACK_DAYS = 120;
const EPS = 1e-9;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * Match uses to earned days, oldest first.
 * @param credits [{ date, days }]   earned
 * @param uses    [{ date, days }]   taken / applied for
 * @returns {{ credits: [{ date, days, left, expires }], short: [{ date, days }] }}
 */
export function matchCompOff(credits, uses, validDays) {
  const cs = credits.map((c) => ({ ...c, left: c.days, expires: addDays(c.date, validDays) })).sort(byDate);
  const short = [];
  for (const u of [...uses].sort(byDate)) {
    let need = u.days;
    for (const c of cs) {
      if (need <= EPS) break;
      if (c.left <= EPS || c.date >= u.date || u.date > c.expires) continue;
      const take = Math.min(c.left, need);
      c.left -= take;
      need -= take;
    }
    if (need > EPS) short.push({ date: u.date, days: need });
  }
  return { credits: cs, short };
}

/**
 * Earned and spent comp-off for employees.
 * @param a.type               the comp-off hr_leave_types row
 * @param a.from               first day earned days are read from
 * @param a.excludeRequestId   a request being approved (its days come as `extra`)
 * @param a.extra              [{ employee_id, date, half }] days about to be taken
 * @returns Map<employee_id, { credits, uses, short, earnedIn(range), available }>
 */
export async function compOffLedger({ employeeIds, type, from, excludeRequestId = null, extra = [] }) {
  const ids = [...new Set(employeeIds)];
  const out = new Map();
  if (!ids.length) return out;
  const today = todayKey();
  const [ctx, taken, pending] = await Promise.all([
    loadContext({ employeeWhere: { id: { in: ids } }, from, to: today }),
    prisma.hrAttendance.findMany({
      where: { employee_id: { in: ids }, leave_type_id: type.id, date: { gte: dbDay(from) } },
      select: { employee_id: true, date: true, leave_half: true },
    }),
    prisma.hrLeaveRequest.findMany({
      where: {
        employee_id: { in: ids },
        leave_type_id: type.id,
        status: "pending",
        to_date: { gte: dbDay(from) },
        ...(excludeRequestId ? { NOT: { id: excludeRequestId } } : {}),
      },
      select: { employee_id: true, from_date: true, to_date: true, half_day: true, days: true },
    }),
  ]);

  const extraDays = new Set(extra.map((e) => `${e.employee_id}|${e.date}`));
  const usesOf = new Map(ids.map((id) => [id, []]));
  for (const r of taken) {
    const d = dayKeyOfDb(r.date);
    // A day being re-taken is counted once, from `extra`.
    if (!extraDays.has(`${r.employee_id}|${d}`)) usesOf.get(r.employee_id)?.push({ date: d, days: r.leave_half ? 0.5 : 1 });
  }
  for (const p of pending) {
    // Its days in date order (close enough for the matching: they are working days of the span).
    let left = p.days;
    for (const d of eachDay(dayKeyOfDb(p.from_date), dayKeyOfDb(p.to_date))) {
      if (left <= EPS) break;
      const days = p.half_day ? 0.5 : Math.min(1, left);
      usesOf.get(p.employee_id)?.push({ date: d, days });
      left -= days;
    }
  }
  for (const e of extra) usesOf.get(e.employee_id)?.push({ date: e.date, days: e.half ? 0.5 : 1 });

  const creditsOf = new Map(ids.map((id) => [id, []]));
  const days = eachDay(from, today);
  for (const emp of ctx.employees) {
    for (const d of days) {
      const r = resolveDay(ctx, emp, d, today);
      if (r.employed && r.comp_off_earned > 0) creditsOf.get(emp.id).push({ date: d, days: r.comp_off_earned });
    }
  }

  for (const id of ids) {
    const credits = creditsOf.get(id) || [];
    const uses = usesOf.get(id) || [];
    const m = matchCompOff(credits, uses, type.comp_off_valid_days || 30);
    out.set(id, {
      credits: m.credits,
      uses,
      short: m.short,
      earnedIn: (range) => credits.filter((c) => c.date >= range.from && c.date <= range.to).reduce((s, c) => s + c.days, 0),
      // Still unused and not expired today (a day earned today is usable from tomorrow).
      available: m.credits.filter((c) => c.expires >= today).reduce((s, c) => s + c.left, 0) - m.short.reduce((s, x) => s + x.days, 0),
    });
  }
  return out;
}

/** Where earned days are read from for a check around these dates. */
export const ledgerStart = (dates) => addDays([...dates].sort()[0] || todayKey(), -COMP_OFF_LOOKBACK_DAYS);
