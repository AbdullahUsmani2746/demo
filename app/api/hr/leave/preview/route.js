// /api/hr/leave/preview — what an application would take, before sending it.
//   POST { employee_id?, leave_type_id, from, to, half_day }
//   → { days, dates: [{ day, counts, why }], balance, after, fits }
//   An application that is not allowed → 400 { error } (shown under the form).
import { NextResponse } from "next/server";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { assertCanActFor, leaveContext } from "@/lib/hr/leave/access";
import { assertPlanFits, planLeave } from "@/lib/hr/leave/requests";
import { balancesFor } from "@/lib/hr/leave/balance";
import { leaveYearLabel } from "@/lib/hr/leave/policy";
import { eachDay } from "@/lib/hr/time";
import { loadContext } from "@/lib/hr/attendance/sheet";

export const POST = hrRoute([HR_PERMS.leaveApply, HR_PERMS.leaveManage], async (req, { session }) => {
  const b = await jsonBody(req);
  const lc = await leaveContext(session);
  const employeeId = b.employee_id ? Number(b.employee_id) : lc.selfId;
  if (!employeeId) return NextResponse.json({ error: "Your login is not linked to an employee." }, { status: 400 });
  await assertCanActFor(session, lc, employeeId);

  const plan = await planLeave({ employee_id: employeeId, leave_type_id: b.leave_type_id, from: b.from, to: b.to, half_day: b.half_day });
  // Comp off: every day must find an earned day before it — the exact check, shown under the form.
  if (plan.type.comp_off) await assertPlanFits(plan);
  const [{ rows }, ctx] = await Promise.all([
    balancesFor({ employeeIds: [employeeId], year: plan.year, startMonth: plan.startMonth, typeIds: [plan.type.id] }),
    loadContext({ employeeWhere: { id: employeeId }, from: plan.from, to: plan.to }),
  ]);
  const bal = rows.get(`${employeeId}|${plan.type.id}`);
  const counted = new Set(plan.dates);
  return NextResponse.json({
    days: plan.days,
    year: leaveYearLabel(plan.year, plan.startMonth),
    dates: eachDay(plan.from, plan.to).map((d) => {
      const h = ctx.holidayOn.get(d);
      return { day: d, counts: counted.has(d), why: counted.has(d) ? null : h ? `Holiday · ${h.name}` : "Week off" };
    }),
    balance: bal,
    unlimited: plan.type.allow_negative,
    after: bal ? bal.available - plan.days : null,
    fits: plan.type.allow_negative || (bal ? bal.available - plan.days >= -1e-9 : false),
  });
});
