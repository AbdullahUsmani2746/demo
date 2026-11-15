// app/api/manufacturing/bom/[id]/view/route.js
// ============================================================
// BOM View screen (components/Material/Bom/BOMTab.js) — its saved Remarks,
// Target Qty (KG) and row order (S.No):
//   BomMaster.remarks / BomMaster.target_qty, BomDetail.sno
//
// GET   → { remarks, target_qty, order: [{ material_id, sno }] }
// PATCH { remarks?, target_qty?, order?: [{ material_id, sno }] }
//        → saves only these; materials, percentages and status are not touched.
// ============================================================
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

const bomId = async (params) => parseInt((await params).id, 10);

const shape = (bom) => ({
  remarks: bom.remarks ?? "",
  target_qty: bom.target_qty,
  order: (bom.bomDetails || []).map((d) => ({ material_id: d.material_id, sno: d.sno })),
});

const SELECT = {
  remarks: true,
  target_qty: true,
  bomDetails: { select: { material_id: true, sno: true } },
};

export const GET = guard(null, async (request, { params }) => {
  try {
    const id = await bomId(params);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid BOM id" }, { status: 400 });

    const bom = await prisma.bomMaster.findUnique({ where: { id }, select: SELECT });
    if (!bom) return NextResponse.json({ error: "BOM not found" }, { status: 404 });

    return NextResponse.json(shape(bom));
  } catch (error) {
    console.error("BOM view GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const PATCH = guard("bom.manage", async (request, { params }) => {
  try {
    const id = await bomId(params);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid BOM id" }, { status: 400 });

    const { remarks, target_qty, order } = await request.json();
    const qty = target_qty === "" || target_qty == null ? null : Number(target_qty);
    if (qty !== null && (!Number.isFinite(qty) || qty < 0)) {
      return NextResponse.json({ error: "Target Qty must be a positive number" }, { status: 400 });
    }

    // Row order: one S.No per material line of THIS BOM.
    const rows = Array.isArray(order)
      ? order
          .map((o) => ({ material_id: parseInt(o?.material_id, 10), sno: parseInt(o?.sno, 10) }))
          .filter((o) => Number.isFinite(o.material_id) && Number.isFinite(o.sno))
      : [];

    await prisma.$transaction([
      prisma.bomMaster.update({
        where: { id },
        data: {
          remarks: String(remarks ?? "").trim().slice(0, 500) || null,
          target_qty: qty,
        },
      }),
      ...rows.map((o) =>
        prisma.bomDetail.updateMany({
          where: { bom_id: id, material_id: o.material_id },
          data: { sno: o.sno },
        }),
      ),
    ]);

    const bom = await prisma.bomMaster.findUnique({ where: { id }, select: SELECT });
    return NextResponse.json(shape(bom));
  } catch (error) {
    console.error("BOM view PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
