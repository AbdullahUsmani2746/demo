// ============================================
// PHONE NOTIFICATIONS (WEB PUSH)
// ============================================
// Every notification written for the bell (emit.js, alerts.js) is also sent
// to the recipient's phones / browsers that turned "Phone notifications" on
// (PushSubscription, one row per device). Nothing else decides who gets what:
// recipients, texts and on/off stay on Admin → Notifications.
//
// The payload carries the notification's id and the page it opens (the same
// link the bell uses, lib/notifications/links.js); public/sw.js shows it,
// marks it read on tap and opens that page. Events flagged `urgent` in
// catalog.js (approvals waiting, escalations) stay on screen until tapped.
//
// Sending never blocks or fails a save: pushNotifications() returns at once
// and logs its own errors. Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
// VAPID_SUBJECT in the environment; without them push is simply off.
//
// Called with the base client (emit.js, alerts.js) or lib/prisma (the test
// route). Device rows are housekeeping, not a business change: PushSubscription
// is excluded from the audit trail (lib/audit/logger.js).

import { attachNotificationLinks } from "./links";
import { CATALOG_BY_CODE } from "./catalog";

const FALLBACK_URL = "/accounting/notifications";
const TTL_SECONDS = 24 * 60 * 60; // a phone that is off for a day gets it when it is back
const MAX_FAILURES = 5; // non-"gone" errors in a row before a device is dropped

// ─── web-push (loaded at run time) ──────────────────────────────────────────
// A dynamic import + serverExternalPackages (next.config.mjs), as zkteco-js in
// lib/hr/devices.js: emit.js is reachable from instrumentation.js, whose edge
// bundle cannot resolve crypto / https, and the standalone build still ships it.
let webpushModule = null;

function loadWebPush() {
  if (!webpushModule) {
    webpushModule = import("web-push").then((m) => m.default ?? m);
  }
  return webpushModule;
}

// ─── VAPID ───────────────────────────────────────────────────────────────────
let vapidReady = null; // null = not tried, false = missing, true = set

function vapidSubject() {
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (subject) return subject;
  const site = process.env.NEXTAUTH_URL?.trim();
  return site?.startsWith("https://") ? site : null;
}

/** True when the server can send push (keys + subject present). */
export async function pushConfigured() {
  if (vapidReady !== null) return vapidReady;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = vapidSubject();
  if (!publicKey || !privateKey || !subject) {
    vapidReady = false;
    return false;
  }
  try {
    (await loadWebPush()).setVapidDetails(subject, publicKey, privateKey);
    vapidReady = true;
  } catch (err) {
    console.error("[push] invalid VAPID settings:", err.message);
    vapidReady = false;
  }
  return vapidReady;
}

/** The key browsers subscribe with (safe to show). */
export async function pushPublicKey() {
  return (await pushConfigured()) ? process.env.VAPID_PUBLIC_KEY.trim() : null;
}

// ─── Table guard ─────────────────────────────────────────────────────────────
// Until prisma/sql/2026-11-11_push_notifications.sql is run the table is
// missing: stay quiet and look again a few minutes later (no restart needed).
const TABLE_RETRY_MS = 5 * 60 * 1000;
let tableMissingSince = 0;

export function isMissingTableError(err) {
  return err?.code === "P2021" || /push_subscriptions.*does not exist|relation .* does not exist/i.test(err?.message || "");
}

async function subscriptionsOf(prisma, userIds) {
  if (tableMissingSince && Date.now() - tableMissingSince < TABLE_RETRY_MS) return [];
  try {
    const rows = await prisma.pushSubscription.findMany({ where: { user_id: { in: userIds } } });
    tableMissingSince = 0;
    return rows;
  } catch (err) {
    if (isMissingTableError(err)) {
      tableMissingSince = Date.now();
      return [];
    }
    throw err;
  }
}

/** Columns a written notification needs for its push (createManyAndReturn). */
export const PUSH_SELECT = { id: true, user_id: true, event_code: true, title: true, message: true, type: true, entity: true, entity_id: true };

