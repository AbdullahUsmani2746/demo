import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

// ── GET /api/costing/bom-cost/orphan?itcd=&month=&year= ──────────────────────
// Returns:
//  - existing orphan PCE (if already saved)
//  - T7 issuances for this item in the period (unlinked to any plan) → suggested rate
//  - T8 receipts for this item in the period (unlinked to any plan)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const itcd  = parseInt(searchParams.get("itcd")  || "0");
    const month = parseInt(searchParams.get("month") || "0");
    const year  = parseInt(searchParams.get("year")  || "0");

    if (!itcd || !month || !year) {
      return NextResponse.json({ error: "itcd, month, year required" }, { status: 400 });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0, 23, 59, 59);

    // Run all three queries in parallel
    const [existingPce, t7Rows, t8Rows] = await Promise.all([
      // Existing orphan PCE for this item+period
      prisma.productionCostEntry.findFirst({
        where: { itcd, month, year, plan_id: null },
        select: {
          id: true,
          cost_per_unit: true,
          actual_cost_per_unit: true,
          qty_costed: true,
          total_cost: true,
          calculated_at: true,
        },
      }),

      // T7 issuances for this item with NO plan reference (orphan issuances)
      // rmk5 is empty/null for transactions not linked to a production plan
      prisma.$queryRaw`
        SELECT
          COALESCE(SUM(t.damt), 0)       AS total_damt,
          COALESCE(SUM(t.qty),  0)       AS total_qty,
          COUNT(DISTINCT tm.tran_id)     AS tran_count,
          MIN(tm.dated)                  AS first_date,
          MAX(tm.dated)                  AS last_date
        FROM "TRANSACTIONS_MASTER" tm
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
        WHERE tm.tran_code = 7
          AND tm.dated >= ${startDate}
          AND tm.dated <= ${endDate}
          AND t.itcd = ${itcd}
          AND t.sub_tran_id = 1
          AND t.qty > 0
          AND (
            ${poRefSql("tm")} IS NULL
            OR TRIM(${poRefSql("tm")}) = ''
            OR REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g') = ''
          )
      `,

      // T8 receipts for this item with NO plan reference (orphan receipts)
      prisma.$queryRaw`
        SELECT
          COALESCE(SUM(t.qty), 0)        AS total_qty,
          COUNT(DISTINCT tm.tran_id)     AS tran_count
        FROM "TRANSACTIONS_MASTER" tm
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
        WHERE tm.tran_code = 8
          AND tm.dated >= ${startDate}
          AND tm.dated <= ${endDate}
          AND t.itcd = ${itcd}
          AND t.sub_tran_id = 1
          AND t.qty > 0
          AND (
            ${poRefSql("tm")} IS NULL
            OR TRIM(${poRefSql("tm")}) = ''
            OR REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g') = ''
          )
      `,
    ]);

    const t7Damt   = Number(t7Rows?.[0]?.total_damt  || 0);
    const t7Qty    = Number(t7Rows?.[0]?.total_qty   || 0);
    const t7Count  = Number(t7Rows?.[0]?.tran_count  || 0);
    const t8Qty    = Number(t8Rows?.[0]?.total_qty   || 0);
    const t8Count  = Number(t8Rows?.[0]?.tran_count  || 0);

    // Suggested rate = total T7 material cost ÷ T8 receipt qty
    // (same logic as plan-based costing: actual issuance damt / produced qty)
    const suggestedRate = t8Qty > 0 && t7Damt > 0 ? t7Damt / t8Qty : 0;

    return NextResponse.json({
      existing_pce: existingPce
        ? {
            cost_per_unit: Number(existingPce.actual_cost_per_unit ?? existingPce.cost_per_unit ?? 0),
            qty_costed:    Number(existingPce.qty_costed || 0),
            total_cost:    Number(existingPce.total_cost || 0),
            calculated_at: existingPce.calculated_at,
          }
        : null,
      t7_total_damt:  t7Damt,
      t7_total_qty:   t7Qty,
      t7_tran_count:  t7Count,
      t7_first_date:  t7Rows?.[0]?.first_date ?? null,
      t7_last_date:   t7Rows?.[0]?.last_date  ?? null,
      t8_total_qty:   t8Qty,
      t8_tran_count:  t8Count,
      suggested_rate: suggestedRate,
      // Human-readable basis for the suggestion
      suggestion_basis: t7Damt > 0 && t8Qty > 0
        ? `T7 material cost (${t7Count} issuance${t7Count !== 1 ? 's' : ''}) ÷ T8 qty`
        : t7Damt > 0
        ? 'T7 issuances found but no T8 qty'
        : 'No T7 issuances found for this item in this period',
    });
  } catch (error) {
    console.error("Orphan PCE GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orphan suggestion: " + error.message },
      { status: 500 }
    );
  }
}

