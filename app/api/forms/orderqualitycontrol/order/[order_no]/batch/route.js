// Save a receipt's batch number / dates (purchase order [order_no]) —
// lib/quality/orderQc.js saveOrderResults (numeric batch, unique per item, Pending only).
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { findReceipt, QcError, saveOrderResults } from "@/lib/quality/orderQc";

export const POST = guard("qualityControl.manage", async (request, context) => {
  try {
    const orderNo = Number((await context.params).order_no);
    const body = await request.json().catch(() => ({}));
    if (!String(body.batch_no ?? "").trim()) return NextResponse.json({ error: "Batch number is required" }, { status: 400 });
    const qc = await findReceipt({ qcId: body.qc_id, orderNo, itcd: body.itcd });
    if (!qc || qc.order_no !== orderNo) return NextResponse.json({ error: "QC record not found" }, { status: 404 });
    await saveOrderResults(qc.id, { batch_no: body.batch_no, mfg_date: body.mfg_date, expiry_date: body.expiry_date });
    return NextResponse.json({ ok: true, message: "Batch information saved", batch_no: Number(body.batch_no) });
  } catch (err) {
    if (err instanceof QcError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Order QC batch:", err);
    return NextResponse.json({ error: "Failed to save batch information", details: err.message }, { status: 500 });
  }
});