// ─── Payload ─────────────────────────────────────────────────────────────────
function payloadFor(n, unread) {
  const urgent = Boolean(CATALOG_BY_CODE[n.event_code]?.urgent);
  return {
    id: n.id ?? null,
    title: n.title,
    body: n.message,
    url: n.link || FALLBACK_URL,
    type: n.type || "info",
    // Same event about the same record replaces the older one on the phone.
    tag: n.entity_id != null ? `${n.event_code || "n"}:${n.entity || ""}:${n.entity_id}` : `n:${n.id ?? Date.now()}`,
    urgent,
    unread,
  };
}

async function unreadCounts(prisma, userIds) {
  try {
    const rows = await prisma.notification.groupBy({
      by: ["user_id"],
      where: {
        user_id: { in: userIds },
        is_read: false,
        OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.user_id, r._count._all]));
  } catch {
    return new Map();
  }
}

// ─── Send ────────────────────────────────────────────────────────────────────
/** Send one payload to one device; returns "ok" | "gone" | "failed". */
async function deliver(sub, payload) {
  try {
    await (await loadWebPush()).sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: TTL_SECONDS, urgency: payload.urgent ? "high" : "normal" },
    );
    return "ok";
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) return "gone";
    console.error(`[push] send failed (${err?.statusCode ?? "network"}):`, err?.body || err?.message);
    return "failed";
  }
}

/** Record the outcome per device: drop gone ones, count failures. */
async function settle(prisma, outcomes) {
  const ok = [], gone = [], failed = [];
  for (const [id, result] of outcomes) (result === "ok" ? ok : result === "gone" ? gone : failed).push(id);
  const failedOnly = failed.filter((id) => !ok.includes(id));
  await Promise.all([
    gone.length && prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } }),
    ok.length && prisma.pushSubscription.updateMany({ where: { id: { in: ok } }, data: { last_sent_at: new Date(), failures: 0 } }),
    failedOnly.length && prisma.pushSubscription.updateMany({ where: { id: { in: failedOnly } }, data: { failures: { increment: 1 } } }),
  ]);
  if (failedOnly.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: failedOnly }, failures: { gte: MAX_FAILURES } } });
  }
}

async function send(prisma, notifications) {
  if (!prisma?.pushSubscription || !(await pushConfigured())) return;
  const userIds = [...new Set(notifications.map((n) => n.user_id).filter(Boolean))];
  if (!userIds.length) return;

  const subs = await subscriptionsOf(prisma, userIds);
  if (!subs.length) return;
  const subsByUser = new Map();
  for (const s of subs) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);

  const wanted = notifications.filter((n) => subsByUser.has(n.user_id));
  const [linked, unread] = await Promise.all([
    attachNotificationLinks(prisma, wanted),
    unreadCounts(prisma, [...subsByUser.keys()]),
  ]);

  const outcomes = new Map(); // subscription id → last result ("ok" wins)
  await Promise.all(
    linked.flatMap((n) =>
      subsByUser.get(n.user_id).map(async (sub) => {
        const result = await deliver(sub, payloadFor(n, unread.get(n.user_id) ?? 0));
        if (outcomes.get(sub.id) !== "ok") outcomes.set(sub.id, result);
      }),
    ),
  );
  await settle(prisma, outcomes);
}

/**
 * Push notification rows (as written: id, user_id, event_code, title, message,
 * type, entity, entity_id) to their recipients' devices. Fire-and-forget.
 */
export function pushNotifications(prisma, notifications) {
  if (!notifications?.length) return;
  send(prisma, notifications).catch((err) => console.error("[push] failed:", err.message));
}

/** A test message to one user's devices (Notifications → Phone notifications). */
export async function pushTest(prisma, userId) {
  if (!(await pushConfigured())) return { sent: 0, devices: 0 };
  const subs = await subscriptionsOf(prisma, [userId]);
  const payload = {
    id: null,
    title: "Phone notifications are on",
    body: "This is how approvals and other notifications will reach this device.",
    url: FALLBACK_URL,
    type: "success",
    tag: "push-test",
    urgent: false,
  };
  const outcomes = new Map();
  await Promise.all(subs.map(async (s) => outcomes.set(s.id, await deliver(s, payload))));
  await settle(prisma, outcomes);
  return { sent: [...outcomes.values()].filter((r) => r === "ok").length, devices: subs.length };
}
