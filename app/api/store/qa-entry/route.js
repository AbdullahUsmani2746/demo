import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  buildOrderQcBarcode,
  buildQaBarcode,
} from "@/lib/orderQualityBarcode.js";
import { guard } from "@/lib/auth/route";

export const POST = guard("qualityControl.manage", async (request) => {
  try {
    const body = await request.json();
    const {
      order_no,
      itcd,
      batch_no,
      mfg_date,
      expiry_date,
      received_qty,
      remarks
    } = body;

    // Validation
    if (!order_no || !itcd) {
      return NextResponse.json(
        { 
          ok: false,
          error: "Order number and ITCD are required" 
        },
        { status: 400 }
      );
    }

    if (!received_qty || parseFloat(received_qty) <= 0) {
      return NextResponse.json(
        { 
          ok: false,
          error: "Received quantity must be greater than 0" 
        },
        { status: 400 }
      );
    }

    // Get order detail for verification
    const orderDetail = await prisma.orderDetail.findFirst({
      where: {
        order_no: parseInt(order_no),
        itcd: parseInt(itcd),
        status: 1 // Only pending items
      },
      select: { 
        id: true,
        qty: true, 
        unit: true,
        orderMaster: {
          select: {
            order_catagory: true,
            status: true
          }
        }
      }
    });

    if (!orderDetail) {
      return NextResponse.json(
        { 
          ok: false,
          error: "Order item not found or already processed" 
        },
        { status: 404 }
      );
    }

    // Check if order is a purchase order
    if (orderDetail.orderMaster.order_catagory !== 4) {
      return NextResponse.json(
        { 
          ok: false,
          error: "Only purchase orders can be processed here" 
        },
        { status: 400 }
      );
    }

    // Check if QA master already exists for this item
    // const existingQA = await prisma.qualityMaster.findFirst({
    //   where: {
    //     order_no: parseInt(order_no),
    //     itcd: parseInt(itcd)
    //   }
    // });

    // if (existingQA) {
    //   return NextResponse.json(
    //     { 
    //       ok: false,
    //       error: "Quality entry already exists for this item" 
    //     },
    //     { status: 400 }
    //   );
    // }

    const batchSize = parseFloat(received_qty);

    // Prepare data for QA master
    const qaMasterData = {
      order_no: parseInt(order_no),
      itcd: parseInt(itcd),
      batch_size: batchSize,
      status: "DRAFT",
      remarks: remarks || null,
      // Create initial QA detail entry
      details: {
        create: {
          order_no: parseInt(order_no),
          itcd: parseInt(itcd),
          attempt_no: 1,
          attempt_date: new Date(),
          parameter_name: "store_receiving_entry",
          quality_standard: "Pending QA Inspection",
          reject_reason: remarks || null
        }
      }
    };

    // Add batch info only if provided
    if (batch_no && batch_no.trim() !== "") {
      qaMasterData.batch_no = parseInt(batch_no.trim());
      
      if (mfg_date) {
        qaMasterData.mfg_date = new Date(mfg_date);
      }
      
      if (expiry_date && expiry_date.trim() !== "") {
        qaMasterData.expiry_date = new Date(expiry_date);
      }
    }

    // Create QA master entry within a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the quality master record
      const qualityMaster = await tx.qualityMaster.create({
        data: qaMasterData,
        include: {
          details: true,
          item: {
            select: {
              item: true
            }
          }
        }
      });

      const updatedQualityMaster = await tx.qualityMaster.update({
        where: { id: qualityMaster.id },
        data: {
          qa_barcode: buildQaBarcode({
            orderNo: qualityMaster.order_no,
            itcd: qualityMaster.itcd,
            id: qualityMaster.id,
          }),
          qc_barcode: buildOrderQcBarcode({
            orderNo: qualityMaster.order_no,
            itcd: qualityMaster.itcd,
            id: qualityMaster.id,
          }),
          grn_status: "PENDING",
        },
        include: {
          details: true,
          item: {
            select: {
              item: true
            }
          }
        }
      });

      return updatedQualityMaster;
    });

    return NextResponse.json({
      ok: true,
      message: "Goods receiving entry saved successfully",
      quality_master_id: result.id,
      received_qty: batchSize,
      has_batch_info: !!(batch_no && batch_no.trim())
    });
    
  } catch (error) {
    console.error("Error saving QA entry:", error);
    
    // Handle Prisma unique constraint errors
    if (error.code === 'P2002') {
      return NextResponse.json(
        { 
          ok: false,
          error: "A quality entry already exists for this item"
        },
        { status: 400 }
      );
    }

    // Handle Prisma foreign key constraint errors
    if (error.code === 'P2003') {
      return NextResponse.json(
        { 
          ok: false,
          error: "Invalid order number or item code"
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { 
        ok: false,
        error: "Failed to save entry",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    );
  }
});
