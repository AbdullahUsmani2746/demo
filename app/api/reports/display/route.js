// GET / PUT /api/reports/display — the signed-in user's own report Display
// settings (text size, bold columns, lakh / international grouping, thousand /
// lakh / crore, negatives, decimals, dates, highlight rules).
// Stored in Settings under reportDisplay:<userId> (lib/reports/displayPrefs.js);
// every user may read and change only their own.
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { cleanDisplay, displayKey, parseDisplay } from "@/lib/reports/displayPrefs";

export const GET = guard(null, async (_req, { session }) => {
  const row = await prisma.settings.findUnique({
    where: { key: displayKey(session.user.id) },
    select: { value: true },
  });
  return NextResponse.json({ display: parseDisplay(row?.value), saved: !!row });
});

export const PUT = guard(null, async (req, { session }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const display = cleanDisplay(body?.display ?? body);
  const key = displayKey(session.user.id);
  const value = JSON.stringify(display);
  await prisma.settings.upsert({
    where: { key },
    update: { value },
    create: { key, value, description: "Report Display settings of one user" },
  });
  return NextResponse.json({ display });
});
