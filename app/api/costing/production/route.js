import prisma from "@/lib/prisma";
import { getOpeningOne, openingSql } from "@/lib/openingStock";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { isPeriodLocked } from "@/lib/periodLock";
import { getAccount, requireAccountGroup } from "@/lib/accounts/accountSettings";
import { getProductionSetup, isFinishedCategory, isSemiFinishedCategory } from "@/lib/production/setup";
import { getIssueRates, isBlendedCosting } from "@/lib/costing/issueRate";
import { ccCategoryIdsFor } from "@/lib/costing/ccPolicy";
import { getStockActivityWithRateReport } from "@/app/api/reports/[reportType]/route";

// ─────────────────────────────────────────────────────────────────────────────
// CC RATE: shared overhead pool ÷ total finished-goods qty (ic_id=1) from T8
// Uses T8 receipt qty (not PCE qty) so the rate can be computed before costing.
// Overhead pool = net expense of the 'Conversion Overhead Accounts' main
// accounts (Finance → Account Settings, required — 422 while empty), excluding
// the 'conversion_cost' account the COGM journal credits (when set).
// ─────────────────────────────────────────────────────────────────────────────
async function _calcCcRateForPeriod(month, year) {
  const dateFrom = new Date(year, month - 1, 1);
  const dateTo   = new Date(year, month, 0, 23, 59, 59);
  const overheadMacnos = await requireAccountGroup("conversion_overheads");
  const conversionCostAcno = await getAccount("conversion_cost");
  // Categories that receive CC this month: Settings → Production setup
  // "Finished goods", plus "Semi finished" while the feature
  // costing.semiFinishedCC applies (lib/costing/ccPolicy.js). The denominator
  // must cover every category that receives CC, or the pool is absorbed twice.
  const finishedCategoryIds = await ccCategoryIdsFor(month, year);

  const ccRows = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(t.damt), 0) AS total_damt,
      COALESCE(SUM(t.camt), 0) AS total_camt
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    JOIN "acno" a ON t.acno = a.acno
    WHERE a.macno = ANY(${overheadMacnos}::int[])
      ${conversionCostAcno != null ? Prisma.sql`AND a.acno <> ${conversionCostAcno}` : Prisma.empty}
      AND tm.dated >= ${dateFrom}
      AND tm.dated <= ${dateTo}
  `;
  const cc_total = Math.max(0,
    Number(ccRows[0]?.total_damt || 0) - Number(ccRows[0]?.total_camt || 0)
  );
  if (cc_total === 0) return 0;

  // Denominator: total finished-goods (ic_id=1) produced this period via T8
  const fgRows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(t.qty), 0) AS total_qty
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    JOIN "Item" i ON i.itcd = t.itcd
    WHERE tm.tran_code = 8
      AND tm.dated >= ${dateFrom}
      AND tm.dated <= ${dateTo}
      AND tm.rmk4 IS DISTINCT FROM 'M2M'
      AND t.sub_tran_id = 1
      AND t.qty > 0
      AND i.ic_id IN (${Prisma.join(finishedCategoryIds.length ? finishedCategoryIds : [-1])})
  `;
  const total_fg_qty = Number(fgRows[0]?.total_qty || 0);
  // const total_fg_qty = 142520.13;

  return total_fg_qty > 0 ? cc_total / total_fg_qty : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// COST PRIORITY CHAIN
