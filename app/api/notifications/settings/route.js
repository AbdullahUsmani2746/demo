// ============================================
// API ROUTE: /api/notifications/settings  (ADMIN / ACCOUNTANT)
// ============================================
// GET → full picture for the settings screen:
//        events (with rules, text templates, placeholder list and the last
//        text actually sent), roles, users
// PUT → one change at a time:
//   { action: "event",    code, is_active?, notify_actor? }
//   { action: "roleRule", event_code, role, enabled }        subscribe / unsubscribe a role
//   { action: "userRule", event_code, user_id, state }       "always" | "never" | "inherit"
//   { action: "reset",    code }                             restore catalog defaults for one event
//   { action: "template", code, title_template, message_template }
//                                                            ADMIN only; blank = default text
//
// Templates live in two columns added by
// prisma/sql/2026-11-06_notification_templates.sql. Until it is run the
// screen still works (templatesReady: false) and saving a template says so.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ensureCatalog, isMissingColumnError } from "@/lib/notifications/emit";
import { can } from "@/lib/auth/permissions";
import { activeRoleCodes } from "@/lib/auth/roleCatalog";
import {
  NOTIFICATION_CATEGORIES,
  CATALOG_BY_CODE,
} from "@/lib/notifications/catalog";
import { COMMON_TEMPLATE_VARS, TEMPLATE_LIMITS } from "@/lib/notifications/template";
import { guard } from "@/lib/auth/route";

// Who may change who is told, and the texts: notification.manage (Admin → Roles).
const SETTINGS_PERMISSION = "notification.manage";
const SQL_FILE = "prisma/sql/2026-11-06_notification_templates.sql";

/** code → { title_template, message_template }, or null when the columns are missing. */
async function loadTemplates() {
  try {
    const rows = await prisma.notificationEvent.findMany({
      select: { code: true, title_template: true, message_template: true },
    });
    return new Map(rows.map((r) => [r.code, r]));
  } catch (err) {
    if (isMissingColumnError(err)) return null;
    throw err;
  }
}

/**
 * code → the newest notification sent for it, as an example of the real
 * wording. One emit writes its rows together, the doer's own copy usually
 * last, so the newest batch's FIRST row is normally the general text rather
 * than the doer's "Your … created".
 */
