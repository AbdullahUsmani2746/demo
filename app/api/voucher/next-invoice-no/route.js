import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const tran_code = parseInt(url.searchParams.get("tran_code"));

    if (!tran_code) {
      return NextResponse.json({ message: "tran_code is required" }, { status: 400 });
    }

    try {
      // PostgreSQL compatible query - Get the highest numeric invoice_no
      const result = await prisma.$queryRaw`
        SELECT *
        FROM "TRANSACTIONS_MASTER"
        WHERE tran_code = ${tran_code}
          AND invoice_no IS NOT NULL
          AND invoice_no != ''
        ORDER BY CAST(invoice_no AS INTEGER) DESC
        LIMIT 1
      `;

      let maxInvoiceNo = 0;
      let lastInvoiceNo = null;
      
      if (result && result[0] && result[0].invoice_no) {
        const parsed = parseInt(result[0].invoice_no);
        if (!isNaN(parsed)) {
          maxInvoiceNo = parsed;
          lastInvoiceNo = result[0].invoice_no;
        }
      }

      const nextInvoiceNo = maxInvoiceNo + 1;

      return NextResponse.json({ 
        nextInvoiceNo, 
        // maxInvoiceNo: maxInvoiceNo > 0 ? maxInvoiceNo : null,
        // lastInvoiceNo: lastInvoiceNo,
      });
    } catch (dbError) {
      console.error("Database query error:", dbError);
      
      // Fallback to Prisma ORM method
      // return await fallbackMethod(tran_code);
    }
  } catch (error) {
    console.error("❌ Error fetching next invoice number:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

async function fallbackMethod(tran_code) {
  try {
    // Get all invoice numbers for this tran_code
    const vouchers = await prisma.transactionsMaster.findMany({
      where: {
        tran_code,
        invoice_no: {
          not: null,
          not: ""
        }
      },
      select: {
        invoice_no: true,
      },
      // You cannot order by invoice_no directly if it's a string with numbers
      // because "10" would come before "2" in string comparison
      // So we need to fetch all and sort in memory
    });

    let maxInvoiceNo = 0;
    let lastInvoiceNo = null;
    
    // First pass: find the highest numeric invoice number
    vouchers.forEach(voucher => {
      if (voucher.invoice_no && /^\d+$/.test(voucher.invoice_no)) {
        const num = parseInt(voucher.invoice_no);
        if (!isNaN(num) && num > maxInvoiceNo) {
          maxInvoiceNo = num;
          lastInvoiceNo = voucher.invoice_no;
        }
      }
    });

    const nextInvoiceNo = maxInvoiceNo + 1;

    return NextResponse.json({ 
      nextInvoiceNo, 
      maxInvoiceNo: maxInvoiceNo > 0 ? maxInvoiceNo : null,
      lastInvoiceNo: lastInvoiceNo
    });
  } catch (error) {
    console.error("Fallback method error:", error);
    throw error;
  }
}