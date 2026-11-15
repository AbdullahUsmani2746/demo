// lib/hr/loans/access.js — whose advances / loans a person may apply for.
//   own       hr.loan.apply (or manage) — the employee the user is
//   anyone's  hr.loan.manage, inside their "Departments (HR)" limit
import { ForbiddenError } from "@/lib/auth/permissions";
import { assertEmployeesInScope, hrRights, HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";

export async function loanActor(session, employeeId) {
  const [rights, selfId] = await Promise.all([hrRights(session), sessionEmployeeId(session)]);
  const id = employeeId ?? selfId;
  if (!id) throw Object.assign(new Error("Your login is not linked to an employee — ask HR to apply for you."), { status: 400 });
  if (id === selfId) {
    if (!(rights.loanApply || rights.loanManage)) throw new ForbiddenError("You may not apply for an advance or loan.", HR_PERMS.loanApply);
    return { rights, selfId, employeeId: id, self: true };
  }
  if (!rights.loanManage) throw new ForbiddenError("You may only apply for yourself.", HR_PERMS.loanManage);
  await assertEmployeesInScope(session, [id]);
  return { rights, selfId, employeeId: id, self: false };
}
