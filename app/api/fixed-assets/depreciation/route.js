// /api/fixed-assets/depreciation — Fixed Assets → Depreciation (the run screen).
//   GET  ?period=YYYY-MM → { runs, preview }      (fixedAsset.depreciation.run)
//   POST { period }      → posts the run: one system journal   (same right)
// Feature "fixedAssets.depreciation" must be on (lib/features/catalog.js).
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { setAuditActor } from "@/lib/audit/context";
import { listRuns, previewRun, postRun } from "@/lib/fixedAssets/depreciation";
import { faResponse, featureOff, actorOf } from "../_shared";

export const GET = guard("fixedAsset.depreciation.run", async (req) => {
  const off = await featureOff("fixedAssets.depreciation", "Monthly depreciation");
  if (off) return off;
  try {
    const period = new URL(req.url).searchParams.get("period");
    const [runs, preview] = await Promise.all([listRuns(), period ? previewRun(period) : null]);
    return NextResponse.json({ runs, preview });
  } catch (error) {
    return faResponse(error, "GET depreciation");
  }
});

export const POST = guard("fixedAsset.depreciation.run", async (req, { session }) => {
  setAuditActor(session);
  const off = await featureOff("fixedAssets.depreciation", "Monthly depreciation");
  if (off) return off;
  try {
    const body = await req.json().catch(() => ({}));
    const run = await postRun(String(body?.period || ""), { actor: actorOf(session) });
    return NextResponse.json({ message: `Depreciation posted — JV ${run.jv_vr_no} (#${run.jv_tran_id}).`, run }, { status: 201 });
  } catch (error) {
    return faResponse(error, "POST depreciation");
  }
});
