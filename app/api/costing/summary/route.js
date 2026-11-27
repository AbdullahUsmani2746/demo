import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import prisma from "@/lib/prisma";
import { getOpening, openingSql } from "@/lib/openingStock";
import { NextResponse } from "next/server";

// GET /api/costing/summary?month=5&year=2026
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = parseInt(searchParams.get("month"));
    const year = parseInt(searchParams.get("year"));

    if (!month || !year) {
      return NextResponse.json({ error: "month and year are required" }, { status: 400 });
    }

    const dateFrom = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const dateTo   = new Date(year, month,     0, 23, 59, 59, 999);

    // ── Sequential queries to avoid P2037 connection pool exhaustion ─────────
    // Promise.all with 7 queries opens 7 simultaneous connections — dangerous
    // after a heavy operation like opening stock calculation.

    // 1. Opening stock totals
    //    Qty summed across godowns per item; value = qty × item rate.
    const openingRows = await getOpening(month, year);
    const openingAgg = {
      _sum: {
        opening_value: openingRows.reduce((s, r) => s + r.opening_value, 0),
        opening_qty:   openingRows.reduce((s, r) => s + r.opening_qty, 0),
      },
      _count: { itcd: openingRows.length },
    };

    // 2. Issuance lines (tran_code=7) valued at blended weighted-average rate
    //    (opening_qty × opening_rate + period_purchase_damt) / (opening_qty + period_purchase_qty)
    //    This matches the issuance page's valuation so the KPI total equals the issuance report total.
    const issuanceLines = await prisma.$queryRaw`
      WITH purchase_rates AS (
        SELECT
          t2.itcd,
          COALESCE(SUM(t2.damt), 0) AS total_amt,
          COALESCE(SUM(t2.qty),  0) AS total_qty
        FROM "Transactions" t2
        JOIN "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
        WHERE tm2.tran_code = 4
          AND tm2.dated >= ${dateFrom}
          AND tm2.dated <= ${dateTo}
          AND t2.qty > 0
          AND t2.sub_tran_id = 1
        GROUP BY t2.itcd
      ),
      opening_rates AS (${openingSql(month, year)}),
      blended_rates AS (
        SELECT
          COALESCE(osr.itcd, pr.itcd) AS itcd,
          CASE
            WHEN (COALESCE(osr.opening_qty, 0) + COALESCE(pr.total_qty, 0)) > 0
            THEN (COALESCE(osr.opening_qty, 0) * COALESCE(osr.opening_rate, 0) + COALESCE(pr.total_amt, 0))
                 / (COALESCE(osr.opening_qty, 0) + COALESCE(pr.total_qty, 0))
            ELSE 0
          END AS avg_rate
        FROM opening_rates osr
        FULL OUTER JOIN purchase_rates pr ON pr.itcd = osr.itcd
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
              + SUM(COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0) * pce.qty_costed)
            ) / (COALESCE(mos.opening_qty, 0) + SUM(pce.qty_costed))
            ELSE 0
          END AS avg_rate
        FROM "ProductionCostEntry" pce
        LEFT JOIN opening_rates mos ON mos.itcd = pce.itcd
        WHERE pce.month = ${month} AND pce.year = ${year}
          AND pce.itcd IS NOT NULL
          AND COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0) > 0
        GROUP BY pce.itcd, mos.opening_qty, mos.opening_rate
      ),
      final_rates AS (
        -- If item was produced this period, use production-blended rate (opening already included).
        -- Otherwise use blended (opening + purchase weighted avg).
        SELECT
          COALESCE(br.itcd, prr.itcd) AS itcd,
          CASE
            WHEN prr.itcd IS NOT NULL AND COALESCE(prr.avg_rate, 0) > 0
              THEN prr.avg_rate
            ELSE COALESCE(br.avg_rate, 0)
          END AS avg_rate
        FROM blended_rates br
        FULL OUTER JOIN production_rates prr ON prr.itcd = br.itcd
      )
      SELECT
        COUNT(DISTINCT tm.tran_id)::int                                          AS voucher_count,
        COALESCE(SUM(t.qty * COALESCE(fr.avg_rate, 0)), 0)                       AS valued_cost,
        COALESCE(SUM(t.qty), 0)                                                  AS total_qty,
        COUNT(DISTINCT t.itcd)::int                                              AS item_count,
        COALESCE(SUM(CASE WHEN COALESCE(fr.avg_rate, 0) = 0
                          THEN t.qty ELSE 0 END), 0)                             AS unvalued_qty
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      LEFT JOIN final_rates fr ON fr.itcd = t.itcd
      WHERE tm.tran_code = 7
        AND tm.dated >= ${dateFrom}
        AND tm.dated <= ${dateTo}
        AND t.sub_tran_id = 1
        AND t.itcd IS NOT NULL
        AND t.qty  > 0
    `;

    // 3. Saved production cost totals
    const productionCostAgg = await prisma.productionCostEntry.aggregate({
      where: { month, year },
      _sum: { total_cost: true, qty_costed: true },
    });

    // 4. tran_code=8 production receipt count
    const t8Count = await prisma.transactionsMaster.count({
      where: { tran_code: 8, dated: { gte: dateFrom, lte: dateTo } },
    });

    // 5. Period lock record
    const periodRecord = await prisma.costingPeriod.findUnique({
      where: { month_year: { month, year } },
    });

    // 6. Costed plan count
    const costedPlans = await prisma.productionCostEntry.count({ where: { month, year } });

    // 7. Total plans with T8 receipts linked to a Posted plan (T8-driven source of truth)
    const t8PlanCountRows = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT
        NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'')::integer
      )::int AS cnt
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code  = 8
        AND tm.dated     >= ${dateFrom}
        AND tm.dated     <= ${dateTo}
        AND t.sub_tran_id = 1
        AND t.qty         > 0
        AND EXISTS (
          SELECT 1 FROM "productionPlanMaster" ppm
          WHERE ppm.id = NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'')::integer
            AND ppm.status = 'Posted'
        )
    `;
    const totalPlans = Number(t8PlanCountRows[0]?.cnt || 0);

    const issuance           = issuanceLines[0] || {};
    const totalProductionCost = Number(productionCostAgg._sum.total_cost) || 0;
    const totalIssuanceCost   = Number(issuance.valued_cost)              || 0;

    return NextResponse.json({
      // Opening stock
      opening_stock_value: Number(openingAgg._sum.opening_value) || 0,
      opening_stock_qty:   Number(openingAgg._sum.opening_qty)   || 0,
      opening_stock_items: openingAgg._count.itcd                || 0,

      // Issuances (tran_code=7, valued at opening rates)
      total_issuance_cost:   totalIssuanceCost,
      issuance_count:        Number(issuance.voucher_count) || 0,
      issuance_total_qty:    Number(issuance.total_qty)     || 0,
      issuance_item_count:   Number(issuance.item_count)    || 0,
      issuance_unvalued_qty: Number(issuance.unvalued_qty)  || 0,

      // Production costing
      total_production_cost:        totalProductionCost,
      production_costed_plans:      costedPlans,
      production_total_plans:       totalPlans,
      production_transaction_count: t8Count,

      // Period lock
      is_locked: periodRecord?.is_locked ?? false,
      locked_at: periodRecord?.locked_at ?? null,
      locked_by: periodRecord?.locked_by ?? null,

      // Derived
      net_cost:             totalProductionCost + totalIssuanceCost,
      costing_coverage_pct: totalPlans > 0 ? Math.round((costedPlans / totalPlans) * 100) : 0,
    });
  } catch (error) {
    console.error("Costing summary error:", error);
    return NextResponse.json({ error: "Failed to fetch costing summary" }, { status: 500 });
  }
}
