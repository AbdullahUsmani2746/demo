// lib/costing/ccRates.js
// ============================================================
// Total conversion cost (CC) per unit for one month — the CC added at an
// item's own stage PLUS the CC carried in by semi-finished / finished inputs
// (ported from Accounting lib/costing/ccRates.js; opening read through
// lib/openingStock.js, CC categories from lib/costing/ccPolicy.js).
//
// Used only while Settings → Features "costing.method" = "blendedCC".
// A semi-finished input is valued at its full cost (RM + its own CC), so when
// a finished good consumes it, that CC sits inside the finished good's
// material cost. This works out how much of each item's cost is CC across
// every stage, so the RM / CC split is right. Total cost and the GL are
// unchanged — it only moves value between the RM and CC columns.
//
//   CC per unit(item) = ( opening qty × opening CC rate
//                       + Σ own CC cost of this month's costing entries
//                       + Σ input qty × CC per unit(input) )        ← recursive
//                     ÷ ( opening qty + Σ costed qty )
// ============================================================
import prisma from "@/lib/prisma";
import { getOpening } from "@/lib/openingStock";
import { ccCategoryIdsFor } from "@/lib/costing/ccPolicy";

const n = (v) => Number(v || 0);

/**
 * Lookup for one month: get(itcd) → { rate, own_cost, input_cost, qty, opening_qty, opening_cc } | null,
 * has(itcd), entryInputCost(entry), carries(itcd), carriesCategory(icId).
 */
export async function getCcComponents({ month, year }) {
  const ccIds = (await ccCategoryIdsFor(month, year)).map(Number);
  const carriesCc = (icId) => ccIds.includes(Number(icId));
  const allPces = await prisma.productionCostEntry.findMany({
    where: { month, year },
    select: {
      itcd: true, qty_costed: true, cc_cost: true, actual_issued_cost: true,
      details: { select: { material_id: true, qty: true, actual_qty: true } },
    },
  });
  const pces = allPces.filter((e) => e.itcd != null);

  const ids = new Set();
  for (const e of allPces) {
    if (e.itcd != null) ids.add(Number(e.itcd));
    for (const d of e.details) ids.add(Number(d.material_id));
  }
  const idList = [...ids];
  const [items, opens] = idList.length
    ? await Promise.all([
      prisma.item.findMany({ where: { itcd: { in: idList } }, select: { itcd: true, ic_id: true } }),
      getOpening(month, year, { itcds: idList }), // all godowns summed
    ])
    : [[], []];

  const icOf = new Map(items.map((i) => [Number(i.itcd), Number(i.ic_id || 0)]));
  const openOf = new Map(opens.map((o) => [Number(o.itcd), { qty: Math.max(0, n(o.opening_qty)), cc: n(o.cc_rate) }]));
  const pcesOf = new Map();
  for (const e of pces) {
    const id = Number(e.itcd);
    if (!pcesOf.has(id)) pcesOf.set(id, []);
    pcesOf.get(id).push(e);
  }

  const memo = new Map();
  const visiting = new Set();
  // CC carried into one costing entry by its CC-carrying inputs (actual issues;
  // the plan's list when nothing was issued).
  const inputOf = (e, selfId) => {
    const useActual = e.actual_issued_cost != null;
    let input = 0;
    for (const d of e.details || []) {
      const mid = Number(d.material_id);
      if (mid === selfId || !carriesCc(icOf.get(mid))) continue;
      const q = useActual ? n(d.actual_qty) : n(d.qty);
      if (q > 0) input += q * resolve(mid).rate;
    }
    return input;
  };
  const resolve = (id) => {
    if (memo.has(id)) return memo.get(id);
    const o = openOf.get(id) || { qty: 0, cc: 0 };
    if (!carriesCc(icOf.get(id))) return { rate: 0, own_cost: 0, input_cost: 0, qty: 0, opening_qty: o.qty, opening_cc: 0 };
    if (visiting.has(id)) return { rate: o.cc, own_cost: 0, input_cost: 0, qty: 0, opening_qty: o.qty, opening_cc: o.cc }; // circular BOM
    visiting.add(id);

    let qty = 0, own = 0, input = 0;
    for (const e of pcesOf.get(id) || []) {
      qty += n(e.qty_costed);
      own += n(e.cc_cost);
      input += inputOf(e, id);
    }
    const denom = o.qty + qty;
    const out = {
      rate: denom > 0 ? (o.qty * o.cc + own + input) / denom : o.cc,
      own_cost: own, input_cost: input, qty, opening_qty: o.qty, opening_cc: o.cc,
    };
    visiting.delete(id);
    memo.set(id, out);
    return out;
  };

  for (const id of pcesOf.keys()) resolve(id);
  return {
    get: (id) => (pcesOf.has(Number(id)) || memo.has(Number(id)) ? resolve(Number(id)) : null),
    has: (id) => pcesOf.has(Number(id)),
    entryInputCost: (e) => inputOf(e, e.itcd != null ? Number(e.itcd) : null),
    carries: (id) => carriesCc(icOf.get(Number(id))),
    carriesCategory: (icId) => carriesCc(icId),
    categoryIds: ccIds,
  };
}
