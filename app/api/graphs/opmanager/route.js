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

    const whereClause = {}
    if (Object.keys(dateFilter).length > 0) {
      whereClause.dated = dateFilter
    }

    const plans = await prisma.productionPlanMaster.findMany({
      where: whereClause,
      orderBy: {
        dated: 'asc',
      },
    })

    // Group by month
    const monthWiseData = {}

    plans.forEach((plan) => {
      if (!plan.dated) return
      
      const date = new Date(plan.dated)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const monthName = date.toLocaleString('default', { month: 'short', year: 'numeric' })

      const targetQty = parseFloat(plan.qty) || 0
      const actualQty = parseFloat(plan.actual_yield) || 0

      if (!monthWiseData[monthKey]) {
        monthWiseData[monthKey] = { month: monthName, targetQty: 0, actualQty: 0 }
      }

      monthWiseData[monthKey].targetQty += targetQty
      monthWiseData[monthKey].actualQty += actualQty
    })

    const monthWiseArray = Object.keys(monthWiseData)
      .sort()
      .map((key) => ({
        month: monthWiseData[key].month,
        targetQty: monthWiseData[key].targetQty,
        actualQty: monthWiseData[key].actualQty,
      }))

    return NextResponse.json({
      monthWise: monthWiseArray,
      debug: {
        recordCount: plans.length,
      },
    })
  } catch (error) {
    console.error('Error fetching OpManager graph data:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
