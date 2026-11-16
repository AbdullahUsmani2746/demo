// app/api/pos/stats/route.js — the POS home cards: today's and this month's figures.
// Everyone's tills with pos.allShifts, otherwise the person's own receipts.
// (It used to sum gross_amount of every POS sale ever, before discounts and
// without returns, and told cash from card by the sale's party account.)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { posRights, POS_SALE, POS_RETURN } from "@/lib/pos/posting";
import { summarize } from "@/lib/pos/shift";
import { posErrorResponse, hasPosAccess, receiptScope } from "@/lib/pos/http";

async function figures(from, to, scope) {
  const rows = await prisma.transactionsMaster.findMany({
    where: { tran_code: { in: [POS_SALE, POS_RETURN] }, dated: { gte: from, lte: to }, ...scope },
    select: { tran_id: true },
  });
  return summarize({ tranIds: rows.map((r) => r.tran_id) });
}

export const GET = guard(null, async (request, { session }) => {
  try {
    const rights = await posRights(session);
    if (!hasPosAccess(rights)) return NextResponse.json({ error: "No point of sale access." }, { status: 403 });
    const scope = receiptScope(session, rights);
    const now = new Date();
    const dayFrom = new Date(now); dayFrom.setHours(0, 0, 0, 0);
    const dayTo = new Date(now); dayTo.setHours(23, 59, 59, 999);
    const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const [today, month] = await Promise.all([figures(dayFrom, dayTo, scope), figures(monthFrom, dayTo, scope)]);
    return NextResponse.json({ scope: rights.allShifts ? "all" : "mine", today, month });
  } catch (error) {
    return posErrorResponse(error, "POS stats");
  }
});
