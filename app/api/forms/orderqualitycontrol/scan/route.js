import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  buildOrderQcBarcode,
  buildQaBarcode,
} from "@/lib/orderQualityBarcode.js";
import { guard } from "@/lib/auth/route";

function parseScanValue(rawValue) {
  const input = String(rawValue ?? "").trim();

  if (!input) {
    throw new Error("Scanned QA barcode is required.");
  }

  if (input.startsWith("{") && input.endsWith("}")) {
    const parsed = JSON.parse(input);
    return {
      barcode: parsed.barcode ?? parsed.qaBarcode ?? parsed.qcBarcode ?? parsed.code ?? null,
      orderNo: parsed.orderNo ?? parsed.order_no ?? null,
      itcd: parsed.itcd ?? parsed.itemCode ?? null,
    };
  }

  return {
    barcode: input,
    orderNo: null,
    itcd: null,
  };
}

async function resolveOrderQualityRecord({ barcode, orderNo, itcd }) {
  if (barcode) {
    const qualityRecord = await prisma.qualityMaster.findFirst({
      where: {
        OR: [{ qa_barcode: barcode }, { qc_barcode: barcode }],
      },
      include: {
        item: { select: { item: true } },
      },
    });

    if (qualityRecord) {
      return qualityRecord;
    }
  }

  if (orderNo && itcd) {
    return prisma.qualityMaster.findFirst({
      where: {
        order_no: Number(orderNo),
        itcd: Number(itcd),
      },
      include: {
        item: { select: { item: true } },
      },
    });
  }

  return null;
}

export const POST = guard("qualityControl.manage", async (request) => {
  try {
    const body = await request.json();
    const parsedScan = parseScanValue(body.barcode ?? body.value);
    let qualityRecord = await resolveOrderQualityRecord(parsedScan);

    if (!qualityRecord) {
      return NextResponse.json(
        { ok: false, error: "No QA/QC order matches the scanned barcode." },
        { status: 404 },
      );
    }

    if (!qualityRecord.qa_barcode || !qualityRecord.qc_barcode) {
      qualityRecord = await prisma.qualityMaster.update({
        where: { id: qualityRecord.id },
        data: {
          qa_barcode:
            qualityRecord.qa_barcode ||
            buildQaBarcode({
              orderNo: qualityRecord.order_no,
              itcd: qualityRecord.itcd,
              id: qualityRecord.id,
            }),
          qc_barcode:
            qualityRecord.qc_barcode ||
            buildOrderQcBarcode({
              orderNo: qualityRecord.order_no,
              itcd: qualityRecord.itcd,
              id: qualityRecord.id,
            }),
        },
        include: {
          item: { select: { item: true } },
        },
      });
    }

    const scannedQaBarcode = parsedScan.barcode && parsedScan.barcode === qualityRecord.qa_barcode;

    return NextResponse.json({
      ok: true,
      created: false,
      direction: scannedQaBarcode ? "qa_to_qc" : "qc_to_grn",
      message: scannedQaBarcode
        ? `QA barcode matched for order #${qualityRecord.order_no}.`
        : `QC barcode matched for order #${qualityRecord.order_no}.`,
      data: {
        id: qualityRecord.id,
        order_no: qualityRecord.order_no,
        itcd: qualityRecord.itcd,
        qa_barcode: qualityRecord.qa_barcode || "",
        qc_barcode: qualityRecord.qc_barcode || "",
        item_name: qualityRecord.item?.item || "",
        status: qualityRecord.status,
        grn_status: qualityRecord.grn_status || "PENDING",
        grn_no: qualityRecord.grn_no || null,
        route: scannedQaBarcode
          ? `/accounting/forms/orderqualitycontrol/${qualityRecord.order_no}?itcd=${qualityRecord.itcd}`
          : `/accounting/forms/orderqualitycontrol`,
      },
    });
  } catch (error) {
    console.error("Error scanning order QC barcode:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Failed to process scanned QA barcode.",
      },
      { status: 500 },
    );
  }
});
