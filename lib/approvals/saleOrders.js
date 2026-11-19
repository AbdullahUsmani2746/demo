// lib/approvals/saleOrders.js — Sale Orders waiting for approval, as rows of
// the Approvals inbox (/dashboard/approvals).
//
// A Sale Order with an approval reason (Free of Cost, Trial Process, Rate Under
// Negotiation, No Godown, Bad-Debt / Bad-Payment customer) is NOT an
// ApprovalRequest: it is saved at OrderMaster.status 3 and decided by
// POST /api/orders/saleOrder/approval (the engine — approve → 1/2, reject → 4).
// This file only shows them: who may see / decide which order (the same scope
// the engine uses — it imports it from here), list rows and the detail view.
// Their inbox id is "so-<order_no>", so they never clash with request ids.
import prisma from "@/lib/prisma";
import { canDecide, selfDecisionError } from "@/lib/approvals/rules";
import { SO_STATUS, canApproveSaleOrders, reasonsOf } from "@/lib/orders/saleOrderApproval";
import { CREDIT_LIMIT_REASON, OVERDUE_REASON, customerCreditPosition } from "@/lib/orders/saleOrderChecks";

export const SO_CATEGORY = 6;
export const SO_KIND = "saleOrder";
export const SO_FORM = "Sale Order";
export const SO_PAGE = "/accounting/order/saleOrder";

/** "so-123" → 123, anything else → null. */
export const soOrderNo = (id) => {
  const m = /^so-(\d+)$/.exec(String(id ?? ""));
  return m ? Number(m[1]) : null;
};
export const soId = (orderNo) => `so-${orderNo}`;

/**
 * Which pending Sale Orders this person may decide:
 *   all  — holds saleOrder.approve (Permissions → Approvals, top card)
 *   else — the reasons whose rule names them as approver (Sale Order rules set
 *          to "Save, but block dispatch"), e.g. Bad Payment → one named approver
 */
export async function approverScope(session) {
  if (await canApproveSaleOrders(session)) return { all: true, reasons: new Set() };
  let rules = [];
  try {
    rules = await prisma.approvalRule.findMany({ where: { doc_type: SO_KIND, mode: "flag" } });
  } catch {
    rules = []; // rules not set up yet
  }
  return { all: false, reasons: new Set(rules.filter((r) => canDecide(session, r)).map((r) => r.name)) };
}
export const isSoApprover = (scope) => scope.all || scope.reasons.size > 0;
// See / reject: any of the order's reasons is theirs. Approve: EVERY reason
// must be theirs — approving clears all of them, so a reason's approver may
// not wave through another reason they were never given.
export const mayDecide = (scope, order) => scope.all || reasonsOf(order).some((x) => scope.reasons.has(x));
export const mayApprove = (scope, order) => {
  if (scope.all) return true;
  const reasons = reasonsOf(order);
  return reasons.length > 0 && reasons.every((x) => scope.reasons.has(x));
};

/** The inbox status of a Sale Order: pending / rejected / approved (null = never needed approval). */
export function soStatus(o) {
  if (o.status === SO_STATUS.PENDING_APPROVAL) return "pending";
  if (o.status === SO_STATUS.REJECTED) return "rejected";
  return o.approved_at ? "approved" : null;
}

