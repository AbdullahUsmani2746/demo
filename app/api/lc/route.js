import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// GET handler
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const id = searchParams.get("id") || searchParams.get("lc_no");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const skip = (page - 1) * limit;

    // 1. Fetch single LC if id is provided
    if (id) {
      const isNum = !isNaN(Number(id));
      const lc = await prisma.lCMaster.findFirst({
        where: isNum
          ? { OR: [{ id: Number(id) }, { lc_no: id }] }
          : { lc_no: id },
        include: {
          details: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!lc) {
        return NextResponse.json({ error: "LC not found" }, { status: 404 });
      }

      // Fetch lc_gl account details separately
      let lc_gl_account = null;
      if (lc.lc_gl) {
        lc_gl_account = await prisma.aCNO.findUnique({
          where: { acno: lc.lc_gl },
          select: { acno: true, acname: true },
        });
      }

      // Map back to expected UI format
      const formattedLC = {
        ...lc,
        lc_gl_account,
        lines: (lc.details || []).map((line) => ({
          ...line,
          itemDetails: line.item,
        })),
      };

      return NextResponse.json(formattedLC);
    }

    // 2. Fetch list of LCs
    let whereClause = {};
    if (search && search.trim() !== "") {
      whereClause = {
        OR: [
          {
            lc_no: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            indent_no: {
              contains: search,
              mode: "insensitive",
            },
          },
        ],
      };
    }

    const [rawData, total] = await Promise.all([
      prisma.lCMaster.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { lc_date: "desc" },
        include: {
          details: {
            include: {
              item: true,
            },
          },
        },
      }),
      prisma.lCMaster.count({
        where: whereClause,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    // Bulk-fetch account names for lc_gl and beneficiary
    const lcGlIds = [...new Set(rawData.map((lc) => lc.lc_gl).filter(Boolean))];
    const beneficiaryIds = [...new Set(rawData.map((lc) => lc.beneficiary).filter(Boolean))];
    const allAcnos = [...new Set([...lcGlIds, ...beneficiaryIds])];

    let acnoMap = {};
    if (allAcnos.length > 0) {
      const acnos = await prisma.aCNO.findMany({
        where: { acno: { in: allAcnos } },
        select: { acno: true, acname: true },
      });
      acnoMap = Object.fromEntries(acnos.map((a) => [a.acno, a]));
    }

    const data = rawData.map((lc) => ({
      ...lc,
      lc_gl_account: lc.lc_gl ? (acnoMap[lc.lc_gl] || null) : null,
      beneficiary_account: lc.beneficiary ? (acnoMap[lc.beneficiary] || null) : null,
      // List-view Description column, one item per line:
      items_description: (lc.details || [])
        .filter((line) => line.item)
        .map((line, i) =>
          `${i + 1}) ${[line.item.code, line.item.item].filter(Boolean).join(" - ")}`,
        )
        .join("\n") || null,
      lines: (lc.details || []).map((line) => ({
        ...line,
        itemDetails: line.item,
      })),
    }));

    return NextResponse.json({
      data,
      totalPages,
      page,
      limit,
      total,
      success: true,
    });
  } catch (error) {
    console.error("[LC GET API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch LC data", details: error.message },
      { status: 500 }
    );
  }
}

// POST handler
export const POST = guard("letterOfCredit.create", async (request) => {
  try {
    const body = await request.json();
    const { master, lines = [] } = body;

    if (!master || !master.lc_no) {
      return NextResponse.json(
        { error: "Master data and lc_no are required" },
        { status: 400 }
      );
    }

    // Convert dates and parse inputs 
    const formattedMaster = {
      lc_no: master.lc_no,
      contract_no: master.contract_no || null,
      indent_no: master.indent_no || null,
      terms: master.terms || null,
      per_inv_no: master.per_inv_no || null,
      inc_no: master.inc_no || null,
      roi_no: master.roi_no || null,
      cont_no: master.cont_no || null,
      agent: master.agent || null,
      agent_cont_per: master.agent_cont_per || null,
      vessel: master.vessel || null,
      voyage: master.voyage || null,
      vessel_int_no: master.vessel_int_no || null,
      container_no: master.container_no || null,
      cont_seal_no: master.cont_seal_no || null,
      bl_no: master.bl_no || null,
      ship_company: master.ship_company || null,
      remarks: master.remarks || null,

      import_type: master.import_type?.value || master.import_type || null,
      lc_gl: Number(master.lc_gl?.value || master.lc_gl) || null,
      lc_date: master.lc_date ? new Date(master.lc_date) : null,
      lc_exp_date: master.lc_exp_date ? new Date(master.lc_exp_date) : null,
      mny_ship_date: master.mny_ship_date ? new Date(master.mny_ship_date) : null,
      per_inv_date: master.per_inv_date ? new Date(master.per_inv_date) : null,
      etd: master.etd ? new Date(master.etd) : null,
      eta: master.eta ? new Date(master.eta) : null,
      bl_date: master.bl_date ? new Date(master.bl_date) : null,
      doc_arr_date: master.doc_arr_date ? new Date(master.doc_arr_date) : null,
      doc_rtd_due_date: master.doc_rtd_due_date ? new Date(master.doc_rtd_due_date) : null,
      doc_rtd_date: master.doc_rtd_date ? new Date(master.doc_rtd_date) : null,
      bank: Number(master.bank?.value || master.bank) || null,
      beneficiary: Number(master.beneficiary?.value || master.beneficiary) || null,
      lc_acno: master.lc_acno ? Number(master.lc_acno) : null,
      doc_rtd_exc_rate: master.doc_rtd_exc_rate ? Number(master.doc_rtd_exc_rate) : null,
      curr: master.curr?.value || master.curr || null,
    };

    // ── Check for duplicate lc_no ──────────────────────────────────────
    const existingLC = await prisma.lCMaster.findFirst({
      where: { lc_no: master.lc_no },
    });
    if (existingLC) {
      return NextResponse.json(
        { error: `LC No "${master.lc_no}" already exists. Please use a different LC No.` },
        { status: 409 }
      );
    }

    // Use transaction to create both master and details
    const result = await prisma.$transaction(async (tx) => {
      const createdMaster = await tx.lCMaster.create({
        data: formattedMaster,
      });

      if (lines.length > 0) {
        const formattedLines = lines.map((line) => ({
          lcm_id: createdMaster.id,
          bl_no: line.bl_no || null,
          itcd: Number(line.itcd?.value || line.itcd),
          qty: Number(line.qty) || 0,
          fc_rate: Number(line.fc_rate) || 0,
          fc_amount: Number(line.fc_amount) || 0,
          exc_rate: Number(line.exc_rate) || 0,
          pkr_amount: Number(line.pkr_amount) || 0,
          bonded_wh: line.bonded_wh || null,
        }));

        await tx.lCDetail.createMany({
          data: formattedLines,
        });
      }

      return createdMaster;
    });

    return NextResponse.json({
      success: true,
      data: result,
      voucherId: result.lc_no,
      lcNo: result.lc_no,
    });
  } catch (error) {
    console.error("[LC POST API] Error:", error);
    return NextResponse.json(
      { error: "Failed to create LC", details: error.message },
      { status: 500 }
    );
  }
});

// PUT handler
export const PUT = guard("letterOfCredit.update", async (request) => {
  try {
    const body = await request.json();
    const { master, lines = [] } = body;

    if (!master || !master.lc_no) {
      return NextResponse.json(
        { error: "Master data and lc_no are required" },
        { status: 400 }
      );
    }

    const lc_no = master.lc_no;

    // ── Check for duplicate lc_no (exclude current record) ───────────────
    let updateId = master.id;
    if (!updateId) {
      const self = await prisma.lCMaster.findFirst({ where: { lc_no } });
      if (!self) {
        return NextResponse.json({ error: "LC not found" }, { status: 404 });
      }
      updateId = self.id;
    }
    // Check if another record has the same lc_no
    const duplicate = await prisma.lCMaster.findFirst({
      where: { lc_no, NOT: { id: Number(updateId) } },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: `LC No "${lc_no}" already exists. Please use a different LC No.` },
        { status: 409 }
      );
    }

    // Convert dates and parse inputs
    const formattedMaster = {
      lc_no: master.lc_no,
      contract_no: master.contract_no || null,
      indent_no: master.indent_no || null,
      terms: master.terms || null,
      per_inv_no: master.per_inv_no || null,
      inc_no: master.inc_no || null,
      roi_no: master.roi_no || null,
      cont_no: master.cont_no || null,
      agent: master.agent || null,
      agent_cont_per: master.agent_cont_per || null,
      vessel: master.vessel || null,
      voyage: master.voyage || null,
      vessel_int_no: master.vessel_int_no || null,
      container_no: master.container_no || null,
      cont_seal_no: master.cont_seal_no || null,
      bl_no: master.bl_no || null,
      ship_company: master.ship_company || null,
      remarks: master.remarks || null,

      import_type: master.import_type?.value || master.import_type || null,
      lc_gl: Number(master.lc_gl?.value || master.lc_gl) || null,
      lc_date: master.lc_date ? new Date(master.lc_date) : null,
      lc_exp_date: master.lc_exp_date ? new Date(master.lc_exp_date) : null,
      mny_ship_date: master.mny_ship_date ? new Date(master.mny_ship_date) : null,
      per_inv_date: master.per_inv_date ? new Date(master.per_inv_date) : null,
      etd: master.etd ? new Date(master.etd) : null,
      eta: master.eta ? new Date(master.eta) : null,
      bl_date: master.bl_date ? new Date(master.bl_date) : null,
      doc_arr_date: master.doc_arr_date ? new Date(master.doc_arr_date) : null,
      doc_rtd_due_date: master.doc_rtd_due_date ? new Date(master.doc_rtd_due_date) : null,
      doc_rtd_date: master.doc_rtd_date ? new Date(master.doc_rtd_date) : null,
      bank: Number(master.bank?.value || master.bank) || null,
      beneficiary: Number(master.beneficiary?.value || master.beneficiary) || null,
      lc_acno: master.lc_acno ? Number(master.lc_acno) : null,
      doc_rtd_exc_rate: master.doc_rtd_exc_rate ? Number(master.doc_rtd_exc_rate) : null,
      curr: master.curr?.value || master.curr || null,
    };

    // Use transaction to update master and replace details
    const result = await prisma.$transaction(async (tx) => {
      // Use the already-resolved updateId
      const updatedMaster = await tx.lCMaster.update({
        where: { id: Number(updateId) },
        data: formattedMaster,
      });

      // Delete existing details
      await tx.lCDetail.deleteMany({
        where: { lcm_id: updatedMaster.id },
      });

      // Insert new details
      if (lines.length > 0) {
        const formattedLines = lines.map((line) => ({
          lcm_id: updatedMaster.id,
          bl_no: line.bl_no || null,
          itcd: Number(line.itcd?.value || line.itcd),
          qty: Number(line.qty) || 0,
          fc_rate: Number(line.fc_rate) || 0,
          fc_amount: Number(line.fc_amount) || 0,
          exc_rate: Number(line.exc_rate) || 0,
          pkr_amount: Number(line.pkr_amount) || 0,
          bonded_wh: line.bonded_wh || null,
        }));

        await tx.lCDetail.createMany({
          data: formattedLines,
        });
      }

      return updatedMaster;
    });

    return NextResponse.json({
      success: true,
      data: result,
      voucherId: result.lc_no,
      lcNo: result.lc_no,
    });
  } catch (error) {
    console.error("[LC PUT API] Error:", error);
    return NextResponse.json(
      { error: "Failed to update LC", details: error.message },
      { status: 500 }
    );
  }
});
