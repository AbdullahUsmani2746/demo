import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";
import { getVendorMacnos } from "@/lib/accounts/partyMacnos";
import { guard } from "@/lib/auth/route";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const search = searchParams.get('search') || '';
  const city = searchParams.get('city');
  const category = searchParams.get('category');
  const area = searchParams.get('area');
  const salesArea = searchParams.get('salesArea');

  const where = {
    macno: { in: await getVendorMacnos() },
    isActive: true,
    mainAccount: { isActive: true },
    AND: [
      search ? {
        OR: [
          { acname: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
        ]
      } : {},
      city ? { city } : {},
      category ? { category } : {},
      area ? { area } : {},
      salesArea ? { salesArea } : {},
    ]
  };

  const [vendors, total] = await Promise.all([
    prisma.aCNO.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.aCNO.count({ where }),
  ]);

  return NextResponse.json({ vendors, total });
}

export const PUT = guard("setup.vendors.manage", async (request) => {
  const { acno, ...data } = await request.json();
  const vendor = await prisma.aCNO.update({
    where: { acno: parseInt(acno) },
    data,
  });
  return NextResponse.json(vendor);
});