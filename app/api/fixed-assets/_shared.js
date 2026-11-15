// app/api/fixed-assets/_shared.js — helpers for the fixed-asset routes.
import { NextResponse } from "next/server";
import { faErrorBody } from "@/lib/fixedAssets/errors";
import { feature } from "@/lib/features/server";

/** FaError → its status; anything else → 500 (logged). */
export function faResponse(error, where) {
  const known = faErrorBody(error);
  if (known) return NextResponse.json(known.body, { status: known.status });
  console.error(`[fixed-assets] ${where}:`, error);
  return NextResponse.json({ message: error?.message || "Failed" }, { status: 500 });
}

/** 403 while a Settings → Features switch is off, else null. */
export async function featureOff(key, what) {
  if (await feature(key)) return null;
  return NextResponse.json({ message: `${what} is switched off (Settings → Features → Fixed assets).` }, { status: 403 });
}

export const actorOf = (session) => session?.user?.id ?? null;
