import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import prisma from "@/lib/prisma";
import { openingSql } from "@/lib/openingStock";
import { NextResponse } from "next/server";

/**
 * GET /api/costing/variance?month=5&year=2026
 *
 * Per-production-order variance analysis:
 *   BOM expected raw-material consumption  vs  actual issued (tran_code=7)
 *
 * Links issuance to production plan via rmk5 field (contains plan ID as numeric string).
 *
 * Response per plan:
 * {
 *   plan_id, finished_item, qty_produced,
 *   is_costed,
 *   materials: [{
 *     itcd, item_name, item_code,
 *     bom_expected_qty, actual_issued_qty, variance_qty, variance_pct,
 *     unit_cost, bom_expected_cost, actual_issued_cost, cost_variance,
 *     status: 'match' | 'over_issued' | 'under_issued' | 'not_issued' | 'not_in_bom'
 *   }],
 *   bom_total_cost, actual_total_cost, cost_variance, qty_variance_total
 * }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = parseInt(searchParams.get("month") || new Date().getMonth() + 1);
    const year = parseInt(searchParams.get("year") || new Date().getFullYear());
    const planId = searchParams.get("plan_id") ? parseInt(searchParams.get("plan_id")) : null;

    const dateFrom = new Date(year, month - 1, 1);
    dateFrom.setHours(0, 0, 0, 0);
    const dateTo = new Date(year, month, 0);
    dateTo.setHours(23, 59, 59, 999);

    // ── 1. Get production plans with saved cost entries ───────────────────────
    const planWhere = {
      dated: { gte: dateFrom, lte: dateTo },
      ...(planId ? { id: planId } : {}),
    };

    const plans = await prisma.productionPlanMaster.findMany({
      where: planWhere,
      include: {
        item: { select: { itcd: true, item: true, code: true, unit: true } },
        costEntry: {
          include: { details: true },
        },
      },
      orderBy: { dated: "desc" },
    });

    if (!plans.length) {
      return NextResponse.json({ results: [], summary: { total_plans: 0, costed_plans: 0, total_cost_variance: 0 } });
    }

    const planIds = plans.map((p) => p.id);

    // ── 2. Fetch actual issuances for these plans (tran_code=7) ──────────────
    // Production plans are referenced in rmk5 as their numeric ID
    // Also match via tran_code=7 in date range (all issuances for the period)
    const issuanceRows = await prisma.$queryRaw`
      WITH opening_rates AS (${openingSql(month, year)}),
      purchase_rates AS (
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
        NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g'), '')::integer AS plan_id,
        t.itcd,
        i.item AS item_name,
        i.code AS item_code,
        SUM(t.qty) AS total_issued_qty,
        COALESCE(fr.avg_rate, 0) AS unit_cost,
        SUM(t.qty) * COALESCE(fr.avg_rate, 0) AS issued_cost
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      LEFT JOIN "Item" i ON i.itcd = t.itcd
      LEFT JOIN final_rates fr ON fr.itcd = t.itcd
      WHERE tm.tran_code = 7
        AND tm.dated >= ${dateFrom}
        AND tm.dated <= ${dateTo}
        AND t.sub_tran_id = 1
        AND t.itcd IS NOT NULL
        AND t.qty > 0
      GROUP BY
        NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g'), '')::integer,
        t.itcd, i.item, i.code,
        COALESCE(fr.avg_rate, 0)
    `;

    // Build a map: plan_id → itcd → { qty, cost }
    const issuanceByPlan = new Map();
    const issuanceUnlinked = []; // issuances with no parseable plan_id

    for (const row of issuanceRows) {
      const planIdNum = row.plan_id != null ? Number(row.plan_id) : 0;
      const key = planIdNum && planIds.includes(planIdNum) ? planIdNum : 0;
      if (!issuanceByPlan.has(key)) issuanceByPlan.set(key, new Map());
      const itemMap = issuanceByPlan.get(key);

      const itcd = Number(row.itcd);
      if (!itemMap.has(itcd)) {
        itemMap.set(itcd, {
          itcd,
          item_name: row.item_name || `#${itcd}`,
          item_code: row.item_code || "",
          total_issued_qty: 0,
          unit_cost: Number(row.unit_cost) || 0,
          issued_cost: 0,
        });
      }
      const entry = itemMap.get(itcd);
      entry.total_issued_qty += Number(row.total_issued_qty) || 0;
      entry.issued_cost += Number(row.issued_cost) || 0;
    }

    // ── 3. Build variance results per plan ────────────────────────────────────
    const results = [];

    for (const plan of plans) {
      const qty = plan.actual_yield || plan.qty || 0;
      const isCosted = !!plan.costEntry;

      // BOM expected materials (from saved ProductionCostDetail)
      const bomMaterials = new Map();
      if (plan.costEntry?.details) {
        for (const detail of plan.costEntry.details) {
          bomMaterials.set(detail.material_id, {
            itcd: detail.material_id,
            item_name: detail.material_name,
            item_code: detail.material_code || "",
            bom_expected_qty: detail.qty,
            unit_cost: detail.unit_cost,
            bom_expected_cost: detail.total_cost,
          });
        }
      }

      // Actual issued for this plan
      const actualIssued = issuanceByPlan.get(plan.id) || new Map();

      // Merge BOM vs actual
      const materialVariances = [];
      const allItemIds = new Set([...bomMaterials.keys(), ...actualIssued.keys()]);

      for (const itcd of allItemIds) {
        const bom = bomMaterials.get(itcd);
        const actual = actualIssued.get(itcd);

        const bomQty = bom?.bom_expected_qty || 0;
        const actualQty = actual?.total_issued_qty || 0;
        const unitCost = bom?.unit_cost || actual?.unit_cost || 0;

        const varianceQty = actualQty - bomQty;
        const variancePct = bomQty > 0 ? (varianceQty / bomQty) * 100 : actualQty > 0 ? 100 : 0;
        const bomCost = bomQty * unitCost;
        const actualCost = actualQty * unitCost;
        const costVariance = actualCost - bomCost;

        let status;
        if (!bom && actual) status = "not_in_bom";
        else if (bom && !actual) status = "not_issued";
        else if (Math.abs(varianceQty) < 0.001) status = "match";
        else if (varianceQty > 0) status = "over_issued";
        else status = "under_issued";

        materialVariances.push({
          itcd,
          item_name: bom?.item_name || actual?.item_name || `#${itcd}`,
          item_code: bom?.item_code || actual?.item_code || "",
          bom_expected_qty: bomQty,
          actual_issued_qty: actualQty,
          variance_qty: varianceQty,
          variance_pct: variancePct,
          unit_cost: unitCost,
          bom_expected_cost: bomCost,
          actual_issued_cost: actualCost,
          cost_variance: costVariance,
          status,
        });
      }

      // Sort: over-issued first, then not-issued, then match, then not-in-bom
      const sortOrder = { over_issued: 0, under_issued: 1, not_issued: 2, not_in_bom: 3, match: 4 };
      materialVariances.sort((a, b) => (sortOrder[a.status] ?? 5) - (sortOrder[b.status] ?? 5));

      const bomTotalCost = materialVariances.reduce((s, m) => s + m.bom_expected_cost, 0);
      const actualTotalCost = materialVariances.reduce((s, m) => s + m.actual_issued_cost, 0);

      results.push({
        plan_id: plan.id,
        finished_id: plan.finished_id,
        finished_item: plan.item?.item || "",
        finished_code: plan.item?.code || "",
        unit: plan.item?.unit || "",
        dated: plan.dated,
        qty_produced: qty,
        is_costed: isCosted,
        cost_per_unit: plan.costEntry?.cost_per_unit || 0,
        materials: materialVariances,
        bom_total_cost: bomTotalCost,
        actual_total_cost: actualTotalCost,
        cost_variance: actualTotalCost - bomTotalCost,
        over_issued_count: materialVariances.filter((m) => m.status === "over_issued").length,
        under_issued_count: materialVariances.filter((m) => m.status === "under_issued").length,
        not_issued_count: materialVariances.filter((m) => m.status === "not_issued").length,
        not_in_bom_count: materialVariances.filter((m) => m.status === "not_in_bom").length,
        match_count: materialVariances.filter((m) => m.status === "match").length,
      });
    }

    // ── 4. Overall summary ────────────────────────────────────────────────────
    const summary = {
      total_plans: results.length,
      costed_plans: results.filter((r) => r.is_costed).length,
      total_bom_cost: results.reduce((s, r) => s + r.bom_total_cost, 0),
      total_actual_cost: results.reduce((s, r) => s + r.actual_total_cost, 0),
      total_cost_variance: results.reduce((s, r) => s + r.cost_variance, 0),
      plans_with_over_issue: results.filter((r) => r.over_issued_count > 0).length,
      plans_with_missing_issue: results.filter((r) => r.not_issued_count > 0).length,
    };

    return NextResponse.json({ results, summary });
  } catch (error) {
    console.error("Variance analysis error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
