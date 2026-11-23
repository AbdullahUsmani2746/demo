// lib/approvals/deletions.js — "Request deletion" (server).
//
// Delete is a right very few hold (<type>.delete). Everyone else who works on a
// voucher / order may ASK for it to be deleted, with a reason:
//   POST /api/approvals/delete-requests { type, id, reason }
// The request is an ApprovalRequest with action "delete" (no rule): the
// document stays exactly as it is. Holders of `deletion.approve` (Admin →
// Permissions → Approvals → "Deletion requests"; Super Admin always) are told,
// and decide it in the one Approvals inbox:
//   approve → the document is deleted through its own DELETE route (every
//             check — period lock, invoiced, system voucher, scope — runs
//             again, as the approver), the request is closed "approved"
//   reject  → reason required; nothing is deleted
// The requester's reason, who decided and when stay on the request for good
// (Approvals → History / My requests).
//
// Settings → Features "approvals.deletionRequests" (default off): off = no new
// requests (POST refused, the list keeps its plain Delete button). Requests
// already waiting are still decided — switching off never drops them.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { can } from "@/lib/auth/permissions";
import { feature } from "@/lib/features/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import { emit } from "@/lib/notifications/emit";
import { NOTIFICATION_TYPES } from "@/lib/notifications/config";
import { permissionHolderIds } from "@/lib/approvals/holders";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { systemVoucherError } from "@/lib/vouchers/systemVouchers";
import { formLabel, ORDER_SAVE_TYPES, REQUEST_STATUS, selfDecisionError } from "./rules";

export const DELETION_APPROVE = "deletion.approve";
export const DELETE_ACTION = "delete";

// The list's own type is used (as its Delete button does): order lists go to
// /api/orders/<type>, every other list with a tran_code to /api/voucher/<type>.
const ORDER_LIST_TYPES = [...ORDER_SAVE_TYPES, "purchaseOrderEdit"];
export const kindOf = (type) => (ORDER_LIST_TYPES.includes(type) ? "order" : "voucher");

/** Forms whose documents can be asked to be deleted. */
export const deletableType = (type) =>
  ORDER_LIST_TYPES.includes(type) || VOUCHER_CONFIG[type]?.tran_code != null;

/** May this session decide deletion requests? */
export async function mayDecideDeletion(session) {
  if (!session?.user?.id) return false;
  if (isSuperAdmin(session)) return true;
  return can(session, DELETION_APPROVE);
}

