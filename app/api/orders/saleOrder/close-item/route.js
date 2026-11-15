import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { SO_STATUS, SO_HELD_STATUSES } from "@/lib/orders/saleOrderApproval";

/**
 * PATCH /api/orders/saleOrder/close-item
 * Body: { detail_id: number, status: 1 | 2 }
 *
 * Toggles an individual OrderDetail row between:
 *   status 1 = open (active)
 *   status 2 = closed (completed / will not appear in dispatch)
 *
 * After updating the detail, automatically sync the parent OrderMaster status:
 *   - All details closed → master status = 2
 *   - Any detail open   → master status = 1
 */
export const PATCH = guard("saleOrder.update", async (request, { session }) => {
  try {
    const body = await request.json();
    const { detail_id, status } = body;

    if (!detail_id || ![1, 2].includes(status)) {
      return NextResponse.json(
        { error: "detail_id and status (1 or 2) are required" },
        { status: 400 }
      );
    }

    // Fetch the detail first to get the parent order_no
    const detail = await prisma.orderDetail.findUnique({
      where: { id: Number(detail_id) },
      select: { id: true, order_no: true },
    });

    if (!detail) {
      return NextResponse.json(
        { error: "Order detail not found" },
        { status: 404 }
      );
    }

    // Update the single detail
    await prisma.orderDetail.update({
      where: { id: Number(detail_id) },
      data: { status },
    });

    // Re-check all sibling details to compute master status
    const siblings = await prisma.orderDetail.findMany({
      where: { order_no: detail.order_no },
      select: { status: true },
    });

    const allClosed = siblings.every((s) => s.status === 2);
    let masterStatus = allClosed ? SO_STATUS.CLOSED : SO_STATUS.OPEN;

    // An order waiting for approval stays at 3 — closing or reopening a
    // line must not approve it by the back door.
    const master = await prisma.orderMaster.findUnique({
      where: { order_no: detail.order_no },
      select: { status: true },
    });
    if (SO_HELD_STATUSES.includes(master?.status)) {
      masterStatus = master.status;
    } else {
      await prisma.orderMaster.update({
        where: { order_no: detail.order_no },
        data: { status: masterStatus },
      });
    }

    return NextResponse.json({
      message: `Item ${status === 2 ? "closed" : "reopened"} successfully`,
      detail_id,
      status,
      order_no: detail.order_no,
      masterStatus,
    });
  } catch (error) {
    console.error("[close-item] Error:", error);
    return NextResponse.json(
      { error: "Failed to update item status", details: error.message },
      { status: 500 }
    );
  }
});
