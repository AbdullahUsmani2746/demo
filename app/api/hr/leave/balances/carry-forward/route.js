// /api/hr/leave/balances/carry-forward — close a leave year.
//   POST { year }  For every employee in the person's departments and every
//   type that carries forward: what is left of `year` (entitled + carried +
//   adjusted − used; pending NOT counted), capped at the type's
//   max_carry_forward, becomes the carry-forward of year + 1. Re-running it
//   recalculates (it overwrites, never adds).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { employeeScopeWhere, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { balancesFor, LeaveError, leaveYearStart } from "@/lib/hr/leave/balance";
import { leaveYearLabel } from "@/lib/hr/leave/policy";

export const maxDuration = 120;

export const POST = hrRoute([HR_PERMS.leaveManage], async (req, { session }) => {
  const year = Number((await jsonBody(req)).year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new LeaveError("Pick the leave year to close.");
  const sm = await leaveYearStart();
  const types = await prisma.hrLeaveType.findMany({ where: { max_carry_forward: { gt: 0 } } });
  if (!types.length) throw new LeaveError("No leave type carries days forward — set “carry forward” on a type first.");

  const employees = await prisma.employee.findMany({ where: { AND: [await employeeScopeWhere(session), { status: "ACTIVE" }] }, select: { id: true } });
  const { rows } = await balancesFor({ employeeIds: employees.map((e) => e.id), year, startMonth: sm, typeIds: types.map((t) => t.id) });
  const typeById = new Map(types.map((t) => [t.id, t]));

  const writes = [];
  for (const b of rows.values()) {
    const left = b.entitled + b.carry_forward + b.adjustment - b.used; // pending not counted
    const carry = Math.min(typeById.get(b.leave_type_id).max_carry_forward, Math.max(0, Math.floor(left * 2) / 2));
    writes.push(
      prisma.hrLeaveBalance.upsert({
        where: { employee_id_leave_type_id_year: { employee_id: b.employee_id, leave_type_id: b.leave_type_id, year: year + 1 } },
        update: { carry_forward: carry, updated_by: session.user.id },
        create: { employee_id: b.employee_id, leave_type_id: b.leave_type_id, year: year + 1, carry_forward: carry, updated_by: session.user.id },
      }),
    );
  }
  for (let i = 0; i < writes.length; i += 200) await prisma.$transaction(writes.slice(i, i + 200));
  return NextResponse.json({
    success: true,
    message: `Carried forward from ${leaveYearLabel(year, sm)} to ${leaveYearLabel(year + 1, sm)} for ${employees.length} employee(s) · ${types.map((t) => t.code).join(", ")}.`,
  });
});
