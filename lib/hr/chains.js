// lib/hr/chains.js — HR approval chains: who approves a leave / salary
// advance / loan request, step by step. All of it is DATA, kept on
// Admin → Permissions → Approvals → "HR approval chains" (table
// hr_approval_chains, prisma/sql/2026-11-19_hr_approval_chains.sql).
//
// A chain says WHICH requests it takes — request type, advance / loan,
// work locations, departments (empty = all) — and its STEPS in order:
//
//   { id, label, type, final, users, roles, manager, pickNext }
//     type "approve"  its people approve (or reject); it then moves on
//          "pay"      done when the advance / loan is paid out on the
//                     Advances & Loans screen (a payment voucher, rule 2)
//     final           the step that makes the request count (leave booked,
//                     advance / loan active). None ticked = the last approve
//     users / roles   who acts on it (any one of them)
//     manager         + the employee's reporting manager (HR → Team structure)
//     pickNext        the person at this step chooses who takes the next one
//                     (e.g. "forward to one of the two cashiers")
//     when            advance / loan only — the step is needed only when
//                     { minAmount: the amount is above it, overLimit: the
//                     amount is over the HR → Rules advance / loan limit }
//                     (either one is enough), e.g. "CEO approval above
//                     100,000 or over the limit". Worked out once, when the
//                     request is filed: steps not needed are left out of the
//                     request's copy (listed in `skipped`); when the ticked
//                     final step is left out, the last approve step left is
//                     the final one.
//   watchers          told at every step; see it in their Approvals inbox
//
// Departments match the employee's MAIN department (an "also works in"
// department never picks a chain — one request, one chain).
// The first active chain that fits (lowest sort) is used, and copied into the
// request when it is filed, so editing a chain changes NEW requests only.
// When none fits, "When no chain fits" decides: the old single approval
// (anyone with the type's approve right) or refuse the request.
// A Super Admin may act on any step (owner's decision, 19 Nov 2026).
// The engine that moves a request along is lib/hr/approvals.js.
import prisma from "@/lib/prisma";
import { usersWithRoles } from "@/lib/auth/roles";
import { userIdsOfEmployee } from "@/lib/hr/access";
import { cleanWhen, describeWhen, stepApplies } from "@/lib/hr/chainWhen";

export { describeWhen, stepApplies };

export const CHAIN_DOC_TYPES = {
  hrLeave: { label: "Leave request", pay: false, kinds: false, conditions: false },
  hrLoan: { label: "Salary advance / loan", pay: true, kinds: true, conditions: true },
};
export const LOAN_KIND_OPTIONS = [
  { value: "", label: "Advances and loans" },
  { value: "ADVANCE", label: "Salary advances only" },
  { value: "LOAN", label: "Loans only" },
];
export const STEP_TYPES = [
  { value: "approve", label: "Approve" },
  { value: "pay", label: "Pay out" },
];
export const FALLBACK_OPTIONS = [
  { value: "single", label: "Old single approval (anyone with the approve right)" },
  { value: "refuse", label: "Refuse the request" },
];
const FALLBACK_KEY = "hr.chain.fallback";

const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))];
const ints = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger))];

/** The step that makes the request count: the one ticked final, else the last approve step. */
export function finalIndex(steps) {
  const ticked = steps.findIndex((s) => s.final);
  if (ticked >= 0) return ticked;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === "approve") return i;
  return -1;
}

/** Validate a chain from the admin screen. Throws a readable Error. */
export function cleanChain(body, { roles = [] } = {}) {
  const name = String(body?.name ?? "").trim().slice(0, 150);
  if (!name) throw new Error("Give the chain a name.");
  const type = CHAIN_DOC_TYPES[body?.doc_type];
  if (!type) throw new Error("Choose what the chain is for (leave, or advance / loan).");
  const loan_kind = type.kinds && ["ADVANCE", "LOAN"].includes(body?.loan_kind) ? body.loan_kind : null;

  const raw = Array.isArray(body?.steps) ? body.steps : [];
  if (!raw.length) throw new Error("Add at least one step.");
  const steps = raw.map((s, i) => {
    const label = String(s?.label ?? "").trim().slice(0, 80) || `Step ${i + 1}`;
    const stepType = s?.type === "pay" ? "pay" : "approve";
    if (stepType === "pay" && !type.pay) throw new Error(`"${label}": a leave has nothing to pay — make it an Approve step.`);
    const step = {
      id: String(s?.id || `s${i + 1}`).slice(0, 20),
      label,
      type: stepType,
      final: stepType === "approve" && Boolean(s?.final),
      users: ids(s?.users),
      roles: ids(s?.roles).filter((r) => !roles.length || roles.includes(r)),
      manager: Boolean(s?.manager),
      pickNext: Boolean(s?.pickNext) && i < raw.length - 1,
    };
    const when = type.conditions && stepType === "approve" ? cleanWhen(s?.when) : null;
    if (type.conditions && stepType === "approve" && s?.when && !when) throw new Error(`"${label}": set the amount above which it is needed, or tick "over the HR limit" — or untick "Needed only for large amounts".`);
    if (when) step.when = when;
    if (!step.users.length && !step.roles.length && !step.manager) throw new Error(`"${label}": choose who acts on this step.`);
    return step;
  });
  if (steps.filter((s) => s.final).length > 1) throw new Error("Only one step can be the final approval.");
  const f = finalIndex(steps);
  if (f < 0) throw new Error("Add at least one Approve step.");
  const payBefore = steps.findIndex((s) => s.type === "pay");
  if (payBefore >= 0 && payBefore < f) throw new Error("A Pay out step comes after the final approval.");
  if (!steps.some((s) => s.type === "approve" && !s.when)) throw new Error("Keep at least one Approve step that is always needed (no amount condition).");
  const ticked = steps.findIndex((s) => s.final);
  const lateIf = ticked >= 0 ? steps.findIndex((s, i) => i > ticked && s.when) : -1;
  if (lateIf >= 0) throw new Error(`"${steps[lateIf].label}" has a condition but comes after the final approval — move it before, or untick Final on "${steps[ticked].label}".`);

  return {
    name,
    doc_type: body.doc_type,
    loan_kind,
    work_location_ids: ints(body?.work_location_ids),
    department_ids: ints(body?.department_ids),
    steps,
    watchers: ids(body?.watchers),
    is_active: body?.is_active !== false,
    sort: Number.isFinite(Number(body?.sort)) ? Math.round(Number(body.sort)) : 0,
  };
}

