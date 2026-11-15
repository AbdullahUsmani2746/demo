import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const acno = Number(searchParams.get("acno"));
  const itcd = Number(searchParams.get("itcd"));

  if (!acno || !itcd) {
    return NextResponse.json({ customers: [] });
  }

  const record = await prisma.sALES_ITEM_CUST.findFirst({
    where: {
      acno,
      itcd,
    },
    select: {
      rate: true,
      gst_rate: true,
      dated: true
    },
  });

  return NextResponse.json({
    customers: [
      {
        rate: record?.rate ?? 0,
        gst_rate: record?.gst_rate ?? 0, // ✅ NULL → 0
        dated:record?.dated
      },
    ],
  });
}
