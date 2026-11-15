import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { id } from "date-fns/locale";

export async function GET() {
  try {
    // Step 1: Get all purchase order items that are pending
    const orderDetails = await prisma.orderDetail.findMany({
      where: {
        itcd: { not: null },
        status: 1, // Pending items
        orderMaster: {
          order_catagory: 4, // Purchase orders
          status: 1 // Active orders
        }
      },
      include: {
        orderMaster: {
          include: {
            acno: {
              select: { acname: true }
            }
          }
        },
        items: {
          select: { item: true, itcd: true }
        }
      },
      orderBy: {
        order_no: 'desc'
      }
    });

    // Step 2: Get existing QA masters
    const existingQAMasters = await prisma.qualityMaster.findMany({
      where: {
        order_no: {
          in: orderDetails.map(d => d.order_no)
        }
      },
      select: {
        order_no: true,
        itcd: true,
        status: true,
        id: true,
        batch_size: true
      }
    });


    const approvedQAMap = new Map();

    // Create a Set for quick lookup
    existingQAMasters.forEach(qa => {
  if (qa.status === "APPROVED") { // approved only
    const key = `${qa.order_no}-${qa.itcd}`;
    const prev = approvedQAMap.get(key) || 0;
    approvedQAMap.set(key, prev + (qa.batch_size || 0));
  }
});




// const receivedQty = await prisma.transactionsMaster.findMany({
//           where: {
//             po_no:  {in: orderDetails.map(d => d.order_no)},
//             tran_code: 4, // GRN transaction code
//           },
//           include: {
//             transactions: {
//               where: { itcd: { not: null } },
//               select: { qty: true, itcd:true }
//             }
//           }
//         });

//             const receivedQAMap = new Map();
//                receivedQAMap.forEach(r => {
//           const key = `${r.po_no}-${r.itcd}`;
//           const prev = approvedQAMap.get(key) || 0;
//           approvedQAMap.set(key, prev + (qa.batch_size || 0));
// });

    // Step 3: Filter out items that already have QA entry
    // const pendingItems = orderDetails.filter(detail => {
    //   const key = `${detail.order_no}-${detail.itcd}`;
    //   return !existingQASet.has(key);
    // });

    // Step 4: Format the response
  const formattedOrders = orderDetails.map(detail => {
  const key = `${detail.order_no}-${detail.itcd}`;
  const approvedQty = approvedQAMap.get(key) || 0;

  return {
    order_no: detail.order_no,
    order_date: detail.orderMaster?.dated || new Date(),
    vendor_name: detail.orderMaster?.acno?.acname || "",
    itcd: detail.itcd,
    item_name: detail.items?.item || "",
    ordered_qty: detail.qty || 0,
    approved_qty: approvedQty,              // ✅ THIS
    pending_qty: (detail.qty || 0) - approvedQty, // ✅ OPTIONAL (very useful)
    unit: detail.unit || "",
    rate: detail.rate || 0,
    order_detail_id: detail.id
  };
});

    return NextResponse.json({
      orders: formattedOrders,
      total: formattedOrders.length
    });
    
  } catch (error) {
    console.error("Error fetching pending QA entries:", error);
    return NextResponse.json(
      { 
        error: "Failed to load pending orders",
        details: error.message 
      },
      { status: 500 }
    );
  }
}