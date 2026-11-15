import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";

// A person sees the whole till's figures with report.posTransactions.view
// (Admin → Roles); otherwise only their own sales.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const userCondition = (await can(session, "report.posTransactions.view")) ? {} : { userId: session.user.id };

    // ✅ Total Sales (all pycd)
    const totalSales = await prisma.transactions.aggregate({
      _sum: { gross_amount: true },
      where: {
        transactionsMaster: {
          tran_code: 5,
          ...userCondition,
        },
      },
    });

    // ✅ Total Cash Sales
    const totalCashSales = await prisma.transactions.aggregate({
      _sum: { gross_amount: true },
      where: {
        transactionsMaster: {
          tran_code: 5,
          pycd: '0001',
          ...userCondition,
        },
      },
    });

    // ✅ Total Card Sales
    const totalCardSales = await prisma.transactions.aggregate({
      _sum: { gross_amount: true },
      where: {
        transactionsMaster: {
          tran_code: 5,
          pycd: '0003',
          ...userCondition,
        },
      },
    });

    // ✅ Transaction Count
    const transactionCount = await prisma.transactionsMaster.count({
      where: {
        tran_code: 5,
        ...userCondition,
      },
    });

    // ✅ Unique Customers - Card
    const customersCard = await prisma.transactionsMaster.count({
      where: {
        tran_code: 5,
        pycd: '0003',
        ...userCondition,
      },
    });

    // ✅ Unique Customers - Cash
    const customersCash = await prisma.transactionsMaster.count({
      where: {
        tran_code: 5,
        pycd: '0001',
        ...userCondition,
      },
    });

    return NextResponse.json({
      totalSales: totalSales._sum.gross_amount || 0,
      totalCashSales: totalCashSales._sum.gross_amount || 0,
      totalCardSales: totalCardSales._sum.gross_amount || 0,
      transactions: transactionCount,
      customersCard,
      customersCash,
    });

  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
