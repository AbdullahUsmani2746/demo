// Pass / fail a receipt of purchase order [order_no] — kept for the scanners
// and older screens; the decision itself is lib/quality/orderQc.js.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { decideOrderQc, findReceipt, QcError, saveOrderResults } from "@/lib/quality/orderQc";

export const POST = guard("qualityControl.manage", async (request, context) => {
  try {
    const orderNo = Number((await context.params).order_no);
    const body = await request.json().catch(() => ({}));
    const qc = await findReceipt({ qcId: body.qc_id, orderNo, itcd: body.itcd });
    if (!qc || qc.order_no !== orderNo) return NextResponse.json({ error: "QC record not found" }, { status: 404 });
    if (body.remarks !== undefined) await saveOrderResults(qc.id, { remarks: body.remarks });
    const r = await decideOrderQc(qc.id, body, context.session);
    return NextResponse.json({
      ok: true,
      status: r.status,
      grnNo: r.grnNo,
      grnCreated: !!r.grnNo,
      message: r.grnNo ? `Item approved and GRN #${r.grnNo} created successfully` : `Item ${r.status.toLowerCase()}`,
    });
  } catch (err) {
    if (err instanceof QcError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    console.error("Order QC status:", err);
    return NextResponse.json({ error: "Failed to update status", details: err.message }, { status: 500 });
  }
});
