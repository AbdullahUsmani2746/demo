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

    // Parse date limits
    let fromDate = null
    let toDate = null
    if (dateFrom) {
      fromDate = new Date(dateFrom)
      if (isNaN(fromDate.getTime())) fromDate = null
    }
    if (dateTo) {
      toDate = new Date(dateTo)
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999)
      } else {
        toDate = null
      }
    }

    // Since mfg_date can be null, query all records with their relation dates,
    // and filter them in memory to resolve correct dates.
    const qaRecords = await prisma.qualityMaster.findMany({
      include: {
        productionPlanMaster: {
          select: { dated: true }
        },
        orderMaster: {
          select: { dated: true }
        }
      }
    })

    // Group by month
    const monthWiseData = {}

    qaRecords.forEach((record) => {
      // Resolve the date using mfg_date -> productionPlanMaster.dated -> orderMaster.dated
      const resolvedDateVal = record.mfg_date || record.productionPlanMaster?.dated || record.orderMaster?.dated
      if (!resolvedDateVal) return

      const recordDate = new Date(resolvedDateVal)

      // Apply date filters in memory
      if (fromDate && recordDate < fromDate) return
      if (toDate && recordDate > toDate) return

      const monthKey = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, '0')}`
      const monthName = recordDate.toLocaleString('default', { month: 'short', year: 'numeric' })

      if (!monthWiseData[monthKey]) {
        monthWiseData[monthKey] = { month: monthName, approved: 0, total: 0 }
      }

      monthWiseData[monthKey].total += 1
      if (record.status === 'APPROVED') {
        monthWiseData[monthKey].approved += 1
      }
    })

    const monthWiseArray = Object.keys(monthWiseData)
      .sort()
      .map((key) => ({
        month: monthWiseData[key].month,
        approved: monthWiseData[key].approved,
        total: monthWiseData[key].total,
      }))

    return NextResponse.json({
      monthWise: monthWiseArray,
      debug: {
        recordCount: qaRecords.length,
        filteredCount: monthWiseArray.reduce((sum, item) => sum + item.total, 0),
      },
    })
  } catch (error) {
    console.error('Error fetching Quality Assurance graph data:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
