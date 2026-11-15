// lib/notifications/alerts.js — notification alerts the admin defines, no code.
//
// "When <table> is created / changed / deleted, and <conditions>, tell
// <these people> <this text>." Admin → Notifications → Alerts.
//
// Every write the app makes is audited (lib/audit/logger.js); each audited
// row is offered here, so an alert can watch any table: vouchers, orders,
// items, employees, leave, payroll … A new kind of notification is a row in
// notification_alerts, never new code.
//
//   conditions  [{ field, op, value }], all or any (alert.match)
//     op: changed · changed_to · changed_from · eq · neq · gt · gte · lt ·
//         lte · contains · in (comma list) · empty · not_empty
//   recipients  { roles: [], users: [], departments: [],
//                 userFields: [field holding a User.id, e.g. "user_id"],
//                 employeeFields: [field holding an Employee.id → their login] }
//               the person who made the change only when notify_actor
//   texts       {placeholders}: any field of the record ({tran_code}),
//               its old value ({old_status}), {actor} {table} {action}
//               {record} {changes}
//
// One save that matches an alert many times (a 40-line voucher) sends one
// summary per person, not 40 notifications.
//
// Writes with the base (un-extended) client handed in — never lib/prisma.js,
// which imports the audit logger that imports this (a cycle).
import { usersWithRoles } from "@/lib/auth/roles";
import { renderTemplate, clip, TEMPLATE_LIMITS } from "./template";
import { NOTIFICATION_EXPIRY } from "./config";
import { auditLabel } from "../audit/catalog";
import { pushNotifications, PUSH_SELECT } from "./push";

export const ALERT_OPS = {
  changed: { label: "changed", needsValue: false },
  changed_to: { label: "changed to", needsValue: true },
  changed_from: { label: "changed from", needsValue: true },
  eq: { label: "is", needsValue: true },
  neq: { label: "is not", needsValue: true },
  gt: { label: "is more than", needsValue: true },
  gte: { label: "is at least", needsValue: true },
  lt: { label: "is less than", needsValue: true },
  lte: { label: "is at most", needsValue: true },
  contains: { label: "contains", needsValue: true },
  in: { label: "is one of", needsValue: true },
  empty: { label: "is empty", needsValue: false },
  not_empty: { label: "is not empty", needsValue: false },
};

const SUMMARY_AFTER = 5; // more matches than this in one save → one summary

// ── matching ────────────────────────────────────────────────────────────────
const blank = (v) => v === null || v === undefined || v === "";
const text = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : blank(v) ? "" : String(v));
const num = (v) => (blank(v) ? NaN : Number(v instanceof Date ? v.getTime() : v));
const same = (a, b) => {
  if (blank(a) && blank(b)) return true;
  const na = num(a);
  const nb = num(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(b).trim() !== "") return na === nb;
  return text(a).toLowerCase() === text(b).toLowerCase();
};
const listOf = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Did this field change in this entry (a create counts as a change from nothing)? */
function didChange(entry, field) {
  if (entry.action === "create") return !blank(entry.after?.[field]);
  if (entry.action === "delete") return true;
  return (entry.changes ?? []).some((c) => c.field === field);
}

function test(cond, entry) {
  const now = entry.after?.[cond.field] ?? (entry.action === "delete" ? entry.before?.[cond.field] : undefined);
  const old = entry.before?.[cond.field];
  const v = cond.value;
  switch (cond.op) {
    case "changed": return didChange(entry, cond.field);
    case "changed_to": return didChange(entry, cond.field) && same(now, v);
    case "changed_from": return didChange(entry, cond.field) && same(old, v);
    case "eq": return same(now, v);
    case "neq": return !same(now, v);
    case "gt": return num(now) > num(v);
    case "gte": return num(now) >= num(v);
    case "lt": return num(now) < num(v);
    case "lte": return num(now) <= num(v);
    case "contains": return text(now).toLowerCase().includes(String(v ?? "").toLowerCase());
    case "in": return listOf(v).some((x) => same(now, x));
    case "empty": return blank(now);
    case "not_empty": return !blank(now);
    default: return false;
  }
}

/** Does this audited change match the alert? */
export function matchAlert(alert, entry) {
  if (alert.model_name !== entry.model) return false;
  if (alert.actions?.length && !alert.actions.includes(entry.action)) return false;
  const conds = Array.isArray(alert.conditions) ? alert.conditions.filter((c) => c?.field && ALERT_OPS[c.op]) : [];
  if (!conds.length) return true;
  return alert.match === "any" ? conds.some((c) => test(c, entry)) : conds.every((c) => test(c, entry));
}

// ── texts ───────────────────────────────────────────────────────────────────
const ACTION_WORD = { create: "created", update: "changed", delete: "deleted" };

export function alertVars(entry, actor) {
  const vars = {};
  for (const [k, v] of Object.entries(entry.before ?? {})) vars[`old_${k}`] = text(v);
  for (const [k, v] of Object.entries(entry.after ?? entry.before ?? {})) vars[k] = text(v);
  vars.actor = actor || "System";
  vars.table = auditLabel(entry.model);
  vars.action = ACTION_WORD[entry.action] ?? entry.action;
  vars.record = entry.record_id;
  vars.changes = (entry.changes ?? []).map((c) => `${c.field}: ${text(c.old) || "—"} → ${text(c.new) || "—"}`).join("; ");
  return vars;
}

