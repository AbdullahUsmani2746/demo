// ============================================
// API ROUTE: GET /api/notifications/link?id=<notificationId>
// ============================================
// The page a notification points to — asked for only when the user CLICKS a
// notification. Kept out of GET /api/notifications on purpose: the bell polls
// that every second, and the lookup here must not run on every poll.
//
// Read-only: one notification by id (scoped to the session user) plus at most
// one primary-key lookup to resolve the page. Nothing is written or stored.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { attachNotificationLinks } from "@/lib/notifications/links";

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ link: null });

    const notification = await prisma.notification.findFirst({
      where: { id, user_id: session.user.id },
      select: { id: true, event_code: true, entity: true, entity_id: true },
    });
    if (!notification) return NextResponse.json({ link: null });

    const [withLink] = await attachNotificationLinks(prisma, [notification]);
    return NextResponse.json({ link: withLink?.link ?? null });
  } catch (error) {
    console.error("Error resolving notification link:", error);
    // A missing link is not an error for the user — the click still marks it read
    return NextResponse.json({ link: null });
  }
}
