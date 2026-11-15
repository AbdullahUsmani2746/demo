import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { SO_STATUS, reasonsOf } from "@/lib/orders/saleOrderApproval";
// Who may see / decide which order — shared with the Approvals inbox
// (/dashboard/approvals lists these orders through lib/approvals/saleOrders.js).
import { approverScope, mayApprove, mayDecide } from "@/lib/approvals/saleOrders";
import { selfDecisionError } from "@/lib/approvals/rules";

// ============================================================
// /api/orders/saleOrder/approval — approval of Sale Orders (any reason)
// ============================================================
// Approvers only: saleOrder.approve, or an approver of the rule behind the
// order's reason (Admin → Permissions → Approvals).
// GET  ?view=pending|approved|rejected  → { data, canApprove }
//      pending  = status 3, waiting for approval
//      approved = orders already approved (latest 200)
//      rejected = orders rejected (latest 200)
// POST { order_no, action: approve|reject, remarks }
//      approve: status 3 → 1 (or 2 if every line is already closed)
//      reject:  status 3 → 4, the reason in approval_remarks (required); it
//               cannot be dispatched, and editing it sends it back for approval
//      Both are stamped with who decided and when.
// Rules: lib/orders/saleOrderApproval.js
// ============================================================

const SO_CATEGORY = 6;

// The queue is for approvers only — nobody else sees what is waiting, and a
// reason's approver sees only the orders waiting for that reason.
export const GET = guard(null, async (req, { session }) => {
  try {
    const scope = await approverScope(session);
    if (!scope.all && !scope.reasons.size) {
      return NextResponse.json({ error: "Only Sale Order approvers can open this (Permissions → Approvals)." }, { status: 403 });
    }
    const canApprove = true;
    const view = new URL(req.url).searchParams.get("view") || "pending";

    const where =
      view === "approved"
        ? { order_catagory: SO_CATEGORY, approved_at: { not: null }, status: { not: SO_STATUS.REJECTED } }
        : view === "rejected"
          ? { order_catagory: SO_CATEGORY, status: SO_STATUS.REJECTED }
          : { order_catagory: SO_CATEGORY, status: SO_STATUS.PENDING_APPROVAL };
    const decided = view === "approved" || view === "rejected";

    const orders = await prisma.orderMaster.findMany({
      where,
      orderBy: decided ? { approved_at: "desc" } : { order_no: "asc" },
      take: decided ? 200 : undefined,
      include: {
        acno: { select: { acno: true, acname: true } },
        users: { select: { id: true, name: true } },
        godownDetails: { select: { godown: true } },
        orderDetails: {
          select: {
            id: true,
            itcd: true,
            qty: true,
            qty_ltr: true,
            unit: true,
            no_of_packs: true,
            rate: true,
            items: { select: { code: true, item: true } },
          },
        },
      },
    });

    const approverIds = [...new Set(orders.map((o) => o.approved_by).filter(Boolean))];
    const approvers = approverIds.length
      ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } })
      : [];
    const approverName = new Map(approvers.map((u) => [u.id, u.name]));

    const data = orders.filter((o) => mayDecide(scope, o)).map((o) => ({
      order_no: o.order_no,
      // false → some reason belongs to another approver: may reject, not approve
      can_approve: mayApprove(scope, o),
      dated: o.dated,
      due_date: o.due_date,
      status: o.status,
      freeOfCost: o.freeOfCost === true,
      trialProcess: o.trialProcess === true,
      // Why it needs approval — stored at save time; older orders fall back
      // to their flags.
      reasons: reasonsOf(o),
      customer: o.acno?.acname ?? `Customer ${o.party_code}`,
      acno: o.party_code,
      sale_po: o.sale_po,
      godown: o.godownDetails?.godown ?? null,
      instructions: o.additional_instructions,
      created_by: o.users?.name ?? o.userid ?? null,
      approved_by: o.approved_by ? approverName.get(o.approved_by) ?? o.approved_by : null,
      rejected: o.status === SO_STATUS.REJECTED,
      approved_at: o.approved_at,
      approval_remarks: o.approval_remarks,
      total_qty: o.orderDetails.reduce((s, d) => s + (Number(d.qty) || 0), 0),
      lines: o.orderDetails.map((d) => ({
        id: d.id,
        itcd: d.itcd,
        code: d.items?.code ?? null,
        item: d.items?.item ?? `Item ${d.itcd}`,
        qty: Number(d.qty) || 0,
        qty_ltr: d.qty_ltr,
        unit: d.unit,
        no_of_packs: d.no_of_packs,
        rate: Number(d.rate) || 0,
      })),
    }));

    return NextResponse.json({ data, canApprove });
  } catch (error) {
    console.error("SO approval GET error:", error);
    return NextResponse.json(
      { error: "Failed to load sale orders for approval", detail: error.message },
      { status: 500 },
    );
  }
});

