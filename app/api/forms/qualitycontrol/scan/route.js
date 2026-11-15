import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildQualityControlBarcode } from "@/lib/qualityControlBarcode.js";
import { guard } from "@/lib/auth/route";

function parseScannedValue(rawValue) {
  const input = String(rawValue ?? "").trim();

  if (!input) {
    throw new Error("Scanned process order is required.");
  }

  if (input.startsWith("{") && input.endsWith("}")) {
    const parsed = JSON.parse(input);
    return {
      barcode:
        parsed.barcode ??
        parsed.productionBarcode ??
        parsed.code ??
        null,
      procOrdNo:
        parsed.productionPlanId ?? parsed.proc_ord_no ?? parsed.processOrder,
    };
  }

  if (/^\d+$/.test(input)) {
    return {
      barcode: null,
      procOrdNo: Number(input),
    };
  }

  const idMatch = input.match(/(?:proc(?:ess)?[_\s-]*ord(?:er)?|plan|id)[:=#\s-]*(\d+)/i);
  if (idMatch?.[1]) {
    return {
      barcode: null,
      procOrdNo: Number(idMatch[1]),
    };
  }

  return {
    barcode: input,
    procOrdNo: null,
  };
}

async function findProductionPlan({ barcode, procOrdNo }) {
  if (barcode) {
    const qualityRecord = await prisma.qualityMaster.findFirst({
      where: { qc_barcode: barcode },
      include: {
        item: { select: { item: true } },
        productionPlanMaster: true,
      },
    });

    if (qualityRecord) {
      return {
        type: "quality",
        qualityRecord,
      };
    }
  }

  if (barcode) {
    const byBarcode = await prisma.productionPlanMaster.findFirst({
      where: { barcode },
      include: {
        item: {
          select: {
            item: true,
          },
        },
        qualityMaster: true,
      },
    });

    if (byBarcode) {
      return {
        type: "production",
        productionPlan: byBarcode,
      };
    }
  }

  if (!procOrdNo) {
    return null;
  }

  const byId = await prisma.productionPlanMaster.findUnique({
    where: { id: procOrdNo },
    include: {
      item: {
        select: {
          item: true,
        },
      },
      qualityMaster: true,
    },
  });

  return byId
    ? {
        type: "production",
        productionPlan: byId,
      }
    : null;
}

export const POST = guard("qualityControl.manage", async (request) => {
  try {
    const body = await request.json();
    const parsedScan = parseScannedValue(body.barcode ?? body.processOrderNo);
    const matchedRecord = await findProductionPlan(parsedScan);

    if (!matchedRecord) {
      return NextResponse.json(
        { ok: false, error: "No production record matches the scanned barcode." },
        { status: 404 },
      );
    }

    if (matchedRecord.type === "quality") {
      const { qualityRecord } = matchedRecord;

      return NextResponse.json({
        ok: true,
        created: false,
        direction: "qc_to_production",
        message: `QC barcode matched for process order #${qualityRecord.proc_ord_no}.`,
        data: {
          id: qualityRecord.id,
          proc_ord_no: qualityRecord.proc_ord_no,
          itcd: qualityRecord.itcd,
          barcode: qualityRecord.qc_barcode || "",
          qc_barcode: qualityRecord.qc_barcode || "",
          item_name: qualityRecord.item?.item || "",
          status: qualityRecord.status,
          route: `/accounting/material?tab=production&processOrder=${qualityRecord.proc_ord_no}`,
        },
      });
    }

    const productionPlan = matchedRecord.productionPlan;

    let qualityMaster = await prisma.qualityMaster.upsert({
      where: { proc_ord_no: productionPlan.id },
      update: {
        itcd: productionPlan.finished_id,
        batch_size: Number(productionPlan.qty ?? 0),
      },
      create: {
        proc_ord_no: productionPlan.id,
        itcd: productionPlan.finished_id,
        batch_size: Number(productionPlan.qty ?? 0),
        status: "DRAFT",
      },
    });

    if (!qualityMaster.qc_barcode) {
      qualityMaster = await prisma.qualityMaster.update({
        where: { id: qualityMaster.id },
        data: {
          qc_barcode: buildQualityControlBarcode({
            id: qualityMaster.id,
            procOrdNo: productionPlan.id,
          }),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      created: !productionPlan.qualityMaster,
      direction: "production_to_qc",
      message: productionPlan.qualityMaster
        ? `Quality control already exists for process order #${productionPlan.id}.`
        : `Quality control created for process order #${productionPlan.id}.`,
      data: {
        id: qualityMaster.id,
        proc_ord_no: productionPlan.id,
        itcd: productionPlan.finished_id,
        barcode: productionPlan.barcode || "",
        qc_barcode: qualityMaster.qc_barcode || "",
        item_name: productionPlan.item?.item || "",
        status: qualityMaster.status,
        route: `/accounting/forms/qualitycontrol/${productionPlan.id}`,
      },
    });
  } catch (error) {
    console.error("Error creating QC from scan:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Failed to create quality control record.",
      },
      { status: 500 },
    );
  }
});
