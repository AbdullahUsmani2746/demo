import prisma from "@/lib/prisma";
import { getOpeningQty } from "@/lib/openingStock";
import { getPlannedQuantities } from "@/lib/production/plannedQuantities";
import { getProductionSetup, isPackingCategory, procuredCategoryIds } from "@/lib/production/setup";

// Recursively explode a finished/semi-finished item's BOM until every path
// reaches a raw material or packing material (Settings → Production setup).
// `visited` prevents infinite loops from circular BOM references.
function explodeBOM(itemId, qty, bomMap, setup, visited = new Set()) {
  if (visited.has(itemId)) return [];
  const seen = new Set(visited);
  seen.add(itemId);

  const bom = bomMap[itemId];
  if (!bom || !bom.bomDetails.length) return [];

  const results = [];
  for (const detail of bom.bomDetails) {
    const matQty = (qty * (detail.material_percentage || 0)) / 100;
    const icId   = detail.item?.ic_id;

    if (procuredCategoryIds(setup).includes(icId)) {
      // Leaf node — raw material or packaging
      results.push({
        material_id:   Number(detail.material_id),
        material_name: detail.item.item  || "",
        material_code: detail.item.code  || "",
        unit:          detail.item.unit  || "",
        category:      isPackingCategory(setup, icId) ? "Packaging" : "Raw Material",
        qty:           matQty,
      });
    } else {
      // Intermediate finished / semi-finished — drill deeper
      results.push(...explodeBOM(detail.material_id, matQty, bomMap, setup, seen));
    }
  }
  return results;
}

