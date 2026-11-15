// lib/stock/policy.js
// ============================================================
// STOCK CHECK POLICY — server side. One place decides, per document type,
// whether a stock-out save is not checked, warned or blocked
// (Settings → Stock checking). Types, defaults and the resolution rules live
// in lib/stock/policyConfig.js (shared with the screens); this file reads the
// Settings row, cached briefly.
//
//   const mode = await modeFor("materialIssue");   // "off" | "warn" | "block"
//
// Every stock-out save goes through lib/stock/checkStock.js, which calls this.
// ============================================================
import prisma from "@/lib/prisma";
import {
  STOCK_POLICY_KEY,
  resolveStockPolicy,
  modeOf,
} from "@/lib/stock/policyConfig";

export * from "@/lib/stock/policyConfig";

const CACHE_MS = 10_000;
let cache = { at: 0, value: null, loading: null };

/** The resolved policy ({ modes, screen, explicit, allowNegativeGodowns, policy }), cached 10 s. */
export async function getStockPolicy({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (!cache.loading) {
    cache.loading = prisma.settings
      .findUnique({ where: { key: STOCK_POLICY_KEY }, select: { value: true } })
      .then((row) => {
        const value = resolveStockPolicy(row?.value ?? null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      })
      .catch((error) => {
        // Unreadable setting → today's behaviour (the defaults), never "off".
        console.error("[stock policy] read failed, using defaults:", error?.message);
        const value = resolveStockPolicy(null);
        cache = { at: Date.now(), value, loading: null };
        return value;
      });
  }
  return cache.loading;
}

/** Save mode of one type. */
export async function modeFor(type) {
  return modeOf(await getStockPolicy(), type);
}

/** After a save on this process: use the new value at once. */
export function primeStockPolicy(raw) {
  cache = { at: Date.now(), value: resolveStockPolicy(raw), loading: null };
}

