import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { visibleSalesPersons } from "@/lib/auth/salesScope";

// Distinct Sales Persons actually assigned to customers (ACNO.salesArea),
// as opposed to /api/accounts/sales-persons which derives its list from
// OrderMaster order history — that list can miss/omit people who are
// assigned to customers but haven't placed a category-6 order. This is the
// list the Sales Team MIS report groups by.
//
// ?scope=own — for report filters: a sales person is offered only themselves
// (salesTeam.viewAll / ADMIN / ACCOUNTANT get everyone; salesTeam.viewTeam
// their own + team — Permissions → Sales visibility). The reports enforce this server-side too; this only keeps the
// dropdown honest.
export async function GET(request) {
  try {
    if (new URL(request.url).searchParams.get("scope") === "own") {
      const session = await getServerSession(authOptions);
      const visible = await visibleSalesPersons(session);
      if (visible !== null) {
        const users = await prisma.user.findMany({ where: { id: { in: visible } }, select: { id: true, name: true, email: true } });
        const data = users
          .map((u) => ({ id: u.id, name: u.name || u.email || u.id }))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        return NextResponse.json({ data, total: data.length });
      }
    }

    const customers = await prisma.aCNO.findMany({
      where: { macno: { in: await getCustomerMacnos() }, salesArea: { not: null } },
      select: { salesArea: true },
      distinct: ["salesArea"],
    });

    const ids = customers.map((c) => c.salesArea).filter(Boolean);
    const users = ids.length
      ? await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];

    const data = users
      .map((u) => ({ id: u.id, name: u.name || u.id }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    console.error("Error fetching customer sales persons:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer sales persons" },
      { status: 500 }
    );
  }
}
