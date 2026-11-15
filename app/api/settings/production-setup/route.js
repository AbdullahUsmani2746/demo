// app/api/settings/production-setup/route.js — Settings → Production setup (lib/production/setupConfig.js).
//   GET → { values, fields, defaults, canEdit, changedAt, changedBy }   any signed-in user (forms read it)
//   PUT { values } | { reset: true }                                     settings.manage only
// The Settings row (key "productionSetup") is written through `prisma`, so
// every change is in the audit trail.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import {
  PRODUCTION_SETUP_KEY,
  PRODUCTION_SETUP_FIELDS,
  PRODUCTION_SETUP_DEFAULTS,
  CATEGORY_FIELDS,
  resolveProductionSetup,
  normalizeProductionSetup,
  productionSetupShapeError,
  categoryOverlapError,
  primeProductionSetup,
} from "@/lib/production/setup";

const PERMISSION = "settings.manage";

async function state(session) {
  const [row, canEdit] = await Promise.all([
    prisma.settings.findUnique({
      where: { key: PRODUCTION_SETUP_KEY },
      select: { value: true, description: true, last_updated: true },
    }),
    can(session, PERMISSION),
  ]);
  return {
    values: resolveProductionSetup(row?.value ?? null),
    fields: PRODUCTION_SETUP_FIELDS,
    defaults: PRODUCTION_SETUP_DEFAULTS,
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
    await prisma.settings.deleteMany({ where: { key: PRODUCTION_SETUP_KEY } });
    primeProductionSetup(null);
    return NextResponse.json({ ...(await state(session)), message: "Production setup is back to the defaults." });
  }

  const shapeError = productionSetupShapeError(body?.values);
  if (shapeError) return NextResponse.json({ message: shapeError }, { status: 400 });

  // Merge over what is stored, so a screen may send just the changed fields.
  const row = await prisma.settings.findUnique({ where: { key: PRODUCTION_SETUP_KEY }, select: { value: true } });
  const merged = resolveProductionSetup({ ...resolveProductionSetup(row?.value ?? null), ...body.values });

  const overlap = categoryOverlapError(merged);
  if (overlap) return NextResponse.json({ message: overlap }, { status: 400 });

  // Every id must be a real item category / an open godown.
  const categoryIds = [...new Set(CATEGORY_FIELDS.flatMap((k) => merged[k]))];
  const godownIds = [...new Set(PRODUCTION_SETUP_FIELDS.filter((f) => f.type === "godown").map((f) => merged[f.key]))];
  const [categories, godowns] = await Promise.all([
    prisma.itemCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true } }),
    prisma.godown.findMany({ where: { id: { in: godownIds }, is_active: true }, select: { id: true } }),
  ]);
  const knownCats = new Set(categories.map((c) => c.id));
  const badCats = categoryIds.filter((id) => !knownCats.has(id));
  if (badCats.length) return NextResponse.json({ message: `Unknown item categor${badCats.length > 1 ? "ies" : "y"}: ${badCats.join(", ")}` }, { status: 400 });
  const knownGodowns = new Set(godowns.map((g) => g.id));
  const badGodowns = godownIds.filter((id) => !knownGodowns.has(id));
  if (badGodowns.length) return NextResponse.json({ message: `Unknown or closed godown(s): ${badGodowns.join(", ")}` }, { status: 400 });

  const clean = normalizeProductionSetup(merged);
  const value = JSON.stringify(clean);
  const description = `Changed by ${by}`.slice(0, 190);
  await prisma.settings.upsert({
    where: { key: PRODUCTION_SETUP_KEY },
    update: { value, description },
    create: { key: PRODUCTION_SETUP_KEY, value, description },
  });
  // This server process uses it at once; any other within 10 s.
  primeProductionSetup(clean);
  return NextResponse.json({ ...(await state(session)), message: "Production setup saved." });
});
