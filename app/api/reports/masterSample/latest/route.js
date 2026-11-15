import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const isSample = searchParams.get('is_Card') === 'true';

    const typeFilter = isSample
      ? Prisma.sql`"is_Card" = true`
      : Prisma.sql`("is_Card" = false OR "is_Card" IS NULL)`;

    const rows = await prisma.$queryRaw`
      (
        -- Priority 1: oldest discarded item whose alternate_id isn't reused
        SELECT i1.alternate_id AS value, 1 AS priority
        FROM "Item" i1
        WHERE i1.discard = true
          AND i1.alternate_id IS NOT NULL
          AND ${typeFilter}
          AND NOT EXISTS (
            SELECT 1 FROM "Item" i2
            WHERE i2.discard = false
              AND i2.alternate_id = i1.alternate_id
          )
        ORDER BY i1.cdate ASC
        LIMIT 1
      )
      UNION ALL
      (
        -- Priority 2: fallback, next in sequence
        SELECT COALESCE(MAX(alternate_id), 0) + 1 AS value, 2 AS priority
        FROM "Item"
        WHERE alternate_id IS NOT NULL
          AND ${typeFilter}
      )
      ORDER BY priority ASC
      LIMIT 1
    `;

    const latestSampleNo = Number(rows[0]?.value ?? 1);
    return NextResponse.json({ latestSampleNo });
  } catch (error) {
    console.error('Failed to fetch latest master sample:', error);
    return new NextResponse('Server error', { status: 500 });
  }
}