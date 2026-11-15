// ============================================
// API ROUTE: PUT /api/notifications/mark-all-read
// ============================================
// Marks every unread notification addressed to the current user as read.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

export const PUT = guard(null, async (req) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await prisma.notification.updateMany({
      where: { user_id: session.user.id, is_read: false },
      data: { is_read: true, read_at: new Date() },
    });

    return NextResponse.json({
      success: true,
      message: `${result.count} notifications marked as read`,
      count: result.count,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
});
