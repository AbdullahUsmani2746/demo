// lib/fixedAssets/settings.js — Settings → Fixed assets, server side (the
// definitions are lib/fixedAssets/settingsDefs.js). Cached 10 s per process,
// like lib/features/server.js; a save primes the cache at once.
import prisma from "@/lib/prisma";
import { FA_SETTINGS_KEY, resolveFaSettings } from "@/lib/fixedAssets/settingsDefs";

export * from "@/lib/fixedAssets/settingsDefs";

const CACHE_MS = 10_000;
let cache = { at: 0, value: null };

/** The resolved company settings (defaults filled in). */
export async function getFaSettings({ fresh = false, db = prisma } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  let raw = null;
  try {
    const row = await db.settings.findUnique({ where: { key: FA_SETTINGS_KEY }, select: { value: true } });
    raw = row?.value ?? null;
  } catch (error) {
    console.error("[fixedAssets] settings read failed, using defaults:", error?.message);
  }
  const value = resolveFaSettings(raw);
  cache = { at: Date.now(), value };
  return value;
}

export function primeFaSettings(raw) {
  cache = { at: Date.now(), value: resolveFaSettings(raw) };
}
