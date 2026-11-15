// lib/hr/leaving/separation.js — the leaving process (feature hr.leavingProcess).
//
//   request   an employee resigns (hr.leaving.apply, own only) or HR records a
//             resignation / termination / retirement (hr.leaving.manage, in scope).
//             Notice days come from the rules (HR → Payroll → Rules); the request
//             goes to Approvals (doc type hrSeparation, hr.leaving.approve).
//   approved  the clearance checklist (items: Settings "hr.leaving.clearance_items")
//             is ticked off; the last working day / notice waiver may still change.
//   complete  every item cleared and the last working day reached → Employee.dor
//             = last working day and status INACTIVE (attendance and payroll stop
//             there by themselves — lib/hr/attendance/sheet.js employedOn).
// The money side is the final settlement: lib/hr/leaving/settlement.js.
import prisma from "@/lib/prisma";
import { employeeName, getHrSettings } from "@/lib/hr/access";
import { createHrRequest } from "@/lib/hr/approvals";
import { getClearanceItems } from "@/lib/hr/settingsData";
import { dayKeyOfDb, daysBetween, dbDay, isDayKey, todayKey } from "@/lib/hr/time";

export class LeavingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const SEPARATION_KINDS = {
  RESIGNATION: { label: "Resignation" },
  TERMINATION: { label: "Termination" },
  RETIREMENT: { label: "Retirement" },
};
export const SEP_STATUS = { PENDING: "pending", APPROVED: "approved", COMPLETED: "completed", REJECTED: "rejected", CANCELLED: "cancelled" };
export const OPEN_SEP = [SEP_STATUS.PENDING, SEP_STATUS.APPROVED];

/** Notice required for a kind, from the rules (retirement: none). */
export const noticeDaysFor = (kind, settings) =>
  kind === "RESIGNATION" ? settings.noticeDaysResignation : kind === "TERMINATION" ? settings.noticeDaysTermination : 0;

/** Days of notice served: notice day to last working day, both counted. */
export const noticeServed = (noticeDate, lastDay) => (lastDay >= noticeDate ? daysBetween(noticeDate, lastDay) + 1 : 0);

/** Notice short of what is required (0 when waived). */
export function noticeShort(sep) {
  if (sep.waive_notice) return 0;
  return Math.max(0, (sep.notice_days || 0) - noticeServed(dayKeyOfDb(sep.notice_date), dayKeyOfDb(sep.last_working_day)));
}

export const SEP_INCLUDE = {
  employee: { select: { id: true, firstName: true, middleName: true, surname: true, hireDate: true, dor: true, status: true, department: { select: { dept_name: true } }, Designation: { select: { desg_name: true } } } },
};

/**
 * File a resignation / termination / retirement and send it to Approvals.
 * @param {{ employeeId, kind, notice_date, last_working_day, reason, session, self }} a
 */
export async function requestSeparation({ employeeId, kind, notice_date, last_working_day, reason, session, self = false }) {
  if (!SEPARATION_KINDS[kind]) throw new LeavingError("Resignation, termination or retirement?");
  if (self && kind !== "RESIGNATION") throw new LeavingError("You may only resign yourself.", 403);
  if (!isDayKey(notice_date)) throw new LeavingError("Notice date: pick a day.");
  if (!isDayKey(last_working_day)) throw new LeavingError("Last working day: pick a day.");
  if (last_working_day < notice_date) throw new LeavingError("The last working day is before the notice date.");
  if (notice_date > todayKey()) throw new LeavingError("The notice date cannot be in the future.");
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, firstName: true, middleName: true, surname: true, hireDate: true, dor: true, status: true } });
  if (!emp) throw new LeavingError("Employee not found.", 404);
  if (emp.status !== "ACTIVE" || (emp.dor && dayKeyOfDb(emp.dor) < todayKey())) throw new LeavingError(`${employeeName(emp)} has already left.`, 409);
  if (last_working_day < dayKeyOfDb(emp.hireDate)) throw new LeavingError("The last working day is before the joining date.");
  const open = await prisma.hrSeparation.findFirst({ where: { employee_id: employeeId, status: { in: OPEN_SEP } }, select: { id: true } });
  if (open) throw new LeavingError(`A leaving request (#L-${open.id}) is already open for ${employeeName(emp)}.`, 409);

  const [settings, items] = await Promise.all([getHrSettings(), getClearanceItems()]);
  const notice_days = noticeDaysFor(kind, settings);
  const sep = await prisma.hrSeparation.create({
    data: {
      employee_id: employeeId,
      kind,
      notice_date: dbDay(notice_date),
      notice_days,
      last_working_day: dbDay(last_working_day),
      reason: reason ? String(reason).trim().slice(0, 500) || null : null,
      clearance: items.map((i) => ({ key: i.key, label: i.label, done: false, by: null, at: null, note: null })),
      requested_by: session.user.id,
    },
  });
  const served = noticeServed(notice_date, last_working_day);
  const request = await createHrRequest({
    docType: "hrSeparation",
    payload: { separation_id: sep.id },
    summary: `${SEPARATION_KINDS[kind].label} of ${employeeName(emp)} (${emp.id}) — last day ${last_working_day}, notice ${served} of ${notice_days} day(s)`,
    session,
  });
  await prisma.hrSeparation.update({ where: { id: sep.id }, data: { approval_request_id: request.id } });
  return { ...sep, approval_request_id: request.id };
}

