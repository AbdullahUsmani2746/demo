import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setAuditActor } from "@/lib/audit/context";
import { guard } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";
import { closedGodownError } from "@/lib/godowns";
import { recordScopeWhere, recordScopeError } from "@/lib/auth/documentScope";

// ─────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY GUARD
// ─────────────────────────────────────────────────────────────────────────────
const _inFlight = (globalThis.__reqInFlight ??= new Map());
const IDEMPOTENCY_TTL_MS = 15_000;

function checkIdempotency(key) {
  if (!key) return false;
  if (_inFlight.has(key)) return true;
  _inFlight.set(key, Date.now());
  setTimeout(() => _inFlight.delete(key), IDEMPOTENCY_TTL_MS);
  return false;
}

// ==================== GET ====================
export async function GET(req) {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const tranNo = parseInt(url.searchParams.get("tranNo") || -1);
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search") || "";

  // ✅ Naye date filter parameters add karein
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  // Multi-value filter support
  const multiFiltersParam = url.searchParams.get("multiFilters");
  let multiFilterWhere = {};
  if (multiFiltersParam) {
    try {
      const parsed = JSON.parse(multiFiltersParam);
      const conditions = Object.entries(parsed)
        .filter(([, vals]) => Array.isArray(vals) && vals.length > 0)
        .map(([field, vals]) => ({ [field]: { in: vals } }));
      if (conditions.length > 0) {
        multiFilterWhere = { AND: conditions };
      }
    } catch (e) {
      // ignore invalid JSON
    }
  }

  const skip = (page - 1) * limit;

  // ✅ Date filter logic add karein
  const dateFilter = {};
  if (startDate && endDate) {
    dateFilter.dated = {
      gte: new Date(startDate),
      lte: new Date(endDate + "T23:59:59.999Z"), // End of day
    };
  } else if (startDate) {
    dateFilter.dated = {
      gte: new Date(startDate),
    };
  } else if (endDate) {
    dateFilter.dated = {
      lte: new Date(endDate + "T23:59:59.999Z"),
    };
  }
  // Data scope (Admin → Permissions): only requisitions to / from the user's
  // own godowns (either side).
  const scopeOr = await recordScopeWhere(
    await getServerSession(authOptions), "godown", ["issued_for", "issued_by"],
  );

  const [requisitions, total] = await Promise.all([
    prisma.reqMaster.findMany({
      where: {
        ...(category && { req_catagory: category }),
        ...(search && {
          OR: [
            { godown2Details: { godown: { contains: search, mode: "insensitive" } } },
            {userid: { contains: search, mode: "insensitive" } },
            {
              tran_id: {
                equals: isNaN(Number(search)) ? undefined : Number(search),
              },
            },
          ],
        }),
        ...dateFilter,
        ...multiFilterWhere,
        ...(scopeOr && { AND: [...(multiFilterWhere.AND || []), scopeOr] }),
      },
      skip,
      take: limit,
      orderBy: { tran_id: "desc" },
      include: {
        details: {
          include: {
            item: true,
          },
        },
        godown2Details: true,
        godownDetails: true,
      },
    }),
    prisma.reqMaster.count({ }),
  ]);

  // Collect all unique so_no values from requisitions and details
  const soNos = new Set();
  for (const req of requisitions) {
    if (req.so_no) soNos.add(req.so_no);
    for (const d of req.details || []) {
      if (d.so_no) soNos.add(d.so_no);
    }
  }

  const soCustomerMap = {};
  if (soNos.size > 0) {
    const orders = await prisma.orderMaster.findMany({
      where: { order_no: { in: Array.from(soNos) } },
      include: { acno: true },
    });
    for (const order of orders) {
      soCustomerMap[order.order_no] = order.acno?.acname || "";
    }
  }

  const requisitionsWithCustomer = requisitions.map((req) => {
    const masterSoNo = req.so_no || req.details?.find((d) => d.so_no)?.so_no || null;
    const masterAcname =
      (req.so_no && soCustomerMap[req.so_no]) ||
      (req.details?.find((d) => d.so_no && soCustomerMap[d.so_no])
        ? soCustomerMap[req.details.find((d) => d.so_no && soCustomerMap[d.so_no]).so_no]
        : "");
    return {
      ...req,
      so_no: masterSoNo || req.so_no,
      acname: masterAcname,
      details: (req.details || []).map((d) => ({
        ...d,
        acname: (d.so_no && soCustomerMap[d.so_no]) || masterAcname || "",
      })),
    };
  });

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    data: requisitionsWithCustomer,
    totalPages,
    page,
    limit,
    total: total,
    status: 200,
  });
}

