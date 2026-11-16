// /api/forms/qualitycontrol/[id] — the QC sheet of process order [id].
//   GET   the sheet (lib/quality/productionQc.js loadProductionQc)
//   POST  { parameters?, mfg_date?, expiry_date?, remarks? }  save the current attempt
//         { status, reason, confirmFail? }                    take a decision
//         (both in one body: results are saved first, then the decision)
import { NextResponse } from "next/server";
import { authorize, authErrorResponse, guard } from "@/lib/auth/route";
import { decideProductionQc, loadProductionQc, QcError, saveProductionResults } from "@/lib/quality/productionQc";

async function safeJson(req) {
  try {
    return (await req.json()) ?? {};
  } catch {
    return {};
  }
}

const idOf = async (context) => {
  const id = Number((await context.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function fail(err) {
  if (err instanceof QcError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
  console.error("Quality control:", err);
  return NextResponse.json({ error: err.message || "Quality control failed" }, { status: 500 });
}

export async function GET(_req, context) {
  try {
    await authorize();
    const id = await idOf(context);
    if (!id) return NextResponse.json({ error: "Invalid process order number" }, { status: 400 });
    const sheet = await loadProductionQc(id);
    if (!sheet) return NextResponse.json({ error: "Process order not found" }, { status: 404 });
    return NextResponse.json(sheet);
  } catch (err) {
    return authErrorResponse(err) || fail(err);
  }
}

export const POST = guard("qualityControl.manage", async (req, context) => {
  const { session } = context;
  try {
    const id = await idOf(context);
    if (!id) return NextResponse.json({ error: "Invalid process order number" }, { status: 400 });
    const body = await safeJson(req);
    const hasSave =
      (Array.isArray(body.parameters) && body.parameters.length > 0) ||
      body.mfg_date !== undefined || body.expiry_date !== undefined || body.remarks !== undefined;
    if (!hasSave && !body.status) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

    let saved = null;
    if (hasSave) saved = await saveProductionResults(id, body);
    let decided = null;
    if (body.status) decided = await decideProductionQc(id, body, session);

    const sheet = await loadProductionQc(id);
    const message = decided
      ? decided.status === "APPROVED"
        ? `Passed — batch ${decided.batch_no}`
        : `QC marked ${sheet.master.status_label}`
      : saved?.attempt_no
        ? `Attempt ${saved.attempt_no} saved`
        : "Saved";
    return NextResponse.json({ ok: true, message, batch_no: decided?.batch_no ?? sheet.master.batch_no, status: sheet.master.status, sheet });
  } catch (err) {
    return fail(err);
  }
});