/** Approved in the inbox. */
export async function approveSeparation(id, { actor }) {
  const r = await prisma.hrSeparation.updateMany({
    where: { id, status: SEP_STATUS.PENDING },
    data: { status: SEP_STATUS.APPROVED, decided_by: actor, decided_at: new Date() },
  });
  if (r.count !== 1) throw new LeavingError("This leaving request is no longer waiting for approval.", 409);
  return prisma.hrSeparation.findUnique({ where: { id }, include: SEP_INCLUDE });
}

/** Tick / untick one clearance item. */
export async function setClearance(id, { key, done, note, actor }) {
  const sep = await prisma.hrSeparation.findUnique({ where: { id } });
  if (!sep) throw new LeavingError("Leaving request not found.", 404);
  if (sep.status !== SEP_STATUS.APPROVED) throw new LeavingError("Clearance is done once the leaving is approved and before it is completed.", 409);
  const list = Array.isArray(sep.clearance) ? sep.clearance : [];
  if (!list.some((c) => c.key === key)) throw new LeavingError("That checklist item is not on this leaving.");
  const clearance = list.map((c) =>
    c.key === key ? { ...c, done: Boolean(done), by: done ? actor : null, at: done ? new Date().toISOString() : null, note: note ? String(note).slice(0, 300) : c.note ?? null } : c,
  );
  return prisma.hrSeparation.update({ where: { id }, data: { clearance } });
}

/** Change the last working day or waive the notice shortfall (approved, settlement still a draft). */
export async function setTerms(id, { last_working_day, waive_notice }) {
  const sep = await prisma.hrSeparation.findUnique({ where: { id } });
  if (!sep) throw new LeavingError("Leaving request not found.", 404);
  if (sep.status !== SEP_STATUS.APPROVED) throw new LeavingError("Terms change only while the leaving is approved and not completed.", 409);
  const live = await prisma.hrSettlement.findFirst({ where: { separation_id: id, status: { notIn: ["DRAFT", "REVERSED"] } }, select: { id: true, status: true } });
  if (live) throw new LeavingError(`The final settlement #S-${live.id} is ${live.status.toLowerCase()} — reverse or reject it first.`, 409);
  const data = {};
  if (last_working_day !== undefined) {
    if (!isDayKey(last_working_day) || last_working_day < dayKeyOfDb(sep.notice_date)) throw new LeavingError("Last working day: on or after the notice date.");
    data.last_working_day = dbDay(last_working_day);
  }
  if (waive_notice !== undefined) data.waive_notice = Boolean(waive_notice);
  return prisma.hrSeparation.update({ where: { id }, data });
}

/** Everything cleared and the last day reached → the employee has left. */
export async function completeSeparation(id, { actor }) {
  const sep = await prisma.hrSeparation.findUnique({ where: { id } });
  if (!sep) throw new LeavingError("Leaving request not found.", 404);
  if (sep.status !== SEP_STATUS.APPROVED) throw new LeavingError(`Only an approved leaving can be completed — this one is ${sep.status}.`, 409);
  const lwd = dayKeyOfDb(sep.last_working_day);
  if (lwd > todayKey()) throw new LeavingError(`The last working day (${lwd}) has not come yet.`, 409);
  const left = (Array.isArray(sep.clearance) ? sep.clearance : []).filter((c) => !c.done);
  if (left.length) throw new LeavingError(`Clear these first: ${left.map((c) => c.label).join("; ")}.`, 409);
  return prisma.$transaction(async (tx) => {
    const r = await tx.hrSeparation.updateMany({ where: { id, status: SEP_STATUS.APPROVED }, data: { status: SEP_STATUS.COMPLETED, completed_by: actor, completed_at: new Date() } });
    if (r.count !== 1) throw new LeavingError("This leaving changed a moment ago — refresh.", 409);
    await tx.employee.update({ where: { id: sep.employee_id }, data: { dor: sep.last_working_day, status: "INACTIVE" } });
    return tx.hrSeparation.findUnique({ where: { id } });
  });
}

/** Separation for the screens. */
export function separationLite(s) {
  const lwd = dayKeyOfDb(s.last_working_day);
  const nd = dayKeyOfDb(s.notice_date);
  return {
    id: s.id,
    employee_id: s.employee_id,
    employee: s.employee
      ? { id: s.employee.id, name: employeeName(s.employee), department: s.employee.department?.dept_name ?? null, designation: s.employee.Designation?.desg_name ?? null, hired: dayKeyOfDb(s.employee.hireDate), left: s.employee.dor ? dayKeyOfDb(s.employee.dor) : null }
      : null,
    kind: s.kind,
    kind_label: SEPARATION_KINDS[s.kind]?.label ?? s.kind,
    notice_date: nd,
    notice_days: s.notice_days,
    served: noticeServed(nd, lwd),
    short: noticeShort(s),
    last_working_day: lwd,
    waive_notice: s.waive_notice,
    reason: s.reason,
    status: s.status,
    clearance: Array.isArray(s.clearance) ? s.clearance : [],
    requested_by: s.requested_by,
    requested_at: s.requested_at,
    decided_at: s.decided_at,
    decision_note: s.decision_note,
    completed_at: s.completed_at,
  };
}