export async function getProductionPlanningReport(filters = {}) {
  // planMonth = the month user selects (GRN/procurement month, e.g. June)
  // salesMonth = previous month whose sales drive the plan (e.g. May)
  const setup = await getProductionSetup();
  const planMonth = parseInt(filters.month) || new Date().getMonth() + 1;
  const planYear  = parseInt(filters.year)  || new Date().getFullYear();

  const salesMonth = planMonth === 1 ? 12          : planMonth - 1;
  const salesYear  = planMonth === 1 ? planYear - 1 : planYear;

  const salesStart = new Date(salesYear,  salesMonth - 1, 1,  0,  0,  0,   0);
  const salesEnd   = new Date(salesYear,  salesMonth,     0,  23, 59, 59, 999);

  const grnStart   = new Date(planYear,   planMonth  - 1, 1,  0,  0,  0,   0);
  const grnEnd     = new Date(planYear,   planMonth,      0,  23, 59, 59, 999);

  // ── 1. Sales (tran_code=6) for the PREVIOUS month ────────────────────────
  const salesRows = await prisma.$queryRaw`
    SELECT
      t.itcd,
      i.item     AS item_name,
      i.code     AS item_code,
      i.unit     AS unit,
      SUM(t.qty) AS total_sold_qty
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    JOIN "Item" i ON t.itcd = i.itcd
    WHERE tm.tran_code = 6
      AND tm.dated >= ${salesStart}
      AND tm.dated <= ${salesEnd}
      AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
    GROUP BY t.itcd, i.item, i.code, i.unit
    HAVING SUM(t.qty) > 0
    ORDER BY i.item
  `;

  if (!salesRows || salesRows.length === 0) {
    return {
      data: [],
      summary: {
        total_finished_items:  0,
        total_raw_materials:   0,
        total_required_qty:    0,
        total_available_stock: 0,
        total_net_required:    0,
        total_purchased_qty:   0,
        total_remaining_qty:   0,
      },
    };
  }

  // ── 2. Load ALL active BOMs once for recursive explosion ─────────────────
  //    instructions = "A" → active BOM
  //    orderBy dated desc so bomMap keeps the latest per finished_id
  const allBoms = await prisma.bomMaster.findMany({
    where: { instructions: "A" },
    include: {
      bomDetails: {
        include: {
          item: {
            select: { itcd: true, item: true, code: true, unit: true, ic_id: true },
          },
        },
      },
    },
    orderBy: { dated: "desc" },
  });

  // Map: finished_id → latest active BOM (first entry wins due to desc sort)
  const bomMap = {};
  for (const bom of allBoms) {
    if (!bomMap[bom.finished_id]) {
      bomMap[bom.finished_id] = bom;
    }
  }

  // ── 3. Explode each sold item's BOM recursively → aggregate by raw material
  const rawMaterialMap = {};

  for (const sale of salesRows) {
    const saleQty   = Number(sale.total_sold_qty || 0);
    const materials = explodeBOM(Number(sale.itcd), saleQty, bomMap, setup);

    for (const mat of materials) {
      const id = mat.material_id;

      if (!rawMaterialMap[id]) {
        rawMaterialMap[id] = {
          material_id:           id,
          material_name:         mat.material_name,
          material_code:         mat.material_code,
          unit:                  mat.unit,
          category:              mat.category,
          finished_items_detail: [],
          total_required_qty:    0,
        };
      }

      rawMaterialMap[id].finished_items_detail.push({
        finished_id:   Number(sale.itcd),
        finished_name: sale.item_name  || "",
        finished_code: sale.item_code  || "",
        sale_qty:      Math.round(saleQty    * 100) / 100,
        required_qty:  Math.round(mat.qty    * 100) / 100,
      });

      rawMaterialMap[id].total_required_qty += mat.qty;
    }
  }

  const rawMaterialIds = Object.keys(rawMaterialMap).map(Number);

  if (rawMaterialIds.length === 0) {
    return {
      data: [],
      summary: {
        total_finished_items:  salesRows.length,
        total_raw_materials:   0,
        total_required_qty:    0,
        total_available_stock: 0,
        total_net_required:    0,
        total_purchased_qty:   0,
        total_remaining_qty:   0,
      },
    };
  }

  // ── 4. Available stock = opening of salesMonth (= closing of salesMonth-1) ─
  // Qty summed across all godowns (lib/openingStock.js).
  const storedOpening = await getOpeningQty(planMonth, planYear, { itcds: rawMaterialIds });

  const openingStockMap = {};
  for (const [itcd, qty] of storedOpening) {
    openingStockMap[Number(itcd)] = Number(qty || 0);
  }

  // Fallback: compute from transactions for items missing in the snapshot table
  const missingIds = rawMaterialIds.filter((id) => !(id in openingStockMap));
  if (missingIds.length > 0) {
    const computed = await prisma.$queryRaw`
      SELECT
        t.itcd,
        COALESCE(SUM(
          CASE
            WHEN tm.tran_code IN (4, 8, 10, 12) THEN  t.qty
            WHEN tm.tran_code IN (5, 6, 7,  9)  THEN -t.qty
            ELSE 0
          END
        ), 0) AS closing_stock
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
      WHERE t.itcd = ANY(${missingIds}::int[])
        AND tm.dated < ${salesStart}
        AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
      GROUP BY t.itcd
    `;
    for (const cs of computed) {
      openingStockMap[Number(cs.itcd)] = Number(cs.closing_stock || 0);
    }
  }

  // ── 5. GRN / Purchased in the PLAN month (tran_code=4) ───────────────────
  const purchasedRows = await prisma.$queryRaw`
    SELECT
      t.itcd,
      COALESCE(SUM(t.qty), 0) AS purchased_qty
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    WHERE tm.tran_code = 4
      AND t.itcd = ANY(${rawMaterialIds}::int[])
      AND tm.dated >= ${grnStart}
      AND tm.dated <= ${grnEnd}
      AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
    GROUP BY t.itcd
  `;

  const purchasedMap = {};
  for (const pr of purchasedRows) {
    purchasedMap[Number(pr.itcd)] = Number(pr.purchased_qty || 0);
  }

  // ── 5b. Planned quantities (Production → Planned Quantities, INPUT_FOR_PP;
  // ported from Accounting). Month: the plan month's entry. Quarter: a direct
  // quarterly entry, else the sum of the quarter's three monthly entries.
  const planned = await getPlannedQuantities(Object.keys(rawMaterialMap).map(Number), planMonth, planYear);

  // ── 6. Assemble final rows ────────────────────────────────────────────────
  const data = [];

  for (const [matId, mat] of Object.entries(rawMaterialMap)) {
    const id             = Number(matId);
    const requiredQty    = mat.total_required_qty;
    const availableStock = openingStockMap[id] ?? 0;
    const netRequired    = Math.max(0, requiredQty - availableStock);
    const purchasedQty   = purchasedMap[id] ?? 0;
    const remainingQty   = Math.max(0, netRequired - purchasedQty);

    data.push({
      material_id:     id,
      material_name:   mat.material_name,
      material_code:   mat.material_code,
      unit:            mat.unit,
      category:        mat.category,
      finished_items:  mat.finished_items_detail.map((fi) => fi.finished_name).join(", "),
      required_qty:    Math.round(requiredQty    * 100) / 100,
      available_stock: Math.round(availableStock * 100) / 100,
      net_required:    Math.round(netRequired     * 100) / 100,
      purchased_qty:   Math.round(purchasedQty    * 100) / 100,
      remaining_qty:   Math.round(remainingQty    * 100) / 100,
      planned_month_qty: Math.round((planned.month.get(id) ?? 0) * 100) / 100,
      qtr_qty:           Math.round((planned.quarter.get(id) ?? 0) * 100) / 100,
      detail:          mat.finished_items_detail,
    });
  }

  // Most critical (largest gap) first
  data.sort((a, b) => b.remaining_qty - a.remaining_qty || b.net_required - a.net_required);

  const sum = (f) => Math.round(data.reduce((s, r) => s + (r[f] || 0), 0) * 100) / 100;

  return {
    data,
    summary: {
      total_finished_items:  salesRows.length,
      total_raw_materials:   data.length,
      total_required_qty:    sum("required_qty"),
      total_available_stock: sum("available_stock"),
      total_net_required:    sum("net_required"),
      total_purchased_qty:   sum("purchased_qty"),
      total_remaining_qty:   sum("remaining_qty"),
      total_planned_month_qty: sum("planned_month_qty"),
      total_qtr_qty:         sum("qtr_qty"),
    },
  };
}
