// /api/hr/attendance/swaps — planned off-day swaps (lib/hr/attendance/swaps.js).
//
//   GET  ?status=&from=&to=&department=&location=&q=
//        swaps of the employees the session works with; from / to = either
//        day inside that span
//   POST { employee_ids: [..], work_date, off_date, reason, approve_now? }
//        one swap per employee, one approval request for all of them. An
//        attendance approver entering it for others may approve it at once.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, employeeFilter, employeeName, hrRights, HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { createHrRequest } from "@/lib/hr/approvals";
import { approveSwaps, planSwap, SWAP_STATUS } from "@/lib/hr/attendance/swaps";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dayKeyOfDb, dbDay, isDayKey } from "@/lib/hr/time";

export const GET = hrRoute([HR_PERMS.view, HR_PERMS.mark, HR_PERMS.approve], async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const and = [{ employee: await employeeFilter(session, sp) }];
  const status = sp.get("status");
  if (SWAP_STATUS.includes(status)) and.push({ status });
  const from = isDayKey(sp.get("from")) ? sp.get("from") : null;
  const to = isDayKey(sp.get("to")) ? sp.get("to") : null;
  if (from || to) {
    const span = { ...(from && { gte: dbDay(from) }), ...(to && { lte: dbDay(to) }) };
    and.push({ OR: [{ work_date: span }, { off_date: span }] });
  }
  const [rows, rights, selfId] = await Promise.all([
    prisma.hrOffSwap.findMany({
      where: { AND: and },
      orderBy: [{ work_date: "desc" }, { id: "desc" }],
      take: 500,
      include: { employee: { select: EMPLOYEE_SELECT } },
    }),
    hrRights(session),
    sessionEmployeeId(session),
  ]);
  const userIds = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter(Boolean))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  return NextResponse.json({
    swaps: rows.map((r) => ({
      id: r.id,
      employee: employeeLite(r.employee),
      work_date: dayKeyOfDb(r.work_date),
      off_date: dayKeyOfDb(r.off_date),
      reason: r.reason,
      status: r.status,
      approval_request_id: r.approval_request_id,
      requested_by: nameOf.get(r.requested_by) || r.requested_by,
      requested_at: r.requested_at,
      decided_by: r.decided_by ? nameOf.get(r.decided_by) || r.decided_by : null,
      decided_at: r.decided_at,
      decision_note: r.decision_note,
      can: {
        decide: r.status === "pending" && rights.approve && r.employee_id !== selfId,
        cancel:
          (r.status === "pending" && (r.requested_by === session.user.id || rights.mark)) ||
          (r.status === "approved" && (rights.mark || rights.approve)),
      },
    })),
  });
});

export const POST = hrRoute([HR_PERMS.mark], async (req, { session }) => {
  const b = await jsonBody(req);
  const ids = [...new Set((Array.isArray(b.employee_ids) ? b.employee_ids : [b.employee_id]).map(Number).filter(Number.isInteger))];
  if (!ids.length) return NextResponse.json({ error: "Pick the employee(s)." }, { status: 400 });
  if (ids.length > 300) return NextResponse.json({ error: "At most 300 employees at a time." }, { status: 400 });
  await assertEmployeesInScope(session, ids);
  const reason = b.reason ? String(b.reason).trim().slice(0, 500) || null : null;
  const plan = await planSwap({ employee_ids: ids, work_date: b.work_date, off_date: b.off_date });

  const created = await prisma.$transaction(
    ids.map((id) =>
      prisma.hrOffSwap.create({
        data: { employee_id: id, work_date: dbDay(plan.work_date), off_date: dbDay(plan.off_date), reason, requested_by: session.user.id },
      }),
    ),
  );
  const swapIds = created.map((s) => s.id);
  const names = plan.employees.filter((e) => ids.includes(e.id)).map(employeeName);
  const who = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  const what = `${who} · works ${plan.work_date}, off ${plan.off_date}`;

  const [rights, selfId] = await Promise.all([hrRights(session), sessionEmployeeId(session)]);
  if (b.approve_now && rights.approve && !ids.includes(selfId)) {
    try {
      await approveSwaps(swapIds, { actor: session.user.id, note: "Approved when entered" });
    } catch (e) {
      await prisma.hrOffSwap.deleteMany({ where: { id: { in: swapIds } } });
      throw e;
    }
    return NextResponse.json({ ids: swapIds, status: "approved", message: `Off-day swap recorded and approved — ${what}.` }, { status: 201 });
  }

  const request = await createHrRequest({
    docType: "hrOffSwap",
    payload: { swap_ids: swapIds },
    summary: `${what}${reason ? ` — ${reason}` : ""}`,
    session,
  });
  await prisma.hrOffSwap.updateMany({ where: { id: { in: swapIds } }, data: { approval_request_id: request.id } });
  return NextResponse.json({ ids: swapIds, status: "pending", message: `Off-day swap sent for approval — ${what}.` }, { status: 201 });
});
