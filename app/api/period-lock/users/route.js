import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// GET /api/period-lock/users — active users to pick from when granting an exception
export const GET = guard("period.lock", async (request, { session }) => {
  try {

    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    });
    return NextResponse.json(users);
  } catch (error) {
    console.error("Period lock users GET error:", error);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
});
