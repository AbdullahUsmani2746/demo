// lib/stock/checkStock.js
// ============================================================
// THE stock check every stock-out save calls (Settings → Stock checking).
//
//   const { mode, shortages, message } = await checkStockForSave({
//     type: "materialIssue",          // lib/stock/policyConfig.js STOCK_CHECK_TYPES
//     godown: master.godown,          // the godown stock leaves
//     lines,                          // save lines, qty in KG (main lines only)
//     excludeTranIds: [tran_id],      // on edit: the document's own old lines
//   });
//
//   off   → nothing is read, { shortages: [] }
//   warn  → { shortages, message } — the caller adds `message` to the
//           response's `warnings` and saves
//   block → throws a 422 error (statusCode 422) naming every short item
//
// Stock = lib/stock/godownStock.js (latest Monthly Opening of the godown +
// movements since, sub_tran_id 3 excluded). Godowns listed in the policy's
// allowNegativeGodowns are never checked. Closed godowns are refused
// separately (lib/godowns.js closedGodownError), as before.
// ============================================================
import prisma from "@/lib/prisma";
import { getGodownStock } from "@/lib/stock/godownStock";
import {
  getStockPolicy,
  modeOf,
  isExemptGodown,
  stockCheckType,
  stockNeeds,
  findShortages,
  shortageMessage,
} from "@/lib/stock/policy";

export const stockRefused = (message, shortages = []) =>
  Object.assign(new Error(message), { statusCode: 422, status: 422, shortages });

/** Code + name of items, for messages. */
export async function itemInfo(itcds, db = prisma) {
  const ids = [...new Set(itcds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await db.item.findMany({
    where: { itcd: { in: ids } },
    select: { itcd: true, code: true, item: true },
  });
  return new Map(rows.map((r) => [r.itcd, { code: r.code ?? null, name: r.item || `Item #${r.itcd}` }]));
}

/**
 * @param {{
 *   type: string, godown: number|object, lines?: object[], needs?: Map<number, number>,
 *   excludeTranIds?: number[], db?: object, policy?: object, where?: string,
 *   throwOnBlock?: boolean,
 * }} args
 *   `needs` may be passed instead of `lines` (itcd → KG).
 * @returns {Promise<{ mode: string, shortages: object[], message: string|null }>}
 */
export async function checkStockForSave({
  type,
  godown,
  lines = [],
  needs: needsIn = null,
  excludeTranIds = [],
  db = prisma,
  policy = null,
  where = "",
  throwOnBlock = true,
}) {
  const resolved = policy || (await getStockPolicy());
  const mode = modeOf(resolved, type);
  const none = { mode, shortages: [], message: null };
  const g = Number(godown?.value ?? godown);
  if (mode === "off" || !Number.isInteger(g) || g <= 0) return none;
  if (isExemptGodown(resolved, g)) return none;

  const needs = needsIn || stockNeeds(lines);
  if (!needs.size) return none;

  const stock = await getGodownStock([...needs.keys()], g, {
    db,
    excludeTranIds: (excludeTranIds || []).map(Number).filter(Number.isFinite),
  });
  const shortIds = [...needs].filter(([itcd, need]) => need > (stock.get(itcd) || 0) + 1e-6).map(([i]) => i);
  if (!shortIds.length) return none;

  const shortages = findShortages(needs, stock, await itemInfo(shortIds, db));
  const label = stockCheckType(type)?.label || "document";
  const message = shortageMessage(label, shortages, where || `godown ${g}`);
  if (mode === "block" && throwOnBlock) throw stockRefused(message, shortages);
  return { mode, shortages, message };
}
