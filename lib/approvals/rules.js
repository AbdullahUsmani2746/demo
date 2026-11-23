// lib/approvals/rules.js — configurable approvals for voucher and order forms (server).
//
// Admin → Permissions → Approvals → "Approval rules": a rule names a form
// (VOUCHER_CONFIG key), conditions on its data (lib/approvals/conditions.js),
// whether it applies to NEW entries, EDITS or both, and its approvers (people /
// roles). No condition = every entry (or every edit) of that form.
//
// A save matching an active rule is handed to approvalGate(): it is kept as an
// ApprovalRequest and NOTHING is posted — a new document is not created, an
// edited document stays exactly as it was. An approver approves it on
// /dashboard/approvals → the form's own route posts it as its requester (every
// check runs again then); a rejection leaves everything as it was.
// While an edit of a document waits, no other edit of it is accepted.
//
// Routes: app/api/voucher/[type] (kind "voucher"), app/api/orders/[type] ("order"),
// app/api/material/requisition ("plan" — a Production Plan Nature change).
//
// A rule may approve IN STEPS (ApprovalRule.steps — lib/approvals/docChains.js):
// the held entry goes from step to step and the LAST step posts it. Its
// approver_users / approver_roles then hold the last step's people (so "an
// approver's own save is not sent to them" means the final approver).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasFullAccess, can } from "@/lib/auth/permissions";
import { hasAnyRole, isSuperAdmin } from "@/lib/auth/roles";
import { userRoleCodes } from "@/lib/auth/roleCatalog";
import { emit } from "@/lib/notifications/emit";
import { NOTIFICATION_TYPES } from "@/lib/notifications/config";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { ruleMatches } from "./conditions";
import { ruleApproverIds } from "./approvers";
import { HR_APPROVAL_TYPES } from "@/lib/hr/approvalTypes";
import {
  announceDocStep, docChainOf, finishChainData, isLastStep, mayDecideDocStep, startChainData, tellDocProgress,
} from "./docChains";

// POSTING: an approver has claimed the request and its document is being
// posted right now (runApprovedRequest) — shown as in progress, not decidable.
// It goes back to PENDING (with post_error) if the posting fails.
export const REQUEST_STATUS = {
  PENDING: "pending",
  POSTING: "posting",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};
// What a matching rule does:
//   hold — nothing is saved until approved (any form)
//   flag — the document IS saved, but waits for approval before it can be
//          used: a Sale Order is saved at status 3 and cannot be dispatched
//          until approved on the Sale Order Approvals page (the Free of Cost /
//          Trial / No Godown / bad-customer approval, now managed as rules).
export const RULE_MODES = [
  { key: "hold", label: "Hold — nothing saved until approved" },
  { key: "flag", label: "Save, but block dispatch until approved" },
];
export const FLAG_FORMS = ["saleOrder"];

export const APPLIES_ON = [
  { key: "create", label: "New entries" },
  { key: "update", label: "Edits" },
  { key: "both", label: "New entries and edits" },
];

const arr = (v) => (Array.isArray(v) ? v : []);

// The document types each route saves, as the form posts them
// (components/Category/Form.jsx apiMap). Forms that save under another type
// are covered by it: GRN Return → purchaseReturn, Dispatch Return →
// saleReturn, FG Transfer → transfer, GRN Edit / ExBond → grn, Dispatch Edit
// → dispatch, Purchase Order Edit → purchaseOrder.
export const VOUCHER_SAVE_TYPES = [
  "materialIssue", "materialIssueLanded", "materialInput", "transfer", "dispatch", "grn", "fixedAssetsGrn", "fixedAssetDisposal", "fixedAssetRelocation",
  "purchase", "purchaseReturn", "sale", "saleReturn", "payment", "receipt", "journal",
  "serviceEntry", "serviceInvoice", "credit", "debit",
];
export const ORDER_SAVE_TYPES = ["saleOrder", "purchaseOrder", "serviceOrder"];

// Edit Production Plan (app/api/material/requisition, Features:
// production.labNature): only a change of a SAVED line's Nature is held — the
// rest of the edit is saved at once and, on approval, only that Nature is
// applied (kind "plan"). dispatchTransfer saves through the same route but
// never changes a saved Nature, so it is never held.
export const PLAN_SAVE_TYPES = ["productionPlan"];
const PLAN_LABELS = { productionPlan: "Production Plan (Nature change)" };

