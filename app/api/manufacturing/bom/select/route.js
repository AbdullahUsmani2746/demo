import prisma from '@/lib/prisma';
import { NextResponse } from "next/server";

// app/api/manufacturing/boms/select/route.js
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const filterStatus = searchParams.get('filterStatus') || 'Active'; // Default to active
  
  try {
    const where = {};
    
    // Handle search — each branch is its own OR condition.
    // Sibling keys inside one relation filter would be ANDed together, so
    // item name and item code must be separate entries to match either one.
    if (search) {
      const orConditions = [
        { item: { code: { contains: search, mode: 'insensitive' } } },
        { item: { item: { contains: search, mode: 'insensitive' } } },
      ];

      // Numeric searches also match the BOM id and the finished product id.
      // Only pushed when the term really is a number — an `undefined` value
      // here would become an empty condition that matches every row.
      const numericSearch = Number(search);
      if (search.trim() !== '' && !isNaN(numericSearch)) {
        orConditions.push({ id: numericSearch });
        orConditions.push({ finished_id: numericSearch });
        orConditions.push({ item: { alternate_id: numericSearch } });
      }

      where.OR = orConditions;
    }

    // Default to active BOMs only for selects
    where.instructions = filterStatus === 'Active' ? 'A' : 'B';

    // Get ONLY the data needed for select options
    const boms = await prisma.bomMaster.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 10000, // Reasonable limit for dropdown
      select: {  // 🚀 ONLY SELECT NEEDED FIELDS
        id: true,
        finished_id: true,
        instructions: true,
        item: {
          select: {
            item: true,
            code: true,
            alternate_id: true,
          }
        },
        _count: {
          select: {
            bomDetails: true
          }
        }
      },
    });

    // Transform to select format
    const selectOptions = boms.map((bom) => ({
      value: bom.id,
      label: `${bom.item.code} -${bom.finished_id} - ${bom.item?.item } (${bom._count.bomDetails} materials)`,
      data: bom
    }));

    return NextResponse.json({ 
      data: selectOptions
    }, { status: 200 });
    
  } catch (error) {
    console.error('BOM Select API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}