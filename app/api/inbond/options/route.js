import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// Lightweight In-Bond entry list for report filter select boxes. /api/inbond
// pages 10 at a time and includes every detail line.
export const GET = guard("inBond.view", async () => {
  try {
    const rows = await prisma.inboundMaster.findMany({
      select: {
        id: true,
        bond_id: true,
        dated: true,
        lc_ref: true,
        acno: { select: { acname: true } },
      },
      orderBy: { dated: "desc" },
    });
    const data = rows.map((r) => ({
      id: r.id,
      bond_id: r.bond_id,
      dated: r.dated,
      lc: r.lc_ref || r.acno?.acname || "",
    }));
    return NextResponse.json({ data });
  } catch (error) {
    console.error("[InBond options] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch In-Bond options", details: error.message },
      { status: 500 }
    );
  }
});
