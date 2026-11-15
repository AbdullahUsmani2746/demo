// lib/hr/team.js — who reports to whom.
//
// The reporting line is Employee.managerId → Manager → Manager.employeeId: a
// Manager row is simply "this employee leads people". HR → Team structure sets
// it (setReportsTo), so a Manager row is created the first time someone gets a
// report — nobody maintains the Manager setup list by hand.
//
// A person's team is everyone below them, at any depth. It drives:
//   · the "Employees (HR)" data scope, mode "Theirs" (lib/auth/scope.js)
//   · the HR default for people without an HR scope and without hr.scope.all:
//     they see their team only (lib/hr/access.js → employeeScopeWhere)
// Imports prisma only — lib/auth/scope.js uses it, and lib/hr/access.js uses
// lib/auth/scope.js.
import prisma from "@/lib/prisma";

/**
 * The employee the signed-in person is (User.employeeId, else the employee
 * with their e-mail). null when they are not an employee.
 */
export async function sessionEmployeeId(session) {
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { employeeId: true, email: true } });
  if (user?.employeeId) return user.employeeId;
  const email = user?.email || session.user.email;
  if (!email) return null;
  const emp = await prisma.employee.findUnique({ where: { emailAddress: email }, select: { id: true } });
  return emp?.id ?? null;
}

/** Ids of everyone below this employee, at any depth (never the employee). */
export async function teamEmployeeIds(employeeId) {
  if (!employeeId) return [];
  // UNION (not UNION ALL) stops at a loop instead of running forever.
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE t AS (
      SELECT e.id FROM "Employee" e JOIN "Manager" m ON m.id = e."managerId" WHERE m."employeeId" = ${employeeId}
      UNION
      SELECT e.id FROM "Employee" e JOIN "Manager" m ON m.id = e."managerId" JOIN t ON m."employeeId" = t.id
    )
    SELECT id FROM t`;
  return rows.map((r) => Number(r.id)).filter((id) => id !== employeeId);
}

/** The signed-in person's team (empty when they are not an employee). */
export async function sessionTeamIds(session) {
  return teamEmployeeIds(await sessionEmployeeId(session));
}

export class TeamError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Make these employees report to `leaderId` (an employee id), or to nobody
 * (null). Refuses a loop: a person cannot report to themselves or to anyone
 * in their own team.
 */
export async function setReportsTo(employeeIds, leaderId, { db = prisma } = {}) {
  const ids = [...new Set(employeeIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new TeamError("Choose at least one employee.");
  if (leaderId == null) {
    const r = await db.employee.updateMany({ where: { id: { in: ids } }, data: { managerId: null } });
    return { count: r.count, leader: null };
  }
  const leader = await db.employee.findUnique({
    where: { id: Number(leaderId) },
    select: { id: true, firstName: true, middleName: true, surname: true, departmentId: true, company_id: true, status: true },
  });
  if (!leader) throw new TeamError("That team leader does not exist.", 404);
  if (ids.includes(leader.id)) throw new TeamError("Nobody can report to themselves.");
  // The leader must not already be below any of them.
  for (const id of ids) {
    if ((await teamEmployeeIds(id)).includes(leader.id)) {
      throw new TeamError(`#${leader.id} is in the team of #${id} — that would make a loop. Move #${leader.id} first.`, 409);
    }
  }
  const name = [leader.firstName, leader.middleName, leader.surname].filter(Boolean).join(" ").slice(0, 150);
  const manager = await db.manager.upsert({
    where: { employeeId: leader.id },
    update: { manager: name },
    create: { employeeId: leader.id, manager: name, department_id: leader.departmentId, company_id: leader.company_id },
  });
  const r = await db.employee.updateMany({ where: { id: { in: ids } }, data: { managerId: manager.id } });
  return { count: r.count, leader: { id: leader.id, name } };
}
