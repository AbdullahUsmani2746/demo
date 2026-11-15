// app/api/settings/features/route.js — Settings → Features (lib/features/catalog.js).
//   GET → { values, features, groups, canEdit, changedAt, changedBy }   any signed-in user (forms read it)
//   PUT { values } | { reset: true }                                     settings.manage only
// The Settings row (key "featureFlags") is written through `prisma`, so every
// change is in the audit trail.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import {
  FEATURE_FLAGS_KEY,
  FEATURES,
  FEATURE_GROUPS,
  resolveFeatures,
  normalizeFeatures,
  featuresShapeError,
  primeFeatures,
} from "@/lib/features/server";

const PERMISSION = "settings.manage";

async function state(session) {
  const [row, canEdit] = await Promise.all([
    prisma.settings.findUnique({
      where: { key: FEATURE_FLAGS_KEY },
      select: { value: true, description: true, last_updated: true },
    }),
    can(session, PERMISSION),
  ]);
  return {
    values: resolveFeatures(row?.value ?? null),
    features: FEATURES,
    groups: FEATURE_GROUPS,
    canEdit,
    changedAt: row?.last_updated ?? null,
    changedBy: row?.description ?? null,
  };
}

export const GET = guard(null, async (req, { session }) => NextResponse.json(await state(session)));

export const PUT = guard(PERMISSION, async (req, { session }) => {
  const body = await req.json().catch(() => ({}));
  const by = session.user.name || session.user.email || session.user.id;

  if (body?.reset === true) {
    await prisma.settings.deleteMany({ where: { key: FEATURE_FLAGS_KEY } });
    primeFeatures(null);
    return NextResponse.json({ ...(await state(session)), message: "Features are back to the defaults." });
  }

  const error = featuresShapeError(body?.values);
  if (error) return NextResponse.json({ message: error }, { status: 400 });

  // Merge over what is stored, so a screen may send just the changed features.
  const row = await prisma.settings.findUnique({ where: { key: FEATURE_FLAGS_KEY }, select: { value: true } });
  const merged = { ...resolveFeatures(row?.value ?? null), ...body.values };
  const clean = normalizeFeatures(merged);
  const value = JSON.stringify(clean);
  const description = `Changed by ${by}`.slice(0, 190);
  await prisma.settings.upsert({
    where: { key: FEATURE_FLAGS_KEY },
    update: { value, description },
    create: { key: FEATURE_FLAGS_KEY, value, description },
  });
  // This server process uses it at once; any other within 10 s.
  primeFeatures(clean);
  return NextResponse.json({ ...(await state(session)), message: "Features saved." });
});
