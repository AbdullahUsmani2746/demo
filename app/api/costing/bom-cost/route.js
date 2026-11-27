import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import prisma from "@/lib/prisma";
import { getOpeningOne, getOpening } from "@/lib/openingStock";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { getProductionSetup, isSemiFinishedCategory } from "@/lib/production/setup";

// ── Get unit cost for a raw-material item ──────────────────────────────────────
// Priority:
//   1. ProductionCostEntry for this item this period (if it was produced & costed)
//   2. Weighted average = (opening_qty × opening_rate + period purchase damt) / (opening_qty + period purchase qty)
async function getItemUnitCost(itemId, month, year) {
  // 1. Was this item produced this period and already costed?
  //    Check both: plan-based PCE (via plan.finished_id) AND orphan PCE (via itcd directly).
  const prodEntry = await prisma.productionCostEntry.findFirst({
    where: {
      month,
      year,
      OR: [
        { plan: { finished_id: itemId } },
        { itcd: itemId, plan_id: null },   // orphan PCE
      ],
    },
    orderBy: { calculated_at: "desc" },
    select: { actual_cost_per_unit: true, cost_per_unit: true },
  });
  if (prodEntry) {
    const cost = Number(prodEntry.actual_cost_per_unit ?? prodEntry.cost_per_unit ?? 0);
    if (cost > 0) return { unitCost: cost, source: "production_cost_entry" };
  }

  // 2. Monthly opening stock (qty + value)
  const openingStock = await getOpeningOne(month, year, itemId);

  const opening_qty   = Number(openingStock?.opening_qty  || 0);
  const opening_rate  = Number(openingStock?.opening_rate || 0);
  const opening_value = opening_qty * opening_rate;

  // 2. Period purchases (damt only — no sales tax / additional tax)
  const endOfPeriod = new Date(year, month, 0, 23, 59, 59);
  const startOfMonth = new Date(year, month - 1, 1);

  const purchases = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(t.damt), 0) AS total_amt,
      COALESCE(SUM(t.qty),  0) AS total_qty
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    WHERE t.itcd    = ${itemId}
      AND tm.tran_code = 4
      AND tm.dated  >= ${startOfMonth}
      AND tm.dated  <= ${endOfPeriod}
      AND t.sub_tran_id = 1
      AND t.qty     >  0
  `;

  const p           = purchases?.[0];
  const purch_qty   = Number(p?.total_qty || 0);
  const purch_amt   = Number(p?.total_amt || 0);

  const total_qty   = opening_qty + purch_qty;
  const total_value = opening_value + purch_amt;

  // 3. Weighted average = (opening value + purchase damt) / (opening qty + purchase qty)
  if (total_qty > 0 && total_value > 0) {
    return {
      unitCost: total_value / total_qty,
      source: purch_qty > 0 ? "weighted_avg" : "opening_stock",
    };
  }

  // 4. No data at all
  return { unitCost: 0, source: "not_found" };
}

// ── POST /api/costing/bom-cost ────────────────────────────────────────────────
// Body: { plan_id, month, year }
// Returns plan material cost list (preview only, does NOT save)

// PLAN MATERIALS
// Reads productionPlanDetail (the actual material list on this plan) and
// assigns rates in ic_id order:
//   ic_id=2 (semi-finished): ProductionCostEntry this period -> opening rate
//   ic_id=3 (raw material):  weighted avg = (opening*rate + period purchases) / qty
async function getPlanMaterials(plan, month, year) {
  const setup = await getProductionSetup();
  const details = await prisma.productionPlanDetail.findMany({
    where:   { plan_id: plan.id },
    include: {
      item: { select: { itcd: true, item: true, code: true, unit: true, ic_id: true } },
    },
    orderBy: { sno: "asc" },
  });

  const merged = new Map(); // deduplicate by material_id

  for (const d of details) {
    if (!d.material_id) continue;
    const materialQty = Number(d.material_qty || 0);
    if (materialQty <= 0) continue;

    const icId = d.item?.ic_id;
    let unitCost   = 0;
    let costSource = "not_found";

    if (isSemiFinishedCategory(setup, icId)) {
      // Semi-finished: blend opening stock + production cost for this period.
      // If the item has opening_qty from last month AND was produced this month,
      // the correct rate is: (opening_qty × opening_rate + prod_qty × prod_cost) / (opening_qty + prod_qty)
      //
      // Match the authoritative production route: aggregate ALL of this material's
      // PCEs for the month, keyed by itcd (not plan.finished_id, which misses
      // orphan-produced semis), so this preview equals the saved cost.
      const sfEntries = await prisma.productionCostEntry.findMany({
        where:  { month, year, itcd: d.material_id },
        select: { actual_cost_per_unit: true, cost_per_unit: true, qty_costed: true },
      });
      const os = await getOpeningOne(month, year, d.material_id);
      const openingQty  = Number(os?.opening_qty  || 0);
      const openingRate = Number(os?.opening_rate || 0);

      // Weighted average across all batches — mirrors the production_rates CTE:
      //   SUM(rate × qty) / SUM(qty), rate = actual_cost_per_unit ?? cost_per_unit,
      //   counting only batches with a positive rate and qty.
      let prodQty   = 0;
      let prodValue = 0;
      for (const e of sfEntries) {
        const rate = Number(e.actual_cost_per_unit ?? e.cost_per_unit ?? 0);
        const q    = Number(e.qty_costed || 0);
        if (rate > 0 && q > 0) {
          prodQty   += q;
          prodValue += rate * q;
        }
      }

      const totalQty    = openingQty + prodQty;
      const totalValue  = (openingQty * openingRate) + prodValue;
      if (totalQty > 0 && totalValue > 0) {
        unitCost   = totalValue / totalQty;
        costSource = prodQty > 0
          ? (openingQty > 0 ? "weighted_avg" : "production_cost_entry")
          : "opening_stock";
      }
    } else {
      // Raw material (ic_id=3) or other: weighted average (opening + period purchases)
      const { unitCost: uc, source } = await getItemUnitCost(d.material_id, month, year);
      unitCost   = uc;
      costSource = source;
    }

    const thisCost = materialQty * unitCost;
    if (merged.has(d.material_id)) {
      const ex       = merged.get(d.material_id);
      ex.qty        += materialQty;
      ex.total_cost += thisCost;
      ex.unit_cost   = ex.qty > 0 ? ex.total_cost / ex.qty : ex.unit_cost;
    } else {
      merged.set(d.material_id, {
        material_id:    d.material_id,
        material_name:  d.item?.item || `Item #${d.material_id}`,
        material_code:  d.item?.code || "",
        unit:           d.item?.unit || "",
        ic_id:          icId,
        is_raw_material: true,
        bom_level:      0,
        qty:            materialQty,
        unit_cost:      unitCost,
        total_cost:     thisCost,
        cost_source:    costSource,
      });
    }
  }

  return [...merged.values()];
}

