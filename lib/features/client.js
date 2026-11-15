// lib/features/client.js — Settings → Features for browser code that is not a
// React component (voucher config callbacks in components/Category/constants.js:
// apiEndpoint, validate …). Components use hooks/useFeatures.js, which also
// primes this cache, so a form's config reads the same values the form shows.
//
//   featureNow("saleOrder.priceListOnly")              sync — cached value, else the default
//   await featureAsync("dispatch.overDispatchTolerance") fetched (30 s cache) when not primed

import axios from "axios";
import { resolveFeatures, featureDef } from "@/lib/features/catalog";

const TTL_MS = 30_000;
let cache = { at: 0, values: null, loading: null };

/** Called by useFeatures with what /api/settings/features returned. */
export function primeClientFeatures(values) {
  if (values && typeof values === "object") cache = { at: Date.now(), values, loading: null };
}

const check = (key) => {
  if (!featureDef(key)) throw new Error(`Unknown feature "${key}" — add it to lib/features/catalog.js`);
};

/** The cached value (or the default — today's SMS behaviour — before anything is loaded). */
export function featureNow(key) {
  check(key);
  return (cache.values ?? resolveFeatures(null))[key];
}

/** The value, fetched when the cache is empty or stale. */
export async function featureAsync(key) {
  check(key);
  if (cache.values && Date.now() - cache.at < TTL_MS) return cache.values[key];
  if (!cache.loading) {
    cache.loading = axios
      .get("/api/settings/features")
      .then((r) => {
        primeClientFeatures(r.data?.values ?? resolveFeatures(null));
        return cache.values;
      })
      .catch(() => {
        cache.loading = null;
        return cache.values ?? resolveFeatures(null);
      });
  }
  return (await cache.loading)[key];
}
