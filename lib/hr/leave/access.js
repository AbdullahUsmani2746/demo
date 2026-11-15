// lib/hr/leave/access.js — whose leave a person may see and apply for.
//
//   own leave      hr.leave.apply (or manage) — the employee the user is
//   anyone's       hr.leave.manage, inside their "Departments (HR)" limit
//   see everyone   hr.leave.view / manage / approve
import { ForbiddenError } from "@/lib/auth/permissions";
import { assertEmployeesInScope, hrRights, sessionEmployeeId } from "@/lib/hr/access";

export async function leaveContext(session) {
  const [rights, selfId] = await Promise.all([hrRights(session), sessionEmployeeId(session)]);
  return { rights, selfId };
}

/** Throws unless this session may apply / cancel leave for the employee. */
export async function assertCanActFor(session, { rights, selfId }, employeeId) {
  if (employeeId === selfId) {
    if (rights.leaveApply || rights.leaveManage) return "self";
    throw new ForbiddenError("You may not apply for leave.", "hr.leave.apply");
  }
  if (!rights.leaveManage) throw new ForbiddenError("You may only apply for your own leave.", "hr.leave.manage");
  await assertEmployeesInScope(session, [employeeId]);
  return "other";
}
