// app/api/settings/accounts/route.js
//
// Finance → Account Settings (lib/accounts/accountSettings.js).
//   GET  any signed-in user — pickers and report filters need the party, cash
//        and bank groups. Returns every definition with its current value.
//   PUT  settings.manage —
//        { settings:   [{ key, acno } | { key, macnos } | { key, acnos }],
//          categories: [{ id, <CATEGORY_ACCOUNT_COLUMNS key>? }] }
//        All-or-nothing: any invalid entry rejects the whole request (400)
//        with per-key errors.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse, guard } from "@/lib/auth/route";
import {
  ACCOUNT_SETTING_DEFS,
  ACCOUNT_SETTING_BY_KEY,
  invalidateAccountSettings,
} from "@/lib/accounts/accountSettings";
import { ACCOUNT_SETTING_SECTIONS, CATEGORY_ACCOUNT_COLUMNS } from "@/lib/accounts/accountSettingDefs";
import { feature } from "@/lib/features/server";

const CATEGORY_KEYS = CATEGORY_ACCOUNT_COLUMNS.map((c) => c.key);
const ints = (list) => (list || []).map(Number).filter(Number.isFinite);

async function buildPayload() {
  let rows = [];
  try {
    rows = await prisma.accountSetting.findMany();
  } catch (error) {
    console.error("[settings/accounts] account_settings not readable:", error?.message);
  }
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  let categories = [];
  try {
    categories = await prisma.itemCategory.findMany({
      orderBy: { ic_name: "asc" },
      select: { id: true, ic_name: true, ...Object.fromEntries(CATEGORY_KEYS.map((k) => [k, true])) },
    });
  } catch (error) {
    console.error("[settings/accounts] item categories not readable:", error?.message);
  }

  const acnoIds = new Set();
  const macnoIds = new Set();
  for (const def of ACCOUNT_SETTING_DEFS) {
    const row = byKey[def.key];
    if (def.kind === "ACCOUNT" && row?.acno != null) acnoIds.add(row.acno);
    if (def.kind === "LIST") ints(row?.acnos).forEach((a) => acnoIds.add(a));
    if (def.kind === "GROUP") ints(row?.macnos).forEach((m) => macnoIds.add(m));
  }
  for (const c of categories) for (const k of CATEGORY_KEYS) if (c[k] != null) acnoIds.add(c[k]);

  const [accounts, mains] = await Promise.all([
    acnoIds.size
      ? prisma.aCNO.findMany({ where: { acno: { in: [...acnoIds] } }, select: { acno: true, acname: true } })
      : [],
    macnoIds.size
      ? prisma.mACNO.findMany({ where: { macno: { in: [...macnoIds] } }, select: { macno: true, macname: true } })
      : [],
  ]);
  const acname = Object.fromEntries(accounts.map((a) => [a.acno, a.acname]));
  const macname = Object.fromEntries(mains.map((m) => [m.macno, m.macname]));
  const acRef = (acno) => ({ acno, acname: acname[acno] ?? null, missing: acname[acno] == null });

  // Direct / Indirect payroll rows (variantOf) only while Settings → Features
  // hr.payrollAccountsByCategory is on — off, nothing reads them.
  const byCategory = await feature("hr.payrollAccountsByCategory");
  const settings = ACCOUNT_SETTING_DEFS.filter((def) => byCategory || !def.variantOf).map((def) => {
    const row = byKey[def.key];
    const base = {
      key: def.key, kind: def.kind, section: def.section, label: def.label, help: def.help,
      usedBy: def.usedBy, postings: def.postings || [], required: def.required,
      variantOf: def.variantOf ?? null, salaryCategory: def.salaryCategory ?? null,
      stored: !!row, updated_by: row?.updated_by ?? null, updated_at: row?.updated_at ?? null,
    };
    if (def.kind === "ACCOUNT") {
      const acno = row?.acno ?? null;
      return { ...base, acno, account: acno != null ? acRef(acno) : null };
    }
    if (def.kind === "LIST") {
      return { ...base, acnos: ints(row?.acnos), accounts: ints(row?.acnos).map(acRef) };
    }
    const list = ints(row?.macnos);
    return { ...base, macnos: list, groups: list.map((m) => ({ macno: m, macname: macname[m] ?? null })) };
  });

  const categoryRows = categories.map((c) => {
    const row = { id: c.id, name: c.ic_name };
    for (const k of CATEGORY_KEYS) row[k] = c[k] != null ? acRef(c[k]) : null;
    return row;
  });

  return {
    sections: ACCOUNT_SETTING_SECTIONS,
    settings,
    groups: Object.fromEntries(settings.filter((s) => s.kind === "GROUP").map((s) => [s.key, s.macnos])),
    accounts: Object.fromEntries(settings.filter((s) => s.kind === "ACCOUNT").map((s) => [s.key, s.acno])),
    categoryColumns: CATEGORY_ACCOUNT_COLUMNS,
    categories: categoryRows,
  };
}

export async function GET() {
  try {
    await authorize(null);
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }
  try {
    return NextResponse.json(await buildPayload());
  } catch (error) {
    console.error("GET /api/settings/accounts:", error);
    return NextResponse.json({ error: "Failed to load account settings" }, { status: 500 });
  }
}

