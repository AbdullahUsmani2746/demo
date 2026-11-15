import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { logPeriodLockEvent, isoDay } from "@/lib/periodLock";
import { documentsSummary } from "@/lib/periodLockCatalog";

// ============================================================
// PATCH /api/period-lock/:id   Body: { action: "unlock" | "lock" }
//
// Unlocking keeps the row (is_active=false) so who locked/unlocked what
// stays visible on the Period Lock page; "lock" re-activates it.
// ============================================================

export const PATCH = guard("period.lock", async (request, { params, session }) => {
  try {

    const { id } = await params;
    const lockId = parseInt(id);
    const { action } = await request.json();

    if (!lockId || !["lock", "unlock"].includes(action)) {
      return NextResponse.json(
        { error: "A numeric id and action (lock|unlock) are required" },
        { status: 400 },
      );
    }

    const existing = await prisma.periodLock.findUnique({ where: { id: lockId } });
    if (!existing) {
      return NextResponse.json({ error: "Lock not found" }, { status: 404 });
    }

    const isLocking = action === "lock";
    const lock = await prisma.periodLock.update({
      where: { id: lockId },
      data: isLocking
        ? {
            is_active: true,
            locked_by: session?.user?.email ?? null,
            locked_at: new Date(),
            unlocked_by: null,
            unlocked_at: null,
          }
        : {
            is_active: false,
            unlocked_by: session?.user?.email ?? null,
            unlocked_at: new Date(),
          },
    });

    await logPeriodLockEvent(isLocking ? "RANGE_RELOCK" : "RANGE_UNLOCK", {
      lock_id: lock.id,
      detail: `${isoDay(lock.date_from)} to ${isoDay(lock.date_to)} · ${documentsSummary(lock.tran_codes)}`,
    });

    return NextResponse.json(lock);
  } catch (error) {
    console.error("Period lock PATCH error:", error);
    return NextResponse.json({ error: "Failed to update lock" }, { status: 500 });
  }
});
