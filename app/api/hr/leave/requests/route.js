// /api/hr/leave/requests — leave applications.
//
//   GET  ?status=&from=&to=&department=&q=&mine=1
//        Everyone's (hr.leave.view / manage / approve, inside their departments)
//        or only their own. from / to = leaves overlapping that span.
//   POST { employee_id?, leave_type_id, from, to, half_day, reason, approve_now? }
//        employee_id blank = myself. Checked: dates, type rules, overlap,
//        balance (pending counted). Goes to Approvals; a leave approver applying
//        for someone else may approve it at once (approve_now).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { employeeFilter, employeeName, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { assertCanActFor, leaveContext } from "@/lib/hr/leave/access";
import { applyApproved, assertPlanFits, planLeave } from "@/lib/hr/leave/requests";
import { createHrRequest } from "@/lib/hr/approvals";
import { chainForNewRequest } from "@/lib/hr/chains";
import { fmtDays } from "@/lib/hr/leave/policy";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dayKeyOfDb, dbDay, isDayKey } from "@/lib/hr/time";

const LEAVE_PERMS = [HR_PERMS.leaveApply, HR_PERMS.leaveView, HR_PERMS.leaveManage, HR_PERMS.leaveApprove];
const STATUSES = ["pending", "approved", "rejected", "cancelled"];

export const GET = hrRoute(LEAVE_PERMS, async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const lc = await leaveContext(session);
  const mine = sp.get("mine") === "1" || !lc.rights.leaveView;
  if (mine && !lc.selfId) return NextResponse.json({ requests: [], selfId: null });

  const and = [mine ? { employee_id: lc.selfId } : { employee: await employeeFilter(session, sp) }];
  const status = sp.get("status");
  if (STATUSES.includes(status)) and.push({ status });
  if (isDayKey(sp.get("from"))) and.push({ to_date: { gte: dbDay(sp.get("from")) } });
  if (isDayKey(sp.get("to"))) and.push({ from_date: { lte: dbDay(sp.get("to")) } });

  const rows = await prisma.hrLeaveRequest.findMany({
    where: { AND: and },
    orderBy: [{ from_date: "desc" }, { id: "desc" }],
    take: 500,
    include: { employee: { select: EMPLOYEE_SELECT }, leaveType: { select: { id: true, code: true, name: true, color: true, is_paid: true } } },
  });
  const userIds = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter(Boolean))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  const me = session.user.id;

  return NextResponse.json({
    selfId: lc.selfId,
    requests: rows.map((r) => {
      const isSelf = r.employee_id === lc.selfId;
      return {
        id: r.id,
        employee: employeeLite(r.employee),
        type: r.leaveType,
        from: dayKeyOfDb(r.from_date),
        to: dayKeyOfDb(r.to_date),
        half_day: r.half_day,
        days: r.days,
        reason: r.reason,
        status: r.status,
        approval_request_id: r.approval_request_id,
        requested_by: nameOf.get(r.requested_by) || r.requested_by,
        requested_at: r.requested_at,
        decided_by: r.decided_by ? nameOf.get(r.decided_by) || r.decided_by : null,
        decided_at: r.decided_at,
        decision_note: r.decision_note,
        can: {
          decide: r.status === "pending" && lc.rights.leaveApprove && !isSelf,
          cancel:
            (r.status === "pending" && (r.requested_by === me || isSelf || lc.rights.leaveManage)) ||
            (r.status === "approved" && (lc.rights.leaveManage || lc.rights.leaveApprove)),
        },
      };
    }),
  });
});

export const POST = hrRoute([HR_PERMS.leaveApply, HR_PERMS.leaveManage], async (req, { session }) => {
  const b = await jsonBody(req);
  const lc = await leaveContext(session);
  const employeeId = b.employee_id ? Number(b.employee_id) : lc.selfId;
  if (!employeeId) return NextResponse.json({ error: "Your login is not linked to an employee — ask HR to apply for you." }, { status: 400 });
  const who = await assertCanActFor(session, lc, employeeId);
  const reason = b.reason ? String(b.reason).trim().slice(0, 500) || null : null;

  const plan = await planLeave({ employee_id: employeeId, leave_type_id: b.leave_type_id, from: b.from, to: b.to, half_day: b.half_day });
  // Its approval chain (lib/hr/chains.js) — refused here, before anything is saved.
  const chain = await chainForNewRequest({ docType: "hrLeave", employeeId });
  await assertPlanFits(plan);

  const lr = await prisma.hrLeaveRequest.create({
    data: {
      employee_id: employeeId,
      leave_type_id: plan.type.id,
      from_date: dbDay(plan.from),
      to_date: dbDay(plan.to),
      half_day: plan.half_day,
      days: plan.days,
      reason,
      requested_by: session.user.id,
    },
  });
  const what = `${employeeName(plan.employee)} · ${plan.type.name} · ${plan.from}${plan.to !== plan.from ? ` → ${plan.to}` : ""} · ${fmtDays(plan.days)} day(s)`;

  if (b.approve_now && !chain && who === "other" && lc.rights.leaveApprove) {
    try {
      await applyApproved(lr.id, { actor: session.user.id, note: "Approved when entered" });
    } catch (e) {
      await prisma.hrLeaveRequest.delete({ where: { id: lr.id } });
      throw e;
    }
    return NextResponse.json({ id: lr.id, status: "approved", message: `Leave #L-${lr.id} recorded and approved — ${what}.` }, { status: 201 });
  }

  const request = await createHrRequest({
    docType: "hrLeave",
    payload: { leave_request_id: lr.id },
    summary: `${what}${reason ? ` — ${reason}` : ""}`,
    session,
    chain,
    employeeId,
  });
  await prisma.hrLeaveRequest.update({ where: { id: lr.id }, data: { approval_request_id: request.id } });
  return NextResponse.json({ id: lr.id, status: "pending", message: `Leave #L-${lr.id} sent for approval — ${what}.` }, { status: 201 });
});
