// app/api/pos/shifts/route.js — POS shifts (lib/pos/shift.js).
//   GET  ?all=1&day=YYYY-MM-DD   { open, shifts, today }  open = the person's open shift with its live Z report;
//                                shifts = recent shifts (everyone's with pos.allShifts); today = the person's
//                                (or, with all=1 and pos.allShifts, every till's) receipts of the day
//   POST { openingFloat }        open a shift (pos.dayClose)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { posRights, openShiftOf, POS_SALE, POS_RETURN } from "@/lib/pos/posting";
import { summarize, openShift } from "@/lib/pos/shift";
import { getPosSettings } from "@/lib/pos/settings";
import { posErrorResponse, hasPosAccess } from "@/lib/pos/http";

export const GET = guard(null, async (request, { session }) => {
  try {
    const rights = await posRights(session);
    if (!hasPosAccess(rights)) return NextResponse.json({ error: "No point of sale access." }, { status: 403 });
    const sp = new URL(request.url).searchParams;
    const all = sp.get("all") === "1" && rights.allShifts;
    const userId = String(session.user.id);

    const open = await openShiftOf(userId);
    const shifts = await prisma.posShift.findMany({
      where: all ? {} : { user_id: userId },
      orderBy: { opened_at: "desc" },
      take: 30,
    });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(shifts.map((s) => s.user_id))] } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));

    // The day's receipts (with or without a shift).
    const day = sp.get("day") ? new Date(sp.get("day")) : new Date();
    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(day); to.setHours(23, 59, 59, 999);
    const dayRows = await prisma.transactionsMaster.findMany({
      where: { tran_code: { in: [POS_SALE, POS_RETURN] }, dated: { gte: from, lte: to }, ...(all ? {} : { user_id: userId }) },
      select: { tran_id: true },
    });

    return NextResponse.json({
      open: open ? { ...open, live: await summarize({ shiftId: open.id, openingFloat: open.opening_float }) } : null,
      shifts: shifts.map((s) => ({ ...s, cashier: nameOf.get(s.user_id) || null })),
      today: { day: from, all, ...(await summarize({ tranIds: dayRows.map((r) => r.tran_id) })) },
      rights: { dayClose: rights.dayClose, allShifts: rights.allShifts },
    });
  } catch (error) {
    return posErrorResponse(error, "POS shifts");
  }
});

export const POST = guard("pos.dayClose", async (request, { session }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const settings = await getPosSettings();
    const shift = await openShift(session, { openingFloat: body?.openingFloat ?? 0, godown: settings.godown });
    return NextResponse.json({ shift }, { status: 201 });
  } catch (error) {
    return posErrorResponse(error, "POS open shift");
  }
});
