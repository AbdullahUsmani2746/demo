// /api/hr/salary — salaries.
//
//   GET  ?department=&q=&date=   active employees with the salary in force on
//                                date (default today) and any revision waiting
//   POST { employee_id, effective_from, basic, lines: [{ component_id, value }], reason }
//        a revision. hr.salary.approve on someone else's salary → in force now;
//        otherwise it waits in Approvals (hrSalary). One may wait per employee.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeFilter, hrRights, HR_PERMS, userIdsOfEmployee } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { activateStructure, revisionData, revisionSummary, salaryOn, STRUCTURE_INCLUDE, structureLite } from "@/lib/hr/salary/service";
import { salaryTotals } from "@/lib/hr/salary/calc";
import { createHrRequest } from "@/lib/hr/approvals";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dbDay, isDayKey, todayKey } from "@/lib/hr/time";

const VIEW = [HR_PERMS.salaryView, HR_PERMS.salaryManage, HR_PERMS.salaryApprove];

export const GET = hrRoute(VIEW, async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const on = isDayKey(sp.get("date")) ? sp.get("date") : todayKey();
  const employees = await prisma.employee.findMany({
    where: { AND: [await employeeFilter(session, sp), { status: "ACTIVE" }] },
    select: { ...EMPLOYEE_SELECT, advanceAcno: true, loanAcno: true, incomeTaxMode: true },
    orderBy: [{ departmentId: "asc" }, { firstName: "asc" }],
  });
  const ids = employees.map((e) => e.id);
  const [current, pending] = await Promise.all([
    salaryOn(ids, on),
    prisma.hrSalaryStructure.findMany({ where: { employee_id: { in: ids }, status: "pending" }, include: STRUCTURE_INCLUDE }),
  ]);
  const pendingOf = new Map(pending.map((p) => [p.employee_id, p]));
  return NextResponse.json({
    date: on,
    employees: employees.map((e) => ({
      employee: employeeLite(e),
      // Income tax: SLAB (by the slabs) or NONE (not deducted) — /api/hr/salary/tax
      tax_mode: e.incomeTaxMode || "SLAB",
      current: structureLite(current.get(e.id)) ?? null,
      pending: structureLite(pendingOf.get(e.id)) ?? null,
    })),
  });
});

export const POST = hrRoute([HR_PERMS.salaryManage, HR_PERMS.salaryApprove], async (req, { session }) => {
  const d = await revisionData(await jsonBody(req));
  await assertEmployeesInScope(session, [d.employee_id]);
  const waiting = await prisma.hrSalaryStructure.findFirst({ where: { employee_id: d.employee_id, status: "pending" } });
  if (waiting) {
    return NextResponse.json({ error: `A revision for this employee is already waiting for approval (#S-${waiting.id}) — decide or cancel it first.` }, { status: 409 });
  }
  const totals = salaryTotals(d.basic, d.lines.map((l) => ({ component: d.byId.get(l.component_id), value: l.value })));
  const rights = await hrRights(session);
  const own = (await userIdsOfEmployee(d.employee_id)).includes(session.user.id);
  const direct = rights.salaryApprove && !own;

  const s = await prisma.hrSalaryStructure.create({
    data: {
      employee_id: d.employee_id,
      effective_from: dbDay(d.effective_from),
      basic: d.basic,
      status: "pending",
      reason: d.reason,
      created_by: session.user.id,
      lines: { create: d.lines.map((l) => ({ component_id: l.component_id, value: l.value })) },
    },
  });
  if (direct) {
    await activateStructure(s.id, { actor: session.user.id, note: "Revised directly by an approver" });
    return NextResponse.json({ id: s.id, status: "active", message: `Salary revised from ${d.effective_from}.` }, { status: 201 });
  }
  const request = await createHrRequest({
    docType: "hrSalary",
    payload: { structure_id: s.id },
    summary: await revisionSummary(d, totals.gross),
    session,
  });
  await prisma.hrSalaryStructure.update({ where: { id: s.id }, data: { approval_request_id: request.id } });
  return NextResponse.json({ id: s.id, status: "pending", message: `Revision #S-${s.id} sent for approval.` }, { status: 201 });
});
