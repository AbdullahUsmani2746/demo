import { NextResponse } from "next/server";
import { invoicingRoute } from "@/lib/invoicing/route";
import { invoiceKnockoffs } from "@/lib/invoicing/core";
import { can } from "@/lib/auth/permissions";

// GET /api/invoicing/[kind]/knockoffs?tran_id=  → { knockoffs, canReverse }
// The receipts / payments matched to an invoice — they must be un-matched
// before the invoice can be reversed (the Reverse dialog lists them).
// Same right as reversing the invoice; un-matching needs `knockoff.allocate`.
export const GET = invoicingRoute("unlock", async (req, { kind, session }) => {
  const tranId = new URL(req.url).searchParams.get("tran_id");
  const knockoffs = await invoiceKnockoffs(kind, tranId, session);
  return NextResponse.json({ knockoffs, canReverse: await can(session, "knockoff.allocate") });
});
