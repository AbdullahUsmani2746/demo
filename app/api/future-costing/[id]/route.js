import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

// PUT /api/future-costing/[id]  — update rate for a single record
export const PUT = guard("costing.manage", async (request, { params }) => {
  try {
    const { id } = await params;
    const { rate } = await request.json();

    if (rate == null || isNaN(parseFloat(rate))) {
      return NextResponse.json({ error: "Valid rate is required" }, { status: 400 });
    }

    const updated = await prisma.futureCosting.update({
      where: { id: parseInt(id) },
      data: { rate: parseFloat(rate), updated_at: new Date() },
      include: {
        item: { select: { itcd: true, item: true, code: true } },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("FutureCosting PUT error:", error);
    return NextResponse.json({ error: "Failed to update rate" }, { status: 500 });
  }
});

// DELETE /api/future-costing/[id]  — delete a single record
export const DELETE = guard("costing.manage", async (request, { params }) => {
  try {
    const { id } = await params;
    await prisma.futureCosting.delete({ where: { id: parseInt(id) } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("FutureCosting DELETE [id] error:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
});
