import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code")?.trim();
    const excludeItcd = searchParams.get("exclude");

    if (!code) return NextResponse.json({ exists: false });

    const existing = await prisma.item.findFirst({
      where: {
        code: { equals: code, mode: "insensitive" },
        ...(excludeItcd ? { itcd: { not: parseInt(excludeItcd) } } : {}),
      },
      select: { itcd: true, item: true },
    });

    return NextResponse.json({
      exists: !!existing,
      itcd: existing?.itcd ?? null,
      item: existing?.item ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to check ink code", details: error.message },
      { status: 500 }
    );
  }
}
