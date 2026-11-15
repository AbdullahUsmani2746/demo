import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
      const itcd = searchParams.get("itcd") || "";

    // Get items with pagination, search, and sorting
    const item = await prisma.item.findMany({where:{
        itcd: Number(itcd)
    } });
        


    const items = await prisma.item.findMany({where:{
        ic_id: Number(item[0].ic_id)
    } });

    // Return paginated response
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