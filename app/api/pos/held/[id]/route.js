// app/api/pos/held/[id]/route.js — recall (returns the bill and removes it) or discard a held bill.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { posErrorResponse } from "@/lib/pos/http";

export const DELETE = guard("pos.sell", async (request, { params, session }) => {
  try {
    const { id } = await params;
    const bill = await prisma.posHeldBill.findFirst({ where: { id: Number(id), user_id: String(session.user.id) } });
    if (!bill) return NextResponse.json({ error: "This held bill is gone (recalled at another till?)." }, { status: 404 });
    // deleteMany on id + owner: two tills recalling at once — only one gets it.
    const { count } = await prisma.posHeldBill.deleteMany({ where: { id: bill.id, user_id: bill.user_id } });
    if (!count) return NextResponse.json({ error: "This held bill was just recalled at another till." }, { status: 409 });
    return NextResponse.json({ bill });
  } catch (error) {
    return posErrorResponse(error, "POS recall bill");
  }
});
