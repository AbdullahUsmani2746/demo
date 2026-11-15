import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { generateInvoices } from "@/lib/invoicing/core";

// ============================================================
// POST /api/dispatch-invoicing/generate   (kept for old callers)
// ============================================================
// Delegates to Invoicing kind "sale" (POST /api/invoicing/sale/generate).
// Body: { invoices: [...] } in the Invoicing shape, or the old
// { tran_ids: [..] } — each dispatch is then invoiced at its default rates
// with the next number of the single sale-invoice series.
// ============================================================
export const POST = guard("dispatch.invoice", async (req, { session }) => {
  try {
    const body = await req.json().catch(() => null);
    const invoices = Array.isArray(body?.invoices)
      ? body.invoices
      : Array.isArray(body?.tran_ids)
        ? body.tran_ids.map((tran_id) => ({ tran_id }))
        : [];
    if (!invoices.length) {
      return NextResponse.json({ message: "invoices (or tran_ids) array is required" }, { status: 400 });
    }
    const result = await generateInvoices("sale", invoices, session);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("dispatch-invoicing generate error:", error);
    return NextResponse.json({ message: "Failed to generate invoices", error: error.message }, { status: 500 });
  }
});