/** The first active chain that fits this request, or null. */
export async function findChain({ docType, employeeId, loanKind = null }) {
  if (!CHAIN_DOC_TYPES[docType] || !employeeId) return null;
  const [chains, emp] = await Promise.all([
    prisma.hrApprovalChain.findMany({ where: { doc_type: docType, is_active: true }, orderBy: [{ sort: "asc" }, { id: "asc" }] }),
    prisma.employee.findUnique({ where: { id: Number(employeeId) }, select: { workLocationId: true, departmentId: true } }),
  ]);
  return (
    chains.find(
      (c) =>
        (!c.loan_kind || c.loan_kind === loanKind) &&
        (!c.work_location_ids.length || c.work_location_ids.includes(emp?.workLocationId)) &&
        (!c.department_ids.length || c.department_ids.includes(emp?.departmentId)),
    ) ?? null
  );
}

/** "single" (old one-step approval) or "refuse", per request type. */
export async function getFallbacks() {
  const row = await prisma.settings.findUnique({ where: { key: FALLBACK_KEY } });
  let saved = {};
  try {
    saved = row ? JSON.parse(row.value) : {};
  } catch {
    saved = {};
  }
  return Object.fromEntries(Object.keys(CHAIN_DOC_TYPES).map((t) => [t, saved[t] === "refuse" ? "refuse" : "single"]));
}

export async function saveFallbacks(values) {
  const next = { ...(await getFallbacks()) };
  for (const t of Object.keys(CHAIN_DOC_TYPES)) if (values?.[t] === "refuse" || values?.[t] === "single") next[t] = values[t];
  await prisma.settings.upsert({
    where: { key: FALLBACK_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: FALLBACK_KEY, value: JSON.stringify(next), description: "HR: what happens when no approval chain fits a request" },
  });
  return next;
}

/**
 * The chain a new request will follow — called BEFORE the leave / loan is
 * saved, so a refused request leaves nothing behind. null = old single
 * approval. Throws (status 400) when no chain fits and the setting refuses.
 */
export async function chainForNewRequest({ docType, employeeId, loanKind = null }) {
  const chain = await findChain({ docType, employeeId, loanKind });
  if (chain) return chain;
  if ((await getFallbacks())[docType] === "refuse") {
    throw Object.assign(new Error("No approval chain is set up for this employee yet — ask the admin to add one (Approvals → HR approval chains)."), {
      status: 400,
    });
  }
  return null;
}

/** Users of the employee's reporting manager (HR → Team structure). */
async function managerUserIds(employeeId) {
  const emp = await prisma.employee.findUnique({ where: { id: Number(employeeId) }, select: { manager: { select: { employeeId: true } } } });
  return emp?.manager?.employeeId ? userIdsOfEmployee(emp.manager.employeeId) : [];
}

/** Everyone who may act on a step for this employee — never the employee themself. */
export async function resolveStepUsers(step, employeeId) {
  const out = new Set(step.users ?? []);
  if (step.roles?.length) {
    const users = await prisma.user.findMany({ where: { isActive: true, ...usersWithRoles(step.roles) }, select: { id: true } });
    for (const u of users) out.add(u.id);
  }
  if (step.manager && employeeId) for (const id of await managerUserIds(employeeId)) out.add(id);
  const own = employeeId ? new Set(await userIdsOfEmployee(Number(employeeId))) : new Set();
  return [...out].filter((id) => !own.has(id));
}

/**
 * The chain as copied into a request (payload.chain): only the steps this
 * request needs (ctx = { amount, overLimit }, see `when` above); the others
 * are kept in `skipped` so the inbox can say why they were left out.
 */
export function chainSnapshot(chain, ctx = {}) {
  const all = Array.isArray(chain.steps) ? chain.steps : [];
  const steps = all.filter((s) => stepApplies(s, ctx)).map((s) => ({ ...s }));
  const skipped = all.filter((s) => !stepApplies(s, ctx)).map((s) => ({ label: s.label, why: describeWhen(s.when) }));
  if (steps.length) steps[steps.length - 1].pickNext = false;
  return {
    id: chain.id,
    name: chain.name,
    steps,
    watchers: ids(chain.watchers),
    ...(skipped.length ? { skipped, context: { amount: ctx.amount ?? null, overLimit: Boolean(ctx.overLimit) } } : {}),
  };
}
