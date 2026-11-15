import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const challanNo = url.searchParams.get("challan_no");

    if (!challanNo) {
      return NextResponse.json(
        { message: "Challan number is required" },
        { status: 400 }
      );
    }

    const expectedRmk1 = `Tax challan payment: ${challanNo}`;

    // Check if any Journal Voucher has this exact narration
    const existingVoucher = await prisma.transactionsMaster.findFirst({
      where: {
        tran_code: 3,
        rmk1: {
          equals: expectedRmk1,
        },
      },
      select: {
        tran_id: true,
        vr_no: true,
      }
    });

    if (existingVoucher) {
      return NextResponse.json({
        exists: true,
        message: `This Challan No has already been added to Voucher #${existingVoucher.vr_no || existingVoucher.tran_id}.`
      });
    }

    return NextResponse.json({ exists: false });
  } catch (error) {
    console.error("Check challan error:", error);
    return NextResponse.json(
      { message: "Server error checking challan" },
      { status: 500 }
    );
  }
}
