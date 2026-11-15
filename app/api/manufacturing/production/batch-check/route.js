// /api/manufacturing/production/batch-check?batch_no=77777&exclude=29780
//
// Create / Edit Process Order: is this Batch Number already on another
// Process Order (productionPlanMaster.batch_no)? Read only — the form shows a
// warning toast and saves anyway (it never blocks). One indexed lookup
// (@@index([batch_no])), at most 10 rows.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const batchNo = String(searchParams.get("batch_no") || "").trim();
    const exclude = Number(searchParams.get("exclude")) || null; // the PO being edited
    if (!batchNo) return NextResponse.json({ used: [] });

    const rows = await prisma.productionPlanMaster.findMany({
      where: {
        batch_no: batchNo,
        ...(exclude ? { id: { not: exclude } } : {}),
      },
      select: { id: true },
      orderBy: { id: "desc" },
      take: 10,
    });

    return NextResponse.json({ used: rows.map((r) => r.id) });
  } catch (error) {
    // A failed check never matters to the save — the form just shows nothing
    console.error("Batch no check error:", error);
    return NextResponse.json({ used: [] });
  }
}
