// lib/features/server.js
// ============================================================
// FEATURES — server side. Reads Settings → Features (lib/features/catalog.js),
// cached briefly, the same way the stock check policy is (lib/stock/policy.js).
//
//   if (await feature("dispatch.produceOnDispatch")) { … }
//   const source = await feature("production.processOrderSource"); // "bom" | "recipe"
// ============================================================
import prisma from "@/lib/prisma";
import { FEATURE_FLAGS_KEY, resolveFeatures, featureDef } from "@/lib/features/catalog";

export * from "@/lib/features/catalog";

const CACHE_MS = 10_000;
let cache = { at: 0, value: null, loading: null };

/** Every feature's value ({ key: value }), cached 10 s. */
export async function getFeatures({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (!cache.loading) {
    cache.loading = prisma.settings
      .findUnique({ where: { key: FEATURE_FLAGS_KEY }, select: { value: true } })
      .then((row) => {
        const value = resolveFeatures(row?.value ?? null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      })
      .catch((error) => {
        // Unreadable setting → the defaults (today's SMS behaviour).
        console.error("[features] read failed, using defaults:", error?.message);
        const value = resolveFeatures(null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      });
  }
  return cache.loading;
}

/** One feature's value. Throws on a key that is not in the catalogue (a typo must not silently mean "default"). */
export async function feature(key) {
  if (!featureDef(key)) throw new Error(`Unknown feature "${key}" — add it to lib/features/catalog.js`);
  return (await getFeatures())[key];
}

/** After a save on this process: use the new value at once. */
export function primeFeatures(raw) {
  cache = { at: Date.now(), value: resolveFeatures(raw), loading: null };
}
