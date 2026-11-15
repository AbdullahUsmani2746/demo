import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");

    const page = pageParam ? Math.max(1, parseInt(pageParam)) : 1;
    const pageSize = pageSizeParam ? Math.max(1, parseInt(pageSizeParam)) : null;
    const search = (searchParams.get("search") || "").trim();

    const sortField = searchParams.get("sortField") || "attempt_date";
    const sortOrder = (searchParams.get("sortOrder") || "desc").toLowerCase();

    let where = {};
    let total = 0;
    let rows = [];

    const sortRows = (arr) => {
      return arr.sort((a, b) => {
        let aVal, bVal;

        if (sortField === "attempt_date") {
          aVal = a.details?.[0]?.attempt_date ?? new Date(0);
          bVal = b.details?.[0]?.attempt_date ?? new Date(0);
        } else if (sortField === "proc_ord_no") {
          aVal = a.proc_ord_no;
          bVal = b.proc_ord_no;
        } else if (sortField === "itcd") {
          aVal = a.itcd;
          bVal = b.itcd;
        } else if (sortField === "batch_no") {
          aVal = a.batch_no ?? "";
          bVal = b.batch_no ?? "";
        } else {
          aVal = a.proc_ord_no;
          bVal = b.proc_ord_no;
        }

        if (aVal === bVal) return 0;
        if (sortOrder === "asc") return aVal > bVal ? 1 : -1;
        return aVal < bVal ? 1 : -1;
      });
    };

    if (search) {
      const allRowsRaw = await prisma.qualityMaster.findMany({
        include: {
          item: { select: { item: true, code: true } },
          productionPlanMaster: true,
          details: {
            orderBy: { attempt_date: "desc" },
            take: 1,
            select: { attempt_date: true },
          },
        },
      });

      const arr = Array.isArray(allRowsRaw) ? allRowsRaw : [];
      const q = search.toLowerCase();

      const matched = arr.filter((r) => {
        const itemName = (r.item?.item ?? "").toString().toLowerCase();
        const itemCode = (r.item?.code ?? "").toString().toLowerCase();
        const batch = (r.batch_no ?? "").toString().toLowerCase();
        const qcBarcode = (r.qc_barcode ?? "").toString().toLowerCase();
        const itcdStr = r.itcd != null ? String(r.itcd) : "";
        const idStr = r.proc_ord_no != null ? String(r.proc_ord_no) : "";
        return (
          (itemName && itemName.includes(q)) ||
          (itemCode && itemCode.includes(q)) ||
          (batch && batch.includes(q)) ||
          (qcBarcode && qcBarcode.includes(q)) ||
          (itcdStr && itcdStr.includes(q)) ||
          (idStr && idStr.includes(q))
        );
      });

      // Sort matched array
      const sortedMatched = sortRows(matched);

      total = sortedMatched.length;
      if (pageSize) {
        const start = (page - 1) * pageSize;
        rows = sortedMatched.slice(start, start + pageSize);
      } else {
        rows = sortedMatched;
      }
    } else {
      const totalRaw = await prisma.qualityMaster.count({ where });
      total = Number(totalRaw) || 0;

      if (sortField === "attempt_date") {
        const latestAttempts = await prisma.qualityDetail.groupBy({
          by: ["proc_ord_no"],
          _max: {
            attempt_date: true,
          },
        });

        const attemptMap = new Map(
          latestAttempts.map((a) => [a.proc_ord_no, a._max.attempt_date])
        );

        const rowsRaw = await prisma.qualityMaster.findMany({
          where,
          include: {
            item: { select: { item: true, code: true } },
            productionPlanMaster: true,
            details: {
              orderBy: { attempt_date: "desc" },
              take: 1,
              select: { attempt_date: true },
            },
          },
          ...(pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
        });

        rows = rowsRaw.sort((a, b) => {
          const dateA = attemptMap.get(a.proc_ord_no) ?? new Date(0);
          const dateB = attemptMap.get(b.proc_ord_no) ?? new Date(0);
          return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
        });
      } else {
        const orderBy = { [sortField]: sortOrder };

        const rowsRaw = await prisma.qualityMaster.findMany({
          where,
          include: {
            item: { select: { item: true, code: true } },
            productionPlanMaster: true,
            details: {
              orderBy: { attempt_date: "desc" },
              take: 1,
              select: { attempt_date: true },
            },
          },
          orderBy,
          ...(pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
        });
        rows = rowsRaw;
      }
    }

    //all production plan ids
    const allProductionPlanIds = await prisma.productionPlanMaster.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });

    const data = rows.map((r) => ({
      id: r.proc_ord_no,
      planID: r.productionPlanMaster?.id ?? "-",
      itcd: r.itcd ?? "-",
      item_code: r.item?.code || "-",
      item_name: r.item?.item || "-",
      qc_barcode: r.qc_barcode ?? "-",
      batch_no: r.batch_no ?? "-",
      mfg_date: r.mfg_date ? r.mfg_date.toISOString().split("T")[0] : null,
      expiry_date: r.expiry_date ? r.expiry_date.toISOString().split("T")[0] : null,
      batch_size: r.batch_size ?? 0,
      attempt_date: r.details?.[0]?.attempt_date ?? null,
      status: r.status,
      approved_by: r.approved_by || "-",
    }));

    return NextResponse.json({
      page: pageParam ? page : 1,
      pageSize: pageSizeParam ? pageSize : total,
      total,
      totalPages: pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1,
      allProductionPlanIds: allProductionPlanIds.map((p) => p.id),
      data,
    });
  } catch (err) {
    const details =
      err && err.message ? err.message : String(err ?? "Unknown error");
    console.error("Error:", details);
    return NextResponse.json(
      { error: "Failed to fetch data", details },
      { status: 500 }
    );
  }
}
