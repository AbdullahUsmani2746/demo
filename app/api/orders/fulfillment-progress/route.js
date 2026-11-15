import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET /api/orders/fulfillment-progress
 *
 * Unified fulfillment progress API for parent and child documents.
 *
 * Query params:
 *   type = saleOrder | purchaseOrder | requisition | dispatch | grn | transfer
 *   id   = order_no (for saleOrder/purchaseOrder) | tran_id (for dispatch/grn/transfer) | tran_id (for requisition)
 *
 * For parent docs (saleOrder, purchaseOrder, requisition):
 *   Returns each ordered item with ordered qty, fulfilled qty, remaining qty, %.
 *   saleOrder also includes OrderDetail.status (open/closed) for the close toggle.
 *
 * For child docs (dispatch, grn, transfer):
 *   Returns each item in THIS voucher PLUS cumulative progress against the parent doc.
 */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const id = parseInt(url.searchParams.get("id"), 10);

    if (!type || isNaN(id)) {
      return NextResponse.json(
        { error: "Missing required params: type and id" },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────────────────────────
    // PARENT: Sale Order  → shows how much has been dispatched
    // ─────────────────────────────────────────────────────────────
    if (type === "saleOrder") {
      const order = await prisma.orderMaster.findFirst({
        where: { order_no: id, order_catagory: 6 },
        include: {
          orderDetails: {
            include: { items: { select: { item: true, code: true } } },
          },
        },
      });
      if (!order) {
        return NextResponse.json({ error: "Sale order not found" }, { status: 404 });
      }

      // All dispatches against this SO
      const dispatches = await prisma.transactionsMaster.findMany({
        where: { tran_code: 6, so_no: id },
        include: { transactions: { select: { itcd: true, qty: true } } },
      });

      const dispatchedPerItem = {};
      for (const d of dispatches) {
        for (const t of d.transactions) {
          if (t.itcd != null) {
            dispatchedPerItem[t.itcd] = (dispatchedPerItem[t.itcd] || 0) + (t.qty || 0);
          }
        }
      }

      const items = order.orderDetails.map((d) => {
        const ordered = d.qty || 0;
        const fulfilled = dispatchedPerItem[d.itcd] || 0;
        const remaining = Math.max(0, ordered - fulfilled);
        return {
          detailId: d.id,
          itcd: d.itcd,
          itemName: d.items?.item || `Item #${d.itcd}`,
          itemCode: d.items?.code || String(d.itcd ?? ""),
          unit: d.unit || "",
          orderedQty: ordered,
          fulfilledQty: fulfilled,
          remainingQty: remaining,
          percentage: ordered > 0 ? Math.min(100, Math.round((fulfilled / ordered) * 100)) : 0,
          status: d.status ?? 1, // 1=open, 2=closed — for close toggle
          rate: d.rate || 0,
        };
      });

      const totalOrdered = items.reduce((s, i) => s + i.orderedQty, 0);
      const totalFulfilled = items.reduce((s, i) => s + i.fulfilledQty, 0);

      return NextResponse.json({
        type,
        id,
        docLabel: `Sale Order #${id}`,
        childLabel: "Dispatched",
        allowClose: true,
        items,
        summary: {
          totalOrdered,
          totalFulfilled,
          totalRemaining: Math.max(0, totalOrdered - totalFulfilled),
          isComplete: totalFulfilled >= totalOrdered && totalOrdered > 0,
          completedItems: items.filter((i) => i.percentage >= 100).length,
          totalItems: items.length,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // PARENT: Purchase Order → shows how much has been GRN-received
    // ─────────────────────────────────────────────────────────────
    if (type === "purchaseOrder") {
      const order = await prisma.orderMaster.findFirst({
        where: { order_no: id, order_catagory: 4 },
        include: {
          orderDetails: {
            include: { items: { select: { item: true, code: true } } },
          },
        },
      });
      if (!order) {
        return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
      }

      const grns = await prisma.transactionsMaster.findMany({
        where: { tran_code: 4, po_no: id },
        include: { transactions: { select: { itcd: true, qty: true } } },
      });

      const receivedPerItem = {};
      for (const g of grns) {
        for (const t of g.transactions) {
          if (t.itcd != null) {
            receivedPerItem[t.itcd] = (receivedPerItem[t.itcd] || 0) + (t.qty || 0);
          }
        }
      }

      const items = order.orderDetails.map((d) => {
        const ordered = d.qty || 0;
        const fulfilled = receivedPerItem[d.itcd] || 0;
        const remaining = Math.max(0, ordered - fulfilled);
        return {
          detailId: d.id,
          itcd: d.itcd,
          itemName: d.items?.item || `Item #${d.itcd}`,
          itemCode: d.items?.code || String(d.itcd ?? ""),
          unit: d.unit || "",
          orderedQty: ordered,
          fulfilledQty: fulfilled,
          remainingQty: remaining,
          percentage: ordered > 0 ? Math.min(100, Math.round((fulfilled / ordered) * 100)) : 0,
          status: d.status ?? 1,
          rate: d.rate || 0,
        };
      });

      const totalOrdered = items.reduce((s, i) => s + i.orderedQty, 0);
      const totalFulfilled = items.reduce((s, i) => s + i.fulfilledQty, 0);

      return NextResponse.json({
        type,
        id,
        docLabel: `Purchase Order #${id}`,
        childLabel: "Received (GRN)",
        allowClose: false,
        items,
        summary: {
          totalOrdered,
          totalFulfilled,
          totalRemaining: Math.max(0, totalOrdered - totalFulfilled),
          isComplete: totalFulfilled >= totalOrdered && totalOrdered > 0,
          completedItems: items.filter((i) => i.percentage >= 100).length,
          totalItems: items.length,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // PARENT: Requisition → shows how much has been transferred
    // ─────────────────────────────────────────────────────────────
    if (type === "requisition" || type === "requisitionTransfer" || type === "requisitionFGTransfer" || type === "transfer") {
      const req = await prisma.reqMaster.findUnique({
        where: { tran_id: id },
        include: {
          details: {
            include: { item: { select: { item: true, code: true } } },
          },
        },
      });
      if (!req) {
        return NextResponse.json({ error: "Requisition not found" }, { status: 404 });
      }

      const transfers = await prisma.transactionsMaster.findMany({
        where: { tran_code: 11, req_no: id },
        include: { transactions: { select: { itcd: true, qty: true } } },
      });

      const transferredPerItem = {};
      for (const t of transfers) {
        for (const tr of t.transactions) {
          if (tr.itcd != null) {
            transferredPerItem[tr.itcd] = (transferredPerItem[tr.itcd] || 0) + (tr.qty || 0);
          }
        }
      }

      const items = req.details.map((d) => {
        const ordered = d.qty || 0;
        const fulfilled = transferredPerItem[d.itcd] || 0;
        const remaining = Math.max(0, ordered - fulfilled);
        return {
          detailId: d.id,
          itcd: d.itcd,
          itemName: d.item?.item || `Item #${d.itcd}`,
          itemCode: d.item?.code || String(d.itcd ?? ""),
          unit: "",
          orderedQty: ordered,
          approvedQty: d.ap_qty ?? null,
          fulfilledQty: fulfilled,
          remainingQty: remaining,
          percentage: ordered > 0 ? Math.min(100, Math.round((fulfilled / ordered) * 100)) : 0,
        };
      });

      const totalOrdered = items.reduce((s, i) => s + i.orderedQty, 0);
      const totalFulfilled = items.reduce((s, i) => s + i.fulfilledQty, 0);

      return NextResponse.json({
        type,
        id,
        docLabel: `Requisition #${id}`,
        childLabel: "Transferred",
        allowClose: false,
        items,
        summary: {
          totalOrdered,
          totalFulfilled,
          totalRemaining: Math.max(0, totalOrdered - totalFulfilled),
          isComplete: totalFulfilled >= totalOrdered && totalOrdered > 0,
          completedItems: items.filter((i) => i.percentage >= 100).length,
          totalItems: items.length,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // CHILD: Dispatch → shows items in this dispatch + SO progress
    // ─────────────────────────────────────────────────────────────
    if (type === "dispatch") {
      const dispatch = await prisma.transactionsMaster.findUnique({
        where: { tran_id: id },
        include: {
          transactions: {
            include: { itemDetails: { select: { item: true, code: true } } },
          },
        },
      });
      if (!dispatch) {
        return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
      }

      const soNo = dispatch.so_no;

      // Ordered qty from the SO
      let orderedPerItem = {};
      let soOrderDetails = [];
      if (soNo) {
        const so = await prisma.orderMaster.findFirst({
          where: { order_no: soNo },
          include: { orderDetails: { include: { items: { select: { item: true, code: true } } } } },
        });
        if (so) {
          soOrderDetails = so.orderDetails;
          for (const d of so.orderDetails) {
            orderedPerItem[d.itcd] = (orderedPerItem[d.itcd] || 0) + (d.qty || 0);
          }
        }
      }

      // All dispatches against this SO (cumulative)
      let totalDispatchedPerItem = {};
      if (soNo) {
        const allDispatches = await prisma.transactionsMaster.findMany({
          where: { tran_code: 6, so_no: soNo },
          include: { transactions: { select: { itcd: true, qty: true } } },
        });
        for (const d of allDispatches) {
          for (const t of d.transactions) {
            if (t.itcd != null) {
              totalDispatchedPerItem[t.itcd] = (totalDispatchedPerItem[t.itcd] || 0) + (t.qty || 0);
            }
          }
        }
      }

      const items = dispatch.transactions.map((t) => {
        const ordered = orderedPerItem[t.itcd] || 0;
        const totalFulfilled = totalDispatchedPerItem[t.itcd] || 0;
        const remaining = Math.max(0, ordered - totalFulfilled);
        return {
          itcd: t.itcd,
          itemName: t.itemDetails?.item || `Item #${t.itcd}`,
          itemCode: t.itemDetails?.code || String(t.itcd ?? ""),
          unit: t.unit || "",
          thisDocQty: t.qty || 0,
          orderedQty: ordered,
          totalFulfilledQty: totalFulfilled,
          remainingQty: remaining,
          percentage: ordered > 0 ? Math.min(100, Math.round((totalFulfilled / ordered) * 100)) : 0,
          rate: t.rate || 0,
        };
      });

      const totalOrdered = Object.values(orderedPerItem).reduce((s, v) => s + v, 0);
      const totalFulfilled = Object.values(totalDispatchedPerItem).reduce((s, v) => s + v, 0);

      return NextResponse.json({
        type,
        id,
        parentType: "saleOrder",
        parentId: soNo,
        docLabel: `Dispatch #${id}`,
        parentLabel: soNo ? `Sale Order #${soNo}` : null,
        childLabel: "Dispatched",
        allowClose: false,
        items,
        summary: {
          totalOrdered,
          totalFulfilled,
          totalRemaining: Math.max(0, totalOrdered - totalFulfilled),
          isComplete: totalFulfilled >= totalOrdered && totalOrdered > 0,
          completedItems: items.filter((i) => i.percentage >= 100).length,
          totalItems: items.length,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // CHILD: GRN → shows items in this GRN + PO progress
    // ─────────────────────────────────────────────────────────────
    if (type === "grn") {
      const grn = await prisma.transactionsMaster.findUnique({
        where: { tran_id: id },
        include: {
          transactions: {
            include: { itemDetails: { select: { item: true, code: true } } },
          },
        },
      });
      if (!grn) {
        return NextResponse.json({ error: "GRN not found" }, { status: 404 });
      }

      const poNo = grn.po_no;

      let orderedPerItem = {};
      if (poNo) {
        const po = await prisma.orderMaster.findFirst({
          where: { order_no: poNo, order_catagory: 4 },
          include: { orderDetails: true },
        });
        if (po) {
          for (const d of po.orderDetails) {
            orderedPerItem[d.itcd] = (orderedPerItem[d.itcd] || 0) + (d.qty || 0);
          }
        }
      }

      let totalReceivedPerItem = {};
      if (poNo) {
        const allGrns = await prisma.transactionsMaster.findMany({
          where: { tran_code: 4, po_no: poNo },
          include: { transactions: { select: { itcd: true, qty: true } } },
        });
        for (const g of allGrns) {
          for (const t of g.transactions) {
            if (t.itcd != null) {
              totalReceivedPerItem[t.itcd] = (totalReceivedPerItem[t.itcd] || 0) + (t.qty || 0);
            }
          }
        }
      }

      const items = grn.transactions.map((t) => {
        const ordered = orderedPerItem[t.itcd] || 0;
        const totalFulfilled = totalReceivedPerItem[t.itcd] || 0;
        const remaining = Math.max(0, ordered - totalFulfilled);
        return {
          itcd: t.itcd,
          itemName: t.itemDetails?.item || `Item #${t.itcd}`,
          itemCode: t.itemDetails?.code || String(t.itcd ?? ""),
          unit: t.unit || "",
          thisDocQty: t.qty || 0,
          orderedQty: ordered,
          totalFulfilledQty: totalFulfilled,
          remainingQty: remaining,
          percentage: ordered > 0 ? Math.min(100, Math.round((totalFulfilled / ordered) * 100)) : 0,
          rate: t.rate || 0,
        };
      });

      const totalOrdered = Object.values(orderedPerItem).reduce((s, v) => s + v, 0);
      const totalFulfilled = Object.values(totalReceivedPerItem).reduce((s, v) => s + v, 0);

      return NextResponse.json({
        type,
        id,
        parentType: "purchaseOrder",
        parentId: poNo,
        docLabel: `GRN #${id}`,
        parentLabel: poNo ? `Purchase Order #${poNo}` : null,
        childLabel: "Received",
        allowClose: false,
        items,
        summary: {
          totalOrdered,
          totalFulfilled,
          totalRemaining: Math.max(0, totalOrdered - totalFulfilled),
          isComplete: totalFulfilled >= totalOrdered && totalOrdered > 0,
          completedItems: items.filter((i) => i.percentage >= 100).length,
          totalItems: items.length,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // CHILD: Transfer → shows items in this transfer + Req progress
    // ─────────────────────────────────────────────────────────────
    if (type === "transfer" || type === "fgTransfer") {
      const transfer = await prisma.transactionsMaster.findUnique({
        where: { tran_id: id },
        include: {
          transactions: {
            include: { itemDetails: { select: { item: true, code: true } } },
          },
        },
      });
      if (!transfer) {
        return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
      }

      const reqNo = transfer.req_no;

      let orderedPerItem = {};
      if (reqNo) {
        const req = await prisma.reqMaster.findUnique({
          where: { tran_id: reqNo },
          include: { details: { select: { itcd: true, qty: true } } },
        });
        if (req) {
          for (const d of req.details) {
            orderedPerItem[d.itcd] = (orderedPerItem[d.itcd] || 0) + (d.qty || 0);
          }
        }
      }

      let totalTransferredPerItem = {};
      if (reqNo) {
        const allTransfers = await prisma.transactionsMaster.findMany({
          where: { tran_code: 11, req_no: reqNo },
          include: { transactions: { select: { itcd: true, qty: true } } },
        });
        for (const tr of allTransfers) {
          for (const t of tr.transactions) {
            if (t.itcd != null) {
              totalTransferredPerItem[t.itcd] = (totalTransferredPerItem[t.itcd] || 0) + (t.qty || 0);
            }
          }
        }
      }

      const items = transfer.transactions.map((t) => {
        const ordered = orderedPerItem[t.itcd] || 0;
        const totalFulfilled = totalTransferredPerItem[t.itcd] || 0;
        const remaining = Math.max(0, ordered - totalFulfilled);
        return {
          itcd: t.itcd,
          itemName: t.itemDetails?.item || `Item #${t.itcd}`,
          itemCode: t.itemDetails?.code || String(t.itcd ?? ""),
          unit: t.unit || "",
          thisDocQty: t.qty || 0,
          orderedQty: ordered,
          totalFulfilledQty: totalFulfilled,
          remainingQty: remaining,
          percentage: ordered > 0 ? Math.min(100, Math.round((totalFulfilled / ordered) * 100)) : 0,
        };
      });

      const totalOrdered = Object.values(orderedPerItem).reduce((s, v) => s + v, 0);
      const totalFulfilled = Object.values(totalTransferredPerItem).reduce((s, v) => s + v, 0);

      return NextResponse.json({
        type,
        id,
        parentType: "requisition",
        parentId: reqNo,
        docLabel: `Transfer #${id}`,
        parentLabel: reqNo ? `Requisition #${reqNo}` : null,
        childLabel: "Transferred",
        allowClose: false,
        items,
        summary: {
          totalOrdered,
          totalFulfilled,
          totalRemaining: Math.max(0, totalOrdered - totalFulfilled),
          isComplete: totalFulfilled >= totalOrdered && totalOrdered > 0,
          completedItems: items.filter((i) => i.percentage >= 100).length,
          totalItems: items.length,
        },
      });
    }

    return NextResponse.json(
      { error: `Unknown type: ${type}` },
      { status: 400 }
    );
  } catch (err) {
    console.error("[fulfillment-progress]", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}