// ==================== POST ====================
export const POST = guard("requisition.create", async (req) => {
  try {
    const session = await getServerSession(authOptions);
    setAuditActor(session);

    const idempotencyKey = req.headers.get("x-idempotency-key");
    if (checkIdempotency(idempotencyKey)) {
      return NextResponse.json(
        { message: "Duplicate request — this requisition was already submitted." },
        { status: 409 }
      );
    }

    const body = await req.json();
    const { master, lines } = body;

    if (!master || typeof master !== "object") {
      return NextResponse.json(
        { message: "Master object required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(lines)) {
      return NextResponse.json(
        { message: "Details must be an array" },
        { status: 400 }
      );
    }

    
    const lockError = await checkPeriodLock(master.dated || new Date(), 1000, { action: "create" });
    if (lockError) {
      return NextResponse.json({ message: lockError }, { status: 422 });
    }

    const godownError = await closedGodownError([master.issued_for, master.issued_by]);
    if (godownError) {
      return NextResponse.json({ message: godownError }, { status: 422 });
    }

    // Data scope: one side must be the user's own godown.
    const scopeError = await recordScopeError(session, "godown", [master.issued_for, master.issued_by]);
    if (scopeError) {
      return NextResponse.json({ message: scopeError }, { status: 403 });
    }

    const firstSoNo = lines[0]?.so_no?.value
      ? Number(lines[0].so_no.value)
      : lines[0]?.so_no
      ? Number(lines[0].so_no)
      : null;

    const requisition = await prisma.reqMaster.create({
      data: {
        userid: master.userid,
        dated: master.dated ? new Date(master.dated) : new Date(),
        issued_for: Number(master.issued_for?.value) || null,
        app_date: master.app_date ? new Date(master.app_date) : null,
        issued_by: Number(master.issued_by?.value) || null,
        req_catagory: master.req_catagory.value,
        so_no: firstSoNo,
        details: {
          create: lines.map((detail) => ({
            itcd: Number(detail.itcd),
            qty: detail.qty,
            ap_qty: detail.ap_qty,
            so_no: detail.so_no?.value !==undefined ? Number(detail.so_no?.value) : (detail.so_no !==undefined && detail.so_no !== null && isNaN(Number(detail.so_no)) ? Numbe(detail.so_no) : null),
            ordered_qty: detail.ordered_qty !== undefined && detail.ordered_qty !== null ? Number(detail.ordered_qty) : null,
            dispatch_qty: detail.dispatch_qty !== undefined && detail.dispatch_qty !== null ? Number(detail.dispatch_qty) : null,
            remarks: detail.remarks,
          })),
        },
      },
      include: { details: true },
    });

    return NextResponse.json({
      message: "Requisition created successfully",
      tran_no: requisition.tran_id,
      status: 201,
    });
  } catch (error) {
    console.error("Error creating requisition:", error);
    return NextResponse.json(
      { message: "Server error", error: error.message },
      { status: 500 }
    );
  }
});

// ==================== PUT ====================
export const PUT = guard("requisition.update", async (req) => {
  try {
    const session = await getServerSession(authOptions);
    setAuditActor(session);

    const body = await req.json();
    const { master, lines } = body;

    if (!master || typeof master !== "object") {
      return NextResponse.json(
        { message: "Master object required" },
        { status: 400 }
      );
    }

    const tranId = Number(master.tran_id || master.tran_no || master.voucherId);

    if (!tranId || isNaN(tranId)) {
      return NextResponse.json(
        { message: "tran_id is required for update" },
        { status: 400 }
      );
    }

    // Check if existing record exists
    const existingReq = await prisma.reqMaster.findUnique({
      where: { tran_id: tranId },
    });

    if (!existingReq) {
      return NextResponse.json(
        { message: "Requisition not found" },
        { status: 404 }
      );
    }

    const lockError = await checkPeriodLock([existingReq.dated, master.dated], 1000, { action: "update" });
    if (lockError) {
      return NextResponse.json({ message: lockError }, { status: 422 });
    }

    const godownError = await closedGodownError([master.issued_for, master.issued_by], {
      allow: [existingReq.issued_for, existingReq.issued_by],
    });
    if (godownError) {
      return NextResponse.json({ message: godownError }, { status: 422 });
    }

    // Data scope: the stored requisition and the edited one must both be the user's.
    const scopeError =
      (await recordScopeError(session, "godown", [existingReq.issued_for, existingReq.issued_by])) ||
      (await recordScopeError(session, "godown", [master.issued_for, master.issued_by]));
    if (scopeError) {
      return NextResponse.json({ message: scopeError }, { status: 403 });
    }

    if (!Array.isArray(lines)) {
      return NextResponse.json(
        { message: "Details must be an array" },
        { status: 400 }
      );
    }

    const firstSoNo = lines[0]?.so_no?.value
      ? Number(lines[0].so_no.value)
      : lines[0]?.so_no
      ? Number(lines[0].so_no)
      : null;

    const reqCategory = typeof master.req_catagory === "object"
      ? master.req_catagory?.value || master.req_catagory
      : master.req_catagory;

    // Update master
    await prisma.reqMaster.update({
      where: { tran_id: tranId },
      data: {
        userid: master.userid || existingReq.userid,
        dated: master.dated ? new Date(master.dated) : existingReq.dated,
        issued_for: master.issued_for?.value
          ? Number(master.issued_for.value)
          : (master.issued_for != null && master.issued_for !== "" ? Number(master.issued_for) : existingReq.issued_for),
        app_date: master.app_date ? new Date(master.app_date) : existingReq.app_date,
        issued_by: master.issued_by?.value
          ? Number(master.issued_by.value)
          : (master.issued_by != null && master.issued_by !== "" ? Number(master.issued_by) : existingReq.issued_by),
        req_catagory: reqCategory || existingReq.req_catagory,
        so_no: firstSoNo || existingReq.so_no,
      },
    });

    // Delete old details & create new details
    await prisma.reqDetail.deleteMany({
      where: { tran_id: tranId },
    });

    const orderDetailsData = lines.map((detail) => ({
      tran_id: tranId,
      itcd: Number(detail.itcd?.value || detail.itcd),
      qty: Number(detail.qty || 0),
      ap_qty: detail.ap_qty != null ? Number(detail.ap_qty) : null,
      so_no: detail.so_no?.value !== undefined
        ? Number(detail.so_no.value)
        : (detail.so_no !== undefined && detail.so_no !== null && !isNaN(Number(detail.so_no)) ? Number(detail.so_no) : null),
      ordered_qty: detail.ordered_qty !== undefined && detail.ordered_qty !== null ? Number(detail.ordered_qty) : null,
      dispatch_qty: detail.dispatch_qty !== undefined && detail.dispatch_qty !== null ? Number(detail.dispatch_qty) : null,
      remarks: detail.remarks || null,
    }));

    await prisma.reqDetail.createMany({
      data: orderDetailsData,
    });

    return NextResponse.json({
      message: "Requisition updated successfully",
      tran_no: tranId,
      voucherId: tranId,
      status: 200,
    });
  } catch (error) {
    console.error("Error updating requisition:", error);
    return NextResponse.json(
      { message: "Server error", error: error.message },
      { status: 500 }
    );
  }
});