// 1. ProductionCostEntry for this item this period  (semi-finished produced this month)
// 2. MonthlyOpeningRate.opening_rate
// 3. Weighted-avg purchase rate up to end of period
// ─────────────────────────────────────────────────────────────────────────────
async function getItemUnitCost(itemId, month, year, ccInclusive = false) {
  // 1. Was this item produced this period and already costed?
  //    Use pce.itcd directly — no need to join PPM.
  const prodEntry = await prisma.productionCostEntry.findFirst({
    where: { month, year, itcd: itemId },
    orderBy: { calculated_at: "desc" },
    select: { actual_cost_per_unit: true, cost_per_unit: true },
  });
  if (prodEntry) {
    // ccInclusive: prefer cost_per_unit (carries CC) so a finished-good input's
    // overhead flows into the semi being produced. Default strips CC via actual.
    const cost = ccInclusive
      ? Number(prodEntry.cost_per_unit ?? prodEntry.actual_cost_per_unit ?? 0)
      : Number(prodEntry.actual_cost_per_unit ?? prodEntry.cost_per_unit ?? 0);
    if (cost > 0) return { unitCost: cost, source: "production_cost_entry" };
  }

  // 2. Weighted average = (opening_qty × opening_rate + period purchase damt) / (opening_qty + period purchase qty)
  //    Opening qty is summed across all godowns (lib/openingStock.js).
  const os = await getOpeningOne(month, year, itemId);

  const opening_qty   = Number(os?.opening_qty  || 0);
  const opening_rate  = Number(os?.opening_rate || 0);
  const opening_value = opening_qty * opening_rate;

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfPeriod  = new Date(year, month, 0, 23, 59, 59);

  const rows = await prisma.$queryRaw`
    SELECT
    COALESCE(SUM(CASE WHEN tm.tran_code = 4 THEN t.damt
                      WHEN tm.tran_code = 9 THEN -t.camt
                      ELSE 0 END), 0) AS total_amt,
    COALESCE(SUM(CASE WHEN tm.tran_code = 4 THEN t.qty
                      WHEN tm.tran_code = 9 THEN -t.qty
                      ELSE 0 END), 0) AS total_qty
  FROM "Transactions" t
  JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
  WHERE t.itcd        = ${itemId}
    AND tm.tran_code  IN (4, 9)
    AND tm.dated     >= ${startOfMonth}
    AND tm.dated     <= ${endOfPeriod}
    AND t.sub_tran_id = 1
    AND t.qty         > 0
  `;
  const p           = rows?.[0];
  const purch_qty   = Number(p?.total_qty || 0);
  const purch_amt   = Number(p?.total_amt || 0);

  const total_qty   = opening_qty + purch_qty;
  const total_value = opening_value + purch_amt;

  if (total_qty > 0 && total_value > 0) {
    return {
      unitCost: total_value / total_qty,
      source: purch_qty > 0 ? "weighted_avg" : "opening_stock",
    };
  }

  return { unitCost: 0, source: "not_found" };
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN MATERIALS
// Reads productionPlanDetail (the actual material list on this plan) and
// assigns rates in ic_id order:
//   ic_id=2 (semi-finished): ProductionCostEntry this period → opening rate
//   ic_id=3 (raw material):  weighted avg = (opening×rate + period purchases) / qty
// sequencePlans() ensures SF plans are costed before FG/mixed plans so
// their ProductionCostEntry is available when getPlanMaterials is called.
// ─────────────────────────────────────────────────────────────────────────────
async function getPlanMaterials(plan, month, year, ccInclusive = false) {
  if (await isBlendedCosting()) return getPlanMaterialsBlended(plan, month, year);
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
      // Aggregate ALL of this material's PCEs for the month (not just the most
      // recent findFirst) so the theoretical rate matches getActualIssuances'
      // production_rates weighted average. Using a single findFirst caused a
      // phantom theoretical-vs-actual variance whenever a semi was produced in
      // several batches at different rates.
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
      // Raw material (ic_id=3) or other: weighted average (opening + period purchases).
      // ccInclusive (output is a semi made from a finished good) → value produced
      // finished-good inputs at their CC-inclusive rate so CC carries into the semi.
      const { unitCost: uc, source } = await getItemUnitCost(d.material_id, month, year, ccInclusive);
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

// Settings → Features "costing.method" = blendedCC: every material (raw or
// produced) is valued at the month's issue rate — the rate the Stock Activity
// With Rate report issues it at (lib/costing/issueRate.js) — so the COGM JV
// credits each material exactly what the stock report issues.
async function getPlanMaterialsBlended(plan, month, year) {
  const details = await prisma.productionPlanDetail.findMany({
    where:   { plan_id: plan.id },
    include: { item: { select: { itcd: true, item: true, code: true, unit: true, ic_id: true } } },
    orderBy: { sno: "asc" },
  });
  const rates = await getIssueRates({
    month, year,
    itcds: details.map((d) => d.material_id),
    computeMonth: getStockActivityWithRateReport,
  });
  const merged = new Map();
  for (const d of details) {
    if (!d.material_id) continue;
    const materialQty = Number(d.material_qty || 0);
    if (materialQty <= 0) continue;
    const { rate: unitCost = 0, source: costSource = "not_found" } = rates.get(Number(d.material_id)) || {};
    const thisCost = materialQty * unitCost;
    if (merged.has(d.material_id)) {
      const ex = merged.get(d.material_id);
      ex.qty += materialQty;
      ex.total_cost += thisCost;
      ex.unit_cost = ex.qty > 0 ? ex.total_cost / ex.qty : ex.unit_cost;
    } else {
      merged.set(d.material_id, {
        material_id: d.material_id,
        material_name: d.item?.item || `Item #${d.material_id}`,
        material_code: d.item?.code || "",
        unit: d.item?.unit || "",
        ic_id: d.item?.ic_id,
        is_raw_material: true,
        bom_level: 0,
        qty: materialQty,
        unit_cost: unitCost,
        total_cost: thisCost,
        cost_source: costSource,
      });
    }
  }
  return [...merged.values()];
}

// blendedCC: issued qty per material valued at the same issue rate as above,
// so the variance is a pure quantity difference.
async function getActualIssuancesBlended(planId, month, year) {
  const dateFrom = new Date(year, month - 1, 1);
  const dateTo   = new Date(year, month, 0, 23, 59, 59);
  const issued = await prisma.$queryRaw`
    SELECT t.itcd, i.item AS item_name, i.code AS item_code, i.unit, SUM(t.qty) AS actual_qty
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    LEFT JOIN "Item" i ON i.itcd = t.itcd
    WHERE tm.tran_code = 7
      AND tm.dated >= ${dateFrom}
      AND tm.dated <= ${dateTo}
      AND tm.rmk5 = ${String(planId)}
      AND t.sub_tran_id = 1
      AND t.qty > 0
    GROUP BY t.itcd, i.item, i.code, i.unit
  `;
  const rates = await getIssueRates({
    month, year,
    itcds: issued.map((r) => r.itcd),
    computeMonth: getStockActivityWithRateReport,
  });
  const map = new Map();
  for (const r of issued) {
    const unit_cost = rates.get(Number(r.itcd))?.rate || 0;
    const actual_qty = Number(r.actual_qty || 0);
    map.set(Number(r.itcd), {
      item_name: r.item_name || "",
      item_code: r.item_code || "",
      unit: r.unit || "",
      actual_qty,
      unit_cost,
      actual_cost: actual_qty * unit_cost,
    });
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET ACTUAL ISSUANCES for a plan (tran_code=7, rmk5 = plan_id string)
// Returns Map: itcd → { item_name, item_code, unit, actual_qty, unit_cost, actual_cost }
// ─────────────────────────────────────────────────────────────────────────────
async function getActualIssuances(planId, month, year, ccInclusive = false) {
  if (await isBlendedCosting()) return getActualIssuancesBlended(planId, month, year);
  const dateFrom   = new Date(year, month - 1, 1);
  const dateTo     = new Date(year, month, 0, 23, 59, 59);

  // Rate for a produced-item input. ccInclusive (output is a semi made from a
  // finished good) → prefer cost_per_unit (carries CC) so overhead flows into the
  // semi. Default prefers actual_cost_per_unit (CC stripped, current behaviour).
  const pceRate = ccInclusive
    ? Prisma.sql`COALESCE(pce.cost_per_unit, pce.actual_cost_per_unit, 0)`
    : Prisma.sql`COALESCE(pce.actual_cost_per_unit, pce.cost_per_unit, 0)`;

  // ── Rate formula: weighted average = (opening_qty × opening_rate + period_purchase_damt)
  //                                    / (opening_qty + period_purchase_qty)
  // This is IDENTICAL to getItemUnitCost() so that theoretical and actual costs are
  // valued at the same rate — the variance then reflects pure quantity differences.
  // Previously used COALESCE(opening_rate, all-time-avg) which caused a rate mismatch.
  const rows = await prisma.$queryRaw`
    WITH opening AS (${openingSql(month, year)}),
    purch AS (
  SELECT t2.itcd,
    COALESCE(SUM(CASE WHEN tm2.tran_code = 4 THEN t2.damt
                      WHEN tm2.tran_code = 9 THEN -t2.camt
                      ELSE 0 END), 0) AS total_amt,
    COALESCE(SUM(CASE WHEN tm2.tran_code = 4 THEN t2.qty
                      WHEN tm2.tran_code = 9 THEN -t2.qty
                      ELSE 0 END), 0) AS total_qty
  FROM  "Transactions" t2
  JOIN  "TRANSACTIONS_MASTER" tm2 ON t2.tran_id = tm2.tran_id
  WHERE tm2.tran_code IN (4, 9)
    AND tm2.dated >= ${dateFrom}
    AND tm2.dated <= ${dateTo}
    AND t2.qty > 0
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
    )
    SELECT
      t.itcd,
      i.item  AS item_name,
      i.code  AS item_code,
      i.unit,
      SUM(t.qty)                             AS actual_qty,
      COALESCE(fr.avg_rate, 0)               AS unit_cost,
      SUM(t.qty) * COALESCE(fr.avg_rate, 0)  AS actual_cost
    FROM  "TRANSACTIONS_MASTER" tm
    JOIN  "Transactions" t  ON t.tran_id = tm.tran_id
    LEFT JOIN "Item"    i   ON i.itcd    = t.itcd
    LEFT JOIN final_rates fr ON fr.itcd  = t.itcd
    WHERE tm.tran_code = 7
      AND tm.dated >= ${dateFrom}
      AND tm.dated <= ${dateTo}
      AND tm.rmk5 = ${String(planId)}
      AND t.sub_tran_id = 1
      AND t.qty > 0
    GROUP BY t.itcd, i.item, i.code, i.unit, COALESCE(fr.avg_rate, 0)
  `;

  const map = new Map();
  for (const r of rows) {
    map.set(Number(r.itcd), {
      item_name:   r.item_name   || "",
      item_code:   r.item_code   || "",
      unit:        r.unit        || "",
      actual_qty:  Number(r.actual_qty  || 0),
      unit_cost:   Number(r.unit_cost   || 0),
      actual_cost: Number(r.actual_cost || 0),
    });
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6-STEP SEQUENCING + ITEM TYPE CLASSIFICATION
//
// Costing must always follow dependency order so that when a plan is costed,
// all semi-finished inputs it consumes are already costed and available via
// the ProductionCostEntry priority chain.
//
// Processing steps (Kahn's topological sort enforces this automatically):
//   Step 1: raw_material        — leaf costs from opening stock / purchases (no plan)
//   Step 2: semi_finished_l1   — consumed by other plans; BOM = raw materials only
//   Step 3: semi_finished_lN   — consumed by other plans; BOM uses other produced items
//   Step 4: semi_finished_lN   — (same type) consumes other semi-finished
//   Step 5: semi_finished_other — consumed by others but no BOM defined
//   Step 6: finished_good/mixed — not consumed by any other plan this period
//
// ⚠ CRITICAL: consumedByOther MUST be built before Kahn's algorithm runs,
//   because Kahn's mutates the working dep-sets to empty. Building it after
//   Kahn's would make consumedByOther always empty → all plans = finished_good.
// ─────────────────────────────────────────────────────────────────────────────
async function sequencePlans(plans) {
  if (!plans.length) return { sortedIds: [], itemTypes: new Map() };

  // Map: finished_id → plan.id  (items being produced this period)
  const itemToPlan = new Map();
  for (const p of plans) {
    if (p.finished_id) itemToPlan.set(p.finished_id, p.id);
  }

  const planBOMSet   = new Map(); // plan.id → Set<material_id>  (direct BOM inputs)
  const planDepsFull = new Map(); // plan.id → Set<plan.id>      (immutable — used for classification)

  for (const plan of plans) {
    // Use productionPlanDetail for dependency mapping — this is the actual
    // material list entered on the plan, matching the new cost calculation strategy.
    const planDets = await prisma.productionPlanDetail.findMany({
      where:  { plan_id: plan.id },
      select: { material_id: true },
    });
    const matIds = new Set(planDets.map((d) => d.material_id).filter(Boolean));
    planBOMSet.set(plan.id, matIds);

    const deps = new Set();
    for (const matId of matIds) {
      const depPlanId = itemToPlan.get(matId);
      if (depPlanId && depPlanId !== plan.id) deps.add(depPlanId);
    }
    planDepsFull.set(plan.id, deps);
  }

  // ── A. Build consumedByOther BEFORE Kahn's mutates working deps ──────────────
  // This identifies which plan IDs are referenced as inputs by other plans.
  const consumedByOther = new Set();
  for (const [, deps] of planDepsFull) {
    for (const dep of deps) consumedByOther.add(dep);
  }

  // ── B. Kahn's topological sort — work on a COPY so planDepsFull stays intact ─
  const workDeps = new Map(
    [...planDepsFull.entries()].map(([id, s]) => [id, new Set(s)])
  );
  const inDegree = new Map(plans.map((p) => [p.id, workDeps.get(p.id)?.size ?? 0]));
  const queue    = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    const current = queue.shift();
    sorted.push(current);
    for (const [planId, deps] of workDeps) {
      if (deps.has(current)) {
        deps.delete(current);
        const newDeg = (inDegree.get(planId) ?? 1) - 1;
        inDegree.set(planId, newDeg);
        if (newDeg === 0) queue.push(planId);
      }
    }
  }
  // Circular-dep plans → append at end (costing is approximate for circular BOMs)
  const sortedSet = new Set(sorted);
  for (const p of plans) {
    if (!sortedSet.has(p.id)) sorted.push(p.id);
  }

  // ── C. Classify each plan into one of 6 types ─────────────────────────────
  const itemTypes = new Map();
  for (const plan of plans) {
    const matIds     = planBOMSet.get(plan.id) || new Set();
    const consumesSF = [...matIds].some((m) => itemToPlan.has(m)); // BOM has produced inputs
    const isConsumed = consumedByOther.has(plan.id);               // output used by another plan
    const hasBOM     = matIds.size > 0;

    let type;
    if (isConsumed && !hasBOM) {
      // Consumed by others but no BOM defined → can't determine inputs
      type = "semi_finished_other";   // Step 5
    } else if (isConsumed && !consumesSF) {
      // Consumed by others, BOM = raw materials only → base of the chain
      type = "semi_finished_l1";      // Step 2
    } else if (isConsumed && consumesSF) {
      // Consumed by others AND consumes other produced items → mid-chain
      type = "semi_finished_lN";      // Steps 3–4
    } else if (!isConsumed && consumesSF) {
      // Final product that assembles semi-finished sub-productions
      type = "mixed";                 // Step 6 (mixed finished good)
    } else {
      // Not consumed by any other plan; BOM = raw only or no BOM → pure final product
      type = "finished_good";         // Step 6
    }

    itemTypes.set(plan.id, type);
  }

  return { sortedIds: sorted, itemTypes };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/costing/production?month=&year=&search=&status=&itcd=&code=&page=&limit=
// Source of truth: T8 (tran_code=8) receipts for the period, grouped by
// (finished_id × plan_id_raw).  A row is plan-linked when its rmk5 resolves
// to an existing Posted productionPlanMaster record; otherwise it is orphan.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month     = parseInt(searchParams.get("month")  || new Date().getMonth() + 1);
    const year      = parseInt(searchParams.get("year")   || new Date().getFullYear());
    const search    = searchParams.get("search") || "";
    const status    = searchParams.get("status") || "all";
    const itcdParam = searchParams.get("itcd") ? parseInt(searchParams.get("itcd")) : null;
    const codeParam = searchParams.get("code") || "";
    const page      = Math.max(1, parseInt(searchParams.get("page")  || "1"));
    const limit     = Math.min(100, Math.max(5, parseInt(searchParams.get("limit") || "30")));

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0, 23, 59, 59);

    const periodLocked = await isPeriodLocked(month, year);

    // ── 1. ALL T8 receipt groups for the period (primary source) ─────────────
    // Grouped by (itcd, plan_id_raw) so each unique item×plan pairing is one row.
    // rmk5 stores the plan_id as a numeric string; empty/null → orphan.
    const t8Groups = await prisma.$queryRaw`
      SELECT
        t.itcd                                                                  AS finished_id,
        i.item                                                                  AS finished_item,
        i.code                                                                  AS finished_code,
        i.unit,
        COALESCE(SUM(t.qty), 0)                                                 AS receipt_qty,
        MIN(tm.tran_id)                                                         AS first_tran_id,
        NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5,''),'[^0-9]','','g'),'')::integer AS plan_id_raw,
        MIN(tm.dated)                                                           AS first_date,
        MAX(tm.dated)                                                           AS last_date,
        COUNT(DISTINCT tm.tran_id)                                              AS tran_count
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t  ON t.tran_id = tm.tran_id
      LEFT JOIN "Item"    i  ON i.itcd    = t.itcd
      WHERE tm.tran_code  = 8
        AND tm.dated     >= ${startDate}
        AND tm.dated     <= ${endDate}
        AND t.sub_tran_id = 1
        AND t.qty         > 0
      GROUP BY t.itcd, i.item, i.code, i.unit,
               NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5,''),'[^0-9]','','g'),'')::integer
      ORDER BY i.item ASC, plan_id_raw ASC NULLS LAST
    `;

    if (t8Groups.length === 0) {
      return NextResponse.json({
        plans: [], orphan_productions: [],
        total: 0, costed: 0, not_costed: 0, orphan_count: 0,
        page: 1, limit, totalPages: 0,
        period_locked: periodLocked,
      });
    }

    // ── 2. Resolve plan data for plan-linked T8 groups ────────────────────────
    const candidatePlanIds = [
      ...new Set(t8Groups.map(r => r.plan_id_raw).filter(Boolean).map(Number))
    ];
    const existingPlans = candidatePlanIds.length > 0
      ? await prisma.productionPlanMaster.findMany({
          where:   { id: { in: candidatePlanIds }, status: "Posted" },
          include: {
            item: { select: { itcd: true, item: true, code: true, unit: true } },
            costEntry: {
              select: {
                id: true, total_cost: true, cost_per_unit: true,
                theoretical_cost: true, theoretical_cost_per_unit: true,
                actual_issued_cost: true, actual_issued_qty: true,
                actual_cost_per_unit: true, wastage_cost: true,
                cost_variance: true, item_type: true, bom_depth: true,
                calculated_at: true, calculated_by: true,
              },
            },
          },
        })
      : [];
    const planById      = new Map(existingPlans.map(p => [p.id, p]));
    const postedPlanIds = new Set(existingPlans.map(p => p.id));

    // ── 3. Orphan PCEs (plan_id = null, keyed by itcd) ───────────────────────
    const allFinishedIds = [...new Set(t8Groups.map(r => Number(r.finished_id)).filter(Boolean))];
    const orphanPces = allFinishedIds.length > 0
      ? await prisma.productionCostEntry.findMany({
          where:  { month, year, plan_id: null, itcd: { in: allFinishedIds } },
          select: {
            id: true, itcd: true, total_cost: true, cost_per_unit: true,
            actual_cost_per_unit: true, qty_costed: true,
            calculated_at: true, calculated_by: true,
          },
        })
      : [];
    const orphanPceMap = new Map(orphanPces.map(e => [Number(e.itcd), e]));

    // ── 4. Build unified row list (plan-linked + orphan) ──────────────────────
    const allRows = t8Groups.map(r => {
      const finishedId = Number(r.finished_id);
      const planIdRaw  = r.plan_id_raw != null ? Number(r.plan_id_raw) : null;
      const isOrphan   = planIdRaw === null || !postedPlanIds.has(planIdRaw);
      const plan       = isOrphan ? null : planById.get(planIdRaw);
      const receiptQty = Number(r.receipt_qty || 0);

      if (isOrphan) {
        const pce = orphanPceMap.get(finishedId) || null;
        return {
          id:            `orphan_${finishedId}_${planIdRaw ?? "x"}`,
          dated:         r.first_date,
          finished_id:   finishedId,
          finished_item: r.finished_item || `Item #${finishedId}`,
          finished_code: r.finished_code || "",
          unit:          r.unit || "",
          planned_qty:   0,
          actual_yield:  0,
          actual_production_qty: receiptQty,
          status:        "no_plan",
          batch_no:      null,
          is_costed:     pce != null,
          cost_entry:    pce ? {
            id:                  pce.id,
            total_cost:          Number(pce.total_cost || 0),
            cost_per_unit:       Number(pce.cost_per_unit || 0),
            actual_cost_per_unit: pce.actual_cost_per_unit ? Number(pce.actual_cost_per_unit) : null,
            calculated_at:       pce.calculated_at,
            calculated_by:       pce.calculated_by,
          } : null,
          is_orphan:     true,
          tran_id:       Number(r.first_tran_id || 0),
          rmk5:          planIdRaw != null ? String(planIdRaw) : null,
          first_date:    r.first_date,
          last_date:     r.last_date,
          tran_count:    Number(r.tran_count || 1),
        };
      } else {
        return {
          id:            plan.id,
          dated:         r.first_date,
          finished_id:   finishedId,
          finished_item: plan.item?.item || r.finished_item || `Item #${finishedId}`,
          finished_code: plan.item?.code || r.finished_code || "",
          unit:          plan.item?.unit || r.unit || "",
          planned_qty:   Number(plan.qty || 0),
          actual_yield:  Number(plan.actual_yield || 0),
          actual_production_qty: receiptQty,
          status:        plan.status,
          batch_no:      plan.batch_no || null,
          is_costed:     !!plan.costEntry,
          cost_entry:    plan.costEntry || null,
          is_orphan:     false,
          tran_id:       Number(r.first_tran_id || 0),
          rmk5:          String(planIdRaw),
          first_date:    r.first_date,
          last_date:     r.last_date,
          tran_count:    Number(r.tran_count || 1),
        };
      }
    });

    // ── 5. Summary counts (plan-linked rows only; orphans tracked separately) ─
    const planLinkedRows  = allRows.filter(r => !r.is_orphan);
    const orphanRowsAll   = allRows.filter(r =>  r.is_orphan);
    const fullMonthTotal  = planLinkedRows.length;
    const fullMonthCosted = planLinkedRows.filter(r => r.is_costed).length;

    // ── 6. In-memory filters ──────────────────────────────────────────────────
    let filtered = allRows;
    if (itcdParam) {
      filtered = filtered.filter(r => r.finished_id === itcdParam);
    }
    if (codeParam) {
      const lc = codeParam.toLowerCase();
      filtered = filtered.filter(r => (r.finished_code || "").toLowerCase().includes(lc));
    }
    if (search) {
      const lc    = search.toLowerCase();
      const numId = parseInt(search);
      filtered = filtered.filter(r =>
        (r.finished_item || "").toLowerCase().includes(lc) ||
        (r.finished_code || "").toLowerCase().includes(lc) ||
        (!isNaN(numId) && r.id === numId)
      );
    }
    if (status === "costed")     filtered = filtered.filter(r => r.is_costed);
    if (status === "not_costed") filtered = filtered.filter(r => !r.is_costed);

    // ── 7. Paginate ───────────────────────────────────────────────────────────
    const filteredTotal = filtered.length;
    const totalPages    = Math.max(1, Math.ceil(filteredTotal / limit));
    const offset        = (page - 1) * limit;
    const paginatedRows = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      plans:              paginatedRows,
      orphan_productions: orphanRowsAll.map(op => ({
        itcd:         op.finished_id,
        tran_id:      op.tran_id,
        dated:        op.dated,
        rmk5:         op.rmk5,
        receipt_qty:  op.actual_production_qty,
        receipt_damt: 0,
        unit_cost:    0,
        item_name:    op.finished_item,
        item_code:    op.finished_code,
        unit:         op.unit,
      })),
      total:        fullMonthTotal,
      costed:       fullMonthCosted,
      not_costed:   fullMonthTotal - fullMonthCosted,
      orphan_count: orphanRowsAll.length,
      page,
      limit,
      totalPages,
      period_locked: periodLocked,
    });
  } catch (error) {
    console.error("Production costing GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET ACTUAL PRODUCTION QTY for a plan from tran_code=8 (production receipt)
// tran_code=8 transactions have the produced item in Transactions.itcd and
// the plan ID stored in TransactionsMaster.rmk5 (numeric string).
// This is more reliable than productionPlanMaster.actual_yield (which is
// filled from the form and may be left at planned qty or 0).
// ─────────────────────────────────────────────────────────────────────────────
async function getActualProductionQty(planId, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0, 23, 59, 59);

  const rows = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(t.qty), 0) AS actual_qty,
      MIN(t.itcd)             AS itcd        -- produced item from T8 (source of truth)
    FROM  "TRANSACTIONS_MASTER" tm
    JOIN  "Transactions" t ON t.tran_id = tm.tran_id
    WHERE tm.tran_code = 8
      AND tm.dated >= ${startDate}
      AND tm.dated <= ${endDate}
      AND tm.rmk5 = ${String(planId)}
      AND t.sub_tran_id = 1
      AND t.qty > 0
  `;
  return {
    qty:  Number(rows?.[0]?.actual_qty || 0),
    itcd: rows?.[0]?.itcd != null ? Number(rows[0].itcd) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE: cost one plan (theoretical + actual) and persist
// ─────────────────────────────────────────────────────────────────────────────
async function costOnePlan(plan, month, year, calculatedBy, itemType, ccRatePerUnit = 0) {
  // ── 0. Determine actual production qty AND finished item from T8 ──────────
  // T8 transaction is the source of truth:
  //   - t.itcd   → the item that was actually received into stock
  //   - SUM(qty) → how much was produced
  // Fall back to plan fields only when there are no T8 receipts yet.
  const { qty: tran8Qty, itcd: tran8Itcd } = await getActualProductionQty(plan.id, month, year);
  const qty        = tran8Qty  > 0 ? tran8Qty  : (plan.actual_yield || plan.qty || 0);
  const finishedId = tran8Itcd ?? plan.finished_id;  // prefer T8 itcd over plan

  if (!finishedId || qty <= 0) throw new Error("No finished item or zero quantity");

  const finishedItem = await prisma.item.findUnique({
  where: { itcd: finishedId },
  select: { ic_id: true },
});

// ── Check if this plan's T8 receipt is tagged M2M (rmk4='M2M') ──────────
// M2M productions are machine-to-machine transfers and must NOT carry CC overhead.
const t8M2MCheck = await prisma.transactionsMaster.findFirst({
  where: {
    tran_code: 8,
    rmk5: String(plan.id),
    rmk4: "M2M",
  },
  select: { tran_id: true },
});
const isM2M = t8M2MCheck !== null;

  // ── 1:1 conversion rule ───────────────────────────────────────────────────
  // When this plan PRODUCES a semi-finished (ic_id=2) it may ISSUE a finished
  // good (ic_id=1) that carries CC (e.g. converting a finished item back to
  // semi). Value those finished-good inputs at their CC-inclusive rate so the
  // overhead travels into the semi instead of being stripped. The semi output
  // itself gets no CC (ic_id=2), so there is no double-count.
  const setup = await getProductionSetup();
  const ccInclusive = isSemiFinishedCategory(setup, finishedItem?.ic_id);

  // ── 1. Theoretical cost from productionPlanDetail ─────────────────────────
  // Uses the actual material list on this plan (not BomMaster).
  // SF materials (ic_id=2) use ProductionCostEntry (sequenced first).
  // RM materials (ic_id=3) use weighted-average rate.
  const rawMaterials       = await getPlanMaterials(plan, month, year, ccInclusive);
  const theoreticalCost    = rawMaterials.reduce((s, m) => s + m.total_cost, 0);
  const theoreticalPerUnit = qty > 0 ? theoreticalCost / qty : 0;

  // ── 2. Actual cost from tran_code=7 issuances linked via rmk5 ─────────────
  const issuanceMap     = await getActualIssuances(plan.id, month, year, ccInclusive);
  let actualIssuedCost  = 0;
  let actualIssuedQty   = 0;
  for (const iss of issuanceMap.values()) {
    actualIssuedCost += iss.actual_cost;
    actualIssuedQty  += iss.actual_qty;
  }

  // ── 3. Wastage = materials issued beyond BOM expectation ──────────────────
  let wastageCost = 0;
  for (const rm of rawMaterials) {
    const iss = issuanceMap.get(rm.material_id);
    if (iss && iss.actual_qty > rm.qty) {
      wastageCost += (iss.actual_qty - rm.qty) * iss.unit_cost;
    }
  }
  // Materials issued with NO BOM entry are entirely wastage / unexpected
  for (const [itcd, iss] of issuanceMap) {
    if (!rawMaterials.some((r) => r.material_id === itcd)) {
      wastageCost += iss.actual_cost;
    }
  }

  const costVariance    = actualIssuedCost - theoreticalCost;
  const effectiveCost   = actualIssuedCost > 0 ? actualIssuedCost : theoreticalCost;
  const effectivePerUnit = qty > 0 ? effectiveCost / qty : 0;
  const actualPerUnit    = actualIssuedCost > 0 && qty > 0 ? actualIssuedCost / qty : null;

  // ── CC overhead: applied only when the produced item's category receives CC
  // this month (finished goods; + semi-finished per costing.semiFinishedCC) ─
  const ccCategoryIds = await ccCategoryIdsFor(month, year);
  const isFG   = ccCategoryIds.includes(Number(finishedItem?.ic_id)) && !isM2M;
  const ccRate = isFG ? (ccRatePerUnit || 0) : 0;
  const ccCost = ccRate * qty;

  // ── 4. Build merged detail rows (BOM materials + actual issuances) ─────────
  const detailRows = rawMaterials.map((rm) => {
    const iss         = issuanceMap.get(rm.material_id);
    const actual_qty  = iss?.actual_qty  ?? null;
    const actual_cost = iss?.actual_cost ?? null;
    return {
      material_id:     rm.material_id,
      material_name:   rm.material_name || "",
      material_code:   rm.material_code || "",
      bom_level:       rm.bom_level,
      is_raw_material: true,
      qty:             rm.qty,
      unit_cost:       rm.unit_cost,
      total_cost:      rm.total_cost,
      cost_source:     rm.cost_source,
      actual_qty,
      actual_cost,
      actual_unit_cost: actual_qty > 0 ? actual_cost / actual_qty : null,
      variance_qty:  actual_qty  != null ? actual_qty  - rm.qty        : null,
      variance_cost: actual_cost != null ? actual_cost - rm.total_cost : null,
    };
  });

  // Materials issued that are NOT in the BOM
  for (const [itcd, iss] of issuanceMap) {
    if (!rawMaterials.some((r) => r.material_id === itcd)) {
      detailRows.push({
        material_id:     itcd,
        material_name:   iss.item_name,
        material_code:   iss.item_code,
        bom_level:       0,
        is_raw_material: true,
        qty:             0,
        unit_cost:       iss.unit_cost,
        total_cost:      0,
        cost_source:     "not_in_bom",
        actual_qty:      iss.actual_qty,
        actual_cost:     iss.actual_cost,
        actual_unit_cost: iss.actual_qty > 0 ? iss.actual_cost / iss.actual_qty : null,
        variance_qty:    iss.actual_qty,
        variance_cost:   iss.actual_cost,
      });
    }
  }

  // ── 5. Persist ────────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    await tx.productionCostEntry.deleteMany({ where: { plan_id: plan.id } });
    await tx.productionCostEntry.create({
      data: {
        plan_id:    plan.id,
        itcd:       finishedId,   // from T8 transaction (t.itcd) — source of truth, not plan
        month,
        year,
        qty_costed: qty,

        // Primary (backward compat) — prefer actual when available; CC included for FG
        total_cost:    effectiveCost + ccCost,

        //CHANGED cost_per_unit: effectivePerUnit + ccRate,
        cost_per_unit: effectivePerUnit + ccRate,
        // Theoretical
        theoretical_cost:           theoreticalCost,
        theoretical_cost_per_unit:  theoreticalPerUnit,

        // Actual
        actual_issued_cost:   actualIssuedCost  > 0 ? actualIssuedCost  : null,
        actual_issued_qty:    actualIssuedQty   > 0 ? actualIssuedQty   : null,
       //CHANGED actual_cost_per_unit: actualPerUnit != null ? actualPerUnit + ccRate : null,
        actual_cost_per_unit: actualPerUnit != null ? actualPerUnit : null,
        wastage_cost:         wastageCost        > 0 ? wastageCost       : null,
        cost_variance:        actualIssuedCost   > 0 ? costVariance      : null,

        // CC overhead
        cc_rate: ccRate > 0 ? ccRate : null,
        cc_cost: ccCost > 0 ? ccCost : null,

        // Classification
        item_type: itemType || "finished_good",
        bom_depth: 0,

        calculated_at: new Date(),
        calculated_by: calculatedBy,

        details: { create: detailRows },
      },
    });
  });

  return {
    plan_id:            plan.id,
    finished_item:      plan.item?.item || "",
    qty_costed:         qty,
    theoretical_cost:   theoreticalCost,
    actual_issued_cost: actualIssuedCost,
    // CHANGED effective_cost:     effectiveCost + ccCost,
    // CHANGED cost_per_unit:      effectivePerUnit + ccRate,
    effective_cost:     effectiveCost,
    cost_per_unit:      effectivePerUnit,
    cc_rate:            ccRate,
    cc_cost:            ccCost,
    wastage_cost:       wastageCost,
    cost_variance:      costVariance,
    item_type:          itemType || "finished_good",
    raw_material_count: rawMaterials.length,
    has_actual_data:    actualIssuedCost > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORPHAN AUTO-BATCH
// Finds all T8 production receipts in the period where rmk5 is null/blank OR
// doesn't match a Posted productionPlanMaster row, then creates / updates an
// orphan ProductionCostEntry for each produced item.
// All unlinked T7 issuances are treated as the shared material pool and their
// cost is pro-rated across orphan T8 groups proportionally to receipt qty.
// CC overhead is applied to ic_id=1 items using the same rate as plan-based costing.
// ─────────────────────────────────────────────────────────────────────────────
async function costOrphanItems(month, year, calculatedBy, ccRatePerUnit = 0) {
  const setup = await getProductionSetup();
  const ccCategoryIds = await ccCategoryIdsFor(month, year);
  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0, 23, 59, 59);

  // 1. Orphan T8 groups: produced items with no valid Posted plan reference
  const orphanT8 = await prisma.$queryRaw`
    SELECT
      t.itcd                                                                   AS finished_id,
      i.item                                                                   AS item_name,
      i.code                                                                   AS item_code,
      i.unit,
      i.ic_id,
      COALESCE(SUM(t.qty), 0)                                                 AS receipt_qty
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t  ON t.tran_id = tm.tran_id
    LEFT JOIN "Item"    i  ON i.itcd    = t.itcd
    WHERE tm.tran_code  = 8
      AND tm.dated     >= ${startDate}
      AND tm.dated     <= ${endDate}
      AND t.sub_tran_id = 1
      AND t.qty         > 0
      AND (
        tm.rmk5 IS NULL
        OR TRIM(tm.rmk5) = ''
        OR REGEXP_REPLACE(COALESCE(tm.rmk5,''), '[^0-9]', '', 'g') = ''
        OR NOT EXISTS (
          SELECT 1 FROM "productionPlanMaster" p
          WHERE p.id = NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5,''), '[^0-9]', '', 'g'), '')::integer
            AND p.status = 'Posted'
        )
      )
    GROUP BY t.itcd, i.item, i.code, i.unit, i.ic_id
    HAVING COALESCE(SUM(t.qty), 0) > 0
  `;

  if (!orphanT8.length) return { processed: 0, skipped: 0 };

  // 2. All unlinked T7 material issuances (same orphan filter)
  const orphanT7 = await prisma.$queryRaw`
    SELECT
      t.itcd,
      i.item  AS item_name,
      i.code  AS item_code,
      COALESCE(SUM(t.qty),  0) AS actual_qty,
      COALESCE(SUM(t.damt), 0) AS actual_damt
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t  ON t.tran_id = tm.tran_id
    LEFT JOIN "Item"    i  ON i.itcd    = t.itcd
    WHERE tm.tran_code = 7
      AND tm.dated     >= ${startDate}
      AND tm.dated     <= ${endDate}
      AND t.sub_tran_id = 1
      AND t.qty         > 0
      AND (
        tm.rmk5 IS NULL
        OR TRIM(tm.rmk5) = ''
        OR REGEXP_REPLACE(COALESCE(tm.rmk5,''), '[^0-9]', '', 'g') = ''
        OR NOT EXISTS (
          SELECT 1 FROM "productionPlanMaster" p
          WHERE p.id = NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5,''), '[^0-9]', '', 'g'), '')::integer
            AND p.status = 'Posted'
        )
      )
    GROUP BY t.itcd, i.item, i.code
  `;

  const totalT7Damt = orphanT7.reduce((s, r) => s + Number(r.actual_damt || 0), 0);
  const totalT8Qty  = orphanT8.reduce((s, r) => s + Number(r.receipt_qty  || 0), 0);

  let processed = 0, skipped = 0;

  for (const t8 of orphanT8) {
    const itcd    = Number(t8.finished_id);
    const t8Qty   = Number(t8.receipt_qty || 0);
    if (t8Qty <= 0) { skipped++; continue; }

    // Pro-rate T7 cost by this item's share of total orphan T8 qty
    const costShare      = totalT8Qty > 0 ? t8Qty / totalT8Qty : 0;
    const allocT7Cost    = totalT7Damt * costShare;

    // CC overhead for finished goods only
    const isFG    = ccCategoryIds.includes(Number(t8.ic_id)); // categories receiving CC this month
    const ccCost  = isFG ? ccRatePerUnit * t8Qty : 0;
    const totalCost   = allocT7Cost + ccCost;
    const costPerUnit = t8Qty > 0 ? totalCost / t8Qty : 0;
    const matRatePerUnit = t8Qty > 0 ? allocT7Cost / t8Qty : 0;

    // Build detail rows (proportional share of each T7 material line)
    const detailRows = orphanT7
      .map(t7 => {
        const allocQty  = Number(t7.actual_qty  || 0) * costShare;
        const allocCost = Number(t7.actual_damt || 0) * costShare;
        if (allocQty <= 0) return null;
        return {
          material_id:      Number(t7.itcd),
          material_name:    t7.item_name || `Item #${t7.itcd}`,
          material_code:    t7.item_code || "",
          bom_level:        0,
          is_raw_material:  true,
          qty:              0,  // no BOM — theoretical unknown
          unit_cost:        allocQty > 0 ? allocCost / allocQty : 0,
          total_cost:       0,
          cost_source:      "orphan_t7",
          actual_qty:       allocQty,
          actual_cost:      allocCost,
          actual_unit_cost: allocQty > 0 ? allocCost / allocQty : null,
          variance_qty:     null,
          variance_cost:    null,
        };
      })
      .filter(Boolean);

    const existing = await prisma.productionCostEntry.findFirst({
      where: { itcd, month, year, plan_id: null },
    });

    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.productionCostDetail.deleteMany({ where: { entry_id: existing.id } });
        await tx.productionCostEntry.update({
          where: { id: existing.id },
          data: {
            qty_costed:          t8Qty,
            total_cost:          totalCost,
            cost_per_unit:       costPerUnit,
            actual_issued_cost:  allocT7Cost > 0 ? allocT7Cost : null,
            actual_issued_qty:   allocT7Cost > 0 ? orphanT7.reduce((s, r) => s + Number(r.actual_qty || 0) * costShare, 0) : null,
            actual_cost_per_unit: allocT7Cost > 0 ? matRatePerUnit + (isFG ? ccRatePerUnit : 0) : null,
            cc_rate:             isFG && ccRatePerUnit > 0 ? ccRatePerUnit : null,
            cc_cost:             ccCost > 0 ? ccCost : null,
            is_orphan:           true,
            item_type:           isFG ? "finished_good" : "semi_finished_l1",
            calculated_at:       new Date(),
            calculated_by:       calculatedBy,
            details:             { create: detailRows },
          },
        });
      } else {
        await tx.productionCostEntry.create({
          data: {
            plan_id:             null,
            itcd,
            month,
            year,
            qty_costed:          t8Qty,
            total_cost:          totalCost,
            cost_per_unit:       costPerUnit,
            actual_issued_cost:  allocT7Cost > 0 ? allocT7Cost : null,
            actual_issued_qty:   allocT7Cost > 0 ? orphanT7.reduce((s, r) => s + Number(r.actual_qty || 0) * costShare, 0) : null,
            actual_cost_per_unit: allocT7Cost > 0 ? matRatePerUnit + (isFG ? ccRatePerUnit : 0) : null,
            cc_rate:             isFG && ccRatePerUnit > 0 ? ccRatePerUnit : null,
            cc_cost:             ccCost > 0 ? ccCost : null,
            is_orphan:           true,
            item_type:           isFG ? "finished_good" : "semi_finished_l1",
            calculated_at:       new Date(),
            calculated_by:       calculatedBy,
            details:             { create: detailRows },
          },
        });
      }
    });
    processed++;
  }

  return { processed, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALC PERIOD CC RATE
// Total CC cost (conversion_overheads group, excl. conversion_cost) for the period ÷ total FG qty
// produced (ic_id=1) in PCE for the same period.
// Used by lock-period to embed CC overhead into finished-good opening stock.
// ─────────────────────────────────────────────────────────────────────────────
// export async function calcPeriodCcRate(month, year) {
//   const startDate = new Date(year, month - 1, 1);
//   const endDate   = new Date(year, month, 0, 23, 59, 59);

//   const ccRows = await prisma.$queryRaw`
//     SELECT
//       COALESCE(SUM(t.damt), 0) AS total_damt,
//       COALESCE(SUM(t.camt), 0) AS total_camt
//     FROM "Transactions" t
//     JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
//     JOIN "acno" a ON t.acno = a.acno
//     WHERE a.macno = 43
//       AND a.acno != 221
//       AND tm.dated >= ${startDate}
//       AND tm.dated <= ${endDate}
//   `;
//   const cc_total = Math.max(0,
//     Number(ccRows[0]?.total_damt || 0) - Number(ccRows[0]?.total_camt || 0)
//   );

//   const fgQtyRows = await prisma.$queryRaw`
//     SELECT COALESCE(SUM(pce.qty_costed), 0) AS total_qty
//     FROM "ProductionCostEntry" pce
//     JOIN "Item" i
//       ON i.itcd = COALESCE(
//         (SELECT p.finished_id FROM "productionPlanMaster" p WHERE p.id = pce.plan_id LIMIT 1),
//         pce.itcd
//       )
//     WHERE i.ic_id = 1
//       AND pce.month = ${month}
//       AND pce.year  = ${year}
//   `;
//   const total_fg_qty = Number(fgQtyRows[0]?.total_qty || 0);
//   return total_fg_qty > 0 ? cc_total / total_fg_qty : 0;
// }

// ─────────────────────────────────────────────────────────────────────────────
// AUTO ORPHAN: Cost T7 issuances that have no valid production plan link.
// Grouping: by the T7 itcd (the item that was issued).
// If an orphan T8 receipt exists for the same item, qty_costed = T8 qty.
// If no T8, qty_costed = 0 (cost captured, no finished-good qty on record).
// Creates / updates ProductionCostEntry (plan_id=null, is_orphan=true)
// and one ProductionCostDetail row summarising the T7 issuances.
// ─────────────────────────────────────────────────────────────────────────────
async function costOrphanT7Items(month, year, startDate, endDate, calculatedBy) {
  // 1. T7 issuances with null/blank rmk5 OR rmk5 that doesn't match any plan
  const orphanT7Rows = await prisma.$queryRaw`
    SELECT
      t.itcd,
      i.item  AS item_name,
      i.code  AS item_code,
      i.unit,
      SUM(t.qty)  AS total_qty,
      SUM(t.damt) AS total_damt
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t  ON t.tran_id = tm.tran_id
    LEFT JOIN "Item"    i  ON i.itcd    = t.itcd
    WHERE tm.tran_code  = 7
      AND tm.dated     >= ${startDate}
      AND tm.dated     <= ${endDate}
      AND t.sub_tran_id = 1
      AND t.qty         > 0
      AND (
        tm.rmk5 IS NULL
        OR TRIM(tm.rmk5) = ''
        OR NOT EXISTS (
          SELECT 1 FROM "productionPlanMaster" p
          WHERE REGEXP_REPLACE(COALESCE(tm.rmk5,''), '[^0-9]', '', 'g') != ''
            AND p.id::text = REGEXP_REPLACE(COALESCE(tm.rmk5,''), '[^0-9]', '', 'g')
        )
      )
    GROUP BY t.itcd, i.item, i.code, i.unit
    HAVING SUM(t.qty) > 0
  `;

  if (!orphanT7Rows.length) return { results: [], errors: [] };

  // 2. Find orphan T8 receipts for the same items
  const itcds = orphanT7Rows.map(r => Number(r.itcd)).filter(Boolean);
  const orphanT8Rows = await prisma.$queryRaw`
    SELECT t.itcd, SUM(t.qty) AS total_qty
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    WHERE tm.tran_code  = 8
      AND tm.dated     >= ${startDate}
      AND tm.dated     <= ${endDate}
      AND t.sub_tran_id = 1
      AND t.qty         > 0
      AND t.itcd        = ANY(${itcds}::int[])
      AND (
        tm.rmk5 IS NULL
        OR TRIM(tm.rmk5) = ''
        OR NOT EXISTS (
          SELECT 1 FROM "productionPlanMaster" p
          WHERE REGEXP_REPLACE(COALESCE(tm.rmk5,''), '[^0-9]', '', 'g') != ''
            AND p.id::text = REGEXP_REPLACE(COALESCE(tm.rmk5,''), '[^0-9]', '', 'g')
        )
      )
    GROUP BY t.itcd
  `;
  const t8QtyByItcd = new Map(
    orphanT8Rows.map(r => [Number(r.itcd), Number(r.total_qty || 0)])
  );

  const results = [];
  const errors  = [];

  for (const row of orphanT7Rows) {
    const itcd        = Number(row.itcd);
    const t7Qty       = Number(row.total_qty  || 0);
    const t7Cost      = Number(row.total_damt || 0);
    const t8Qty       = t8QtyByItcd.get(itcd) || 0;
    const qtyCosted   = t8Qty;
    const costPerUnit = qtyCosted > 0 ? t7Cost / qtyCosted : 0;

    try {
      const existing = await prisma.productionCostEntry.findFirst({
        where: { itcd, month, year, plan_id: null },
      });

      const pcePayload = {
        itcd,
        month,
        year,
        qty_costed:           qtyCosted,
        total_cost:           t7Cost,
        cost_per_unit:        costPerUnit,
        actual_issued_cost:   t7Cost,
        actual_issued_qty:    t7Qty,
        actual_cost_per_unit: qtyCosted > 0 ? costPerUnit : null,
        is_orphan:            true,
        item_type:            "orphan",
        calculated_at:        new Date(),
        calculated_by:        calculatedBy,
      };

      let pce;
      if (existing) {
        await prisma.productionCostDetail.deleteMany({ where: { entry_id: existing.id } });
        pce = await prisma.productionCostEntry.update({ where: { id: existing.id }, data: pcePayload });
      } else {
        pce = await prisma.productionCostEntry.create({ data: { ...pcePayload, plan_id: null } });
      }

      // One summary detail row per T7 item
      if (t7Qty > 0) {
        await prisma.productionCostDetail.create({
          data: {
            entry_id:         pce.id,
            material_id:      itcd,
            material_name:    String(row.item_name || `Item #${itcd}`),
            material_code:    String(row.item_code || ""),
            bom_level:        0,
            is_raw_material:  true,
            qty:              0,
            unit_cost:        t7Qty > 0 ? t7Cost / t7Qty : 0,
            total_cost:       0,
            cost_source:      "orphan_t7",
            actual_qty:       t7Qty,
            actual_unit_cost: t7Qty > 0 ? t7Cost / t7Qty : 0,
            actual_cost:      t7Cost,
          },
        });
      }

      results.push({
        itcd,
        item_name:    String(row.item_name || ""),
        t7_qty:       t7Qty,
        t7_cost:      t7Cost,
        t8_qty:       t8Qty,
        qty_costed:   qtyCosted,
        cost_per_unit: costPerUnit,
      });
    } catch (err) {
      errors.push({ itcd, error: err.message });
    }
  }

  return { results, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST  /api/costing/production
// Body options:
//   { plan_ids: [...], month, year }
//   { plan_id: n, month, year }
//   { auto_sequence: true, month, year }             — all plans, correct order
//   { auto_sequence: true, only_pending: true, … }   — only uncosted plans
//   { auto_orphans: true, month, year }              — orphan T7 items only
// ─────────────────────────────────────────────────────────────────────────────
export const POST = guard("costing.manage", async (request) => {
  try {
    const session      = await getServerSession(authOptions);
    const body         = await request.json();
    const month        = parseInt(body.month);
    const year         = parseInt(body.year);
    const calculatedBy = session?.user?.email || "system";

    if (!month || !year) {
      return NextResponse.json({ error: "month and year are required" }, { status: 400 });
    }

    const periodLocked = await isPeriodLocked(month, year);
    if (periodLocked) {
      return NextResponse.json(
        { error: `Costing period ${month}/${year} is locked. Unlock it first.` },
        { status: 422 }
      );
    }

    // Compute CC rate once for the period — passed to every costOnePlan call so
    // all FG/mixed items share the same overhead pool rate.
    const ccRatePerUnit = await _calcCcRateForPeriod(month, year);

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0, 23, 59, 59);

    let targetPlanIds;

    if (body.auto_sequence) {
      // Only cost plans that have actual T8 receipts in this period.
      // Plans with no production receipt are skipped — they have nothing to cost.
      const t8LinkedRows = await prisma.$queryRaw`
        SELECT DISTINCT
          NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5,''),'[^0-9]','','g'),'')::integer AS plan_id
        FROM "TRANSACTIONS_MASTER" tm
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
        WHERE tm.tran_code  = 8
          AND tm.dated     >= ${startDate}
          AND tm.dated     <= ${endDate}
          AND t.sub_tran_id = 1
          AND t.qty         > 0
          AND NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5,''),'[^0-9]','','g'),'') IS NOT NULL
      `;
      const linkedPlanIds = t8LinkedRows.map(r => Number(r.plan_id)).filter(Boolean);
      const allPlans = linkedPlanIds.length > 0
        ? await prisma.productionPlanMaster.findMany({
            where:  { id: { in: linkedPlanIds }, status: "Posted" },
            select: { id: true, finished_id: true },
          })
        : [];
      let plansList = allPlans;
      if (body.only_pending) {
        const costedIds = new Set(
          (await prisma.productionCostEntry.findMany({
            where:  { month, year },
            select: { plan_id: true },
          })).map((e) => e.plan_id)
        );
        plansList = allPlans.filter((p) => !costedIds.has(p.id));
      }
      const { sortedIds } = await sequencePlans(plansList);
      targetPlanIds = sortedIds;
    } else {
      targetPlanIds = body.plan_ids
        ? body.plan_ids.map(Number)
        : body.plan_id
        ? [parseInt(body.plan_id)]
        : [];
    }

    if (!targetPlanIds.length) {
      return NextResponse.json({ error: "No plans to cost" }, { status: 400 });
    }

    const plansData = await prisma.productionPlanMaster.findMany({
      where:   { id: { in: targetPlanIds }, status: "Posted" },
      include: { item: { select: { itcd: true, item: true, code: true } } },
    });
    const planById = new Map(plansData.map((p) => [p.id, p]));

    const simplePlans  = plansData.map((p) => ({ id: p.id, finished_id: p.finished_id }));
    const { itemTypes } = await sequencePlans(simplePlans);

    const results = [];
    const errors  = [];

    for (const planId of targetPlanIds) {
      const plan = planById.get(planId);
      if (!plan) { errors.push({ plan_id: planId, error: "Plan not found" }); continue; }
      try {
        const res = await costOnePlan(plan, month, year, calculatedBy, itemTypes.get(planId), ccRatePerUnit);
        results.push(res);
      } catch (err) {
        console.error(`Error costing plan ${planId}:`, err);
        errors.push({ plan_id: planId, error: err.message });
      }
    }

    // Auto-cost orphan productions (no plan reference):
    //  • costOrphanItems   → T8 orphan FGs with pro-rated T7 costs (FG/SF produced without plan)
    //  • costOrphanT7Items → T7-only orphans with no T8 receipt (material issued, no produced output)
    let orphanResult = null;
    if (body.auto_orphans) {
      const [t8Orphans, t7Orphans] = await Promise.all([
        costOrphanItems(month, year, calculatedBy, ccRatePerUnit),
        costOrphanT7Items(month, year, startDate, endDate, calculatedBy),
      ]);
      orphanResult = {
        t8_grouped: t8Orphans,
        t7_grouped: { processed: t7Orphans.results.length, errors: t7Orphans.errors.length },
      };
    }

    return NextResponse.json({
      success: true,
      costed:  results.length,
      failed:  errors.length,
      results,
      errors,
      ...(orphanResult && { orphans: orphanResult }),
    });
  } catch (error) {
    console.error("Production costing POST error:", error);
    // Account Settings gaps (conversion overhead group not set) → 422
    return NextResponse.json({ error: error.message }, { status: error?.statusCode === 422 ? 422 : 500 });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE  /api/costing/production?plan_id=n
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = guard("costing.manage", async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const planId = parseInt(searchParams.get("plan_id") || "0");
    if (!planId) return NextResponse.json({ error: "plan_id required" }, { status: 400 });
    await prisma.productionCostEntry.deleteMany({ where: { plan_id: planId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
