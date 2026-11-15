import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildQualityControlBarcode } from "@/lib/qualityControlBarcode.js";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateBatchNo } from "@/lib/generateBatchNo";
import { guard } from "@/lib/auth/route";

const addOneYear = (d) => {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + 1);
  return x;
};

async function safeJson(req) {
  try {
    const b = await req.json();
    return b ?? {};
  } catch {
    return {};
  }
}


/* =========================================================
   GET QC DETAILS
========================================================= */
export async function GET(request, context) {
  try {
    const params = await context.params;
    const proc_ord_no = Number(params.id);

    const prod = await prisma.productionPlanMaster.findUnique({
      where: { id: proc_ord_no },
      include: { item: true, qualityMaster: true },
    });

    if (!prod)
      return NextResponse.json(
        { error: "Production order not found" },
        { status: 404 },
      );

    const itemData = await prisma.item.findUnique({
      where: { itcd: prod.finished_id },
      select: { item: true , code :true},
    });

    const itemName = prod.item?.item || itemData?.item || "";

    const paramsList = await prisma.item_Quality.findMany({
      where: { itcd: prod.finished_id },
      orderBy: { parameter_name: "asc" },
    });

    const details = await prisma.qualityDetail.findMany({
      where: { proc_ord_no },
      orderBy: [{ attempt_no: "asc" }, { parameter_name: "asc" }],
    });

    const realized = await prisma.qualityDetailDetail.findMany({
      where: { proc_ord_no },
      include: { detail: { select: { parameter_name: true } } },
    });

    const attemptsMap = {
      1: { attempt_no: 1, attempt_date: "", reject_reason: null, rows: [] },
      2: { attempt_no: 2, attempt_date: "", reject_reason: null, rows: [] },
    };

    for (const p of paramsList) {
      const base = {
        parameter_name: p.parameter_name,
        quality_standard: p.quality_standard,
        quality_realized: "",
      };
      attemptsMap[1].rows.push({ ...base });
      attemptsMap[2].rows.push({ ...base });
    }

    for (const d of details) {
      if (!attemptsMap[d.attempt_no].attempt_date)
        attemptsMap[d.attempt_no].attempt_date =
          d.attempt_date?.toISOString().split("T")[0] ?? "";
      if (d.reject_reason && !attemptsMap[d.attempt_no].reject_reason) {
        attemptsMap[d.attempt_no].reject_reason = d.reject_reason;
      }
    }

    // Linked via detail_id -> QualityDetail.parameter_name, not array
    // position, so a realized value always lands on its actual parameter
    // even if this attempt's rows were saved/resubmitted out of order.
    const realizedByAttempt = { 1: {}, 2: {} };
    for (const r of realized) {
      const paramName = r.detail?.parameter_name;
      if (paramName) realizedByAttempt[r.attempt_no][paramName] = r.quality_realized ?? "";
    }

    for (const att of [1, 2]) {
      for (const row of attemptsMap[att].rows) {
        row.quality_realized = realizedByAttempt[att][row.parameter_name] ?? "";
      }
    }

    const qc = prod.qualityMaster;

    // Lookup customer name from sale_ord_no → OrderMaster → ACNO (no schema change)
    let customerName = "";
    if (prod.sale_ord_no) {
      const orderMaster = await prisma.orderMaster.findUnique({
        where: { order_no: prod.sale_ord_no },
        include: { acno: { select: { acname: true } } },
      });
      customerName = orderMaster?.acno?.acname || "";
    }

    return NextResponse.json({
      master: {
        qc_id: qc?.id ?? "",
        qc_barcode: qc?.qc_barcode ?? "",
        proc_ord_no: prod.id,
        itcd: prod.finished_id,
        item_name: itemName,
        inkCode: itemData?.code,
        status: qc?.status ?? "DRAFT",
        batch_no: qc?.batch_no ?? "",
        batch_size: qc?.batch_size ?? prod.qty ?? 0,
        mfg_date: qc?.mfg_date ? qc.mfg_date.toISOString().split("T")[0] : "",
        expiry_date: qc?.expiry_date
          ? qc.expiry_date.toISOString().split("T")[0]
          : "",
        approved_by: qc?.approved_by ?? "",
        customer_name: customerName,
      },
      parameters: paramsList,
      attempts: [attemptsMap[1], attemptsMap[2]],
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/* =========================================================
   POST — SAVE VALUES OR UPDATE STATUS
========================================================= */
export const POST = guard("qualityControl.manage", async (req, context) => {
  try {
    const session = await getServerSession(authOptions);
    const approvedBy = session?.user?.name || "";

    const params = await context.params;
    const proc_ord_no = Number(params.id);
    const {
      parameters,
      status: userStatus,
      reject_reason,
      mfg_date,
      expiry_date
    } = await safeJson(req);

    const hasParams = Array.isArray(parameters) && parameters.length > 0;
    const hasStatus = !!userStatus;
    const hasBatchInfoUpdate = !!(mfg_date || expiry_date);

    const prod = await prisma.productionPlanMaster.findUnique({
      where: { id: proc_ord_no },
      include: { qualityMaster: true },
    });

    if (!prod)
      return NextResponse.json(
        { error: "Production order not found" },
        { status: 404 },
      );

    const currentStatus = prod.qualityMaster?.status ?? "DRAFT";
    const now = new Date();

    /* ---------------- BATCH INFO ONLY UPDATE ---------------- */
    if (hasBatchInfoUpdate && !hasStatus && !hasParams) {
      await prisma.qualityMaster.upsert({
        where: { proc_ord_no },
        update: {
          mfg_date: mfg_date ? new Date(mfg_date) : undefined,
          expiry_date: expiry_date ? new Date(expiry_date) : undefined,
        },
        create: {
          proc_ord_no,
          itcd: prod.finished_id,
          batch_size: prod.qty ?? 0,
          status: "DRAFT",
          mfg_date: mfg_date ? new Date(mfg_date) : now,
          expiry_date: expiry_date ? new Date(expiry_date) : addOneYear(now),
        },
      });

      return NextResponse.json({
        ok: true,
        message: "Batch information updated",
      });
    }

    /* ---------------- STATUS ONLY UPDATE ---------------- */
    if (hasStatus && !hasParams) {
      // If status is REJECTED, reject_reason is required
      if (userStatus === "REJECTED") {
        if (
          !reject_reason ||
          typeof reject_reason !== "string" ||
          reject_reason.trim() === ""
        ) {
          return NextResponse.json(
            { error: "Reject reason is required when status is REJECTED" },
            { status: 400 },
          );
        }
      }

      if (userStatus === "HOLD") {
        if (
          !reject_reason ||
          typeof reject_reason !== "string" ||
          reject_reason.trim() === ""
        ) {
          return NextResponse.json(
            { error: "Hold reason is required when status is HOLD" },
            { status: 400 },
          );
        }
      }

      if (userStatus === "REWORK") {
        if (
          !reject_reason ||
          typeof reject_reason !== "string" ||
          reject_reason.trim() === ""
        ) {
          return NextResponse.json(
            { error: "Rework reason is required when status is REWORK" },
            { status: 400 },
          );
        }
      }

      let batchNo = prod.qualityMaster?.batch_no;
      let generatedBatchNo = null;

      if (userStatus === "APPROVED") {
        if (!batchNo) {
          // Generate new batch number
          generatedBatchNo = await generateBatchNo();
          batchNo = generatedBatchNo;
        }

        await prisma.$transaction(async (tx) => {
          // Update or create QualityMaster
          const qcMaster = await tx.qualityMaster.upsert({
            where: { proc_ord_no },
            update: {
              status: userStatus,
              batch_no: batchNo,
              mfg_date: new Date(),
              expiry_date: addOneYear(new Date()),
              approved_by: approvedBy,
            },
            create: {
              proc_ord_no,
              itcd: prod.finished_id,
              batch_size: prod.qty ?? 0,
              status: userStatus,
              batch_no: batchNo,
              mfg_date: new Date(),
              expiry_date: addOneYear(new Date()),
              approved_by: approvedBy,
            },
          });

          if (!qcMaster.qc_barcode) {
            await tx.qualityMaster.update({
              where: { id: qcMaster.id },
              data: {
                qc_barcode: buildQualityControlBarcode({
                  id: qcMaster.id,
                  procOrdNo: proc_ord_no,
                }),
              },
            });
          }

          // CRITICAL: Update productionPlanMaster with batch number
          await tx.productionPlanMaster.update({
            where: { id: proc_ord_no },
            data: {
              batch_no: String(batchNo), // Convert to string as per model
              status: "Completed", // Also update production plan status
            },
          });

          // Update all QualityDetail records to link with master
          await tx.qualityDetail.updateMany({
            where: { proc_ord_no },
            data: {
              master_id: qcMaster.id,
              itcd: prod.finished_id,
            },
          });

          // Update all QualityDetailDetail records
          await tx.qualityDetailDetail.updateMany({
            where: { proc_ord_no },
            data: {
              master_id: qcMaster.id,
              itcd: prod.finished_id,
            },
          });
        });

        return NextResponse.json({
          ok: true,
          status: userStatus,
          batch_no: batchNo,
          generated: !!generatedBatchNo,
          message: "Approved & batch assigned",
        });
      }

      // For non-APPROVED statuses (REJECTED, REWORK, etc.)
      await prisma.$transaction(async (tx) => {
        const qcMaster = await tx.qualityMaster.upsert({
          where: { proc_ord_no },
          update: { 
            status: userStatus,
            approved_by: null,
          },
          create: {
            proc_ord_no,
            itcd: prod.finished_id,
            batch_size: prod.qty ?? 0,
            status: userStatus,
            approved_by: null,
          },
        });

        if (!qcMaster.qc_barcode) {
          await tx.qualityMaster.update({
            where: { id: qcMaster.id },
            data: {
              qc_barcode: buildQualityControlBarcode({
                id: qcMaster.id,
                procOrdNo: proc_ord_no,
              }),
            },
          });
        }

        // If status is REJECTED, update reject_reason
        if (userStatus === "REJECTED" && reject_reason) {
          const attemptNo = currentStatus === "REWORK" ? 2 : 1;

          await tx.qualityDetail.updateMany({
            where: {
              proc_ord_no,
              attempt_no: attemptNo,
            },
            data: {
              reject_reason: reject_reason.trim(),
              master_id: qcMaster.id,
              itcd: prod.finished_id,
            },
          });

          // Also update production plan status
          await tx.productionPlanMaster.update({
            where: { id: proc_ord_no },
            data: {
              status: "QC_REJECTED",
            },
          });
        }

        // For HOLD status
        if (userStatus === "HOLD") {
          if (reject_reason) {
            await tx.qualityDetail.updateMany({
              where: { proc_ord_no, attempt_no: 1 },
              data: {
                reject_reason: reject_reason.trim(),
                master_id: qcMaster.id,
                itcd: prod.finished_id,
              },
            });
          }
          await tx.productionPlanMaster.update({
            where: { id: proc_ord_no },
            data: { status: "ON_HOLD" },
          });
        }

        // For REWORK status
        if (userStatus === "REWORK") {
          if (reject_reason) {
            await tx.qualityDetail.updateMany({
              where: { proc_ord_no, attempt_no: 1 },
              data: {
                reject_reason: reject_reason.trim(),
                master_id: qcMaster.id,
                itcd: prod.finished_id,
              },
            });
          }
          await tx.productionPlanMaster.update({
            where: { id: proc_ord_no },
            data: { status: "IN_REWORK" },
          });
        }

        // Update all detail records to link with master
        await tx.qualityDetail.updateMany({
          where: { proc_ord_no },
          data: {
            master_id: qcMaster.id,
            itcd: prod.finished_id,
          },
        });

        await tx.qualityDetailDetail.updateMany({
          where: { proc_ord_no },
          data: {
            master_id: qcMaster.id,
            itcd: prod.finished_id,
          },
        });
      });

      return NextResponse.json({
        ok: true,
        status: userStatus,
        message: "Status updated",
      });
    }

    /* ---------------- SAVE VALUES ONLY ---------------- */
    if (!hasParams)
      return NextResponse.json({ error: "No parameters" }, { status: 400 });

    if (["REJECTED"].includes(currentStatus))
      return NextResponse.json(
        { error: `Cannot edit after ${currentStatus}` },
        { status: 400 },
      );

    const attemptNo = currentStatus === "REWORK" ? 2 : 1;

    const standards = await prisma.item_Quality.findMany({
      where: { itcd: prod.finished_id },
      orderBy: { parameter_name: "asc" },
    });
    const stdMap = new Map(
      standards.map((s) => [s.parameter_name, s.quality_standard]),
    );

    await prisma.$transaction(async (tx) => {
      // Ensure QualityMaster exists
      const qcMaster = await tx.qualityMaster.upsert({
        where: { proc_ord_no },
        update: {
          mfg_date: mfg_date ? new Date(mfg_date) : undefined,
          expiry_date: expiry_date ? new Date(expiry_date) : undefined,
        },
        create: {
          proc_ord_no,
          itcd: prod.finished_id,
          batch_size: prod.qty ?? 0,
          status: currentStatus,
          mfg_date: mfg_date ? new Date(mfg_date) : now,
          expiry_date: expiry_date ? new Date(expiry_date) : addOneYear(now),
        },
      });

      if (!qcMaster.qc_barcode) {
        await tx.qualityMaster.update({
          where: { id: qcMaster.id },
          data: {
            qc_barcode: buildQualityControlBarcode({
              id: qcMaster.id,
              procOrdNo: proc_ord_no,
            }),
          },
        });
      }

        const existingAttempt = await tx.qualityDetail.findFirst({
          where: { proc_ord_no, attempt_no: attemptNo },
        });

        const sortedParams = [...parameters].sort((a, b) =>
          (a.parameter_name || "").localeCompare(b.parameter_name || ""),
        );

        if (existingAttempt) {
          // Update existing attempt
          for (const p of sortedParams) {
            await tx.qualityDetail.updateMany({
              where: {
                proc_ord_no,
                parameter_name: p.parameter_name,
                attempt_no: attemptNo,
              },
              data: {
                master_id: qcMaster.id,
                attempt_date: now,
                quality_standard: stdMap.get(p.parameter_name) ?? "",
                itcd: prod.finished_id,
              },
            });
          }

          // updateMany doesn't return row ids, so re-fetch the current
          // QualityDetail rows to build a parameter_name -> id map for
          // linking the recreated QualityDetailDetail rows below.
          const currentDetails = await tx.qualityDetail.findMany({
            where: { proc_ord_no, attempt_no: attemptNo },
          });
          const detailIdByParam = Object.fromEntries(
            currentDetails.map((d) => [d.parameter_name, d.id]),
          );

          // Delete and recreate detail records
          await tx.qualityDetailDetail.deleteMany({
            where: { proc_ord_no, attempt_no: attemptNo },
          });

          for (const p of sortedParams) {
            await tx.qualityDetailDetail.create({
              data: {
                master_id: qcMaster.id,
                proc_ord_no,
                attempt_no: attemptNo,
                itcd: prod.finished_id,
                detail_id: detailIdByParam[p.parameter_name] ?? null,
                quality_realized: p.quality_realized ?? "",
              },
            });
          }
        } else {
          // First time insert attempt
          await tx.qualityDetail.deleteMany({
            where: { proc_ord_no, attempt_no: attemptNo },
          });
          await tx.qualityDetailDetail.deleteMany({
            where: { proc_ord_no, attempt_no: attemptNo },
          });

          for (const p of sortedParams) {
            const createdDetail = await tx.qualityDetail.create({
              data: {
                master_id: qcMaster.id,
                proc_ord_no,
                parameter_name: p.parameter_name,
                quality_standard: stdMap.get(p.parameter_name) ?? "",
                attempt_no: attemptNo,
                attempt_date: now,
                itcd: prod.finished_id,
              },
            });

            await tx.qualityDetailDetail.create({
              data: {
                master_id: qcMaster.id,
                proc_ord_no,
                attempt_no: attemptNo,
                itcd: prod.finished_id,
                detail_id: createdDetail.id,
                quality_realized: p.quality_realized ?? "",
              },
            });
        }
      }
    });

    return NextResponse.json({
      ok: true,
      status: currentStatus,
      attempt_no: attemptNo,
      message: `Attempt ${attemptNo} saved`,
    });
  } catch (err) {
    console.error("Error in POST quality control:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
