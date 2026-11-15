// /api/audit — the Audit Trail (who changed what, when), audit.view.
//
//   GET ?from=&to=            days (YYYY-MM-DD; default the last 7 days, at most 366)
//       &model=A,B            tables (Prisma model names)   &module=finance|hr|…
//       &action=create|update|delete   &user=<User.id>   &source=user|system
//       &q=                   record / document no., or user name; a number
//                             also finds what was made from that Sale Order
//       &doc_model=&doc_id=   one document's whole history (a voucher with its
//                             lines) — no date limit. A Sale Order also
//                             shows the Production Plan lines and plans made
//                             from it and its Process Orders (isoLinks)
//       &record=              one record's history (with &model=)
//       &batch=               everything one save wrote
//       &page=1&size=50
//   → { rows, total, page, size, scope_label, facets: { models, users, actions } }
//     rows carry names for their ids (lib/audit/refs.js): item { code, name },
//     account, iso (Sale Order no.), changes[].old_label / new_label, snapshot_labels — and
//     in words (lib/audit/explain.js): story, why, resave (a line removed and
//     added back by a re-save, paired: same / what changed)
//
// Rows recorded before prisma/sql/2026-11-07_audit_trail.sql have no
// doc_model / batch_id; they still show, by model_name / record_id.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { AUDIT_MODULES, auditLabel } from "@/lib/audit/catalog";
import { describeRows } from "@/lib/audit/refs";
import { explainRows } from "@/lib/audit/explain";

const DAY = 86400000;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");
const LEGACY_SELECT = { id: true, dated: true, model_name: true, record_id: true, action: true, changes: true, snapshot: true, user_id: true, user_name: true };
const FULL_SELECT = { ...LEGACY_SELECT, doc_model: true, doc_id: true, batch_id: true, source: true };
const missingColumn = (e) => e?.code === "P2022" || /column .* does not exist/i.test(String(e?.message));

// What was made from Sale Order `soNo`: Production Plan lines
// (ReqDetail.so_no), the plan it created (ReqMaster.so_no on create — a day's
// plan holds many orders, so later edits of the plan are not this order's),
// its Process Orders (productionPlanMaster.sale_ord_no — by the entry, or by
// the process order's id for entries kept before updates carried it).
async function isoLinks(soNo) {
  const n = Number(soNo);
  if (!Number.isInteger(n) || n <= 0) return [];
  const processOrders = await prisma.productionPlanMaster.findMany({ where: { sale_ord_no: n }, select: { id: true } });
  const or = [
    { model_name: "ReqDetail", snapshot: { path: ["so_no"], equals: n } },
    { model_name: "ReqMaster", action: "create", snapshot: { path: ["so_no"], equals: n } },
    { model_name: "productionPlanMaster", snapshot: { path: ["sale_ord_no"], equals: n } },
  ];
  if (processOrders.length) or.push({ model_name: "productionPlanMaster", record_id: { in: processOrders.map((p) => String(p.id)) } });
  return or;
}

