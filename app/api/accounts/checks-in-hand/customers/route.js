import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { deriveCategory, categoryWhere } from "@/lib/accounts/checksInHand";

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/accounts/checks-in-hand/customers?search=&category=
//
//  Customer picker for the cheque entry screen and the Checks In Hand report.
//
//  Deliberately NOT /api/accounts/acno: that route hides ACNO.isActive=false
//  accounts unless the caller has the account-visibility grant, and the whole
//  point of the dual book here is that unofficial (isActive=false) customers must
//  stay selectable. Cheques are physical documents - one exists whichever book
//  its customer sits in.
//
//    category=active   -> official book only
//    category=inactive -> unofficial book only
//    omitted / "all"   -> both, each row tagged with its category
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get("search") || "").trim();
    const category = searchParams.get("category") || "all";
    const limit = Math.min(2000, Math.max(1, Number(searchParams.get("limit")) || 1000));

    const where = { macno: { in: await getCustomerMacnos() } };

    const catWhere = categoryWhere(category);
    if (catWhere) Object.assign(where, catWhere);

    if (search) {
      const numeric = parseInt(search, 10);
      where.OR = [
        { acname: { contains: search, mode: "insensitive" } },
        ...(Number.isNaN(numeric) ? [] : [{ acno: numeric }]),
      ];
    }

    const customers = await prisma.aCNO.findMany({
      where,
      select: {
        acno: true, acname: true, isActive: true, salesArea: true,
        mainAccount: { select: { isActive: true } },
      },
      orderBy: { acname: "asc" },
      take: limit,
    });

    // Sales Person is a User id parked on ACNO.salesArea - resolve to a name
    // so the picker can show who owns the account.
    const salesPersonIds = [...new Set(customers.map((c) => c.salesArea).filter(Boolean))];
    const users = salesPersonIds.length
      ? await prisma.user.findMany({
          where: { id: { in: salesPersonIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const data = customers.map((c) => ({
      acno: c.acno,
      acname: c.acname,
      isActive: c.isActive && c.mainAccount?.isActive !== false,
      category: deriveCategory(c),
      salesPersonName: (c.salesArea && nameById.get(c.salesArea)) || "OPEN",
    }));

    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    console.error("Error fetching cheque customers:", error);
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
  }
}
