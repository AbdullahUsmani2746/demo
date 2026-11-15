import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// GET handler
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const id = searchParams.get("id") || searchParams.get("bond_id");
    const lc_no = searchParams.get("lc_no");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const skip = (page - 1) * limit;

    // 1. Fetch single In-Bond entry if bond_id is provided
    if (id) {
      const inbound = await prisma.inboundMaster.findUnique({
        where: { id: Number(id) },
        include: {
          acno: true,
          bondLocation: true,
          lcmaster: true,
          transactions: {
            include: {
              itemDetails: true,
            },
          },
        },
      });

      if (!inbound) {
        return NextResponse.json({ error: "In-Bond entry not found" }, { status: 404 });
      }

      // Fetch lc_gl account from the linked LCMaster
      let lcmaster_lc_gl_account = null;
      if (inbound.lcmaster?.lc_gl) {
        lcmaster_lc_gl_account = await prisma.aCNO.findUnique({
          where: { acno: inbound.lcmaster.lc_gl },
          select: { acno: true, acname: true },
        });
      }

      return NextResponse.json({
        ...inbound,
        lcmaster_lc_gl_account,
        lines: inbound.transactions || [],
      });
    }

    // 2. Fetch list of In-Bond entries
    let whereClause = {};
    const conditions = [];

    if (lc_no) {
      conditions.push({ lc_no });
    }

    if (search && search.trim() !== "") {
      conditions.push({
        OR: [
          { bond_id: { contains: search, mode: "insensitive" } },
          // { lc_no: { contains: search, mode: "insensitive" } },
          { bond_ref: { contains: search, mode: "insensitive" } },
          { lc_ref: { contains: search, mode: "insensitive" } },
          { lcmaster: { lc_no: { contains: search, mode: "insensitive" } } },
          // lc_no is the L/C GL account — search its name, e.g. "LC#83326 5069"
          { acno: { acname: { contains: search, mode: "insensitive" } } },
        ],
      });
    }

    if (conditions.length > 0) {
      whereClause = { AND: conditions };
    }

    const [data, total] = await Promise.all([
      prisma.inboundMaster.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { dated: "desc" },
        include: {
          acno: true,
          bondLocation: true,
          lcmaster: true,
          transactions: {
            include: {
              itemDetails: true,
            },
          },
        },
      }),
      prisma.inboundMaster.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limit);

    // List-view LC Items column, one item per line (same format as the L/C list):
    const rows = data.map((entry) => ({
      ...entry,
      items_description: (entry.transactions || [])
        .filter((line) => line.itemDetails)
        .map((line, i) =>
          `${i + 1}) ${[line.itemDetails.code, line.itemDetails.item].filter(Boolean).join(" - ")}`,
        )
        .join("\n") || null,
    }));

    return NextResponse.json({
      data: rows,
      totalPages,
      page,
      limit,
      total,
      success: true,
    });
  } catch (error) {
    console.error("[InBond GET API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch In-Bond data", details: error.message },
      { status: 500 }
    );
  }
}

