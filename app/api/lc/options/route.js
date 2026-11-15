import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// Lightweight L/C list for report filter select boxes. /api/lc pages 10 at a
// time and drags every detail line along, which is wrong for a dropdown.
export const GET = guard("letterOfCredit.view", async () => {
  try {
    const data = await prisma.lCMaster.findMany({
      select: { id: true, lc_no: true, lc_date: true, import_type: true },
      orderBy: { lc_date: "desc" },
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("[LC options] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch L/C options", details: error.message },
      { status: 500 }
    );
  }
});
