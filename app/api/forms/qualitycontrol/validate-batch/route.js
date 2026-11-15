// pages/api/qualitycontrol/validate-batch.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const batchNo = searchParams.get('batchNo');
    const productId = searchParams.get('productId');

    if (!batchNo || !productId) {
      return NextResponse.json({ isValid: true });
    }

    const existingBatch = await prisma.qualityMaster.findFirst({
      where: {
        batch_no: parseInt(batchNo),
        itcd: parseInt(productId)
      }
    });

    return NextResponse.json({
      isValid: !existingBatch
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to validate batch number" },
      { status: 500 }
    );
  }
}