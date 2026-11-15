// ============================================
// NOTIFICATION EMITTER
// ============================================
// The only place that writes Notification rows. Handlers describe *what*
// happened; this module decides *who* hears about it (NotificationEvent +
// NotificationRule) and writes one row per recipient so read state is
// per user, then hands the rows to push.js for the recipients' phones.
//
// `prisma` is always the un-extended base client handed to handlers by
// lib/prisma.js — writing here must not re-trigger dispatchNotification.

import { isSuperAdmin, usersWithRoles } from "@/lib/auth/roles";
import { NOTIFICATION_CATALOG, CATALOG_BY_CODE } from "./catalog";
import { NOTIFICATION_EXPIRY, NOTIFICATION_TYPES } from "./config";
import { renderTemplate, isBlankTemplate, clip, TEMPLATE_LIMITS } from "./template";
import { getAuditActor } from "../audit/context";
import { pushNotifications, PUSH_SELECT } from "./push";

// ─── Catalog seeding ──────────────────────────────────────────────────────────
// Runs once per process. Inserts any catalog event that is not yet in the DB
// together with its default role rules. Never touches events that already
// exist — those belong to the admin now.
let catalogReady = null;

export function ensureCatalog(prisma) {
  if (!catalogReady) {
    catalogReady = seedCatalog(prisma).catch((err) => {
      catalogReady = null; // allow retry on next emit
      throw err;
    });
  }
  return catalogReady;
}

async function seedCatalog(prisma) {
  const existing = await prisma.notificationEvent.findMany({ select: { code: true } });
  const have = new Set(existing.map((e) => e.code));
  const missing = NOTIFICATION_CATALOG.filter((e) => !have.has(e.code));
  if (missing.length === 0) return;

  await prisma.notificationEvent.createMany({
    data: missing.map((e) => ({
      code: e.code,
      category: e.category,
      label: e.label,
      description: e.description,
      is_active: true,
      notify_actor: e.notifyActor,
    })),
    skipDuplicates: true,
  });

  const rules = missing.flatMap((e) =>
    e.defaultRoles.map((role) => ({ event_code: e.code, role, enabled: true })),
  );
  if (rules.length > 0) {
    await prisma.notificationRule.createMany({ data: rules, skipDuplicates: true });
  }
}

// ─── Recipient resolution ─────────────────────────────────────────────────────
/**
 * Returns the set of user ids that should receive `eventCode`.
 *   role rules              → every active user in those roles
 *   user rule enabled=true  → always included
 *   user rule enabled=false → always excluded (wins over role)
 * `null` when the event is switched off globally.
 */
export async function resolveRecipients(prisma, eventCode) {
  await ensureCatalog(prisma);

  // Explicit select: the template columns may not exist yet (see
  // loadTemplates), and a missing column must never stop a notification.
  const event = await prisma.notificationEvent.findUnique({
    where: { code: eventCode },
    select: { code: true, is_active: true, notify_actor: true, rules: true },
  });
  if (!event) {
    console.warn(`[notifications] unknown event "${eventCode}" — add it to lib/notifications/catalog.js`);
    return null;
  }
  if (!event.is_active) return null;

  const roles = event.rules.filter((r) => r.role && r.enabled).map((r) => r.role);
  const alwaysUsers = event.rules.filter((r) => r.user_id && r.enabled).map((r) => r.user_id);
  const mutedUsers = new Set(event.rules.filter((r) => r.user_id && !r.enabled).map((r) => r.user_id));

  const or = [];
  if (roles.length) or.push(usersWithRoles(roles));
  if (alwaysUsers.length) or.push({ id: { in: alwaysUsers } });

  let recipients = new Set();
  if (or.length) {
    const users = await prisma.user.findMany({
      where: { isActive: true, OR: or },
      select: { id: true },
    });
    recipients = new Set(users.map((u) => u.id));
  }
  for (const id of mutedUsers) recipients.delete(id);

  return { event, recipients, mutedUsers };
}

