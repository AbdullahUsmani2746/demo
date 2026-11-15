import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const itcd = searchParams.get("itcd");
        if (!itcd) {
            return NextResponse.json({ error: "Item code (itcd) is required" }, { status: 400 });
        }
        
        const item = await prisma.qualityMaster.findMany({
            where: { itcd: Number(itcd)
                // status: "Approved"
             },
            select: {
                batch_no: true,
            },
        });
        
        if (!item) {
            return NextResponse.json({ error: "Item not found" }, { status: 404 });
        }
        return NextResponse.json(item);
    }
    catch (error) {
        console.error("Error fetching item by itcd:", error);
        return NextResponse.json({ error: "Failed to fetch item", details: error.message }, { status: 500 });
    }
}
