// ============================================
// API ROUTE: /api/notifications
// ============================================
// GET  → unread, unexpired notifications addressed to the current user
// PUT  → mark one of the current user's notifications as read
// Anyone signed in manages their OWN inbox (every query is user_id = them);
// notification.manage is for the admin settings, not for reading one's own.
//
// Every notification row is written per recipient (lib/notifications/emit.js),
// so "mine" is simply user_id = session user. No role heuristics.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized - Please login" }, { status: 401 });
    }

    // ?read=1 → the latest READ notifications instead (the bell's "Read" tab,
    // fetched only when that tab is open). Default is unchanged: unread only.
    const wantRead = new URL(request.url).searchParams.get("read") === "1";

    const where = {
      user_id: session.user.id,
      is_read: wantRead,
      OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
    };
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { created_at: "desc" }, take: wantRead ? 30 : 50 }),
      // The real number for the bell's badge (the list itself stops at 50).
      wantRead ? null : prisma.notification.count({ where }),
    ]);

    return NextResponse.json({ success: true, notifications, count: notifications.length, ...(total != null && { unread: total }) });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export const PUT = guard(null, async (req) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { notificationId } = await req.json();
    const id = Number(notificationId);
    if (!id) {
      return NextResponse.json({ error: "Notification ID is required" }, { status: 400 });
    }

    // updateMany so a foreign id is a no-op instead of an error
    const result = await prisma.notification.updateMany({
      where: { id, user_id: session.user.id },
      data: { is_read: true, read_at: new Date() },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
});
