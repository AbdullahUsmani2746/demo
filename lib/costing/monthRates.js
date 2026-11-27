// lib/costing/monthRates.js — the month issue rate (server only).
// Used by Costing → Production (app/api/costing/production/route.js) for
// process orders, and by lib/costing/noPlanCosting.js for productions without one.
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { openingSql } from "@/lib/openingStock";
import { grnServicesByItemSql } from "@/lib/service/landedCost";
import { feature } from "@/lib/features/server";

/**
 * The company's costing rules that change a material's month rate (Settings →
 * Features): GRN services as landed cost ("costing.servicesInCost") and a
 * receipt without a value entering at the average
 * ("costing.zeroValueReceiptsAtAverage"). Both off = today's rate.
 */
export async function costingRules() {
  const [servicesInCost, zeroValueAtAverage] = await Promise.all([
    feature("costing.servicesInCost"),
    feature("costing.zeroValueReceiptsAtAverage"),
  ]);
  return { servicesInCost, zeroValueAtAverage };
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTH ISSUE RATES — the ONE rate every issued material is costed at
// (process orders, produce-on-dispatch, pooled no-plan productions): a CTE list
// ending in final_rates(itcd, avg_rate).
//   rules.zeroValueAtAverage: a receipt WITHOUT a value (returned empty
//   drums, a GRN not invoiced yet) enters at the current average — its qty is
//   left out of the rate (the same rule in Stock Activity With Rate,
//   lib/stock/averageRate.js and the theoretical rate).
//   raw / bought items: (opening qty × opening rate + the month's purchases
//                       + their GRN services while rules.servicesInCost —
//                       landed cost, lib/service/landedCost.js)
//                       ÷ (opening qty + purchased qty)
//   rules = await costingRules(); omitted = both off.
//   items produced this month and already costed: opening blended with their
//   ProductionCostEntry rate (sequencing costs inputs first).
// ccInclusive (output is a semi made from a finished good) → a produced input
// carries its CC (cost_per_unit); default = actual_cost_per_unit (CC stripped).
// ─────────────────────────────────────────────────────────────────────────────
export function monthRateCtes(month, year, ccInclusive = false, rules = {}) {
  const dateFrom = new Date(year, month - 1, 1);
  const dateTo   = new Date(year, month, 0, 23, 59, 59);
  const pceRate = ccInclusive
    ? Prisma.sql`COALESCE(pce.cost_per_unit, pce.actual_cost_per_unit, 0)`
    : Prisma.sql`COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0)`;
  return Prisma.sql`
    WITH opening AS (${openingSql(month, year)}),
    purch AS (
  SELECT t2.itcd,
    COALESCE(SUM(CASE WHEN tm2.tran_code = 4 THEN t2.damt
                      WHEN tm2.tran_code = 9 THEN -t2.camt
                      ELSE 0 END), 0) AS total_amt,
    COALESCE(SUM(CASE WHEN tm2.tran_code = 4 ${rules.zeroValueAtAverage ? Prisma.sql`AND COALESCE(t2.damt, 0) <> 0` : Prisma.empty} THEN t2.qty
                      WHEN tm2.tran_code = 9 ${rules.zeroValueAtAverage ? Prisma.sql`AND COALESCE(t2.camt, 0) <> 0` : Prisma.empty} THEN -t2.qty
                      ELSE 0 END), 0) AS total_qty
  FROM  "Transactions" t2
  JOIN  "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
  WHERE tm2.tran_code IN (4, 9)
    AND tm2.dated >= ${dateFrom}
    AND tm2.dated <= ${dateTo}
    AND t2.qty > 0
  GROUP BY t2.itcd
),
    svc AS (${rules.servicesInCost ? grnServicesByItemSql(dateFrom, dateTo) : Prisma.sql`SELECT NULL::int AS itcd, 0::float AS amt WHERE FALSE`}),
    blended AS (
      SELECT
        COALESCE(o.itcd, p.itcd) AS itcd,
        CASE
          WHEN (COALESCE(o.opening_qty, 0) + COALESCE(p.total_qty, 0)) > 0
          THEN (COALESCE(o.opening_qty, 0) * COALESCE(o.opening_rate, 0) + COALESCE(p.total_amt, 0) + COALESCE(sv.amt, 0))
               / (COALESCE(o.opening_qty, 0) + COALESCE(p.total_qty, 0))
          ELSE 0
        END AS avg_rate
      FROM opening o
      FULL OUTER JOIN purch p ON p.itcd = o.itcd
      LEFT JOIN svc sv ON sv.itcd = COALESCE(o.itcd, p.itcd)
    ),
    production_rates AS (
      -- Blend: (opening_qty × opening_rate + prod_qty × cost_per_unit) / (opening_qty + prod_qty)
      -- Use pce.itcd directly — no PPM join needed since itcd is denormalized onto PCE.
      SELECT
        pce.itcd,
        CASE
          WHEN (COALESCE(mos.opening_qty, 0) + SUM(pce.qty_costed)) > 0
          THEN (
            COALESCE(mos.opening_qty, 0) * COALESCE(mos.opening_rate, 0)
            + SUM(${pceRate} * pce.qty_costed)
          ) / (COALESCE(mos.opening_qty, 0) + SUM(pce.qty_costed))
          ELSE 0
        END AS avg_rate
      FROM "ProductionCostEntry" pce
      LEFT JOIN opening mos ON mos.itcd = pce.itcd
      WHERE pce.month = ${month} AND pce.year = ${year}
        AND pce.itcd IS NOT NULL
        AND ${pceRate} > 0
      GROUP BY pce.itcd, mos.opening_qty, mos.opening_rate
    ),
    final_rates AS (
      -- If item was produced this period, use production-blended rate (opening already included).
      -- Otherwise use blended (opening + purchase weighted avg).
      SELECT
        COALESCE(b.itcd, prr.itcd) AS itcd,
        CASE
          WHEN prr.itcd IS NOT NULL AND COALESCE(prr.avg_rate, 0) > 0
            THEN prr.avg_rate
          ELSE COALESCE(b.avg_rate, 0)
        END AS avg_rate
      FROM blended b
      FULL OUTER JOIN production_rates prr ON prr.itcd = b.itcd
    )`;
}

/** Map<itcd, rate> — monthRateCtes as a lookup. */
export async function monthIssueRates(month, year, ccInclusive = false) {
  const rules = await costingRules();
  const rows = await prisma.$queryRaw`
    ${monthRateCtes(month, year, ccInclusive, rules)}
    SELECT itcd, avg_rate FROM final_rates WHERE itcd IS NOT NULL`;
  return new Map(rows.map((r) => [Number(r.itcd), Number(r.avg_rate) || 0]));
}
