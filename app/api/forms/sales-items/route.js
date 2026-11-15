// app/api/forms/sales-items/route.js
//
// The customer × item rate list. Writing here sets the price a sale order
// will use, so every write requires `salesItem.rate.update` and every read
// is narrowed to the customers the user is scoped to.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard, authorize, authErrorResponse } from "@/lib/auth/route";
import { scopeFor, assertInScope } from "@/lib/auth/scope";
import { feature } from "@/lib/features/server";

export async function GET(request) {
  let session;
  try {
    ({ session } = await authorize());
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const acno = parseInt(searchParams.get("acno") || "0");
  const search = searchParams.get("search") || "";

  // Reading another sales person's price list is reading their margin, so
  // the same scope that limits the reports limits this.
  const scope = await scopeFor(session, "customer");
  try {
    assertInScope(scope, acno, "customer");
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }

  const where = {
    acno,
    OR: search
      ? [
          { itcd: { equals: parseInt(search) || undefined } },
          { item: { item: { contains: search, mode: "insensitive" } } },
          { item: { code: { contains: search, mode: "insensitive" } } }
        ]
      : undefined,
  };

  const items = await prisma.sALES_ITEM_CUST.findMany({
    where,
    include: { item: true, acnoDetails: true },
  });
  return NextResponse.json(items);
}

export const POST = guard("salesItem.rate.update", async (request, { session }) => {
  const data = await request.json();
  const { acno, itcd } = data;

  if (!acno || !itcd) {
    return NextResponse.json(
      { error: "acno and itcd are required" },
      { status: 400 }
    );
  }

  assertInScope(await scopeFor(session, "customer"), acno, "customer");

  const existing = await prisma.sALES_ITEM_CUST.findFirst({
    where: { acno, itcd },
  });

  let item;
  if (existing) {
    item = await prisma.sALES_ITEM_CUST.update({
      where: { id: existing.id },
      data: {
        rate: Number(data.rate),
        gst_rate: Number(data.gst_rate),
        dated: new Date()
      }
    });
  } else {
    item = await prisma.sALES_ITEM_CUST.create({
      data: {
        itcd: data.itcd,
        acno: data.acno,
        rate: Number(data.rate),
        cust_itcd: null,
        gst_rate: Number(data.gst_rate),
      },
    });
  }

  return NextResponse.json(item);
});

export const PUT = guard("salesItem.rate.update", async (request, { session }) => {
  const { id, ...data } = await request.json();

  assertInScope(await scopeFor(session, "customer"), data.acno, "customer");

  const item = await prisma.sALES_ITEM_CUST.update({
    where: { id: parseInt(id) },
    data: {
      itcd: data.itcd,
      acno: data.acno,
      rate: Number(data.rate),
      cust_itcd: null,
      gst_rate: Number(data.gst_rate),
    },
  });
  return NextResponse.json(item);
});

// Tick / untick an item on the customer's list (Settings → Features
// "saleOrder.priceListOnly", from Eastland). Unticked (checked = false) items are
// not offered on the Sale Order (/api/forms/products) and the orders route refuses
// them. Only the flag (and who changed it) changes — the rate and its date stay.
export const PATCH = guard("salesItem.rate.update", async (request, { session }) => {
  if (!(await feature("saleOrder.priceListOnly"))) {
    return NextResponse.json({ error: "Price-list-only ordering is switched off (Settings → Features)." }, { status: 403 });
  }
  const { id, checked } = await request.json();
  if (!id || typeof checked !== "boolean") {
    return NextResponse.json({ error: "id and checked (true / false) are required" }, { status: 400 });
  }
  const existing = await prisma.sALES_ITEM_CUST.findUnique({ where: { id: parseInt(id) }, select: { acno: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertInScope(await scopeFor(session, "customer"), existing.acno, "customer");
  const item = await prisma.sALES_ITEM_CUST.update({
    where: { id: parseInt(id) },
    data: { checked, updated_by: session?.user?.id ? String(session.user.id).slice(0, 50) : null },
  });
  return NextResponse.json(item);
});

export const DELETE = guard("salesItem.rate.update", async (request, { session }) => {
  const { id } = await request.json();

  const existing = await prisma.sALES_ITEM_CUST.findUnique({
    where: { id: parseInt(id) },
    select: { acno: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  assertInScope(await scopeFor(session, "customer"), existing.acno, "customer");

  await prisma.sALES_ITEM_CUST.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ success: true });
});
