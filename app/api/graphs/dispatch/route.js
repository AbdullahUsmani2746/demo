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

    const whereClause = {
      dispatch_no: { not: null }
    }
    if (Object.keys(dateFilter).length > 0) {
      whereClause.dated = dateFilter
    }

    const dispatchTransactions = await prisma.transactionsMaster.findMany({
      where: whereClause,
      include: {
        transactions: {
          where: {
            sub_tran_id: { in: [1, 2] },
          },
        },
      },
      orderBy: {
        dated: 'asc',
      },
    })

    // Group by month
    const monthWiseData = {}

    dispatchTransactions.forEach((transaction) => {
      if (!transaction.dated) return
      
      const date = new Date(transaction.dated)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const monthName = date.toLocaleString('default', { month: 'short', year: 'numeric' })

      const txLines = transaction.transactions || []
      const totalQty = txLines.reduce((sum, t) => sum + (parseFloat(t.qty) || 0), 0)

      if (!monthWiseData[monthKey]) {
        monthWiseData[monthKey] = { month: monthName, qty: 0, count: 0 }
      }

      monthWiseData[monthKey].qty += totalQty
      monthWiseData[monthKey].count += 1
    })

    const monthWiseArray = Object.keys(monthWiseData)
      .sort()
      .map((key) => ({
        month: monthWiseData[key].month,
        qty: monthWiseData[key].qty,
        count: monthWiseData[key].count,
      }))

    return NextResponse.json({
      monthWise: monthWiseArray,
      debug: {
        recordCount: dispatchTransactions.length,
      },
    })
  } catch (error) {
    console.error('Error fetching Dispatch graph data:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
