// POST /api/fixed-assets/depreciation/[id]/reverse { reason } — the mirror
// journal of a posted run (newest first); the month may then be run again.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { setAuditActor } from "@/lib/audit/context";
import { reverseRun } from "@/lib/fixedAssets/depreciation";
import { faResponse, featureOff, actorOf } from "../../../_shared";

export const POST = guard("fixedAsset.depreciation.run", async (req, { params, session }) => {
  setAuditActor(session);
  const off = await featureOff("fixedAssets.depreciation", "Monthly depreciation");
  if (off) return off;
  try {
    const body = await req.json().catch(() => ({}));
    const run = await reverseRun(Number((await params).id), { actor: actorOf(session), reason: body?.reason });
    return NextResponse.json({ message: `Run reversed — reversal JV #${run.reversal_tran_id}.`, run });
  } catch (error) {
    return faResponse(error, "reverse run");
  }
});