// ── POST /api/costing/bom-cost/orphan ────────────────────────────────────────
// Save (upsert) a ProductionCostEntry for an orphan production receipt —
// i.e. a tran_code=8 item that has no productionPlanMaster row.
//
// Body:
//   {
//     itcd:          number,   // finished item itcd (required)
//     month:         number,
//     year:          number,
//     qty_costed:    number,   // T8 receipt qty for the period
//     cost_per_unit: number,   // rate (from T7 auto-calc or manual override)
//     rate_source:   string,   // 't7_issuance' | 'opening_stock' | 'weighted_avg' | 'manual'
//   }
//
// Orphan uniqueness is enforced here in code (findFirst before create).

export const POST = guard("costing.manage", async (request) => {
  try {
    const body = await request.json();
    const { itcd, month, year, qty_costed, cost_per_unit, rate_source } = body;

    if (!itcd || !month || !year) {
      return NextResponse.json(
        { error: "itcd, month and year are required" },
        { status: 400 }
      );
    }
    if (!(qty_costed > 0)) {
      return NextResponse.json({ error: "qty_costed must be > 0" }, { status: 400 });
    }
    if (!(cost_per_unit > 0)) {
      return NextResponse.json(
        { error: "cost_per_unit must be > 0 — please enter a valid rate" },
        { status: 400 }
      );
    }

    const totalCost = Number(qty_costed) * Number(cost_per_unit);

    // Upsert: if an orphan PCE already exists for this item+period, update it;
    // otherwise create a new one. We use updateMany + create pattern because
    // Prisma upsert requires either a @unique or @@unique field selector, and
    // the @@unique([itcd, month, year]) composite works only via findFirst+update.
    const existing = await prisma.productionCostEntry.findFirst({
      where: { itcd, month, year, plan_id: null },
    });

    let entry;
    if (existing) {
      entry = await prisma.productionCostEntry.update({
        where: { id: existing.id },
        data: {
          qty_costed:           Number(qty_costed),
          cost_per_unit:        Number(cost_per_unit),
          total_cost:           totalCost,
          actual_cost_per_unit: Number(cost_per_unit),
          actual_issued_cost:   totalCost,
          actual_issued_qty:    Number(qty_costed),
          item_type:            rate_source || "manual",
          calculated_at:        new Date(),
          is_orphan:            true,
        },
      });
    } else {
      entry = await prisma.productionCostEntry.create({
        data: {
          plan_id:              null,
          itcd:                 Number(itcd),
          month:                Number(month),
          year:                 Number(year),
          qty_costed:           Number(qty_costed),
          cost_per_unit:        Number(cost_per_unit),
          total_cost:           totalCost,
          actual_cost_per_unit: Number(cost_per_unit),
          actual_issued_cost:   totalCost,
          actual_issued_qty:    Number(qty_costed),
          item_type:            rate_source || "manual",
          calculated_at:        new Date(),
          is_orphan:            true,
        },
      });
    }

    return NextResponse.json({
      success: true,
      pce_id:        entry.id,
      itcd:          entry.itcd,
      month:         entry.month,
      year:          entry.year,
      qty_costed:    entry.qty_costed,
      cost_per_unit: entry.cost_per_unit,
      total_cost:    entry.total_cost,
      is_orphan:     true,
    });
  } catch (error) {
    console.error("Orphan PCE save error:", error);
    return NextResponse.json(
      { error: "Failed to save orphan cost entry: " + error.message },
      { status: 500 }
    );
  }
});

// ── DELETE /api/costing/bom-cost/orphan?itcd=&month=&year= ───────────────────
export const DELETE = guard("costing.manage", async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const itcd  = parseInt(searchParams.get("itcd")  || "0");
    const month = parseInt(searchParams.get("month") || "0");
    const year  = parseInt(searchParams.get("year")  || "0");

    if (!itcd || !month || !year) {
      return NextResponse.json(
        { error: "itcd, month, year are required" },
        { status: 400 }
      );
    }

    const existing = await prisma.productionCostEntry.findFirst({
      where: { itcd, month, year, plan_id: null },
    });
    if (!existing) {
      return NextResponse.json({ error: "No orphan PCE found" }, { status: 404 });
    }

    await prisma.productionCostEntry.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Orphan PCE delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete: " + error.message },
      { status: 500 }
    );
  }
});
