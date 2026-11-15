import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  const url = new URL(req.url);


  const req_no = url.searchParams.get("req_no");


  // 🔍 Step 1: Fetch all vouchers with matching PO or SO
  const vouchers = await prisma.transactionsMaster.findMany({
    where: {
        tran_code: 11,
      ...(req_no && { req_no: Number(req_no) }),
    },
    include: {

      // Include item transactions
      transactions: true
      },

  });

  // ❗ Fix: return vouchers instead of undefined 'data'
  const data = vouchers;

  // =======================
  // 🔥 Step 2: Calculate Qty Summary
  // =======================

  let totalQty = 0;
  let itemWiseQty = {};

  for (const voucher of vouchers) {
    for (const t of voucher.transactions) {
      if (t.qty) {
        totalQty += t.qty;

        // Item-wise breakdown
        if (!itemWiseQty[t.itcd]) itemWiseQty[t.itcd] = 0;
        itemWiseQty[t.itcd] += t.qty;
      }
    }
  }

  const summary = {
    totalQty,
    itemWiseQty,
  };

  // ===============================
  // 🔥 Final Output JSON
  // ===============================
  return NextResponse.json({
    summary,
  });
}
