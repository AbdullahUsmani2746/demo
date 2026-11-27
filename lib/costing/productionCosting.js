// lib/costing/productionCosting.js — Costing → Production engine (server only).
// app/api/costing/production (POST) = permission + Costing Periods lock check +
// runProductionCosting(); scripts run the same function as a system job.
// Writes ProductionCostEntry / ProductionCostDetail only — monthly opening
// stock / rates are written by lib/openingStockGenerate.js alone.
import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import { monthRateCtes, costingRules } from "@/lib/costing/monthRates";
import { getProductionSetup, isSemiFinishedCategory } from "@/lib/production/setup";
import { costOrphanItems } from "@/lib/costing/noPlanCosting";
import { poWhere } from "@/lib/manufacturing/processOrderRef";
import prisma from "@/lib/prisma";
import { getOpeningOne } from "@/lib/openingStock";
import { Prisma } from "@prisma/client";
import { getAccount, getAccountList, requireAccountGroup } from "@/lib/accounts/accountSettings";
import { servicesByItem } from "@/lib/service/landedCost";
import { feature } from "@/lib/features/server";
import { plantExpenseProducts, getsPlantExpenses } from "@/lib/costing/plantExpenseProducts";

// One production item (output line) of a process order: its voucher lines
// carry Transactions.source_line_no = the line; lines posted before that
// existed (NULL) belong to line 1. line null = the whole order.
const lineSql = (line) =>
  line == null
    ? Prisma.empty
    : Prisma.sql`AND (t.source_line_no = ${line} OR (t.source_line_no IS NULL AND ${line} = 1))`;

