// pages/api/qualitycontrol/batch-numbers.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get('productId');

    if (!productId) {
      return NextResponse.json({ data: [] });
    }

    const batchNumbers = await prisma.qualityMaster.findMany({
      where: {
        itcd: parseInt(productId)
      },
      select: {
        batch_no: true,
        mfg_date: true
      },
      distinct: ['batch_no'],
      orderBy: {
        batch_no: 'desc'
      }
    });

    return NextResponse.json({
      success: true,
      data: batchNumbers
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch batch numbers" },
      { status: 500 }
    );
  }
}