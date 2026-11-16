import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";
import { getVendorMacnos } from "@/lib/accounts/partyMacnos";
import { guard } from "@/lib/auth/route";

export const GET = guard(null, async (request) => {
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
    // Off-books vendors are hidden by the prisma client when "Hide off books" is on (lib/prisma.js).
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
});

// The vendor's contact details only — never its group, code, credit or
// account fields (those belong to the chart of accounts / Account Settings).
const EDITABLE = ["acname", "address", "area", "city", "phoneFax", "email", "category", "contactPerson", "salesArea", "ntnNo"];

export const PUT = guard("setup.vendors.manage", async (request) => {
  const body = await request.json();
  const acno = parseInt(body?.acno);
  if (!Number.isInteger(acno)) return NextResponse.json({ error: "Vendor code is required." }, { status: 400 });
  const existing = await prisma.aCNO.findFirst({ where: { acno, macno: { in: await getVendorMacnos() } }, select: { acno: true } });
  if (!existing) return NextResponse.json({ error: "Not a vendor account." }, { status: 404 });
  const data = {};
  for (const key of EDITABLE) if (key in body) data[key] = body[key] === "" ? null : body[key];
  if (data.acname != null) data.acname = String(data.acname).trim();
  if (data.acname === "" || data.acname === null) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  // acno.is_active is ON / OFF books (rule 14, lib/accounts/books.js), not
  // "disabled" — never changed from here.
  const vendor = await prisma.aCNO.update({ where: { acno }, data });
  return NextResponse.json(vendor);
});