import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lcNo = searchParams.get("lcNo") || "";
    const bondId = searchParams.get("bondId") || "";
    const orderNo = searchParams.get("orderNo") || "";
    const search = searchParams.get("search") || "";
    const itcdParam = searchParams.get("itcd");

    // If no specific context or single item query is provided, return all active items
    if (!lcNo && !bondId && !orderNo && !itcdParam) {
      const whereAll = {};
      if (search) {
        const searchNum = parseInt(search);
        whereAll.OR = [
          { item: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
          ...(isNaN(searchNum) ? [] : [{ itcd: searchNum }]),
        ];
      }
      const allItems = await prisma.item.findMany({
        where: whereAll,
        select: {
          itcd: true,
          item: true,
          code: true,
          unit: true,
          ltr_rate: true,
        },
        orderBy: { itcd: "asc" },
      });
      return NextResponse.json({
        data: allItems.map((item) => ({
          itcd: item.itcd,
          item: item.item || "",
          code: item.code || "",
          unit: item.unit || "KG",
          ltr_rate: item.ltr_rate ?? null,
        })),
      });
    }

    let itemIds = new Set();

    // 1. If Ex-Bond Entry is selected: fetch items from InboundMaster detail lines
    if (bondId) {
      const numericBondId = parseInt(bondId);
      const bondWhere = !isNaN(numericBondId)
        ? { OR: [{ id: numericBondId }, { bond_id: bondId }] }
        : { bond_id: bondId };

      const bond = await prisma.inboundMaster.findFirst({
        where: bondWhere,
        include: {
          transactions: {
            select: { itcd: true },
          },
        },
      });

      if (bond?.transactions) {
        bond.transactions.forEach((t) => {
          if (t.itcd != null) itemIds.add(t.itcd);
        });
      }
    }
    // 2. If L/C No is selected (and no Bond selected): fetch items from LCMaster detail lines
    else if (lcNo) {
      const lc = await prisma.lCMaster.findUnique({
        where: { lc_no: lcNo },
        include: {
          details: {
            select: { itcd: true },
          },
        },
      });

      if (lc?.details) {
        lc.details.forEach((d) => {
          if (d.itcd != null) itemIds.add(d.itcd);
        });
      }
    }
    // 3. If Purchase Order is selected: fetch items from OrderDetail lines
    else if (orderNo) {
      const poNum = parseInt(orderNo);
      if (!isNaN(poNum)) {
        const poLines = await prisma.orderDetail.findMany({
          where: { order_no: poNum },
          select: { itcd: true },
        });
        poLines.forEach((l) => {
          if (l.itcd != null) itemIds.add(l.itcd);
        });
      }
    }

    const whereClause = {};

    // Filter by collected itemIds if LC, Bond, or PO context is active
    if (lcNo || bondId || orderNo) {
      const idsArray = Array.from(itemIds);
      if (idsArray.length === 0) {
        return NextResponse.json({ data: [] });
      }
      whereClause.itcd = { in: idsArray };
    }

    if (itcdParam && !isNaN(parseInt(itcdParam))) {
      whereClause.itcd = parseInt(itcdParam);
    } else if (search) {
      const searchNum = parseInt(search);
      const currentItcdClause = whereClause.itcd;
      whereClause.AND = [
        currentItcdClause ? { itcd: currentItcdClause } : {},
        {
          OR: [
            { item: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
            ...(isNaN(searchNum) ? [] : [{ itcd: searchNum }]),
          ],
        },
      ];
      delete whereClause.itcd;
    }

    const items = await prisma.item.findMany({
      where: whereClause,
      select: {
        itcd: true,
        item: true,
        code: true,
        unit: true,
        ltr_rate: true,
      },
      orderBy: { itcd: "asc" },
    });

    return NextResponse.json({
      data: items.map((item) => ({
        itcd: item.itcd,
        item: item.item || "",
        code: item.code || "",
        unit: item.unit || "KG",
        ltr_rate: item.ltr_rate ?? null,
      })),
    });
  } catch (error) {
    console.error("Error fetching GRN items:", error);
    return NextResponse.json(
      { error: "Failed to fetch GRN items", details: error.message },
      { status: 500 }
    );
  }
}
