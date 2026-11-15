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
      tran_code: { in: [1, 2] }, // Receipt=1, Payment=2
    }
    if (Object.keys(dateFilter).length > 0) {
      whereClause.dated = dateFilter
    }

    const financeTransactions = await prisma.transactionsMaster.findMany({
      where: whereClause,
      include: {
        transactions: {
          where: {
            sub_tran_id: 1, // Look at primary debit/credit entry
          },
        },
      },
      orderBy: {
        dated: 'asc',
      },
    })

    // Group by month
    const monthWiseData = {}

    financeTransactions.forEach((transaction) => {
      if (!transaction.dated) return
      
      const date = new Date(transaction.dated)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const monthName = date.toLocaleString('default', { month: 'short', year: 'numeric' })

      const txLines = transaction.transactions || []
      const totalAmount = txLines.reduce((sum, t) => {
        if (transaction.tran_code === 1) {
          // Receipt: credit entry amount
          return sum + (parseFloat(t.camt) || 0)
        } else {
          // Payment: debit entry amount
          return sum + (parseFloat(t.damt) || 0)
        }
      }, 0)

      if (!monthWiseData[monthKey]) {
        monthWiseData[monthKey] = { month: monthName, receipts: 0, payments: 0 }
      }

      if (transaction.tran_code === 1) {
        monthWiseData[monthKey].receipts += totalAmount
      } else {
        monthWiseData[monthKey].payments += totalAmount
      }
    })

    const monthWiseArray = Object.keys(monthWiseData)
      .sort()
      .map((key) => ({
        month: monthWiseData[key].month,
        receipts: monthWiseData[key].receipts,
        payments: monthWiseData[key].payments,
      }))

    return NextResponse.json({
      monthWise: monthWiseArray,
      debug: {
        recordCount: financeTransactions.length,
      },
    })
  } catch (error) {
    console.error('Error fetching Finance graph data:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
