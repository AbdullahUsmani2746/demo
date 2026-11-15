import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/accounts/checks-in-hand/banks
//
//  Bank is free text on the cheque form - there is no bank master to pick
//  from. So the combobox is seeded from the banks already typed on previous
//  cheques: type a new one the first time, choose it from the list every time
//  after. Everything is stored UPPERCASE (see normalizeBank), so this list is
//  already de-duplicated by casing.
//
//  Ordered by how often each bank has been used, so the banks this desk
//  actually deals with sit at the top of the dropdown.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const grouped = await prisma.checksInHand.groupBy({
      by: ["bank"],
      _count: { bank: true },
      orderBy: { _count: { bank: "desc" } },
    });

    const data = grouped
      .filter((g) => g.bank)
      .map((g) => ({ value: g.bank, label: g.bank, count: Number(g._count.bank) }));

    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    console.error("Error fetching cheque banks:", error);
    return NextResponse.json({ error: "Failed to fetch banks" }, { status: 500 });
  }
}
