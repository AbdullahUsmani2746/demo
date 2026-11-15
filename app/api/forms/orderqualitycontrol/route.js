import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function mapEnumToStatus(status) {
  if (!status) return null;
  const statusMap = {
    DRAFT: "draft",
    APPROVED: "approve",
    REJECTED: "reject",
  };
  return statusMap[status] || status.toLowerCase();
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("pageSize") || "20"))
    );
    const search = (searchParams.get("search") || "").trim();
    const includeGrn = searchParams.get("includeGrn") === "true";
    const includeBatch = searchParams.get("includeBatch") === "true";

    // Build WHERE clause for quality masters
    const whereClause = {
      // Only get quality masters with order_no (purchase orders)
      order_no: { not: null },
      // Filter by search term if provided
      ...(search && {
        OR: [
          { order_no: { equals: parseInt(search) || 0 } },
          { item: { item: { contains: search, mode: 'insensitive' } } },
          { batch_no: { equals: parseInt(search) || 0 } },
          { qa_barcode: { contains: search, mode: 'insensitive' } },
          { qc_barcode: { contains: search, mode: 'insensitive' } },
          { orderMaster: { 
            acno: { acname: { contains: search, mode: 'insensitive' } } 
          } }
        ]
      })
    };

    // Get quality master records (items entered by store person)
    const qualityMasters = await prisma.qualityMaster.findMany({
      where: whereClause,
      include: {
        item: {
          select: { item: true, itcd: true }
        },
        orderMaster: {
          include: {
            acno: {
              select: { acname: true }
            }
          }
        },
        details: {
          orderBy: { attempt_no: 'desc' },
          take: 1
        }
      },
      orderBy: { order_no: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Get total count for pagination
    const totalCount = await prisma.qualityMaster.count({
      where: whereClause
    });

    // Group items by order_no for display
    const ordersMap = new Map();

    qualityMasters.forEach(qm => {
      if (!qm.order_no) return; // Skip if no order_no
      
      if (!ordersMap.has(qm.order_no)) {
        ordersMap.set(qm.order_no, {
          order_no: qm.order_no,
          order_name: qm.orderMaster?.acno?.acname || `Order ${qm.order_no}`,
          items: [],
          total_items: 0,
          order_status: qm.orderMaster?.status || 1
        });
      }

      const order = ordersMap.get(qm.order_no);
      const itemStatus = mapEnumToStatus(qm.status);
      const latestDetail = qm.details?.[0];

      order.items.push({
        id: qm.id,
        itcd: qm.itcd,
        item_name: qm.item?.item || "-",
        qty: qm.batch_size || 0,
        unit: "", // You might need to get unit from orderDetail
        status: itemStatus,
        qa_barcode: qm.qa_barcode,
        qc_barcode: qm.qc_barcode,
        batch_no: qm.batch_no,
        mfg_date: qm.mfg_date,
        expiry_date: qm.expiry_date,
        grn_status: qm.grn_status || "PENDING",
        grn_no: null,
        has_parameters: false, // You can check if item has parameters
        reject_reason: latestDetail?.reject_reason || null
      });

      order.total_items = order.items.length;
    });

    const orders = Array.from(ordersMap.values());

    // Get GRN information if requested
    const grnInfo = {};
    if (includeGrn) {
      const orderIds = orders.map(o => o.order_no).filter(id => id !== null);
      
      if (orderIds.length > 0) {
        const grns = await prisma.transactionsMaster.findMany({
          where: {
            po_no: { in: orderIds },
            tran_code: 4, // GRN transaction code
          },
          include: {
            transactions: {
              where: { itcd: { not: null } },
              select: { itcd: true }
            }
          }
        });
        
        for (const grn of grns) {
          if (grn.po_no && grn.transactions.length > 0) {
            for (const trans of grn.transactions) {
              if (trans.itcd) {
                const key = `${grn.po_no}-${trans.itcd}`;
                grnInfo[key] = grn.vr_no || grn.grn_no;
              }
            }
          }
        }
      }
    }

    // Get batch information if requested (already included in qualityMaster)
    const batchInfo = {};
    if (includeBatch) {
      qualityMasters.forEach(qm => {
        if (!qm.order_no) return;
        const key = `${qm.order_no}-${qm.itcd}-${qm.id}`;
        batchInfo[key] = {
          batch_no: qm.batch_no,
          mfg_date: qm.mfg_date,
          expiry_date: qm.expiry_date
        };
      });
    }

    // Add GRN numbers to items
    orders.forEach(order => {
      let totalApproved = 0;
      let totalRejected = 0;
      let totalDraft = 0;
      
      order.items.forEach(item => {
        const key = `${order.order_no}-${item.itcd}-${item.id}`;
        item.grn_no = grnInfo[key] || null;
        item.grn_status = item.grn_no ? "CREATED" : item.grn_status;
        
        // Count statuses
        if (item.status === 'approve' || item.status === 'approved') totalApproved++;
        else if (item.status === 'reject' || item.status === 'rejected') totalRejected++;
        else if (item.status === 'draft') totalDraft++;
      });
      
      // Add summary stats to order
      order.summary = {
        total_items: order.total_items,
        approved: totalApproved,
        rejected: totalRejected,
        draft: totalDraft,
      };
    });

    // Calculate overall stats
    const allItems = orders.flatMap(order => order.items);
    const stats = {
      total: allItems.length,
      pending: allItems.filter(item => item.status === 'draft').length,
      approved: allItems.filter(item => item.status === 'approve' || item.status === 'approved').length,
      rejected: allItems.filter(item => item.status === 'reject' || item.status === 'rejected').length,
      grnCreated: Object.keys(grnInfo).length
    };

    return NextResponse.json({
      page,
      pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      orders,
      grnInfo,
      batchInfo: includeBatch ? batchInfo : {},
      stats
    });
  } catch (err) {
    console.error("Error fetching QC data:", err);
    return NextResponse.json(
      { error: "Failed to fetch data", details: err.message },
      { status: 500 }
    );
  }
}
