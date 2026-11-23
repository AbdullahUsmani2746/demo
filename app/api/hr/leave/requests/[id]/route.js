// /api/hr/leave/requests/[id]
//   POST { action: "approve" | "reject" | "cancel", note }
//   approve / reject  the same decision as the Approvals inbox (lib/hr/approvals.js)
//   cancel            pending: the requester, the employee, or a leave manager;
//                     approved: a leave manager / approver — its days come off
//                     attendance (not once payroll has locked them)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { assertCanActFor, leaveContext } from "@/lib/hr/leave/access";
import { withdrawLeave } from "@/lib/hr/leave/requests";
import { decideHrRequest, mayDecideHr } from "@/lib/hr/approvals";
import { REQUEST_STATUS } from "@/lib/approvals/rules";

export const POST = hrRoute([HR_PERMS.leaveApply, HR_PERMS.leaveManage, HR_PERMS.leaveApprove], async (req, { params, session }) => {
  const id = intParam((await params).id);
  const { action, note: raw } = await jsonBody(req);
  const note = raw ? String(raw).trim().slice(0, 500) || null : null;
  const lr = await prisma.hrLeaveRequest.findUnique({ where: { id } });
  if (!lr) return NextResponse.json({ error: "Leave request not found." }, { status: 404 });
  const lc = await leaveContext(session);

  if (action === "approve" || action === "reject") {
    if (lr.status !== "pending") return NextResponse.json({ error: `This leave is already ${lr.status}.` }, { status: 409 });
    const request = lr.approval_request_id ? await prisma.approvalRequest.findUnique({ where: { id: lr.approval_request_id } }) : null;
    if (!request || request.status !== REQUEST_STATUS.PENDING) {
      return NextResponse.json({ error: "Its approval request is not waiting any more — refresh." }, { status: 409 });
    }
    // In an approval chain only the current step's people decide (lib/hr/chains.js).
    if (!(await mayDecideHr(session, request))) return NextResponse.json({ error: "You may not approve leave (or not at this step)." }, { status: 403 });
    const { status, body } = await decideHrRequest({ request, action, note, session });
    return NextResponse.json(body, { status });
  }

  if (action !== "cancel") return NextResponse.json({ error: "action must be approve, reject or cancel" }, { status: 400 });

  if (lr.status === "pending") {
    if (lr.requested_by !== session.user.id) await assertCanActFor(session, lc, lr.employee_id);
    const done = await prisma.hrLeaveRequest.updateMany({
      where: { id, status: "pending" },
      data: { status: "cancelled", decided_by: session.user.id, decided_at: new Date(), decision_note: note || "Cancelled" },
    });
    if (done.count !== 1) return NextResponse.json({ error: "This leave was decided a moment ago — refresh." }, { status: 409 });
    if (lr.approval_request_id) {
      await prisma.approvalRequest.updateMany({
        where: { id: lr.approval_request_id, status: REQUEST_STATUS.PENDING },
        data: { status: REQUEST_STATUS.CANCELLED, decided_by: session.user.id, decided_at: new Date(), remarks: "Leave cancelled" },
      });
    }
    return NextResponse.json({ success: true, message: `Leave #L-${id} cancelled.` });
  }

  if (lr.status === "approved") {
    if (!(lc.rights.leaveManage || lc.rights.leaveApprove)) {
      return NextResponse.json({ error: "Only a leave manager or approver can cancel approved leave." }, { status: 403 });
    }
    if (!note) return NextResponse.json({ error: "Give the reason for cancelling approved leave." }, { status: 400 });
    const removed = await withdrawLeave(lr, { actor: session.user.id });
    await prisma.hrLeaveRequest.update({
      where: { id },
      data: { status: "cancelled", decided_by: session.user.id, decided_at: new Date(), decision_note: note },
    });
    return NextResponse.json({ success: true, message: `Leave #L-${id} cancelled — ${removed} day(s) taken off attendance.` });
  }
  return NextResponse.json({ error: `This leave is already ${lr.status}.` }, { status: 409 });
});
