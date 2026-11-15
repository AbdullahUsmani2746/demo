// lib/hr/leave/balance.js — leave balances, and the check before leave is written.
//
//   available = entitled (policy.js) + carry_forward + adjustment − used − pending
//   used      = attendance rows of the year with this leave type (½ for half days)
//   pending   = days of pending leave requests in the year
// A comp-off type (comp_off) has no yearly entitlement: entitled = comp-off
// days earned in the year, available = earned days still unused and valid
// today + adjustments (lib/hr/leave/compOff.js), and each day taken must find
// an earned day in the 30 days before it.
//
// assertLeaveFits() runs inside saveEntries(), so every way leave reaches
// attendance — the daily register, an approved attendance correction, an
// approved leave request — is checked the same way.
import prisma from "@/lib/prisma";
import { entitlement, fmtDays, leaveYearLabel, leaveYearOf, leaveYearRange } from "@/lib/hr/leave/policy";
import { dayKeyOfDb, dbDay, todayKey } from "@/lib/hr/time";
import { employeeName, getHrSettings } from "@/lib/hr/access";
import { compOffLedger, ledgerStart } from "@/lib/hr/leave/compOff";

export class LeaveError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function leaveYearStart() {
  return (await getHrSettings()).leaveYearStartMonth;
}

const key = (e, t) => `${e}|${t}`;

/**
 * Balances of these employees for one leave year.
 * @returns {Promise<{ range, types, rows: Map<"emp|type", balance> }>}
 */
export async function balancesFor({ employeeIds, year, startMonth, typeIds = null, excludeRequestId = null }) {
  const sm = startMonth ?? (await leaveYearStart());
  const range = leaveYearRange(year, sm);
  const today = todayKey();
  const asOf = today < range.from ? range.from : today > range.to ? range.to : today;
  const ids = [...new Set(employeeIds)];
  const [emps, types, stored, used, pending] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, hireDate: true, gender: true } }),
    prisma.hrLeaveType.findMany({ where: typeIds ? { id: { in: typeIds } } : {}, orderBy: [{ sort: "asc" }, { id: "asc" }] }),
    prisma.hrLeaveBalance.findMany({ where: { employee_id: { in: ids }, year } }),
    prisma.hrAttendance.groupBy({
      by: ["employee_id", "leave_type_id", "leave_half"],
      where: { employee_id: { in: ids }, leave_type_id: { not: null }, date: { gte: dbDay(range.from), lte: dbDay(range.to) } },
      _count: { _all: true },
    }),
    prisma.hrLeaveRequest.groupBy({
      by: ["employee_id", "leave_type_id"],
      where: {
        employee_id: { in: ids },
        status: "pending",
        from_date: { gte: dbDay(range.from), lte: dbDay(range.to) },
        ...(excludeRequestId ? { NOT: { id: excludeRequestId } } : {}),
      },
      _sum: { days: true },
    }),
  ]);
  const storedOf = new Map(stored.map((b) => [key(b.employee_id, b.leave_type_id), b]));
  const usedOf = new Map();
  for (const u of used) {
    const k = key(u.employee_id, u.leave_type_id);
    usedOf.set(k, (usedOf.get(k) || 0) + u._count._all * (u.leave_half ? 0.5 : 1));
  }
  const pendingOf = new Map(pending.map((p) => [key(p.employee_id, p.leave_type_id), p._sum.days || 0]));
  const compOff = new Map();
  for (const t of types.filter((t) => t.comp_off)) {
    compOff.set(t.id, await compOffLedger({ employeeIds: ids, type: t, from: ledgerStart([asOf]), excludeRequestId }));
  }

  const rows = new Map();
  for (const e of emps) {
    const emp = { hireDate: dayKeyOfDb(e.hireDate), gender: e.gender };
    for (const t of types) {
      const k = key(e.id, t.id);
      const b = storedOf.get(k);
      const carry = b?.carry_forward || 0;
      const adjustment = b?.adjustment || 0;
      const u = usedOf.get(k) || 0;
      const p = pendingOf.get(k) || 0;
      const co = t.comp_off ? compOff.get(t.id)?.get(e.id) : null;
      if (t.comp_off) {
        rows.set(k, {
          employee_id: e.id,
          leave_type_id: t.id,
          comp_off: true,
          entitled: co ? co.earnedIn(range) : 0, // earned in the year
          carry_forward: carry,
          adjustment,
          note: b?.note ?? null,
          used: u,
          pending: p,
          available: Math.max(0, (co?.available ?? 0) + carry + adjustment),
          unlimited: t.allow_negative,
          valid_days: t.comp_off_valid_days,
        });
        continue;
      }
      const entitled = entitlement(t, emp, range, asOf);
      rows.set(k, {
        employee_id: e.id,
        leave_type_id: t.id,
        entitled,
        carry_forward: carry,
        adjustment,
        note: b?.note ?? null,
        used: u,
        pending: p,
        available: entitled + carry + adjustment - u - p,
        unlimited: t.allow_negative,
      });
    }
  }
  return { range, types, rows };
}

