// ============================================
// API ROUTE: /api/push — this person's phone notifications (Web Push)
// ============================================
// GET    ?endpoint=… → { configured, publicKey, registered, devices }
// POST   { subscription, device, replaces? } → turn this device on (re-assigns
//        the device to the signed-in user if someone else used it before;
//        `replaces` = the old address when the browser renewed it, public/sw.js)
// DELETE { endpoint } → turn this device off (also called on sign-out)
// Everyone signed in manages only their own devices. Sending lives in
// lib/notifications/push.js.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { pushConfigured, pushPublicKey, isMissingTableError } from "@/lib/notifications/push";

const NOT_READY = "Phone notifications are not set up on the server yet (push_subscriptions table).";

function cleanSubscription(body) {
  const sub = body?.subscription;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint.trim() : "";
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!/^https:\/\//.test(endpoint) || typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (endpoint.length > 2000 || p256dh.length > 200 || auth.length > 100) return null;
  const device = typeof body.device === "string" ? body.device.slice(0, 200) : null;
  return { endpoint, p256dh, auth, device };
}

export const GET = guard(null, async (req, { session }) => {
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  const configured = await pushConfigured();
  try {
    const mine = await prisma.pushSubscription.findMany({
      where: { user_id: session.user.id },
      select: { endpoint: true },
    });
    return NextResponse.json({
      configured,
      publicKey: await pushPublicKey(),
      registered: Boolean(endpoint && mine.some((s) => s.endpoint === endpoint)),
      devices: mine.length,
    });
  } catch (err) {
    if (isMissingTableError(err)) return NextResponse.json({ configured: false, publicKey: null, registered: false, devices: 0, reason: NOT_READY });
    throw err;
  }
});

export const POST = guard(null, async (req, { session }) => {
  if (!(await pushConfigured())) {
    return NextResponse.json({ error: "Phone notifications are not set up on the server (VAPID keys)." }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const sub = cleanSubscription(body);
  if (!sub) return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  const replaces = typeof body.replaces === "string" && body.replaces !== sub.endpoint ? body.replaces : null;

  try {
    const old = replaces
      ? await prisma.pushSubscription.findFirst({ where: { endpoint: replaces, user_id: session.user.id }, select: { id: true, device: true } })
      : null;
    const device = sub.device ?? old?.device ?? null;
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { ...sub, device, user_id: session.user.id },
      update: { ...sub, ...(device != null && { device }), user_id: session.user.id, failures: 0 },
    });
    if (old) await prisma.pushSubscription.delete({ where: { id: old.id } });
  } catch (err) {
    if (isMissingTableError(err)) return NextResponse.json({ error: NOT_READY }, { status: 503 });
    throw err;
  }
  return NextResponse.json({ success: true });
});

export const DELETE = guard(null, async (req, { session }) => {
  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  try {
    const { count } = await prisma.pushSubscription.deleteMany({ where: { endpoint, user_id: session.user.id } });
    return NextResponse.json({ success: true, removed: count });
  } catch (err) {
    if (isMissingTableError(err)) return NextResponse.json({ success: true, removed: 0 });
    throw err;
  }
});
