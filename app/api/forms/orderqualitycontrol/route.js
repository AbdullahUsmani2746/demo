// /api/forms/orderqualitycontrol — receipts against purchase orders waiting for /
// past QC (one row per QualityMaster with order_no, made on QA Entry).
//   ?status=DRAFT|APPROVED|REJECTED  ?search= (order no / batch / item / vendor / barcode)
//   ?page=&pageSize=   counts per status always come back for the tabs.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { isoDay } from "@/lib/quality/qc";

function searchWhere(search) {
  if (!search) return {};
  const n = Number(search);
  const or = [
    { item: { item: { contains: search, mode: "insensitive" } } },
    { item: { code: { contains: search, mode: "insensitive" } } },
    { qa_barcode: { contains: search, mode: "insensitive" } },
    { qc_barcode: { contains: search, mode: "insensitive" } },
    { orderMaster: { acno: { acname: { contains: search, mode: "insensitive" } } } },
  ];
  if (Number.isInteger(n) && n > 0 && n < 2147483647) or.push({ order_no: n }, { batch_no: n }, { grn_no: n });
  return { OR: or };
}

export async function GET(req) {
  try {
    await authorize();
    const sp = new URL(req.url).searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "25", 10) || 25));
    const search = (sp.get("search") || "").trim();
    const status = (sp.get("status") || "").toUpperCase();
    const base = { order_no: { not: null }, ...searchWhere(search) };

    const grouped = await prisma.qualityMaster.groupBy({ by: ["status"], where: base, _count: { _all: true } });
    const counts = { DRAFT: 0, APPROVED: 0, REJECTED: 0 };
    for (const g of grouped) counts[g.status] = (counts[g.status] || 0) + g._count._all;
    counts.ALL = grouped.reduce((n, g) => n + g._count._all, 0);

    const where = { ...base, ...(["DRAFT", "APPROVED", "REJECTED", "HOLD", "REWORK"].includes(status) ? { status } : {}) };
    const [total, rows] = await Promise.all([
      prisma.qualityMaster.count({ where }),
      prisma.qualityMaster.findMany({
        where,
        orderBy: [{ id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          item: { select: { item: true, code: true } },
          orderMaster: { select: { dated: true, acno: { select: { acname: true } } } },
          details: { orderBy: [{ attempt_no: "asc" }, { id: "asc" }], select: { attempt_no: true, parameter_name: true, reject_reason: true, attempt_date: true } },
        },
      }),
    ]);
    const lines = rows.length
      ? await prisma.orderDetail.findMany({
          where: { OR: rows.map((r) => ({ order_no: r.order_no, itcd: r.itcd })) },
          select: { order_no: true, itcd: true, qty: true, unit: true },
        })
      : [];
    const lineOf = new Map(lines.map((l) => [`${l.order_no}-${l.itcd}`, l]));

    const data = rows.map((r) => {
      const line = lineOf.get(`${r.order_no}-${r.itcd}`);
      const decision = r.details.find((d) => d.attempt_no === 0 && d.parameter_name === "qa_decision");
      const received = r.details.find((d) => d.parameter_name === "store_receiving_entry");
      return {
        id: r.id,
        order_no: r.order_no,
        order_date: isoDay(r.orderMaster?.dated),
        vendor_name: r.orderMaster?.acno?.acname || "",
        itcd: r.itcd,
        item_code: r.item?.code || "",
        item_name: r.item?.item || "",
        received_qty: r.batch_size ?? 0,
        ordered_qty: line?.qty ?? 0,
        unit: line?.unit || "",
        batch_no: r.batch_no ?? null,
        status: r.status,
        reason: decision?.reject_reason || "",
        received_on: isoDay(received?.attempt_date),
        grn_status: r.grn_status || "PENDING",
        grn_no: r.grn_no ?? null,
        qa_barcode: r.qa_barcode || "",
        approved_by: r.approved_by || "",
      };
    });

    return NextResponse.json({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), counts, data });
  } catch (err) {
    const res = authErrorResponse(err);
    if (res) return res;
    console.error("Order QC list:", err);
    return NextResponse.json({ error: "Failed to fetch data", details: err.message }, { status: 500 });
  }
}
