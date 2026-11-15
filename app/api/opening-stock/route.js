import { getOpening, getOpeningByGodown } from "@/lib/openingStock";
import { NextResponse } from "next/server";

// GET /api/opening-stock?month=5&year=2026[&godown=1][&byGodown=1][&limit=15]
//   default   → one row per item, qty summed across godowns
//   godown=X  → one row per item, qty for that godown only
//   byGodown  → one row per (item, godown)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = parseInt(searchParams.get("month"));
    const year = parseInt(searchParams.get("year"));
    const godown = searchParams.get("godown");
    const byGodown = searchParams.get("byGodown") === "1";
    const limit = parseInt(searchParams.get("limit")) || 0;

    if (!month || !year) {
      return NextResponse.json({ error: "month and year are required" }, { status: 400 });
    }

    const rows = byGodown
      ? await getOpeningByGodown(month, year, { godown, include: { item: true } })
      : await getOpening(month, year, { godown, include: { item: true } });

    let data = rows
      .map((r) => ({
        ...r,
        item: r.item
          ? { itcd: r.item.itcd, item: r.item.item, code: r.item.code, unit: r.item.unit }
          : null,
      }))
      .sort((a, b) => b.opening_value - a.opening_value);
    if (limit > 0) data = data.slice(0, limit);

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Opening stock GET error:", error);
    return NextResponse.json({ error: "Failed to fetch opening stock" }, { status: 500 });
  }
}
