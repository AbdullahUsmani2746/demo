// /app/api/forms/products/route.js
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { feature } from "@/lib/features/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerAcno = searchParams.get('customer');
    const includeAll = searchParams.get('includeAll') === 'true';
    const search = searchParams.get('search');
    const itcdParam = searchParams.get('itcd');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const skip = (page - 1) * limit;

    let items = [];
    let total = 0;

    // Helper function to build search conditions
    const buildSearchConditions = (searchTerm) => {
      if (!searchTerm) return {};
      
      const conditions = [];
      
      // Check if search term is numeric for itcd
      if (!isNaN(searchTerm)) {
        conditions.push({ itcd: parseInt(searchTerm) });
      }
      
      // Always search in code and item fields
      conditions.push({ code: { contains: searchTerm, mode: 'insensitive' } });
      conditions.push({ item: { contains: searchTerm, mode: 'insensitive' } });
      
      return { OR: conditions };
    };

    if (customerAcno) {
      // Build base query for customer-specific products
      const searchConditions = buildSearchConditions(search);
      
      // First, get the item IDs that match search (if any)
      let itemIds = [];
      if (search) {
        const matchingItems = await prisma.item.findMany({
          where: searchConditions,
          select: { itcd: true }
        });
        itemIds = matchingItems.map(item => item.itcd);
      }

      // Build customer product query
      // Settings → Features "saleOrder.priceListOnly": only items ticked on the
      // customer's Sales Items (checked ≠ false) are offered
      const onlyTicked = await feature("saleOrder.priceListOnly");
      const customerWhere = {
        acno: parseInt(customerAcno),
        ...(onlyTicked && { OR: [{ checked: true }, { checked: null }] }),
        ...(search && itemIds.length > 0 && { itcd: { in: itemIds } }),
        ...(itcdParam && !isNaN(itcdParam) && { itcd: parseInt(itcdParam ) })
      };

      // Get paginated results
      const [customerProducts, productCount] = await Promise.all([
        prisma.sALES_ITEM_CUST.findMany({
          where: customerWhere,
          include: {
            item: {
              select: {
                itcd: true,
                item: true,
                code: true,
                unit: true,
                ltr_rate: true, // KG per litre — the sale-order form needs it to price/convert LTR lines
                itemCategories: {
                  select: { ic_name: true }
                }
              }
            }
          },
          skip,
          take: limit,
          orderBy: { item: { itcd: 'asc' } }
        }),
        prisma.sALES_ITEM_CUST.count({ where: customerWhere })
      ]);

      items = customerProducts
        .filter(cp => cp.item) // Ensure item exists
        .map(cp => ({
          itcd: cp.item.itcd,
          item: cp.item.item,
          code: cp.item.code,
          unit: cp.item.unit,
          ltr_rate: cp.item.ltr_rate,
          category: cp.item.itemCategories?.ic_name || "",
          rate: cp.rate,
          gst_rate: cp.gst_rate
        }));
      
      total = productCount;

    } else if (includeAll) {
      // Return all items with optional search or specific itcd lookup
      const searchConditions = buildSearchConditions(search);

      const itcdFilter = itcdParam && !isNaN(itcdParam) ? { itcd: parseInt(itcdParam) } : {};

      const [fetchedItems, itemCount] = await Promise.all([
        prisma.item.findMany({
          where: { ...searchConditions, ...itcdFilter },
          select: {
            itcd: true,
            item: true,
            code: true,
            unit: true,
            ltr_rate: true, // KG per litre — see lib/units/litres.js
            itemCategories: {
              select: { ic_name: true }
            }
          },
          skip,
          take: limit,
          orderBy: { itcd: 'asc' }
        }),
        prisma.item.count({ where: { ...searchConditions, ...itcdFilter } })
      ]);

      items = fetchedItems.map(item => ({
        itcd: item.itcd,
        item: item.item,
        code: item.code,
        unit: item.unit,
        ltr_rate: item.ltr_rate,
        category: item.itemCategories?.ic_name || "",
        rate: 0,
        gst_rate: 0
      }));
      
      total = itemCount;
    }

    return NextResponse.json({
      data: items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: skip + items.length < total
    });

  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Failed to fetch products", details: error.message },
      { status: 500 }
    );
  }
}