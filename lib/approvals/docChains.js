// lib/approvals/docChains.js — approval CHAINS on approval rules, for any form
// (Payment, Receipt, JV, GRN, Dispatch, invoices, Purchase / Sale / Service
// Orders … every form approvableForms() in lib/approvals/rules.js lists — a
// form added there gets rules AND chains with no other code).
//
// All of it is DATA, on Admin → Permissions → Approvals → Approval rules →
// "Approve in steps" (ApprovalRule.steps / watchers,
// prisma/sql/2026-11-20_rule_chains.sql):
//
//   steps     [{ id, label, users, roles, manager, pickNext }] in order
//             users / roles  who acts on the step (any one of them)
//             manager        + the reporting manager of the person who saved
//                            the entry (HR → Team structure)
//             pickNext       this step chooses who takes the next one
//             The LAST step is the final approval: it posts the entry, as its
//             requester, through the form's own route (runApprovedRequest).
//   watchers  told at every step, and can follow it in their Approvals inbox
//   No steps = the old single approval (approver_users / approver_roles).
//
// When an entry is held the rule's steps are COPIED into the request
// (ApprovalRequest.chain), so editing a rule changes new entries only.
// Where it is: chain_step, step_users (who acts now), chain_actors, chain_log —
// the same columns and the same step shape as the HR chains (lib/hr/chains.js),
// so the Approvals page shows both the same way.
// A Super Admin may act on any step (owner's decision, 19 Nov 2026).
//
// This file does not import lib/approvals/rules.js (rules.js imports it).
import prisma from "@/lib/prisma";
import { usersWithRoles, isSuperAdmin } from "@/lib/auth/roles";
import { userIdsOfEmployee } from "@/lib/hr/access";
import { emit } from "@/lib/notifications/emit";
import { NOTIFICATION_TYPES } from "@/lib/notifications/config";
import { VOUCHER_CONFIG } from "@/components/Category/constants";

const PENDING = "pending";
const POSTING = "posting";
const APPROVED = "approved";
const REJECTED = "rejected";
const CANCELLED = "cancelled";

const strIds = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))];
const label = (type) => (VOUCHER_CONFIG[type]?.ModalHeading || VOUCHER_CONFIG[type]?.buttonText || type).replace(/^Create\s+/i, "");
const titleOf = (request) => `${label(request.doc_type)} #R-${request.id}`;

/** Validate a rule's steps from the admin screen. [] = single approval. Throws a readable Error. */
export function cleanRuleSteps(raw, { roles = [] } = {}) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((s, i) => {
    const stepLabel = String(s?.label ?? "").trim().slice(0, 80) || `Step ${i + 1}`;
    const step = {
      id: String(s?.id || `s${i + 1}`).slice(0, 20),
      label: stepLabel,
      type: "approve",
      users: strIds(s?.users),
      roles: strIds(s?.roles).filter((r) => !roles.length || roles.includes(r)),
      manager: Boolean(s?.manager),
      pickNext: Boolean(s?.pickNext) && i < list.length - 1,
    };
    if (!step.users.length && !step.roles.length && !step.manager) throw new Error(`Step "${stepLabel}": choose who approves it.`);
    return step;
  });
}

export const ruleSteps = (rule) => (Array.isArray(rule?.steps) ? rule.steps : []);
export const ruleHasChain = (rule) => ruleSteps(rule).length > 0;

/** The chain a held entry follows (its copy), or null for a single-approval request. */
export const docChainOf = (request) =>
  request?.chain_id == null && request?.chain_step != null && Array.isArray(request?.chain?.steps) ? request.chain : null;

const lastIndex = (chain) => chain.steps.length - 1;
export const isLastStep = (request) => {
  const chain = docChainOf(request);
  return Boolean(chain) && (request.chain_step ?? 0) === lastIndex(chain);
};

/** Users of the reporting manager of the person who saved the entry. */
async function requesterManagerIds(userId) {
  if (!userId) return [];
  const u = await prisma.user.findUnique({ where: { id: String(userId) }, select: { employeeId: true } });
  if (!u?.employeeId) return [];
  const emp = await prisma.employee.findUnique({ where: { id: u.employeeId }, select: { manager: { select: { employeeId: true } } } });
  return emp?.manager?.employeeId ? userIdsOfEmployee(emp.manager.employeeId) : [];
}

/** Everyone who may act on a step — never the requester themself. */
export async function resolveDocStepUsers(step, requesterId) {
  const out = new Set(strIds(step?.users));
  if (step?.roles?.length) {
    const users = await prisma.user.findMany({ where: { isActive: true, ...usersWithRoles(step.roles) }, select: { id: true } });
    for (const u of users) out.add(u.id);
  }
  if (step?.manager) for (const id of await requesterManagerIds(requesterId)) out.add(String(id));
  return [...out].filter((id) => id !== String(requesterId));
}

