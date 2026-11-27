// lib/costing/noPlanCosting.js — Costing → Production for productions without
// a process order (server only). Called by app/api/costing/production (POST,
// auto_orphans) after the process orders are costed.
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import { monthIssueRates } from "@/lib/costing/monthRates";
import { getProductionSetup, isFinishedCategory } from "@/lib/production/setup";

// ─────────────────────────────────────────────────────────────────────────────
// NO-PLAN PRODUCTIONS (T8 receipts not linked to a Posted process order)
// One ProductionCostEntry per produced item (plan_id null, is_orphan), made of:
//
//   · produce-on-dispatch (rmk1 AUTO_DISPATCH_PROD — lib/dispatch/bomProduction.js):
//     each production line is costed from ITS OWN BOM issue lines — the
//     AUTO_DISPATCH_BOM voucher of the same dispatch (rmk4 = dispatch tran_id)
//     and the same line (source_line_no). Exact, like a process order.
//   · any other no-plan production: a share, by qty, of the month's unlinked
//     issues (not process-order issues, not dispatch BOM / packing issues).
//
// Every material is valued at the month issue rate (monthRateCtes — the same
// rate process orders use). CC overhead for finished goods (ic_id 1) as plans.
// ─────────────────────────────────────────────────────────────────────────────
export async function costOrphanItems(month, year, calculatedBy, ccRatePerUnit = 0, { dryRun = false } = {}) {
  const setup = await getProductionSetup();
  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0, 23, 59, 59);
  const NOT_LINKED = Prisma.sql`(
        ${poRefSql("tm")} IS NULL
        OR TRIM(${poRefSql("tm")}) = ''
        OR REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g') = ''
        OR NOT EXISTS (
          SELECT 1 FROM "productionPlanMaster" p
          WHERE p.id = NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g'), '')::integer
            AND p.status = 'Posted'
        )
      )`;

  // 1. No-plan production lines, with their dispatch link when produce-on-dispatch
  const prodLines = await prisma.$queryRaw`
    SELECT t.itcd AS finished_id, i.item AS item_name, i.code AS item_code, i.ic_id,
           t.qty, (COALESCE(tm.rmk1, '') = 'AUTO_DISPATCH_PROD') AS on_dispatch,
           tm.rmk4 AS dispatch_ref, t.source_line_no AS line_no
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      LEFT JOIN "Item"    i ON i.itcd    = t.itcd
     WHERE tm.tran_code = 8
       AND tm.dated >= ${startDate} AND tm.dated <= ${endDate}
       AND COALESCE(t.sub_tran_id, 1) = 1
       AND t.qty > 0
       AND ${NOT_LINKED}`;
  if (!prodLines.length) return { processed: 0, skipped: 0 };

  // 2. The BOM issue lines of those dispatches, by dispatch + line
  const refs = [...new Set(prodLines.filter((l) => l.on_dispatch && l.dispatch_ref).map((l) => String(l.dispatch_ref)))];
  const bomLines = refs.length
    ? await prisma.$queryRaw`
        SELECT tm.rmk4 AS dispatch_ref, t.source_line_no AS line_no, t.itcd, i.item AS item_name, i.code AS item_code,
               COALESCE(SUM(t.qty), 0) AS qty
          FROM "TRANSACTIONS_MASTER" tm
          JOIN "Transactions" t ON t.tran_id = tm.tran_id
          LEFT JOIN "Item"    i ON i.itcd    = t.itcd
         WHERE tm.tran_code = 7
           AND tm.rmk1 = 'AUTO_DISPATCH_BOM'
           AND tm.rmk4 = ANY(${refs}::text[])
           AND COALESCE(t.sub_tran_id, 1) = 1
           AND t.qty > 0
         GROUP BY 1, 2, 3, 4, 5`
    : [];
  const bomOf = new Map(); // dispatch|line → [{ itcd, qty, … }]
  for (const r of bomLines) {
    const k = `${r.dispatch_ref}|${r.line_no ?? ""}`;
    if (!bomOf.has(k)) bomOf.set(k, []);
    bomOf.get(k).push(r);
  }

  // 3. The pool for other no-plan productions: unlinked issues of the month,
  //    without the automatic ones (dispatch BOM / packing — rmk1 AUTO_…)
  const poolLines = await prisma.$queryRaw`
    SELECT t.itcd, i.item AS item_name, i.code AS item_code, COALESCE(SUM(t.qty), 0) AS qty
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      LEFT JOIN "Item"    i ON i.itcd    = t.itcd
     WHERE tm.tran_code = 7
       AND tm.dated >= ${startDate} AND tm.dated <= ${endDate}
       AND COALESCE(t.sub_tran_id, 1) = 1
       AND t.qty > 0
       AND COALESCE(tm.rmk1, '') NOT LIKE 'AUTO%'
       AND ${NOT_LINKED}
     GROUP BY 1, 2, 3`;

  // produced inputs (a semi-finished into a finished good …) at their full cost, overhead included
  const rates = await monthIssueRates(month, year, true);
  const rateOf = (itcd) => rates.get(Number(itcd)) || 0;

  // 4. Per produced item: qty, and materials (exact for dispatch lines)
  const items = new Map();
  let poolQty = 0;
  for (const l of prodLines) {
    const itcd = Number(l.finished_id);
    if (!items.has(itcd)) {
      items.set(itcd, { itcd, ic_id: l.ic_id, qty: 0, poolQty: 0, unmatched: 0, materials: new Map() });
    }
    const it = items.get(itcd);
    const qty = Number(l.qty) || 0;
    it.qty += qty;
    const own = l.on_dispatch ? bomOf.get(`${l.dispatch_ref}|${l.line_no ?? ""}`) : null;
    if (own?.length) {
      for (const m of own) {
        const mid = Number(m.itcd);
        const cur = it.materials.get(mid) || { name: m.item_name, code: m.item_code, qty: 0, source: "dispatch_bom" };
        cur.qty += Number(m.qty) || 0;
        it.materials.set(mid, cur);
      }
    } else {
      if (l.on_dispatch) it.unmatched += qty; // dispatch production without its BOM issue
      it.poolQty += qty;
      poolQty += qty;
    }
  }
  for (const it of items.values()) {
    if (!(it.poolQty > 0) || !(poolQty > 0)) continue;
    const share = it.poolQty / poolQty;
    for (const m of poolLines) {
      const mid = Number(m.itcd);
      const cur = it.materials.get(mid) || { name: m.item_name, code: m.item_code, qty: 0, source: "orphan_t7" };
      cur.qty += (Number(m.qty) || 0) * share;
      it.materials.set(mid, cur);
    }
  }

  // 5. Persist — one entry per item (replaces the month's previous one).
  //    dryRun: nothing written, the entries are returned (October test, checks).
  let processed = 0, skipped = 0;
  const preview = [];
  for (const it of items.values()) {
    if (!(it.qty > 0)) { skipped++; continue; }
    const detailRows = [...it.materials].map(([mid, m]) => {
      const unit = rateOf(mid);
      const cost = m.qty * unit;
      return {
        material_id:      mid,
        material_name:    m.name || `Item #${mid}`,
        material_code:    m.code || "",
        bom_level:        0,
        is_raw_material:  true,
        qty:              0,          // no plan — theoretical unknown
        unit_cost:        unit,
        total_cost:       0,
        cost_source:      m.source,   // dispatch_bom | orphan_t7
        actual_qty:       m.qty,
        actual_cost:      cost,
        actual_unit_cost: unit,
        variance_qty:     null,
        variance_cost:    null,
      };
    }).filter((d) => d.actual_qty > 0);
    const matCost  = detailRows.reduce((s, d) => s + d.actual_cost, 0);
    const matQty   = detailRows.reduce((s, d) => s + d.actual_qty, 0);
    const isFG     = isFinishedCategory(setup, it.ic_id); // Settings → Production setup
    const ccCost   = isFG ? ccRatePerUnit * it.qty : 0;
    const totalCost = matCost + ccCost;
    const data = {
      qty_costed:           it.qty,
      total_cost:           totalCost,
      cost_per_unit:        totalCost / it.qty,
      actual_issued_cost:   matCost > 0 ? matCost : null,
      actual_issued_qty:    matQty > 0 ? matQty : null,
      actual_cost_per_unit: matCost > 0 ? matCost / it.qty + (isFG ? ccRatePerUnit : 0) : null,
      cc_rate:              isFG && ccRatePerUnit > 0 ? ccRatePerUnit : null,
      cc_cost:              ccCost > 0 ? ccCost : null,
      is_orphan:            true,
      item_type:            isFG ? "finished_good" : "semi_finished_l1",
      calculated_at:        new Date(),
      calculated_by:        calculatedBy,
    };

    if (dryRun) {
      preview.push({ itcd: it.itcd, qty: it.qty, unmatched: it.unmatched, poolQty: it.poolQty, ...data, details: detailRows });
      processed++;
      continue;
    }
    const existing = await prisma.productionCostEntry.findFirst({ where: { itcd: it.itcd, month, year, plan_id: null } });
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.productionCostDetail.deleteMany({ where: { entry_id: existing.id } });
        await tx.productionCostEntry.update({ where: { id: existing.id }, data: { ...data, details: { create: detailRows } } });
      } else {
        await tx.productionCostEntry.create({ data: { plan_id: null, itcd: it.itcd, month, year, ...data, details: { create: detailRows } } });
      }
    });
    processed++;
  }

  return dryRun ? { processed, skipped, preview } : { processed, skipped };
}
