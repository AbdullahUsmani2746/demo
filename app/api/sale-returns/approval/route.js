import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import {
  REASON,
  SR_STATUS,
  canApproveSaleReturns,
  canRemarkSaleReturns,
  loadSaleReturns,
} from "@/lib/saleReturns/remarks";
import { canOpenApproval } from "@/lib/approvals/access";

// Only reviewers (saleReturn.approve / saleReturn.remark — Admin →
// Permissions → Approvals) may open the queue or act on it.
const notReviewer = () =>
  NextResponse.json({ error: "Only the Sale Return reviewers can open this (Permissions → Approvals)." }, { status: 403 });

// ============================================================
// /api/sale-returns/approval — approval of Technical sale-return reasons
// ============================================================
// GET  ?view=pending|decided  → { data, canApprove }
//      pending = Technical reasons waiting for approval
//      decided = "All Reasons": every Commercial reason + Technical ones
//                approved / rejected (latest 300)
//      Reviewers only, and they see every return.
// POST { tran_id, action: remark|approve|reject, remarks? }
//      remark → saleReturn.remark; approve / reject → saleReturn.approve
// Rules: lib/saleReturns/remarks.js
// ============================================================

export const GET = guard(null, async (req, { session }) => {
  try {
    if (!(await canOpenApproval(session, "saleReturn"))) return notReviewer();
    const canApprove = await canApproveSaleReturns(session);
    const view = new URL(req.url).searchParams.get("view") || "pending";

    // const remarks = await prisma.saleReturnRemark.findMany({
    //   where:
    //     view === "decided"
    //       ? { reason_type: REASON.TECHNICAL, status: { in: [SR_STATUS.APPROVED, SR_STATUS.REJECTED] } }
    //       : { reason_type: REASON.TECHNICAL, status: SR_STATUS.PENDING },
    //   orderBy: view === "decided" ? { decided_at: "desc" } : { entered_at: "asc" },
    //   take: view === "decided" ? 200 : undefined,
    //   select: { tran_id: true },
    // });
    // const order = remarks.map((r) => r.tran_id);

    // pending = Technical reasons waiting for approval (unchanged).
    // decided ("All Reasons") = every Commercial reason + Technical ones
    // already approved / rejected, latest first (decided, else entered).
    let order;
    if (view === "all") {
      // No approval any more: every reason entered — Technical and
      // Commercial 
      const remarks = await prisma.saleReturnRemark.findMany({
        where: { reason_type: { in: [REASON.TECHNICAL, REASON.COMMERCIAL] } },
        orderBy: { entered_at: "desc" },
        take: 500,
        select: { tran_id: true },
      });
      order = remarks.map((r) => r.tran_id);
    } else if (view === "decided") {
      const remarks = await prisma.saleReturnRemark.findMany({
        where: {
          OR: [
            { reason_type: REASON.COMMERCIAL },
            { reason_type: REASON.TECHNICAL, status: { in: [SR_STATUS.APPROVED, SR_STATUS.REJECTED] } },
          ],
        },
        select: { tran_id: true, decided_at: true, entered_at: true },
      });
      const when = (r) => new Date(r.decided_at || r.entered_at || 0).getTime();
      order = remarks
        .sort((a, b) => when(b) - when(a))
        .slice(0, 300)
        .map((r) => r.tran_id);
    } else {
      const remarks = await prisma.saleReturnRemark.findMany({
        where: { reason_type: REASON.TECHNICAL, status: SR_STATUS.PENDING },
        orderBy: { entered_at: "asc" },
        select: { tran_id: true },
      });
      order = remarks.map((r) => r.tran_id);
    }

    // Reviewers see every customer's returns.
    const rows = order.length ? await loadSaleReturns({ acnos: null, tranIds: order }) : [];
    const byId = new Map(rows.map((r) => [r.tran_id, r]));
    const data = order.map((id) => byId.get(id)).filter(Boolean);

    // return NextResponse.json({ data, canApprove });
    // canRemark: may write the review remark (saleReturn.remark)
    return NextResponse.json({ data, canApprove, canRemark: await canRemarkSaleReturns(session) });
  } catch (error) {
    console.error("sale-returns/approval GET error:", error);
    return NextResponse.json(
      { error: "Failed to load sale returns for approval", detail: error.message },
      { status: 500 },
    );
  }
});

// export const POST = guard(SR_APPROVE_PERMISSION, async (req, { session }) => {
// Signed-in only here; each action checks its own right below.
export const POST = guard(null, async (req, { session }) => {
  try {
    if (!(await canOpenApproval(session, "saleReturn"))) return notReviewer();
    const { tran_id, action, remarks } = await req.json();
    const tranId = Number(tran_id);
    if (!Number.isFinite(tranId)) {
      return NextResponse.json({ error: "tran_id is required" }, { status: 400 });
    }

    // Review remark on a reason — holders of saleReturn.remark only. Kept
    // in the existing decision_remarks / decided_by / decided_at columns;
    // status is not touched. Empty text clears it.
    if (action === "remark") {
      if (!(await canRemarkSaleReturns(session))) {
        return NextResponse.json({ error: "You may not enter review remarks (saleReturn.remark — Permissions → Approvals)." }, { status: 403 });
      }
      const existing = await prisma.saleReturnRemark.findUnique({ where: { tran_id: tranId } });
      if (!existing) {
        return NextResponse.json({ error: "No reason entered on this sale return yet" }, { status: 422 });
      }
      // Remarks are written on Commercial reasons only
      if (existing.reason_type !== REASON.COMMERCIAL) {
        return NextResponse.json({ error: "Remarks can be entered on a Commercial reason only" }, { status: 422 });
      }
      const text = remarks ? String(remarks).trim().slice(0, 500) || null : null;
      await prisma.saleReturnRemark.update({
        where: { tran_id: tranId },
        data: {
          decision_remarks: text,
          decided_by: text ? session.user.id : null,
          decided_at: text ? new Date() : null,
        },
      });
      return NextResponse.json({ success: true, message: text ? "Remark saved" : "Remark cleared" });
    }

    // Approve / reject (no longer used by the page) keep their own right.
    if (!(await canApproveSaleReturns(session))) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const decision =
      action === "approve" ? SR_STATUS.APPROVED : action === "reject" ? SR_STATUS.REJECTED : null;
    if (!decision) {
      return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
    }

    const existing = await prisma.saleReturnRemark.findUnique({ where: { tran_id: tranId } });
    if (!existing || existing.reason_type !== REASON.TECHNICAL || existing.status !== SR_STATUS.PENDING) {
      return NextResponse.json(
        { error: "This sale return is not waiting for approval" },
        { status: 422 },
      );
    }

    await prisma.saleReturnRemark.update({
      where: { tran_id: tranId },
      data: {
        status: decision,
        decided_by: session.user.id,
        decided_at: new Date(),
        decision_remarks: remarks ? String(remarks).trim().slice(0, 500) || null : null,
      },
    });

    const sr = await prisma.transactionsMaster.findUnique({
      where: { tran_id: tranId },
      select: { vr_no: true },
    });
    const no = sr?.vr_no ?? tranId;
    return NextResponse.json({
      success: true,
      message:
        decision === SR_STATUS.APPROVED
          ? `Sale Return #${no} approved`
          : `Sale Return #${no} rejected — the sales person can correct and resend it`,
    });
  } catch (error) {
    console.error("sale-returns/approval POST error:", error);
    return NextResponse.json(
      { error: "Failed to save the decision", detail: error.message },
      { status: 500 },
    );
  }
});
