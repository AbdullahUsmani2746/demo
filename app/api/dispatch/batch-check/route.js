// /api/dispatch/batch-check?batch_no=26-7479,26-7488&exclude=12345
//
// Create / Edit Dispatch: is a line's Batch No already on another Dispatch
// (Transactions.batch_no, tran_code 6 item line)? Read only — the form shows a
// warning toast and saves anyway (it never blocks). Same idea as
// /api/manufacturing/production/batch-check for Process Orders.
// Returns { used: { "<batch_no>": [dispatch no, ...] } }.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const batches = [
      ...new Set(
        String(searchParams.get("batch_no") || "")
          .split(",")
          .map((b) => b.trim())
          .filter(Boolean),
      ),
    ].slice(0, 50);
    const exclude = Number(searchParams.get("exclude")) || null; // the dispatch being edited
    if (batches.length === 0) return NextResponse.json({ used: {} });

    const rows = await prisma.transactions.findMany({
      where: {
        batch_no: { in: batches },
        sub_tran_id: 1,
        transactionsMaster: {
          tran_code: 6,
          ...(exclude ? { tran_id: { not: exclude } } : {}),
        },
      },
      select: {
        batch_no: true,
        transactionsMaster: { select: { tran_id: true, dispatch_no: true, vr_no: true } },
      },
      orderBy: { tran_id: "desc" },
      take: 200,
    });

    const used = {};
    for (const r of rows) {
      const m = r.transactionsMaster;
      const no = m?.dispatch_no ?? m?.vr_no ?? m?.tran_id;
      if (no == null) continue;
      if (!used[r.batch_no]) used[r.batch_no] = [];
      if (!used[r.batch_no].includes(no) && used[r.batch_no].length < 10) used[r.batch_no].push(no);
    }

    return NextResponse.json({ used });
  } catch (error) {
    // A failed check never matters to the save — the form just shows nothing
    console.error("Dispatch batch no check error:", error);
    return NextResponse.json({ used: {} });
  }
}
