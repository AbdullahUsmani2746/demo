// GET /api/forms/items/categories — the item categories the signed-in person
// may add / edit items in (Admin → Permissions → Data scope → Item
// categories). { categories: [{ id, ic_name }], limited: boolean }.
// The item routes enforce the same rule on save.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { scopeValues } from "@/lib/auth/documentScope";

export async function GET() {
  try {
    const { session } = await authorize();
    const allowed = await scopeValues(session, "itemCategory");
    const categories = await prisma.itemCategory.findMany({
      where: allowed ? { id: { in: allowed } } : undefined,
      select: { id: true, ic_name: true },
      orderBy: { id: "asc" },
    });
    return NextResponse.json({ categories, limited: !!allowed });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ error: "Failed to load item categories", details: error.message }, { status: 500 });
  }
}
