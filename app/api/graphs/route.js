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

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const customer = searchParams.get('customer')

    
    if (customer) {
      
    }

    const dateFilter = {}
    if (dateFrom) {
      const fromDate = new Date(dateFrom)
      if (!isNaN(fromDate.getTime())) {
        dateFilter.gte = fromDate
      }
    }
    if (dateTo) {
      const toDate = new Date(dateTo)
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999)
        dateFilter.lte = toDate
      }
    }

    const whereClause = {
      tran_code: 6,
    }

    if (Object.keys(dateFilter).length > 0) {
      whereClause.dated = dateFilter
    }

    // Handle "all" customers - aggregate data from all customers
    const isAllCustomers = customer === 'all'
    const customerAcno = customer && customer !== 'all' ? parseInt(customer) : null
    if (customerAcno) {
      whereClause.pycd = customerAcno
      
    } else if (isAllCustomers) {
      
    }

    let salesTransactions = []
    let dataSource = ''
    let isUserData = false
    let isFallbackData = false

    if (customerAcno) {
      if (userId) {
        whereClause.user_id = userId
      }

      salesTransactions = await prisma.transactionsMaster.findMany({
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

      if (salesTransactions.length > 0) {
        dataSource = customerAcno ? `TransactionsMaster.pycd=${customerAcno}` : 'TransactionsMaster.user_id'
        isUserData = !!userId
      } else if (userId) {
        const userOrders = await prisma.orderMaster.findMany({
          where: {
            userid: userId,
            order_catagory: 6,
          },
          select: {
            order_no: true,
          },
        })

        const userOrderNumbers = userOrders.map(o => o.order_no)

        if (userOrderNumbers.length > 0) {
          const orderWhereClause = {
            tran_code: 6,
            so_no: { in: userOrderNumbers },
            pycd: customerAcno,
          }

          if (Object.keys(dateFilter).length > 0) {
            orderWhereClause.dated = dateFilter
          }

          salesTransactions = await prisma.transactionsMaster.findMany({
            where: orderWhereClause,
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

          if (salesTransactions.length > 0) {
            dataSource = `OrderMaster.userid → TransactionsMaster.so_no (Customer: ${customerAcno})`
            isUserData = true
          }
        }
      }

      if (salesTransactions.length === 0) {
        const customerOnlyWhere = {
          tran_code: 6,
          pycd: customerAcno,
        }
        if (Object.keys(dateFilter).length > 0) {
          customerOnlyWhere.dated = dateFilter
        }

        salesTransactions = await prisma.transactionsMaster.findMany({
          where: customerOnlyWhere,
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

        if (salesTransactions.length > 0) {
          dataSource = `TransactionsMaster.pycd=${customerAcno} (no user filter)`
          isUserData = false
        }
      }
    } else {
      if (userId) {
        whereClause.user_id = userId
      }

      salesTransactions = await prisma.transactionsMaster.findMany({
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

      if (salesTransactions.length > 0) {
        dataSource = 'TransactionsMaster.user_id'
        isUserData = true
      } else if (userId) {
        const userOrders = await prisma.orderMaster.findMany({
          where: {
            userid: userId,
            order_catagory: 6,
          },
          select: {
            order_no: true,
          },
        })

        const userOrderNumbers = userOrders.map(o => o.order_no)

        if (userOrderNumbers.length > 0) {
          const orderWhereClause = {
            tran_code: 6,
            so_no: { in: userOrderNumbers },
          }

          if (Object.keys(dateFilter).length > 0) {
            orderWhereClause.dated = dateFilter
          }

          salesTransactions = await prisma.transactionsMaster.findMany({
            where: orderWhereClause,
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

          if (salesTransactions.length > 0) {
            dataSource = 'OrderMaster.userid → TransactionsMaster.so_no'
            isUserData = true
          }
        }
      }

      let isFallbackData = false
      if (salesTransactions.length === 0 && userId) {
        isFallbackData = true
        
        const fallbackWhere = {
          tran_code: 6,
        }
        if (Object.keys(dateFilter).length > 0) {
          fallbackWhere.dated = dateFilter
        }

        salesTransactions = await prisma.transactionsMaster.findMany({
          where: fallbackWhere,
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

        if (salesTransactions.length > 0) {
          dataSource = 'TransactionsMaster (all sales - fallback)'
          isUserData = false
        }
      }
    }

    
    
    if (customer) {
      
    }
    

    const orderNumbers = salesTransactions
      .map((t) => t.so_no)
      .filter((so) => so !== null && so !== undefined)

    let orders = []
    if (orderNumbers.length > 0) {
      orders = await prisma.orderMaster.findMany({
        where: {
          order_no: { in: orderNumbers },
        },
        select: {
          order_no: true,
          region: true,
        },
      })
    }

    const orderRegionMap = {}
    orders.forEach((order) => {
      orderRegionMap[order.order_no] = order.region || 'Unknown'
    })

    const monthWiseData = {}
    const monthRegionData = {}

    salesTransactions.forEach((transaction) => {
      if (!transaction.dated) return

      const date = new Date(transaction.dated)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const monthName = date.toLocaleString('default', { month: 'short', year: 'numeric' })

      const mainTransactions = transaction.transactions.filter((t) =>
        [1, 2].includes(t.sub_tran_id)
      )
      
      const totalQty = mainTransactions.reduce((sum, t) => sum + (t.qty || 0), 0)
      const totalAmount = mainTransactions.reduce((sum, t) => sum + (t.camt || 0), 0)
      
      if (mainTransactions.length === 0) {
        return
      }

      if (!monthWiseData[monthKey]) {
        monthWiseData[monthKey] = {
          month: monthName,
          qty: 0,
          amount: 0,
        }
      }
      monthWiseData[monthKey].qty += totalQty
      monthWiseData[monthKey].amount += totalAmount

      const region =
        transaction.so_no && orderRegionMap[transaction.so_no]
          ? orderRegionMap[transaction.so_no]
          : 'Unknown'
      if (!monthRegionData[monthKey]) {
        monthRegionData[monthKey] = {}
      }
      if (!monthRegionData[monthKey][region]) {
        monthRegionData[monthKey][region] = 0
      }
      monthRegionData[monthKey][region] += totalAmount
    })

    const monthWiseArray = Object.keys(monthWiseData)
      .sort()
      .map((key) => ({
        month: monthWiseData[key].month,
        qty: monthWiseData[key].qty,
        amount: monthWiseData[key].amount,
      }))

    const monthRegionArray = Object.keys(monthRegionData)
      .sort()
      .map((monthKey) => {
        const monthName = monthWiseData[monthKey]?.month || monthKey
        const regions = Object.keys(monthRegionData[monthKey]).map((region) => ({
          name: region,
          value: monthRegionData[monthKey][region],
        }))
        return {
          month: monthName,
          monthKey: monthKey,
          regions: regions,
        }
      })

    return NextResponse.json({
      monthWise: monthWiseArray,
      monthRegion: monthRegionArray,
      isFallbackData: isFallbackData,
      debug: {
        userId: userId,
        isUserData: isUserData,
        dataSource: dataSource,
        customer: customer || null,
        transactionCount: salesTransactions.length,
      },
    })
  } catch (error) {
    console.error('Error fetching graph data:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

