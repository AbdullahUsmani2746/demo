// app/api/manufacturing/bom/optimized/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bomSaveError, deactivateOtherBoms } from "@/lib/manufacturing/bomRules";

// Enhanced helper function to handle Date objects and BigInt
function convertForJson(obj) {
  if (obj === null || obj === undefined) return obj;

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Handle BigInt
  if (typeof obj === "bigint") {
    return Number(obj);
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(convertForJson);
  }

  // Handle objects
  if (typeof obj === "object") {
    const converted = {};
    for (const key in obj) {
      converted[key] = convertForJson(obj[key]);
    }
    return converted;
  }

  return obj;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const filterStatus = searchParams.get("filterStatus") || "";
  const finished_id = searchParams.get("finished_id");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");

  try {
    // Build WHERE conditions
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 0;

    // Exact match on finished_id (used by SF-to-FG / reprocessing BOM lookups)
    if (finished_id && !isNaN(finished_id)) {
      whereConditions.push(`bm.finished_id = $${++paramCount}`);
      queryParams.push(parseInt(finished_id));
    }

    if (search) {
      whereConditions.push(
        `(i.item ILIKE $${++paramCount} OR bm.finished_id = $${++paramCount} OR i.code ILIKE $${++paramCount})`
      );
      queryParams.push(`%${search}%`, parseInt(search) || 0, `%${search}%`);
    }

    if (filterStatus === "Active") {
      whereConditions.push(`bm.instructions = $${++paramCount}`);
      queryParams.push("A");
    } else if (filterStatus === "Inactive") {
      whereConditions.push(`bm.instructions = $${++paramCount}`);
      queryParams.push("B");
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // **OPTION 1: Convert date to string in the SQL query itself**
    const mainQuery = `
      SELECT 
    bm.id,
    bm.finished_id,
    bm.instructions,
    TO_CHAR(bm.dated, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS dated,

    i.item AS product_name,
    i.code AS product_code,
    i.ic_id AS product_ic_id,        -- ⭐ category id, drives Finished vs Semi-Finished
    i.alternate_id AS alternate_id,  -- ⭐ must be added
    ic.ic_name AS product_category,   -- ⭐ Category name added

    COUNT(bd.id)::integer AS material_count,
    COUNT(rm.receipe_id)::integer AS recipe_count,

    CASE 
      WHEN COUNT(bd.id) = 0 THEN '[]'::json
      ELSE (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'material_id', bd2.material_id::integer,
            'material_percentage', bd2.material_percentage::float,
            'material_desc', mi2.item,
            'material_code', mi2.code,
            'material_alternate_id', mi2.alternate_id,
            'material_category', ic2.ic_name  -- ⭐ Material category inside JSON
          )
        )
        FROM "BomDetail" bd2
        LEFT JOIN "Item" mi2 ON bd2.material_id = mi2.itcd
        LEFT JOIN "ItemCategory" ic2 ON mi2.ic_id = ic2.id   -- ⭐ category join for material
        WHERE bd2.bom_id = bm.id
      )
    END AS bom_details

FROM "BomMaster" bm
LEFT JOIN "Item" i ON bm.finished_id = i.itcd
LEFT JOIN "ItemCategory" ic ON i.ic_id = ic.id   -- ⭐ category join for main product

LEFT JOIN "BomDetail" bd ON bm.id = bd.bom_id
LEFT JOIN "Item" mi ON bd.material_id = mi.itcd

LEFT JOIN "RECEIPE_MASTER" rm ON bm.id = rm.bom_id
${whereClause}

GROUP BY 
    bm.id, 
    bm.finished_id, 
    bm.instructions, 
    bm.dated, 
    i.item,
    ic.ic_name,  -- ⭐ must be added
    i.code,  -- ⭐ must be added
    i.ic_id,  -- ⭐ must be added
    i.alternate_id  -- ⭐ must be added

ORDER BY bm.id DESC
LIMIT $${++paramCount} 
OFFSET $${++paramCount};

    `;

    queryParams.push(limit, (page - 1) * limit);

    // Execute optimized query
    const boms = await prisma.$queryRawUnsafe(mainQuery, ...queryParams);

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT bm.id)::integer as total
      FROM "BomMaster" bm
      LEFT JOIN "Item" i ON bm.finished_id = i.itcd
      ${whereClause}
    `;

    const countParams = queryParams.slice(0, -2);
    const totalResult = await prisma.$queryRawUnsafe(
      countQuery,
      ...countParams
    );

    // Convert any remaining BigInt values and handle dates
    const safeBoms = convertForJson(boms);
    const safeTotal = totalResult[0]?.total || 0;


    if (safeBoms.length > 0) {

    }

    return NextResponse.json({
      data: safeBoms,
      total: safeTotal,
      page,
      limit,
      totalPages: Math.ceil(safeTotal / limit),
    });
  } catch (error) {
    console.error("Optimized BOM API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const POST = guard("bom.manage", async (request) => {
  try {
    const data = await request.json();
    const { finished_id, bomDetails, instructions } = data;
    // Settings → Features "bom.percentRule" (lib/manufacturing/bomRules.js)
    const saveError = await bomSaveError(data, { editing: false });
    if (saveError) return NextResponse.json({ error: saveError }, { status: 422 });

    const master = await prisma.$transaction(async (tx) => {
      const created = await tx.bomMaster.create({
        data: {
          finished_id: parseInt(finished_id),
          instructions,
        },
      });
      for (const mat of bomDetails) {
        await tx.bomDetail.create({
          data: {
            bom_id: created.id,
            material_id: parseInt(mat.material_id),
            material_percentage: mat.material_percentage,
          },
        });
      }
      // "bom.oneActivePerItem": the item's other active BOMs become Inactive
      await deactivateOtherBoms(tx, { bomId: created.id, finishedId: finished_id, instructions });
      return created;
    });
    const newBom = await prisma.bomMaster.findUnique({
      where: { id: master.id },
      include: {
        bomDetails: {
          include: { item: true },
        },
        item: true,
        receipeMasters: true,
      },
    });
    const formattedNew = {
      id: newBom.id,
      finishedId: newBom.finished_id,
      productName: newBom.item.item,
      dateCreated:
        newBom.dated?.toISOString().split("T")[0] ||
        new Date().toISOString().split("T")[0],
      instructions: newBom.instructions,
      status: "Active",
      materials: newBom.bomDetails.map((detail) => ({
        id: detail.material_id,
        name: detail.item.item,
        percentage: detail.material_percentage,
      })),
      linkedRecipes: newBom.receipeMasters.map((recipe) => recipe.receipe_id),
    };
    return NextResponse.json(formattedNew, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
