import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  buildOrderQcBarcode,
  buildQaBarcode,
} from "@/lib/orderQualityBarcode.js";
import { createOrderGrn } from "@/lib/createOrderGrn.js";
import { guard } from "@/lib/auth/route";

function mapStatusToEnum(status) {
  const statusMap = {
    draft: "DRAFT",
    approve: "APPROVED",
    reject: "REJECTED",
  };
  return statusMap[status?.toLowerCase()] || null;
}

// In your POST function, modify these sections:

export const POST = guard("qualityControl.manage", async (request, context) => {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id || session?.user?.user_id || "system";

    const params = await context.params;
    const order_no = parseInt(params.order_no);
    
    const body = await request.json();
    const { itcd, status, reject_reason, batch_no, remarks } = body; // Add batch_no and remarks
    
    if (!order_no || !itcd || !status) {
      return NextResponse.json(
        { error: "Order number, ITCD, and status are required" },
        { status: 400 }
      );
    }
    
    const itcdInt = parseInt(itcd);
    
    // Validate status
    const statusEnum = mapStatusToEnum(status);
    if (!statusEnum) {
      return NextResponse.json(
        { error: "Invalid status. Allowed: draft, approve, reject" },
        { status: 400 }
      );
    }
    
    // Validate reject reason for rejected status
    if (statusEnum === "REJECTED" && (!reject_reason || reject_reason.trim() === "")) {
      return NextResponse.json(
        { error: "Reject reason is required when status is reject" },
        { status: 400 }
      );
    }
    
    // For approval, check if batch number is provided (either existing or new)
    if (statusEnum === "APPROVED") {
      // Check if batch number exists or is provided
      const qualityMaster = await prisma.qualityMaster.findFirst({
        where: {
          order_no,
          itcd: itcdInt
        },
        select: { batch_no: true }
      });
      
      // If no existing batch number AND no new batch number provided
      if (!qualityMaster?.batch_no && (!batch_no || batch_no.trim() === "")) {
        return NextResponse.json(
          { error: "Batch number is required for approval. Please enter batch number first." },
          { status: 400 }
        );
      }
    }
    
    let grnResult = null;

    await prisma.$transaction(async (tx) => {
      // Get quality master
      const qualityMaster = await tx.qualityMaster.findFirst({
        where: {
          order_no,
          itcd: itcdInt
        }
      });
      
      if (!qualityMaster) {
        throw new Error("Quality master record not found");
      }
      
      // Prepare update data
      const updateData = {
        status: statusEnum,
        remarks: statusEnum === "APPROVED" ? remarks : qualityMaster.remarks,
        qa_barcode:
          qualityMaster.qa_barcode ||
          buildQaBarcode({
            orderNo: order_no,
            itcd: itcdInt,
            id: qualityMaster.id,
          }),
        qc_barcode:
          qualityMaster.qc_barcode ||
          buildOrderQcBarcode({
            orderNo: order_no,
            itcd: itcdInt,
            id: qualityMaster.id,
          }),
        grn_status: statusEnum === "APPROVED" ? "APPROVED_PENDING_GRN" : "PENDING",
        approved_by: statusEnum === "APPROVED" ? (session?.user?.name || "System") : null,
      };
      
      // Update batch number if provided for approval
      if (statusEnum === "APPROVED" && batch_no && batch_no.trim() !== "") {
  const batchNoInt = parseInt(batch_no.trim());
  if (!isNaN(batchNoInt)) {
    updateData.batch_no = batchNoInt;
  } else {
    throw new Error("Invalid batch number. Must be a numeric value.");
  }
}
      
      // Update quality master status and batch number
      const updatedQualityMaster = await tx.qualityMaster.update({
        where: { id: qualityMaster.id },
        data: updateData
      });
      
      // Create or update quality detail record for status change
      const existingDetail = await tx.qualityDetail.findFirst({
        where: {
          order_no,
          master_id: qualityMaster.id,
          attempt_no: 0
        },
      });
      
      if (existingDetail) {
        await tx.qualityDetail.update({
          where: { id: existingDetail.id },
          data: {
            reject_reason: statusEnum === "REJECTED" ? reject_reason : null,
          }
        });
      } else {
        await tx.qualityDetail.create({
          data: {
            master_id: qualityMaster.id,
            order_no,
            attempt_no: 0,
            attempt_date: new Date(),
            parameter_name: "qa_decision",
            quality_standard: "N/A",
            reject_reason: statusEnum === "REJECTED" ? reject_reason : null,
          }
        });
      }

      if (statusEnum === "APPROVED") {
        const order = await tx.orderMaster.findUnique({
          where: { order_no },
          include: {
            orderDetails: {
              where: { itcd: itcdInt },
              include: { items: true },
            },
            acno: true,
          },
        });

        if (!order || !order.orderDetails[0]) {
          throw new Error("Approved order item could not be loaded for GRN creation.");
        }

        grnResult = await createOrderGrn(tx, {
          order,
          orderDetail: order.orderDetails[0],
          qualityMaster: updatedQualityMaster,
          userId,
          itcd: itcdInt,
        });

        await tx.qualityMaster.update({
          where: { id: qualityMaster.id },
          data: {
            grn_status: "CREATED",
            grn_no: grnResult.grnNo ? Number(grnResult.grnNo) : null,
          },
        });
      }
    });
    
    return NextResponse.json({
      ok: true,
      status: status.toLowerCase(),
      grnNo: grnResult?.grnNo || null,
      grnCreated: !!grnResult,
      message:
        statusEnum === "APPROVED" && grnResult?.grnNo
          ? `Item approved and GRN #${grnResult.grnNo} created successfully`
          : `Item ${status.toLowerCase()} successfully`
    });
    
  } catch (error) {
    console.error("Error updating status:", error);
    return NextResponse.json(
      { error: "Failed to update status", details: error.message },
      { status: 500 }
    );
  }
});
