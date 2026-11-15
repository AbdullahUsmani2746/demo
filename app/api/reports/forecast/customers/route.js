import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { custom } from 'zod';


export async function GET() {
  try {
    // Fetch ACNO list
    const customers = await prisma.aCNO.findMany({
      where: { isActive: true, mainAccount: { isActive: true } },
      select: {
        acno: true,
        acname: true,
      },
      orderBy: { acname: "asc" },
    });

    // Convert to react-select format
    const formatted = customers.map((customer) => ({
      value: customer.acno,
      label: customer.acname,
    }));

    return NextResponse.json(
      { data: formatted },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error loading customers:", err);
    return NextResponse.json(
      { message: "Failed to load customers", error: err.message },
      { status: 500 }
    );
  }
}
