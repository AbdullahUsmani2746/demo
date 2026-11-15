// lib/stock/policyClient.js
// ============================================================
// The stock check policy for code that is not a React component — the field
// validators in components/Category/constants.js. Components use
// hooks/useStockPolicy.js (TanStack Query) instead; both read
// GET /api/settings/stock-check.
//
//   const mode = await screenStockMode("transfer");   // "off" | "warn" | "block"
//
// The save is the source of truth (lib/stock/checkStock.js); this only lets
// the form limit / warn the same way. If the policy cannot be read the form
// keeps its old behaviour (the defaults).
// ============================================================
import axios from "axios";
import { resolveStockPolicy, modeOf } from "@/lib/stock/policyConfig";

const CACHE_MS = 30_000;
let cache = { at: 0, value: null, loading: null };

export async function fetchStockPolicy({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (!cache.loading) {
    cache.loading = axios
      .get("/api/settings/stock-check")
      .then((res) => {
        const value = resolveStockPolicy(res.data?.policy ?? null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      })
      .catch(() => {
        const value = resolveStockPolicy(null);
        cache = { at: Date.now() - CACHE_MS + 5_000, value, loading: null }; // retry soon
        return value;
      });
  }
  return cache.loading;
}

/** What the FORM does for this type. */
export async function screenStockMode(type) {
  if (!type) return "block";
  return modeOf(await fetchStockPolicy(), type, { screen: true });
}

/** Forget the cached policy (after Settings → Stock checking is saved). */
export function clearStockPolicyCache() {
  cache = { at: 0, value: null, loading: null };
}
