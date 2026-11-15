// lib/hr/attendance/save.js — the only writer of hr_attendance.
//
//   saveEntries()          manual entries (daily register, approved corrections)
//   rebuildFromPunches()   device sync / file import → the days those punches touch
//
// Both compute with lib/hr/attendance/rules.js and write in bulk (one
// INSERT … ON CONFLICT per 500 rows). Locked days (payroll posted) are never
// written. A day corrected by hand (source MANUAL) is not overwritten by later
// punches — the correction is what was approved.
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { computeDay, entryInstants, MANUAL_STATUSES, punchWindow, SOURCES } from "@/lib/hr/attendance/rules";
import { assignmentOn, dayTypeOf, loadContext, resolveDay } from "@/lib/hr/attendance/sheet";
import { addDays, dayKeyOf, dayKeyOfDb, dbDay, eachDay, instantAt, isDayKey, normalizeHm, todayKey } from "@/lib/hr/time";
import { employeeName } from "@/lib/hr/access";
import { assertLeaveFits } from "@/lib/hr/leave/balance";

export class AttendanceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const MIN_GAP_MS = 5 * 60 * 1000; // punches closer than this are one punch

/**
 * Clean the entries a screen sends. Returns entries with day keys, "HH:MM"
 * times and a status (AUTO = work it out from the times). A LEAVE names its
 * leave type (leave_type_id) and may be a half day (leave_half).
 * `internal` (leave requests only) also keeps leave_request_id.
 */
export function normalizeEntries(raw, { internal = false } = {}) {
  if (!Array.isArray(raw) || raw.length === 0) throw new AttendanceError("Nothing to save.");
  if (raw.length > 2000) throw new AttendanceError("Too many rows in one save (2,000 at most).");
  const seen = new Set();
  return raw.map((e, i) => {
    const employee_id = Number(e?.employee_id);
    const date = String(e?.date ?? "");
    const where = `Row ${i + 1}`;
    if (!Number.isInteger(employee_id)) throw new AttendanceError(`${where}: employee missing.`);
    if (!isDayKey(date)) throw new AttendanceError(`${where}: date must be YYYY-MM-DD.`);
    const key = `${employee_id}|${date}`;
    if (seen.has(key)) throw new AttendanceError(`${where}: employee ${employee_id} on ${date} appears twice.`);
    seen.add(key);
    const check_in = e.check_in ? normalizeHm(e.check_in) : null;
    const check_out = e.check_out ? normalizeHm(e.check_out) : null;
    if (e.check_in && !check_in) throw new AttendanceError(`${where}: "${e.check_in}" is not a time.`);
    if (e.check_out && !check_out) throw new AttendanceError(`${where}: "${e.check_out}" is not a time.`);
    if (check_out && !check_in) throw new AttendanceError(`${where}: an out time needs an in time.`);
    const status = e.status && e.status !== "AUTO" ? String(e.status) : "AUTO";
    if (status !== "AUTO" && !MANUAL_STATUSES.includes(status)) throw new AttendanceError(`${where}: unknown status ${status}.`);
    if (date > todayKey() && (check_in || check_out)) throw new AttendanceError(`${where}: times cannot be entered for a future day.`);
    const remarks = e.remarks ? String(e.remarks).trim().slice(0, 300) || null : null;
    let leave_type_id = null;
    let leave_half = false;
    if (status === "LEAVE") {
      leave_type_id = Number(e.leave_type_id);
      if (!Number.isInteger(leave_type_id)) throw new AttendanceError(`${where}: pick which leave.`);
      leave_half = Boolean(e.leave_half);
    }
    const leave_request_id = internal && e.leave_request_id ? Number(e.leave_request_id) : null;
    return { employee_id, date, check_in, check_out, status, remarks, leave_type_id, leave_half, leave_request_id };
  });
}

const ts = (d) => (d ? new Date(d).toISOString().slice(0, 23).replace("T", " ") : null);