/**
 * Throws when leave days do not fit the balance.
 * @param needs  [{ employee_id, leave_type_id, date, half }]
 * @param excludeRequestId  a request being approved (its own days are not "pending")
 */
export async function assertLeaveFits(needs, { excludeRequestId = null } = {}) {
  if (!needs.length) return;
  const sm = await leaveYearStart();
  const typeIds = [...new Set(needs.map((n) => n.leave_type_id))];
  const types = new Map((await prisma.hrLeaveType.findMany({ where: { id: { in: typeIds } } })).map((t) => [t.id, t]));
  for (const n of needs) {
    const t = types.get(n.leave_type_id);
    if (!t) throw new LeaveError(`Leave type ${n.leave_type_id} does not exist.`);
    if (!t.is_active) throw new LeaveError(`${t.name} is switched off.`);
    if (n.half && !t.allow_half_day) throw new LeaveError(`${t.name} cannot be taken as a half day.`);
  }

  // Days already holding leave of the same type are being replaced, not added.
  const existing = await prisma.hrAttendance.findMany({
    where: { OR: needs.map((n) => ({ employee_id: n.employee_id, date: dbDay(n.date) })), leave_type_id: { not: null } },
    select: { employee_id: true, date: true, leave_type_id: true, leave_half: true },
  });
  const credit = new Map();
  for (const r of existing) {
    const k = `${r.employee_id}|${r.leave_type_id}|${leaveYearOf(dayKeyOfDb(r.date), sm)}`;
    credit.set(k, (credit.get(k) || 0) + (r.leave_half ? 0.5 : 1));
  }

  // Comp-off: each day must find an earned day in the days before it.
  for (const t of types.values()) {
    if (!t.comp_off || t.allow_negative) continue;
    const mine = needs.filter((n) => n.leave_type_id === t.id);
    const ids = [...new Set(mine.map((n) => n.employee_id))];
    const ledger = await compOffLedger({ employeeIds: ids, type: t, from: ledgerStart(mine.map((n) => n.date)), excludeRequestId, extra: mine });
    for (const id of ids) {
      const short = ledger.get(id)?.short.filter((s) => mine.some((n) => n.employee_id === id && n.date === s.date)) ?? [];
      if (!short.length) continue;
      const emp = await prisma.employee.findUnique({ where: { id }, select: { firstName: true, middleName: true, surname: true } });
      throw new LeaveError(
        `${employeeName(emp)}: no comp-off day left for ${short.map((s) => s.date).join(", ")} — a comp-off is earned by working a week-off or holiday and must be taken within ${t.comp_off_valid_days} days.`,
      );
    }
  }

  const groups = new Map();
  for (const n of needs) {
    const year = leaveYearOf(n.date, sm);
    const k = `${n.employee_id}|${n.leave_type_id}|${year}`;
    if (!groups.has(k)) groups.set(k, { employee_id: n.employee_id, leave_type_id: n.leave_type_id, year, days: 0 });
    groups.get(k).days += n.half ? 0.5 : 1;
  }
  for (const [k, g] of groups) {
    const t = types.get(g.leave_type_id);
    if (t.allow_negative || t.comp_off) continue;
    const { rows } = await balancesFor({ employeeIds: [g.employee_id], year: g.year, startMonth: sm, typeIds: [t.id], excludeRequestId });
    const b = rows.get(`${g.employee_id}|${t.id}`);
    const left = (b?.available ?? 0) + (credit.get(k) || 0);
    if (g.days > left + 1e-9) {
      const emp = await prisma.employee.findUnique({ where: { id: g.employee_id }, select: { firstName: true, middleName: true, surname: true } });
      throw new LeaveError(
        `${employeeName(emp)}: ${t.name} needs ${fmtDays(g.days)} day(s) but only ${fmtDays(Math.max(0, left))} are left in ${leaveYearLabel(g.year, sm)}` +
          (b?.pending ? ` (${fmtDays(b.pending)} more waiting for approval)` : "") + ".",
      );
    }
  }
}
