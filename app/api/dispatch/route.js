import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET method – returns distinct dispatch numbers for select filter
export async function GET(req) {
  try {
    const dispatches = await prisma.transactionsMaster.findMany({
      where: { dispatch_no: { not: null } },
      select: { dispatch_no: true },
      distinct: ["dispatch_no"],
      orderBy: { dispatch_no: "desc" },
    });

    const options = dispatches
      .filter(d => d.dispatch_no !== null && d.dispatch_no !== undefined)
      .map(d => ({
        value: d.dispatch_no.toString(),
        label: d.dispatch_no.toString(),
      }));

    return NextResponse.json({ success: true, data: options });
  } catch (error) {
    console.error("Error fetching dispatch numbers:", error);
    return NextResponse.json({ success: false, message: "Failed to fetch dispatch numbers", error: error.message }, { status: 500 });
  }
}
