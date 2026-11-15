import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// GET /api/period-lock/log?event=BLOCKED&limit=200 — the Activity tab
// event may be one event name or a comma-separated list.
export const GET = guard("period.lock", async (request, { session }) => {
  try {

    const { searchParams } = new URL(request.url);
    const events = (searchParams.get("event") || "")
      .split(",").map((e) => e.trim()).filter(Boolean);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit")) || 200));

    const rows = await prisma.periodLockLog.findMany({
      where: events.length ? { event: { in: events } } : {},
      orderBy: { created_at: "desc" },
      take: limit,
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Period lock log GET error:", error);
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }
});
