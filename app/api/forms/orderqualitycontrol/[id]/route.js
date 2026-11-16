// /api/forms/orderqualitycontrol/[id] — QC of a receipt against purchase order [id].
//   GET  ?qc=<QualityMaster id>  (or ?itcd= → the latest receipt of that item)
//   POST { qc_id | itcd, parameters?, batch_no?, mfg_date?, expiry_date?, remarks? }  save (Pending only)
//        { qc_id | itcd, status: APPROVED|REJECTED (or approve|reject), reason, confirmFail? }  decide
// Everything goes through lib/quality/orderQc.js.
import { NextResponse } from "next/server";
import { authorize, authErrorResponse, guard } from "@/lib/auth/route";
import { decideOrderQc, findReceipt, loadOrderQc, QcError, saveOrderResults } from "@/lib/quality/orderQc";

function fail(err) {
  if (err instanceof QcError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
  console.error("Order QC:", err);
  return NextResponse.json({ error: err.message || "Order QC failed" }, { status: 500 });
}

export async function GET(request, context) {
  try {
    await authorize();
    const orderNo = Number((await context.params).id);
    const sp = new URL(request.url).searchParams;
    const qc = await findReceipt({ qcId: sp.get("qc"), orderNo, itcd: sp.get("itcd") });
    if (!qc || qc.order_no !== orderNo) return NextResponse.json({ error: "QC record not found" }, { status: 404 });
    return NextResponse.json(await loadOrderQc(qc.id));
  } catch (err) {
    return authErrorResponse(err) || fail(err);
  }
}

export const POST = guard("qualityControl.manage", async (req, context) => {
  try {
    const orderNo = Number((await context.params).id);
    let body = {};
    try { body = (await req.json()) ?? {}; } catch { body = {}; }
    const qc = await findReceipt({ qcId: body.qc_id, orderNo, itcd: body.itcd });
    if (!qc || qc.order_no !== orderNo) return NextResponse.json({ error: "QC record not found" }, { status: 404 });
    let decided = null;
    if (body.status) decided = await decideOrderQc(qc.id, body, context.session);
    else await saveOrderResults(qc.id, body);
    const sheet = await loadOrderQc(qc.id);
    const message = decided
      ? decided.status === "APPROVED"
        ? `Passed — GRN #${decided.grnNo} posted`
        : "Receipt failed"
      : "Saved";
    return NextResponse.json({ ok: true, message, grnNo: decided?.grnNo ?? null, status: sheet.master.status, sheet });
  } catch (err) {
    return fail(err);
  }
});
