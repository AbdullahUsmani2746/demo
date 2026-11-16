// app/api/settings/pos/route.js — Settings → Point of Sale (lib/pos/settingsConfig.js).
//   GET → { values, fields, defaults, accounts, canEdit, changedAt, changedBy }   any signed-in user (the till reads it)
//   PUT { values } | { reset: true }                                              settings.manage only
// The Settings row (key "posSettings") is written through `prisma`, so every
// change is in the audit trail.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { getAccount } from "@/lib/accounts/accountSettings";
import {
  POS_SETTINGS_KEY,
  POS_SETTINGS_FIELDS,
  POS_SETTINGS_DEFAULTS,
  resolvePosSettings,
  normalizePosSettings,
  posSettingsShapeError,
  primePosSettings,
} from "@/lib/pos/settings";

const PERMISSION = "settings.manage";
const POS_ACCOUNT_KEYS = ["pos_sales", "pos_cash", "pos_card", "pos_tax", "pos_round_off"];

async function state(session) {
  const [row, canEdit, ...accs] = await Promise.all([
    prisma.settings.findUnique({ where: { key: POS_SETTINGS_KEY }, select: { value: true, description: true, last_updated: true } }),
    can(session, PERMISSION),
    ...POS_ACCOUNT_KEYS.map((k) => getAccount(k)),
  ]);
  const ids = accs.filter((a) => a != null);
  const names = ids.length ? await prisma.aCNO.findMany({ where: { acno: { in: ids } }, select: { acno: true, acname: true } }) : [];
  const nameOf = new Map(names.map((n) => [n.acno, n.acname]));
  return {
    values: resolvePosSettings(row?.value ?? null),
    fields: POS_SETTINGS_FIELDS,
    defaults: POS_SETTINGS_DEFAULTS,
    accounts: POS_ACCOUNT_KEYS.map((key, i) => ({ key, acno: accs[i] ?? null, name: accs[i] != null ? nameOf.get(accs[i]) ?? null : null })),
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
    await prisma.settings.deleteMany({ where: { key: POS_SETTINGS_KEY } });
    primePosSettings(null);
    return NextResponse.json({ ...(await state(session)), message: "Point of sale settings are back to the defaults." });
  }

  const shapeError = posSettingsShapeError(body?.values);
  if (shapeError) return NextResponse.json({ message: shapeError }, { status: 400 });

  const row = await prisma.settings.findUnique({ where: { key: POS_SETTINGS_KEY }, select: { value: true } });
  const merged = resolvePosSettings({ ...resolvePosSettings(row?.value ?? null), ...body.values });

  // The godown must be an open godown, the walk-in account a real account.
  const godown = await prisma.godown.findFirst({ where: { id: merged.godown, is_active: true }, select: { id: true } });
  if (!godown) return NextResponse.json({ message: `Godown ${merged.godown} is unknown or closed.` }, { status: 400 });
  if (merged.walkInAccount != null) {
    const acc = await prisma.aCNO.findUnique({ where: { acno: merged.walkInAccount }, select: { acno: true } });
    if (!acc) return NextResponse.json({ message: `Account ${merged.walkInAccount} does not exist.` }, { status: 400 });
  }

  if (merged.categoryIds.length) {
    const cats = await prisma.itemCategory.findMany({ where: { id: { in: merged.categoryIds } }, select: { id: true } });
    const known = new Set(cats.map((c) => c.id));
    const bad = merged.categoryIds.filter((id) => !known.has(id));
    if (bad.length) return NextResponse.json({ message: `Unknown item categor${bad.length > 1 ? "ies" : "y"}: ${bad.join(", ")}` }, { status: 400 });
  }

  const clean = normalizePosSettings(merged);
  const value = JSON.stringify(clean);
  const description = `Changed by ${by}`.slice(0, 190);
  await prisma.settings.upsert({
    where: { key: POS_SETTINGS_KEY },
    update: { value, description },
    create: { key: POS_SETTINGS_KEY, value, description },
  });
  primePosSettings(clean);
  return NextResponse.json({ ...(await state(session)), message: "Point of sale settings saved." });
});