const num = (v) => Number(v || 0);
const fmt = (v) => num(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** The document as it is now, laid out for the request (header + lines). */
async function snapshot(type, id) {
  const config = VOUCHER_CONFIG[type] || {};
  if (kindOf(type) === "order") {
    const o = await prisma.orderMaster.findUnique({
      where: { order_no: Number(id) },
      include: { acno: { select: { acname: true } }, orderDetails: { include: { items: { select: { item: true, code: true } } } } },
    });
    if (!o) return null;
    const amount = o.orderDetails.reduce((s, l) => s + num(l.amount), 0);
    return {
      no: String(o.order_no),
      owner: o.userid ?? null,
      header: [
        { label: "Order No", value: String(o.order_no) },
        { label: "Date", value: day(o.dated) },
        { label: "Party", value: o.acno?.acname ? `${o.acno.acname} (${o.party_code})` : String(o.party_code ?? "—") },
        { label: "Amount", value: fmt(amount) },
      ],
      lines: {
        columns: ["Item", "Qty", "Rate", "Amount"],
        rows: o.orderDetails.map((l) => [
          `${l.items?.code ? `${l.items.code} · ` : ""}${l.items?.item ?? l.itcd}`, fmt(l.qty), fmt(l.rate), fmt(l.amount),
        ]),
      },
      text: [config.title || formLabel(type), `#${o.order_no}`, day(o.dated), o.acno?.acname, `${o.orderDetails.length} line(s)`, amount ? fmt(amount) : null],
    };
  }

  const m = await prisma.transactionsMaster.findUnique({ where: { tran_id: Number(id) } });
  if (!m) return null;
  const lines = await prisma.transactions.findMany({
    where: { tran_id: m.tran_id, OR: [{ sub_tran_id: { not: 3 } }, { sub_tran_id: null }] },
    orderBy: { id: "asc" },
    select: { itcd: true, acno: true, qty: true, rate: true, damt: true, camt: true },
  });
  const itcds = [...new Set(lines.map((l) => l.itcd).filter(Boolean).map(Number))];
  const acnos = [...new Set([m.pycd, ...lines.map((l) => l.acno)].filter(Boolean).map(Number))];
  const [items, accounts] = await Promise.all([
    itcds.length ? prisma.item.findMany({ where: { itcd: { in: itcds } }, select: { itcd: true, item: true, code: true } }) : [],
    acnos.length ? prisma.aCNO.findMany({ where: { acno: { in: acnos } }, select: { acno: true, acname: true } }) : [],
  ]);
  const itemName = new Map(items.map((i) => [i.itcd, `${i.code ? `${i.code} · ` : ""}${i.item}`]));
  const accName = new Map(accounts.map((a) => [a.acno, a.acname]));
  const hasItems = lines.some((l) => l.itcd);
  const amount = lines.reduce((s, l) => s + num(l.damt), 0);
  const no = m.vr_no ?? m.tran_id;
  return {
    no: String(no),
    owner: m.user_id ?? null,
    master: m,
    header: [
      { label: "Voucher No", value: String(no) },
      { label: "Date", value: day(m.dated) },
      ...(m.pycd ? [{ label: "Party", value: `${accName.get(Number(m.pycd)) ?? ""} (${m.pycd})` }] : []),
      ...(m.manual_no ? [{ label: "Manual No", value: m.manual_no }] : []),
      ...(m.invoice_no ? [{ label: "Invoice No", value: m.invoice_no }] : []),
      ...(amount ? [{ label: "Amount", value: fmt(amount) }] : []),
    ],
    lines: hasItems
      ? {
          columns: ["Item", "Qty", "Rate", "Debit", "Credit"],
          rows: lines.filter((l) => l.itcd).map((l) => [itemName.get(Number(l.itcd)) ?? String(l.itcd), fmt(l.qty), fmt(l.rate), fmt(l.damt), fmt(l.camt)]),
        }
      : {
          columns: ["Account", "Debit", "Credit"],
          rows: lines.map((l) => [l.acno ? `${accName.get(Number(l.acno)) ?? ""} (${l.acno})` : "—", fmt(l.damt), fmt(l.camt)]),
        },
    text: [formLabel(type), `#${no}`, day(m.dated), m.pycd ? accName.get(Number(m.pycd)) : null, amount ? fmt(amount) : null],
  };
}

/** Ask for a document to be deleted. Returns a Response. */
export async function requestDeletion({ session, type, id, reason }) {
  const me = session.user.id;
  if (!(await feature("approvals.deletionRequests"))) {
    return NextResponse.json({ error: "Deletion requests are switched off (Settings → Features)." }, { status: 403 });
  }
  const why = String(reason ?? "").trim().slice(0, 500);
  if (!deletableType(type)) return NextResponse.json({ error: "This form's entries cannot be deleted from here." }, { status: 400 });
  if (!id) return NextResponse.json({ error: "Which entry?" }, { status: 400 });
  if (why.length < 5) return NextResponse.json({ error: "Give the reason for deleting it (at least a few words)." }, { status: 400 });
  // Anyone who works on this form may ask: enter or edit rights.
  if (!(await can(session, `${type}.update`)) && !(await can(session, `${type}.create`))) {
    return NextResponse.json({ error: `You do not work on ${formLabel(type)} entries.` }, { status: 403 });
  }

  const snap = await snapshot(type, id);
  if (!snap) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  if (snap.master) {
    const expected = VOUCHER_CONFIG[type]?.tran_code;
    if (expected != null && Number(snap.master.tran_code) !== Number(expected)) {
      return NextResponse.json({ error: "This entry belongs to another form." }, { status: 400 });
    }
    const system = systemVoucherError(snap.master);
    if (system) return NextResponse.json({ error: system }, { status: 422 });
  }

  const kind = kindOf(type);
  const target = String(id);
  const waiting = await prisma.approvalRequest.findFirst({
    where: { kind, target_id: target, action: DELETE_ACTION, status: { in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.POSTING] } },
    select: { id: true },
  });
  if (waiting) {
    return NextResponse.json({ error: `Deletion of this entry has already been asked for (#R-${waiting.id}) — it is waiting for a decision.` }, { status: 409 });
  }

  const summary = `Delete ${snap.text.filter(Boolean).join(" · ")} — reason: ${why}`.slice(0, 500);
  const request = await prisma.approvalRequest.create({
    data: {
      rule_id: null,
      rule_name: "Deletion request",
      doc_type: type,
      tran_code: VOUCHER_CONFIG[type]?.tran_code ?? null,
      kind,
      action: DELETE_ACTION,
      target_id: target,
      payload: { reason: why, no: snap.no, header: snap.header, lines: snap.lines },
      summary,
      requested_by: me,
    },
  });

  try {
    const who = session.user.name || session.user.email || me;
    const to = (await permissionHolderIds(prisma, DELETION_APPROVE)).filter((u) => u !== me);
    await emit(prisma, "approvalRequested", {
      title: `Deletion requested: ${formLabel(type)} #${snap.no} (#R-${request.id})`,
      message: `${who} asks to delete ${formLabel(type)} #${snap.no}. Reason: ${why}`.slice(0, 500),
      type: NOTIFICATION_TYPES.WARNING,
      entity: "approvalRequest",
      entityId: request.id,
      extraUserIds: to,
      vars: {
        requester: who, actor: who, type: formLabel(type), summary, id: `R-${request.id}`, rule: "Deletion request",
      },
    });
  } catch (e) {
    console.error("[deletions] notify failed:", e);
  }

  return NextResponse.json(
    {
      success: true,
      approvalRequestId: request.id,
      message: `Deletion requested (#R-${request.id}). The entry stays as it is until it is approved — follow it on Approvals → My requests.`,
    },
    { status: 202 },
  );
}

