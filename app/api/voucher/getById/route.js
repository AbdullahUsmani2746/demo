// /app/api/vouchers/getById/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { documentScopeError } from "@/lib/auth/documentScope";

function serializeBigInt(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const id = parseInt(url.searchParams.get("id"));

    if (!id || isNaN(id)) {
      return NextResponse.json({ message: "Invalid ID" }, { status: 400 });
    }

    const voucher = await prisma.transactionsMaster.findUnique({
      where: { tran_id: id },
      include: {
        acno: true,
        godownDetails: true,
        user: true,
        ordersSO: true,
        transactions: {
          include: {
            itemDetails: true,
            packingDetails: true,
            acnoDetails: true,
            costCenter: true,
            currencyDetails: true,
            godownDetails: true,
          },
        },
      },
    });

    if (!voucher) {
      return NextResponse.json({ message: "Voucher not found" }, { status: 404 });
    }

    // Data scope (Admin → Permissions): another godown's document is not shown.
    const scopeError = await documentScopeError(
      await getServerSession(authOptions), voucher.tran_code, voucher,
    );
    if (scopeError) {
      return NextResponse.json({ message: scopeError }, { status: 403 });
    }

    // Fetch pycd account isActive status for commercial invoice routing
    // pycd ki value se ACNO table mai isActive check karta hai
    // isActive: true  => On customer  => CommercialInvoice
    // isActive: false => Off customer => OffCommercialInvoice
    let pycdAcno = null;
    if (voucher.pycd) {
      pycdAcno = await prisma.aCNO.findUnique({
        where: { acno: Number(voucher.pycd) },
        select: { acno: true, isActive: true },
      });
    }

    // ✅ Convert BigInt fields (like tran_no) to string
    const serializedVoucher = serializeBigInt(voucher);

    return NextResponse.json({ data: { ...serializedVoucher, pycdAcno }, status: 200 });
  } catch (error) {
    console.error("Error fetching voucher by ID:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
