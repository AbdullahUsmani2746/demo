import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  try {
    const url = new URL(req.url);

    const po_no = url.searchParams.get("po_no");
    const so_no = url.searchParams.get("so_no");
    const req_no = url.searchParams.get("req_no");

   // ---------------------------------------------------------------------
// CASE 1 — Check PO/SO Quantities + QC Status with Batch-Based Approval
// ---------------------------------------------------------------------
if (po_no || so_no) {
  // 1️⃣ Fetch the original Order (PO/SO) to get ordered quantities per item
  const order_no = po_no ? Number(po_no) : Number(so_no);
  const order_catagory = po_no ? 4 : 6; // 4 = PO, 6 = SO

  const orderMaster = await prisma.orderMaster.findFirst({
    where: { order_no, order_catagory },
    include: {
      orderDetails: {
        include: { items: { select: { item: true } } },
      },
    },
  });

  // Build ordered qty per item from SO/PO
  let totalOrderedQty = 0;
  let orderedItemWiseQty = {};
  if (orderMaster) {
    for (const d of orderMaster.orderDetails) {
      const qty = d.qty || 0;
      totalOrderedQty += qty;
      if (!orderedItemWiseQty[d.itcd]) orderedItemWiseQty[d.itcd] = 0;
      orderedItemWiseQty[d.itcd] += qty;
    }
  }

  // 2️⃣ Fetch vouchers (GRN for PO / Dispatches for SO)
  const vouchers = await prisma.transactionsMaster.findMany({
    where: {
      ...(po_no ? { tran_code: 4, po_no: Number(po_no) } : {}),
      ...(so_no ? { tran_code: 6, so_no: Number(so_no) } : {}),
    },
    include: {
      transactions: true,
    },
  });

  // 3️⃣ Calculate dispatched/received quantities per item
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

  // 4️⃣ Calculate balance (available) per item
  let balanceItemWiseQty = {};
  for (const itcd in orderedItemWiseQty) {
    const ordered = orderedItemWiseQty[itcd] || 0;
    const dispatched = itemWiseQty[itcd] || 0;
    balanceItemWiseQty[itcd] = ordered - dispatched;
  }

  // 5️⃣ Fetch QC records (reuse order_no from step 1)
  const qualityMasters = await prisma.qualityMaster.findMany({
    where: { order_no },
    select: {
      itcd: true,
      status: true,
      batch_no: true,
      batch_size: true, // New: quantity approved in this batch
    },
  });

  // 4️⃣ Build item-wise QC summary
  const qcStatus = {};
  let overallQCStatus = "DRAFT";

  for (const qm of qualityMasters) {
    if (!qcStatus[qm.itcd])
      qcStatus[qm.itcd] = { approvedQty: 0, status: "DRAFT", batches: [] };

    qcStatus[qm.itcd].batches.push({
      batch_no: qm.batch_no,
      status: qm.status,
      batch_size: qm.batch_size,
    });

    if (qm.status === "APPROVED") {
      qcStatus[qm.itcd].approvedQty += qm.batch_size;
    }
  }

  // 5️⃣ Determine item-wise status based on approved quantity
  for (const itcd in qcStatus) {
    const approvedQty = qcStatus[itcd].approvedQty;
    const requiredQty = itemWiseQty[itcd] || 0;

    if (approvedQty === 0) qcStatus[itcd].status = "PENDING";
    else if (approvedQty < requiredQty) qcStatus[itcd].status = "PARTIALLY_APPROVED";
    else qcStatus[itcd].status = "FULLY_APPROVED";
  }

  // 6️⃣ Determine overall QC status
  const allItems = Object.values(qcStatus);

  if (allItems.length === 0) overallQCStatus = "DRAFT";
  else if (allItems.every((i) => i.status === "FULLY_APPROVED")) overallQCStatus = "ALL_APPROVED";
  else if (allItems.every((i) => i.status === "PENDING")) overallQCStatus = "ALL_PENDING";
  else overallQCStatus = "PARTIALLY_APPROVED";

  // 8️⃣ Return JSON
  return NextResponse.json({
    type: "PO/SO",
    summary: {
      totalQty,
      itemWiseQty,
      totalOrderedQty,
      orderedItemWiseQty,
      balanceItemWiseQty,
      status: orderMaster.status
    },
    qc_summary: {
      overall_status: overallQCStatus,
      item_status: qcStatus,
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