import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { documentScopeWhere } from "@/lib/auth/documentScope";

export async function GET(req) {
  const { searchParams } = new URL(req.url);

  const tranIdParam = searchParams.get("tran_id");

  // Support both single-date (legacy) and date-range (new)
  const dateSingle = searchParams.get("date");
  const dateFrom   = searchParams.get("date_from") || dateSingle;
  const dateTo     = searchParams.get("date_to")   || dateSingle;
  const grnNoParam      = searchParams.get("grn_no");
  const dispatchNoParam = searchParams.get("dispatch_no");
  const tran_code       = parseInt(searchParams.get("tran_code"));

  // If tran_id is provided, look up a single record by primary key (skip date/tran_code validation)
  if (tranIdParam) {
    const tran_id = parseInt(tranIdParam);
    if (isNaN(tran_id)) {
      return NextResponse.json({ message: "Invalid tran_id" }, { status: 400 });
    }

    try {
      // Data scope: a return can only be made from the user's own godowns.
      const session = await getServerSession(authOptions);
      const probe = await prisma.transactionsMaster.findUnique({
        where: { tran_id },
        select: { tran_code: true },
      });
      const scopeFrags = probe ? await documentScopeWhere(session, probe.tran_code) : [];
      const transactions = await prisma.transactionsMaster.findMany({
        where: { tran_id, ...(scopeFrags.length && { AND: scopeFrags }) },
        include: {
          transactions: {
            where: { sub_tran_id: 1 },
            include: { itemDetails: true },
          },
          acno:          true,
          godownDetails: true,
        },
      });
      return NextResponse.json({ data: transactions });
    } catch (err) {
      console.error("original-for-return tran_id lookup error:", err);
      return NextResponse.json({ message: "Server error" }, { status: 500 });
    }
  }

  if ((!dateFrom && !dateTo) || !tran_code) {
    return NextResponse.json(
      { message: "Date (or date_from/date_to) and tran_code are required" },
      { status: 400 }
    );
  }

  try {
    const startDate = new Date(dateFrom);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);

    const whereClause = {
      tran_code,
      dated: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Data scope: only documents in the user's own godowns.
    const scopeFrags = await documentScopeWhere(await getServerSession(authOptions), tran_code);
    if (scopeFrags.length) whereClause.AND = scopeFrags;

    // Optional GRN / dispatch number filters
    if (grnNoParam) {
      whereClause.grn_no = parseInt(grnNoParam) || undefined;
    }
    if (dispatchNoParam) {
      whereClause.dispatch_no = parseInt(dispatchNoParam) || undefined;
    }

    const transactions = await prisma.transactionsMaster.findMany({
      where: whereClause,
      include: {
        transactions: {
          where: { sub_tran_id: 1 },
          include: { itemDetails: true },
        },
        acno:          true,
        godownDetails: true,
      },
      orderBy: { dated: "desc" },
    });

    // Add stock information for each transaction item using raw query
    const transactionsWithStock = await Promise.all(
      transactions.map(async (transaction) => {
        const transactionsWithStock = await Promise.all(
          transaction.transactions.map(async (transactionItem) => {
            let stock = 0;
            
            if (transactionItem.itcd && transaction.godown) {
              const stockResult = await prisma.$queryRaw`
                SELECT SUM(
                  CASE 
                    WHEN tm.tran_code IN (4, 10) AND tm.godown = ${transaction.godown} THEN t.qty  -- Purchase, Sale Return (add to stock)
                    WHEN tm.tran_code IN (6, 9, 5) AND tm.godown = ${transaction.godown} THEN -t.qty  -- Sale, Purchase Return (remove from stock)
                    WHEN tm.tran_code = 11 AND tm.godown = ${transaction.godown} THEN -t.qty  -- Transfer out
                    WHEN tm.tran_code = 11 AND tm.godown2 = ${transaction.godown} THEN t.qty   -- Transfer in
                    ELSE 0
                  END
                ) as stock
                FROM "Transactions" t
                JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
                WHERE t.itcd = ${transactionItem.itcd} 
                AND (tm.godown = ${transaction.godown} OR tm.godown2 = ${transaction.godown})
              `;
              
              stock = stockResult[0]?.stock || 0;
            }

            return {
              ...transactionItem,
              stock: stock
            };
          })
        );

        return {
          ...transaction,
          transactions: transactionsWithStock
        };
      })
    );

    return NextResponse.json({
      data: transactionsWithStock,
      status: 200
    });
  } catch (error) {
    console.error("Error fetching original transactions:", error);
    return NextResponse.json(
      { message: "Server error", error: error.message },
      { status: 500 }
    );
  }
}