import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getProductionSetup } from "@/lib/production/setup";

// Packing materials (Settings → Production setup "Packing material"
// categories) for the Dispatch "Packing Material"
// picker. ?search= matches the item name, its code or its itcd.
export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const search = String(params.get("search") || "").trim();
    const { packingCategoryIds } = await getProductionSetup();
    const where = { ic_id: { in: packingCategoryIds } };
    // ?itcd= — the picker's label lookup for a saved value.
    const itcd = Number(params.get("itcd"));
    if (Number.isInteger(itcd) && itcd > 0) where.itcd = itcd;
    if (search) {
      const or = [
        { item: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
      ];
      if (/^\d+$/.test(search) && Number(search) <= 2147483647) or.push({ itcd: Number(search) });
      where.OR = or;
    }

    const items = await prisma.item.findMany({ where, orderBy: { itcd: "asc" } });

    return NextResponse.json({
      data: items,
    });
  } catch (error) {
    console.error("Error fetching items:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch items",
        details: error.message,
      },
      {
        status: 500,
      }
    );
  }
}
