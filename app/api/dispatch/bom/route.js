// GET /api/dispatch/bom?itcd=12&qty=1000&godown=2
//   The finished item's active BOM (latest active, BomMaster.instructions "A")
//   scaled to `qty`, with each material's stock in `godown` (the dispatch's
//   issue godown) — what the dispatch form shows under a line.
//   → { bom_id, materials: [{ itcd, item, unit, percentage, qty, available }] }
//     bom_id null + materials [] when the item has no active BOM.
//
// GET /api/dispatch/bom?tran_id=123
//   A saved dispatch's materials per line, for the edit form
//   (lib/dispatch/bomProduction.js loadDispatchBom).
//   → { issueGodown, byLine: { "<lineNo>": [{ itcd, item, qty, rate, godown, godownName }] } }
//     issueGodown = the godown most materials were issued from (the header's).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { getGodownStock } from "@/lib/stock/godownStock";
import { loadDispatchBom } from "@/lib/dispatch/bomProduction";

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

export async function GET(req) {
  try {
    await authorize(null);
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }

  try {
    const { searchParams } = new URL(req.url);

    const tranId = Number(searchParams.get("tran_id"));
    if (tranId) return NextResponse.json(await loadDispatchBom(tranId));

    const itcd = Number(searchParams.get("itcd"));
    if (!Number.isInteger(itcd) || itcd <= 0) {
      return NextResponse.json({ error: "itcd is required" }, { status: 400 });
    }
    const qty = Number(searchParams.get("qty")) || 0;
    const godown = Number(searchParams.get("godown")) || null;

    const bom = await prisma.bomMaster.findFirst({
      where: { finished_id: itcd, instructions: "A" },
      orderBy: [{ dated: "desc" }, { id: "desc" }],
      select: {
        id: true,
        bomDetails: {
          select: {
            material_id: true,
            material_percentage: true,
            sno: true,
            item: { select: { item: true, unit: true } },
          },
          orderBy: [{ sno: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!bom) return NextResponse.json({ bom_id: null, materials: [] });

    const stock = godown
      ? await getGodownStock(bom.bomDetails.map((d) => d.material_id), godown)
      : new Map();

    return NextResponse.json({
      bom_id: bom.id,
      materials: bom.bomDetails.map((d) => ({
        itcd: d.material_id,
        item: d.item?.item ?? `Item #${d.material_id}`,
        unit: d.item?.unit ?? "KG",
        percentage: Number(d.material_percentage) || 0,
        qty: round4((qty * (Number(d.material_percentage) || 0)) / 100),
        available: godown ? round4(stock.get(d.material_id) || 0) : null,
      })),
    });
  } catch (error) {
    console.error("GET /api/dispatch/bom:", error);
    return NextResponse.json({ error: "Failed to load BOM" }, { status: 500 });
  }
}
