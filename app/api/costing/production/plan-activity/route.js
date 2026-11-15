import prisma from "@/lib/prisma";
import { openingSql } from "@/lib/openingStock";
import { NextResponse } from "next/server";

/**
 * GET /api/costing/production/plan-activity?plan_id=&month=&year=
 *
 * Returns per-plan production & issuance activity:
 *   t8_summary  — tran_code=8 (production receipts): how many vouchers, qty, dates
 *   t7_summary  — tran_code=7 (material issuances): each material's qty & cost
 *   item_frequency — how many times THIS ITEM was produced across ALL plans this month
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const planId = parseInt(searchParams.get("plan_id") || "0");
    const month  = parseInt(searchParams.get("month")   || new Date().getMonth() + 1);
    const year   = parseInt(searchParams.get("year")    || new Date().getFullYear());

    if (!planId) {
      return NextResponse.json({ error: "plan_id required" }, { status: 400 });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0, 23, 59, 59);

    // Get the plan's finished_id so we can query item-level frequency
    const plan = await prisma.productionPlanMaster.findUnique({
      where:  { id: planId },
      select: { finished_id: true, qty: true, actual_yield: true, status: true },
    });

    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    if (plan.status !== "Posted") {
      return NextResponse.json(
        { error: `Plan #${planId} is not Posted (status: ${plan.status}). Only Posted plans can be viewed.` },
        { status: 422 }
      );
    }

    // ── T8: Production receipts for THIS plan (linked via rmk5 = plan_id) ────
    const t8Rows = await prisma.$queryRaw`
      SELECT
        tm.vr_no,
        tm.dated,
        SUM(t.qty) AS qty
      FROM  "TRANSACTIONS_MASTER" tm
      JOIN  "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 8
        AND tm.dated >= ${startDate}
        AND tm.dated <= ${endDate}
        AND tm.rmk5 = ${String(planId)}
        AND t.sub_tran_id = 1
        AND t.qty > 0
      GROUP BY tm.vr_no, tm.dated
      ORDER BY tm.dated ASC
    `;

    const t8Vouchers = t8Rows.map((r) => ({
      vr_no: r.vr_no  != null ? Number(r.vr_no) : null,
      dated: r.dated,
      qty:   Number(r.qty || 0),
    }));
    const t8TotalQty = t8Vouchers.reduce((s, v) => s + v.qty, 0);

    // ── T7: Material issuances for THIS plan (linked via rmk5 = plan_id) ─────
    // Costs are valued at opening stock rate, then purchase average, fallback 0
    const t7Rows = await prisma.$queryRaw`
      WITH opening AS (${openingSql(month, year)}),
      purch AS (
        SELECT t2.itcd,
          COALESCE(SUM(t2.damt), 0) AS total_amt,
          COALESCE(SUM(t2.qty),  0) AS total_qty
        FROM  "Transactions" t2
        JOIN  "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
        WHERE tm2.tran_code = 4
          AND tm2.dated >= ${startDate}
          AND tm2.dated <= ${endDate}
          AND t2.qty > 0
          AND t2.sub_tran_id = 1
        GROUP BY t2.itcd
      ),
      blended AS (
        SELECT
          COALESCE(o.itcd, p.itcd) AS itcd,
          CASE
            WHEN (COALESCE(o.opening_qty, 0) + COALESCE(p.total_qty, 0)) > 0
            THEN (COALESCE(o.opening_qty, 0) * COALESCE(o.opening_rate, 0) + COALESCE(p.total_amt, 0))
                 / (COALESCE(o.opening_qty, 0) + COALESCE(p.total_qty, 0))
            ELSE 0
          END AS avg_rate
        FROM opening o
        FULL OUTER JOIN purch p ON p.itcd = o.itcd
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
        LEFT JOIN opening mos ON mos.itcd = pce.itcd
        WHERE pce.month = ${month} AND pce.year = ${year}
          AND pce.itcd IS NOT NULL
          AND COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0) > 0
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
      )
      SELECT
        t.itcd,
        i.item  AS item_name,
        i.code  AS item_code,
        i.unit,
        SUM(t.qty)                                       AS total_qty,
        COALESCE(fr.avg_rate, 0)                          AS unit_cost,
        SUM(t.qty) * COALESCE(fr.avg_rate, 0)             AS total_cost
      FROM  "TRANSACTIONS_MASTER" tm
      JOIN  "Transactions" t  ON t.tran_id = tm.tran_id
      LEFT JOIN "Item"     i  ON i.itcd    = t.itcd
      LEFT JOIN final_rates fr ON fr.itcd  = t.itcd
      WHERE tm.tran_code = 7
        AND tm.dated >= ${startDate}
        AND tm.dated <= ${endDate}
        AND tm.rmk5 = ${String(planId)}
        AND t.sub_tran_id = 1
        AND t.qty  > 0
      GROUP BY t.itcd, i.item, i.code, i.unit, COALESCE(fr.avg_rate, 0)
      ORDER BY total_cost DESC
    `;

    const t7Materials = t7Rows.map((r) => ({
      itcd:       Number(r.itcd),
      item_name:  r.item_name || `Item #${r.itcd}`,
      item_code:  r.item_code || "",
      unit:       r.unit      || "",
      total_qty:  Number(r.total_qty  || 0),
      unit_cost:  Number(r.unit_cost  || 0),
      total_cost: Number(r.total_cost || 0),
    }));
    const t7TotalQty  = t7Materials.reduce((s, m) => s + m.total_qty,  0);
    const t7TotalCost = t7Materials.reduce((s, m) => s + m.total_cost, 0);

    // ── Item frequency: how many times THIS ITEM was produced (all plans) ────
    let itemFrequency = null;
    if (plan?.finished_id) {
      const freqRows = await prisma.$queryRaw`
        SELECT
          NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer AS plan_id,
          tm.vr_no,
          tm.dated,
          SUM(t.qty) AS qty
        FROM  "TRANSACTIONS_MASTER" tm
        JOIN  "Transactions" t ON t.tran_id = tm.tran_id
        WHERE tm.tran_code = 8
          AND tm.dated >= ${startDate}
          AND tm.dated <= ${endDate}
          AND t.itcd = ${plan.finished_id}
          AND t.sub_tran_id = 1
          AND t.qty > 0
        GROUP BY NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer, tm.vr_no, tm.dated
        ORDER BY tm.dated ASC
      `;

      itemFrequency = {
        voucher_count: freqRows.length,
        total_qty:     freqRows.reduce((s, r) => s + Number(r.qty || 0), 0),
        vouchers: freqRows.map((r) => ({
          plan_id: r.plan_id != null ? Number(r.plan_id) : null,
          vr_no:   r.vr_no  != null ? Number(r.vr_no)   : null,
          dated:   r.dated,
          qty:     Number(r.qty || 0),
        })),
      };
    }

    return NextResponse.json({
      plan_id:  planId,
      month,
      year,
      t8_summary: {
        voucher_count: t8Vouchers.length,
        total_qty:     t8TotalQty,
        vouchers:      t8Vouchers,
      },
      t7_summary: {
        material_count: t7Materials.length,
        total_qty:      t7TotalQty,
        total_cost:     t7TotalCost,
        materials:      t7Materials,
      },
      item_frequency: itemFrequency,
    });
  } catch (error) {
    console.error("Plan activity GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
