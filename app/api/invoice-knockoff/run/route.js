import { NextResponse } from "next/server";
import { runInvoiceKnockoffMatching } from "@/lib/ledger/invoiceMatcher";
import { guard } from "@/lib/auth/route";

// On-demand trigger for the invoice knock-off matching engine — the same
// core function the twice-daily cron (instrumentation.js) calls.
export const POST = guard("knockoff.run", async (request, { session }) => {
  try {

    const result = await runInvoiceKnockoffMatching({
      trigger: "MANUAL",
      userId: session?.user?.id ?? null,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error running invoice knock-off matching:", error);
    return NextResponse.json(
      { success: false, message: "Failed to run invoice knock-off matching", error: error.message },
      { status: 500 },
    );
  }
});
