import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

export const POST = guard("qualityControl.manage", async (request, context) => {
  try {
    const params = await context.params;
    const order_no = parseInt(params.order_no);

    const body = await request.json();
    const { itcd, batch_no, mfg_date, expiry_date } = body;

    if (!order_no || !itcd || !batch_no) {
      return NextResponse.json(
        { error: "Order number, ITCD, and batch number are required" },
        { status: 400 }
      );
    }

    // Validate batch number format
    const batchNoInt = parseInt(batch_no);
    if (isNaN(batchNoInt)) {
      return NextResponse.json(
        { error: "Batch number must be a valid number" },
        { status: 400 }
      );
    }

    // Check for duplicate batch number
    const existingBatch = await prisma.qualityMaster.findFirst({
      where: {
        batch_no: batchNoInt,
        order_no: { not: order_no },
        status: "APPROVED",
      },
    });

    if (existingBatch) {
      return NextResponse.json(
        { error: "Batch number already exists in another approved QC" },
        { status: 400 }
      );
    }

    // Get order detail for batch size
    const orderDetail = await prisma.orderDetail.findFirst({
      where: {
        order_no,
        itcd: parseInt(itcd),
      },
      select: { qty: true },
    });

    const batchSize = orderDetail?.qty || 0;

    // Update or create quality master with batch info
    await prisma.qualityMaster.upsert({
      where: {
        order_no_itcd: {
          // This should match the composite key name in your schema
          order_no: order_no,
          itcd: parseInt(itcd),
        },
      },
      update: {
        itcd: parseInt(itcd),
        batch_size: batchSize,
        batch_no: batchNoInt,
        mfg_date: mfg_date ? new Date(mfg_date) : null,
        expiry_date: expiry_date ? new Date(expiry_date) : null,
      },
      create: {
        order_no,
        itcd: parseInt(itcd),
        batch_size: batchSize,
        batch_no: batchNoInt,
        mfg_date: mfg_date ? new Date(mfg_date) : null,
        expiry_date: expiry_date ? new Date(expiry_date) : null,
        status: "DRAFT",
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Batch information saved successfully",
      batch_no: batchNoInt,
    });
  } catch (error) {
    console.error("Error saving batch information:", error);
    return NextResponse.json(
      { error: "Failed to save batch information", details: error.message },
      { status: 500 }
    );
  }
});