// ─── Templates ───────────────────────────────────────────────────────────────
// title_template / message_template come from
// prisma/sql/2026-11-06_notification_templates.sql. Until that is run the
// columns are missing (P2022): fall back to the code's wording and look again
// a few minutes later, so applying the SQL needs no restart.
const TEMPLATE_RETRY_MS = 5 * 60 * 1000;
let templatesMissingSince = 0;

export function isMissingColumnError(err) {
  return (
    err?.code === "P2022" ||
    /column .* does not exist/i.test(err?.message || "") ||
    /title_template|message_template/.test(err?.meta?.column || "")
  );
}

async function loadTemplates(prisma, eventCode) {
  if (templatesMissingSince && Date.now() - templatesMissingSince < TEMPLATE_RETRY_MS) return null;
  try {
    const row = await prisma.notificationEvent.findUnique({
      where: { code: eventCode },
      select: { title_template: true, message_template: true },
    });
    templatesMissingSince = 0;
    return row;
  } catch (err) {
    if (isMissingColumnError(err)) templatesMissingSince = Date.now();
    else console.error("[notifications] template lookup failed:", err.message);
    return null;
  }
}

// ─── Emit ─────────────────────────────────────────────────────────────────────
function expiryDate(days = NOTIFICATION_EXPIRY.DEFAULT) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Raise a notification event.
 *
 * @param prisma        base Prisma client
 * @param eventCode     code from catalog.js
 * @param payload
 *   title, message, type      what everyone subscribed sees
 *   entity, entityId          link back to the source record
 *   expiryDays                default NOTIFICATION_EXPIRY.DEFAULT
 *   actorUserId               who performed the action (User.id)
 *   actorTitle, actorMessage, actorType
 *                             personal wording for the actor ("Your PO … created").
 *                             Falls back to the general title/message.
 *   extraUserIds              users who must receive it regardless of rules
 *                             (e.g. the new user on userCreated). Still honours mutes.
 *   vars                      named values for the admin's text template
 *                             ({vr_no}, {customer} …; list them in catalog.js → vars).
 *                             {actor}, {title} and {message} are always there.
 *
 * @returns number of rows written
 */
export async function emit(prisma, eventCode, payload) {
  const {
    title,
    message,
    type = NOTIFICATION_TYPES.INFO,
    entity = null,
    entityId = null,
    expiryDays = NOTIFICATION_EXPIRY.DEFAULT,
    actorUserId = null,
    actorTitle,
    actorMessage,
    actorType,
    extraUserIds = [],
    godowns = null,
    vars = {},
    // Only these of the event's recipients (a message written for one person,
    // e.g. the morning summary under their own data access).
    onlyUserIds = null,
  } = payload;

  const resolved = await resolveRecipients(prisma, eventCode);
  if (!resolved) return 0;
  const { event, recipients, mutedUsers } = resolved;
  if (Array.isArray(onlyUserIds)) {
    const keep = new Set(onlyUserIds.map(String));
    for (const id of [...recipients]) if (!keep.has(String(id))) recipients.delete(id);
  }

  for (const id of extraUserIds) {
    if (id && !mutedUsers.has(id)) recipients.add(id);
  }

  const actorGetsOwn = Boolean(actorUserId && event.notify_actor && !mutedUsers.has(actorUserId));
  if (actorGetsOwn) recipients.add(actorUserId);

  // A document about godowns only reaches people allowed to see them.
  if (godowns) await dropOutOfGodownScope(prisma, recipients, godowns, actorUserId);

  if (recipients.size === 0) return 0;

  const expires_at = expiryDate(expiryDays);
  const entity_id = entityId == null ? null : Number(entityId) || null;

  // The admin's wording, when set, replaces the code's for everyone; the
  // actor's {title}/{message} stay their own personal wording.
  const text = await textBuilder(prisma, eventCode, { title, message, actorTitle, actorMessage, actorUserId, vars });

  const rows = [...recipients].map((user_id) => {
    const isActor = user_id === actorUserId;
    const { title: t, message: m } = text(isActor);
    return {
      user_id,
      event_code: eventCode,
      title: t,
      message: m,
      type: (isActor && actorType) || type,
      entity,
      entity_id,
      expires_at,
    };
  });

  const written = await prisma.notification.createManyAndReturn({ data: rows, select: PUSH_SELECT });
  pushNotifications(prisma, written); // phones — in the background, never blocks
  return written.length;
}