/**
 * The chain columns of a NEW held request under this rule (step 1), or {} for
 * a single-approval rule. Also used when the requester saves the entry again:
 * the changed entry starts the chain over.
 */
export async function startChainData(rule, requesterId) {
  if (!ruleHasChain(rule)) return { chain: null, chain_step: null, step_users: [], watchers: [], chain_actors: [], chain_log: [] };
  const steps = ruleSteps(rule);
  return {
    chain: { rule_id: rule.id, name: rule.name, steps, watchers: strIds(rule.watchers) },
    chain_step: 0,
    step_users: await resolveDocStepUsers(steps[0], requesterId),
    watchers: strIds(rule.watchers),
    chain_actors: [],
    chain_log: [],
  };
}

/** May this session approve / reject this chained entry now (its current step)? */
export function mayDecideDocStep(session, request) {
  if (!docChainOf(request) || !session?.user?.id) return false;
  return isSuperAdmin(session) || strIds(request.step_users).includes(String(session.user.id));
}

/** May this session open it (besides the requester and the rule's approvers)? */
export function followsDocChain(session, request) {
  if (!docChainOf(request)) return false;
  const me = String(session.user.id);
  return [...strIds(request.step_users), ...strIds(request.watchers), ...strIds(request.chain_actors)].includes(me);
}

async function namesOf(userIds) {
  const list = strIds(userIds);
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
}

async function stepWho(request) {
  const names = await namesOf(request.step_users);
  const list = strIds(request.step_users).map((id) => names.get(id) || id);
  return list.length ? list.join(" or ") : "a Super Admin (nobody is set on this step)";
}

/** Tell the people of the current step it is waiting for them. */
export async function announceDocStep(request, actorId = null) {
  const chain = docChainOf(request);
  const step = chain?.steps?.[request.chain_step];
  if (!step) return;
  const to = strIds(request.step_users).filter((id) => id !== actorId);
  if (!to.length) return;
  try {
    const who = (await namesOf([request.requested_by])).get(request.requested_by) || "someone";
    await emit(prisma, "approvalRequested", {
      title: `Approval needed: ${request.action === "update" ? "edit of " : ""}${titleOf(request)} — ${step.label}`,
      message: `${who} — ${request.summary} (step ${request.chain_step + 1} of ${chain.steps.length})`.slice(0, 500),
      type: NOTIFICATION_TYPES.WARNING,
      entity: "approvalRequest",
      entityId: request.id,
      onlyUserIds: to,
      extraUserIds: to,
      vars: { requester: who, actor: who, type: label(request.doc_type), summary: request.summary, id: `R-${request.id}`, rule: `${chain.name} — ${step.label}` },
    });
  } catch (e) {
    console.error("[approval chains] announce step failed:", e);
  }
}

/** Tell the watchers and the requester how the entry moved. */
export async function tellDocProgress(request, text, actorId, { type = NOTIFICATION_TYPES.INFO, skip = [] } = {}) {
  try {
    const to = strIds([...(request.watchers ?? []), request.requested_by]).filter((id) => id !== actorId && !skip.includes(id));
    if (!to.length) return;
    const step = docChainOf(request)?.steps?.[request.chain_step];
    await emit(prisma, "approvalProgress", {
      title: `${titleOf(request)}: ${text}`.slice(0, 200),
      message: String(request.summary || "").slice(0, 500),
      type,
      entity: "approvalRequest",
      entityId: request.id,
      onlyUserIds: to,
      extraUserIds: to,
      vars: { type: label(request.doc_type), id: `R-${request.id}`, step: step?.label ?? "", status: text, summary: request.summary || "" },
    });
  } catch (e) {
    console.error("[approval chains] progress notice failed:", e);
  }
}

/** The chain as the request page shows it (same shape as the HR chains). */
export async function docChainView(request) {
  const chain = docChainOf(request);
  if (!chain) return null;
  const log = Array.isArray(request.chain_log) ? request.chain_log : [];
  const open = request.status === PENDING || request.status === POSTING;
  const cur = request.chain_step ?? 0;
  const step = chain.steps[cur];
  const nextStep = chain.steps[cur + 1];
  const pickFrom = open && step?.pickNext && nextStep ? await resolveDocStepUsers(nextStep, request.requested_by) : [];
  const names = await namesOf([
    ...chain.steps.flatMap((s) => s.users ?? []),
    ...(request.step_users ?? []),
    ...log.flatMap((l) => [l.by, ...(l.forwarded_to ?? [])]),
    ...pickFrom,
  ]);
  const nm = (id) => names.get(id) || id;
  const final = lastIndex(chain);
  return {
    name: chain.name,
    current: cur,
    final,
    steps: chain.steps.map((s, i) => {
      let state = "waiting";
      if (request.status === APPROVED || i < cur) state = "done";
      else if (i === cur && open) state = "current";
      else if (i === cur && request.status === REJECTED) state = "rejected";
      else if (i === cur && request.status === CANCELLED) state = "cancelled";
      return {
        label: s.label,
        type: "approve",
        final: i === final,
        who: [...(s.users ?? []).map(nm), ...(s.roles ?? []).map((r) => `role:${r}`), ...(s.manager ? ["Reporting manager"] : [])],
        now: i === cur && open ? strIds(request.step_users).map(nm) : [],
        state,
        acted: log
          .filter((l) => l.step === i)
          .map((l) => ({ action: l.action, by: l.by_name || nm(l.by), at: l.at, note: l.note || null, forwarded_to: (l.forwarded_to ?? []).map(nm) })),
      };
    }),
    pick_next: pickFrom.length ? { label: nextStep.label, options: pickFrom.map((id) => ({ id, name: nm(id) })) } : null,
    pay_step: false,
  };
}

