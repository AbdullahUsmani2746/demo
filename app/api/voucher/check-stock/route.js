// /api/voucher/check-stock/route.js
import { NextResponse } from 'next/server'
import prisma from "@/lib/prisma";
import { getLatestOpeningPeriod, openingQtySql } from "@/lib/openingStock";
import { getPendingOutQty, reopenedRequestIds } from "@/lib/stock/pendingApprovals";

export async function POST(req) {
  try {
    // fromOpening (optional, used by Create Dispatch): stock = latest Monthly
    // Opening Stock of this godown + movements since the 1st of that month.

    const body = await req.json()
    const { productIds, godown, fromOpening } = body

    // If you want to check if godown is an empty object, use:
    if (!productIds || !Array.isArray(productIds)) {
      return NextResponse.json(
        { message: 'Missing or invalid product IDs' }, 
        { status: 400 }
      )
    }

    if (!godown) {
      return NextResponse.json(
        { message: 'Missing required parameter: godown' }, 
        { status: 400 }
      )
    }


    // Get current stock for all requested products using the new calculation method
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)

    // Opening period to roll forward from (only when asked for). No period
    // generated yet → falls back to the old calculation below.
    const period = fromOpening ? await getLatestOpeningPeriod(new Date()) : null
    const periodStart = period ? new Date(period.year, period.month - 1, 1, 0, 0, 0, 0) : null

    const stockLevels = {}

    for (const productId of productIds) {
      const newGodown = godown?.value ? Number(godown?.value) : Number(godown)

      const itcd = parseInt(productId?.value ? productId?.value : productId)

      if (period) {
        const rows = await prisma.$queryRaw`
          SELECT
            COALESCE((
              SELECT o.opening_qty
              FROM (${openingQtySql(period.month, period.year, { godown: newGodown })}) o
              WHERE o.itcd = ${itcd}
            ), 0)::float
            +
            COALESCE((
              SELECT SUM(
                CASE
                  WHEN tm.tran_code IN (4, 10, 12, 8) AND tm.godown = ${newGodown} THEN t.qty
                  WHEN tm.tran_code IN (6, 9, 5, 7) AND tm.godown = ${newGodown} THEN -t.qty
                  WHEN tm.tran_code = 11 AND tm.godown = ${newGodown} THEN -t.qty
                  WHEN tm.tran_code = 11 AND tm.godown2 = ${newGodown} THEN t.qty
                  ELSE 0
                END
              )
              FROM "Transactions" t
              JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
              WHERE t.itcd = ${itcd}
                AND COALESCE(t.sub_tran_id, 1) <> 3
                AND (tm.godown = ${newGodown} OR tm.godown2 = ${newGodown})
                AND tm.dated >= ${periodStart}
                AND tm.dated <= ${endOfToday}
            ), 0)::float AS stock
        `
        stockLevels[itcd] = Number(rows[0]?.stock) || 0
        continue
      }

      const stock = await prisma.$queryRaw`
        SELECT SUM(
          CASE
            WHEN tm.tran_code IN (4, 10, 12, 8) AND tm.godown = ${newGodown} THEN t.qty  -- Purchase, Sale Return (add to stock)
            WHEN tm.tran_code IN (6, 9, 5, 7) AND tm.godown = ${newGodown} THEN -t.qty  -- Sale, Purchase Return (remove from stock)
            WHEN tm.tran_code = 11 AND tm.godown = ${newGodown} THEN -t.qty  -- Transfer out
            WHEN tm.tran_code = 11 AND tm.godown2 = ${newGodown} THEN t.qty   -- Transfer in
            ELSE 0
          END
        ) as stock
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE t.itcd = ${itcd}
        AND (tm.godown = ${newGodown} OR tm.godown2 = ${newGodown})
        AND tm.dated <= ${endOfToday}
      `
      
      stockLevels[itcd] = stock[0]?.stock || 0
    }

    // Available = posted stock − qty held by vouchers pending approval
    // (lib/stock/pendingApprovals.js) — a request re-opened by its own
    // requester does not hold stock against itself.
    const pendingOut = await getPendingOutQty(
      Object.keys(stockLevels).map(Number),
      godown?.value ? Number(godown.value) : Number(godown),
      { excludeRequestIds: reopenedRequestIds(req, body) },
    )
    for (const [itcd, qty] of pendingOut) {
      if (qty) stockLevels[itcd] = (Number(stockLevels[itcd]) || 0) - qty
    }

    return NextResponse.json(stockLevels)
  } catch (error) {
    console.error('Stock check error:', error)
    return NextResponse.json(
      { message: error.message || 'Failed to fetch stock levels' },
      { status: 500 }
    )
  }
}