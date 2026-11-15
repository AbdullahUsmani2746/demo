import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const itemParam = searchParams.get('item') // itcd value or 'all'

    // Build date filter
    const dateFilter = {}
    if (dateFrom) {
      const fromDate = new Date(dateFrom)
      if (!isNaN(fromDate.getTime())) dateFilter.gte = fromDate
    }
    if (dateTo) {
      const toDate = new Date(dateTo)
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999)
        dateFilter.lte = toDate
      }
    }

    // tran_code 8 = Material Produced
    const whereClause = {
      tran_code: 8,
    }
    if (Object.keys(dateFilter).length > 0) {
      whereClause.dated = dateFilter
    }

    // Item filter on transaction level (by itcd)
    const transactionItemFilter = {}
    if (itemParam && itemParam !== 'all' && itemParam !== 'null' && itemParam !== '') {
      const itcdNum = parseInt(itemParam)
      if (!isNaN(itcdNum)) {
        transactionItemFilter.itcd = itcdNum
      }
    }

    const productionTransactions = await prisma.transactionsMaster.findMany({
      where: whereClause,
      include: {
        transactions: {
          where: Object.keys(transactionItemFilter).length > 0 ? transactionItemFilter : undefined,
          include: {
            itemDetails: true,
          },
        },
      },
      orderBy: {
        dated: 'asc',
      },
    })

    // ---------- Month-wise aggregation ----------
    const monthWiseData = {}
    const monthItemData = {}

    productionTransactions.forEach((transaction) => {
      if (!transaction.dated) return
      if (!transaction.transactions || transaction.transactions.length === 0) return

      const date = new Date(transaction.dated)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const monthName = date.toLocaleString('default', { month: 'short', year: 'numeric' })

      const txLines = transaction.transactions
      const totalQty = txLines.reduce((sum, t) => sum + (parseFloat(t.qty) || 0), 0)
      const totalAmount = txLines.reduce(
        (sum, t) => sum + (parseFloat(t.damt) || 0) + (parseFloat(t.camt) || 0),
        0
      )

      // Month-wise totals
      if (!monthWiseData[monthKey]) {
        monthWiseData[monthKey] = { month: monthName, qty: 0, amount: 0 }
      }
      monthWiseData[monthKey].qty += totalQty
      monthWiseData[monthKey].amount += totalAmount

      // Month-wise by item breakdown
      if (!monthItemData[monthKey]) {
        monthItemData[monthKey] = {}
      }
      txLines.forEach((t) => {
        const itemName = t.itemDetails?.item || 'Unknown'
        const itemId = t.itcd != null ? String(t.itcd) : itemName
        if (!monthItemData[monthKey][itemId]) {
          monthItemData[monthKey][itemId] = { name: itemName, qty: 0, amount: 0 }
        }
        monthItemData[monthKey][itemId].qty += parseFloat(t.qty) || 0
        monthItemData[monthKey][itemId].amount +=
          (parseFloat(t.damt) || 0) + (parseFloat(t.camt) || 0)
      })
    })

    const monthWiseArray = Object.keys(monthWiseData)
      .sort()
      .map((key) => ({
        month: monthWiseData[key].month,
        qty: monthWiseData[key].qty,
        amount: monthWiseData[key].amount,
      }))

    const monthItemArray = Object.keys(monthItemData)
      .sort()
      .map((monthKey) => {
        const monthName = monthWiseData[monthKey]?.month || monthKey
        const items = Object.values(monthItemData[monthKey]).sort((a, b) => b.qty - a.qty)
        return {
          month: monthName,
          monthKey,
          items,
        }
      })

    return NextResponse.json({
      monthWise: monthWiseArray,
      monthItem: monthItemArray,
      debug: {
        transactionCount: productionTransactions.length,
      },
    })
  } catch (error) {
    console.error('Error fetching production graph data:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