async function loadLastSent() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT e.code, n.title, n.message, n.created_at
        FROM "NotificationEvent" e
       CROSS JOIN LATERAL (
         SELECT title, message, created_at
           FROM "Notification"
          WHERE event_code = e.code
          ORDER BY created_at DESC, id ASC
          LIMIT 1
       ) n`;
    return new Map(rows.map((r) => [r.code, { title: r.title, message: r.message, at: r.created_at }]));
  } catch (err) {
    console.error("[notifications] last sent lookup failed:", err.message);
    return new Map();
  }
}

async function requireSettingsAccess() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await can(session, SETTINGS_PERMISSION))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: { id: session.user.id }, session };
}

export async function GET() {
  const access = await requireSettingsAccess();
  if (access.error) return access.error;

  try {
    await ensureCatalog(prisma);

    const [events, users, templates, lastSent] = await Promise.all([
      prisma.notificationEvent.findMany({
        select: {
          code: true, category: true, label: true, description: true,
          is_active: true, notify_actor: true,
          rules: { select: { role: true, user_id: true, enabled: true } },
        },
        orderBy: [{ category: "asc" }, { label: "asc" }],
      }),
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, username: true, email: true, role: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
      loadTemplates(),
      loadLastSent(),
    ]);

    // Order categories as the catalog lists them, unknown ones last.
    const order = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c, i) => [c, i]));
    events.sort(
      (a, b) =>
        (order[a.category] ?? 99) - (order[b.category] ?? 99) || a.label.localeCompare(b.label),
    );

    return NextResponse.json({
      success: true,
      roles: await activeRoleCodes(),
      categories: NOTIFICATION_CATEGORIES,
      templatesReady: templates !== null,
      templateSqlFile: SQL_FILE,
      canEditTemplates: true,
      templateLimits: TEMPLATE_LIMITS,
      commonVars: COMMON_TEMPLATE_VARS,
      events: events.map((e) => ({
        code: e.code,
        category: e.category,
        label: e.label,
        description: e.description,
        is_active: e.is_active,
        notify_actor: e.notify_actor,
        roles: e.rules.filter((r) => r.role && r.enabled).map((r) => r.role),
        users: e.rules
          .filter((r) => r.user_id)
          .map((r) => ({ user_id: r.user_id, state: r.enabled ? "always" : "never" })),
        title_template: templates?.get(e.code)?.title_template ?? null,
        message_template: templates?.get(e.code)?.message_template ?? null,
        vars: CATALOG_BY_CODE[e.code]?.vars ?? [],
        last_sent: lastSent.get(e.code) ?? null,
      })),
      users,
    });
  } catch (error) {
    console.error("Error loading notification settings:", error);
    return NextResponse.json({ error: "Failed to load notification settings" }, { status: 500 });
  }
}

export const PUT = guard("notification.manage", async (req) => {
  const access = await requireSettingsAccess();
  if (access.error) return access.error;

  try {
    await ensureCatalog(prisma);
    const body = await req.json();

    switch (body.action) {
      case "event": {
        const data = {};
        if (typeof body.is_active === "boolean") data.is_active = body.is_active;
        if (typeof body.notify_actor === "boolean") data.notify_actor = body.notify_actor;
        if (!body.code || Object.keys(data).length === 0) {
          return NextResponse.json({ error: "code and a field to change are required" }, { status: 400 });
        }
        await prisma.notificationEvent.update({ where: { code: body.code }, data, select: { code: true } });
        return NextResponse.json({ success: true });
      }

      case "template": {
        if (!CATALOG_BY_CODE[body.code]) return NextResponse.json({ error: "Unknown event" }, { status: 400 });
        const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
        const data = { title_template: clean(body.title_template), message_template: clean(body.message_template) };
        if ((data.title_template?.length ?? 0) > TEMPLATE_LIMITS.title) {
          return NextResponse.json({ error: `Title can be at most ${TEMPLATE_LIMITS.title} characters` }, { status: 400 });
        }
        if ((data.message_template?.length ?? 0) > TEMPLATE_LIMITS.message) {
          return NextResponse.json({ error: `Message can be at most ${TEMPLATE_LIMITS.message} characters` }, { status: 400 });
        }
        try {
          await prisma.notificationEvent.update({ where: { code: body.code }, data, select: { code: true } });
        } catch (err) {
          if (!isMissingColumnError(err)) throw err;
          return NextResponse.json(
            { error: `Notification texts are not set up in the database yet — run ${SQL_FILE} first` },
            { status: 409 },
          );
        }
        return NextResponse.json({ success: true });
      }

      case "roleRule": {
        const { event_code, role, enabled } = body;
        if (!event_code || !(await activeRoleCodes()).includes(role) || typeof enabled !== "boolean") {
          return NextResponse.json({ error: "event_code, role and enabled are required" }, { status: 400 });
        }
        if (enabled) {
          await prisma.notificationRule.upsert({
            where: { event_code_role: { event_code, role } },
            create: { event_code, role, enabled: true },
            update: { enabled: true },
          });
        } else {
          await prisma.notificationRule.deleteMany({ where: { event_code, role } });
        }
        return NextResponse.json({ success: true });
      }

      case "userRule": {
        const { event_code, user_id, state } = body;
        if (!event_code || !user_id || !["always", "never", "inherit"].includes(state)) {
          return NextResponse.json({ error: "event_code, user_id and state are required" }, { status: 400 });
        }
        if (state === "inherit") {
          await prisma.notificationRule.deleteMany({ where: { event_code, user_id } });
        } else {
          const enabled = state === "always";
          await prisma.notificationRule.upsert({
            where: { event_code_user_id: { event_code, user_id } },
            create: { event_code, user_id, enabled },
            update: { enabled },
          });
        }
        return NextResponse.json({ success: true });
      }

      case "reset": {
        const def = CATALOG_BY_CODE[body.code];
        if (!def) return NextResponse.json({ error: "Unknown event" }, { status: 400 });
        await prisma.$transaction([
          prisma.notificationRule.deleteMany({ where: { event_code: def.code } }),
          prisma.notificationRule.createMany({
            data: def.defaultRoles.map((role) => ({ event_code: def.code, role, enabled: true })),
          }),
          prisma.notificationEvent.update({
            where: { code: def.code },
            data: { is_active: true, notify_actor: def.notifyActor },
            select: { code: true },
          }),
        ]);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error updating notification settings:", error);
    return NextResponse.json({ error: "Failed to update notification settings" }, { status: 500 });
  }
});
