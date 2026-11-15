import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  try {
    const url = new URL(req.url);

    const po_no = url.searchParams.get("po_no");
    const grn_no = url.searchParams.get("grn_no");

    const so_no = url.searchParams.get("so_no");
    const dispatch_no = url.searchParams.get("dispatch_no");

    const req_no = url.searchParams.get("req_no");

    // ---------------------------------------------------------------------
    // 1️⃣ CASE 1 — Check PO/SO Quantities (your existing logic)
    // ---------------------------------------------------------------------
    if (po_no && grn_no || so_no && dispatch_no) {
      const vouchers = await prisma.transactionsMaster.findMany({
        where: {
          ...(po_no ? { tran_code: 9, po_no: Number(po_no), grn_no: Number(grn_no) } : {}),
          ...(so_no ? { tran_code: 10, so_no: Number(so_no), dispatch_no: Number(dispatch_no) } : {}),
        },
        include: {
          transactions: true,
        },
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

      return NextResponse.json({
        type: "PO/SO",
        summary: {
          totalQty,
          itemWiseQty,
        },
      });
    }

    // ---------------------------------------------------------------------
    // 2️⃣ CASE 2 — Check Requirement (GIN Order: ReqMaster + ReqDetail)
    // ---------------------------------------------------------------------

    if (req_no) {
      // 1️⃣ Find Purchase/Sales Order using req_no
      const orderMaster = await prisma.orderMaster.findFirst({
        where: { req_no: Number(req_no) },
        include: {
          orderDetails: true, // Required qty
        },
      });

      if (!orderMaster) {
        return NextResponse.json(
          { error: "No OrderMaster found for this req_no" },
          { status: 404 }
        );
      }

      // 👉 Total Required Qty (from OrderDetail)
      let totalReceived = 0;
      let itemWiseRequired = {};

      for (const d of orderMaster.orderDetails) {
        const qty = d.qty || 0;
        totalReceived += qty;

        if (!itemWiseRequired[d.itcd]) itemWiseRequired[d.itcd] = 0;
        itemWiseRequired[d.itcd] += qty;
      }

      // 2️⃣ Get ReqMaster + ReqDetail (Issued Qty)
      const reqMaster = await prisma.reqMaster.findUnique({
        where: { tran_id: Number(req_no) },
        include: { details: true },
      });

      if (!reqMaster) {
        return NextResponse.json(
          { error: "Requisition not found in ReqMaster" },
          { status: 404 }
        );
      }

      // 👉 Total Issued Qty (from ReqDetail)
      let totalIssued = 0;
      let itemWiseIssued = {};

      for (const d of reqMaster.details) {
        const qty = d.qty || 0;
        totalIssued += qty;

        if (!itemWiseIssued[d.itcd]) itemWiseIssued[d.itcd] = 0;
        itemWiseIssued[d.itcd] += qty;
      }

      return NextResponse.json({
        type: "REQUISITION",
        req_no,
        required: {
          totalReceived,
          itemWiseRequired,
        },
        issued: {
          totalIssued,
          itemWiseIssued,
        },
        status: totalIssued <= totalReceived ? "Fully Issued" : "Pending",
        allowEdit: totalIssued > totalReceived,
        details: `Issued: ${totalIssued} / Required: ${totalReceived}`,
      });
    }

    // ---------------------------------------------------------------------
    // If no valid params
    // ---------------------------------------------------------------------
    return NextResponse.json(
      { error: "Please provide po_no, so_no, or req_no" },
      { status: 400 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}