// POST handler
export const POST = guard("inBond.create", async (request) => {
  try {
    const body = await request.json();
    const { master, lines = [] } = body;

    const lcNo = Number(master?.lc_no?.value || master?.lc_no);
    const bondLocId = Number(master?.bond_location_id?.value || master?.bond_location_id);

    if (!master || !lcNo || !master.bond_id || !bondLocId) {
      return NextResponse.json(
        { error: "lc_no, bond_id and bond_location_id are required" },
        { status: 400 }
      );
    }

    const lcRef = typeof master.lc_ref === "object" ? master.lc_ref?.value : master.lc_ref;
    const lcMasterId = master.lCMasterId ? Number(master.lCMasterId) : null;

    const formattedMaster = {
      lc_no: lcNo,
      lc_ref: lcRef ? String(lcRef) : null,
      lCMasterId: lcMasterId,
      bond_id: master.bond_id,
      bond_location_id: bondLocId,
      dated: master.dated ? new Date(master.dated) : new Date(),
      bond_ref: master.bond_ref || null,
      bond_limit: master.bond_limit ? new Date(master.bond_limit) : new Date(),
    };

    const result = await prisma.$transaction(async (tx) => {
      const createdMaster = await tx.inboundMaster.create({
        data: formattedMaster,
      });

      if (lines.length > 0) {
        const formattedLines = lines.map((line) => ({
          inbound_id: createdMaster.id,
          bl_no: line.bl_no || null,
          itcd: Number(line.itcd?.value || line.itcd),
          qty: Number(line.qty) || 0,
        }));

        await tx.inboundDetail.createMany({
          data: formattedLines,
        });
      }

      return createdMaster;
    });

    return NextResponse.json({
      success: true,
      data: result,
      voucherId: result.bond_id,
      bondId: result.bond_id,
    });
  } catch (error) {
    console.error("[InBond POST API] Error:", error);
    return NextResponse.json(
      { error: "Failed to create In-Bond entry", details: error.message },
      { status: 500 }
    );
  }
});

// PUT handler
export const PUT = guard("inBond.update", async (request) => {
  try {
    const body = await request.json();
    const { master, lines = [] } = body;

    if (!master || (!master.bond_id && !master.id)) {
      return NextResponse.json(
        { error: "bond_id is required" },
        { status: 400 }
      );
    }

    const targetId = Number(master.id || master.voucherId);
    let existingInbound = targetId
      ? await prisma.inboundMaster.findUnique({ where: { id: targetId } })
      : null;

    if (!existingInbound && master.bond_id) {
      existingInbound = await prisma.inboundMaster.findFirst({
        where: { bond_id: master.bond_id },
      });
    }

    if (!existingInbound) {
      return NextResponse.json(
        { error: "In-Bond entry not found for update" },
        { status: 404 }
      );
    }

    const lcNo = Number(master.lc_no?.value || master.lc_no);
    const lcRef = typeof master.lc_ref === "object" ? master.lc_ref?.value : master.lc_ref;
    const lcMasterId = master.lCMasterId ? Number(master.lCMasterId) : null;
    const bondLocId = Number(master.bond_location_id?.value || master.bond_location_id);

    const formattedMaster = {
      ...(lcNo ? { lc_no: lcNo } : {}),
      lc_ref: lcRef ? String(lcRef) : null,
      lCMasterId: lcMasterId,
      ...(bondLocId ? { bond_location_id: bondLocId } : {}),
      ...(master.bond_id ? { bond_id: master.bond_id } : {}),
      dated: master.dated ? new Date(master.dated) : existingInbound.dated,
      bond_ref: master.bond_ref || null,
      bond_limit: master.bond_limit ? new Date(master.bond_limit) : existingInbound.bond_limit,
    };

    const result = await prisma.$transaction(async (tx) => {
      const updatedMaster = await tx.inboundMaster.update({
        where: { id: existingInbound.id },
        data: formattedMaster,
      });

      await tx.inboundDetail.deleteMany({
        where: { inbound_id: updatedMaster.id },
      });

      if (lines.length > 0) {
        const formattedLines = lines.map((line) => ({
          inbound_id: updatedMaster.id,
          bl_no: line.bl_no || null,
          itcd: Number(line.itcd?.value || line.itcd),
          qty: Number(line.qty) || 0,
        }));

        await tx.inboundDetail.createMany({
          data: formattedLines,
        });
      }

      return updatedMaster;
    });

    return NextResponse.json({
      success: true,
      data: result,
      voucherId: result.bond_id,
      bondId: result.bond_id,
    });
  } catch (error) {
    console.error("[InBond PUT API] Error:", error);
    return NextResponse.json(
      { error: "Failed to update In-Bond entry", details: error.message },
      { status: 500 }
    );
  }
});
