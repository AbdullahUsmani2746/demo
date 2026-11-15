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

    const whereClause = {}
    if (Object.keys(dateFilter).length > 0) {
      whereClause.mfg_date = dateFilter
    }

    // Item filter
    if (itemParam && itemParam !== 'all' && itemParam !== 'null' && itemParam !== '') {
      const itcdNum = parseInt(itemParam)
      if (!isNaN(itcdNum)) {
        whereClause.itcd = itcdNum
      }
    }

    // 1. Fetch QualityMaster records
    const qcRecords = await prisma.qualityMaster.findMany({
      where: whereClause,
      include: {
        item: true,
        productionPlanMaster: {
          select: {
            qty: true,
            actual_yield: true,
          },
        },
        orderMaster: {
          include: {
            orderDetails: {
              select: {
                itcd: true,
                qty: true,
              },
            },
          },
        },
        details: {
          orderBy: {
            attempt_date: 'asc',
          },
          take: 1,
        },
      },
      orderBy: {
        mfg_date: 'asc',
      },
    })

    // 2. Fetch latest rates from Transactions in bulk
    const latestRatesRaw = await prisma.transactions.findMany({
      where: {
        rate: { gt: 0 },
      },
      orderBy: {
        tran_id: 'desc',
      },
      select: {
        itcd: true,
        rate: true,
      },
    })

    const itemRateMap = new Map()
    for (const tx of latestRatesRaw) {
      if (!itemRateMap.has(tx.itcd)) {
        itemRateMap.set(tx.itcd, tx.rate)
      }
    }

    // 3. Fetch latest rates from OrderDetail in bulk
    const orderDetailsRaw = await prisma.orderDetail.findMany({
      where: {
        rate: { gt: 0 },
      },
      orderBy: {
        id: 'desc',
      },
      select: {
        itcd: true,
        rate: true,
      },
    })

    const orderRateMap = new Map()
    for (const detail of orderDetailsRaw) {
      if (detail.itcd && !orderRateMap.has(detail.itcd)) {
        orderRateMap.set(detail.itcd, detail.rate)
      }
    }

    // 4. Perform aggregation
    const monthWiseData = {}
    const monthItemData = {}

    qcRecords.forEach((record) => {
      // Fallback date if mfg_date is null
      const dateVal = record.mfg_date || (record.details && record.details[0]?.attempt_date)
      if (!dateVal) return

      const date = new Date(dateVal)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const monthName = date.toLocaleString('default', { month: 'short', year: 'numeric' })

      // Quantity resolution
      let qty = parseFloat(record.batch_size) || 0
      if (qty === 0) {
        if (record.productionPlanMaster) {
          qty =
            parseFloat(record.productionPlanMaster.actual_yield) ||
            parseFloat(record.productionPlanMaster.qty) ||
            0
        } else if (record.orderMaster && record.orderMaster.orderDetails) {
          const orderItem = record.orderMaster.orderDetails.find((d) => d.itcd === record.itcd)
          if (orderItem) {
            qty = parseFloat(orderItem.qty) || 0
          }
        }
      }

      // Rate resolution
      const itcd = record.itcd
      const rate = itemRateMap.get(itcd) || orderRateMap.get(itcd) || record.item?.price || 0
      const amount = qty * rate

      // Month-wise totals
      if (!monthWiseData[monthKey]) {
        monthWiseData[monthKey] = { month: monthName, qty: 0, amount: 0 }
      }
      monthWiseData[monthKey].qty += qty
      monthWiseData[monthKey].amount += amount

      // Month-wise by item breakdown
      if (!monthItemData[monthKey]) {
        monthItemData[monthKey] = {}
      }
      const itemName = record.item?.item || 'Unknown'
      const itemId = String(itcd)

      if (!monthItemData[monthKey][itemId]) {
        monthItemData[monthKey][itemId] = { name: itemName, qty: 0, amount: 0 }
      }
      monthItemData[monthKey][itemId].qty += qty
      monthItemData[monthKey][itemId].amount += amount
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
        recordCount: qcRecords.length,
      },
    })
  } catch (error) {
    console.error('Error fetching lab graph data:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

