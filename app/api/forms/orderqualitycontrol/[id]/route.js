import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

async function safeJson(req) {
  try {
    const b = await req.json();
    return b ?? {};
  } catch {
    return {};
  }
}

function mapStatusToEnum(status) {
  const statusMap = {
    draft: "DRAFT",
    approve: "APPROVED",
    reject: "REJECTED",
  };
  return statusMap[status?.toLowerCase()] || null;
}

function mapEnumToStatus(status) {
  const statusMap = {
    DRAFT: "draft",
    APPROVED: "approve",
    REJECTED: "reject",
  };
  return statusMap[status] || status?.toLowerCase() || "draft";
}

export async function GET(request, context) {
  try {
    const params = await context.params;
    const order_no = Number(params.id);

    // Get query parameter for selected item
    const { searchParams } = new URL(request.url);
    const selectedItcdParam = searchParams.get("itcd");
    const selectedItcd = selectedItcdParam ? Number(selectedItcdParam) : null;

    if (!selectedItcd) {
      return NextResponse.json({ error: "ITCD parameter is required" }, { status: 400 });
    }

    // Get quality master for this specific order and item
    const qualityMaster = await prisma.qualityMaster.findFirst({
      where: {
        order_no,
        itcd: selectedItcd
      },
      include: {
        item: {
          select: { item: true, itcd: true }
        },
        orderMaster: {
          include: {
            acno: {
              select: { acname: true }
            },
            orderDetails: {
              where: { itcd: selectedItcd },
              include: {
                items: true
              }
            }
          }
        },
        details: {
          where: { attempt_no: { gt: 0 } },
          orderBy: { attempt_no: 'asc' },
        },
        detailDetails: {
          orderBy: { attempt_no: 'asc' },
        }
      }
    });

    if (!qualityMaster) {
      return NextResponse.json({ error: "QA record not found" }, { status: 404 });
    }

    // Get all items in this order that have QA entries
    const allItemsWithQA = await prisma.qualityMaster.findMany({
      where: {
        order_no
      },
      include: {
        item: {
          select: { item: true, itcd: true }
        }
      },
      orderBy: { itcd: 'asc' }
    });

    const allItems = allItemsWithQA.map(qm => ({
      id: qm.id,
      itcd: qm.itcd,
      item_name: qm.item?.item || "",
      qty: qm.batch_size || 0,
      status: mapEnumToStatus(qm.status),
      has_qa: true
    }));

    // Get quality parameters for this item
    const paramsList = await prisma.item_Quality.findMany({
      where: { itcd: selectedItcd },
      orderBy: { parameter_name: 'asc' },
    });

    // Get attempts
    let attempts = [];
    if (qualityMaster.details && paramsList.length > 0) {
      for (const detail of qualityMaster.details) {
        const detailDetails = await prisma.qualityDetailDetail.findMany({
          where: {
            master_id: qualityMaster.id,
            attempt_no: detail.attempt_no,
          },
          orderBy: { parameter_name: 'asc' },
        });

        const rows = paramsList.map((param) => {
          const realized = detailDetails.find(
            (d) => d.parameter_name === param.parameter_name
          );
          return {
            parameter_name: param.parameter_name,
            quality_standard: param.quality_standard,
            quality_realized: realized?.quality_realized || "",
          };
        });

        attempts.push({
          attempt_no: detail.attempt_no,
          attempt_date: detail.attempt_date?.toISOString().split("T")[0] || new Date().toISOString().split("T")[0],
          reject_reason: detail.reject_reason,
          rows: rows,
        });
      }
    }

    // Get GRN info if exists
    const grnExists = await prisma.transactionsMaster.findFirst({
      where: {
        po_no: order_no,
        tran_code: 4,
        transactions: {
          some: { itcd: selectedItcd }
        }
      },
      select: { vr_no: true, grn_no: true },
    });

    const orderDetail = qualityMaster.orderMaster?.orderDetails?.[0];

    return NextResponse.json({
      master: {
        order_no: qualityMaster.order_no,
        itcd: qualityMaster.itcd,
        item_name: qualityMaster.item?.item || "",
        status: mapEnumToStatus(qualityMaster.status),
        batch_size: qualityMaster.batch_size,
        batch_no: qualityMaster.batch_no,
        mfg_date: qualityMaster.mfg_date,
        expiry_date: qualityMaster.expiry_date,
        vendor_name: qualityMaster.orderMaster?.acno?.acname || "",
        grn_exists: grnExists?.vr_no || grnExists?.grn_no || null,
        ordered_qty: orderDetail?.qty || 0,
        unit: orderDetail?.unit || "",
        rate: orderDetail?.rate || 0,
      },
      allItems: allItems,
      selectedItcd: selectedItcd,
      parameters: paramsList,
      attempts: attempts,
    });
  } catch (err) {
    console.error("Error in GET:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export const POST = guard("qualityControl.manage", async (req, context) => {
  try {
    const params = await context.params;
    const order_no = Number(params.id);
    const {
      parameters,
      status: userStatus,
      itcd: selectedItcd,
      reject_reason,
      batch_no,
      mfg_date,
      expiry_date,
      skip_validation = false,
    } = await safeJson(req);

    // Find quality master
    const qualityMaster = await prisma.qualityMaster.findFirst({
      where: {
        order_no,
        itcd: Number(selectedItcd)
      }
    });

    if (!qualityMaster) {
      return NextResponse.json({ error: "QA record not found" }, { status: 404 });
    }

    // Handle status update (approve/reject)
    if (userStatus) {
      const statusEnum = mapStatusToEnum(userStatus);
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

      // Check if batch number is required for approval
      if (statusEnum === "APPROVED" && !qualityMaster.batch_no) {
        return NextResponse.json(
          { error: "Batch number is required for approval. Please enter batch number first." },
          { status: 400 }
        );
      }

      await prisma.$transaction(async (tx) => {
        // Update quality master status
        await tx.qualityMaster.update({
          where: { id: qualityMaster.id },
          data: {
            status: statusEnum,
            ...(batch_no && { batch_no: parseInt(batch_no) }),
            ...(mfg_date && { mfg_date: new Date(mfg_date) }),
            ...(expiry_date && { expiry_date: new Date(expiry_date) }),
          }
        });

        // Create quality detail record
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
      });

      return NextResponse.json({
        ok: true,
        status: userStatus.toLowerCase(),
        message: `Item ${userStatus.toLowerCase()} successfully`
      });
    }

    // Handle parameter updates (for items with quality parameters)
    const hasParams = Array.isArray(parameters) && parameters.length > 0;
    if (hasParams) {
      // Get next attempt number
      const lastAttempt = await prisma.qualityDetail.findFirst({
        where: {
          order_no,
          master_id: qualityMaster.id,
          attempt_no: { gt: 0 }
        },
        orderBy: { attempt_no: 'desc' },
        select: { attempt_no: true }
      });

      const nextAttemptNo = lastAttempt ? lastAttempt.attempt_no + 1 : 1;

      await prisma.$transaction(async (tx) => {
        // Create quality detail record
        await tx.qualityDetail.create({
          data: {
            master_id: qualityMaster.id,
            order_no,
            attempt_no: nextAttemptNo,
            attempt_date: new Date(),
            parameter_name: parameters[0]?.parameter_name || "quality_test",
            quality_standard: parameters[0]?.quality_standard || "standard",
          }
        });

        // Create quality detail detail records
        for (const param of parameters) {
          await tx.qualityDetailDetail.create({
            data: {
              master_id: qualityMaster.id,
              order_no,
              attempt_no: nextAttemptNo,
              parameter_name: param.parameter_name,
              quality_realized: param.quality_realized || "",
            }
          });
        }
      });

      return NextResponse.json({
        ok: true,
        status: "draft",
        message: "Quality test data saved successfully"
      });
    }

    return NextResponse.json({ error: "No data provided" }, { status: 400 });

  } catch (err) {
    console.error("Error in POST:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});