export const kindOf = (type) =>
  ORDER_SAVE_TYPES.includes(type) ? "order" : PLAN_SAVE_TYPES.includes(type) ? "plan" : "voucher";

export const formLabel = (type) =>
  HR_APPROVAL_TYPES[type]?.label ??
  PLAN_LABELS[type] ??
  (VOUCHER_CONFIG[type]?.ModalHeading || VOUCHER_CONFIG[type]?.buttonText || type).replace(/^Create\s+/i, "");

/** Forms a rule can be put on. */
export function approvableForms() {
  return [...VOUCHER_SAVE_TYPES, ...ORDER_SAVE_TYPES, ...PLAN_SAVE_TYPES]
    .filter((key) => VOUCHER_CONFIG[key])
    .map((key) => ({ key, label: formLabel(key), kind: kindOf(key), tran_code: VOUCHER_CONFIG[key].tran_code }))
    .sort((x, y) => x.label.localeCompare(y.label));
}

const modeOf = (rule) => (rule?.mode === "flag" ? "flag" : "hold");
const appliesTo = (rule, action) => (rule.applies_on || "create") === "both" || (rule.applies_on || "create") === action;

/**
 * What the conditions can see besides the form's own fields: the party's
 * customer status (for "@customerStatus"). Added as body.__ctx.
 */
export async function withContext(body) {
  const m = body?.master || {};
  const raw = m.party_code ?? m.pycd;
  const acno = Number(raw && typeof raw === "object" ? raw.value : raw);
  let customerStatus = "";
  if (Number.isFinite(acno) && acno > 0) {
    const a = await prisma.aCNO.findUnique({ where: { acno }, select: { customerStatus: true } });
    customerStatus = a?.customerStatus || "";
  }
  return { ...body, __ctx: { ...(body?.__ctx || {}), customerStatus } };
}

/**
 * The first active HOLD rule of this form, for this action, the document
 * matches — or null. With `session`: rules this person approves themselves are
 * skipped (approval standard, CLAUDE.md — an approver's own save is not sent
 * to them); a rule someone else approves still holds it.
 */
