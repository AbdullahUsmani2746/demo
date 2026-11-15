// app/api/inventory/stock/route.ts
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // Adjust the import path based on your setup
import { getLatestOpeningPeriod, openingQtySql } from '@/lib/openingStock';
import { getPendingOutQty, reopenedRequestIds } from '@/lib/stock/pendingApprovals';

// Stock = latest Monthly Opening Stock of this godown + movements since the
// 1st of that month (same as /api/voucher/check-stock with fromOpening).
// No opening generated yet → every transaction ever, as before.

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const itcd = Number(searchParams.get('itcd'));
    const godown = Number(searchParams.get('godown'));
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)

    // Validate required parameters
    if (!itcd || !godown) {
      return NextResponse.json(
        { error: 'Missing required parameters: itcd and godown' },
        { status: 400 }
      );
    }

    // Item category (4 = PACKAGING-MATERIAL) — the production stock check
    // (components/Material/Production/useStockValidation.js) skips packing material.
    const itemRow = await prisma.item.findUnique({
      where: { itcd },
      select: { ic_id: true, itemCategories: { select: { ic_name: true } } },
    });
    const category = itemRow?.itemCategories?.ic_name || "";
    const categoryId = itemRow?.ic_id ?? null;

    // Qty held by vouchers pending approval (lib/stock/pendingApprovals.js)
    // is not available: stock returned = posted − pending OUT.
    const pendingOut =
      (await getPendingOutQty([itcd], godown, { excludeRequestIds: reopenedRequestIds(request) })).get(itcd) || 0;

    const period = await getLatestOpeningPeriod(new Date());
    if (period) {
      const periodStart = new Date(period.year, period.month - 1, 1, 0, 0, 0, 0);
      const rows = await prisma.$queryRaw`
        SELECT
          COALESCE((
            SELECT o.opening_qty
            FROM (${openingQtySql(period.month, period.year, { godown })}) o
            WHERE o.itcd = ${itcd}
          ), 0)::float
          +
          COALESCE((
            SELECT SUM(
              CASE
                WHEN tm.tran_code IN (4, 10, 12, 8) AND tm.godown = ${godown} THEN t.qty
                WHEN tm.tran_code IN (6, 9, 5, 7) AND tm.godown = ${godown} THEN -t.qty
                WHEN tm.tran_code = 11 AND tm.godown = ${godown} THEN -t.qty
                WHEN tm.tran_code = 11 AND tm.godown2 = ${godown} THEN t.qty
                ELSE 0
              END
            )
            FROM "Transactions" t
            JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
            WHERE t.itcd = ${itcd}
              AND COALESCE(t.sub_tran_id, 1) <> 3
              AND (tm.godown = ${godown} OR tm.godown2 = ${godown})
              AND tm.dated >= ${periodStart}
              AND tm.dated <= ${endOfToday}
          ), 0)::float AS stock
      `;
      return NextResponse.json({
        stock: ((Number(rows[0]?.stock) || 0) - pendingOut).toFixed(2), // Return stock with 2 decimal places
        pendingApproval: pendingOut,
        category,
        categoryId,
      });
    }

    const stock = await prisma.$queryRaw`
      SELECT SUM(
        CASE 
          WHEN tm.tran_code IN (4, 10, 12,8) AND tm.godown = ${godown} THEN t.qty  -- Purchase, Sale Return, produced (add to stock)
          WHEN tm.tran_code IN (6, 9, 5,7) AND tm.godown = ${godown} THEN -t.qty  -- Sale, Purchase Return, issued (remove from stock)
          WHEN tm.tran_code = 11 AND tm.godown = ${godown} THEN -t.qty  -- Transfer out
          WHEN tm.tran_code = 11 AND tm.godown2 = ${godown} THEN t.qty   -- Transfer in
          ELSE 0
        END
      ) as stock
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      WHERE t.itcd = ${itcd} 
      AND (tm.godown = ${godown} OR tm.godown2 = ${godown})
      AND tm.dated <= ${endOfToday}

    `;
    
    const availableStock = Number(stock[0]?.stock || 0) - pendingOut;
    return NextResponse.json({ 
      stock: availableStock.toFixed(2), // Return stock with 2 decimal places
      pendingApproval: pendingOut,
      category,
      categoryId,
    });

  } catch (error) {
    console.error('Stock check error:', error);
    return NextResponse.json(
      { error: 'Failed to check stock' },
      { status: 500 }
    );
  }
}