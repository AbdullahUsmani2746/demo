import prisma from "@/lib/prisma";
import { openingSql } from "@/lib/openingStock";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/**
 * GET /api/costing/issuance?month=5&year=2026&page=1&limit=50&item=&godown=
 *
 * Returns every material issuance line (tran_code=7) for the period,
 * valued by the monthly opening rate (MonthlyOpeningRate) for that item/month/year.
 * Fallback: weighted-avg purchase rate up to end of period.
 *
 * Response shape:
 * {
 *   vouchers: [{
 *     tran_id, vr_no, dated, godown_name, rmk,
 *     lines: [{ itcd, item_name, item_code, unit, qty, unit_cost, total_cost, cost_source }],
 *     total_cost
 *   }],
 *   summary: { total_cost, total_qty, voucher_count, item_count, zero_cost_lines }
 * }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = parseInt(searchParams.get("month") || new Date().getMonth() + 1);
    const year = parseInt(searchParams.get("year") || new Date().getFullYear());
    const itemFilter = searchParams.get("item") ? parseInt(searchParams.get("item")) : null;
    const godownFilter = searchParams.get("godown") ? parseInt(searchParams.get("godown")) : null;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(2000, parseInt(searchParams.get("limit") || "2000"));

    const dateFrom = new Date(year, month - 1, 1);
    dateFrom.setHours(0, 0, 0, 0);
    const dateTo = new Date(year, month, 0);
    dateTo.setHours(23, 59, 59, 999);

    // ── 1. Fetch all valued issuance lines via raw SQL ────────────────────────
    // Joins issuance lines with monthly opening (lib/openingStock.js) for valuation.
    // For items not in opening stock, falls back to weighted avg purchase rate.
    const allLines = await prisma.$queryRaw`
      WITH purchase_rates AS (
        -- Period purchases per item (damt only, no tax)
        SELECT
          t.itcd,
          COALESCE(SUM(t.damt), 0) AS total_amt,
          COALESCE(SUM(t.qty),  0) AS total_qty
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
        WHERE tm.tran_code = 4
          AND tm.dated >= ${dateFrom}
          AND tm.dated <= ${dateTo}
          AND t.qty > 0
          AND t.sub_tran_id = 1
        GROUP BY t.itcd
      ),
      opening_rates AS (${openingSql(month, year)}),
      blended_rates AS (
        -- Weighted average: (opening_qty * opening_rate + purchase_damt) / (opening_qty + purchase_qty)
        SELECT
          COALESCE(osr.itcd, pr.itcd) AS itcd,
          CASE
            WHEN (COALESCE(osr.opening_qty, 0) + COALESCE(pr.total_qty, 0)) > 0
            THEN (COALESCE(osr.opening_qty, 0) * COALESCE(osr.opening_rate, 0) + COALESCE(pr.total_amt, 0))
                 / (COALESCE(osr.opening_qty, 0) + COALESCE(pr.total_qty, 0))
            ELSE 0
          END AS avg_rate,
          CASE
            WHEN COALESCE(pr.total_qty, 0) > 0 THEN 'weighted_avg'
            WHEN COALESCE(osr.opening_rate, 0) > 0 THEN 'opening_stock'
            ELSE 'not_found'
          END AS cost_source
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
          END AS avg_rate,
          CASE
            WHEN COALESCE(mos.opening_qty, 0) > 0 THEN 'weighted_avg'
            ELSE 'production_cost_entry'
          END AS cost_source
        FROM "ProductionCostEntry" pce
        LEFT JOIN opening_rates mos ON mos.itcd = pce.itcd
        WHERE pce.month = ${month} AND pce.year = ${year}
          AND pce.itcd IS NOT NULL
          AND COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0) > 0
        GROUP BY pce.itcd, mos.opening_qty, mos.opening_rate
      ),
      final_rates AS (
        -- If item was produced this period, use production-blended rate (opening already included).
        -- Otherwise use blended_rates (opening + purchase weighted avg).
        SELECT
          COALESCE(br.itcd, prr.itcd) AS itcd,
          CASE
            WHEN prr.itcd IS NOT NULL AND COALESCE(prr.avg_rate, 0) > 0
              THEN prr.avg_rate
            ELSE COALESCE(br.avg_rate, 0)
          END AS avg_rate,
          CASE
            WHEN prr.itcd IS NOT NULL AND COALESCE(prr.avg_rate, 0) > 0
              THEN prr.cost_source
            ELSE COALESCE(br.cost_source, 'not_found')
          END AS cost_source
        FROM blended_rates br
        FULL OUTER JOIN production_rates prr ON prr.itcd = br.itcd
      )
      SELECT
        tm.tran_id,
        tm.vr_no,
        tm.dated,
        tm.rmk,
        tm.rmk1,
        tm.rmk5,
        tm.godown,
        g.godown AS godown_name,
        t.id AS line_id,
        t.itcd,
        i.item AS item_name,
        i.code AS item_code,
        i.unit,
        t.qty,
        t.sub_tran_id,
        COALESCE(fr.avg_rate, 0) AS unit_cost,
        COALESCE(fr.cost_source, 'not_found') AS cost_source,
        COALESCE(t.qty, 0) * COALESCE(fr.avg_rate, 0) AS line_cost
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      LEFT JOIN "Item" i ON i.itcd = t.itcd
      LEFT JOIN "Godown" g ON g.id = tm.godown
      LEFT JOIN final_rates fr ON fr.itcd = t.itcd
      WHERE tm.tran_code = 7
        AND tm.dated >= ${dateFrom}
        AND tm.dated <= ${dateTo}
        AND t.sub_tran_id = 1
        AND t.itcd IS NOT NULL
        AND t.qty IS NOT NULL
        AND t.qty > 0
        AND (
          -- No PO reference at all
          NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '') IS NULL
          -- Has a PO reference pointing to a Posted plan
          OR EXISTS (
            SELECT 1 FROM "productionPlanMaster" ppm2
            WHERE ppm2.id = NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer
              AND ppm2.status = 'Posted'
          )
          -- Has a PO reference but no matching plan exists (orphaned/stale reference)
          OR NOT EXISTS (
            SELECT 1 FROM "productionPlanMaster" ppm2
            WHERE ppm2.id = NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer
          )
        )
        ${itemFilter ? Prisma.sql`AND t.itcd = ${itemFilter}` : Prisma.empty}
        ${godownFilter ? Prisma.sql`AND tm.godown = ${godownFilter}` : Prisma.empty}
      ORDER BY tm.dated DESC, tm.tran_id DESC, t.id ASC
    `;

    // ── 2. Group lines by tran_id ─────────────────────────────────────────────
    const voucherMap = new Map();

    for (const row of allLines) {
      const key = Number(row.tran_id);
      if (!voucherMap.has(key)) {
        voucherMap.set(key, {
          tran_id: key,
          vr_no: Number(row.vr_no),
          dated: row.dated,
          rmk: row.rmk || "",
          rmk1: row.rmk1 || "",
          process_order_ref: row.rmk5 ? row.rmk5.replace(/[^0-9]/g, "") : "",
          godown: Number(row.godown),
          godown_name: row.godown_name || "",
          lines: [],
          total_cost: 0,
          total_qty: 0,
        });
      }
      const voucher = voucherMap.get(key);
      const lineCost = Number(row.line_cost) || 0;
      const qty = Number(row.qty) || 0;

      voucher.lines.push({
        line_id: Number(row.line_id),
        itcd: Number(row.itcd),
        item_name: row.item_name || `Item #${row.itcd}`,
        item_code: row.item_code || "",
        unit: row.unit || "",
        qty,
        unit_cost: Number(row.unit_cost) || 0,
        total_cost: lineCost,
        cost_source: row.cost_source,
      });
      voucher.total_cost += lineCost;
      voucher.total_qty += qty;
    }

    const vouchers = Array.from(voucherMap.values());

    // ── 3. Pagination ──────────────────────────────────────────────────────────
    const totalVouchers = vouchers.length;
    const paginated = vouchers.slice((page - 1) * limit, page * limit);

    // ── 4. Summary ─────────────────────────────────────────────────────────────
    const allLinesFlatForSummary = allLines;
    const totalCost = allLinesFlatForSummary.reduce((s, r) => s + (Number(r.line_cost) || 0), 0);
    const totalQty = allLinesFlatForSummary.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const uniqueItems = new Set(allLinesFlatForSummary.map((r) => Number(r.itcd)));
    const zeroCostLines = allLinesFlatForSummary.filter((r) => Number(r.unit_cost) === 0).length;

    // Per-item summary
    const itemSummaryMap = new Map();
    for (const row of allLinesFlatForSummary) {
      const id = Number(row.itcd);
      if (!itemSummaryMap.has(id)) {
        itemSummaryMap.set(id, {
          itcd: id,
          item_name: row.item_name || `#${id}`,
          item_code: row.item_code || "",
          unit: row.unit || "",
          total_qty: 0,
          total_cost: 0,
          unit_cost: Number(row.unit_cost) || 0,
          cost_source: row.cost_source,
          voucher_count: 0,
        });
      }
      const item = itemSummaryMap.get(id);
      item.total_qty += Number(row.qty) || 0;
      item.total_cost += Number(row.line_cost) || 0;
      item.voucher_count += 1;
    }
    const itemSummary = Array.from(itemSummaryMap.values()).sort((a, b) => b.total_cost - a.total_cost);

    return NextResponse.json({
      vouchers: paginated,
      item_summary: itemSummary,
      summary: {
        total_cost: totalCost,
        total_qty: totalQty,
        voucher_count: totalVouchers,
        item_count: uniqueItems.size,
        zero_cost_lines: zeroCostLines,
      },
      pagination: {
        current_page: page,
        page_size: limit,
        total: totalVouchers,
        total_pages: Math.ceil(totalVouchers / limit),
        has_next: page * limit < totalVouchers,
        has_prev: page > 1,
      },
    });
  } catch (error) {
    console.error("Issuance costing GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
