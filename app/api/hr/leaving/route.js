// /api/hr/leaving — the leaving process (feature hr.leavingProcess).
//   GET  ?status=open|completed|all&q=   leavings of the employees the person works
//        with (hr.leaving.* / hr.settlement.*); with only hr.leaving.apply, or ?mine=1 → own
//   POST { employee_id?, kind, notice_date, last_working_day, reason }
//        hr.leaving.manage: anyone in scope, any kind;
//        hr.leaving.apply: oneself, resignation only. Goes to Approvals (hrSeparation).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeFilter, hrRights, HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { hrRoute, jsonBody, requireFeature } from "@/lib/hr/route";
import { ForbiddenError } from "@/lib/auth/permissions";
import { LeavingError, requestSeparation, SEP_INCLUDE, separationLite } from "@/lib/hr/leaving/separation";

const ALL = [HR_PERMS.leavingApply, HR_PERMS.leavingManage, HR_PERMS.leavingApprove, HR_PERMS.settlementManage, HR_PERMS.settlementApprove, HR_PERMS.settlementPost];

export const GET = hrRoute(ALL, async (req, { session }) => {
  await requireFeature("hr.leavingProcess");
  const sp = new URL(req.url).searchParams;
  const rights = await hrRights(session);
  const status = sp.get("status") || "open";
  const statusWhere = status === "open" ? { status: { in: ["pending", "approved"] } } : status === "completed" ? { status: "completed" } : {};
  let employeeWhere;
  const mine = Boolean(sp.get("mine")) || !rights.leavingView;
  if (!mine) employeeWhere = await employeeFilter(session, sp);
  else {
    const me = await sessionEmployeeId(session);
    employeeWhere = { id: me ?? -1 };
  }
  const rows = await prisma.hrSeparation.findMany({
    where: { AND: [statusWhere, { employee: employeeWhere }] },
    include: { ...SEP_INCLUDE, settlements: { where: { status: { not: "REVERSED" } }, select: { id: true, status: true, net: true, pay_tran_id: true, pay_reversal_tran_id: true } } },
    orderBy: [{ requested_at: "desc" }],
    take: 300,
  });
  return NextResponse.json({
    team: !mine,
    rows: rows.map((s) => ({
      ...separationLite(s),
      settlement: s.settlements[0] ? { ...s.settlements[0], paid: Boolean(s.settlements[0].pay_tran_id && !s.settlements[0].pay_reversal_tran_id) } : null,
    })),
  });
});

export const POST = hrRoute([HR_PERMS.leavingApply, HR_PERMS.leavingManage], async (req, { session }) => {
  await requireFeature("hr.leavingProcess");
  const b = await jsonBody(req);
  const rights = await hrRights(session);
  const me = await sessionEmployeeId(session);
  const employeeId = b.employee_id ? Number(b.employee_id) : me;
  if (!Number.isInteger(employeeId)) throw new LeavingError("Choose the employee.");
  const self = employeeId === me;
  if (self && !rights.leavingManage) {
    if (!rights.leavingApply) throw new ForbiddenError("You may not resign through the system.", HR_PERMS.leavingApply);
  } else {
    if (!rights.leavingManage) throw new ForbiddenError("You may record leaving only for yourself.", HR_PERMS.leavingManage);
    await assertEmployeesInScope(session, [employeeId]);
  }
  const sep = await requestSeparation({
    employeeId,
    kind: self && !rights.leavingManage ? "RESIGNATION" : b.kind,
    notice_date: b.notice_date,
    last_working_day: b.last_working_day,
    reason: b.reason,
    session,
    self: self && !rights.leavingManage,
  });
  return NextResponse.json({ id: sep.id, message: `Leaving request #L-${sep.id} sent for approval.` }, { status: 201 });
});
