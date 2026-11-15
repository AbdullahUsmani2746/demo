import { NextResponse } from "next/server";
import { documentScopeWhere } from "@/lib/auth/documentScope";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { seesAllLoans, customerInScope } from "@/lib/salesLoans/core";
import { customerScopeWhere } from "@/lib/auth/salesScope";

// ============================================================
// GET /api/sales-loans/options?kind=...
// ============================================================
// Dropdown data for the Sales Loan form, already limited to the caller's own
// customers (see lib/salesLoans/core.js).
//
//   kind=customers                  FROM customers (the caller's own)
//   kind=allCustomers               GIVEN TO customers (anyone's)
//   kind=salesPersons               sales persons (only for "see all" users)
//   kind=items                      every item (code, name, unit)
//   kind=orders&acno=               that customer's Sale Orders
//   kind=dispatches&acno=[&so_no=]  that customer's Dispatches
//   kind=orderLines&so_no=          the items on a Sale Order, to prefill lines
// ============================================================

export const GET = guard(null, async (req, { session }) => {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const seesAll = await seesAllLoans(session);

    switch (kind) {
      case "customers": {
        const customers = await prisma.aCNO.findMany({
          where: {
            macno: { in: await getCustomerMacnos() },
            ...(await customerScopeWhere(session)),
          },
          select: { acno: true, acname: true, salesArea: true },
          orderBy: { acname: "asc" },
        });
        return NextResponse.json({ data: customers, seesAll });
      }

      // Every customer — the GIVEN TO side of a loan may be anyone's customer.
      case "allCustomers": {
        const customers = await prisma.aCNO.findMany({
          where: { macno: { in: await getCustomerMacnos() } },
          select: { acno: true, acname: true, salesArea: true },
          orderBy: { acname: "asc" },
        });
        const spIds = [...new Set(customers.map((c) => c.salesArea).filter(Boolean))];
        const users = spIds.length
          ? await prisma.user.findMany({ where: { id: { in: spIds } }, select: { id: true, name: true } })
          : [];
        const nameById = new Map(users.map((u) => [u.id, u.name]));
        return NextResponse.json({
          data: customers.map((c) => ({
            acno: c.acno,
            acname: c.acname,
            salesPersonName: (c.salesArea && nameById.get(c.salesArea)) || null,
          })),
        });
      }

      case "salesPersons": {
        if (!seesAll) return NextResponse.json({ data: [] });
        const ids = await prisma.aCNO.findMany({
          where: { macno: { in: await getCustomerMacnos() }, salesArea: { not: null } },
          select: { salesArea: true },
          distinct: ["salesArea"],
        });
        const users = await prisma.user.findMany({
          where: { id: { in: ids.map((r) => r.salesArea).filter(Boolean) } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return NextResponse.json({ data: users });
      }

      case "items": {
        const items = await prisma.item.findMany({
          where: { discard: false },
          select: { itcd: true, item: true, code: true, unit: true },
          orderBy: [{ code: "asc" }, { item: "asc" }],
        });
        return NextResponse.json({ data: items });
      }

      case "orders": {
        const customer = await customerInScope(session, url.searchParams.get("acno"));
        if (!customer) return NextResponse.json({ data: [] });
        const orders = await prisma.orderMaster.findMany({
          where: { order_catagory: 6, party_code: customer.acno },
          select: { order_no: true, dated: true, sale_po: true },
          orderBy: { order_no: "desc" },
          take: 300,
        });
        return NextResponse.json({ data: orders });
      }

      case "dispatches": {
        const customer = await customerInScope(session, url.searchParams.get("acno"));
        if (!customer) return NextResponse.json({ data: [] });
        const soNo = Number(url.searchParams.get("so_no")) || null;
        // Data scope (Admin → Permissions): only dispatches from the user's godowns.
        const scopeFrags = await documentScopeWhere(session, 6);
        const dispatches = await prisma.transactionsMaster.findMany({
          where: {
            tran_code: 6,
            pycd: customer.acno,
            ...(soNo ? { so_no: soNo } : {}),
            ...(scopeFrags.length && { AND: scopeFrags }),
          },
          select: { tran_id: true, dispatch_no: true, vr_no: true, so_no: true, dated: true, invoice_no: true, invoice_series: true },
          orderBy: [{ dated: "desc" }, { tran_id: "desc" }],
          take: 300,
        });
        return NextResponse.json({ data: dispatches });
      }

      case "orderLines": {
        const soNo = Number(url.searchParams.get("so_no"));
        if (!soNo) return NextResponse.json({ data: [] });
        const so = await prisma.orderMaster.findFirst({
          where: { order_no: soNo, order_catagory: 6 },
          select: {
            party_code: true,
            orderDetails: { select: { itcd: true, qty: true, unit: true } },
          },
        });
        if (!so || !(await customerInScope(session, so.party_code))) {
          return NextResponse.json({ data: [] });
        }
        return NextResponse.json({
          data: so.orderDetails.filter((d) => d.itcd),
        });
      }

      default:
        return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
    }
  } catch (error) {
    console.error("sales-loans options error:", error);
    return NextResponse.json(
      { error: "Failed to load options", detail: error.message },
      { status: 500 },
    );
  }
});
