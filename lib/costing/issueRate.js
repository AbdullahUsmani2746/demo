// lib/costing/issueRate.js
// ============================================================
// Costing method — Settings → Features "costing.method":
//   "average"   (default, SMS)  production costing values raw materials at the
//               opening + purchase weighted average (lib/stock/averageRate.js
//               logic) and semi-finished inputs at their own production cost.
//   "blendedCC" (Accounting)    every material is valued at the ONE rate the
//               Stock Activity With Rate report issues it at:
//
//   ( opening value + purchases − purchase returns + production value + prior-month returns )
//   ÷ ( opening qty + purchase qty − purchase return qty + production qty + prior-month return qty )
//
//   production value = T8 received qty × weighted PCE cost_per_unit (CC included)
//
// so the COGM journal credits each material exactly what the stock report
// issues. Prior-month returns count only while "saleReturn.costAtOriginalMonth"
// is on — the same rule the stock report follows. Opening stock is read
// through lib/openingStock.js (all godowns summed). Change the formula only here.
// ============================================================
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { getOpening } from "@/lib/openingStock";
import { getPriorMonthReturns } from "@/lib/costing/saleReturnCost";

export const COSTING_METHOD_FEATURE = "costing.method";

const n = (v) => Number(v || 0);

/** true when Settings → Features "costing.method" = blended issue rate with CC through stages. */
export async function isBlendedCosting() {
  return (await feature(COSTING_METHOD_FEATURE)) === "blendedCC";
}

/** Blended cost rate from one item's month movements. */
export function blendedCostRate({
  opening_qty = 0, opening_value = 0,
  purchase_qty = 0, purchase_amount = 0,
  purchase_ret_qty = 0, purchase_ret_amount = 0,
  production_qty = 0, production_value = 0,
  prior_ret_qty = 0, prior_ret_value = 0,
}) {
  const qty = n(opening_qty) + n(purchase_qty) - n(purchase_ret_qty) + n(production_qty) + n(prior_ret_qty);
  const value = n(opening_value) + n(purchase_amount) - n(purchase_ret_amount) + n(production_value) + n(prior_ret_value);
  return qty > 0 ? value / qty : 0;
}

/** Issue rate: the blended rate, or the opening rate when nothing came in. */
export const issueRateOf = (blended, opening_rate) => n(blended) || n(opening_rate);

/**
 * Issue rate per item for a whole month (all godowns), same inputs as the
 * Stock Activity With Rate report for that month.
 *
 * @param {{ month:number, year:number, itcds:number[], computeMonth?:Function }} args
 *        computeMonth: Stock Activity With Rate runner, needed only to value
 *        returns of a sale from a month that is not locked yet.
 * @returns {Promise<Map<number, { rate:number, source:string }>>}
 */
export async function getIssueRates({ month, year, itcds, computeMonth }) {
  const ids = [...new Set((itcds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;

  const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const to = new Date(year, month, 0, 23, 59, 59, 999);
  const withReturns = await feature("saleReturn.costAtOriginalMonth");

  const [opening, moves, pce, priorReturns] = await Promise.all([
    getOpening(month, year, { itcds: ids }),
    prisma.$queryRaw`
      SELECT
        t.itcd,
        COALESCE(SUM(CASE WHEN tm.tran_code = 4 AND t.sub_tran_id = 1 THEN t.qty              ELSE 0 END), 0) AS purchase_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 4 AND t.sub_tran_id = 1 THEN COALESCE(t.damt,0) ELSE 0 END), 0) AS purchase_amount,
        COALESCE(SUM(CASE WHEN tm.tran_code = 9 AND t.sub_tran_id = 1 THEN t.qty              ELSE 0 END), 0) AS purchase_ret_qty,
        COALESCE(SUM(CASE WHEN tm.tran_code = 9 AND t.sub_tran_id = 1 THEN COALESCE(t.camt,0) ELSE 0 END), 0) AS purchase_ret_amount,
        COALESCE(SUM(CASE WHEN tm.tran_code = 8 THEN t.qty ELSE 0 END), 0) AS production_qty
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      WHERE t.itcd = ANY(${ids}::int[])
        AND tm.dated >= ${from}
        AND tm.dated <= ${to}
        AND t.qty IS NOT NULL
        AND tm.tran_code IS NOT NULL
        AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
      GROUP BY t.itcd
    `,
    prisma.$queryRaw`
      SELECT pce.itcd,
             SUM(COALESCE(pce.cost_per_unit, 0) * pce.qty_costed) / SUM(pce.qty_costed) AS rate
      FROM "ProductionCostEntry" pce
      WHERE pce.month = ${month} AND pce.year = ${year}
        AND pce.itcd = ANY(${ids}::int[])
        AND pce.qty_costed > 0
        AND COALESCE(pce.cost_per_unit, 0) > 0
      GROUP BY pce.itcd
    `,
    withReturns
      ? getPriorMonthReturns({ dateFrom: from, dateTo: to, monthStart: from }, computeMonth ?? (async () => []))
      : new Map(),
  ]);

  const openOf = new Map(opening.map((o) => [Number(o.itcd), o]));
  const moveOf = new Map(moves.map((m) => [Number(m.itcd), m]));
  const pceOf = new Map(pce.map((p) => [Number(p.itcd), n(p.rate)]));

  for (const itcd of ids) {
    const o = openOf.get(itcd);
    const m = moveOf.get(itcd) || {};
    const pr = priorReturns.get(itcd);
    const opening_qty = n(o?.opening_qty);
    const opening_rate = n(o?.opening_rate);
    const production_qty = n(m.production_qty);
    const production_rate = pceOf.get(itcd) || 0;

    const blended = blendedCostRate({
      opening_qty,
      opening_value: opening_qty * opening_rate,
      purchase_qty: m.purchase_qty, purchase_amount: m.purchase_amount,
      purchase_ret_qty: m.purchase_ret_qty, purchase_ret_amount: m.purchase_ret_amount,
      production_qty,
      production_value: production_qty * production_rate,
      prior_ret_qty: pr?.qty, prior_ret_value: pr?.cost_value,
    });
    const rate = issueRateOf(blended, opening_rate);

    let source = "not_found";
    if (rate > 0) {
      if (production_qty > 0) source = opening_qty > 0 || n(m.purchase_qty) > 0 ? "weighted_avg" : "production_cost_entry";
      else if (n(m.purchase_qty) > 0) source = "weighted_avg";
      else source = "opening_stock";
    }
    out.set(itcd, { rate, source });
  }
  return out;
}
