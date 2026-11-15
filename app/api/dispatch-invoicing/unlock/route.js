import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { unlockInvoice, InvoicingError } from "@/lib/invoicing/core";

// ============================================================
// POST /api/dispatch-invoicing/unlock   (kept for old callers)
// ============================================================
// Body: { tran_id, reason? }. Delegates to Invoicing kind "sale"
// (POST /api/invoicing/sale/unlock): line rates / amounts zeroed, auto
// entries deleted, invoice_no + invoice_series cleared.
// ============================================================
export const POST = guard("dispatch.unlock", async (req, { session }) => {
  try {
    const body = await req.json().catch(() => null);
    const result = await unlockInvoice("sale", body?.tran_id, session, { reason: body?.reason ?? null });
    return NextResponse.json({ success: true, ...result, message: "Invoice reversed — dispatch is back in the pending queue" });
  } catch (error) {
    if (error instanceof InvoicingError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("dispatch-invoicing unlock error:", error);
    return NextResponse.json({ message: "Failed to reverse invoice", error: error.message }, { status: 500 });
  }
});