/** Write computed rows: one INSERT … ON CONFLICT per chunk; locked rows untouched. */
async function upsertRows(rows, db = prisma) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk.map(
      // Every value cast: an untyped NULL in a multi-row VALUES list cannot be resolved.
      (r) => Prisma.sql`(${r.employee_id}::int, ${r.date}::date, ${r.shift_id}::int, ${ts(r.check_in)}::timestamp, ${ts(r.check_out)}::timestamp,
        ${r.status}::varchar, ${r.status_override}::boolean, ${r.late_minutes}::int, ${r.early_minutes}::int, ${r.worked_minutes}::int,
        ${r.overtime_minutes}::int, ${r.needs_review}::boolean, ${r.source}::varchar, ${r.remarks}::varchar,
        ${r.leave_type_id}::int, ${r.leave_half}::boolean, ${r.leave_request_id}::int, ${r.actor}::varchar,
        ${r.actor}::varchar, now(), now())`,
    );
    await db.$executeRaw`
      INSERT INTO "hr_attendance" (employee_id, date, shift_id, check_in, check_out, status, status_override,
        late_minutes, early_minutes, worked_minutes, overtime_minutes, needs_review, source, remarks,
        leave_type_id, leave_half, leave_request_id, created_by, updated_by, created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (employee_id, date) DO UPDATE SET
        shift_id = EXCLUDED.shift_id, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
        status = EXCLUDED.status, status_override = EXCLUDED.status_override,
        late_minutes = EXCLUDED.late_minutes, early_minutes = EXCLUDED.early_minutes,
        worked_minutes = EXCLUDED.worked_minutes, overtime_minutes = EXCLUDED.overtime_minutes,
        needs_review = EXCLUDED.needs_review, source = EXCLUDED.source, remarks = EXCLUDED.remarks,
        leave_type_id = EXCLUDED.leave_type_id, leave_half = EXCLUDED.leave_half, leave_request_id = EXCLUDED.leave_request_id,
        updated_by = EXCLUDED.updated_by, updated_at = now()
      WHERE "hr_attendance".locked = false`;
  }
}

function computedRow(ctx, emp, dayKey, { checkIn, checkOut, manualStatus, remarks, source, actor, leave = null }, today) {
  const a = assignmentOn(ctx, emp.id, dayKey);
  const shift = a ? ctx.shiftById.get(a.shift_id) ?? null : null;
  const c = computeDay({ shift, dayKey, dayType: dayTypeOf(ctx, emp.id, dayKey), checkIn, checkOut, manualStatus, today });
  return {
    employee_id: emp.id,
    date: dayKey,
    shift_id: shift?.id ?? null,
    check_in: checkIn,
    check_out: checkOut,
    // PENDING is never stored: a row for today with a manual note only.
    status: c.status === "PENDING" ? "ABSENT" : c.status,
    status_override: Boolean(manualStatus),
    late_minutes: c.late_minutes,
    early_minutes: c.early_minutes,
    worked_minutes: c.worked_minutes,
    overtime_minutes: c.overtime_minutes,
    needs_review: c.needs_review,
    source,
    remarks: remarks ?? null,
    leave_type_id: c.status === "LEAVE" ? leave?.leave_type_id ?? null : null,
    leave_half: c.status === "LEAVE" ? Boolean(leave?.leave_half) : false,
    leave_request_id: c.status === "LEAVE" ? leave?.leave_request_id ?? null : null,
    actor: actor ?? null,
  };
}

/**
 * Save normalized entries (normalizeEntries) as they are — the caller has
 * already decided they may be saved directly (or they were approved).
 * An entry with status AUTO, no times and no remarks clears the day.
 * @returns {{ saved: number, cleared: number }}
 */
