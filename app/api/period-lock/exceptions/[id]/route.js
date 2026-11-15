import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { logPeriodLockEvent } from "@/lib/periodLock";

// ============================================================
// PATCH /api/period-lock/exceptions/:id   Body: { action: "revoke" }
//
// Revoking keeps the row so the Activity log and usage count stay readable.
// A revoked or expired exception is not re-activated — grant a new one.
// ============================================================

export const PATCH = guard("period.lock", async (request, { params, session }) => {
  try {

    const { id } = await params;
    const exceptionId = parseInt(id);
    const { action } = await request.json();

    if (!exceptionId || action !== "revoke") {
      return NextResponse.json(
        { error: "A numeric id and action \"revoke\" are required" },
        { status: 400 },
      );
    }

    const existing = await prisma.periodLockException.findUnique({ where: { id: exceptionId } });
    if (!existing) return NextResponse.json({ error: "Exception not found" }, { status: 404 });
    if (!existing.is_active) {
      return NextResponse.json({ error: "This exception is already revoked" }, { status: 409 });
    }

    const exception = await prisma.periodLockException.update({
      where: { id: exceptionId },
      data: {
        is_active: false,
        revoked_by: session?.user?.email ?? null,
        revoked_at: new Date(),
      },
    });

    await logPeriodLockEvent("EXCEPTION_REVOKE", {
      exception_id: exception.id,
      detail: `${exception.user_name} · used ${exception.use_count} time${exception.use_count === 1 ? "" : "s"}`,
    });

    return NextResponse.json({ ...exception, status: "revoked" });
  } catch (error) {
    console.error("Period lock exception PATCH error:", error);
    return NextResponse.json({ error: "Failed to revoke exception" }, { status: 500 });
  }
});
