import prisma from "@/lib/prisma";
import { syncOrderToWooCommerce } from "@/services/wooCommerceSync";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { checkStockForSave } from "@/lib/stock/checkStock";

// POS sells out of godown 1.
const POS_GODOWN = 1;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    // Get pagination parameters
    const page = parseInt(searchParams.get("page")) || 1;
    const limit = parseInt(searchParams.get("limit")) || 10000000;
    const search = searchParams.get("search") || "";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Build where clause for filtering
    const whereClause = {
      tran_code: 5,
    };

    // Search filter
    if (search) {
      whereClause.OR = [
        { invoice_no: { contains: search, mode: "insensitive" } }
      ];
    }

    // Date range filter
    if (startDate && endDate) {
      whereClause.dated = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get total count for pagination info
    const totalCount = await prisma.transactionsMaster.count({
      where: whereClause,
    });

    // Get orders with pagination
    const orders = await prisma.transactionsMaster.findMany({
      where: whereClause,
      include: {
        transactions: {
          include: {
            itemDetails: true,
          },
        },
      },
      orderBy: {
        dated: "desc",
      },
      skip: offset,
      take: limit,
    });

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    return NextResponse.json({
      orders,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNext,
        hasPrev,
        startItem: offset + 1,
        endItem: Math.min(offset + limit, totalCount),
      },
    });
  } catch (error) {
    console.error("GET orders error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const POST = guard("pos.manage", async (request, { session }) => {
  try {
    const { cartItems, customer, total } = await request.json();

    const lockError = await checkPeriodLock(new Date(), 5, { action: "create" });
    if (lockError) {
      return NextResponse.json({ error: lockError }, { status: 422 });
    }

    // Stock check policy "pos" (Settings → Stock checking; default No check).
    // Block → 422 (caught below); warn → `warnings` on the response.
    const { message: stockShort } = await checkStockForSave({
      type: "pos",
      godown: POS_GODOWN,
      lines: (cartItems || []).map((item) => ({ itcd: item.itcd, qty: item.quantity })),
    });

    // POS sales account per item: category pos_acno → 'pos_sales' Account
    // Settings default. Resolved before anything is written (422 when unset).
    const { lineAcno } = await resolveItemAccounts(cartItems, 5);
    const itemsWithCategory = cartItems.map((item) => ({
      ...item,
      categoryAcno: lineAcno[Number(item.itcd)] ?? null,
    }));

    const order = await prisma.transactionsMaster.create({
      data: {
        dated: new Date(),
        time: new Date(),
        tran_code: 5,
        godown: POS_GODOWN,
        pycd: customer,
        user_id: session?.user?.id ?? null, // Entered by — from the session, never the body
        vr_no: Math.floor(Math.random() * 1000000),
        invoice_no: `POS-${Date.now()}`,
        sync_status: "pending",
        transactions: {
          create: itemsWithCategory.map((item) => ({
            itcd: item.itcd,
            qty: item.quantity,
            rate: item.price,
            acno: item.categoryAcno,
            gross_amount: item.quantity * item.price,
            camt:item.quantity * item.price,
            narration1: `POS Sale: ${item.item}`,
          })),
        },
      },
      include: { transactions: true },
    });

    for (const item of cartItems) {
      await prisma.item.update({
        where: { itcd: item.itcd },
        data: { stock: { decrement: item.quantity }, sync_status: "pending" },
      });
    }

    const totalAmount = cartItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);


    const autoEntry = {
        tran_id: order.tran_id,
        sub_tran_id: 3,
        narration1: "Auto Entry",
        damt: totalAmount || 0,
        camt: 0,
        acno: order.pycd || null,
      };

      await prisma.transactions.create({ data: autoEntry });
      
    // Uncomment this if syncing is needed
    // await syncOrderToWooCommerce(order);

    return NextResponse.json(stockShort ? { ...order, warnings: [stockShort] } : order);
  } catch (error) {
    console.error("POST order error:", error);
    if (error?.statusCode === 422) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});
