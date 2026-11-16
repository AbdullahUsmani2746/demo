// lib/pos/settings.js
// ============================================================
// POINT OF SALE SETTINGS — server side. Reads Settings → Point of Sale
// (lib/pos/settingsConfig.js), cached briefly like Settings → Features
// (lib/features/server.js).
//
// ============================================================
import prisma from "@/lib/prisma";
import { POS_SETTINGS_KEY, resolvePosSettings } from "@/lib/pos/settingsConfig";

export * from "@/lib/pos/settingsConfig";

const CACHE_MS = 10_000;
let cache = { at: 0, value: null, loading: null };

/** The full POS settings, cached 10 s. */
export async function getPosSettings({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (!cache.loading) {
    cache.loading = prisma.settings
      .findUnique({ where: { key: POS_SETTINGS_KEY }, select: { value: true } })
      .then((row) => {
        const value = resolvePosSettings(row?.value ?? null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      })
      .catch((error) => {
        // Unreadable setting → the defaults (the values the code always had).
        console.error("[posSettings] read failed, using defaults:", error?.message);
        const value = resolvePosSettings(null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      });
  }
  return cache.loading;
}

/** After a save on this process: use the new value at once. */
export function primePosSettings(raw) {
  cache = { at: Date.now(), value: resolvePosSettings(raw), loading: null };
}
