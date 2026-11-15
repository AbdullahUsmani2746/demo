// /api/hr/attendance — the daily register.
//
//   GET  ?date=YYYY-MM-DD&department=&q=
//        → every employee on that day: shift, in / out, status, minutes,
//          and whether a correction for it is waiting for approval
//   POST { entries: [{ employee_id, date, check_in, check_out, status, remarks }], reason }
//        status "AUTO" = work it out from the times; or PRESENT / HALF_DAY / ABSENT /
//        LEAVE / OFF / HOLIDAY set by hand. AUTO with no times and no remarks
//        clears the day.
//
// Who saves directly (lib/hr/access.js rights):
//   hr.attendance.approve  any day
//   hr.attendance.mark     days within the last N days (HR → Shifts → Rules)
//                          that the machine has not recorded; anything else
//                          goes to Approvals as one request
// A day already waiting for approval cannot be changed until it is decided.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeFilter, getHrSettings, hrRights, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { assignmentOn, employeeLite, loadContext, resolveDay, shiftLite } from "@/lib/hr/attendance/sheet";
import { normalizeEntries, saveEntries } from "@/lib/hr/attendance/save";
import { SOURCES, STATUS } from "@/lib/hr/attendance/rules";
import { createHrRequest, openHrRequests } from "@/lib/hr/approvals";
import { addDays, dayKeyOf, dayKeyOfDb, dbDay, hmOf, isDayKey, todayKey } from "@/lib/hr/time";
import { ForbiddenError } from "@/lib/auth/permissions";

const DOC = "hrAttendance";

/** Employee-day keys waiting in open requests → request id. */
async function waitingKeys() {
  const map = new Map();
  for (const r of await openHrRequests(DOC)) {
    for (const e of r.payload?.entries || []) map.set(`${e.employee_id}|${e.date}`, r.id);
  }
  return map;
}

export const GET = hrRoute([HR_PERMS.view, HR_PERMS.mark, HR_PERMS.approve], async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const today = todayKey();
  const date = isDayKey(sp.get("date")) ? sp.get("date") : today;
  const ctx = await loadContext({ employeeWhere: await employeeFilter(session, sp), from: date, to: date });
  const waiting = await waitingKeys();

  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
  const rows = ctx.employees.map((emp) => {
    const d = resolveDay(ctx, emp, date, today);
    const a = assignmentOn(ctx, emp.id, date);
    counts[d.status] = (counts[d.status] || 0) + 1;
    return {
      employee: employeeLite(emp),
      shift: shiftLite(ctx.shiftById.get(a?.shift_id)),
      status: d.status,
      status_override: d.status_override,
      check_in: hmOf(d.check_in),
      check_out: hmOf(d.check_out),
      out_next_day: Boolean(d.check_out && dayKeyOf(d.check_out) !== date),
      late_minutes: d.late_minutes,
      early_minutes: d.early_minutes,
      worked_minutes: d.worked_minutes,
      overtime_minutes: d.overtime_minutes,
      needs_review: d.needs_review,
      source: d.source,
      remarks: d.remarks,
      locked: d.locked,
      day_type: d.dayType,
      leave_type_id: d.leave_type_id,
      leave_half: d.leave_half,
      leave_request_id: d.leave_request_id,
      waiting_request: waiting.get(`${emp.id}|${date}`) ?? null,
    };
  });
  const holiday = ctx.holidayOn.get(date);
  return NextResponse.json({
    date,
    today,
    holiday: holiday ? { name: holiday.name, is_paid: holiday.is_paid } : null,
    rows,
    counts,
  });
});

export const POST = hrRoute([HR_PERMS.mark, HR_PERMS.approve], async (req, { session }) => {
  const body = await jsonBody(req);
  const entries = normalizeEntries(body.entries);
  const reason = body.reason ? String(body.reason).trim().slice(0, 300) || null : null;
  await assertEmployeesInScope(session, entries.map((e) => e.employee_id));

  const waiting = await waitingKeys();
  const blocked = entries.filter((e) => waiting.has(`${e.employee_id}|${e.date}`));
  if (blocked.length) {
    const ids = [...new Set(blocked.map((e) => waiting.get(`${e.employee_id}|${e.date}`)))];
    return NextResponse.json(
      { error: `${blocked.length} of these days already wait for approval (${ids.map((i) => `#R-${i}`).join(", ")}) — decide or cancel that first.` },
      { status: 409 },
    );
  }

  // Days of an approved leave request are changed on HR → Leave (cancel the leave).
  const leaveDays = await prisma.hrAttendance.findMany({
    where: { OR: entries.map((e) => ({ employee_id: e.employee_id, date: dbDay(e.date) })), leave_request_id: { not: null } },
    select: { employee_id: true, date: true, leave_request_id: true },
  });
  if (leaveDays.length) {
    const l = leaveDays[0];
    return NextResponse.json(
      { error: `${dayKeyOfDb(l.date)} of employee ${l.employee_id} is approved leave (#L-${l.leave_request_id}) — change it on HR → Leave.` },
      { status: 409 },
    );
  }

  const rights = await hrRights(session);
  const actor = session.user.id;
  if (rights.approve) {
    const r = await saveEntries({ entries, actor });
    return NextResponse.json({ ...r, held: 0, message: `Saved ${r.saved + r.cleared} day(s).` });
  }
  if (!rights.mark) throw new ForbiddenError("You may not mark attendance.", HR_PERMS.mark);

  // Which entries a marker may save directly.
  const { directEditDays } = await getHrSettings();
  const today = todayKey();
  const oldest = addDays(today, -(directEditDays - 1));
  const existing = await prisma.hrAttendance.findMany({
    where: { OR: entries.map((e) => ({ employee_id: e.employee_id, date: dbDay(e.date) })) },
    select: { employee_id: true, date: true, source: true },
  });
  const machineDays = new Set(existing.filter((r) => r.source !== SOURCES.MANUAL).map((r) => `${r.employee_id}|${dayKeyOfDb(r.date)}`));
  const direct = [];
  const held = [];
  for (const e of entries) {
    const needsApproval = e.date < oldest || machineDays.has(`${e.employee_id}|${e.date}`);
    (needsApproval ? held : direct).push(e);
  }
  if (held.length && !reason) {
    return NextResponse.json(
      {
        error: `${held.length} day(s) are older than ${directEditDays} day(s) or were recorded by the machine — give a reason; they will go for approval.`,
        needsReason: true,
        heldCount: held.length,
      },
      { status: 400 },
    );
  }

  const saved = direct.length ? await saveEntries({ entries: direct, actor }) : { saved: 0, cleared: 0 };
  let request = null;
  if (held.length) {
    const days = held.map((e) => e.date).sort();
    const people = new Set(held.map((e) => e.employee_id)).size;
    request = await createHrRequest({
      docType: DOC,
      payload: { entries: held, reason },
      summary: `${held.length} day(s) · ${people} employee(s) · ${days[0]}${days.length > 1 ? ` → ${days[days.length - 1]}` : ""}${reason ? ` — ${reason}` : ""}`,
      session,
    });
  }
  const parts = [];
  if (direct.length) parts.push(`Saved ${saved.saved + saved.cleared} day(s)`);
  if (request) parts.push(`${held.length} day(s) sent for approval (#R-${request.id})`);
  return NextResponse.json({ ...saved, held: held.length, approvalRequestId: request?.id ?? null, message: `${parts.join(" · ")}.` });
});
