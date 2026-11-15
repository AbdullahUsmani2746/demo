// POST /api/fixed-assets/disposals/[tranId]/reverse { reason } — undo a
// Fixed Asset Disposal voucher: mirror journal (FA_DISPOSAL_REVERSAL), the
// assets back in use. The voucher and its journal stay in the books (rule 1).
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { setAuditActor } from "@/lib/audit/context";
import { reverseDisposal } from "@/lib/fixedAssets/disposal";
import { faResponse, actorOf } from "../../../_shared";

export const POST = guard("fixedAsset.dispose", async (req, { params, session }) => {
  setAuditActor(session);
  try {
    const body = await req.json().catch(() => ({}));
    const res = await reverseDisposal(Number((await params).tranId), { actor: actorOf(session), reason: body?.reason });
    return NextResponse.json({ message: `Disposal reversed — ${res.reversed} asset(s) back in use.`, ...res });
  } catch (error) {
    return faResponse(error, "reverse disposal");
  }
});
