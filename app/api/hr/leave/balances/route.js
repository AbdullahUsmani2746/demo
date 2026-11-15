// /api/hr/leave/balances
//   GET  ?year=&department=&q=&mine=1
//        employees × leave types for a leave year (everyone's with hr.leave.view,
//        otherwise only their own)
//   PUT  { employee_id, leave_type_id, year, carry_forward, adjustment, note }
//        set what HR adds to a balance (hr.leave.manage); a note is required
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeFilter, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { leaveContext } from "@/lib/hr/leave/access";
import { balancesFor, LeaveError, leaveYearStart } from "@/lib/hr/leave/balance";
import { leaveYearLabel, leaveYearOf, leaveYearRange } from "@/lib/hr/leave/policy";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dbDay, todayKey } from "@/lib/hr/time";

const LEAVE_PERMS = [HR_PERMS.leaveApply, HR_PERMS.leaveView, HR_PERMS.leaveManage, HR_PERMS.leaveApprove];

export const GET = hrRoute(LEAVE_PERMS, async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const lc = await leaveContext(session);
  const sm = await leaveYearStart();
  const year = Number(sp.get("year")) || leaveYearOf(todayKey(), sm);
  const mine = sp.get("mine") === "1" || !lc.rights.leaveView;
  if (mine && !lc.selfId) return NextResponse.json({ year, label: leaveYearLabel(year, sm), types: [], employees: [], selfId: null });

  const range = leaveYearRange(year, sm);
  const employees = await prisma.employee.findMany({
    where: mine
      ? { id: lc.selfId }
      : { AND: [await employeeFilter(session, sp), { hireDate: { lte: dbDay(range.to) } }, { OR: [{ status: "ACTIVE" }, { dor: { gte: dbDay(range.from) } }] }] },
    select: EMPLOYEE_SELECT,
    orderBy: [{ departmentId: "asc" }, { firstName: "asc" }],
  });
  const { range: yr, types, rows } = await balancesFor({ employeeIds: employees.map((e) => e.id), year, startMonth: sm });
  return NextResponse.json({
    year,
    label: leaveYearLabel(year, sm),
    range: yr,
    selfId: lc.selfId,
    types: types.filter((t) => t.is_active || employees.some((e) => rows.get(`${e.id}|${t.id}`)?.used)),
    employees: employees.map((e) => ({
      employee: employeeLite(e),
      balances: Object.fromEntries(types.map((t) => [t.id, rows.get(`${e.id}|${t.id}`)])),
    })),
  });
});

export const PUT = hrRoute([HR_PERMS.leaveManage], async (req, { session }) => {
  const b = await jsonBody(req);
  const employee_id = Number(b.employee_id);
  const leave_type_id = Number(b.leave_type_id);
  const year = Number(b.year);
  if (![employee_id, leave_type_id, year].every(Number.isInteger)) throw new LeaveError("Employee, leave type and year are required.");
  const carry = Number(b.carry_forward ?? 0);
  const adjustment = Number(b.adjustment ?? 0);
  if (!Number.isFinite(carry) || carry < 0 || carry > 366 || !Number.isInteger(carry * 2)) throw new LeaveError("Carry forward: 0–366, in half days.");
  if (!Number.isFinite(adjustment) || Math.abs(adjustment) > 366 || !Number.isInteger(adjustment * 2)) throw new LeaveError("Adjustment: −366 to 366, in half days.");
  const note = String(b.note ?? "").trim().slice(0, 300);
  if (!note) throw new LeaveError("Say why the balance is changed — it is kept with the balance.");
  await assertEmployeesInScope(session, [employee_id]);

  await prisma.hrLeaveBalance.upsert({
    where: { employee_id_leave_type_id_year: { employee_id, leave_type_id, year } },
    update: { carry_forward: carry, adjustment, note, updated_by: session.user.id },
    create: { employee_id, leave_type_id, year, carry_forward: carry, adjustment, note, updated_by: session.user.id },
  });
  return NextResponse.json({ success: true, message: "Balance saved." });
});
