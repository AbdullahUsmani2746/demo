// ============================================
// API ROUTE: GET /api/notifications/all
// ============================================
// All (read + unread) unexpired notifications addressed to the current user,
// for the notifications page.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        user_id: session.user.id,
        OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
      },
      orderBy: { created_at: "desc" },
      take: 300,
    });

    return NextResponse.json({
      success: true,
      notifications,
      total: notifications.length,
      unread: notifications.filter((n) => !n.is_read).length,
    });
  } catch (error) {
    console.error("Error fetching all notifications:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}
