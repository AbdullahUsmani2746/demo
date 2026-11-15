import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resyncLineSplitAtomic } from "@/lib/ledger/invoiceMatcher";
import { guard } from "@/lib/auth/route";

// Bulk-reverses every still-active allocation created by a given run.
export const POST = guard("knockoff.reverse", async (req, { session }) => {
  try {
    const { id } = await params;
    const runId = Number(id);
    if (!runId) {
      return NextResponse.json({ message: "Invalid run id" }, { status: 400 });
    }

    const userId = session?.user?.id ?? null;

    // Collect the affected lines first — after the update they no longer
    // match on reversed_at IS NULL.
    const affected = await prisma.invoiceKnockoff.findMany({
      where: { run_id: runId, reversed_at: null },
      select: { source_line_id: true },
      distinct: ["source_line_id"],
    });

    const result = await prisma.invoiceKnockoff.updateMany({
      where: { run_id: runId, reversed_at: null },
      data: { reversed_at: new Date(), reversed_by: userId },
    });

    // Collapse the slices of every line this run had settled back down to
    // whatever is still allocated, so they return to the review queue. A line
    // whose slices were all reversed folds back into a single untagged row.
    // resyncLineSplitAtomic is idempotent and resolves any slice to its
    // group, so hitting the same group twice is harmless — and a slice that
    // an earlier pass already deleted simply resolves to nothing.
    for (const { source_line_id } of affected) {
      await resyncLineSplitAtomic(source_line_id);
    }

    return NextResponse.json({ success: true, reversedCount: result.count });
  } catch (error) {
    console.error("Error reversing invoice knock-off run:", error);
    return NextResponse.json(
      { success: false, message: "Failed to reverse run", error: error.message },
      { status: 500 },
    );
  }
});
