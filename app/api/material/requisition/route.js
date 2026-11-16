import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setAuditActor } from "@/lib/audit/context";
import { guard, guardBy } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";
import { closedGodownError } from "@/lib/godowns";
import { recordScopeWhere, recordScopeError } from "@/lib/auth/documentScope";
import { feature } from "@/lib/features/server";
import { findHoldingRule, notifyApprovers, runApprovedRequest, REQUEST_STATUS } from "@/lib/approvals/rules";
import { planQtyError } from "@/lib/production/planDuplicates";
import { natureOf } from "@/lib/production/planNature";

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

// ── Dispatch Production Plan lines (category DISPATCH) ──────────────────────
// Features: production.labNature — each line carries the Lab's Nature
// (ReqDetail.nature / nature_at). A change of a SAVED line's Nature is held
// for approval through the approval rules on "Production Plan" (kind "plan",
// lib/approvals/rules.js); the rest of the edit is saved at once and only the
// Nature is applied when approved (applyApprovedNature). Off: the request's
// Nature is ignored and every stored Nature is kept.
// Features: saleOrder.planFromOrder — a Sale Order item's plan qty over every
// plan may not pass its ordered qty, and an item already dispatched is not
// planned (lib/production/planDuplicates.js planQtyError).
const PLAN_APPROVAL_TYPE = "productionPlan";
const categoryOf = (c) => (c && typeof c === "object" ? c.value : c);
const soOfLine = (l) => {
  const v = l?.so_no && typeof l.so_no === "object" ? l.so_no.value : l?.so_no;
  return v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v);
};
const itcdOfLine = (l) => Number(l?.itcd?.value ?? l?.itcd);
const lineKey = (itcd, so) => `${itcd}|${so ?? ""}`;
const numOrNull = (v) => (v !== undefined && v !== null && v !== "" ? Number(v) : null);

// [{ itcd, so_no, from, to }] — saved lines (same item + Sale Order) whose
// Nature is replaced by another. A first Nature on an empty line is not a change.
function savedNatureChanges(savedDetails, lines) {
  const saved = new Map();
  for (const d of savedDetails || []) {
    const k = lineKey(d.itcd, d.so_no ?? null);
    if (d.nature && !saved.has(k)) saved.set(k, d.nature);
  }
  const out = new Map();
  for (const l of lines || []) {
    const itcd = itcdOfLine(l);
    if (!itcd) continue;
    const so = soOfLine(l);
    const k = lineKey(itcd, so);
    const from = saved.get(k);
    const to = natureOf(l.nature);
    if (from && to && from !== to) out.set(k, { itcd, so_no: so, from, to });
  }
  return [...out.values()];
}

