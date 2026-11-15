import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// GET method using Raw SQL - returns value/label format
//
// The search text and tran_code are bound as query parameters (Prisma.sql),
// never pasted into the SQL string: this used $queryRawUnsafe with the
// search interpolated, so ?search=' OR 1=1;-- ran arbitrary SQL.
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const tran_code = parseInt(searchParams.get('tran_code')) || null;

    // ILIKE pattern with the user's % and _ treated as literal characters.
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const invoices = await prisma.$queryRaw`
      SELECT invoice_no
      FROM "TRANSACTIONS_MASTER"
      WHERE invoice_no IS NOT NULL
        AND invoice_no != ''
        ${tran_code ? Prisma.sql`AND tran_code = ${tran_code}` : Prisma.empty}
        ${search ? Prisma.sql`AND invoice_no ILIKE ${pattern}` : Prisma.empty}
      ORDER BY CAST(invoice_no AS INTEGER) DESC
    `;

    // Format for React Select
    const options = invoices
      .filter(item => item.invoice_no)
      .map(item => ({
        value: item.invoice_no,
        label: item.invoice_no
      }));

    return NextResponse.json({
      success: true,
      count: options.length,
      data: options
    });

  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch invoices',
        error: error.message
      },
      { status: 500 }
    );
  }
}