export const POST = guard(null, async (req, { session }) => {
  try {
    const { order_no, remarks, action = "approve" } = await req.json();
    const orderNo = Number(order_no);
    if (!Number.isFinite(orderNo)) {
      return NextResponse.json({ error: "order_no is required" }, { status: 400 });
    }
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
    }
    const note = remarks ? String(remarks).trim().slice(0, 500) || null : null;
    if (action === "reject" && !note) {
      return NextResponse.json({ error: "Give the reason for rejecting — the sales person will see it." }, { status: 400 });
    }

    const order = await prisma.orderMaster.findFirst({
      where: { order_no: orderNo, order_catagory: SO_CATEGORY },
      select: { userid: true, status: true, approval_reasons: true, freeOfCost: true, trialProcess: true, rateUnderNegotiation: true, dispatchWithoutGodown: true, noGodown: true, godown: true, orderDetails: { select: { status: true } } },
    });
    if (!order) return NextResponse.json({ error: "Sale Order not found" }, { status: 404 });
    // Nobody decides their own order (ADMIN excepted) — same rule as every approval.
    const own = selfDecisionError(session, { requested_by: order.userid });
    if (own) return NextResponse.json({ error: own }, { status: 403 });
    const scope = await approverScope(session);
    if (!mayDecide(scope, order)) {
      return NextResponse.json({ error: "You are not an approver for this order's reason." }, { status: 403 });
    }
    if (action === "approve" && !mayApprove(scope, order)) {
      return NextResponse.json(
        { error: `Sale Order ${orderNo} also needs approval for a reason you do not approve (${reasonsOf(order).filter((x) => !scope.reasons.has(x)).join(", ")}) — you may reject it, but not approve it.` },
        { status: 403 },
      );
    }
    if (order.status !== SO_STATUS.PENDING_APPROVAL) {
      return NextResponse.json(
        { error: `Sale Order ${orderNo} is not waiting for approval` },
        { status: 422 },
      );
    }

    const allClosed =
      order.orderDetails.length > 0 && order.orderDetails.every((d) => d.status === 2);

    // approved_by / approved_at record the DECISION (approve or reject); the
    // status says which. lib/notifications/handlers/production.js tells the
    // sales person either way.
    await prisma.orderMaster.update({
      where: { order_no: orderNo },
      data: {
        status: action === "reject" ? SO_STATUS.REJECTED : allClosed ? SO_STATUS.CLOSED : SO_STATUS.OPEN,
        approved_by: session.user.id,
        approved_at: new Date(),
        approval_remarks: note,
      },
    });

    return NextResponse.json({
      success: true,
      message:
        action === "reject"
          ? `Sale Order ${orderNo} rejected — the sales person has been told why`
          : `Sale Order ${orderNo} approved — it can now be dispatched`,
    });
  } catch (error) {
    console.error("SO approval POST error:", error);
    return NextResponse.json(
      { error: "Failed to save the decision", detail: error.message },
      { status: 500 },
    );
  }
});
