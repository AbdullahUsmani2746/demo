// ============================================
// API ROUTE: /api/notifications/[id]
// ============================================
// PATCH  { is_read } — mark read / unread
// DELETE — deletes one notification
// Both only touch a notification addressed to the current user.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// PATCH { is_read: false } → mark one of the current user's notifications unread (true → read).
export const PATCH = guard(null, async (req, { params, session }) => {
  const id = Number((await params).id);
  const { is_read } = await req.json().catch(() => ({}));
  const r = await prisma.notification.updateMany({ where: { id: id || -1, user_id: session.user.id }, data: { is_read: is_read !== false, read_at: is_read !== false ? new Date() : null } });
  return r.count ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Notification not found" }, { status: 404 });
});

export const DELETE = guard(null, async (req, context) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: rawId } = await context.params;
    const id = Number(rawId);
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: "Invalid Notification ID" }, { status: 400 });
    }

    const result = await prisma.notification.deleteMany({
      where: { id, user_id: session.user.id },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    console.error("DELETE ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
});
