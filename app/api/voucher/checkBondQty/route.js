import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Ex-Bond GRN quantity check — mirrors checkOrderQty's PO branch, but the
// "ordered" quantity comes from InboundDetail (what's sitting in bond)
// instead of OrderDetail, and "received" is summed from GRN (tran_code=4)
// transactions already posted against this bond_id.
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const bond_id = url.searchParams.get("bond_id");

    if (!bond_id) {
      return NextResponse.json(
        { error: "Please provide bond_id" },
        { status: 400 }
      );
    }

    const inbound = await prisma.inboundMaster.findUnique({
      where: { bond_id },
      include: { details: true },
    });

    if (!inbound) {
      return NextResponse.json(
        { error: "In-Bond entry not found" },
        { status: 404 }
      );
    }

    // 1️⃣ Bonded qty per item (what's available to release)
    let totalOrderedQty = 0;
    let orderedItemWiseQty = {};
    for (const d of inbound.details) {
      const qty = d.qty || 0;
      totalOrderedQty += qty;
      if (!orderedItemWiseQty[d.itcd]) orderedItemWiseQty[d.itcd] = 0;
      orderedItemWiseQty[d.itcd] += qty;
    }

    // 2️⃣ Already-received qty per item (from prior GRNs against this bond)
    const vouchers = await prisma.transactionsMaster.findMany({
      where: { tran_code: 4, bond_id },
      include: { transactions: true },
    });

    let totalQty = 0;
    let itemWiseQty = {};
    for (const voucher of vouchers) {
      for (const t of voucher.transactions) {
        if (t.qty) {
          totalQty += t.qty;
          if (!itemWiseQty[t.itcd]) itemWiseQty[t.itcd] = 0;
          itemWiseQty[t.itcd] += t.qty;
        }
      }
    }

    // 3️⃣ Balance per item
    let balanceItemWiseQty = {};
    for (const itcd in orderedItemWiseQty) {
      const ordered = orderedItemWiseQty[itcd] || 0;
      const received = itemWiseQty[itcd] || 0;
      balanceItemWiseQty[itcd] = ordered - received;
    }

    return NextResponse.json({
      type: "BOND",
      bond_id,
      summary: {
        totalQty,
        itemWiseQty,
        totalOrderedQty,
        orderedItemWiseQty,
        balanceItemWiseQty,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}
