import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

// GET /api/future-costing
//   ?month=7&year=2026  → all items for that month/year (with item details)
//   (no params)         → distinct month/year combos with item counts
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month");
    const year  = searchParams.get("year");

    if (month && year) {
      const rows = await prisma.futureCosting.findMany({
        where: { month: parseInt(month), year: parseInt(year) },
        include: {
          item: { select: { itcd: true, item: true, code: true, ic_id: true } },
        },
        orderBy: { itcd: "asc" },
      });
      return NextResponse.json({ data: rows });
    }

    // Distinct month/year combinations sorted newest first
    const grouped = await prisma.futureCosting.groupBy({
      by: ["month", "year"],
      _count: { itcd: true },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    return NextResponse.json({
      data: grouped.map((r) => ({
        month: r.month,
        year:  r.year,
        item_count: r._count.itcd,
      })),
    });
  } catch (error) {
    console.error("FutureCosting GET error:", error);
    return NextResponse.json({ error: "Failed to fetch future costing" }, { status: 500 });
  }
}

// POST /api/future-costing
// Body: { month, year, items: [{itcd, rate, closing_qty?, closing_rate?, future_qty?, future_rate?}] }
export const POST = guard("costing.manage", async (request) => {
  try {
    const { month, year, items } = await request.json();

    if (!month || !year || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "month, year, and items[] are required" }, { status: 400 });
    }

    const ops = items.map((row) => {
      const data = {
        rate:         parseFloat(row.rate),
        closing_qty:  row.closing_qty  != null ? parseFloat(row.closing_qty)  : 0,
        closing_rate: row.closing_rate != null ? parseFloat(row.closing_rate) : 0,
        future_qty:   row.future_qty   != null ? parseFloat(row.future_qty)   : 0,
        future_rate:  row.future_rate  != null ? parseFloat(row.future_rate)  : 0,
        updated_at:   new Date(),
      };
      return prisma.futureCosting.upsert({
        where:  { month_year_itcd: { month: parseInt(month), year: parseInt(year), itcd: row.itcd } },
        update: data,
        create: { month: parseInt(month), year: parseInt(year), itcd: row.itcd, ...data },
      });
    });

    const results = await prisma.$transaction(ops);
    return NextResponse.json({ success: true, count: results.length });
  } catch (error) {
    console.error("FutureCosting POST error:", error);
    return NextResponse.json({ error: "Failed to save future costing" }, { status: 500 });
  }
});

// DELETE /api/future-costing?month=7&year=2026  → remove all rows for that month/year
export const DELETE = guard("costing.manage", async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month");
    const year  = searchParams.get("year");

    if (!month || !year) {
      return NextResponse.json({ error: "month and year are required" }, { status: 400 });
    }

    const { count } = await prisma.futureCosting.deleteMany({
      where: { month: parseInt(month), year: parseInt(year) },
    });
    return NextResponse.json({ success: true, deleted: count });
  } catch (error) {
    console.error("FutureCosting DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
});