// ── GET /api/costing/bom-cost?month=&year= ────────────────────────────────────
// Lists ALL production receipts (tran_code=8) for the period, whether or not
// a productionPlanMaster entry exists.  Each row includes:
//  - finished_id / finished_item / finished_code / unit
//  - total_qty from T8 receipts
//  - plan_id / plan_exists flag (resolved via rmk5)
//  - has_pce / pce_cost_per_unit from ProductionCostEntry
//  - opening_rate / purchase_avg_rate / effective_rate / effective_rate_source
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = parseInt(searchParams.get("month") || new Date().getMonth() + 1);
    const year  = parseInt(searchParams.get("year")  || new Date().getFullYear());

    if (!month || !year) {
      return NextResponse.json({ error: "month and year are required" }, { status: 400 });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0, 23, 59, 59);

    // ── All T8 receipts for the period, grouped by item + plan-ref ────────────
    const t8Rows = await prisma.$queryRaw`
      SELECT
        t.itcd                                                             AS finished_id,
        i.item                                                             AS finished_item,
        i.code                                                             AS finished_code,
        i.unit,
        COALESCE(SUM(t.qty),              0)                               AS total_qty,
        NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'')::integer AS plan_id_raw,
        MIN(tm.dated)                                                      AS first_date,
        MAX(tm.dated)                                                      AS last_date,
        COUNT(DISTINCT tm.tran_id)                                         AS tran_count
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t  ON t.tran_id  = tm.tran_id
      LEFT JOIN "Item"    i  ON i.itcd     = t.itcd
      WHERE tm.tran_code = 8
        AND tm.dated    >= ${startDate}
        AND tm.dated    <= ${endDate}
        AND t.sub_tran_id = 1
        AND t.qty > 0
        AND (
          NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'') IS NULL
          OR EXISTS (
            SELECT 1 FROM "productionPlanMaster" ppm
            WHERE ppm.id = NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'')::integer
              AND ppm.status = 'Posted'
          )
        )
      GROUP BY t.itcd, i.item, i.code, i.unit,
               NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'')::integer
      ORDER BY i.item ASC
    `;

    if (!t8Rows.length) {
      return NextResponse.json({ items: [], month, year });
    }

    // ── Resolve plan existence & PCE for each item ────────────────────────────
    const allPlanIds = [...new Set(t8Rows.map(r => r.plan_id_raw).filter(Boolean).map(Number))];
    const allItcds   = [...new Set(t8Rows.map(r => Number(r.finished_id)).filter(Boolean))];

    const [existingPlans, pceEntries] = await Promise.all([
      allPlanIds.length > 0
        ? prisma.productionPlanMaster.findMany({
            where: { id: { in: allPlanIds }, status: "Posted" },
            select: { id: true, finished_id: true, qty: true, actual_yield: true },
          })
        : Promise.resolve([]),
      allItcds.length > 0
        ? prisma.productionCostEntry.findMany({
            where: {
              month,
              year,
              OR: [
                { plan: { finished_id: { in: allItcds } } },   // plan-based
                { itcd: { in: allItcds }, plan_id: null },      // orphan
              ],
            },
            select: {
              id: true,
              actual_cost_per_unit: true,
              cost_per_unit: true,
              qty_costed: true,
              itcd: true,
              is_orphan: true,
              plan: { select: { finished_id: true } },
            },
            orderBy: { calculated_at: "desc" },
          })
        : Promise.resolve([]),
    ]);

    const planExistsSet = new Set(existingPlans.map(p => p.id));
    // Use the most recent PCE per finished item — plan-based takes priority over orphan
    const pceByItem = new Map();
    for (const e of pceEntries) {
      const fid = e.plan?.finished_id ?? e.itcd;   // plan-based or orphan
      if (fid && !pceByItem.has(fid)) {
        pceByItem.set(fid, {
          pce_id:            e.id,
          pce_cost_per_unit: Number(e.actual_cost_per_unit ?? e.cost_per_unit ?? 0),
          pce_qty_costed:    Number(e.qty_costed || 0),
          is_orphan_pce:     e.is_orphan ?? false,
        });
      }
    }

    // ── Proper cost chain for items without PCE ───────────────────────────────
    // Priority: PCE → opening stock rate → period purchase weighted avg → 0
    // t8.damt is intentionally NOT used — production receipt damt is unreliable.
    const noPceItcds = allItcds.filter(id => !pceByItem.has(id));

    const [openingStocks, periodPurchases] = await Promise.all([
      noPceItcds.length > 0
        ? getOpening(month, year, { itcds: noPceItcds })
        : Promise.resolve([]),
      noPceItcds.length > 0
        ? prisma.$queryRaw`
            SELECT
              t.itcd,
              COALESCE(SUM(t.damt), 0) AS total_amt,
              COALESCE(SUM(t.qty),  0) AS total_qty
            FROM "Transactions" t
            JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
            WHERE t.itcd = ANY(${noPceItcds})
              AND tm.tran_code = 4
              AND t.sub_tran_id = 1
              AND t.qty > 0
              AND tm.dated >= ${startDate}
              AND tm.dated <= ${endDate}
            GROUP BY t.itcd
          `
        : Promise.resolve([]),
    ]);

    const openingRateMap = new Map(openingStocks.map(s => [Number(s.itcd), Number(s.opening_rate || 0)]));
    const purchaseAvgMap = new Map();
    for (const r of periodPurchases) {
      const qty = Number(r.total_qty || 0);
      const amt = Number(r.total_amt || 0);
      if (qty > 0 && amt > 0) purchaseAvgMap.set(Number(r.itcd), amt / qty);
    }

    const items = t8Rows.map(r => {
      const finishedId = Number(r.finished_id);
      const planIdRaw  = r.plan_id_raw != null ? Number(r.plan_id_raw) : null;
      const pce        = pceByItem.get(finishedId) || null;
      const openingRate   = openingRateMap.get(finishedId) || 0;
      const purchaseAvg   = purchaseAvgMap.get(finishedId) || 0;
      const effectiveRate = pce?.pce_cost_per_unit || openingRate || purchaseAvg || 0;
      const effectiveRateSource = pce?.pce_cost_per_unit > 0 ? 'pce'
        : openingRate > 0 ? 'opening_stock'
        : purchaseAvg > 0 ? 'weighted_avg'
        : 'no_cost';
      const totalQty = Number(r.total_qty || 0);
      return {
        finished_id:    finishedId,
        finished_item:  r.finished_item  || `Item #${finishedId}`,
        finished_code:  r.finished_code  || "",
        unit:           r.unit           || "",
        total_qty:      totalQty,
        tran_count:     Number(r.tran_count || 1),
        first_date:     r.first_date,
        last_date:      r.last_date,
        plan_id:        planIdRaw,
        plan_exists:    planIdRaw != null ? planExistsSet.has(planIdRaw) : false,
        has_pce:        pce != null,
        pce_cost_per_unit:     pce?.pce_cost_per_unit ?? null,
        pce_qty_costed:        pce?.pce_qty_costed    ?? null,
        is_orphan_pce:         pce?.is_orphan_pce     ?? false,
        opening_rate:          openingRate,
        purchase_avg_rate:     purchaseAvg,
        effective_rate:        effectiveRate,
        effective_rate_source: effectiveRateSource,
        total_value:           totalQty * effectiveRate,
        is_orphan:      planIdRaw == null || !planExistsSet.has(planIdRaw),
      };
    });

    return NextResponse.json({
      items,
      month,
      year,
      total_items:  items.length,
      orphan_count: items.filter(i => i.is_orphan).length,
      costed_count: items.filter(i => i.has_pce).length,
    });
  } catch (error) {
    console.error("BOM cost GET error:", error);
    return NextResponse.json({ error: "Failed to list production items: " + error.message }, { status: 500 });
  }
}

