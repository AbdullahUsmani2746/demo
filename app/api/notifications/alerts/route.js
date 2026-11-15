// /api/notifications/alerts — admin-defined notification alerts
// (lib/notifications/alerts.js), notification.manage.
//   GET    every alert
//   POST   { name, model_name, actions, conditions, match, recipients,
//            notify_actor, type, title_template, message_template, is_active }
//   POST   { preview: true, ...same }  → test against the last 300 changes of
//          that table: { matched, checked, samples: [{ title, message, when, by }], recipients }
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { AlertError, alertData } from "@/lib/notifications/alertData";
import { alertRecipients, invalidateAlerts, matchAlert, renderAlert } from "@/lib/notifications/alerts";

const tableMissing = (e) => e?.code === "P2021" || /notification_alerts.*does not exist/i.test(String(e?.message));
const errorOf = (e) => {
  if (e instanceof AlertError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (tableMissing(e)) return NextResponse.json({ error: "Alerts are not set up in the database yet — run prisma/sql/2026-11-07_audit_trail.sql." }, { status: 409 });
  throw e;
};

export const GET = guard("notification.manage", async () => {
  try {
    const alerts = await prisma.notificationAlert.findMany({ orderBy: [{ is_active: "desc" }, { name: "asc" }] });
    return NextResponse.json({ alerts, ready: true });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ alerts: [], ready: false });
    throw e;
  }
});

/** The last changes of the table, as the alert engine sees them. */
async function recentEntries(model) {
  const rows = await prisma.auditLog.findMany({ where: { model_name: model }, orderBy: { id: "desc" }, take: 300 });
  return rows.map((r) => {
    const changes = Array.isArray(r.changes) ? r.changes : null;
    const snap = r.snapshot && typeof r.snapshot === "object" ? r.snapshot : null;
    const before = r.action === "delete" ? snap : changes ? Object.fromEntries(changes.map((c) => [c.field, c.old])) : null;
    const after = r.action === "delete" ? null : r.action === "create" ? snap : changes ? Object.fromEntries(changes.map((c) => [c.field, c.new])) : null;
    return { model, action: r.action, record_id: r.record_id, changes, before, after, when: r.dated, by: r.user_name, user_id: r.user_id };
  });
}

export const POST = guard("notification.manage", async (req, { session }) => {
  try {
    const b = await req.json();
    const data = alertData(b);
    if (b.preview) {
      const entries = await recentEntries(data.model_name);
      const hits = entries.filter((e) => matchAlert(data, e));
      const to = hits.length ? await alertRecipients(prisma, data, hits.slice(0, 50), null) : [];
      const users = to.length ? await prisma.user.findMany({ where: { id: { in: to.slice(0, 200) } }, select: { name: true, email: true } }) : [];
      return NextResponse.json({
        checked: entries.length,
        matched: hits.length,
        samples: hits.slice(0, 5).map((h) => ({ ...renderAlert(data, h, h.by), when: h.when, by: h.by })),
        recipients: { count: to.length, names: users.map((u) => u.name || u.email).slice(0, 20) },
        note: "Updates are checked against the changed fields only — an older change shows fewer fields than a live one.",
      });
    }
    const alert = await prisma.notificationAlert.create({ data: { ...data, created_by: session.user.id } });
    invalidateAlerts();
    return NextResponse.json({ success: true, alert, message: `Alert "${alert.name}" saved.` });
  } catch (e) {
    return errorOf(e);
  }
});
