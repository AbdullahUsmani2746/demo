// app/api/approvals/requests/[id]/route.js — one held document.
//
//   GET  → the request with its data laid out for reading: header fields by
//          their form labels, lines with item / account names.
//          Visible to its requester and to the rule's approvers.
//   POST { action, remarks }
//          approve  (approver)  → posted now, as its requester (voucher route)
//          reject   (approver)  → reason required; nothing is posted
//          cancel   (requester) → withdrawn while still pending
// A Sale Order waiting for approval has the id "so-<order_no>": it is shown
// by lib/approvals/saleOrders.js and decided by its own engine,
// POST /api/orders/saleOrder/approval (called here, after the self check).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { canDecide, formLabel, notifyRequester, REQUEST_STATUS, selfDecisionError } from "@/lib/approvals/rules";
import { describeConditions, ruleFieldsFor } from "@/lib/approvals/conditions";
import { POST as voucherPost, PUT as voucherPut } from "@/app/api/voucher/[type]/route";
import { POST as orderPost, PUT as orderPut } from "@/app/api/orders/[type]/route";
import { canDecideHr, decideHrRequest, describeHrRequest, hrRequestCancelled, hrSelfError } from "@/lib/hr/approvals";
import { HR_APPROVAL_TYPES, HR_KIND, isHrType } from "@/lib/hr/approvalTypes";
import { describeSaleOrder, diffLines, SO_CATEGORY, soOrderNo } from "@/lib/approvals/saleOrders";
import { POST as saleOrderDecide } from "@/app/api/orders/saleOrder/approval/route";

// The route handler that saves this request: voucher / order × new / edit.
const handlerFor = (request) =>
  request.kind === "order"
    ? request.action === "update" ? orderPut : orderPost
    : request.action === "update" ? voucherPut : voucherPost;

const shown = (v) => (v && typeof v === "object" ? v.label ?? v.value ?? "" : v ?? "");

async function load(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  return prisma.approvalRequest.findUnique({ where: { id: n }, include: { rule: true } });
}

/** An HR request (kind "hr"): laid out by its type in lib/hr/approvals.js. */
async function hrGet(request, session) {
  const approver = await canDecideHr(session, request.doc_type);
  if (!approver && request.requested_by !== session.user.id) {
    return NextResponse.json({ error: "Not yours to see" }, { status: 403 });
  }
  const [{ header, changes, lines }, people] = await Promise.all([
    describeHrRequest(request),
    prisma.user.findMany({ where: { id: { in: [request.requested_by, request.decided_by].filter(Boolean) } }, select: { id: true, name: true, email: true } }),
  ]);
  const nameOf = new Map(people.map((u) => [u.id, u.name || u.email]));
  return NextResponse.json({
    form_path: HR_APPROVAL_TYPES[request.doc_type]?.page ?? null,
    request: {
      id: request.id,
      status: request.status,
      form: formLabel(request.doc_type),
      doc_type: request.doc_type,
      rule_name: request.rule_name,
      action: request.action,
      target_no: null,
      rule_condition: `Decided by anyone holding "${HR_APPROVAL_TYPES[request.doc_type]?.permission}" (Admin → Permissions)`,
      summary: request.summary,
      requested_by: nameOf.get(request.requested_by) || request.requested_by,
      requested_at: request.requested_at,
      decided_by: request.decided_by ? nameOf.get(request.decided_by) || request.decided_by : null,
      decided_at: request.decided_at,
      remarks: request.remarks,
      posted_no: request.posted_no,
      post_error: request.post_error,
      has_ui_state: false,
      mine: request.requested_by === session.user.id,
    },
    header,
    changes,
    lines,
    ui_state: null,
    canDecide: approver && request.status === REQUEST_STATUS.PENDING && !selfDecisionError(session, request) && !(await hrSelfError(request, session)),
    canEdit: request.requested_by === session.user.id && request.status === REQUEST_STATUS.PENDING,
    canReopen: false,
    edit_hint: "To change it, cancel this request and enter the days again.",
  });
}

