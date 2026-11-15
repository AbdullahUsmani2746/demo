import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/**
 * GET /api/costing/rates?month=5&year=2026&category=&search=
 *
 * Returns the effective blended cost rate applied to each item for the period.
 * Shows every input that makes up the final rate:
 *   Opening stock rate  (from MonthlyOpeningRate / MonthlyOpeningStock)
 *   Period purchases    (tran_code=4, damt, weighted avg)
 *   Production cost     (from ProductionCostEntry — actual preferred, BOM fallback)
 *   → Final blended rate (the rate used in issuance valuation)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month    = parseInt(searchParams.get("month")    || new Date().getMonth() + 1);
    const year     = parseInt(searchParams.get("year")     || new Date().getFullYear());
    const category = searchParams.get("category") ? parseInt(searchParams.get("category")) : null;

    const dateFrom = new Date(year, month - 1, 1);
    dateFrom.setHours(0, 0, 0, 0);
    const dateTo = new Date(year, month, 0);
    dateTo.setHours(23, 59, 59, 999);

    const rows = await prisma.$queryRaw`
      WITH
      -- ── A. Opening stock per item — most recent record up to and including
      --    the selected period (DISTINCT ON ensures one row per item).
      --    This means items whose opening stock wasn't recalculated for the
      --    current month still appear with their last-known carry-forward rate.
      --    Rate: latest MonthlyOpeningRate row ≤ period. Qty: the selected
      --    period's MonthlyOpeningStock summed over godowns (qty does not
      --    carry forward — only the rate does).
      opening_rate_data AS (
        SELECT DISTINCT ON (itcd)
          itcd,
          COALESCE(opening_rate, 0) AS opening_rate
        FROM "MonthlyOpeningRate"
        WHERE year < ${year}
           OR (year = ${year} AND month <= ${month})
        ORDER BY itcd, year DESC, month DESC
      ),
      opening_qty_data AS (
        SELECT itcd, SUM(opening_qty) AS opening_qty
        FROM "MonthlyOpeningStock"
        WHERE month = ${month} AND year = ${year}
        GROUP BY itcd
      ),
      opening_data AS (
        SELECT
          COALESCE(r.itcd, q.itcd)   AS itcd,
          COALESCE(q.opening_qty, 0) AS opening_qty,
          COALESCE(r.opening_rate, 0) AS opening_rate
        FROM opening_rate_data r
        FULL OUTER JOIN opening_qty_data q ON q.itcd = r.itcd
      ),

      -- ── B. Period purchases per item ─────────────────────────────────────────
      purchase_data AS (
        SELECT
          t.itcd,
          COALESCE(SUM(t.qty),   0) AS purchase_qty,
          COALESCE(SUM(t.damt),  0) AS purchase_amt
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE tm.tran_code = 4
          AND tm.dated >= ${dateFrom}
          AND tm.dated <= ${dateTo}
          AND t.qty > 0
          AND t.sub_tran_id = 1
        GROUP BY t.itcd
      ),

      -- ── C. PCE-based production cost (actual preferred over BOM) ─────────────
      pce_data AS (
        -- Use pce.itcd directly — no PPM join needed since itcd is denormalized onto PCE.
        SELECT
          pce.itcd,
          SUM(pce.qty_costed) AS production_qty,
          CASE WHEN SUM(pce.qty_costed) > 0
            THEN SUM(COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0) * pce.qty_costed)
                 / SUM(pce.qty_costed)
            ELSE 0
          END AS production_cost_per_unit,
          MAX(CASE WHEN pce.actual_cost_per_unit IS NOT NULL THEN pce.actual_cost_per_unit END) AS actual_cost_per_unit,
          MAX(pce.cost_per_unit) AS theoretical_cost_per_unit,
          BOOL_OR(pce.actual_cost_per_unit IS NOT NULL) AS has_actual
        FROM "ProductionCostEntry" pce
        WHERE pce.month = ${month} AND pce.year = ${year}
          AND pce.itcd IS NOT NULL
          AND COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0) > 0
        GROUP BY pce.itcd
      ),

      -- ── D. Production receipts (tran_code=8) — catches items with no plan ─────
      --    Some items are received into stock via production transactions but
      --    have no productionPlanMaster / ProductionCostEntry record.
      --    We surface them so the user can see a rate exists (or doesn't).
      tran8_data AS (
        SELECT
          t.itcd,
          SUM(t.qty)  AS production_qty,
          CASE WHEN SUM(t.qty) > 0 AND SUM(t.damt) > 0
            THEN SUM(t.damt) / SUM(t.qty)
            ELSE 0
          END AS tran8_unit_cost
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE tm.tran_code = 8
          AND tm.dated >= ${dateFrom}
          AND tm.dated <= ${dateTo}
          AND t.sub_tran_id = 1
          AND t.qty > 0
        GROUP BY t.itcd
      ),

      -- ── E. Merged production: PCE preferred; tran8 as fallback for unlisted items
      production_data AS (
        SELECT
          COALESCE(pd.itcd,          t8.itcd)             AS itcd,
          COALESCE(pd.production_qty, t8.production_qty)  AS production_qty,
          -- PCE rate used when available; tran8 damt/qty rate used for plan-less items
          CASE WHEN pd.itcd IS NOT NULL
            THEN COALESCE(pd.production_cost_per_unit, 0)
            ELSE COALESCE(t8.tran8_unit_cost, 0)
          END                                             AS production_cost_per_unit,
          pd.actual_cost_per_unit,
          pd.theoretical_cost_per_unit,
          COALESCE(pd.has_actual, false)                  AS has_actual,
          -- Raw tran8 rate always available for display
          COALESCE(t8.tran8_unit_cost, 0)                 AS tran8_cost_per_unit,
          -- 'pce' = has ProductionCostEntry; 'tran8_only' = transactions only, no plan
          CASE WHEN pd.itcd IS NOT NULL THEN 'pce' ELSE 'tran8_only' END AS production_source
        FROM pce_data pd
        FULL OUTER JOIN tran8_data t8 ON t8.itcd = pd.itcd
      ),

      -- ── F. Period issuances per item (tran_code=7) — for display only ────────
      issuance_data AS (
        SELECT
          t.itcd,
          SUM(t.qty) AS issued_qty
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE tm.tran_code = 7
          AND tm.dated >= ${dateFrom}
          AND tm.dated <= ${dateTo}
          AND t.sub_tran_id = 1
          AND t.qty > 0
        GROUP BY t.itcd
      ),

      -- ── E. Union of all active itcds this period ─────────────────────────────
      active_items AS (
        SELECT itcd FROM opening_data
        UNION
        SELECT itcd FROM purchase_data
        UNION
        SELECT itcd FROM production_data
        UNION
        SELECT itcd FROM issuance_data
      ),

      -- ── F. Compute blended rate (mirrors issuance route logic exactly) ────────
      costing AS (
        SELECT
          ai.itcd,
          COALESCE(od.opening_qty,  0) AS opening_qty,
          COALESCE(od.opening_rate, 0) AS opening_rate,
          COALESCE(od.opening_qty, 0) * COALESCE(od.opening_rate, 0) AS opening_value,

          COALESCE(pd.purchase_qty, 0) AS purchase_qty,
          COALESCE(pd.purchase_amt, 0) AS purchase_amt,
          CASE WHEN COALESCE(pd.purchase_qty, 0) > 0
            THEN COALESCE(pd.purchase_amt, 0) / pd.purchase_qty
            ELSE 0
          END AS purchase_rate,

          COALESCE(prod.production_qty,          0) AS production_qty,
          COALESCE(prod.production_cost_per_unit, 0) AS production_cost_per_unit,
          COALESCE(prod.actual_cost_per_unit,     0) AS actual_cost_per_unit,
          COALESCE(prod.theoretical_cost_per_unit,0) AS theoretical_cost_per_unit,
          COALESCE(prod.has_actual,           false) AS has_actual,
          COALESCE(prod.tran8_cost_per_unit,    0)     AS tran8_cost_per_unit,
          COALESCE(prod.production_source, 'none')     AS production_source,

          COALESCE(isd.issued_qty, 0) AS issued_qty,

          -- Purchase-blended rate = (opening × rate + purchases) / (opening_qty + purchase_qty)
          CASE WHEN (COALESCE(od.opening_qty, 0) + COALESCE(pd.purchase_qty, 0)) > 0
            THEN (COALESCE(od.opening_qty, 0) * COALESCE(od.opening_rate, 0) + COALESCE(pd.purchase_amt, 0))
                 / (COALESCE(od.opening_qty, 0) + COALESCE(pd.purchase_qty, 0))
            ELSE 0
          END AS purchase_blended_rate,

          -- FINAL RATE: mirror of issuance route's final_rates CTE
          CASE
            WHEN prod.itcd IS NOT NULL AND COALESCE(prod.production_cost_per_unit, 0) > 0
            THEN
              CASE WHEN (COALESCE(od.opening_qty, 0) + prod.production_qty) > 0
                THEN (COALESCE(od.opening_qty, 0) * COALESCE(od.opening_rate, 0)
                      + prod.production_qty * prod.production_cost_per_unit)
                     / (COALESCE(od.opening_qty, 0) + prod.production_qty)
                ELSE prod.production_cost_per_unit
              END
            ELSE
              CASE WHEN (COALESCE(od.opening_qty, 0) + COALESCE(pd.purchase_qty, 0)) > 0
                THEN (COALESCE(od.opening_qty, 0) * COALESCE(od.opening_rate, 0) + COALESCE(pd.purchase_amt, 0))
                     / (COALESCE(od.opening_qty, 0) + COALESCE(pd.purchase_qty, 0))
                ELSE 0
              END
          END AS final_rate,

          CASE
            WHEN prod.itcd IS NOT NULL AND COALESCE(prod.production_cost_per_unit, 0) > 0
              THEN CASE
                WHEN prod.production_source = 'tran8_only'       THEN 'production_tran8'
                WHEN COALESCE(od.opening_qty, 0) > 0             THEN 'weighted_avg'
                ELSE 'production_cost_entry'
              END
            WHEN COALESCE(pd.purchase_qty,  0) > 0 THEN 'weighted_avg'
            WHEN COALESCE(od.opening_rate, 0) > 0  THEN 'opening_stock'
            ELSE 'not_found'
          END AS cost_source

        FROM active_items ai
        LEFT JOIN opening_data    od   ON od.itcd   = ai.itcd
        LEFT JOIN purchase_data   pd   ON pd.itcd   = ai.itcd
        LEFT JOIN production_data prod ON prod.itcd  = ai.itcd
        LEFT JOIN issuance_data   isd  ON isd.itcd   = ai.itcd
      )

      SELECT
        i.itcd,
        i.item         AS item_name,
        i.code         AS item_code,
        i.unit,
        COALESCE(ic.ic_name, '') AS category,
        COALESCE(ic.id,       0) AS category_id,
        COALESCE(i.ic_id,     0) AS ic_id,
        c.opening_qty,
        c.opening_rate,
        c.opening_value,
        c.purchase_qty,
        c.purchase_amt,
        c.purchase_rate,
        c.production_qty,
        c.production_cost_per_unit,
        c.actual_cost_per_unit,
        c.theoretical_cost_per_unit,
        c.has_actual,
        c.issued_qty,
        c.purchase_blended_rate,
        c.final_rate,
        c.cost_source,
        c.tran8_cost_per_unit,
        c.production_source
      FROM costing c
      JOIN "Item" i ON i.itcd = c.itcd
      LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id
      WHERE (c.final_rate > 0 OR c.opening_qty > 0 OR c.purchase_qty > 0 OR c.production_qty > 0)
        ${category ? Prisma.sql`AND i.ic_id = ${category}` : Prisma.empty}
      ORDER BY i.item ASC
    `;

    // Fetch all categories for filter dropdown
    const categories = await prisma.itemCategory.findMany({
      select: { id: true, ic_name: true },
      orderBy: { ic_name: "asc" },
    });

    const data = rows.map(r => ({
      itcd:                       Number(r.itcd),
      item_name:                  r.item_name   || "",
      item_code:                  r.item_code   || "",
      unit:                       r.unit        || "",
      category:                   r.category    || "",
      category_id:                Number(r.category_id),
      ic_id:                      Number(r.ic_id || 0),
      opening_qty:                Number(r.opening_qty),
      opening_rate:               Number(r.opening_rate),
      opening_value:              Number(r.opening_value),
      purchase_qty:               Number(r.purchase_qty),
      purchase_amt:               Number(r.purchase_amt),
      purchase_rate:              Number(r.purchase_rate),
      production_qty:             Number(r.production_qty),
      production_cost_per_unit:   Number(r.production_cost_per_unit),
      actual_cost_per_unit:       Number(r.actual_cost_per_unit),
      theoretical_cost_per_unit:  Number(r.theoretical_cost_per_unit),
      has_actual:                 Boolean(r.has_actual),
      issued_qty:                 Number(r.issued_qty),
      purchase_blended_rate:      Number(r.purchase_blended_rate),
      tran8_cost_per_unit:         Number(r.tran8_cost_per_unit   || 0),
      production_source:           r.production_source === 'none' ? null : (r.production_source || null),
      final_rate:                 Number(r.final_rate),
      cost_source:                r.cost_source || "not_found",
    }));

    return NextResponse.json({ data, categories, month, year });
  } catch (error) {
    console.error("Costing rates GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
