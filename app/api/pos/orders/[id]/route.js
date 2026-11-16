// app/api/pos/orders/[id]/route.js — one POS receipt (sale or return), for the
// receipt print, the receipts list and refunds. Posted receipts are never
// edited here (they used to be: a PUT overwrote `rmk` of ANY voucher id, with
// no period lock). A mistake is corrected with a POS return.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { loadReceipt, posRights } from "@/lib/pos/posting";
import { posErrorResponse, hasPosAccess } from "@/lib/pos/http";

export const GET = guard(null, async (request, { params, session }) => {
  try {
    const { id } = await params;
    const rights = await posRights(session);
    if (!hasPosAccess(rights)) return NextResponse.json({ error: "No point of sale access." }, { status: 403 });
    const receipt = await loadReceipt(Number(id));
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
    if (!rights.allShifts && receipt.user_id !== String(session.user.id)) {
      return NextResponse.json({ error: "This receipt was rung up at another till (pos.allShifts)." }, { status: 403 });
    }
    return NextResponse.json(receipt);
  } catch (error) {
    return posErrorResponse(error, "POS receipt");
  }
});