/** A Sale Order (id "so-<n>"): approve / reject through the Sale Order engine. */
async function saleOrderPost(orderNo, req, session) {
  const { action, remarks } = await req.json();
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "A Sale Order is approved or rejected here — to withdraw it, edit or delete the order." }, { status: 400 });
  }
  const order = await prisma.orderMaster.findFirst({ where: { order_no: orderNo, order_catagory: SO_CATEGORY }, select: { userid: true } });
  if (!order) return NextResponse.json({ error: "Sale Order not found" }, { status: 404 });
  // Nobody decides their own order (ADMIN excepted), as for every request.
  const selfError = selfDecisionError(session, { requested_by: order.userid });
  if (selfError) return NextResponse.json({ error: selfError }, { status: 403 });
  return saleOrderDecide(
    new Request(`http://internal/approvals/so-${orderNo}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_no: orderNo, action, remarks: remarks ?? "" }),
    }),
    { params: Promise.resolve({}) },
  );
}

export const GET = guard(null, async (req, { params, session }) => {
  const rawId = (await params).id;
  const orderNo = soOrderNo(rawId);
  if (orderNo !== null) {
    const detail = await describeSaleOrder(session, orderNo);
    if (detail === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (detail === false) return NextResponse.json({ error: "Not yours to see" }, { status: 403 });
    return NextResponse.json(detail);
  }
  const request = await load(rawId);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.kind === HR_KIND && isHrType(request.doc_type)) return hrGet(request, session);
  const approver = canDecide(session, request.rule);
  if (!approver && request.requested_by !== session.user.id) {
    return NextResponse.json({ error: "Not yours to see" }, { status: 403 });
  }

  const config = VOUCHER_CONFIG[request.doc_type] || {};
  const payload = request.payload || {};
  const master = payload.master || {};
  const lines = (payload.lines || []).filter((l) => l && Object.values(l).some((v) => v !== null && v !== "" && v !== undefined));

  // Names for item codes and accounts in the lines / header.
  const itcds = [...new Set(lines.map((l) => Number(shown(l.itcd))).filter(Number.isFinite))];
  const acnos = [...new Set([...lines.map((l) => Number(shown(l.acno))), Number(shown(master.pycd))].filter(Number.isFinite))];
  const godownIds = [...new Set([master.godown, master.godown2, ...lines.map((l) => l.godown)].map((g) => Number(shown(g))).filter(Number.isFinite))];
  const [items, accounts, godowns, people] = await Promise.all([
    itcds.length ? prisma.item.findMany({ where: { itcd: { in: itcds } }, select: { itcd: true, item: true, code: true } }) : [],
    acnos.length ? prisma.aCNO.findMany({ where: { acno: { in: acnos } }, select: { acno: true, acname: true } }) : [],
    godownIds.length ? prisma.godown.findMany({ where: { id: { in: godownIds } }, select: { id: true, godown: true } }) : [],
    prisma.user.findMany({ where: { id: { in: [request.requested_by, request.decided_by].filter(Boolean) } }, select: { id: true, name: true, email: true } }),
  ]);
  const itemName = new Map(items.map((i) => [i.itcd, `${i.code ? `${i.code} · ` : ""}${i.item}`]));
  const accName = new Map(accounts.map((a) => [a.acno, a.acname]));
  const godownName = new Map(godowns.map((g) => [g.id, g.godown]));
  const nameOf = new Map(people.map((u) => [u.id, u.name || u.email]));

  const pretty = (name, v) => {
    const raw = shown(v);
    const n = Number(raw);
    if (name === "itcd" && itemName.has(n)) return itemName.get(n);
    if ((name === "acno" || name === "pycd") && accName.has(n)) return `${accName.get(n)} (${n})`;
    if ((name === "godown" || name === "godown2") && godownName.has(n)) return godownName.get(n);
    if (name === "dated" && raw) return String(raw).slice(0, 10);
    return raw === "" || raw === null ? "—" : String(raw);
  };

  // An edit: what is saved now, field by field, beside what was asked for.
  let current = null;
  if (request.action === "update" && request.target_id) {
    current =
      request.kind === "order"
        ? await prisma.orderMaster.findUnique({ where: { order_no: Number(request.target_id) } })
        : await prisma.transactionsMaster.findUnique({ where: { tran_id: Number(request.target_id) } });
  }
  // Unchanged? Dates compare by day; everything else as text. A select sends
  // { value, label } — its value is what the saved row holds.
  const norm = (v) => {
    const raw = v instanceof Date ? v.toISOString() : v && typeof v === "object" ? v.value ?? v.label : v;
    const t = String(raw ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
  };
  const same = (a, b) => norm(a) === norm(b);
  const changes = current
    ? (config.masterFields || [])
        .filter((f) => f?.name && f.name in current && master[f.name] !== undefined && !same(current[f.name], master[f.name]))
        .map((f) => ({ label: f.label || f.name, from: pretty(f.name, current[f.name] instanceof Date ? current[f.name].toISOString() : current[f.name]), to: pretty(f.name, master[f.name]) }))
    : [];

  // An edit's item lines: what is saved now vs. what was asked for, by item
  // (qty / rate). Account-only lines (receipts, JVs) are listed in full below.
  let line_changes = [];
  const itemLines = lines.filter((l) => Number.isFinite(Number(shown(l.itcd))) && shown(l.itcd) !== "");
  if (current && itemLines.length) {
    const saved =
      request.kind === "order"
        ? await prisma.orderDetail.findMany({ where: { order_no: Number(request.target_id) }, select: { itcd: true, qty: true, rate: true } })
        : await prisma.transactions.findMany({
            where: { tran_id: Number(request.target_id), itcd: { not: null }, OR: [{ sub_tran_id: 1 }, { sub_tran_id: null }] },
            select: { itcd: true, qty: true, rate: true },
          });
    const asked = itemLines.map((l) => ({ itcd: Number(shown(l.itcd)), qty: shown(l.qty), rate: shown(l.rate) }));
    const nameFor = (itcd) => itemName.get(Number(itcd)) ?? `Item ${itcd}`;
    line_changes = diffLines(saved.map((l) => ({ itcd: l.itcd, qty: l.qty, rate: l.rate })), asked, nameFor);
    // Items only in the saved lines need their names too.
    const unknown = [...new Set(saved.map((l) => l.itcd).filter((i) => !itemName.has(i)))];
    if (unknown.length) {
      const more = await prisma.item.findMany({ where: { itcd: { in: unknown } }, select: { itcd: true, item: true, code: true } });
      const nm = new Map(more.map((i) => [`Item ${i.itcd}`, `${i.code ? `${i.code} · ` : ""}${i.item}`]));
      line_changes = line_changes.map((c) => ({ ...c, item: nm.get(c.item) ?? c.item }));
    }
  }

  const header = (config.masterFields || [])
    .filter((f) => f?.name && master[f.name] !== undefined && master[f.name] !== null && master[f.name] !== "")
    .map((f) => ({ label: f.label || f.name, value: pretty(f.name, master[f.name]) }));
  const lineCols = (config.lineFields || []).filter((f) => f?.name && lines.some((l) => l[f.name] !== undefined && l[f.name] !== null && l[f.name] !== ""));
  const lineRows = lines.map((l) => lineCols.map((f) => pretty(f.name, l[f.name])));

  // The form's list page (where "Edit" re-opens it): its menu entry.
  const menu = await prisma.menus.findFirst({
    where: { url: { endsWith: `/${request.doc_type}` }, is_active: true, NOT: { url: { contains: "/reports/" } } },
    select: { url: true },
  });

  return NextResponse.json({
    form_path: menu?.url ?? null,
    request: {
      id: request.id,
      status: request.status,
      form: formLabel(request.doc_type),
      doc_type: request.doc_type,
      rule_name: request.rule_name,
      action: request.action,
      target_no: request.target_id,
      rule_condition: request.rule ? describeConditions(request.rule, ruleFieldsFor(config)) : null,
      summary: request.summary,
      requested_by: nameOf.get(request.requested_by) || request.requested_by,
      requested_at: request.requested_at,
      decided_by: request.decided_by ? nameOf.get(request.decided_by) || request.decided_by : null,
      decided_at: request.decided_at,
      remarks: request.remarks,
      posted_no: request.posted_no,
      post_error: request.post_error,
      has_ui_state: Boolean(request.ui_state),
      mine: request.requested_by === session.user.id,
    },
    header,
    changes,
    line_changes,
    lines: { columns: lineCols.map((f) => f.label || f.name), rows: lineRows },
    ui_state: request.requested_by === session.user.id && request.status === REQUEST_STATUS.PENDING ? request.ui_state : null,
    canDecide: approver && request.status === REQUEST_STATUS.PENDING && !selfDecisionError(session, request),
    // "Edit in form" re-opens a NEW entry; an edit request is changed by
    // editing the document again (it replaces the waiting one) or cancelled.
    canEdit: request.requested_by === session.user.id && request.status === REQUEST_STATUS.PENDING,
    canReopen: request.action !== "update" && Boolean(request.ui_state),
  });
});

export const POST = guard(null, async (req, { params, session }) => {
  const id = (await params).id;
  const orderNo = soOrderNo(id);
  if (orderNo !== null) return saleOrderPost(orderNo, req, session);
  const request = await load(id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { action, remarks } = await req.json();
  const note = remarks ? String(remarks).trim().slice(0, 500) || null : null;
  if (request.status === REQUEST_STATUS.POSTING) {
    // A claim older than 10 minutes means the posting process died: release
    // it back to pending so it can be approved / rejected / cancelled again.
    const stale = new Date(request.updated_at).getTime() < Date.now() - 10 * 60 * 1000;
    if (!stale) {
      return NextResponse.json({ error: "This request is being posted right now by an approver." }, { status: 409 });
    }
    await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.POSTING },
      data: { status: REQUEST_STATUS.PENDING, post_error: "Previous posting attempt did not finish — retried." },
    });
    request.status = REQUEST_STATUS.PENDING;
  }
  if (request.status !== REQUEST_STATUS.PENDING) {
    return NextResponse.json({ error: `This request is already ${request.status}.` }, { status: 409 });
  }

  if (action === "cancel") {
    if (request.requested_by !== session.user.id) return NextResponse.json({ error: "Only the requester can cancel it." }, { status: 403 });
    const cancelled = await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.PENDING },
      data: { status: REQUEST_STATUS.CANCELLED, decided_at: new Date(), decided_by: session.user.id, remarks: note || "Cancelled by the requester" },
    });
    if (cancelled.count !== 1) return NextResponse.json({ error: "This request is already being decided." }, { status: 409 });
    if (request.kind === HR_KIND) await hrRequestCancelled(request);
    return NextResponse.json({ success: true, message: "Request cancelled — nothing was posted." });
  }

  if (request.kind === HR_KIND && isHrType(request.doc_type)) {
    if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "action must be approve, reject or cancel" }, { status: 400 });
    if (!(await canDecideHr(session, request.doc_type))) return NextResponse.json({ error: "You may not decide this request." }, { status: 403 });
    const hrSelfError = selfDecisionError(session, request);
    if (hrSelfError) return NextResponse.json({ error: hrSelfError }, { status: 403 });
    const { status, body } = await decideHrRequest({ request, action, note, session });
    return NextResponse.json(body, { status });
  }

  if (!canDecide(session, request.rule)) return NextResponse.json({ error: "You are not an approver of this rule." }, { status: 403 });
  const selfError = selfDecisionError(session, request);
  if (selfError) return NextResponse.json({ error: selfError }, { status: 403 });

  if (action === "reject") {
    if (!note) return NextResponse.json({ error: "Give the reason for rejecting — the requester will see it." }, { status: 400 });
    // Only while still pending — an approver may be posting it this moment.
    const claimed = await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.PENDING },
      data: { status: REQUEST_STATUS.REJECTED, decided_by: session.user.id, decided_at: new Date(), remarks: note },
    });
    if (claimed.count !== 1) return NextResponse.json({ error: "This request is already being decided by someone else." }, { status: 409 });
    const done = await prisma.approvalRequest.findUnique({ where: { id: request.id } });
    await notifyRequester(done, "rejected", "error");
    return NextResponse.json({ success: true, message: "Rejected — nothing was posted; the requester has been told why." });
  }

  if (action === "approve") {
    // Post through the voucher route itself, so the document goes through
    // exactly the same checks and postings as a normal save.
    const headers = new Headers({ "x-approval-post": String(request.id) });
    // Cut the text, not its encoding — slicing "%E2%80%94" mid-escape breaks
    // decodeURIComponent on the other side. note is already ≤ 500 chars.
    if (note) headers.set("x-approval-remarks", encodeURIComponent(note.slice(0, 500)));
    const res = await handlerFor(request)(
      new Request(`http://internal/approvals/${request.id}`, { method: request.action === "update" ? "PUT" : "POST", headers }),
      { params: Promise.resolve({ type: request.doc_type }) },
    );
    let json = {};
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    if (res.status >= 300) {
      return NextResponse.json(
        { error: `Approved, but it could not be posted: ${json.message || json.error || res.status}. Fix the cause and approve again.` },
        { status: 422 },
      );
    }
    const no = json.vrNo ?? json.grnNo ?? json.dispatchNo ?? json.order_no ?? json.voucherId ?? request.target_id;
    return NextResponse.json({
      success: true,
      message: request.action === "update" ? `Approved — the edit is applied to #${no}.` : `Approved and posted as #${no}.`,
    });
  }

  return NextResponse.json({ error: "action must be approve, reject or cancel" }, { status: 400 });
});
