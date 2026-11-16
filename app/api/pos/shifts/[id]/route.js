// app/api/pos/shifts/[id]/route.js — one shift's Z report; close it.
//   GET                               the Z report (frozen at close, live while open)
//   POST { countedCash, notes }       close the shift (pos.dayClose; someone else's needs pos.allShifts)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { posRights } from "@/lib/pos/posting";
import { summarize, closeShift } from "@/lib/pos/shift";
import { posErrorResponse, hasPosAccess } from "@/lib/pos/http";

export const GET = guard(null, async (request, { params, session }) => {
  try {
    const { id } = await params;
    const rights = await posRights(session);
    if (!hasPosAccess(rights)) return NextResponse.json({ error: "No point of sale access." }, { status: 403 });
    const shift = await prisma.posShift.findUnique({ where: { id: Number(id) } });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.user_id !== String(session.user.id) && !rights.allShifts) return NextResponse.json({ error: "Another cashier's shift (pos.allShifts)." }, { status: 403 });
    const cashier = await prisma.user.findUnique({ where: { id: shift.user_id }, select: { name: true } });
    const report = shift.status === "CLOSED" && shift.summary ? shift.summary : await summarize({ shiftId: shift.id, openingFloat: shift.opening_float });
    return NextResponse.json({ shift: { ...shift, cashier: cashier?.name || null }, report });
  } catch (error) {
    return posErrorResponse(error, "POS shift");
  }
});

export const POST = guard("pos.dayClose", async (request, { params, session }) => {
  try {
    const { id } = await params;
    const rights = await posRights(session);
    const body = await request.json().catch(() => ({}));
    const shift = await closeShift(session, id, body, { mayCloseOthers: rights.allShifts });
    return NextResponse.json({ shift, report: shift.summary });
  } catch (error) {
    return posErrorResponse(error, "POS close shift");
  }
});
