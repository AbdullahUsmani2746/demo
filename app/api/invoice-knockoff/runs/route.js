import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Paginated run history for the invoice knock-off matching engine.
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 100);
    const offset = Number(url.searchParams.get("offset")) || 0;
    const status = url.searchParams.get("status");

    const where = status ? { status } : {};

    const [runs, total] = await Promise.all([
      prisma.invoiceKnockoffRun.findMany({
        where,
        orderBy: { started_at: "desc" },
        take: limit,
        skip: offset,
        include: {
          triggeredByUser: { select: { name: true, email: true } },
          _count: { select: { allocations: true } },
        },
      }),
      prisma.invoiceKnockoffRun.count({ where }),
    ]);

    return NextResponse.json({ success: true, data: runs, total });
  } catch (error) {
    console.error("Error fetching invoice knock-off runs:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch run history", error: error.message },
      { status: 500 },
    );
  }
}
