import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { getLatestOpeningPeriod, openingQtySql } from "@/lib/openingStock";

// ============================================================
// /api/material/bom-stock?items=1,2,3 — current stock for the BOM View
// ============================================================
// Current stock (KG, all godowns) =
//     latest Monthly Opening Stock on or before today (summed over godowns)
//   + every stock movement dated on or after the 1st of that month.
// When no opening has been generated yet, it falls back to every
// transaction since the beginning (opening = 0).
//
//   IN : 4, 8, 10, 12      OUT: 5, 6, 7, 9
//   11 (transfer) cancels out across all godowns, so it is left out.
//   sub_tran_id = 3 (control/tax rows) is excluded.
//
// → { data: { [itcd]: qty }, period: { month, year } | null }
// ============================================================

export const GET = guard(null, async (req) => {
  try {
    const itcds = [
      ...new Set(
        (new URL(req.url).searchParams.get("items") || "")
          .split(",")
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v > 0),
      ),
    ];
    if (itcds.length === 0) return NextResponse.json({ data: {}, period: null });

    const period = await getLatestOpeningPeriod(new Date());
    const from = period ? new Date(period.year, period.month - 1, 1, 0, 0, 0, 0) : null;

    const rows = await prisma.$queryRaw`
      WITH opening AS (
        ${period
          ? openingQtySql(period.month, period.year)
          : Prisma.sql`SELECT NULL::int AS itcd, 0::float AS opening_qty WHERE FALSE`}
      ),
      moves AS (
        SELECT t.itcd,
               SUM(CASE
                     WHEN tm.tran_code IN (4, 8, 10, 12) THEN COALESCE(t.qty, 0)
                     WHEN tm.tran_code IN (5, 6, 7, 9)   THEN -COALESCE(t.qty, 0)
                     ELSE 0
                   END) AS qty
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        WHERE t.itcd IN (${Prisma.join(itcds)})
          AND COALESCE(t.sub_tran_id, 1) <> 3
          AND tm.tran_code IN (4, 5, 6, 7, 8, 9, 10, 12)
          ${from ? Prisma.sql`AND tm.dated >= ${from}` : Prisma.empty}
        GROUP BY t.itcd
      )
      SELECT i.itcd,
             COALESCE(o.opening_qty, 0)::float + COALESCE(m.qty, 0)::float AS stock
      FROM "Item" i
      LEFT JOIN opening o ON o.itcd = i.itcd
      LEFT JOIN moves m   ON m.itcd = i.itcd
      WHERE i.itcd IN (${Prisma.join(itcds)})
    `;

    const data = Object.fromEntries(itcds.map((id) => [id, 0]));
    for (const r of rows) data[Number(r.itcd)] = Number(r.stock) || 0;

    return NextResponse.json({ data, period });
  } catch (error) {
    console.error("bom-stock GET error:", error);
    return NextResponse.json(
      { error: "Failed to load stock", detail: error.message },
      { status: 500 },
    );
  }
});
