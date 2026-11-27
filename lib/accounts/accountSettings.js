// lib/accounts/accountSettings.js
// ============================================================
// Server-side reader for Finance > Account Settings (table account_settings,
// definitions in ./accountSettingDefs.js). Every automatic posting and every
// party / cash / bank filter reads its account from here.
//
//   await getAccount("sales_tax_output")    → 2350 | null
//   await requireAccount("freight_inward")  → acno, or throws a 422 Error
//                                             "Set '<label>' in Finance → Account Settings"
//   await getAccountGroup("customers")      → [2, 6]   (macnos)
//   await getAccountList("blocked_voucher_accounts") → [860]  (acnos)
//
// Values are cached for 60s (on globalThis, so every route bundle in the
// process shares one cache) and dropped when settings are saved.
// ============================================================
import prisma from "@/lib/prisma";
import {
  ACCOUNT_SETTING_DEFS,
  ACCOUNT_SETTING_BY_KEY,
  categoryAccountKey,
  missingAccountMessage,
  PAYROLL_BY_CATEGORY_KEYS,
  SALARY_CATEGORIES,
} from "./accountSettingDefs";

export { ACCOUNT_SETTING_DEFS, ACCOUNT_SETTING_BY_KEY, missingAccountMessage };

const TTL_MS = 60 * 1000;
const CACHE_KEY = "__smsAccountSettingsCache";

function cacheBox() {
  if (!globalThis[CACHE_KEY]) globalThis[CACHE_KEY] = { at: 0, rows: null, pending: null, gen: 0 };
  return globalThis[CACHE_KEY];
}

/** Drop the cache (call after saving settings). */
export function invalidateAccountSettings() {
  const box = cacheBox();
  box.gen += 1; // a load already in flight must not repopulate the cache
  box.at = 0;
  box.rows = null;
  box.pending = null;
}

async function loadRows() {
  try {
    const rows = await prisma.accountSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r]));
  } catch (error) {
    // Table not created yet: every setting reads as "not set".
    console.error("[accountSettings] could not read account_settings:", error?.message);
    return {};
  }
}

async function rowsByKey() {
  const box = cacheBox();
  if (box.rows && Date.now() - box.at < TTL_MS) return box.rows;
  if (!box.pending) {
    const gen = box.gen;
    const pending = loadRows()
      .then((rows) => {
        if (box.gen === gen) {
          box.rows = rows;
          box.at = Date.now();
        }
        return rows;
      })
      .finally(() => {
        if (box.pending === pending) box.pending = null;
      });
    box.pending = pending;
  }
  return box.pending;
}

const ints = (list) => (list || []).map(Number).filter(Number.isFinite);

function defOf(key, kind) {
  const def = ACCOUNT_SETTING_BY_KEY[key];
  if (!def || def.kind !== kind) throw new Error(`Unknown ${kind.toLowerCase()} setting "${key}"`);
  return def;
}

/** Single posting account for `key`, or null when not set. */
export async function getAccount(key) {
  defOf(key, "ACCOUNT");
  return (await rowsByKey())[key]?.acno ?? null;
}

/**
 * A payroll account for an employee's salary category (DIRECT / INDIRECT):
 * the category's own account when set, else the default `key`. Keys without
 * category accounts, or no category, read the default; so does everything
 * while Settings → Features hr.payrollAccountsByCategory is off.
 */
export async function payrollAccountFor(key, category) {
  // Settings → Features hr.payrollAccountsByCategory: off = one account for everyone.
  const { feature } = await import("@/lib/features/server");
  if (SALARY_CATEGORIES.some((c) => c.value === category) && PAYROLL_BY_CATEGORY_KEYS.includes(key) && (await feature("hr.payrollAccountsByCategory"))) {
    const own = await getAccount(categoryAccountKey(key, category));
    if (own != null) return own;
  }
  return getAccount(key);
}

/** Like getAccount, but a missing account refuses the posting (422). */
export async function requireAccount(key) {
  const acno = await getAccount(key);
  if (acno == null) throw accountSettingError(key);
  return acno;
}

/** Main accounts (macno) of the group `key` (may be empty). */
export async function getAccountGroup(key) {
  defOf(key, "GROUP");
  return ints((await rowsByKey())[key]?.macnos);
}

/** Like getAccountGroup, but an empty required group refuses (422). */
export async function requireAccountGroup(key) {
  const macnos = await getAccountGroup(key);
  if (!macnos.length) throw accountSettingError(key);
  return macnos;
}

/** Union of several groups' macnos (unknown / non-group keys are ignored). */
export async function getAccountGroups(keys) {
  const rows = await rowsByKey();
  const out = new Set();
  for (const key of keys) {
    if (ACCOUNT_SETTING_BY_KEY[key]?.kind !== "GROUP") continue;
    for (const m of ints(rows[key]?.macnos)) out.add(m);
  }
  return [...out];
}

/** Individual accounts of the list `key` (may be empty). */
export async function getAccountList(key) {
  defOf(key, "LIST");
  return ints((await rowsByKey())[key]?.acnos);
}

/** Is `macno` inside group `key`? */
export async function isInGroup(key, macno) {
  return (await getAccountGroup(key)).includes(Number(macno));
}

/** Every setting resolved: { key: { kind, acno | macnos | acnos } } (cached). */
export async function getAllAccountSettings() {
  const rows = await rowsByKey();
  return Object.fromEntries(
    ACCOUNT_SETTING_DEFS.map((def) => {
      const row = rows[def.key];
      if (def.kind === "GROUP") return [def.key, { kind: def.kind, macnos: ints(row?.macnos) }];
      if (def.kind === "LIST") return [def.key, { kind: def.kind, acnos: ints(row?.acnos) }];
      return [def.key, { kind: def.kind, acno: row?.acno ?? null }];
    }),
  );
}

/** A 422 error naming the setting to fill in. */
export function accountSettingError(key, detail = "") {
  return Object.assign(new Error(missingAccountMessage(key) + (detail ? ` ${detail}` : "")), {
    statusCode: 422,
    settingKey: key,
  });
}
