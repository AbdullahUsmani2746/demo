// app/api/pos/cashiers/route.js — the people who rang up POS receipts (the
// "Cashier" filter of the POS reports). Without pos.allShifts: only yourself.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";

export const GET = guard(null, async (request, { session }) => {
  if (!(await can(session, "pos.allShifts"))) {
    return NextResponse.json([{ id: String(session.user.id), name: session.user.name || session.user.email }]);
  }
  const rows = await prisma.transactionsMaster.findMany({
    where: { tran_code: { in: [5, 12] }, user_id: { not: null } },
    distinct: ["user_id"],
    select: { user_id: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.user_id) } },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(users.map((u) => ({ id: u.id, name: u.name || u.username })));
});