export async function findHoldingRule(type, body, action = "create", session = null) {
  const rules = await prisma.approvalRule.findMany({
    where: { doc_type: type, is_active: true },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
  const candidates = rules.filter((r) => modeOf(r) === "hold" && appliesTo(r, action));
  if (!candidates.length) return null;
  const ctxBody = await withContext(body);
  return candidates.find((r) => ruleMatches(r, ctxBody) && !(session && canDecide(session, r))) ?? null;
}

/**
 * Every active FLAG rule (save, then approve before dispatch) this document
 * matches. Returns null when the form has no flag rules at all — the caller
 * then keeps its built-in behaviour (e.g. before the rules were set up).
 */
export async function matchingFlagRules(type, body, action = "create") {
  const rules = await prisma.approvalRule.findMany({
    where: { doc_type: type, mode: "flag" },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
  if (!rules.length) return null;
  const ctxBody = await withContext(body);
  return rules.filter((r) => r.is_active && appliesTo(r, action) && ruleMatches(r, ctxBody));
}

/** Flag rules (by name) behind an order's stored reasons — for who may approve it. */
export async function flagRulesNamed(type, names) {
  const list = (names || []).map((n) => String(n).trim()).filter(Boolean);
  if (!list.length) return [];
  try {
    return await prisma.approvalRule.findMany({ where: { doc_type: type, mode: "flag", name: { in: list } } });
  } catch {
    return []; // rules not set up yet
  }
}

// Active users who may decide on this rule's requests — lib/approvals/approvers.js
export { ruleApproverIds };

/**
 * Nobody decides their own request — except a Super Admin (owner's decision,
 * Admin → Roles). Returns a message, or
 * null when this session may decide it (approver checks are separate).
 */
export function selfDecisionError(session, request) {
  if (!session?.user?.id || !request) return null;
  if (String(request.requested_by) !== String(session.user.id)) return null;
  if (isSuperAdmin(session)) return null;
  return "You cannot approve or reject your own request — another approver must decide it.";
}

/** May this session approve / reject requests of this rule? */
export function canDecide(session, rule) {
  if (!session?.user?.id) return false;
  if (hasFullAccess(session)) return true;
  if (!rule) return false;
  return arr(rule.approver_users).map(String).includes(String(session.user.id)) || hasAnyRole(session, arr(rule.approver_roles));
}

const val = (v) => (v && typeof v === "object" ? v.label ?? v.value : v);

/** One line describing the held document, for lists and notifications. */
export function summarize(type, body, action = "create", targetNo = null) {
  const m = body?.master || {};
  const lines = arr(body?.lines).filter((l) => l && (l.itcd || l.acno || l.qty || l.damt || l.camt));
  const qty = lines.reduce((s, l) => s + (Number(val(l.qty)) || 0), 0);
  const parts = [
    action === "update" ? `Edit of ${formLabel(type)}${targetNo ? ` #${targetNo}` : ""}` : formLabel(type),
    m.dated ? String(m.dated).slice(0, 10) : null,
    val(m.pycd) ? `party ${val(m.pycd)}` : val(m.party_code) ? `party ${val(m.party_code)}` : null,
    val(m.godown) ? `godown ${val(m.godown)}` : null,
    `${lines.length} line(s)`,
    qty ? `${qty.toLocaleString("en-US", { maximumFractionDigits: 2 })} qty` : null,
  ];
  return parts.filter(Boolean).join(" · ").slice(0, 500);
}

async function nameOf(id) {
  if (!id) return "someone";
  const u = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } });
  return u?.name || u?.email || "someone";
}

export async function notifyApprovers(request, rule) {
  try {
    const who = await nameOf(request.requested_by);
    await emit(prisma, "approvalRequested", {
      title: `Approval needed: ${request.action === "update" ? "edit of " : ""}${formLabel(request.doc_type)} #R-${request.id}`,
      message: `${who} — ${request.summary}. Rule: ${request.rule_name}.`.slice(0, 500),
      type: NOTIFICATION_TYPES.WARNING,
      entity: "approvalRequest",
      entityId: request.id,
      extraUserIds: await ruleApproverIds(rule),
      vars: {
        requester: who, actor: who, type: formLabel(request.doc_type), summary: request.summary,
        id: `R-${request.id}`, rule: request.rule_name,
      },
    });
  } catch (e) {
    console.error("[approvals] notify approvers failed:", e);
  }
}

export async function notifyRequester(request, text, type = NOTIFICATION_TYPES.INFO) {
  try {
    await emit(prisma, "approvalDecided", {
      title: `${formLabel(request.doc_type)} #R-${request.id}: ${text}`,
      message: `${request.summary}${request.remarks ? ` — ${request.remarks}` : ""}`.slice(0, 500),
      type,
      entity: "approvalRequest",
      entityId: request.id,
      extraUserIds: [request.requested_by],
      vars: {
        type: formLabel(request.doc_type), id: `R-${request.id}`, decision: text,
        summary: request.summary, remarks: request.remarks || "",
      },
    });
  } catch (e) {
    console.error("[approvals] notify requester failed:", e);
  }
}

/**
 * The approval gate — called by the voucher and order routes before saving.
 * Returns a Response when the save is held (or refused), or null to save normally.
 *
 *   action    "create" | "update"
 *   targetId  for an edit: the document (tran_id / order_no); targetNo its number
 *   body.approvalRequestId — the requester re-opened their own pending NEW
 *     entry in the form and saved again: that request is updated in place.
 *   body.__ui — the form's own state, so "Edit in form" can re-open it.
 */
export async function approvalGate({ type, tranCode = null, action = "create", targetId = null, targetNo = null, body, session }) {
  const me = session?.user?.id;
  if (!me) return null;
  const kind = kindOf(type);
  const { approvalRequestId, __ui, ...payload } = body || {};
  const target = targetId != null ? String(targetId) : null;

  // An edit already waiting for this document: only its requester may replace
  // it; nobody may save a different edit over the top of it.
  let existing = null;
  if (action === "update" && target) {
    const waiting = await prisma.approvalRequest.findFirst({
      where: { kind, target_id: target, action: "update", status: { in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.POSTING] } },
    });
    if (waiting?.status === REQUEST_STATUS.POSTING) {
      return NextResponse.json(
        { message: `An approved edit of this ${formLabel(type)} is being applied right now (#R-${waiting.id}) — try again in a moment.` },
        { status: 409 },
      );
    }
    if (waiting && waiting.requested_by !== me) {
      return NextResponse.json(
        { message: `An edit of this ${formLabel(type)} is waiting for approval (#R-${waiting.id}) — it cannot be changed until that is decided.` },
        { status: 409 },
      );
    }
    existing = waiting;
  } else if (approvalRequestId) {
    existing = await prisma.approvalRequest.findUnique({ where: { id: Number(approvalRequestId) } });
    if (!existing || existing.requested_by !== me || existing.status !== REQUEST_STATUS.PENDING || existing.doc_type !== type || existing.action !== "create") {
      existing = null; // not theirs / no longer pending — treat as a new entry
    }
  }

  const rule = await findHoldingRule(type, payload, action, session);
  if (!rule) {
    if (existing) {
      await prisma.approvalRequest.update({
        where: { id: existing.id },
        data: { status: REQUEST_STATUS.CANCELLED, remarks: "Saved directly — no approval needed (changed, or saved by an approver).", decided_at: new Date() },
      });
    }
    return null;
  }

  const data = {
    rule_id: rule.id,
    rule_name: rule.name,
    doc_type: type,
    tran_code: tranCode,
    kind,
    action,
    target_id: target,
    payload,
    ui_state: action === "create" ? __ui ?? existing?.ui_state ?? undefined : undefined,
    summary: summarize(type, payload, action, targetNo ?? target),
    // Approval in steps: a new entry — or one saved again — starts at step 1.
    ...(await startChainData(rule, me)),
  };
  const request = existing
    ? await prisma.approvalRequest.update({ where: { id: existing.id }, data: { ...data, post_error: null } })
    : await prisma.approvalRequest.create({ data: { ...data, requested_by: me } });

  if (docChainOf(request)) {
    if (!existing || existing.chain_step !== 0) await announceDocStep(request, me);
  } else if (!existing) await notifyApprovers(request, rule);

  const what = action === "update" ? "Your changes were sent for approval" : "Sent for approval";
  const message =
    rule.message ||
    `${what} (${rule.name}). ${action === "update" ? "The saved document stays as it was" : "Nothing is posted"} until it is approved — follow it on Approvals → My requests.`;
  return NextResponse.json(
    { pendingApproval: true, approvalRequestId: request.id, updated: Boolean(existing), message },
    { status: 202 },
  );
}

