// app/api/settings/stock-check/route.js — Settings → Stock checking
// (lib/stock/policy.js).
//   GET → { policy, modes, screen, explicit, types, canEdit, changedAt, changedBy }
//         any signed-in user (every form needs the modes)
//   PUT { policy } | { reset: true }                    settings.manage only
// The Settings row (key "stockCheckPolicy") is written through `prisma`, so
// every change is in the audit trail.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import {
  STOCK_POLICY_KEY,
  STOCK_CHECK_TYPES,
  normalizeStockPolicy,
  resolveStockPolicy,
  stockPolicyShapeError,
  primeStockPolicy,
} from "@/lib/stock/policy";

const PERMISSION = "settings.manage";

async function state(session) {
  const [row, canEdit] = await Promise.all([
    prisma.settings.findUnique({
      where: { key: STOCK_POLICY_KEY },
      select: { value: true, description: true, last_updated: true },
    }),
    can(session, PERMISSION),
  ]);
  const resolved = resolveStockPolicy(row?.value ?? null);
  return {
    policy: resolved.policy,
    modes: resolved.modes,
    screen: resolved.screen,
    explicit: resolved.explicit,
    types: STOCK_CHECK_TYPES,
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
    await prisma.settings.deleteMany({ where: { key: STOCK_POLICY_KEY } });
    primeStockPolicy(null);
    return NextResponse.json({ ...(await state(session)), message: "Stock checking is back to the defaults." });
  }

  const error = stockPolicyShapeError(body?.policy);
  if (error) return NextResponse.json({ message: error }, { status: 400 });

  const clean = normalizeStockPolicy(body.policy);
  const value = JSON.stringify(clean);
  const description = `Changed by ${by}`.slice(0, 190);
  await prisma.settings.upsert({
    where: { key: STOCK_POLICY_KEY },
    update: { value, description },
    create: { key: STOCK_POLICY_KEY, value, description },
  });
  // This server process uses it at once; any other within 10 s.
  primeStockPolicy(clean);
  return NextResponse.json({ ...(await state(session)), message: "Stock checking saved." });
});
