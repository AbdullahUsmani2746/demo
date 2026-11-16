// Post the GRN of an already-passed receipt of purchase order [order_no]
// (normally posted by the Pass decision itself). Same writer: lib/createOrderGrn.js.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { createOrderGrn } from "@/lib/createOrderGrn.js";
import { findReceipt } from "@/lib/quality/orderQc";

export const POST = guard("qualityControl.manage", async (request, context) => {
  try {
    const orderNo = Number((await context.params).order_no);
    const body = await request.json().catch(() => ({}));
    const qc = await findReceipt({ qcId: body.qc_id, orderNo, itcd: body.itcd });
    if (!qc || qc.order_no !== orderNo) return NextResponse.json({ error: "QC record not found" }, { status: 404 });
    if (qc.status !== "APPROVED") return NextResponse.json({ error: "Item must be approved before creating GRN" }, { status: 400 });
    const order = await prisma.orderMaster.findUnique({
      where: { order_no: orderNo },
      include: { orderDetails: { where: { itcd: qc.itcd }, include: { items: true } }, acno: true },
    });
    if (!order || order.order_catagory !== 4) return NextResponse.json({ error: "Only purchase orders can have GRN created" }, { status: 400 });
    if (!order.orderDetails[0]) return NextResponse.json({ error: "Item not found in order" }, { status: 404 });
    const grn = await prisma.$transaction(async (tx) => {
      const r = await createOrderGrn(tx, { order, orderDetail: order.orderDetails[0], qualityMaster: qc, userId: context.session?.user?.id || null, itcd: qc.itcd });
      await tx.qualityMaster.update({ where: { id: qc.id }, data: { grn_status: "CREATED", grn_no: r.grnNo ? Number(r.grnNo) : null } });
      return r;
    });
    return NextResponse.json({ ok: true, grnNo: grn.grnNo, tranId: grn.tranId, created: grn.created, message: grn.created ? `GRN #${grn.grnNo} created` : `GRN #${grn.grnNo} already exists` });
  } catch (err) {
    console.error("Order QC GRN:", err);
    return NextResponse.json({ error: err.message || "Failed to create GRN" }, { status: 500 });
  }
});