/** Returns isActor → { title, message }, with the event's template applied. */
async function textBuilder(prisma, eventCode, { title, message, actorTitle, actorMessage, actorUserId, vars }) {
  const defaults = (isActor) => ({
    title: (isActor && actorTitle) || title || "",
    message: (isActor && actorMessage) || message || "",
  });
  const plain = (isActor) => {
    const d = defaults(isActor);
    return { title: clip(d.title, TEMPLATE_LIMITS.title), message: clip(d.message, TEMPLATE_LIMITS.message) };
  };

  const tpl = await loadTemplates(prisma, eventCode);
  if (!tpl || (isBlankTemplate(tpl.title_template) && isBlankTemplate(tpl.message_template))) return plain;

  let actor = vars?.actor;
  if (actor == null) {
    try {
      actor = actorUserId ? await actorName(prisma, actorUserId) : getAuditActor().userName || "";
    } catch {
      actor = "";
    }
  }

  return (isActor) => {
    const d = defaults(isActor);
    const v = { ...vars, actor, title: d.title, message: d.message };
    return {
      title: renderTemplate(tpl.title_template, v, TEMPLATE_LIMITS.title) ?? clip(d.title, TEMPLATE_LIMITS.title),
      message: renderTemplate(tpl.message_template, v, TEMPLATE_LIMITS.message) ?? clip(d.message, TEMPLATE_LIMITS.message),
    };
  };
}

// ─── Godown data scope ────────────────────────────────────────────────────────
// Mirrors lib/auth/scope.js (personal DataScope rule, else the department's
// DepartmentScope rule, else no limit; Super Admin never limited).
// Not imported from there: that module pulls in lib/prisma, which imports
// this one — a cycle. The actor always keeps their own confirmation.

async function dropOutOfGodownScope(prisma, recipients, godowns, actorUserId) {
  const docGodowns = godowns.filter((g) => g !== null && g !== undefined && g !== "").map(String);
  const ids = [...recipients].filter((id) => id !== actorUserId);
  if (ids.length === 0) return;
  try {
    const [users, personal] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, role: true, departmentId: true, extraRoles: { select: { role_code: true } } },
      }),
      prisma.dataScope.findMany({ where: { userId: { in: ids }, dimension: "godown" } }),
    ]);
    const deptIds = [...new Set(users.map((u) => u.departmentId).filter(Boolean))];
    const deptRules = prisma.departmentScope && deptIds.length
      ? await prisma.departmentScope.findMany({ where: { departmentId: { in: deptIds }, dimension: "godown" } })
      : [];
    const personalBy = new Map(personal.map((r) => [r.userId, r]));
    const deptBy = new Map(deptRules.map((r) => [r.departmentId, r]));

    for (const u of users) {
      if (isSuperAdmin({ role: u.role, roles: [u.role, ...u.extraRoles.map((r) => r.role_code)] })) continue;
      const rule = personalBy.get(u.id) ?? deptBy.get(u.departmentId);
      if (!rule || rule.mode === "ALL") continue;
      const allowed = new Set((rule.values ?? []).map(String));
      // No godown on the document → only unlimited users hear about it.
      if (!docGodowns.some((g) => allowed.has(g))) recipients.delete(u.id);
    }
  } catch (err) {
    // Never block a notification on the scope lookup.
    console.error("[notifications] godown scope filter failed:", err.message);
  }
}

/** Resolve a User.id to a display name; used by handlers for "created by X". */
export async function actorName(prisma, userId) {
  if (!userId) return "system";
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, username: true },
  });
  return u?.name || u?.username || userId;
}

export { CATALOG_BY_CODE };
