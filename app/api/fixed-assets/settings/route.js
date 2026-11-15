// /api/fixed-assets/settings — Settings → Fixed assets.
//   GET  any signed-in user: { defs, groups, settings, categories, accountDefaults, canEdit }
//   PUT  settings.manage:
//        { settings?: { <FA_SETTING_DEFS key>: value },          → Settings "fixedAssetSettings"
//          categories?: [{ ic_id, method, useful_life_months, rb_rate,
//                          salvage_pct, cost_acno, accdep_acno, depexp_acno, gainloss_acno }] }
//        All-or-nothing; every write through `prisma` (audited).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { setAuditActor } from "@/lib/audit/context";
import { getAccount } from "@/lib/accounts/accountSettings";
import {
  FA_SETTINGS_KEY, FA_SETTING_DEFS, FA_SETTING_GROUPS, FA_CATEGORY_ACCOUNTS, DEPRECIATION_METHODS,
  resolveFaSettings, faSettingsErrors, compactFaSettings, primeFaSettings,
} from "@/lib/fixedAssets/settings";
import { fixedAssetCategoryIds } from "@/lib/fixedAssets/register";

async function state(session) {
  const [row, ids, canEdit, defaults] = await Promise.all([
    prisma.settings.findUnique({ where: { key: FA_SETTINGS_KEY } }),
    fixedAssetCategoryIds(),
    can(session, "settings.manage"),
    Promise.all(FA_CATEGORY_ACCOUNTS.map((a) => getAccount(a.key))),
  ]);
  const [cats, own] = await Promise.all([
    prisma.itemCategory.findMany({ where: { id: { in: ids } }, select: { id: true, ic_name: true }, orderBy: { ic_name: "asc" } }),
    prisma.faCategoryDefault.findMany({ where: { ic_id: { in: ids } } }),
  ]);
  const ownBy = new Map(own.map((r) => [r.ic_id, r]));
  const acnos = new Set(defaults.filter(Boolean));
  own.forEach((r) => FA_CATEGORY_ACCOUNTS.forEach((a) => r[a.col] && acnos.add(r[a.col])));
  const names = acnos.size ? await prisma.aCNO.findMany({ where: { acno: { in: [...acnos] } }, select: { acno: true, acname: true } }) : [];
  const acname = Object.fromEntries(names.map((a) => [a.acno, a.acname]));
  return {
    defs: FA_SETTING_DEFS,
    groups: FA_SETTING_GROUPS,
    methods: DEPRECIATION_METHODS,
    accountColumns: FA_CATEGORY_ACCOUNTS,
    settings: resolveFaSettings(row?.value ?? null),
    changedAt: row?.last_updated ?? null,
    changedBy: row?.description ?? null,
    accountDefaults: FA_CATEGORY_ACCOUNTS.map((a, i) => ({ ...a, acno: defaults[i] ?? null, acname: acname[defaults[i]] ?? null })),
    categories: cats.map((c) => {
      const r = ownBy.get(c.id) ?? {};
      return {
        ic_id: c.id, name: c.ic_name, method: r.method ?? null, useful_life_months: r.useful_life_months ?? null,
        rb_rate: r.rb_rate ?? null, salvage_pct: r.salvage_pct ?? null,
        ...Object.fromEntries(FA_CATEGORY_ACCOUNTS.map((a) => [a.col, r[a.col] ?? null])),
        ...Object.fromEntries(FA_CATEGORY_ACCOUNTS.map((a) => [`${a.col}_name`, r[a.col] ? acname[r[a.col]] ?? null : null])),
      };
    }),
    canEdit,
  };
}

export const GET = guard(null, async (req, { session }) => NextResponse.json(await state(session)));

const blankToNull = (v) => (v === "" || v === undefined ? null : v);

export const PUT = guard("settings.manage", async (req, { session }) => {
  setAuditActor(session);
  const body = await req.json().catch(() => ({}));
  const errors = {};
  const by = session.user.name || session.user.email || session.user.id;

  let settingsValue = null;
  if (body.settings) {
    Object.assign(errors, faSettingsErrors(body.settings));
    const row = await prisma.settings.findUnique({ where: { key: FA_SETTINGS_KEY } });
    settingsValue = JSON.stringify(compactFaSettings({ ...resolveFaSettings(row?.value ?? null), ...body.settings }));
  }

  const catUpdates = [];
  if (Array.isArray(body.categories)) {
    const allowed = new Set(await fixedAssetCategoryIds());
    const acnoIds = new Set();
    for (const c of body.categories) {
      const id = Number(c?.ic_id);
      if (!allowed.has(id)) { errors[`category:${c?.ic_id}`] = "Not a fixed-asset category"; continue; }
      const d = {};
      const m = blankToNull(c.method);
      if (m != null && !["SL", "RB"].includes(m)) errors[`category:${id}`] = "Method: SL or RB";
      d.method = m;
      const num = (v, min, max, label, int = false) => {
        v = blankToNull(v);
        if (v == null) return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) { errors[`category:${id}`] = `${label}: ${min} to ${max}`; return null; }
        return n;
      };
      d.useful_life_months = num(c.useful_life_months, 1, 1200, "Useful life (months)", true);
      d.rb_rate = num(c.rb_rate, 0.01, 100, "Rate %");
      d.salvage_pct = num(c.salvage_pct, 0, 100, "Salvage %");
      for (const a of FA_CATEGORY_ACCOUNTS) {
        d[a.col] = num(c[a.col]?.value ?? c[a.col], 1, 2 ** 31 - 1, a.label, true);
        if (d[a.col] != null) acnoIds.add(d[a.col]);
      }
      catUpdates.push({ id, d });
    }
    if (acnoIds.size) {
      const found = new Set((await prisma.aCNO.findMany({ where: { acno: { in: [...acnoIds] } }, select: { acno: true } })).map((a) => a.acno));
      const bad = [...acnoIds].filter((a) => !found.has(a));
      if (bad.length) errors.accounts = `Account ${bad.join(", ")} does not exist`;
    }
  }
  if (Object.keys(errors).length) return NextResponse.json({ message: "Some settings are invalid", errors }, { status: 400 });
  if (settingsValue == null && !catUpdates.length) return NextResponse.json({ message: "Send { settings } and / or { categories }" }, { status: 400 });

  await prisma.$transaction([
    ...(settingsValue != null
      ? [prisma.settings.upsert({
          where: { key: FA_SETTINGS_KEY },
          create: { key: FA_SETTINGS_KEY, value: settingsValue, description: by },
          update: { value: settingsValue, description: by },
        })]
      : []),
    ...catUpdates.map(({ id, d }) => prisma.faCategoryDefault.upsert({
      where: { ic_id: id },
      create: { ic_id: id, ...d, updated_by: by },
      update: { ...d, updated_by: by },
    })),
  ]);
  if (settingsValue != null) primeFaSettings(settingsValue);
  return NextResponse.json({ message: "Fixed asset settings saved", ...(await state(session)) });
});
