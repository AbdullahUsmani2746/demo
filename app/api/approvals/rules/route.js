// app/api/approvals/rules/route.js — Admin → Permissions → Approvals → Approval rules.
//
//   GET                 → { rules, forms: [{ key, label, fields }], users, roles }
//   POST   { …rule }    → create
//   PUT    { id, …rule }→ update
//   DELETE ?id=         → delete; its pending requests are cancelled ("Rule deleted")
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { activeRoleCodes } from "@/lib/auth/roleCatalog";
import { guard } from "@/lib/auth/route";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { approvableForms, APPLIES_ON, RULE_MODES, FLAG_FORMS, REQUEST_STATUS } from "@/lib/approvals/rules";
import { ruleFieldsFor, CONDITION_OPS } from "@/lib/approvals/conditions";

// Approver roles: any active role (Admin → Roles).
function clean(body, forms, ROLES) {
  const name = String(body?.name ?? "").trim().slice(0, 150);
  if (!name) throw new Error("Give the rule a name.");
  if (!forms.some((f) => f.key === body?.doc_type)) throw new Error("Choose the form this rule is for.");
  const ops = new Set(CONDITION_OPS.map((o) => o.key));
  const conditions = (Array.isArray(body.conditions) ? body.conditions : [])
    .filter((c) => c && c.field && ops.has(c.op))
    .map((c) => ({ field: String(c.field), op: c.op, value: c.value == null ? "" : String(c.value).slice(0, 200) }));
  const approver_users = [...new Set((body.approver_users || []).map(String))];
  const approver_roles = [...new Set((body.approver_roles || []).filter((r) => ROLES.includes(r)))];
  if (!approver_users.length && !approver_roles.length) throw new Error("Choose at least one approver.");
  return {
    name,
    doc_type: body.doc_type,
    match: body.match === "any" ? "any" : "all",
    applies_on: APPLIES_ON.some((a) => a.key === body.applies_on) ? body.applies_on : "create",
    // "flag" (save, block dispatch) exists only where something downstream waits on it.
    mode: body.mode === "flag" && FLAG_FORMS.includes(body.doc_type) ? "flag" : "hold",
    conditions,
    approver_users,
    approver_roles,
    message: body.message ? String(body.message).trim().slice(0, 300) || null : null,
    is_active: body.is_active !== false,
    sort: Number(body.sort) || 0,
  };
}

const wrap = (fn) => async (req, ctx) => {
  try {
    return await fn(req, ctx);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 400 });
  }
};

export const GET = guard("permissions.manage", async () => {
  const forms = approvableForms().map((f) => ({ ...f, fields: ruleFieldsFor(VOUCHER_CONFIG[f.key]) }));
  const [rules, users, counts] = await Promise.all([
    prisma.approvalRule.findMany({ orderBy: [{ doc_type: "asc" }, { sort: "asc" }, { id: "asc" }] }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
    prisma.approvalRequest.groupBy({ by: ["rule_id"], where: { status: "pending" }, _count: { _all: true } }),
  ]);
  const pending = new Map(counts.map((c) => [c.rule_id, c._count._all]));
  return NextResponse.json({
    rules: rules.map((r) => ({ ...r, pending: pending.get(r.id) || 0 })),
    forms,
    users: users.map((u) => ({ id: u.id, name: u.name || u.email, role: u.role })),
    roles: await activeRoleCodes(),
    ops: CONDITION_OPS,
    appliesOn: APPLIES_ON,
    modes: RULE_MODES,
    flagForms: FLAG_FORMS,
  });
});

export const POST = guard(
  "permissions.manage",
  wrap(async (req, { session }) => {
    const data = clean(await req.json(), approvableForms(), await activeRoleCodes());
    const rule = await prisma.approvalRule.create({ data: { ...data, created_by: session.user.id } });
    return NextResponse.json({ success: true, rule });
  }),
);

export const PUT = guard(
  "permissions.manage",
  wrap(async (req) => {
    const body = await req.json();
    const id = Number(body?.id);
    if (!id) throw new Error("id is required");
    const rule = await prisma.approvalRule.update({ where: { id }, data: clean(body, approvableForms(), await activeRoleCodes()) });
    return NextResponse.json({ success: true, rule });
  }),
);

export const DELETE = guard(
  "permissions.manage",
  wrap(async (req) => {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) throw new Error("id is required");
    // Its waiting requests are cancelled with it — with no rule they could
    // only ever be decided by full-access users, under a rule that is gone.
    // A request being posted right now ("posting") is left to finish.
    await prisma.$transaction([
      prisma.approvalRequest.updateMany({
        where: { rule_id: id, status: REQUEST_STATUS.PENDING },
        data: { status: REQUEST_STATUS.CANCELLED, decided_at: new Date(), remarks: "Rule deleted" },
      }),
      prisma.approvalRule.delete({ where: { id } }),
    ]);
    return NextResponse.json({ success: true });
  }),
);
