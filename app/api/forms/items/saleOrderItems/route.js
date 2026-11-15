import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const saleOrderNo = parseInt(searchParams.get("saleOrderNo") || "1");
    const search = searchParams.get("search") || "";
    const itcd = searchParams.get("itcd");

    const where = {
      order_no: saleOrderNo,
      status: { not: 2 }, // Exclude closed items (status=2)
    };
    
    //add search condition only if it exists
    if (itcd && !isNaN(parseInt(itcd))) {
      where.itcd = parseInt(itcd);
    } else if (search) {
      where.OR = [
        { itcd: { equals: isNaN(parseInt(search)) ? undefined : parseInt(search) } },
        { items: { item: { contains: search, mode: "insensitive" } } },
        { items: { code: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Fetch dispatches against this sale order to calculate cumulative
    // dispatched qty. Tracked in BOTH units: KG is the stock figure, litres is
    // what a LTR line's balance has to be measured in so the customer's
    // remaining order reads in the unit they ordered in.
    const dispatches = await prisma.transactionsMaster.findMany({
      where: { tran_code: 6, so_no: saleOrderNo },
      include: { transactions: { select: { itcd: true, qty: true, qty_ltr: true } } },
    });

    const dispatchedPerItem = {};
    const dispatchedLtrPerItem = {};
    for (const d of dispatches) {
      for (const t of d.transactions) {
        if (t.itcd != null) {
          dispatchedPerItem[t.itcd] = (dispatchedPerItem[t.itcd] || 0) + (t.qty || 0);
          dispatchedLtrPerItem[t.itcd] =
            (dispatchedLtrPerItem[t.itcd] || 0) + (t.qty_ltr || 0);
        }
      }
    }

    const items = await prisma.orderDetail.findMany({
      where,
      select: {
        itcd: true,
        rate: true,
        st_rate: true,
        qty: true,
        qty_ltr: true,
        unit: true,
        items: {
          select: {
            item: true,
            code: true,
            // KG per litre. The dispatch form must know this to convert the
            // ordered litres into the KG that will move stock, and to block
            // the dispatch when it is missing — see lib/units/litres.js.
            ltr_rate: true,
          },
        },
      },
    });

    return NextResponse.json({
      data: items.map((item) => ({
        itcd: item.itcd,
        item: item.items?.item || "Unknown Item",
        code: item.items?.code || "Unknown Code",
        rate: item.rate,
        st_rate: item.st_rate,
        qty: item.qty,
        // The unit and litre figures the dispatch inherits — a dispatch never
        // asks for the unit again, it takes whatever the Sale Order was raised in.
        unit: item.unit || "KG",
        qty_ltr: item.qty_ltr,
        ltr_rate: item.items?.ltr_rate ?? null,
        dispatched_qty: dispatchedPerItem[item.itcd] || 0,
        dispatched_qty_ltr: dispatchedLtrPerItem[item.itcd] || 0,
      })),
    });

  } catch (error) {
    console.error("Error fetching item by itcd:", error);
    return NextResponse.json(
      { error: "Failed to fetch item", details: error.message },
      { status: 500 }
    );
  }
}