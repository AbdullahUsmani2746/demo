import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

// ============================================================
// POST /api/voucher/fix-dispatch-rates   — retired 2026-10-25
// ============================================================
// Dispatches were re-priced here from their Sale Order and their auto entries
// rebuilt. A dispatch is now quantity-only and priced on Invoicing, so a wrong
// invoice is corrected by unlocking it (POST /api/invoicing/sale/unlock) and
// generating it again.
// ============================================================
export const POST = guard("maintenance.bulkUpdate", async () =>
  NextResponse.json(
    { message: "Fixing dispatch rates is retired — unlock the invoice in Invoicing and generate it again." },
    { status: 410 },
  ),
);
