import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";


export async function GET() {
  try {
    const orders = await prisma.orderMaster.findMany({
      where: {
        order_catagory: 6, 
        userid: { not: null },
      },
      select: {
        userid: true,
        users: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      distinct: ["userid"],
    });

    const data = orders
      .filter((o) => o.users)
      .map((o) => ({
        id: o.users.id,
        name: o.users.name || o.userid,
      }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    console.error("Error fetching sales persons:", error);
    return NextResponse.json(
      { error: "Failed to fetch sales persons" },
      { status: 500 }
    );
  }
}
