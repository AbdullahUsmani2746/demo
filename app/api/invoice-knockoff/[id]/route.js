import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setAuditActor } from "@/lib/audit/context";
import prisma from "@/lib/prisma";
import { resyncLineSplitAtomic } from "@/lib/ledger/invoiceMatcher";
import { guard } from "@/lib/auth/route";

// POST /api/invoice-knockoff/[id] — reverse a single allocation (soft delete).
export const POST = guard("knockoff.allocate", async (req, { params }) => {
  try {
    const { id } = await params;
    const knockoffId = Number(id);
    if (!knockoffId) {
      return NextResponse.json({ message: "Invalid allocation id" }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    setAuditActor(session);
    const userId = session?.user?.id ?? null;

    const existing = await prisma.invoiceKnockoff.findUnique({ where: { id: knockoffId } });
    if (!existing) {
      return NextResponse.json({ message: "Allocation not found" }, { status: 404 });
    }
    if (existing.reversed_at) {
      return NextResponse.json({ message: "Allocation is already reversed" }, { status: 400 });
    }

    const updated = await prisma.invoiceKnockoff.update({
      where: { id: knockoffId },
      data: { reversed_at: new Date(), reversed_by: userId },
    });

    // Rebuild the line's slices around the allocations that are still active.
    // The reversed invoice's row is folded back into an untagged slice, which
    // returns to the review queue as an unapplied amount.
    await resyncLineSplitAtomic(existing.source_line_id);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error reversing invoice knock-off:", error);
    return NextResponse.json(
      { success: false, message: "Failed to reverse allocation", error: error.message },
      { status: 500 },
    );
  }
});
