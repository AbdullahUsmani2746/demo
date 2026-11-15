import { NextResponse } from "next/server";
import { invoicingRoute } from "@/lib/invoicing/route";
import { unlockInvoice } from "@/lib/invoicing/core";

// POST /api/invoicing/[kind]/unlock   body { tran_id, reason? } → { ok: true }
// Zeroes the line rates / amounts, deletes the sub_tran_id=3 auto entries and
// clears invoice_no (+ invoice_series). Imported history ('L') is ADMIN only.
export const POST = invoicingRoute("unlock", async (req, { kind, session }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const result = await unlockInvoice(kind, body?.tran_id, session, { reason: body?.reason ?? null });
  return NextResponse.json(result);
});
