
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

export const POST = guard("bom.manage", async (request) => {
  try {
    const body = await request.json();
    let { ids } = body;

    // Validate IDs
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "BOM IDs array is required" },
        { status: 400 }
      );
    }

    // Convert to integers and filter invalid
    const bomIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));

    if (bomIds.length === 0) {
      return NextResponse.json(
        { error: "No valid BOM IDs provided" },
        { status: 400 }
      );
    }

    // ⭐ Fetch all BOMs in one query using whereIn
    const boms = await prisma.bomMaster.findMany({
      where: {
        id: {
          in: bomIds,
        },
      },
      include: {
        bomDetails: {
          include: {
            item: {
              include: {
                itemCategories: true,
              },
            },
          },
        },
        item: {
          include: {
            itemCategories: true,
          },
        },
        receipeMasters: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    if (!boms || boms.length === 0) {
      return NextResponse.json(
        { error: "No BOMs found with provided IDs" },
        { status: 404 }
      );
    }

    // ⭐ Format all BOMs
    const formatted = boms.map(bom => ({
      id: bom.id,
      finishedId: bom.finished_id,
      productName: bom.item?.item || "N/A",
      productCategory: bom.item?.itemCategories?.ic_name || "N/A",
      dateCreated: bom.dated?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
      instructions: bom.instructions,
      status: 'Active',
    //   createdBy: bom.created_by || "System",
      jobNo: bom.job_no || "N/A",
      
      materials: bom.bomDetails.map(detail => ({
        id: detail.material_id,
        name: detail.item?.item || "N/A",
        code: detail.item?.item_code || "N/A",
        percentage: detail.material_percentage,
        category: detail.item?.itemCategories?.ic_name || "N/A",
      })), 
    }));

    return NextResponse.json({
      success: true,
      data: formatted,
      count: formatted.length,
    }, { status: 200 });

  } catch (error) {
    console.error("BOM Bulk API Error:", error);
    return NextResponse.json(
      { 
        error: "Failed to fetch BOMs",
        details: error.message 
      },
      { status: 500 }
    );
  }
});

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids");

    if (!idsParam) {
      return NextResponse.json(
        { error: "IDs parameter is required (?ids=1,2,3)" },
        { status: 400 }
      );
    }

    // Parse comma-separated IDs
    const ids = idsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "No valid IDs provided" },
        { status: 400 }
      );
    }

    // Use the same logic as POST
    const boms = await prisma.bomMaster.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      include: {
        bomDetails: {
          include: {
            item: {
              include: {
                itemCategories: true,
              },
            },
          },
        },
        item: {
          include: {
            itemCategories: true,
          },
        },
        receipeMasters: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    if (!boms || boms.length === 0) {
      return NextResponse.json(
        { error: "No BOMs found" },
        { status: 404 }
      );
    }

    const formatted = boms.map(bom => ({
      id: bom.id,
      finishedId: bom.finished_id,
      productName: bom.item?.item || "N/A",
      productCategory: bom.item?.itemCategories?.ic_name || "N/A",
      dateCreated: bom.dated?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
      instructions: bom.instructions,
      status: 'Active',
    //   createdBy: bom.created_by || "System",
      jobNo: bom.job_no || "N/A",
      
      materials: bom.bomDetails.map(detail => ({
        id: detail.material_id,
        name: detail.item?.item || "N/A",
        code: detail.item?.item_code || "N/A",
        percentage: detail.material_percentage,
        category: detail.item?.itemCategories?.ic_name || "N/A",
      })),
    }));

    return NextResponse.json({
      success: true,
      data: formatted,
      count: formatted.length,
    }, { status: 200 });

  } catch (error) {
    console.error("BOM Bulk GET Error:", error);
    return NextResponse.json(
      { 
        error: "Failed to fetch BOMs",
        details: error.message 
      },
      { status: 500 }
    );
  }
}