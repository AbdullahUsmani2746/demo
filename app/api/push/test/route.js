// POST /api/push/test — send a test notification to the signed-in user's
// devices (Notifications → Phone notifications → "Send a test").
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { pushTest } from "@/lib/notifications/push";

export const POST = guard(null, async (req, { session }) => {
  const result = await pushTest(prisma, session.user.id);
  return NextResponse.json({ success: true, ...result });
});
