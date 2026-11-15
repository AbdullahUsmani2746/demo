// lib/production/setup.js
// ============================================================
// PRODUCTION SETUP — server side. Reads Settings → Production setup
// (lib/production/setupConfig.js), cached briefly like Settings → Features
// (lib/features/server.js).
//
//   const setup = await getProductionSetup();
//   godownForCategory(setup, item.ic_id)
//   isPackingCategory(setup, item.ic_id)
// ============================================================
import prisma from "@/lib/prisma";
import { PRODUCTION_SETUP_KEY, resolveProductionSetup } from "@/lib/production/setupConfig";

export * from "@/lib/production/setupConfig";

const CACHE_MS = 10_000;
let cache = { at: 0, value: null, loading: null };

/** The full production setup, cached 10 s. */
export async function getProductionSetup({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (!cache.loading) {
    cache.loading = prisma.settings
      .findUnique({ where: { key: PRODUCTION_SETUP_KEY }, select: { value: true } })
      .then((row) => {
        const value = resolveProductionSetup(row?.value ?? null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      })
      .catch((error) => {
        // Unreadable setting → the defaults (the values the code always had).
        console.error("[productionSetup] read failed, using defaults:", error?.message);
        const value = resolveProductionSetup(null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      });
  }
  return cache.loading;
}

/** After a save on this process: use the new value at once. */
export function primeProductionSetup(raw) {
  cache = { at: Date.now(), value: resolveProductionSetup(raw), loading: null };
}
