import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth"; // Import from lib/auth instead
import { guard } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";


export const POST = guard("qualityControl.manage", async (request, context) => {
  try {

    // Get user session for authentication
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized. Please login to create GRN." },
        { status: 401 }
      );
    }
    
    const userId = session.user.id || session.user.user_id || 'system';

    const params = await context.params;
    const order_no = parseInt(params.order_no);
    
    const body = await request.json();
    const { itcd } = body;
    
    if (!order_no || !itcd) {
      return NextResponse.json(
        { error: "Order number and ITCD are required" },
        { status: 400 }
      );
    }
    
    const itcdNum = parseInt(itcd);
    
    // Check if order exists and is a purchase order
    const order = await prisma.orderMaster.findUnique({
      where: { order_no },
      include: {
        orderDetails: {
          where: { itcd: itcdNum },
          include: { items: true }
        },
        acno: true,
        qualityMaster: {
          where: { itcd: itcdNum }
        }
      }
    });
    
    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }
    
    if (order.order_catagory !== 4) {
      return NextResponse.json(
        { error: "Only purchase orders can have GRN created" },
        { status: 400 }
      );
    }
    
    // Check if item exists in order
    const orderDetail = order.orderDetails[0];
    if (!orderDetail) {
      return NextResponse.json(
        { error: "Item not found in order" },
        { status: 404 }
      );
    }
    
    // Check if quality control is approved
    if (!order.qualityMaster || order.qualityMaster.length === 0 || order.qualityMaster[0].status !== "APPROVED") {
      return NextResponse.json(
        { error: "Item must be approved before creating GRN" }, 
        { status: 400 }
      );
    }
    
    // Check if GRN already exists
    const existingGRN = await prisma.transactionsMaster.findFirst({
      where: {
        po_no: order_no,
        tran_code: 4,
        transactions: {
          some: { itcd: itcdNum }
        }
      }
    });
    
    if (existingGRN) {
      return NextResponse.json(
        { error: `GRN #${existingGRN.vr_no} already exists for this order item` },
        { status: 400 }
      );
    }
    
    // Calculate amounts
    const qty = orderDetail.qty || 0;
    const rate = orderDetail.rate || 0;
    const amount = qty * rate;
    const qualityMaster = order.qualityMaster[0];
    
    const lockError = await checkPeriodLock(new Date(), 4, { action: "create" });
    if (lockError) {
      return NextResponse.json({ error: lockError }, { status: 422 });
    }

    // Create GRN transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create TransactionsMaster for GRN - vr_no will be auto-generated
      const transactionMaster = await tx.transactionsMaster.create({
        data: {
          dated: new Date(),
          time: new Date(),
          tran_code: 4, // GRN transaction code
          po_no: order_no,
          pycd: order.party_code, // Vendor account
          godown: order.godown,
          user_id: userId,
          rmk: `GRN created from QC for Order #${order_no}`,
          rmk1: `Item: ${orderDetail.items?.item || `ITCD ${itcd}`}`,
          rmk2: `Batch: ${qualityMaster?.batch_no || ''}`,
          // Don't include vr_no - let DB auto-generate it
        },
        select: {
          vr_no: true, // Get the auto-generated vr_no
          tran_id: true,
          dated: true
        }
      });
      
      // Get the auto-generated GRN number (vr_no)
      const grnNo = transactionMaster.grn_no;
      
      // 2. Create Transactions entry for stock receipt (debit stock)
      await tx.transactions.create({
        data: {
          tran_id: transactionMaster.tran_id,
          itcd: itcdNum,
          qty: qty,
          po_qty: qty, // Original PO quantity
          rate: rate,
          damt: amount, // Debit amount (stock increase)
          gross_amount: amount, // Gross amount
          godown: order.godown,
          unit: orderDetail.unit || "",
          sub_tran_id: 1,
          narration1: `for Order #${order_no}`,
          narration2: orderDetail.items?.item || `Item ${itcd}`,
          narration3: `Batch: ${qualityMaster?.batch_no || ''}`,
          narration4: `Vendor: ${order.acno?.acname || ''}`,
        }
      });
      
      // 3. Create corresponding credit entry (vendor liability)
      await tx.transactions.create({
        data: {
          tran_id: transactionMaster.tran_id,
          acno: order.party_code, // Vendor account (credit)
          camt: amount, // Credit amount
          sub_tran_id: 3,
          narration1: `Order #${order_no}`,
        }
      });
      
      // 4. Update order detail status to completed
      await tx.orderDetail.updateMany({
        where: {
          order_no,
          itcd: itcdNum
        },
        data: {
          status: 2 // Completed
        }
      });
      
      // 5. Update or create inventory stock
      const batchNo = qualityMaster?.batch_no;
      const mfgDate = qualityMaster?.mfg_date;
      const expiryDate = qualityMaster?.expiry_date;
      
      // if (batchNo) {
      //   // Check if stock exists for this batch
      //   const existingStock = await tx.stock.findFirst({
      //     where: {
      //       itcd: itcdNum,
      //       godown: order.godown,
      //       batch_no: batchNo
      //     }
      //   });
        
      //   if (existingStock) {
      //     await tx.stock.update({
      //       where: { id: existingStock.id },
      //       data: {
      //         qty: { increment: qty },
      //         rate: rate,
      //         updated_at: new Date()
      //       }
      //     });
      //   } else {
      //     // Create new stock entry
      //     await tx.stock.create({
      //       data: {
      //         itcd: itcdNum,
      //         godown: order.godown,
      //         qty: qty,
      //         rate: rate,
      //         unit: orderDetail.unit || "",
      //         batch_no: batchNo,
      //         mfg_date: mfgDate,
      //         expiry_date: expiryDate,
      //         created_at: new Date(),
      //         updated_at: new Date()
      //       }
      //     });
      //   }
      // }
      
      // 6. Update order status if all items are completed
      const pendingItems = await tx.orderDetail.count({
        where: {
          order_no,
          status: { not: 2 }
        }
      });
      
      if (pendingItems === 0) {
        await tx.orderMaster.update({
          where: { order_no },
          data: { status: 2 } // Completed
        });
      }

      await tx.qualityMaster.updateMany({
        where: {
          order_no,
          itcd: itcdNum,
        },
        data: {
          grn_status: "CREATED",
          grn_no: transactionMaster.vr_no || transactionMaster.grn_no || null,
        },
      });
      
      return { 
        grnNo: grnNo,
        tranId: transactionMaster.tran_id,
        dated: transactionMaster.dated
      };
    });
    
    return NextResponse.json({
      ok: true,
      grnNo: result.grnNo, // Return the auto-generated GRN number
      tranId: result.tranId,
      dated: result.dated,
      message: `GRN #${result.grnNo} created successfully`
    });
    
  } catch (error) {
    console.error("Error creating GRN:", error);
    return NextResponse.json(
      { error: "Failed to create GRN", details: error.message },
      { status: 500 }
    );
  }
});