/** The request page (GET /api/approvals/requests/[id]) for a deletion request. */
export async function deletionDetail(request, session) {
  const decider = await mayDecideDeletion(session);
  if (!decider && request.requested_by !== session.user.id) {
    return NextResponse.json({ error: "Not yours to see" }, { status: 403 });
  }
  const p = request.payload || {};
  const people = await prisma.user.findMany({
    where: { id: { in: [request.requested_by, request.decided_by].filter(Boolean) } },
    select: { id: true, name: true, email: true },
  });
  const nameOf = new Map(people.map((u) => [u.id, u.name || u.email]));
  const no = p.no ?? request.target_id;
  return NextResponse.json({
    form_path: null,
    request: {
      id: request.id,
      status: request.status,
      form: formLabel(request.doc_type),
      doc_type: request.doc_type,
      rule_name: "Deletion request",
      action: request.action,
      target_no: no,
      title: `Delete ${formLabel(request.doc_type)} #${no}`,
      rule_condition: null,
      held_note:
        request.status === REQUEST_STATUS.APPROVED
          ? "Approved — the entry has been deleted. This record and its reason are kept."
          : "The entry stays exactly as it is until this is approved. Approving deletes it for good (its stock and ledger postings go with it).",
      note: p.reason ?? null,
      note_label: "Reason for deleting",
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
    header: [{ label: "Reason for deleting", value: p.reason ?? "—" }, ...(p.header ?? [])],
    changes: [],
    line_changes: [],
    lines: p.lines ?? { columns: [], rows: [] },
    ui_state: null,
    chain: null,
    approve_label: "Approve & delete",
    canDecide: decider && request.status === REQUEST_STATUS.PENDING && !selfDecisionError(session, request),
    canEdit: request.requested_by === session.user.id && request.status === REQUEST_STATUS.PENDING,
    canReopen: false,
    edit_hint: "To change the reason, cancel this request and ask again.",
  });
}

/**
 * Approve: claim it, delete through the form's own DELETE route as the
 * approver (header x-approval-delete — checked again there by
 * deletionCallAllowed), then close it. A failure puts it back to pending with
 * the reason.
 */
export async function approveDeletion({ request, session, note, runDelete }) {
  const claimed = await prisma.approvalRequest.updateMany({
    where: { id: request.id, status: REQUEST_STATUS.PENDING },
    data: { status: REQUEST_STATUS.POSTING },
  });
  if (claimed.count !== 1) return { status: 409, body: { error: "This request is already being decided by someone else." } };

  let res;
  let json = {};
  try {
    res = await runDelete();
    try {
      json = await res.json();
    } catch {
      json = {};
    }
  } catch (e) {
    res = { status: 500 };
    json = { message: e?.message || String(e) };
  }
  if (res.status >= 300) {
    const post_error = String(json.message || json.error || `Delete failed (${res.status})`).slice(0, 500);
    await prisma.approvalRequest.update({ where: { id: request.id }, data: { status: REQUEST_STATUS.PENDING, post_error } });
    return { status: 422, body: { error: `Approved, but it could not be deleted: ${post_error}` } };
  }
  const done = await prisma.approvalRequest.update({
    where: { id: request.id },
    data: {
      status: REQUEST_STATUS.APPROVED,
      decided_by: session.user.id,
      decided_at: new Date(),
      remarks: note,
      post_error: null,
      posted_no: String(request.payload?.no ?? request.target_id ?? "").slice(0, 60) || null,
    },
  });
  await tellRequester(done, "approved — the entry has been deleted", NOTIFICATION_TYPES.SUCCESS);
  return { status: 200, body: { success: true, message: `Approved — ${formLabel(request.doc_type)} #${done.posted_no} has been deleted.` } };
}

export async function tellRequester(request, text, type = NOTIFICATION_TYPES.INFO) {
  try {
    const label = formLabel(request.doc_type);
    const no = request.payload?.no ?? request.target_id;
    await emit(prisma, "approvalDecided", {
      title: `Deletion of ${label} #${no} (#R-${request.id}): ${text}`,
      message: `${request.summary}${request.remarks ? ` — ${request.remarks}` : ""}`.slice(0, 500),
      type,
      entity: "approvalRequest",
      entityId: request.id,
      extraUserIds: [request.requested_by],
      vars: { type: label, id: `R-${request.id}`, decision: text, summary: request.summary, remarks: request.remarks || "" },
    });
  } catch (e) {
    console.error("[deletions] notify requester failed:", e);
  }
}

/**
 * Inside a DELETE route: is this an approved deletion being carried out?
 * Returns { ok: true, targetId } or { ok: false, response }.
 */
export async function deletionCallAllowed(req, session, type) {
  const id = Number(req.headers.get("x-approval-delete"));
  const request = Number.isFinite(id) ? await prisma.approvalRequest.findUnique({ where: { id } }) : null;
  const bad = (message, status = 403) => ({ ok: false, response: NextResponse.json({ message }, { status }) });
  if (!request || request.action !== DELETE_ACTION || request.doc_type !== type) return bad("Deletion request not found", 404);
  if (request.status !== REQUEST_STATUS.POSTING) return bad("This deletion request is not being approved right now.", 409);
  if (!(await mayDecideDeletion(session))) return bad("You may not decide deletion requests.");
  const self = selfDecisionError(session, request);
  if (self) return bad(self);
  return { ok: true, targetId: Number(request.target_id) };
}