const toInt = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v?.value ?? v);
  return Number.isInteger(n) ? n : NaN;
};
const toIntList = (raw) => (Array.isArray(raw) ? raw.map(toInt) : []);

export const PUT = guard("settings.manage", async (request, { session }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const list = Array.isArray(body?.settings) ? body.settings : body?.key ? [body] : [];
  const catList = Array.isArray(body?.categories) ? body.categories : [];
  if (!list.length && !catList.length) {
    return NextResponse.json({ error: "Send { settings: [...] } and / or { categories: [...] }" }, { status: 400 });
  }

  const errors = {};
  const updates = [];
  const byCategory = await feature("hr.payrollAccountsByCategory");
  for (const item of list) {
    const def = ACCOUNT_SETTING_BY_KEY[item?.key];
    if (!def) {
      errors[item?.key ?? "?"] = "Unknown setting";
      continue;
    }
    if (def.variantOf && !byCategory) {
      errors[def.key] = "Payroll accounts by Direct / Indirect are switched off (Settings → Features)";
      continue;
    }
    if (def.kind === "ACCOUNT") {
      const acno = toInt(item.acno);
      if (Number.isNaN(acno)) errors[def.key] = "Choose an account";
      else if (acno == null && def.required) errors[def.key] = "This account is required — documents cannot post without it";
      else updates.push({ def, acno, macnos: [], acnos: [] });
      continue;
    }
    const ids = toIntList(def.kind === "GROUP" ? item.macnos : item.acnos);
    if (ids.some((v) => v == null || Number.isNaN(v))) {
      errors[def.key] = def.kind === "GROUP" ? "Groups must be main account numbers" : "List must be account numbers";
      continue;
    }
    const unique = [...new Set(ids)];
    if (def.kind === "GROUP" && def.required && !unique.length) {
      errors[def.key] = "Choose at least one main account";
      continue;
    }
    updates.push({ def, acno: null, macnos: def.kind === "GROUP" ? unique : [], acnos: def.kind === "LIST" ? unique : [] });
  }

  const catUpdates = [];
  for (const c of catList) {
    const id = toInt(c?.id);
    if (id == null || Number.isNaN(id)) {
      errors[`category:${c?.id}`] = "Unknown category";
      continue;
    }
    const data = {};
    for (const k of CATEGORY_KEYS) {
      if (!(k in c)) continue;
      const v = toInt(c[k]);
      if (Number.isNaN(v)) errors[`category:${id}`] = "Accounts must be account numbers";
      else data[k] = v;
    }
    catUpdates.push({ id, data });
  }

  // Accounts must exist and be posting accounts; groups must be main accounts.
  const acnoIds = [...new Set([
    ...updates.flatMap((u) => (u.acno != null ? [u.acno] : u.acnos)),
    ...catUpdates.flatMap((u) => Object.values(u.data).filter((v) => v != null)),
  ])];
  const macnoIds = [...new Set(updates.flatMap((u) => u.macnos))];
  const [foundAc, foundMac] = await Promise.all([
    acnoIds.length ? prisma.aCNO.findMany({ where: { acno: { in: acnoIds } }, select: { acno: true } }) : [],
    macnoIds.length ? prisma.mACNO.findMany({ where: { macno: { in: macnoIds } }, select: { macno: true } }) : [],
  ]);
  const hasAc = new Set(foundAc.map((a) => a.acno));
  const hasMac = new Set(foundMac.map((m) => m.macno));

  for (const u of updates) {
    const key = u.def.key;
    if (u.acno != null && !hasAc.has(u.acno)) errors[key] = `Account ${u.acno} does not exist`;
    const badAc = u.acnos.filter((a) => !hasAc.has(a));
    if (badAc.length) errors[key] = `Account ${badAc.join(", ")} does not exist`;
    const badMac = u.macnos.filter((m) => !hasMac.has(m));
    if (badMac.length) errors[key] = `Main account ${badMac.join(", ")} does not exist`;
  }
  for (const u of catUpdates) {
    const bad = Object.values(u.data).filter((v) => v != null && !hasAc.has(v));
    if (bad.length) errors[`category:${u.id}`] = `Account ${bad.join(", ")} does not exist`;
  }

  if (Object.keys(errors).length) {
    return NextResponse.json({ error: "Some settings are invalid", errors }, { status: 400 });
  }

  const who = session?.user?.name || session?.user?.email || String(session?.user?.id ?? "");
  try {
    await prisma.$transaction([
      ...catUpdates
        .filter((u) => Object.keys(u.data).length)
        .map((u) => prisma.itemCategory.update({ where: { id: u.id }, data: u.data })),
      ...updates.map(({ def, acno, macnos, acnos }) =>
        prisma.accountSetting.upsert({
          where: { key: def.key },
          create: { key: def.key, kind: def.kind, section: def.section, label: def.label, acno, macnos, acnos, updated_by: who },
          update: { kind: def.kind, section: def.section, label: def.label, acno, macnos, acnos, updated_by: who },
        }),
      ),
    ]);
  } catch (error) {
    console.error("PUT /api/settings/accounts:", error);
    return NextResponse.json({ error: "Failed to save account settings" }, { status: 500 });
  } finally {
    invalidateAccountSettings();
  }

  return NextResponse.json({ message: "Account settings saved", ...(await buildPayload()) });
});