const logEntry = (request, session, note, action, extra = {}) => {
  const idx = request.chain_step ?? 0;
  return {
    step: idx,
    label: docChainOf(request)?.steps?.[idx]?.label ?? "",
    by: session.user.id,
    by_name: session.user.name || session.user.email || session.user.id,
    at: new Date().toISOString(),
    note: note || null,
    action,
    ...extra,
  };
};

/**
 * Approve a step that is NOT the last one: the entry moves to the next step
 * (nothing is posted yet). The last step posts through the form's route.
 *   → { status, body }
 */
export async function approveDocStep({ request, note, session, nextUsers = [] }) {
  const chain = docChainOf(request);
  const idx = request.chain_step ?? 0;
  const step = chain?.steps?.[idx];
  if (!step || idx >= lastIndex(chain)) return { status: 409, body: { error: "This is the last step — approving it posts the entry." } };

  const nextIdx = idx + 1;
  let next = await resolveDocStepUsers(chain.steps[nextIdx], request.requested_by);
  let forwarded = null;
  if (step.pickNext) {
    const picked = strIds(nextUsers).filter((id) => next.includes(id));
    if (!picked.length && next.length > 1) return { status: 400, body: { error: `Choose who takes the next step (${chain.steps[nextIdx].label}).` } };
    if (picked.length) next = picked;
    forwarded = next;
  }
  const me = session.user.id;
  const r = await prisma.approvalRequest.updateMany({
    where: { id: request.id, status: PENDING, chain_step: idx },
    data: {
      chain_step: nextIdx,
      step_users: next,
      chain_actors: strIds([...(request.chain_actors ?? []), me]),
      chain_log: [...(Array.isArray(request.chain_log) ? request.chain_log : []), logEntry(request, session, note, "approved", forwarded ? { forwarded_to: forwarded } : {})],
      post_error: null,
    },
  });
  if (r.count !== 1) return { status: 409, body: { error: "This entry has moved on or is being decided by someone else — refresh." } };

  const fresh = await prisma.approvalRequest.findUnique({ where: { id: request.id } });
  await announceDocStep(fresh, me);
  const who = await stepWho(fresh);
  const byName = session.user.name || session.user.email || me;
  await tellDocProgress(fresh, `${step.label} approved by ${byName} — now with ${who} (${chain.steps[nextIdx].label})`, me, { skip: fresh.step_users });
  return { status: 200, body: { success: true, message: `Approved. Now with ${who} (${chain.steps[nextIdx].label}) — it is posted after the last step.` } };
}

/** The chain columns to write with a rejection (status / remarks are the caller's). */
export const rejectChainData = (request, session, note) => ({
  step_users: [],
  chain_actors: strIds([...(request.chain_actors ?? []), session.user.id]),
  chain_log: [...(Array.isArray(request.chain_log) ? request.chain_log : []), logEntry(request, session, note, "rejected")],
});

/** The chain columns to write when the last step's approval posted the entry. */
export const finishChainData = (request, session, note) => ({
  step_users: [],
  chain_actors: strIds([...(request.chain_actors ?? []), session.user.id]),
  chain_log: [...(Array.isArray(request.chain_log) ? request.chain_log : []), logEntry(request, session, note, "approved")],
});

/** Inbox `where` pieces for chained entries (lib/approvals/inbox.js). */
export function docChainScope(session) {
  const me = String(session.user.id);
  const chained = { chain_id: null, chain_step: { not: null } };
  return {
    decides: isSuperAdmin(session) ? chained : { ...chained, step_users: { has: me } },
    follows: { ...chained, OR: [{ watchers: { has: me } }, { chain_actors: { has: me } }] },
  };
}

/** Is this person named on a step or as a watcher of an active chained rule? */
export const namedInRuleChains = (rules, me) =>
  rules.some(
    (r) =>
      r.is_active &&
      (strIds(r.watchers).includes(me) || ruleSteps(r).some((s) => strIds(s.users).includes(me))),
  );