/** Kept for the voucher route's create path. */
export const holdDocument = (args) => approvalGate({ ...args, action: "create" });

/**
 * Posting an approved request — shared by the voucher and order routes.
 * `run(syntheticRequest, actingSession)` is the route's own create / update
 * function; it runs AS THE REQUESTER, so their scope, period lock and every
 * other check apply again now. The caller must be an approver of the rule and
 * the request still pending. `prepare(payload)` may adjust the payload first
 * (e.g. a fresh voucher number for a new voucher).
 */
export async function runApprovedRequest({ requestId, type, session, remarks, run, prepare, permission = null }) {
  const request = await prisma.approvalRequest.findUnique({ where: { id: Number(requestId) }, include: { rule: true } });
  if (!request || request.doc_type !== type) return NextResponse.json({ message: "Request not found" }, { status: 404 });
  const staleClaim =
    request.status === REQUEST_STATUS.POSTING &&
    new Date(request.updated_at).getTime() < Date.now() - 10 * 60 * 1000;
  if (request.status !== REQUEST_STATUS.PENDING && !staleClaim) {
    return NextResponse.json({ message: `This request is already ${request.status}.` }, { status: 409 });
  }
  // In steps: only the last step posts, by the people on it now.
  const chained = Boolean(docChainOf(request));
  if (chained ? !(isLastStep(request) && mayDecideDocStep(session, request)) : !canDecide(session, request.rule)) {
    return NextResponse.json(
      { message: chained ? "This entry is not at your step (it is posted after its last step)." : "You are not an approver of this rule." },
      { status: 403 },
    );
  }
  const selfError = selfDecisionError(session, request);
  if (selfError) return NextResponse.json({ message: selfError }, { status: 403 });

  // Claim it: only one approver (or one double-click) gets to post it. A claim
  // older than 10 minutes is stale — the process posting it died (every save
  // transaction times out in about a minute) — and may be taken over, so a
  // crash never leaves a request stuck in 'posting'.
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
  const claimed = await prisma.approvalRequest.updateMany({
    where: {
      id: request.id,
      OR: [
        { status: REQUEST_STATUS.PENDING },
        { status: REQUEST_STATUS.POSTING, updated_at: { lt: staleBefore } },
      ],
    },
    data: { status: REQUEST_STATUS.POSTING },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ message: "This request is already being decided by someone else." }, { status: 409 });
  }

  // Not posted: back to pending with the reason, and the requester is told.
  const fail = async (message, res) => {
    const post_error = String(message).slice(0, 500);
    const back = await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: REQUEST_STATUS.PENDING, post_error },
    });
    await notifyRequester({ ...back, remarks: post_error }, "approved, but it could not be posted", NOTIFICATION_TYPES.ERROR);
    return res ?? NextResponse.json({ message: post_error }, { status: 409 });
  };

  try {
    // It is posted AS the requester, so they must still be able to post it.
    const requester = await prisma.user.findUnique({
      where: { id: request.requested_by },
      select: { id: true, name: true, email: true, role: true, employeeId: true, isActive: true },
    });
    if (!requester || requester.isActive === false) {
      return await fail("The requester no longer exists or is inactive — it cannot be posted as them.");
    }
    const actingSession = { user: { ...requester, roles: await userRoleCodes(requester.id, requester.role) } };
    // `permission`: the route's own code when it is not "<doc_type>.<action>" (e.g. a plan → requisition.update)
    const needed = permission || `${request.doc_type}.${request.action === "update" ? "update" : "create"}`;
    if (!(await can(actingSession, needed))) {
      return await fail(`The requester no longer holds the ${needed} permission — it cannot be posted as them.`);
    }

    let payload = JSON.parse(JSON.stringify(request.payload || {}));
    if (prepare) payload = (await prepare(payload, request)) ?? payload;

    const synthetic = new Request(`http://internal/approvals/${request.id}`, {
      method: request.action === "update" ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await run(synthetic, actingSession, request);
    let json = {};
    try {
      json = await res.clone().json();
    } catch {
      json = {};
    }
    if (res.status >= 300) {
      return await fail(json.message || json.error || `Posting failed (${res.status})`, res);
    }
    const postedNo =
      json.vrNo ?? json.grnNo ?? json.dispatchNo ?? json.order_no ?? json.orderNo ?? json.voucherId ?? request.target_id ?? "";
    const done = await prisma.approvalRequest.update({
      where: { id: request.id },
      data: {
        status: REQUEST_STATUS.APPROVED,
        decided_by: session.user.id,
        decided_at: new Date(),
        remarks: remarks || null,
        post_error: null,
        posted_tran_id: Number(json.voucherId) || Number(json.order_no) || Number(request.target_id) || null,
        posted_no: String(postedNo).slice(0, 60) || null,
        ...(chained ? finishChainData(request, session, remarks) : {}),
      },
    });
    if (chained) {
      const byName = session.user.name || session.user.email || session.user.id;
      await tellDocProgress(done, `fully approved by ${byName} and posted as #${done.posted_no}`, session.user.id, {
        type: NOTIFICATION_TYPES.SUCCESS,
        skip: [done.requested_by], // the requester gets "approved and posted" below
      });
    }
    await notifyRequester(
      done,
      request.action === "update" ? `edit approved and applied to #${done.posted_no}` : `approved and posted as #${done.posted_no}`,
      "success",
    );
    return res;
  } catch (error) {
    // Never leave it stuck at "posting".
    console.error("[approvals] posting failed:", error);
    return fail(`Posting failed: ${error?.message || error}`, NextResponse.json({ message: "Posting failed — the request is pending again." }, { status: 500 }));
  }
}