export const POST = guard("costing.manage", async (request) => {
  try {
    const { plan_id, month, year } = await request.json();

    if (!plan_id || !month || !year) {
      return NextResponse.json(
        { error: "plan_id, month, and year are required" },
        { status: 400 }
      );
    }

    // Load production plan
    const plan = await prisma.productionPlanMaster.findUnique({
      where: { id: parseInt(plan_id) },
      include: {
        item: { select: { itcd: true, item: true, code: true } },
        costEntries: { include: { details: true }, orderBy: { output_line: "asc" } },
      },
    });

    if (!plan) {
      return NextResponse.json({ error: "Production plan not found" }, { status: 404 });
    }

    if (plan.status !== "Posted") {
      return NextResponse.json(
        { error: `Plan #${plan_id} is not Posted (status: ${plan.status}). Only Posted plans can be costed.` },
        { status: 422 }
      );
    }

    const finishedId = plan.finished_id;

    if (!finishedId) {
      return NextResponse.json(
        { error: "Production plan has no finished item" },
        { status: 422 }
      );
    }

    // ── Determine production quantity: T8 receipt (most accurate) → actual_yield → planned qty
    const startDate  = new Date(year, month - 1, 1);
    const endDate    = new Date(year, month, 0, 23, 59, 59);

    const t8Rows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(t.qty), 0) AS total_qty
      FROM   "TRANSACTIONS_MASTER" tm
      JOIN   "Transactions" t ON t.tran_id = tm.tran_id
      WHERE  tm.tran_code = 8
        AND  tm.dated >= ${startDate}
        AND  tm.dated <= ${endDate}
        AND  ${poRefSql("tm")} = ${String(plan_id)}
        AND  t.sub_tran_id = 1
        AND  t.qty > 0
    `;
    const t8Qty = Number(t8Rows?.[0]?.total_qty || 0);

    let qty;
    let qty_source;
    if (t8Qty > 0) {
      qty        = t8Qty;
      qty_source = "t8_receipt";            // actual receipt into stock — most accurate
    } else if ((plan.actual_yield || 0) > 0) {
      qty        = plan.actual_yield;
      qty_source = "actual_yield";          // manually entered yield on the plan form
    } else if ((plan.qty || 0) > 0) {
      qty        = plan.qty;
      qty_source = "planned_qty";           // only the originally planned qty
    } else {
      return NextResponse.json(
        { error: "Production plan has zero quantity — enter actual yield or post a T8 receipt" },
        { status: 422 }
      );
    }

    // Build cost from productionPlanDetail — the actual material list on this plan.
    // Pass `plan` object; getPlanMaterials loads plan details internally.
    const rawMaterials = await getPlanMaterials(plan, month, year);
    const totalCost    = rawMaterials.reduce((s, m) => s + m.total_cost, 0);
    const costPerUnit  = qty > 0 ? totalCost / qty : 0;

    const missingCosts = rawMaterials.filter((r) => r.cost_source === "not_found").length;

    return NextResponse.json({
      plan_id:      plan.id,
      plan_no:      plan.id,
      finished_id:  finishedId,
      finished_item: plan.item?.item || "",
      finished_code: plan.item?.code || "",
      qty_costed:   qty,
      qty_source,
      qty_t8:           t8Qty,
      qty_actual_yield: plan.actual_yield || 0,
      qty_planned:      plan.qty          || 0,
      total_cost:   totalCost,
      cost_per_unit: costPerUnit,
      missing_cost_items: missingCosts,
      raw_materials: rawMaterials,
      already_costed: plan.costEntries.length > 0,
      cost_entry:   plan.costEntries[0] || null, // line 1; cost_entries = every production item
      cost_entries: plan.costEntries,
    });
  } catch (error) {
    console.error("BOM cost explosion error:", error);
    return NextResponse.json(
      { error: "Failed to calculate BOM cost: " + error.message },
      { status: 500 }
    );
  }
});
