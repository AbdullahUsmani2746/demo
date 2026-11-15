// /api/hr/salary/revisions/[id]
//   POST { action: "approve" | "reject" | "cancel", note }
//   approve / reject — the same decision as the Approvals inbox
//   cancel           — a pending revision, by whoever entered it or a salary manager
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hrRights, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { canDecideHr, decideHrRequest } from "@/lib/hr/approvals";
import { REQUEST_STATUS } from "@/lib/approvals/rules";

export const POST = hrRoute([HR_PERMS.salaryManage, HR_PERMS.salaryApprove], async (req, { params, session }) => {
  const id = intParam((await params).id);
  const { action, note: raw } = await jsonBody(req);
  const note = raw ? String(raw).trim().slice(0, 500) || null : null;
  const s = await prisma.hrSalaryStructure.findUnique({ where: { id } });
  if (!s) return NextResponse.json({ error: "Revision not found." }, { status: 404 });
  if (s.status !== "pending") return NextResponse.json({ error: `This revision is already ${s.status}.` }, { status: 409 });
  const request = s.approval_request_id ? await prisma.approvalRequest.findUnique({ where: { id: s.approval_request_id } }) : null;

  if (action === "approve" || action === "reject") {
    if (!request || request.status !== REQUEST_STATUS.PENDING) return NextResponse.json({ error: "Its approval request is not waiting any more — refresh." }, { status: 409 });
    if (!(await canDecideHr(session, "hrSalary"))) return NextResponse.json({ error: "You may not approve salary revisions." }, { status: 403 });
    const { status, body } = await decideHrRequest({ request, action, note, session });
    return NextResponse.json(body, { status });
  }
  if (action !== "cancel") return NextResponse.json({ error: "action must be approve, reject or cancel" }, { status: 400 });
  const rights = await hrRights(session);
  if (s.created_by !== session.user.id && !rights.salaryManage) return NextResponse.json({ error: "Only whoever entered it or a salary manager can cancel it." }, { status: 403 });
  await prisma.hrSalaryStructure.update({ where: { id }, data: { status: "cancelled", decided_by: session.user.id, decided_at: new Date(), decision_note: note || "Cancelled" } });
  if (request) {
    await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.PENDING },
      data: { status: REQUEST_STATUS.CANCELLED, decided_by: session.user.id, decided_at: new Date(), remarks: "Revision cancelled" },
    });
  }
  return NextResponse.json({ success: true, message: `Revision #S-${id} cancelled.` });
});
