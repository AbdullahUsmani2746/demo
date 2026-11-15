import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: "dateFrom and dateTo are required" },
        { status: 400 },
      );
    }

    const fromDate = new Date(dateFrom);
    fromDate.setHours(0, 0, 0, 0);

    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format" },
        { status: 400 },
      );
    }

    const records = await prisma.qualityMaster.findMany({
      where: {
        proc_ord_no: { not: null },
        batch_no: { not: null },
        mfg_date: {
          gte: fromDate,
          lte: toDate,
        },
      },
      include: {
        item: {
          select: { item: true, code: true },
        },
      },
      orderBy: [{ mfg_date: "asc" }, { batch_no: "asc" }],
    });

    const data = records.map((r) => ({
      id: r.id,
      inkCode: r.item?.code || "-",
      description: r.item?.item || "-",
      batchNo: r.batch_no,
      date: r.mfg_date ? r.mfg_date.toISOString().split("T")[0] : "",
    }));

    return NextResponse.json({ success: true, data, total: data.length });
  } catch (error) {
    console.error("Error fetching QC stickers:", error);
    return NextResponse.json(
      { error: "Failed to fetch QC sticker data" },
      { status: 500 },
    );
  }
}
