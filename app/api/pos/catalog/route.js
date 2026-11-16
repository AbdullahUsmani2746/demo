// app/api/pos/catalog/route.js — what the till sells.
//   GET ?search=&category=&take=   items (price, stock in the POS godown, category)
//   GET ?code=<scanned>            exact match on item code / SKU / id (barcode wedge)
// Items: not discontinued, in Settings → Point of Sale → "Item categories sold
// at the till" (none picked = all). Stock = posted − held by pending approvals
// (lib/stock/godownStock.js), in the POS godown.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { getGodownStock } from "@/lib/stock/godownStock";
import { getPosSettings } from "@/lib/pos/settings";
import { posRights } from "@/lib/pos/posting";
import { posErrorResponse, hasPosAccess } from "@/lib/pos/http";

const SELECT = { itcd: true, item: true, code: true, sku: true, price: true, unit: true, image_url: true, ic_id: true };

export const GET = guard(null, async (request, { session }) => {
  try {
    if (!hasPosAccess(await posRights(session))) return NextResponse.json({ error: "No point of sale access." }, { status: 403 });
    const settings = await getPosSettings();
    const sp = new URL(request.url).searchParams;
    const base = { OR: [{ discard: false }, { discard: null }] };
    const inCats = settings.categoryIds.length ? { ic_id: { in: settings.categoryIds } } : {};

    let items;
    const code = (sp.get("code") || "").trim();
    if (code) {
      const n = Number(code);
      items = await prisma.item.findMany({
        where: {
          AND: [base, inCats, { OR: [{ code: { equals: code, mode: "insensitive" } }, { sku: { equals: code, mode: "insensitive" } }, ...(Number.isInteger(n) && n > 0 && n < 2 ** 31 ? [{ itcd: n }] : [])] }],
        },
        select: SELECT,
        take: 5,
      });
    } else {
      const search = (sp.get("search") || "").trim();
      const category = Number(sp.get("category"));
      const take = Math.min(Math.max(parseInt(sp.get("take")) || 60, 1), 200);
      const words = search.split(/\s+/).filter(Boolean).slice(0, 5);
      items = await prisma.item.findMany({
        where: {
          AND: [
            base,
            inCats,
            ...(Number.isInteger(category) && category > 0 ? [{ ic_id: category }] : []),
            ...words.map((w) => ({ OR: [{ item: { contains: w, mode: "insensitive" } }, { code: { contains: w, mode: "insensitive" } }, { sku: { contains: w, mode: "insensitive" } }] })),
          ],
        },
        select: SELECT,
        orderBy: { item: "asc" },
        take,
      });
    }
    const stock = await getGodownStock(items.map((i) => i.itcd), settings.godown);
    return NextResponse.json({
      godown: settings.godown,
      items: items.map((i) => ({ ...i, price: Number(i.price) || 0, stock: Math.round((stock.get(i.itcd) || 0) * 1000) / 1000 })),
    });
  } catch (error) {
    return posErrorResponse(error, "POS catalog");
  }
});
