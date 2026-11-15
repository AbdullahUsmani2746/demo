import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { listInvoicing, InvoicingError } from "@/lib/invoicing/core";

// ============================================================
// GET /api/dispatch-invoicing   (kept for old links / bookmarks)
// ============================================================
// Dispatch invoicing is now kind "sale" of Invoicing — this delegates to
// GET /api/invoicing/sale and returns its shape:
//   { data: [Row], total, page, limit, summary: { pending, invoiced }, next_invoice_no }
// The old params dateFrom / dateTo are accepted as from / to. The E / M series
// split is gone: one running sale-invoice series (lib/invoicing/core.js).
// ============================================================
export const GET = guard("dispatch.invoice", async (req, { session }) => {
  try {
    const sp = new URL(req.url).searchParams;
    const result = await listInvoicing(
      "sale",
      {
        status: sp.get("status") || "pending",
        from: sp.get("from") || sp.get("dateFrom"),
        to: sp.get("to") || sp.get("dateTo"),
        party: sp.get("party"),
        search: sp.get("search"),
        page: sp.get("page"),
        limit: sp.get("limit"),
      },
      session,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InvoicingError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("dispatch-invoicing GET error:", error);
    return NextResponse.json({ message: "Failed to load dispatches", error: error.message }, { status: 500 });
  }
});