// ─────────────────────────────────────────────────────────────────────────────
// CC RATE: shared overhead pool ÷ kg made on process orders this month:
//   pool  = net expense of the 'Conversion Overhead Accounts' main accounts
//           (Account Settings, required — 422 while empty), without the
//           'conversion_cost' account and the accounts listed in
//           'conversion_overhead_exclude' (e.g. a month-end transfer account);
//   kg    = production (T8) linked to a Posted process order of the products
//           that get plant expenses (Item / Item Category "Gets plant
//           expenses" — lib/costing/plantExpenseProducts.js; nothing ticked =
//           every product), not M2M; produce-on-dispatch gets none directly
//           (it carries it through what it is made from).
// Uses T8 receipt qty (not PCE qty) so the rate can be computed before costing.
// ─────────────────────────────────────────────────────────────────────────────
async function _calcCcRateForPeriod(month, year) {
  const dateFrom = new Date(year, month - 1, 1);
  const dateTo   = new Date(year, month, 0, 23, 59, 59);
  const overheadMacnos = await requireAccountGroup("conversion_overheads");
  const conversionCostAcno = await getAccount("conversion_cost");
  const excluded = [
    ...(conversionCostAcno != null ? [Number(conversionCostAcno)] : []),
    ...(await getAccountList("conversion_overhead_exclude")),
  ];

  const ccRows = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(t.damt), 0) AS total_damt,
      COALESCE(SUM(t.camt), 0) AS total_camt
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    JOIN "acno" a ON t.acno = a.acno
    WHERE a.macno = ANY(${overheadMacnos}::int[])
      ${excluded.length ? Prisma.sql`AND a.acno <> ALL(${excluded}::int[])` : Prisma.empty}
      AND tm.dated >= ${dateFrom}
      AND tm.dated <= ${dateTo}
  `;
  const cc_total = Math.max(0,
    Number(ccRows[0]?.total_damt || 0) - Number(ccRows[0]?.total_camt || 0)
  );
  if (cc_total === 0) return 0;

  // Denominator: kg made on Posted process orders this period, of the products
  // that get plant expenses
  const rule = await plantExpenseProducts();
  const fgRows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(t.qty), 0) AS total_qty
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    JOIN "productionPlanMaster" p ON p.id::text = ${poRefSql("tm")} AND p.status = 'Posted'
    JOIN "Item" i ON i.itcd = t.itcd
    WHERE tm.tran_code = 8
      ${rule.all ? Prisma.empty : Prisma.sql`AND (i.itcd = ANY(${rule.itcds}::int[]) OR i.ic_id = ANY(${rule.categories}::int[]))`}
      AND tm.dated >= ${dateFrom}
      AND tm.dated <= ${dateTo}
      AND tm.rmk4 IS DISTINCT FROM 'M2M'
      AND t.sub_tran_id = 1
      AND t.qty > 0
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

  // 2. Weighted average = (opening_qty × opening_rate + period purchase damt + GRN services) / (opening_qty + period purchase qty)
  //    Opening qty is summed across all godowns (lib/openingStock.js).
  const os = await getOpeningOne(month, year, itemId);

  const opening_qty   = Number(os?.opening_qty  || 0);
  const opening_rate  = Number(os?.opening_rate || 0);
  const opening_value = opening_qty * opening_rate;

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfPeriod  = new Date(year, month, 0, 23, 59, 59);

  const rules = await costingRules();
  const rows = await prisma.$queryRaw`
    SELECT
    COALESCE(SUM(CASE WHEN tm.tran_code = 4 THEN t.damt
                      WHEN tm.tran_code = 9 THEN -t.camt
                      ELSE 0 END), 0) AS total_amt,
    -- costing.zeroValueReceiptsAtAverage: a receipt without a value enters at the average (not counted in the rate)
    COALESCE(SUM(CASE WHEN tm.tran_code = 4 ${rules.zeroValueAtAverage ? Prisma.sql`AND COALESCE(t.damt, 0) <> 0` : Prisma.empty} THEN t.qty
                      WHEN tm.tran_code = 9 ${rules.zeroValueAtAverage ? Prisma.sql`AND COALESCE(t.camt, 0) <> 0` : Prisma.empty} THEN -t.qty
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
  // + the month's GRN services of this item (landed cost, costing.servicesInCost) — same as monthRateCtes
  const svc         = rules.servicesInCost
    ? (await servicesByItem({ dateFrom: startOfMonth, dateTo: endOfPeriod, item: itemId })).get(Number(itemId))
    : null;
  const purch_amt   = Number(p?.total_amt || 0) + Number(svc?.purchase || 0);

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
async function getPlanMaterials(plan, month, year, ccInclusive = false, line = null) {
  const all = await prisma.productionPlanDetail.findMany({
    where:   { plan_id: plan.id },
    include: {
      item: { select: { itcd: true, item: true, code: true, unit: true, ic_id: true } },
      issueLine: { select: { output_line: true } },
    },
    orderBy: { sno: "asc" },
  });
  // One production item: the materials issued for it (no issue row = line 1)
  const details = line == null ? all : all.filter((d) => (d.issueLine?.output_line ?? 1) === line);

  const merged = new Map(); // deduplicate by material_id
  const setup = await getProductionSetup(); // which categories are semi-finished

  for (const d of details) {
    if (!d.material_id) continue;
    const materialQty = Number(d.material_qty || 0);
    if (materialQty === 0) continue; // a minus line = material returned from production

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

// ─────────────────────────────────────────────────────────────────────────────
// GET ACTUAL ISSUANCES for a plan (tran_code=7, rmk5 = plan_id string)
// Returns Map: itcd → { item_name, item_code, unit, actual_qty, unit_cost, actual_cost }
// ─────────────────────────────────────────────────────────────────────────────
async function getActualIssuances(planId, month, year, ccInclusive = false, line = null) {
  const dateFrom   = new Date(year, month - 1, 1);
  const dateTo     = new Date(year, month, 0, 23, 59, 59);

  // ── Rate formula: weighted average = (opening_qty × opening_rate + period_purchase_damt)
  //                                    / (opening_qty + period_purchase_qty)
  // This is IDENTICAL to getItemUnitCost() so that theoretical and actual costs are
  // valued at the same rate — the variance then reflects pure quantity differences.
  // Previously used COALESCE(opening_rate, all-time-avg) which caused a rate mismatch.
  const rows = await prisma.$queryRaw`
    ${monthRateCtes(month, year, ccInclusive, await costingRules())}
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
      AND ${poRefSql("tm")} = ${String(planId)}
      ${lineSql(line)}
      AND t.sub_tran_id = 1
      AND t.qty <> 0 -- a minus line = material returned from production
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
// GET ACTUAL PRODUCTION QTY for a plan from tran_code=8 (production receipt)
// tran_code=8 transactions have the produced item in Transactions.itcd and
// the plan ID stored in TransactionsMaster.rmk5 (numeric string).
// This is more reliable than productionPlanMaster.actual_yield (which is
// filled from the form and may be left at planned qty or 0).
// ─────────────────────────────────────────────────────────────────────────────
async function getActualProductionQty(planId, month, year, line = null) {
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
      AND ${poRefSql("tm")} = ${String(planId)}
      ${lineSql(line)}
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
// One cost entry per production item of the order (productionPlanOutput
// line); an order with one item = one entry, line 1, exactly as before.
async function costOnePlan(plan, month, year, calculatedBy, itemType, ccRatePerUnit = 0) {
  const outputs = await prisma.productionPlanOutput.findMany({
    where: { plan_id: plan.id },
    orderBy: { line_no: "asc" },
    select: { line_no: true, finished_id: true },
  });
  // Previous entries of this order (all lines) are replaced by this run
  await prisma.productionCostEntry.deleteMany({ where: { plan_id: plan.id } });
  if (outputs.length <= 1) {
    return costPlanLine(plan, null, plan.finished_id, month, year, calculatedBy, itemType, ccRatePerUnit);
  }
  const lines = [];
  for (const o of outputs) {
    lines.push(await costPlanLine(plan, o.line_no, o.finished_id, month, year, calculatedBy, itemType, ccRatePerUnit));
  }
  // The order's summary for the screen: the lines added up
  const sum = (k) => lines.reduce((s, l) => s + (Number(l[k]) || 0), 0);
  const qty = sum("qty_costed");
  return {
    ...lines[0],
    qty_costed: qty,
    theoretical_cost: sum("theoretical_cost"),
    actual_issued_cost: sum("actual_issued_cost"),
    effective_cost: sum("effective_cost"),
    cost_per_unit: qty ? sum("effective_cost") / qty : 0,
    cc_cost: sum("cc_cost"),
    wastage_cost: sum("wastage_cost"),
    cost_variance: sum("cost_variance"),
    lines,
  };
}

// One production item of an order. line null = the order has one item.
async function costPlanLine(plan, line, lineFinishedId, month, year, calculatedBy, itemType, ccRatePerUnit = 0) {
  // ── 0. Determine actual production qty AND finished item from T8 ──────────
  // T8 transaction is the source of truth:
  //   - t.itcd   → the item that was actually received into stock
  //   - SUM(qty) → how much was produced
  // Fall back to plan fields only when there are no T8 receipts yet.
  const { qty: tran8Qty, itcd: tran8Itcd } = await getActualProductionQty(plan.id, month, year, line);
  const qty        = tran8Qty  > 0 ? tran8Qty  : (line == null ? (plan.actual_yield || plan.qty || 0) : 0);
  const finishedId = tran8Itcd ?? lineFinishedId ?? plan.finished_id;  // prefer T8 itcd over plan

  if (!finishedId || qty <= 0) throw new Error("No finished item or zero quantity");

  const finishedItem = await prisma.item.findUnique({
  where: { itcd: finishedId },
  select: { itcd: true, ic_id: true },
});

// ── Check if this plan's T8 receipt is tagged M2M (rmk4='M2M') ──────────
// M2M productions are machine-to-machine transfers and must NOT carry CC overhead.
const t8M2MCheck = await prisma.transactionsMaster.findFirst({
  where: {
    tran_code: 8,
    ...poWhere(plan.id),
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
  // A produced input passes on its FULL cost, overhead included — overhead is
  // on everything made on a process order
  const ccInclusive = true;

  // ── 1. Theoretical cost from productionPlanDetail ─────────────────────────
  // Uses the actual material list on this plan (not BomMaster).
  // SF materials (ic_id=2) use ProductionCostEntry (sequenced first).
  // RM materials (ic_id=3) use weighted-average rate.
  const rawMaterials       = await getPlanMaterials(plan, month, year, ccInclusive, line);
  const theoreticalCost    = rawMaterials.reduce((s, m) => s + m.total_cost, 0);
  const theoreticalPerUnit = qty > 0 ? theoreticalCost / qty : 0;

  // ── 2. Actual cost from tran_code=7 issuances linked via rmk5 ─────────────
  const issuanceMap     = await getActualIssuances(plan.id, month, year, ccInclusive, line);
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

  // ── CC overhead: applied only when the produced item's category is ic_id=1 ─
  // Plant expenses on the products that get them (Item / Item Category "Gets
  // plant expenses" — lib/costing/plantExpenseProducts.js), not M2M
  const isFG   = !isM2M && getsPlantExpenses(await plantExpenseProducts(), finishedItem);
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
    // (the order's previous entries were removed by costOnePlan)
    await tx.productionCostEntry.create({
      data: {
        plan_id:    plan.id,
        output_line: line ?? 1,
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
    output_line:        line ?? 1,
    finished_id:        finishedId,
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
// Items that also have a no-plan T8 receipt are costed by costOrphanItems
// (their own production) and skipped here, so the two never overwrite one
// entry; what is left has no production on record: qty_costed = 0.
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
        ${poRefSql("tm")} IS NULL
        OR TRIM(${poRefSql("tm")}) = ''
        OR NOT EXISTS (
          SELECT 1 FROM "productionPlanMaster" p
          WHERE REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g') != ''
            AND p.id::text = REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g')
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
        ${poRefSql("tm")} IS NULL
        OR TRIM(${poRefSql("tm")}) = ''
        OR NOT EXISTS (
          SELECT 1 FROM "productionPlanMaster" p
          WHERE REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g') != ''
            AND p.id::text = REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g')
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
    if ((t8QtyByItcd.get(itcd) || 0) > 0) continue; // produced without a plan → costOrphanItems
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
// RUN — what POST /api/costing/production does after its permission and the
// Costing Periods lock check; also run by scripts as a named system job.
//   { plan_ids | plan_id | auto_sequence (+ only_pending), auto_orphans }
// Throws an error with statusCode 400 when there is nothing to cost.
// Writes ProductionCostEntry / ProductionCostDetail only — never openings.
// ─────────────────────────────────────────────────────────────────────────────
export async function runProductionCosting(body, { month, year, calculatedBy }) {
    // Compute CC rate once for the period — passed to every costOnePlan call so
    // all FG/mixed items share the same overhead pool rate.
    // Plant expenses only when Settings → Features "costing.plantOverhead" is on
    const ccRatePerUnit = (await feature("costing.plantOverhead")) ? await _calcCcRateForPeriod(month, year) : 0;

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0, 23, 59, 59);

    let targetPlanIds;

    if (body.auto_sequence) {
      // Only cost plans that have actual T8 receipts in this period.
      // Plans with no production receipt are skipped — they have nothing to cost.
      const t8LinkedRows = await prisma.$queryRaw`
        SELECT DISTINCT
          NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'')::integer AS plan_id
        FROM "TRANSACTIONS_MASTER" tm
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
        WHERE tm.tran_code  = 8
          AND tm.dated     >= ${startDate}
          AND tm.dated     <= ${endDate}
          AND t.sub_tran_id = 1
          AND t.qty         > 0
          AND NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'') IS NOT NULL
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

    // Nothing at all to cost: no process order and no no-plan production run
    if (!targetPlanIds.length && !body.auto_orphans) {
      throw Object.assign(new Error("No plans to cost"), { statusCode: 400 });
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
      // In turn, not together: both keep one entry per item (plan_id null).
      // produce-on-dispatch / no-plan: no overhead directly (it comes in
      // through what they are made from — the process orders' products)
      const t8Orphans = await costOrphanItems(month, year, calculatedBy, 0);
      const t7Orphans = await costOrphanT7Items(month, year, startDate, endDate, calculatedBy);
      orphanResult = {
        t8_grouped: t8Orphans,
        t7_grouped: { processed: t7Orphans.results.length, errors: t7Orphans.errors.length },
      };
    }

    return {
      success: true,
      costed:  results.length,
      failed:  errors.length,
      results,
      errors,
      ...(orphanResult && { orphans: orphanResult }),
    };
}