// Approved: put the approved Nature on the plan's lines — nothing else.
async function applyApprovedNature(req, session) {
  setAuditActor(session);
  const payload = await req.json();
  const tranId = Number(payload?.master?.tran_id);
  const changes = Array.isArray(payload?.natureChanges) ? payload.natureChanges : [];
  if (!tranId || !changes.length) return NextResponse.json({ message: "Nothing to apply." }, { status: 400 });
  const plan = await prisma.reqMaster.findUnique({ where: { tran_id: tranId }, include: { details: true } });
  if (!plan) return NextResponse.json({ message: `Production Plan #${tranId} no longer exists.` }, { status: 404 });
  const lockError = await checkPeriodLock([plan.dated], 1000, { action: "update" });
  if (lockError) return NextResponse.json({ message: lockError }, { status: 422 });
  const scopeError = await recordScopeError(session, "godown", [plan.issued_for, plan.issued_by]);
  if (scopeError) return NextResponse.json({ message: scopeError }, { status: 403 });

  const now = new Date();
  let applied = 0;
  for (const c of changes) {
    const rows = plan.details.filter((d) => d.itcd === Number(c.itcd) && (d.so_no ?? null) === (c.so_no ?? null));
    if (!rows.length) continue;
    for (const d of rows) {
      if (d.nature === c.to) continue;
      await prisma.reqDetail.update({ where: { id: d.id }, data: { nature: c.to, nature_at: now } });
    }
    applied += 1;
  }
  if (!applied) {
    return NextResponse.json(
      { message: `None of these lines is on Production Plan #${tranId} any more — nothing was changed.` },
      { status: 409 },
    );
  }
  return NextResponse.json({ message: "Nature change applied", tran_no: tranId, voucherId: tranId, status: 200 });
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

    const isPlan = categoryOf(master.req_catagory) === "DISPATCH";
    // Features: saleOrder.planFromOrder — plan qty ≤ Sale Order qty, nothing dispatched
    if (isPlan && (await feature("saleOrder.planFromOrder"))) {
      const qtyError = await planQtyError({
        lines: lines.map((l) => ({ so_no: soOfLine(l), itcd: itcdOfLine(l), qty: l.qty })),
      });
      if (qtyError) return NextResponse.json({ message: qtyError }, { status: 409 });
    }
    // Features: production.labNature — the Lab's Nature per line
    const natureOn = isPlan && (await feature("production.labNature"));
    const now = new Date();

    const requisition = await prisma.reqMaster.create({
      data: {
        userid: String(session.user.id), // Entered by — from the session, never the body
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
            so_no: soOfLine(detail),
            ordered_qty: detail.ordered_qty !== undefined && detail.ordered_qty !== null ? Number(detail.ordered_qty) : null,
            dispatch_qty: detail.dispatch_qty !== undefined && detail.dispatch_qty !== null ? Number(detail.dispatch_qty) : null,
            remarks: detail.remarks,
            ...(natureOn && natureOf(detail.nature) ? { nature: natureOf(detail.nature), nature_at: now } : {}),
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
// An approver applying an approved Nature change (/api/approvals/requests/[id],
// header x-approval-post) need not hold requisition.update — runApprovedRequest
// checks they approve its rule and that the requester still holds it.
export const PUT = guardBy(
  (req) => (req.headers.get("x-approval-post") ? null : "requisition.update"),
  async (req, ctx) => {
  const approvalId = req.headers.get("x-approval-post");
  if (approvalId) {
    const rawRemarks = req.headers.get("x-approval-remarks");
    return runApprovedRequest({
      requestId: Number(approvalId),
      type: PLAN_APPROVAL_TYPE,
      session: ctx.session,
      remarks: rawRemarks ? decodeURIComponent(rawRemarks) : null,
      permission: "requisition.update",
      run: (synthetic, actingSession) => applyApprovedNature(synthetic, actingSession),
    });
  }
  try {
    const session = await getServerSession(authOptions);
    setAuditActor(session);

    const body = await req.json();
    const { master } = body;
    let { lines } = body;

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
      include: { details: true },
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
    const isPlan = (reqCategory || existingReq.req_catagory) === "DISPATCH";
    const natureOn = isPlan && (await feature("production.labNature"));

    // A SAVED line's Nature replaced by another → held for approval when an
    // active rule on "Production Plan" applies and the saver is not its
    // approver. Those lines keep their saved Nature now; the rest is saved.
    let natureHold = null;
    if (natureOn) {
      const changes = savedNatureChanges(existingReq.details, lines);
      if (changes.length) {
        const rule = await findHoldingRule(PLAN_APPROVAL_TYPE, body, "update", session);
        if (rule) {
          const waiting = await prisma.approvalRequest.findFirst({
            where: {
              kind: "plan",
              target_id: String(tranId),
              action: "update",
              status: { in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.POSTING] },
            },
          });
          if (waiting && (waiting.status === REQUEST_STATUS.POSTING || waiting.requested_by !== session?.user?.id)) {
            return NextResponse.json(
              { message: `A Nature change of Production Plan #${tranId} is waiting for approval (#R-${waiting.id}) — put the Nature back to save your other changes, or change it after that is decided.` },
              { status: 409 },
            );
          }
          natureHold = { rule, changes, waiting };
          const savedOf = new Map(changes.map((c) => [lineKey(c.itcd, c.so_no), c.from]));
          lines = lines.map((l) => {
            const k = lineKey(itcdOfLine(l), soOfLine(l));
            return savedOf.has(k) ? { ...l, nature: savedOf.get(k) } : l;
          });
        }
      }
    }

    // Features: saleOrder.planFromOrder — plan qty ≤ Sale Order qty (only new
    // lines / lines whose qty went up are checked)
    if (isPlan && (await feature("saleOrder.planFromOrder"))) {
      const qtyError = await planQtyError({
        lines: lines.map((l) => ({ so_no: soOfLine(l), itcd: itcdOfLine(l), qty: l.qty })),
        tranId,
        existingDetails: existingReq.details,
      });
      if (qtyError) return NextResponse.json({ message: qtyError }, { status: 409 });
    }

    // Lines are deleted and recreated: each line keeps its stored Nature and
    // nature_at unless the Lab changed it here (feature on). Off → stored kept.
    const storedNature = new Map();
    for (const d of existingReq.details) {
      const k = lineKey(d.itcd, d.so_no ?? null);
      if (d.nature && !storedNature.has(k)) storedNature.set(k, { nature: d.nature, nature_at: d.nature_at });
    }
    const now = new Date();
    const natureData = (detail) => {
      const stored = storedNature.get(lineKey(itcdOfLine(detail), soOfLine(detail)));
      if (!natureOn) return stored ? { nature: stored.nature, nature_at: stored.nature_at } : {};
      const asked = natureOf(detail.nature);
      if (!asked) return {};
      if (stored && stored.nature === asked) return { nature: asked, nature_at: stored.nature_at };
      return { nature: asked, nature_at: now };
    };

    // Update master
    await prisma.reqMaster.update({
      where: { tran_id: tranId },
      data: {
        userid: existingReq.userid, // stays the person who entered it
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
      so_no: soOfLine(detail),
      ordered_qty: numOrNull(detail.ordered_qty),
      dispatch_qty: numOrNull(detail.dispatch_qty),
      remarks: detail.remarks || null,
      ...natureData(detail),
    }));

    await prisma.reqDetail.createMany({
      data: orderDetailsData,
    });

    // The held Nature change → one approval request per plan (the
    // requester's own waiting one is replaced). Approvers are told.
    if (natureHold) {
      const { rule, changes, waiting } = natureHold;
      const items = await prisma.item.findMany({
        where: { itcd: { in: [...new Set(changes.map((c) => c.itcd))] } },
        select: { itcd: true, code: true },
      });
      const codeOf = new Map(items.map((i) => [i.itcd, i.code || String(i.itcd)]));
      const data = {
        rule_id: rule.id,
        rule_name: rule.name,
        doc_type: PLAN_APPROVAL_TYPE,
        tran_code: 1000,
        kind: "plan",
        action: "update",
        target_id: String(tranId),
        payload: {
          master: { tran_id: tranId, req_catagory: "DISPATCH", dated: master.dated ?? existingReq.dated },
          lines: changes.map((c) => ({ so_no: c.so_no, itcd: c.itcd, nature: c.to })),
          natureChanges: changes,
        },
        summary: `Nature change · Production Plan #${tranId} · ${changes
          .map((c) => `${c.so_no ? `SO ${c.so_no} ` : ""}${codeOf.get(c.itcd) || c.itcd}: ${c.from} → ${c.to}`)
          .join(", ")}`.slice(0, 500),
      };
      const request = waiting
        ? await prisma.approvalRequest.update({ where: { id: waiting.id }, data: { ...data, post_error: null } })
        : await prisma.approvalRequest.create({ data: { ...data, requested_by: session.user.id } });
      if (!waiting) await notifyApprovers(request, rule);
      return NextResponse.json(
        {
          pendingApproval: true,
          approvalRequestId: request.id,
          updated: Boolean(waiting),
          message:
            rule.message ||
            `Plan saved. The Nature change was sent for approval (${rule.name}) — the old Nature stays until it is approved. Follow it on Approvals → My requests.`,
          tran_no: tranId,
          voucherId: tranId,
        },
        { status: 202 },
      );
    }

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
  },
);