export async function saveEntries({ entries, actor, source = SOURCES.MANUAL, excludeRequestId = null }) {
  if (!entries.length) return { saved: 0, cleared: 0 };
  // Leave must fit the balance (lib/hr/leave/balance.js).
  await assertLeaveFits(
    entries.filter((e) => e.status === "LEAVE").map((e) => ({ employee_id: e.employee_id, leave_type_id: e.leave_type_id, date: e.date, half: e.leave_half })),
    { excludeRequestId },
  );
  const days = entries.map((e) => e.date).sort();
  const ctx = await loadContext({
    employeeWhere: { id: { in: [...new Set(entries.map((e) => e.employee_id))] } },
    from: days[0],
    to: days[days.length - 1],
  });
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const today = todayKey();
  const rows = [];
  const clear = [];
  for (const e of entries) {
    const emp = empById.get(e.employee_id);
    if (!emp || dayKeyOfDb(emp.hireDate) > e.date || (emp.dor && dayKeyOfDb(emp.dor) < e.date)) {
      throw new AttendanceError(`${emp ? employeeName(emp) : `Employee ${e.employee_id}`} was not employed on ${e.date}.`);
    }
    const existing = ctx.rowOf.get(`${e.employee_id}|${e.date}`);
    if (existing?.locked) {
      throw new AttendanceError(`${employeeName(emp)} on ${e.date} is locked — payroll for it has been posted.`, 409);
    }
    if (e.status === "AUTO" && !e.check_in && !e.remarks) {
      if (existing) clear.push(existing.id);
      continue;
    }
    const a = assignmentOn(ctx, emp.id, e.date);
    const shift = a ? ctx.shiftById.get(a.shift_id) ?? null : null;
    let { checkIn, checkOut } = entryInstants(shift, e.date, e.check_in, e.check_out);
    // Leave over a day the machine recorded keeps those times on the row.
    if (e.status === "LEAVE" && !e.check_in && existing?.check_in) {
      checkIn = existing.check_in;
      checkOut = existing.check_out;
    }
    rows.push(
      computedRow(
        ctx, emp, e.date,
        { checkIn, checkOut, manualStatus: e.status === "AUTO" ? null : e.status, remarks: e.remarks, source, actor, leave: e },
        today,
      ),
    );
  }
  await prisma.$transaction(async (tx) => {
    if (clear.length) await tx.hrAttendance.deleteMany({ where: { id: { in: clear }, locked: false } });
    await upsertRows(rows, tx);
  });
  return { saved: rows.length, cleared: clear.length };
}

/**
 * Rebuild days from punches. Days that have punches are written as
 * DEVICE / IMPORT rows (first punch = in, last = out); days already corrected
 * by hand, and locked days, are left alone.
 * @returns {{ days: number, skippedManual: number }}
 */
export async function rebuildFromPunches({ employeeIds, from, to, actor = "system" }) {
  const ids = [...new Set(employeeIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return { days: 0, skippedManual: 0 };
  // A punch can belong to the day before its calendar day (night shift).
  const start = addDays(from, -1);
  const ctx = await loadContext({ employeeWhere: { id: { in: ids } }, from: start, to });
  const punches = await prisma.hrPunch.findMany({
    where: { employee_id: { in: ids }, punch_time: { gte: instantAt(start, -240), lt: instantAt(to, 2880) } },
    orderBy: { punch_time: "asc" },
    select: { id: true, employee_id: true, punch_time: true, source: true },
  });
  const byEmp = new Map();
  for (const p of punches) {
    if (!byEmp.has(p.employee_id)) byEmp.set(p.employee_id, []);
    byEmp.get(p.employee_id).push(p);
  }
  const today = todayKey();
  const rows = [];
  let skippedManual = 0;
  for (const emp of ctx.employees) {
    const list = byEmp.get(emp.id);
    if (!list) continue;
    const used = new Set();
    for (let d = start; d <= to; d = addDays(d, 1)) {
      if (dayKeyOfDb(emp.hireDate) > d || (emp.dor && dayKeyOfDb(emp.dor) < d)) continue;
      const a = assignmentOn(ctx, emp.id, d);
      const shift = a ? ctx.shiftById.get(a.shift_id) ?? null : null;
      const w = punchWindow(shift, d);
      const mine = list.filter((p) => !used.has(p.id) && p.punch_time >= w.from && p.punch_time < w.to);
      if (!mine.length) continue;
      mine.forEach((p) => used.add(p.id));
      // The day before `from` is only read so its punches are not taken by `from`.
      if (d < from) continue;
      const existing = ctx.rowOf.get(`${emp.id}|${d}`);
      if (existing?.locked) continue;
      // Corrected by hand, or leave: punches do not overwrite it.
      if (existing && existing.source !== SOURCES.DEVICE && existing.source !== SOURCES.IMPORT) {
        skippedManual += 1;
        continue;
      }
      const first = mine[0];
      const last = mine[mine.length - 1];
      const checkOut = last.punch_time - first.punch_time >= MIN_GAP_MS ? last.punch_time : null;
      rows.push(
        computedRow(
          ctx, emp, d,
          { checkIn: first.punch_time, checkOut, manualStatus: null, remarks: existing?.remarks ?? null, source: first.source === "IMPORT" ? SOURCES.IMPORT : SOURCES.DEVICE, actor },
          today,
        ),
      );
    }
  }
  await upsertRows(rows);
  return { days: rows.length, skippedManual };
}

/**
 * Store punches (device or file) and rebuild the days they touch.
 * `punches` are { device_user_id, punch_time: Date }.
 * @returns {{ received, inserted, unmapped, days, skippedManual }}
 */
export async function ingestPunches({ punches, source, deviceId = null, batch = null, actor = "system" }) {
  const clean = punches
    .map((p) => ({ device_user_id: String(p.device_user_id ?? "").trim(), punch_time: new Date(p.punch_time) }))
    .filter((p) => p.device_user_id && !Number.isNaN(p.punch_time.getTime()));
  if (!clean.length) return { received: punches.length, inserted: 0, unmapped: 0, days: 0, skippedManual: 0 };

  // Machine user id → employee: Employee.attendanceId, else the employee id itself.
  const codes = [...new Set(clean.map((p) => p.device_user_id))];
  const numeric = codes.map(Number).filter(Number.isInteger);
  const emps = await prisma.employee.findMany({
    where: { OR: [{ attendanceId: { in: codes } }, { id: { in: numeric }, attendanceId: null }] },
    select: { id: true, attendanceId: true },
  });
  const empOf = new Map();
  for (const e of emps) if (!e.attendanceId) empOf.set(String(e.id), e.id);
  for (const e of emps) if (e.attendanceId) empOf.set(e.attendanceId, e.id); // an explicit id wins

  const data = clean.map((p) => ({
    device_user_id: p.device_user_id,
    employee_id: empOf.get(p.device_user_id) ?? null,
    punch_time: p.punch_time,
    device_id: deviceId,
    source,
    batch,
  }));
  let inserted = 0;
  for (let i = 0; i < data.length; i += 1000) {
    const r = await prisma.hrPunch.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true });
    inserted += r.count;
  }

  const mapped = data.filter((p) => p.employee_id);
  const unmapped = new Set(data.filter((p) => !p.employee_id).map((p) => p.device_user_id)).size;
  if (!mapped.length) return { received: punches.length, inserted, unmapped, days: 0, skippedManual: 0 };
  const dayKeys = mapped.map((p) => dayKeyOf(p.punch_time)).sort();
  const { days, skippedManual } = await rebuildFromPunches({
    employeeIds: mapped.map((p) => p.employee_id),
    from: addDays(dayKeys[0], -1),
    to: dayKeys[dayKeys.length - 1] > todayKey() ? todayKey() : dayKeys[dayKeys.length - 1],
    actor,
  });
  return { received: punches.length, inserted, unmapped, days, skippedManual };
}