const REASON_FIELDS = { approval_reasons: true, freeOfCost: true, trialProcess: true, rateUnderNegotiation: true, dispatchWithoutGodown: true, noGodown: true, godown: true };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v, d = 2) => num(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const LIST_SELECT = {
  order_no: true, dated: true, status: true, userid: true, approved_by: true, approved_at: true, approval_remarks: true,
  ...REASON_FIELDS,
  acno: { select: { acname: true } },
  orderDetails: { select: { qty: true, rate: true, amount: true } },
};

/** One inbox row (same shape as an ApprovalRequest row of GET /api/approvals/requests). */
function toRow(o, { scope, session, nameOf }) {
  const reasons = reasonsOf(o);
  const status = soStatus(o);
  const qty = o.orderDetails.reduce((s, d) => s + num(d.qty), 0);
  const amount = o.orderDetails.reduce((s, d) => s + (d.amount != null ? num(d.amount) : num(d.qty) * num(d.rate)), 0);
  const decidable = status === "pending" && mayDecide(scope, o) && !selfDecisionError(session, { requested_by: o.userid });
  return {
    id: soId(o.order_no),
    kind: SO_KIND,
    doc_type: SO_KIND,
    form: SO_FORM,
    status,
    rule_name: reasons.join(", ") || "Approval",
    reasons,
    summary: `SO ${o.order_no} · ${o.acno?.acname ?? "Customer"} · ${o.orderDetails.length} line${o.orderDetails.length === 1 ? "" : "s"} · ${fmt(qty)} KG${amount ? ` · ${fmt(amount)}` : ""}`,
    target_no: o.order_no,
    requested_by: o.userid,
    requested_by_name: nameOf.get(o.userid) || o.userid || "—",
    requested_at: o.dated,
    decided_by: status === "pending" ? null : o.approved_by,
    decided_by_name: status === "pending" || !o.approved_by ? null : nameOf.get(o.approved_by) || o.approved_by,
    decided_at: status === "pending" ? null : o.approved_at,
    remarks: status === "pending" ? null : o.approval_remarks,
    updated_at: o.approved_at || o.dated,
    mine: o.userid === session.user.id,
    can_decide: decidable,
    can_approve: decidable && mayApprove(scope, o),
  };
}

/**
 * Sale Order rows of one inbox box, plus their counts.
 *   inbox   — waiting (status 3), orders this person may decide
 *   history — decided (approved / rejected), latest 200, same scope
 *   mine    — this person's own orders that needed approval, latest 200
 */
export async function saleOrderRows(session, box) {
  const me = session.user.id;
  const scope = await approverScope(session);
  const approver = isSoApprover(scope);
  const base = { order_catagory: SO_CATEGORY };

  let where = null;
  if (box === "mine") {
    where = { ...base, userid: me, OR: [{ status: { in: [SO_STATUS.PENDING_APPROVAL, SO_STATUS.REJECTED] } }, { approved_at: { not: null } }] };
  } else if (!approver) {
    where = null;
  } else if (box === "history") {
    where = { ...base, OR: [{ status: SO_STATUS.REJECTED }, { approved_at: { not: null }, status: { notIn: [SO_STATUS.PENDING_APPROVAL] } }] };
  } else {
    where = { ...base, status: SO_STATUS.PENDING_APPROVAL };
  }

  const pendingWhere = { ...base, status: SO_STATUS.PENDING_APPROVAL };
  const [orders, pendingForMe, minePending] = await Promise.all([
    where
      ? prisma.orderMaster.findMany({
          where,
          orderBy: box === "inbox" ? { order_no: "asc" } : [{ approved_at: { sort: "desc", nulls: "first" } }, { order_no: "desc" }],
          take: box === "inbox" ? 500 : 200,
          select: LIST_SELECT,
        })
      : [],
    // The waiting count: every pending order in scope (for a reason-approver,
    // only the orders with one of their reasons).
    !approver
      ? 0
      : scope.all
        ? prisma.orderMaster.count({ where: pendingWhere })
        : prisma.orderMaster
            .findMany({ where: pendingWhere, select: { userid: true, ...REASON_FIELDS } })
            .then((list) => list.filter((o) => mayDecide(scope, o)).length),
    prisma.orderMaster.count({ where: { ...pendingWhere, userid: me } }),
  ]);

  const visible = box === "mine" ? orders : orders.filter((o) => mayDecide(scope, o));
  const ids = [...new Set(visible.flatMap((o) => [o.userid, o.approved_by]).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));

  return {
    rows: visible.map((o) => toRow(o, { scope, session, nameOf })).filter((r) => r.status),
    counts: { inbox: pendingForMe, mine: minePending },
    isApprover: approver,
  };
}

/**
 * For the header Approvals button (GET /api/approvals/count): how many waiting
 * Sale Orders this person may decide right now — the inbox scope above, minus
 * their own orders when they may not decide their own (selfDecisionError).
 */
export async function saleOrderBadge(session) {
  const me = session.user.id;
  const scope = await approverScope(session);
  if (!isSoApprover(scope)) return { count: 0, isApprover: false };
  const excludeOwn = Boolean(selfDecisionError(session, { requested_by: me }));
  const pendingWhere = { order_catagory: SO_CATEGORY, status: SO_STATUS.PENDING_APPROVAL };
  const count = scope.all
    ? await prisma.orderMaster.count({
        where: excludeOwn ? { ...pendingWhere, OR: [{ userid: null }, { userid: { not: me } }] } : pendingWhere,
      })
    : await prisma.orderMaster
        .findMany({ where: pendingWhere, select: { userid: true, ...REASON_FIELDS } })
        .then((list) => list.filter((o) => mayDecide(scope, o) && (!excludeOwn || o.userid !== me)).length);
  return { count, isApprover: true };
}

/** Has this person a Sale Order of their own in the inbox ("mine" box)? */
export async function hasOwnSaleOrderApprovals(session) {
  const o = await prisma.orderMaster.findFirst({
    where: {
      order_catagory: SO_CATEGORY,
      userid: session.user.id,
      OR: [{ status: { in: [SO_STATUS.PENDING_APPROVAL, SO_STATUS.REJECTED] } }, { approved_at: { not: null } }],
    },
    select: { order_no: true },
  });
  return Boolean(o);
}

// ── Detail ─────────────────────────────────────────────────────────────────

// Header columns an edit can change, by their form labels. Status and the
// approval stamps are the decision itself, not what the sales person changed.
const FIELD_LABELS = {
  dated: "Order date",
  due_date: "Due date",
  party_code: "Customer",
  godown: "Godown",
  sale_po: "Customer PO",
  delivery_terms: "Delivery terms",
  payment_terms: "Payment terms",
  delivery_location: "Delivery location",
  additional_instructions: "Instructions",
  freeOfCost: "Free of Cost",
  trialProcess: "Trial Process",
  rateUnderNegotiation: "Rate Under Negotiation",
  dispatchWithoutGodown: "Despatch Without Godown",
  noGodown: "No Godown",
  approval_reasons: "Needs approval for",
  urgency_level: "Urgent",
};

/**
 * The order's last edit, from the audit trail (lib/audit): the header fields
 * it changed and its lines before vs. now. An edit replaces every line, so the
 * deleted lines of the latest line-replacing save are "before". Empty when
 * the order was never edited (or the audit trail is not there).
 */
async function lastEdit(order, { itemName, accName, godownName }) {
  let rows = [];
  try {
    const del = await prisma.auditLog.findFirst({
      where: { doc_model: "OrderMaster", doc_id: String(order.order_no), model_name: "OrderDetail", action: "delete" },
      orderBy: { id: "desc" },
      select: { batch_id: true, dated: true, user_name: true },
    });
    if (!del?.batch_id) return null;
    rows = await prisma.auditLog.findMany({
      where: { batch_id: del.batch_id, doc_model: "OrderMaster", doc_id: String(order.order_no) },
      select: { model_name: true, action: true, changes: true, snapshot: true, dated: true, user_name: true },
    });
    if (!rows.length) return null;
    const at = rows[0].dated;
    const by = rows.find((r) => r.user_name)?.user_name ?? null;

    const pretty = (field, v) => {
      if (v === null || v === undefined || v === "") return "—";
      if (typeof v === "boolean") return v ? "Yes" : "No";
      if (field === "party_code") return accName.get(Number(v)) ? `${accName.get(Number(v))} (${v})` : String(v);
      if (field === "godown") return godownName.get(Number(v)) ?? String(v);
      if (field === "dated" || field === "due_date") return day(v);
      return String(v);
    };
    const changes = rows
      .filter((r) => r.model_name === "OrderMaster" && r.action === "update")
      .flatMap((r) => (Array.isArray(r.changes) ? r.changes : []))
      .filter((c) => FIELD_LABELS[c.field])
      .map((c) => ({ label: FIELD_LABELS[c.field], from: pretty(c.field, c.old), to: pretty(c.field, c.new) }));

    const before = rows.filter((r) => r.model_name === "OrderDetail" && r.action === "delete").map((r) => r.snapshot || {});
    const line_changes = diffLines(before, order.orderDetails, (itcd) => itemName.get(Number(itcd)) ?? `Item ${itcd}`);
    return { at, by, changes, line_changes };
  } catch {
    return null; // audit columns missing — no history to compare with
  }
}

/** Lines before → after, by item: added / removed / qty or rate changed. */
export function diffLines(before, after, nameOf) {
  const group = (lines) => {
    const m = new Map();
    for (const l of lines) {
      const k = l.itcd == null ? null : Number(l.itcd);
      if (k == null || !Number.isFinite(k)) continue;
      const g = m.get(k) || { qty: 0, rate: null, amount: 0 };
      g.qty += num(l.qty);
      g.amount += l.amount != null ? num(l.amount) : num(l.qty) * num(l.rate);
      if (g.rate === null && l.rate != null) g.rate = num(l.rate);
      m.set(k, g);
    }
    return m;
  };
  const was = group(before);
  const now = group(after);
  const out = [];
  for (const k of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(k);
    const b = now.get(k);
    if (!a) out.push({ item: nameOf(k), change: "added", fields: [{ label: "Qty", from: "—", to: fmt(b.qty) }, { label: "Rate", from: "—", to: fmt(b.rate) }] });
    else if (!b) out.push({ item: nameOf(k), change: "removed", fields: [{ label: "Qty", from: fmt(a.qty), to: "—" }, { label: "Rate", from: fmt(a.rate), to: "—" }] });
    else {
      const fields = [];
      if (Math.abs(a.qty - b.qty) > 1e-6) fields.push({ label: "Qty", from: fmt(a.qty), to: fmt(b.qty) });
      if (Math.abs(num(a.rate) - num(b.rate)) > 1e-6) fields.push({ label: "Rate", from: fmt(a.rate), to: fmt(b.rate) });
      if (Math.abs(a.amount - b.amount) > 0.005) fields.push({ label: "Amount", from: fmt(a.amount), to: fmt(b.amount) });
      if (fields.length) out.push({ item: nameOf(k), change: "changed", fields });
    }
  }
  return out;
}

/**
 * GET /api/approvals/requests/so-<n>: the order laid out like any request.
 * Visible to whoever may decide it (any of its reasons) and to the sales
 * person who entered it. Returns null → 404, false → 403.
 */
export async function describeSaleOrder(session, orderNo) {
  const o = await prisma.orderMaster.findFirst({
    where: { order_no: orderNo, order_catagory: SO_CATEGORY },
    include: {
      acno: { select: { acno: true, acname: true, customerStatus: true } },
      godownDetails: { select: { godown: true } },
      orderDetails: {
        orderBy: { id: "asc" },
        select: { itcd: true, qty: true, qty_ltr: true, unit: true, no_of_packs: true, rate: true, amount: true, st_rate: true, st_amount: true, items: { select: { code: true, item: true } } },
      },
    },
  });
  if (!o) return null;
  const scope = await approverScope(session);
  const mine = o.userid === session.user.id;
  const approver = mayDecide(scope, o);
  if (!approver && !mine) return false;

  const status = soStatus(o) ?? "approved";
  const reasons = reasonsOf(o);
  const itemName = new Map(o.orderDetails.filter((d) => d.itcd != null).map((d) => [d.itcd, `${d.items?.code ? `${d.items.code} · ` : ""}${d.items?.item ?? `Item ${d.itcd}`}`]));
  const [people, accounts, godowns] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [o.userid, o.approved_by].filter(Boolean) } }, select: { id: true, name: true, email: true } }),
    prisma.aCNO.findMany({ where: { acno: o.party_code }, select: { acno: true, acname: true } }),
    prisma.godown.findMany({ select: { id: true, godown: true } }),
  ]);
  const nameOf = new Map(people.map((u) => [u.id, u.name || u.email]));
  const edit = await lastEdit(o, {
    itemName,
    accName: new Map(accounts.map((a) => [a.acno, a.acname])),
    godownName: new Map(godowns.map((g) => [g.id, g.godown])),
  });
  // Items only in the old lines (removed by the edit) need their names too.
  if (edit?.line_changes?.some((c) => /^Item \d+$/.test(c.item))) {
    const missing = edit.line_changes.map((c) => Number(/^Item (\d+)$/.exec(c.item)?.[1])).filter(Number.isFinite);
    const items = await prisma.item.findMany({ where: { itcd: { in: missing } }, select: { itcd: true, code: true, item: true } });
    const nm = new Map(items.map((i) => [`Item ${i.itcd}`, `${i.code ? `${i.code} · ` : ""}${i.item}`]));
    edit.line_changes = edit.line_changes.map((c) => ({ ...c, item: nm.get(c.item) ?? c.item }));
  }

  const totalQty = o.orderDetails.reduce((s, d) => s + num(d.qty), 0);
  const totalAmount = o.orderDetails.reduce((s, d) => s + (d.amount != null ? num(d.amount) : num(d.qty) * num(d.rate)), 0);
  const header = [
    { label: "Customer", value: `${o.acno?.acname ?? "—"} (${o.party_code})` },
    { label: "Order date", value: day(o.dated) },
    ...(o.due_date ? [{ label: "Due date", value: day(o.due_date) }] : []),
    { label: "Godown", value: o.godownDetails?.godown ?? "No Godown" },
    ...(o.sale_po ? [{ label: "Customer PO", value: o.sale_po }] : []),
    ...(o.acno?.customerStatus ? [{ label: "Customer status", value: o.acno.customerStatus }] : []),
    ...(o.payment_terms ? [{ label: "Payment terms", value: o.payment_terms }] : []),
    ...(o.delivery_terms ? [{ label: "Delivery terms", value: o.delivery_terms }] : []),
    ...(o.delivery_location ? [{ label: "Delivery location", value: o.delivery_location }] : []),
    ...(o.urgency_level ? [{ label: "Urgent", value: "Yes" }] : []),
    { label: "Total qty", value: `${fmt(totalQty)} KG` },
    { label: "Total amount", value: fmt(totalAmount) },
  ];
  const lines = {
    columns: ["Item", "Qty (KG)", "Litres", "Packs", "Rate", "Amount"],
    rows: o.orderDetails.map((d) => [
      itemName.get(d.itcd) ?? "—",
      fmt(d.qty),
      d.qty_ltr ? fmt(d.qty_ltr) : "—",
      d.no_of_packs ? fmt(d.no_of_packs) : "—",
      fmt(d.rate),
      fmt(d.amount != null ? d.amount : num(d.qty) * num(d.rate)),
    ]),
    totals: ["Total", fmt(totalQty), "", "", "", fmt(totalAmount)],
    numeric: [false, true, true, true, true, true],
  };

  // The figures behind a credit reason (lib/orders/saleOrderChecks.js), as they
  // stand now — a held order is not a debt yet, so they are what the saver saw.
  const reason_figures = [];
  if (status === "pending" && (reasons.includes(CREDIT_LIMIT_REASON) || reasons.includes(OVERDUE_REASON))) {
    const pos = await customerCreditPosition(o.party_code, o.orderDetails);
    if (reasons.includes(CREDIT_LIMIT_REASON)) {
      reason_figures.push(
        { label: "Credit limit", value: fmt(pos.limit, 0) },
        { label: "Customer balance now", value: fmt(pos.outstanding, 0) },
        { label: "This order (with tax)", value: fmt(pos.orderValue, 0) },
        { label: "Over the limit by", value: fmt(pos.overBy, 0), tone: "bad" },
      );
    }
    if (reasons.includes(OVERDUE_REASON)) reason_figures.push({ label: "Overdue now", value: fmt(pos.overdue, 0), tone: "bad" });
  }

  const selfError = selfDecisionError(session, { requested_by: o.userid });
  const decidable = status === "pending" && approver && !selfError;
  const others = reasons.filter((x) => !scope.all && !scope.reasons.has(x));
  return {
    form_path: `${SO_PAGE}?search=${o.order_no}`,
    request: {
      id: soId(o.order_no),
      kind: SO_KIND,
      status,
      form: SO_FORM,
      doc_type: SO_KIND,
      rule_name: reasons.join(", ") || "Approval",
      action: edit ? "update" : "create",
      target_no: o.order_no,
      title: `Sale Order #${o.order_no}`,
      rule_condition: reasons.length ? `Needs approval for: ${reasons.join(", ")}` : null,
      summary: `SO ${o.order_no} · ${o.acno?.acname ?? ""}`,
      note: o.additional_instructions || null,
      note_label: "Instructions from the sales person",
      requested_by: nameOf.get(o.userid) || o.userid || "—",
      requested_at: o.dated,
      decided_by: status === "pending" || !o.approved_by ? null : nameOf.get(o.approved_by) || o.approved_by,
      decided_at: status === "pending" ? null : o.approved_at,
      remarks: status === "pending" ? null : o.approval_remarks,
      posted_no: null,
      post_error: null,
      has_ui_state: false,
      mine,
      held_note:
        status === "pending"
          ? "The order is saved but cannot be dispatched until it is approved. Approving opens it for dispatch; rejecting (with a reason) sends it back to the sales person."
          : status === "rejected"
            ? "Rejected — it cannot be dispatched. Editing the order sends it for approval again."
            : "Approved — open for dispatch.",
    },
    reasons,
    reason_figures,
    header,
    edit: edit ? { at: edit.at, by: edit.by } : null,
    changes: edit?.changes ?? [],
    line_changes: edit?.line_changes ?? [],
    lines,
    ui_state: null,
    canDecide: decidable,
    canApprove: decidable && mayApprove(scope, o),
    decide_hint: selfError
      ? selfError
      : decidable && !mayApprove(scope, o)
        ? `It also needs approval for ${others.join(", ")}, which you do not approve — you may reject it, not approve it.`
        : null,
    canEdit: false,
    canReopen: false,
    edit_hint: mine && status !== "approved" ? "To change it, edit the Sale Order — the edit sends it for approval again." : null,
  };
}
