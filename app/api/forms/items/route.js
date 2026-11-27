import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { recordScopeError } from "@/lib/auth/documentScope";
import { feature } from "@/lib/features/server";
import { plantIdOf, processLinkError } from "@/lib/items/processLink";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const cat = searchParams.get("category") || "";

    // Extract query parameters
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const search = searchParams.get("search") || "";
    const sortField = searchParams.get("sortField") || "itcd";
    const sortOrder = searchParams.get("sortOrder") || "asc";
    const exportAll = searchParams.get("export") === "true"; // Check if exporting all items

    // Calculate offset for pagination (skip if exporting all)
    const offset = exportAll ? 0 : (page - 1) * limit;
    const actualLimit = exportAll ? 1000000 : limit; // Large number for export all

    // Convert category string to numbers and filter out invalid values
    const categoryIds = cat
      ? cat
        .split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id))
      : [];

    // Build category filter
    let categoryFilter = {};
    if (categoryIds.length > 0) {
      if (categoryIds.length === 1) {
        // Single category
        categoryFilter = { ic_id: categoryIds[0] };
      } else {
        // Multiple categories
        categoryFilter = {
          ic_id: {
            in: categoryIds,
          },
        };
      }
    }

    // Build where clause for search AND categories
    const whereClause = {
      AND: [
        // Search conditions (if any)
        search
          ? {
            OR: [
              {
                item: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                code: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                unit: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                itcd: {
                  equals: isNaN(parseInt(search))
                    ? undefined
                    : parseInt(search),
                },
              },
            ].filter(
              (condition) =>
                condition.itcd?.equals !== undefined ||
                condition.item ||
                condition.code ||
                condition.unit
            ),
          }
          : {},

        // Category filter (if any)
        categoryIds.length > 0 ? categoryFilter : {},
      ].filter((condition) => Object.keys(condition).length > 0), // Remove empty conditions
    };

    // If no conditions, use empty where clause
    const finalWhereClause =
      Object.keys(whereClause.AND).length > 0 ? whereClause : {};

    // Build orderBy clause for sorting
    const orderByClause = {};
    if (sortField && ["itcd", "item", "code", "unit"].includes(sortField)) {
      orderByClause[sortField] = sortOrder === "desc" ? "desc" : "asc";
    }

    // Get total count for pagination
    const total = await prisma.item.count({
      where: finalWhereClause,
    });

    // Get items with pagination, search, and sorting
    const items = await prisma.item.findMany({
      where: finalWhereClause,
      include: {
        itemCategories: true,
        subtrateRef: true,
        item_qualities: true,
      },
      orderBy: orderByClause,
      skip: offset,
      take: actualLimit,
    });

    // If exporting all, return items directly without pagination info
    if (exportAll) {
      return NextResponse.json({ items });
    }

    // Calculate total pages
    const pages = Math.ceil(total / limit);

    // Return paginated response
    return NextResponse.json({
      items,
      pagination: {
        page,
        limit,
        total,
        pages,
        hasNext: page < pages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching items:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch items",
        details: error.message,
      },
      {
        status: 500,
      }
    );
  }
}
export const POST = guard("setup.items.manage", async (request, { session }) => {
  try {
    const data = await request.json();
    // "Packing Returnable?" only while Settings → Features "documents.returnablePacking" is on.
    if (!(await feature("documents.returnablePacking"))) delete data.packing_returnable;

    // Data scope (Admin → Permissions → Item categories): only items of the
    // person's own categories.
    const scopeError = await recordScopeError(session, "itemCategory", [data.ic_id]);
    if (scopeError) {
      return NextResponse.json({ error: `${scopeError} Choose one of your item categories.` }, { status: 403 });
    }

    // Material description is deliberately NOT unique: the same description
    // legitimately appears on several items (different ink codes, customers or
    // substrates for the same product). The ink code below is the identity
    // that must stay unique.
    const itemName = data.item?.trim();

    // In-process stock of (Item.plant_id) — lib/items/processLink.js; only
    // while Settings → Features "costing.inProcessLink" is on
    if (await feature("costing.inProcessLink")) {
      data.plant_id = plantIdOf(data.plant_id);
      const linkError = await processLinkError(prisma, null, data.plant_id);
      if (linkError) return NextResponse.json({ error: linkError }, { status: 400 });
    } else {
      delete data.plant_id;
    }
    // Costing "Gets plant expenses?" — only a true / false tick is stored
    if (data.gets_plant_expenses !== undefined) data.gets_plant_expenses = data.gets_plant_expenses === true;

    const inkCode = data.code?.trim();
    if (inkCode) {
      const existingCode = await prisma.item.findFirst({
        where: { code: { equals: inkCode, mode: "insensitive" } },
      });

      if (existingCode) {
        return NextResponse.json(
          { error: `Ink code "${inkCode}" is already used by "${existingCode.item}" (itcd ${existingCode.itcd}).` },
          { status: 409 }
        );
      }
    }

    //insert lamination into SRLamination table if it doesn't exist
    if (data.lamination) {
      await prisma.sRLamination.upsert({
        where: { sr_lamination: data.lamination },
        update: {},
        create: { sr_lamination: data.lamination },
      });
    }

    // Add dummy itcd value (PostgreSQL trigger will overwrite it)
    const itemData = {
      ...data,
      ...(itemName ? { item: itemName } : {}),
      ...(inkCode ? { code: inkCode } : {}),
      // itcd: 999, // Any dummy number - PostgreSQL will replace it
    };

    const item = await prisma.item.create({
      data: itemData,
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create item", details: error.message },
      { status: 500 }
    );
  }
});
