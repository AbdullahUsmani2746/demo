// /api/hr/attendance/swaps/[id]
//   POST { action: "approve" | "reject" | "cancel", note }
//   approve / reject  the same decision as the Approvals inbox — for the whole
//                     request the swap belongs to (all its employees)
//   cancel            pending: the requester or an attendance marker — this
//                     employee only; approved: a marker / approver, with a
//                     reason, not once payroll has locked either day
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, hrRights, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { canDecideHr, decideHrRequest } from "@/lib/hr/approvals";
import { withdrawSwap } from "@/lib/hr/attendance/swaps";
import { REQUEST_STATUS } from "@/lib/approvals/rules";

export const POST = hrRoute([HR_PERMS.mark, HR_PERMS.approve], async (req, { params, session }) => {
  const id = intParam((await params).id);
  const { action, note: raw } = await jsonBody(req);
  const note = raw ? String(raw).trim().slice(0, 500) || null : null;
  const swap = await prisma.hrOffSwap.findUnique({ where: { id } });
  if (!swap) return NextResponse.json({ error: "Swap not found." }, { status: 404 });
  await assertEmployeesInScope(session, [swap.employee_id]);
  const rights = await hrRights(session);

  if (action === "approve" || action === "reject") {
    if (swap.status !== "pending") return NextResponse.json({ error: `This swap is already ${swap.status}.` }, { status: 409 });
    const request = swap.approval_request_id ? await prisma.approvalRequest.findUnique({ where: { id: swap.approval_request_id } }) : null;
    if (!request || request.status !== REQUEST_STATUS.PENDING) {
      return NextResponse.json({ error: "Its approval request is not waiting any more — refresh." }, { status: 409 });
    }
    if (!(await canDecideHr(session, "hrOffSwap"))) return NextResponse.json({ error: "You may not approve off-day swaps." }, { status: 403 });
    const { status, body } = await decideHrRequest({ request, action, note, session });
    return NextResponse.json(body, { status });
  }

  if (action !== "cancel") return NextResponse.json({ error: "action must be approve, reject or cancel" }, { status: 400 });

  if (swap.status === "pending") {
    if (swap.requested_by !== session.user.id && !rights.mark) {
      return NextResponse.json({ error: "Only the requester or an attendance marker can cancel this swap." }, { status: 403 });
    }
    const done = await prisma.hrOffSwap.updateMany({
      where: { id, status: "pending" },
      data: { status: "cancelled", decided_by: session.user.id, decided_at: new Date(), decision_note: note || "Cancelled" },
    });
    if (done.count !== 1) return NextResponse.json({ error: "This swap was decided a moment ago — refresh." }, { status: 409 });
    // The approval request goes when none of its swaps is waiting any more.
    if (swap.approval_request_id) {
      const left = await prisma.hrOffSwap.count({ where: { approval_request_id: swap.approval_request_id, status: "pending" } });
      if (!left) {
        await prisma.approvalRequest.updateMany({
          where: { id: swap.approval_request_id, status: REQUEST_STATUS.PENDING },
          data: { status: REQUEST_STATUS.CANCELLED, decided_by: session.user.id, decided_at: new Date(), remarks: "Swap cancelled" },
        });
      }
    }
    return NextResponse.json({ success: true, message: `Swap #S-${id} cancelled.` });
  }

  if (swap.status === "approved") {
    if (!(rights.mark || rights.approve)) {
      return NextResponse.json({ error: "Only an attendance marker or approver can cancel an approved swap." }, { status: 403 });
    }
    if (!note) return NextResponse.json({ error: "Give the reason for cancelling an approved swap." }, { status: 400 });
    await withdrawSwap(swap, { actor: session.user.id, note });
    return NextResponse.json({ success: true, message: `Swap #S-${id} cancelled — both days are back to normal.` });
  }
  return NextResponse.json({ error: `This swap is already ${swap.status}.` }, { status: 409 });
});
