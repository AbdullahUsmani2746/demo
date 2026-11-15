import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req) {
  try {
    const { records } = await req.json();

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { message: "No forecast data received" },
        { status: 400 }
      );
    }

    for (const record of records) {
      await prisma.sALES_FORECAST.upsert({
        where: {
          month_customer_itcd: {
            month: record.month,
            customer: record.customer,
            itcd: record.itcd,
          },
        },
        update: { qty: record.qty },
        create: {
          month: record.month,
          customer: record.customer,
          itcd: record.itcd,
          qty: record.qty,
        },
      });
    }

    return NextResponse.json({ message: "Forecast saved" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { message: "Server error", error: err.message },
      { status: 500 }
    );
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const customer = searchParams.get("customer");

    const where = {};
    if (customer) where.customer = Number(customer);

    const records = await prisma.sALES_FORECAST.findMany({
      where,
      include: {
        customerRef: { select: { acname: true } },
        itemRef: { select: { item: true } },
      },
      orderBy: [{ customer: "asc" }, { month: "asc" }, { itcd: "asc" }],
    });

    return NextResponse.json({ data: records });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { message: "Server error", error: err.message },
      { status: 500 }
    );
  }
}

export async function PUT(req) {
  try {
    const { id, qty } = await req.json();
    if (!id) {
      return NextResponse.json({ message: "ID required" }, { status: 400 });
    }

    const updated = await prisma.sALES_FORECAST.update({
      where: { id },
      data: { qty: qty !== undefined ? Number(qty) : null },
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { message: "Server error", error: err.message },
      { status: 500 }
    );
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ message: "ID required" }, { status: 400 });
    }

    await prisma.sALES_FORECAST.delete({ where: { id } });
    return NextResponse.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { message: "Server error", error: err.message },
      { status: 500 }
    );
  }
}