/**
 * Freeze a month for payroll: every employed day of these employees is stored
 * as it is computed now (days with nothing recorded as SYSTEM rows) and locked,
 * so later changes to rules, shifts or holidays do not change a paid month.
 * Runs inside the payroll posting transaction (`tx`).
 */
export async function lockAttendance({ employeeIds, from, to, actor, tx }) {
  const ctx = await loadContext({ employeeWhere: { id: { in: employeeIds } }, from, to });
  const today = todayKey();
  const rows = [];
  for (const emp of ctx.employees) {
    for (const d of eachDay(from, to)) {
      const r = resolveDay(ctx, emp, d, today);
      if (!r.employed || r.locked) continue;
      rows.push({
        employee_id: emp.id,
        date: d,
        shift_id: r.shift_id,
        check_in: r.check_in,
        check_out: r.check_out,
        status: r.status === "PENDING" ? "ABSENT" : r.status,
        status_override: r.status_override,
        late_minutes: r.late_minutes || 0,
        early_minutes: r.early_minutes || 0,
        worked_minutes: r.worked_minutes || 0,
        overtime_minutes: r.overtime_minutes || 0,
        needs_review: Boolean(r.needs_review),
        source: r.source ?? SOURCES.SYSTEM,
        remarks: r.remarks,
        leave_type_id: r.leave_type_id,
        leave_half: r.leave_half,
        leave_request_id: r.leave_request_id,
        actor,
      });
    }
  }
  await upsertRows(rows, tx);
  await tx.hrAttendance.updateMany({
    where: { employee_id: { in: employeeIds }, date: { gte: dbDay(from), lte: dbDay(to) } },
    data: { locked: true },
  });
  return rows.length;
}

/** Undo lockAttendance (payroll reversed): unlock, and drop the SYSTEM rows again. */
export async function unlockAttendance({ employeeIds, from, to, tx }) {
  const where = { employee_id: { in: employeeIds }, date: { gte: dbDay(from), lte: dbDay(to) } };
  await tx.hrAttendance.updateMany({ where, data: { locked: false } });
  await tx.hrAttendance.deleteMany({ where: { ...where, source: SOURCES.SYSTEM } });
}