async function whereOf(sp, { extended }) {
  const and = [];
  const docModel = sp.get("doc_model");
  const docId = sp.get("doc_id");
  const batch = sp.get("batch");
  const record = sp.get("record");
  const scoped = (docModel && docId) || batch || (record && sp.get("model"));

  if (!scoped) {
    const today = new Date();
    const to = isDay(sp.get("to")) ? new Date(`${sp.get("to")}T23:59:59.999`) : today;
    let from = isDay(sp.get("from")) ? new Date(`${sp.get("from")}T00:00:00`) : new Date(today.getTime() - 6 * DAY);
    if (to - from > 366 * DAY) from = new Date(to.getTime() - 366 * DAY);
    from.setHours(0, 0, 0, 0);
    and.push({ dated: { gte: from, lte: to } });
  }
  if (docModel && docId) {
    // A document = its own row(s) + every child row pointing at it.
    const own = extended ? [{ doc_model: docModel, doc_id: docId }, { model_name: docModel, record_id: docId }] : [{ model_name: docModel, record_id: docId }];
    const linked = docModel === "OrderMaster" ? await isoLinks(docId) : [];
    and.push({ OR: [...own, ...linked] });
  }
  if (batch && extended) and.push({ batch_id: batch });
  if (record && sp.get("model")) and.push({ record_id: record });

  const models = (sp.get("model") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const mod = AUDIT_MODULES.find((m) => m.key === sp.get("module"));
  if (models.length) and.push({ model_name: { in: models } });
  else if (mod) and.push({ model_name: { in: mod.models } });

  const action = sp.get("action");
  if (["create", "update", "delete"].includes(action)) and.push({ action });
  if (sp.get("user")) and.push({ user_id: sp.get("user") });
  if (extended && ["user", "system"].includes(sp.get("source"))) {
    and.push(sp.get("source") === "system" ? { OR: [{ source: "system" }, { user_id: null }] } : { user_id: { not: null } });
  }
  const q = String(sp.get("q") ?? "").trim();
  if (q) {
    const or = [{ record_id: q }, { user_name: { contains: q, mode: "insensitive" } }];
    if (extended) or.push({ doc_id: q });
    if (/^\d+$/.test(q)) or.push(...(await isoLinks(q)));
    and.push({ OR: or });
  }
  return { AND: and };
}

async function load(sp, extended) {
  const where = await whereOf(sp, { extended });
  const size = Math.min(200, Math.max(10, Number(sp.get("size")) || 50));
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const [rows, total, models, users, actions] = await Promise.all([
    prisma.auditLog.findMany({ where, select: extended ? FULL_SELECT : LEGACY_SELECT, orderBy: [{ dated: "desc" }, { id: "desc" }], skip: (page - 1) * size, take: size }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ["model_name"], where, _count: { _all: true }, orderBy: { _count: { model_name: "desc" } }, take: 50 }),
    prisma.auditLog.groupBy({ by: ["user_id", "user_name"], where, _count: { _all: true }, orderBy: { _count: { user_id: "desc" } }, take: 50 }),
    prisma.auditLog.groupBy({ by: ["action"], where, _count: { _all: true } }),
  ]);
  return { rows, total, page, size, models, users, actions };
}

// Requisitions of category DISPATCH are Production Plans: named so.
async function planDocs(rows, docModel, docId) {
  const ids = new Set(rows.filter((r) => r.doc_model === "ReqMaster" || r.model_name === "ReqMaster").map((r) => Number(r.doc_id ?? r.record_id)));
  if (docModel === "ReqMaster") ids.add(Number(docId));
  const list = [...ids].filter((n) => Number.isInteger(n));
  if (!list.length) return new Set();
  const plans = await prisma.reqMaster.findMany({ where: { tran_id: { in: list }, req_catagory: "DISPATCH" }, select: { tran_id: true } });
  const out = new Set(plans.map((p) => String(p.tran_id)));
  // A deleted plan: its own entries say what it was
  for (const r of rows) if (r.model_name === "ReqMaster" && r.snapshot?.req_catagory === "DISPATCH") out.add(String(r.record_id));
  return out;
}

const PLAN_LABELS = { ReqMaster: "Production plans", ReqDetail: "Production plan lines" };

export const GET = guard("audit.view", async (req) => {
  const sp = new URL(req.url).searchParams;
  let r;
  let extended = true;
  try {
    r = await load(sp, true);
  } catch (e) {
    if (!missingColumn(e)) throw e;
    extended = false;
    r = await load(sp, false);
  }
  const docModel = sp.get("doc_model");
  const docId = sp.get("doc_id");
  const rows = r.rows;
  const [named, plans] = await Promise.all([describeRows(prisma, rows), planDocs(rows, docModel, docId)]);
  const isPlan = (model, id) => (model === "ReqMaster" || model === "ReqDetail") && plans.has(String(id));
  const labelOf = (model, docOfRow) => (isPlan(model, docOfRow) ? PLAN_LABELS[model] : auditLabel(model));
  return NextResponse.json({
    rows: explainRows(named.map((x) => {
      const doc_model = x.doc_model ?? x.model_name;
      const doc_id = x.doc_id ?? x.record_id;
      return {
        ...x,
        model_label: labelOf(x.model_name, x.model_name === "ReqMaster" ? x.record_id : doc_id),
        doc_model,
        doc_label: labelOf(doc_model, doc_id),
        doc_id,
        source: x.source ?? (x.user_id ? "user" : "system"),
      };
    })),
    total: r.total,
    page: r.page,
    size: r.size,
    extended,
    scope_label: docModel && docId ? (isPlan(docModel, docId) ? "Production plan" : null) : null,
    linked: docModel === "OrderMaster",
    facets: {
      models: r.models.map((m) => ({ model: m.model_name, label: auditLabel(m.model_name), count: m._count._all })),
      users: r.users.map((u) => ({ id: u.user_id, name: u.user_name || (u.user_id ? u.user_id : "System"), count: u._count._all })),
      actions: Object.fromEntries(r.actions.map((a) => [a.action, a._count._all])),
    },
  });
});
