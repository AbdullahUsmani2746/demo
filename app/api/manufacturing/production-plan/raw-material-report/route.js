// app/api/manufacturing/production-plan/raw-material-report/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

function convertForJson(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === "bigint") return Number(obj);
  if (Array.isArray(obj)) return obj.map(convertForJson);
  if (typeof obj === "object") {
    const out = {};
    for (const key in obj) out[key] = convertForJson(obj[key]);
    return out;
  }
  return obj;
}

// POST — RAW MATERIAL REQUIRED report
// body: { items: [{ finished_id, qty }] }
// Reads directly from BomMaster + BomDetail — no plan saving needed
export const POST = guard("productionPlan.update", async (request) => {
  try {
    const { items } = await request.json();

    if (!items?.length) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    const materialMap = new Map();

    for (const item of items) {
      const { finished_id, qty } = item;
      if (!finished_id || !qty) continue;

      // Get active BOM for this product directly from BomMaster
      const bom = await prisma.bomMaster.findFirst({
        where: {
          finished_id: parseInt(finished_id),
          instructions: "A", // Active only
        },
        include: {
          bomDetails: {
            include: { item: true },
          },
        },
      });

      if (!bom?.bomDetails?.length) continue;

      for (const det of bom.bomDetails) {
        const matQty = (parseFloat(qty) * (det.material_percentage || 0)) / 100;
        const matId = det.material_id;

        if (materialMap.has(matId)) {
          materialMap.get(matId).qty_req += matQty;
        } else {
          materialMap.set(matId, {
            material_id: matId,
            rm_item: det.item?.item || "N/A",
            qty_req: matQty,
          });
        }
      }
    }

    const materials = [...materialMap.values()].sort(
      (a, b) => a.material_id - b.material_id
    );
    const totalQty = materials.reduce((s, m) => s + m.qty_req, 0);

    return NextResponse.json(convertForJson({ materials, totalQty }));
  } catch (error) {
    console.error("Raw Material Report error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});