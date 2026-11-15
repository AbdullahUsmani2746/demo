import prisma from "@/lib/prisma";
import { getOpening } from "@/lib/openingStock";
import { NextResponse } from "next/server";

// GET /api/future-costing/raw-materials?month=5&year=2026
// Returns raw materials with their opening_rate (lib/openingStock.js) for the given month/year
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = parseInt(searchParams.get("month"));
    const year = parseInt(searchParams.get("year"));

    if (!month || !year) {
      return NextResponse.json({ error: "month and year are required" }, { status: 400 });
    }

    // Opening rows (qty summed across godowns + item rate) for Raw Material
    // (ic_id 3) and Packaging (ic_id 4) items only.
    const rawMaterials = await getOpening(month, year, {
      itemWhere: { ic_id: { in: [3, 4] } },
      include: { item: true },
    });

    // If no opening stock found for this month, fall back to items with ic_id 3 or 4
    if (rawMaterials.length === 0) {
      // Fallback: fetch all raw material items and use price as current_rate
      const items = await prisma.item.findMany({
        where: { ic_id: { in: [3, 4] } },
        select: { itcd: true, item: true, code: true, price: true, ic_id: true },
        orderBy: { item: "asc" },
      });

      const fallbackData = items.map((item) => ({
        itcd: item.itcd,
        item_name: item.item,
        code: item.code,
        ic_id: item.ic_id,
        current_rate: item.price || 0,
        opening_qty: 0,
        opening_value: 0,
        source: "item_price",
      }));

      return NextResponse.json({ data: fallbackData, source: "fallback" });
    }

    const data = rawMaterials.map((s) => ({
      itcd: s.itcd,
      item_name: s.item?.item,
      code: s.item?.code,
      ic_id: s.item?.ic_id,
      current_rate: s.opening_rate || 0,
      opening_qty: s.opening_qty,
      opening_value: s.opening_value || 0,
      source: "opening_stock",
    }));

    return NextResponse.json({ data, source: "opening_stock" });
  } catch (error) {
    console.error("FutureCosting raw-materials GET error:", error);
    return NextResponse.json({ error: "Failed to fetch raw materials" }, { status: 500 });
  }
}
