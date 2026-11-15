

// app/api/customers/route.js
import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { guard } from "@/lib/auth/route";
import { applyFieldPolicy, can } from "@/lib/auth/permissions";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { customerScopeWhere } from "@/lib/auth/salesScope";

// Columns only a privileged user may set. They decide the price terms and
// which book the customer's invoices are numbered in, so they are gated by
// their own permission on top of the field policy — and the whole body is
// filtered to an allow-list, which also closes the mass-assignment finding
// (any column of ACNO used to be settable by anyone who could reach this route).
const CUSTOMER_FIELDS = [
  "macno", "acname", "bankAccountNo", "address", "city", "phoneFax", "email",
  "website", "areaCode", "area", "category", "subCategory", "country",
  "customerBank", "customerBankAddr", "stRegNo", "stReg", "ntnNo",
  "contactPerson", "salesArea", "tax_filing_status", "tax_law_code",
  "customerStatus", "reconStatus", "reconciliationRemarks",
];
const CREDIT_TERM_FIELDS = ["crDays", "crDays2", "crLimit", "stRate"];
const BOOK_FIELDS = ["isActive", "lock"];

/** Keep only columns this user may write, by permission then field policy. */
async function sanitiseCustomer(session, input) {
  const allowed = [...CUSTOMER_FIELDS];
  if (await can(session, "customer.creditTerms.update")) allowed.push(...CREDIT_TERM_FIELDS);
  if (await can(session, "customer.book.update")) allowed.push(...BOOK_FIELDS);

  const data = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) data[key] = input[key];
  }
  return applyFieldPolicy(session, "ACNO", data, { throwOnAttempt: false });
}

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
    // isActive: true,
    // mainAccount: { isActive: true },
    AND: [
      search ? {
        OR: [
          { acname: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
          { acno: { equals: parseInt(search) || undefined } },
        ]
      } : {},
      {macno: {in: await getCustomerMacnos()}},
      city ? { city } : {},
      category ? { category } : {},
      area ? { area } : {},
      salesArea ? { salesArea } : {},
    ]
  };

  // ?scope=own (Customer Management directory): a sales person sees only
  // their own customers (+ team with salesTeam.viewTeam); ADMIN/ACCOUNTANT and
  // salesTeam.viewAll see everyone (lib/auth/salesScope.js). Other callers
  // of this API (vouchers, BOM, items) do not send it and are unchanged.
  if (searchParams.get('scope') === 'own') {
    const session = await getServerSession(authOptions);
    where.AND.push(await customerScopeWhere(session));
  }

  const [customers, total] = await Promise.all([
    prisma.aCNO.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [
        { acno: 'desc' }
      ],
    }),
    prisma.aCNO.count({ where }),
  ]);

  return NextResponse.json({ customers, total });
}

export const POST = guard("customer.create", async (request, { session }) => {
  try {
    const body = await request.json();
    const data = await sanitiseCustomer(session, body);

    const customer = await prisma.aCNO.create({ data });

    return NextResponse.json(customer);
  } catch (error) {
    console.error('POST /customers error:', error);
    return NextResponse.json({ error: "Could not create the customer." }, { status: 500 });
  }
});

export const PUT = guard("customer.update", async (request, { session }) => {
  try {
    const { acno, ...body } = await request.json();
    const data = await sanitiseCustomer(session, body);

    const customer = await prisma.aCNO.update({
      where: { acno: parseInt(acno) },
      data,
    });


    return NextResponse.json(customer);
  } catch (error) {
    console.error('PUT /customers error:', error);
    return NextResponse.json({ error: "Could not update the customer." }, { status: 500 });
  }
});

// Deleting a customer account removes a party the ledger still references,
// so it needs the strongest permission of the three.
export const DELETE = guard("customer.delete", async (request) => {
  try {
    const { acno } = await request.json();
    await prisma.aCNO.delete({ where: { acno: parseInt(acno) } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /customers error:', error);
    return NextResponse.json({ error: "Could not delete the customer." }, { status: 500 });
  }
});