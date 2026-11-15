import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { generateMonthlyOpeningStock } from "@/lib/openingStockGenerate";
import { guard } from "@/lib/auth/route";
import { logPeriodLockEvent } from "@/lib/periodLock";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/costing/lock-period
// Body: { month: number, year: number, action: "lock" | "unlock" }
//
// On lock: also generates the following month's opening stock (rates per
// item + qty per godown) via lib/openingStockGenerate.js. Re-locking
// overwrites the target month.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = guard("period.lock", async (request, { session }) => {
  try {

    const { month, year, action } = await request.json();

    if (!month || !year || !["lock", "unlock"].includes(action)) {
      return NextResponse.json(
        { error: "month, year, and action (lock|unlock) are required" },
        { status: 400 }
      );
    }

    const isLocking = action === "lock";

    const record = await prisma.costingPeriod.upsert({
      where: { month_year: { month, year } },
      update: {
        is_locked: isLocking,
        locked_at: isLocking ? new Date() : null,
        locked_by: isLocking ? (session?.user?.email ?? null) : null,
      },
      create: {
        month,
        year,
        is_locked: isLocking,
        locked_at: isLocking ? new Date() : null,
        locked_by: isLocking ? (session?.user?.email ?? null) : null,
      },
    });

    await logPeriodLockEvent(isLocking ? "MONTH_LOCK" : "MONTH_UNLOCK", {
      detail: `${month}/${year}`,
    });

    // On lock: generate next month's opening stock from this period's closing
    let openingStockResult = null;
    if (isLocking) {
      try {
        openingStockResult = await generateMonthlyOpeningStock(month, year);
      } catch (osErr) {
        // Non-fatal: lock succeeded even if opening stock generation fails
        console.error("Opening stock generation error:", osErr);
        openingStockResult = { error: osErr.message };
      }
    }

    return NextResponse.json({ ...record, opening_stock: openingStockResult });
  } catch (error) {
    console.error("Lock period error:", error);
    return NextResponse.json({ error: "Failed to update period lock" }, { status: 500 });
  }
});
