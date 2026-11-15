// lib/hr/salary/service.js — salary structures and revisions.
//
// A revision is a new structure from a date. Someone holding
// hr.salary.approve revises other people's salary directly; anyone else's
// revision (and anyone's own) goes to Approvals (doc type hrSalary) and takes
// effect when approved. One revision per employee may wait at a time.
import prisma from "@/lib/prisma";
import { employeeName } from "@/lib/hr/access";
import { salaryTotals, fmtMoney } from "@/lib/hr/salary/calc";
import { dayKeyOfDb, dbDay, isDayKey } from "@/lib/hr/time";

export class SalaryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const STRUCTURE_INCLUDE = { lines: { include: { component: true } } };

/** Body of the revision form → clean data. */
export async function revisionData(b) {
  const employee_id = Number(b?.employee_id);
  if (!Number.isInteger(employee_id)) throw new SalaryError("Pick the employee.");
  if (!isDayKey(b.effective_from)) throw new SalaryError("Effective from must be a date.");
  const basic = Number(b.basic);
  if (!Number.isFinite(basic) || basic < 0 || basic > 100_000_000) throw new SalaryError("Basic salary: enter an amount.");
  const raw = Array.isArray(b.lines) ? b.lines : [];
  const ids = raw.map((l) => Number(l.component_id));
  if (new Set(ids).size !== ids.length) throw new SalaryError("A pay component appears twice.");
  const comps = await prisma.hrPayComponent.findMany({ where: { id: { in: ids } } });
  const byId = new Map(comps.map((c) => [c.id, c]));
  const lines = raw
    .map((l) => ({ component_id: Number(l.component_id), value: Number(l.value) }))
    .filter((l) => l.value !== 0);
  for (const l of lines) {
    const c = byId.get(l.component_id);
    if (!c) throw new SalaryError("A pay component no longer exists — refresh.");
    if (!Number.isFinite(l.value) || l.value < 0) throw new SalaryError(`${c.name}: enter an amount (0 or more).`);
    if (c.calc === "PERCENT_BASIC" && l.value > 1000) throw new SalaryError(`${c.name}: a % of basic cannot exceed 1000.`);
  }
  const reason = b.reason ? String(b.reason).trim().slice(0, 500) || null : null;
  return { employee_id, effective_from: b.effective_from, basic: Math.round(basic * 100) / 100, lines, reason, byId };
}

/** The active structure in force on a day, per employee. */
export async function salaryOn(employeeIds, dayKey) {
  const rows = await prisma.hrSalaryStructure.findMany({
    where: { employee_id: { in: employeeIds }, status: "active", effective_from: { lte: dbDay(dayKey) } },
    orderBy: [{ effective_from: "asc" }, { id: "asc" }],
    include: STRUCTURE_INCLUDE,
  });
  const out = new Map();
  for (const s of rows) out.set(s.employee_id, s); // later wins
  return out;
}

/** A stored structure → totals (calc.js). */
export const totalsOf = (s) => (s ? salaryTotals(s.basic, s.lines.map((l) => ({ component: l.component, value: l.value }))) : null);

/** Make a structure the salary from its date (another active one on the same date is replaced). */
export async function activateStructure(id, { actor, note = null }, db = prisma) {
  const s = await db.hrSalaryStructure.findUnique({ where: { id } });
  if (!s) throw new SalaryError("Salary revision not found.", 404);
  if (s.status !== "pending" && s.status !== "draft") throw new SalaryError(`This revision is already ${s.status}.`, 409);
  await db.hrSalaryStructure.updateMany({
    where: { employee_id: s.employee_id, effective_from: s.effective_from, status: "active", NOT: { id } },
    data: { status: "cancelled", decision_note: `Replaced by revision #S-${id}` },
  });
  await db.hrSalaryStructure.update({ where: { id }, data: { status: "active", decided_by: actor, decided_at: new Date(), decision_note: note } });
  return s;
}

/** One line for lists and approval summaries. */
export async function revisionSummary(data, gross) {
  const emp = await prisma.employee.findUnique({ where: { id: data.employee_id }, select: { firstName: true, middleName: true, surname: true } });
  return `${employeeName(emp)} · from ${data.effective_from} · basic ${fmtMoney(data.basic)} · gross ${fmtMoney(gross)}${data.reason ? ` — ${data.reason}` : ""}`;
}

export const structureLite = (s) =>
  s && {
    id: s.id,
    effective_from: dayKeyOfDb(s.effective_from),
    basic: s.basic,
    status: s.status,
    reason: s.reason,
    decision_note: s.decision_note,
    created_at: s.created_at,
    lines: s.lines.map((l) => ({ component_id: l.component_id, value: l.value })),
    totals: totalsOf(s),
  };