export function renderAlert(alert, entry, actor) {
  const vars = alertVars(entry, actor);
  return {
    title: renderTemplate(alert.title_template, vars, TEMPLATE_LIMITS.title) ?? clip(`${vars.table} ${vars.action}`, TEMPLATE_LIMITS.title),
    message: renderTemplate(alert.message_template, vars, TEMPLATE_LIMITS.message) ?? clip(`${vars.table} #${vars.record} ${vars.action} by ${vars.actor}.`, TEMPLATE_LIMITS.message),
  };
}

// Click-through (lib/notifications/links.js knows these entities).
function linkTarget(entry) {
  const row = entry.after ?? entry.before ?? {};
  if ((entry.model === "TransactionsMaster" || entry.model === "Transactions") && row.tran_id != null) return { entity: "transaction", entity_id: Number(row.tran_id) };
  if ((entry.model === "OrderMaster" || entry.model === "OrderDetail") && row.order_no != null) return { entity: "order", entity_id: Number(row.order_no) };
  if (entry.model === "ApprovalRequest" && row.id != null) return { entity: "approvalRequest", entity_id: Number(row.id) };
  return { entity: "alert", entity_id: null };
}

// ── recipients ──────────────────────────────────────────────────────────────
export async function alertRecipients(db, alert, entries, actorId) {
  const r = alert.recipients ?? {};
  const or = [];
  if (r.roles?.length) or.push(usersWithRoles(r.roles));
  if (r.users?.length) or.push({ id: { in: r.users.map(String) } });
  if (r.departments?.length) or.push({ departmentId: { in: r.departments.map(Number).filter(Number.isFinite) } });
  const fromRows = (fields) => [...new Set(entries.flatMap((e) => (fields ?? []).map((f) => (e.after ?? e.before ?? {})[f]).filter((v) => !blank(v))))];
  const userIds = fromRows(r.userFields).map(String);
  if (userIds.length) or.push({ id: { in: userIds } });
  const employeeIds = fromRows(r.employeeFields).map(Number).filter(Number.isFinite);
  if (employeeIds.length) or.push({ employeeId: { in: employeeIds } });
  if (alert.notify_actor && actorId) or.push({ id: actorId });
  if (!or.length) return [];
  const users = await db.user.findMany({ where: { isActive: true, OR: or }, select: { id: true } });
  return users.map((u) => u.id).filter((id) => alert.notify_actor || id !== actorId);
}

// ── running ─────────────────────────────────────────────────────────────────
let cache = { at: 0, alerts: null };
let tableMissing = false;
const CACHE_MS = 30_000;

/** Forget cached alerts (after the admin saves one). */
export function invalidateAlerts() {
  cache = { at: 0, alerts: null };
  tableMissing = false;
}

async function activeAlerts(db) {
  if (tableMissing) return [];
  if (cache.alerts && Date.now() - cache.at < CACHE_MS) return cache.alerts;
  try {
    const alerts = await db.notificationAlert.findMany({ where: { is_active: true } });
    cache = { at: Date.now(), alerts };
    return alerts;
  } catch (err) {
    if (err?.code === "P2021" || /does not exist/i.test(String(err?.message))) {
      tableMissing = true; // prisma/sql/2026-11-07_audit_trail.sql not run yet
      return [];
    }
    throw err;
  }
}

/** Offer audited changes to every active alert; send what matches. */
export async function runAlerts(entries, { userId, userName, basePrisma: db }) {
  if (!entries.length || !db?.notificationAlert) return;
  const alerts = (await activeAlerts(db)).filter((a) => entries.some((e) => e.model === a.model_name));
  for (const alert of alerts) {
    const hits = entries.filter((e) => matchAlert(alert, e));
    if (!hits.length) continue;
    const to = await alertRecipients(db, alert, hits, userId);
    if (!to.length) continue;
    const expires_at = new Date(Date.now() + NOTIFICATION_EXPIRY.DEFAULT * 86400000);
    const messages =
      hits.length > SUMMARY_AFTER
        ? [{ ...renderAlert(alert, hits[0], userName), message: clip(`${hits.length} ${auditLabel(alert.model_name).toLowerCase()} ${ACTION_WORD[hits[0].action] ?? "changed"} by ${userName || "System"} in one save — first: ${renderAlert(alert, hits[0], userName).message}`, TEMPLATE_LIMITS.message), target: linkTarget(hits[0]) }]
        : hits.map((h) => ({ ...renderAlert(alert, h, userName), target: linkTarget(h) }));
    const written = await db.notification.createManyAndReturn({
      select: PUSH_SELECT,
      data: messages.flatMap((m) =>
        to.map((user_id) => ({
          user_id,
          event_code: `alert:${alert.id}`,
          title: m.title,
          message: m.message,
          type: alert.type || "info",
          entity: m.target.entity,
          entity_id: m.target.entity_id,
          expires_at,
        })),
      ),
    });
    pushNotifications(db, written);
    await db.notificationAlert.update({ where: { id: alert.id }, data: { last_fired_at: new Date(), fire_count: { increment: 1 } } });
  }
}
