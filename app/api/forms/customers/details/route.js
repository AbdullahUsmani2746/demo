

// app/api/customers/route.js
import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const acno = parseInt(searchParams.get('acno'));

  const where = {
    ...(acno ? { acno } : {})
    
  };

  const [customers, total] = await Promise.all([
    prisma.aCNO.findMany({
      where,
      select: {
        crDays: true,
        address: true,
        subCategory: true,
        // Official (true) / Unofficial (false) — shown beside the Sale Order customer
        isActive: true,
      }
    }),
  ]);

  return NextResponse.json({ customers});
}
