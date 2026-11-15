import { NextResponse } from "next/server";
import { invoicingRoute } from "@/lib/invoicing/route";
import { listInvoicing } from "@/lib/invoicing/core";

// GET /api/invoicing/[kind]?status=pending|invoiced|all&from=&to=&party=&search=&page=&limit=
// kind: sale | sale-return | purchase | purchase-return   (lib/invoicing/kinds.js)
// → { data: [Row], total, page, limit, summary: { pending, invoiced }, next_invoice_no }
export const GET = invoicingRoute("view", async (req, { kind, session }) => {
  const sp = new URL(req.url).searchParams;
  const result = await listInvoicing(
    kind,
    {
      status: sp.get("status") || "pending",
      from: sp.get("from"),
      to: sp.get("to"),
      party: sp.get("party"),
      search: sp.get("search"),
      page: sp.get("page"),
      limit: sp.get("limit"),
    },
    session,
  );
  return NextResponse.json(result);
});
