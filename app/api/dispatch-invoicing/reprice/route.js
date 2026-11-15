import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

// ============================================================
// POST /api/dispatch-invoicing/reprice   — retired 2026-10-25
// ============================================================
// Invoiced dispatches were re-priced here from their Sale Order. Rates are now
// chosen by the user on Invoicing, so a wrong invoice is corrected by
// unlocking it (POST /api/invoicing/sale/unlock) and generating it again.
// ============================================================
export const POST = guard("dispatch.invoice", async () =>
  NextResponse.json(
    { message: "Re-pricing is retired — unlock the invoice in Invoicing and generate it again." },
    { status: 410 },
  ),
);
