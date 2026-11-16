// /api/forms/qualitycontrol — production QC list (one row per process order).
//   ?status=DRAFT|HOLD|REWORK|APPROVED|REJECTED   QC records in that status
//   ?status=AWAITING                              finished-goods process orders with no QC yet
//                                                 (finished = Settings → Production setup)
//   ?search=  process order no / batch no / item code or name / QC barcode
//   ?page=&pageSize=   (no pageSize = every row)
//   ?batches=1         distinct batch numbers (report filters)
// Always returns counts per status so the screen's tabs show them.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { getProductionSetup } from "@/lib/production/setup";
import { isoDay, QC_STATUS_ORDER } from "@/lib/quality/qc";

const SORTS = { proc_ord_no: "proc_ord_no", batch_no: "batch_no", mfg_date: "mfg_date", itcd: "itcd", status: "status" };

function searchWhere(search) {
  if (!search) return {};
  const n = Number(search);
  const or = [
    { item: { item: { contains: search, mode: "insensitive" } } },
    { item: { code: { contains: search, mode: "insensitive" } } },
    { qc_barcode: { contains: search, mode: "insensitive" } },
  ];
  if (Number.isInteger(n) && n > 0 && n < 2147483647) or.push({ proc_ord_no: n }, { batch_no: n });
  return { OR: or };
}

function planSearchWhere(search) {
  if (!search) return {};
  const n = Number(search);
  const or = [
    { item: { item: { contains: search, mode: "insensitive" } } },
    { item: { code: { contains: search, mode: "insensitive" } } },
    { batch_no: { contains: search, mode: "insensitive" } },
  ];
  if (Number.isInteger(n) && n > 0 && n < 2147483647) or.push({ id: n });
  return { OR: or };
}

export async function GET(req) {
  try {
    await authorize();
    const sp = new URL(req.url).searchParams;

    if (sp.get("batches") === "1") {
      const rows = await prisma.qualityMaster.findMany({
        where: { proc_ord_no: { not: null }, batch_no: { not: null } },
        select: { batch_no: true },
        distinct: ["batch_no"],
        orderBy: { batch_no: "desc" },
      });
      return NextResponse.json({ data: rows });
    }

    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const pageSize = sp.get("pageSize") ? Math.min(500, Math.max(1, parseInt(sp.get("pageSize"), 10) || 25)) : null;
    const search = (sp.get("search") || "").trim();
    const status = (sp.get("status") || "").toUpperCase();
    const sortField = SORTS[sp.get("sortField")] || "proc_ord_no";
    const sortOrder = (sp.get("sortOrder") || "desc").toLowerCase() === "asc" ? "asc" : "desc";

    const setup = await getProductionSetup();
    const awaitingWhere = {
      qualityMaster: { is: null },
      finished_id: { not: null },
      item: { ic_id: { in: setup.finishedCategoryIds } },
      AND: [{ OR: [{ status: null }, { status: { not: "Cancelled" } }] }],
    };
    const qcBase = { proc_ord_no: { not: null } };

    // Counts per status (+ awaiting), for the tabs.
    const [grouped, awaitingCount] = await Promise.all([
      prisma.qualityMaster.groupBy({ by: ["status"], where: { ...qcBase, ...searchWhere(search) }, _count: { _all: true } }),
      prisma.productionPlanMaster.count({ where: { ...awaitingWhere, ...planSearchWhere(search) } }),
    ]);
    const counts = Object.fromEntries(QC_STATUS_ORDER.map((s) => [s, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;
    counts.AWAITING = awaitingCount;
    counts.ALL = QC_STATUS_ORDER.reduce((n, s) => n + counts[s], 0);

    const paging = pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : {};
    let data;
    let total;

    if (status === "AWAITING") {
      const where = { ...awaitingWhere, ...planSearchWhere(search) };
      total = awaitingCount;
      const plans = await prisma.productionPlanMaster.findMany({
        where,
        orderBy: { id: sortOrder },
        ...paging,
        select: { id: true, dated: true, qty: true, status: true, batch_no: true, finished_id: true, customer_name: true, item: { select: { code: true, item: true } } },
      });
      data = plans.map((p) => ({
        id: p.id, qc_id: null, itcd: p.finished_id, item_code: p.item?.code || "", item_name: p.item?.item || "",
        qc_barcode: "", batch_no: null, plan_batch_no: p.batch_no || "", mfg_date: null, expiry_date: null,
        batch_size: p.qty ?? 0, attempt_date: null, status: null, approved_by: "",
        plan_status: p.status || "", plan_date: isoDay(p.dated), customer_name: p.customer_name || "",
      }));
    } else {
      const where = { ...qcBase, ...searchWhere(search), ...(QC_STATUS_ORDER.includes(status) ? { status } : {}) };
      total = await prisma.qualityMaster.count({ where });
      const rows = await prisma.qualityMaster.findMany({
        where,
        orderBy: [{ [sortField]: sortOrder }, { id: "desc" }],
        ...paging,
        include: {
          item: { select: { item: true, code: true } },
          productionPlanMaster: { select: { id: true, dated: true, status: true, customer_name: true } },
          details: { orderBy: { attempt_date: "desc" }, take: 1, select: { attempt_date: true, attempt_no: true, reject_reason: true } },
        },
      });
      const reasons = rows.length
        ? await prisma.qualityDetail.findMany({
            where: { master_id: { in: rows.map((r) => r.id) }, reject_reason: { not: null } },
            orderBy: [{ attempt_no: "desc" }, { id: "desc" }],
            select: { master_id: true, reject_reason: true },
          })
        : [];
      const reasonOf = new Map();
      for (const r of reasons) if (!reasonOf.has(r.master_id)) reasonOf.set(r.master_id, r.reject_reason);
      data = rows.map((r) => ({
        id: r.proc_ord_no,
        qc_id: r.id,
        planID: r.productionPlanMaster?.id ?? null,
        itcd: r.itcd,
        item_code: r.item?.code || "",
        item_name: r.item?.item || "",
        qc_barcode: r.qc_barcode || "",
        batch_no: r.batch_no ?? null,
        mfg_date: isoDay(r.mfg_date) || null,
        expiry_date: isoDay(r.expiry_date) || null,
        batch_size: r.batch_size ?? 0,
        attempt_date: r.details?.[0]?.attempt_date ?? null,
        attempt_no: r.details?.[0]?.attempt_no ?? null,
        status: r.status,
        reason: ["REJECTED", "HOLD", "REWORK"].includes(r.status) ? reasonOf.get(r.id) || "" : "",
        approved_by: r.approved_by || "",
        remarks: r.remarks || "",
        plan_status: r.productionPlanMaster?.status || "",
        plan_date: isoDay(r.productionPlanMaster?.dated),
        customer_name: r.productionPlanMaster?.customer_name || "",
      }));
    }

    return NextResponse.json({
      page,
      pageSize: pageSize ?? total,
      total,
      totalPages: pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1,
      counts,
      data,
    });
  } catch (err) {
    const res = authErrorResponse(err);
    if (res) return res;
    console.error("QC list:", err);
    return NextResponse.json({ error: "Failed to fetch data", details: err.message }, { status: 500 });
  }
}
