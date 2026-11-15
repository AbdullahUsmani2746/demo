// /api/manufacturing/production/next-id
//
// Preview of the Process Order No (productionPlanMaster.id) the next create
// will get — shown read-only on the Create Process Order form.
//
// Reads the table's autoincrement sequence WITHOUT consuming it (no nextval),
// so opening the form never burns a number. The sequence, not MAX(id) + 1, is
// the source of truth: a deleted latest row would make MAX(id) + 1 repeat a
// number the database will never hand out again.
//
// It is a preview only: if two users create at the same time, the number
// actually saved is whatever the database assigns on INSERT.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const [row] = await prisma.$queryRaw`
      SELECT pg_sequence_last_value(
        pg_get_serial_sequence('"productionPlanMaster"', 'id')::regclass
      ) AS last_value
    `;

    let nextId;
    if (row?.last_value != null) {
      nextId = Number(row.last_value) + 1;
    } else {
      // Sequence never used yet (or unreadable) — fall back to MAX(id) + 1
      const agg = await prisma.productionPlanMaster.aggregate({ _max: { id: true } });
      nextId = (agg._max.id || 0) + 1;
    }

    return NextResponse.json({ nextId }, { status: 200 });
  } catch (error) {
    console.error("Error fetching next process order no:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
