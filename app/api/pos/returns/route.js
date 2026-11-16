// app/api/pos/returns/route.js — POS returns (refund against a receipt).
//   POST { clientRef, saleTranId, lines: [{ id, qty }], refundMethod, reason }   lib/pos/posting.js postReturn
// The list of returns is GET /api/pos/orders?kind=RETURN; the POS Returns report
// is in the report engine (posReturns).
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { postReturn, loadReceipt } from "@/lib/pos/posting";
import { posErrorResponse } from "@/lib/pos/http";

export const POST = guard("pos.refund", async (request, { session }) => {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const result = await postReturn(session, body);
    const receipt = await loadReceipt(result.tran_id);
    return NextResponse.json({ ...result, receipt }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return posErrorResponse(error, "POS return");
  }
});
