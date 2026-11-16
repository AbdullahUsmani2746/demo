// app/api/pos/held/route.js — bills on hold at the till (each cashier's own).
//   GET                       the person's held bills
//   POST { label, data }      put a bill on hold (data = the till's bill: lines, customer, discount, note)
// DELETE /api/pos/held/[id]   recall (or discard) it.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { posErrorResponse } from "@/lib/pos/http";

const MAX_HELD = 30;

export const GET = guard("pos.sell", async (request, { session }) => {
  try {
    const bills = await prisma.posHeldBill.findMany({ where: { user_id: String(session.user.id) }, orderBy: { created_at: "desc" } });
    return NextResponse.json({ bills });
  } catch (error) {
    return posErrorResponse(error, "POS held bills");
  }
});

export const POST = guard("pos.sell", async (request, { session }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const data = body?.data;
    if (!data || !Array.isArray(data.lines) || !data.lines.length) return NextResponse.json({ error: "There is nothing on the bill to hold." }, { status: 400 });
    if (JSON.stringify(data).length > 100_000) return NextResponse.json({ error: "This bill is too large to hold." }, { status: 400 });
    const userId = String(session.user.id);
    const count = await prisma.posHeldBill.count({ where: { user_id: userId } });
    if (count >= MAX_HELD) return NextResponse.json({ error: `You already have ${MAX_HELD} bills on hold — recall or discard some first.` }, { status: 422 });
    const bill = await prisma.posHeldBill.create({
      data: { user_id: userId, label: body?.label ? String(body.label).slice(0, 120) : null, data },
    });
    return NextResponse.json({ bill }, { status: 201 });
  } catch (error) {
    return posErrorResponse(error, "POS hold bill");
  }
});
