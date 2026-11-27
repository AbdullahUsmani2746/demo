import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { isPeriodLocked } from "@/lib/periodLock";
import { runProductionCosting } from "@/lib/costing/productionCosting";
import { runPlanCosting } from "@/lib/costing/planCosting";
import { feature } from "@/lib/features/server";

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/costing/production?month=&year=&search=&status=&itcd=&code=&page=&limit=
// Source of truth: T8 (tran_code=8) receipts for the period, grouped by
// (finished_id × plan_id_raw).  A row is plan-linked when its rmk5 resolves
// to an existing Posted productionPlanMaster record; otherwise it is orphan.
// ─────────────────────────────────────────────────────────────────────────────
// The cost entry of one production item of an order: the entry for that item,
// or the order's only entry (orders costed before per-item lines existed).
function costEntryOf(plan, itcd) {
  const list = plan.costEntries || [];
  return list.find((e) => Number(e.itcd) === Number(itcd)) ?? (list.length === 1 ? list[0] : null);
}

// ─────────────────────────────────────────────────────────────────────────────
// ?dispatch_detail=<itcd>&month=&year= — an item produced on dispatch: its
// saved cost entry (materials, qty, rate, cost) and every dispatch behind it
// with the production line and the BOM materials issued for that line (same
// dispatch rmk4, same source_line_no — lib/costing/noPlanCosting.js).
// ─────────────────────────────────────────────────────────────────────────────
async function dispatchDetail(itcd, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0, 23, 59, 59);
  const [entry, prodLines] = await Promise.all([
    prisma.productionCostEntry.findFirst({
      where: { itcd, month, year, plan_id: null },
      include: { details: { orderBy: { actual_cost: "desc" } } },
    }),
    prisma.$queryRaw`
      SELECT tm.tran_id, tm.dated, tm.rmk4 AS dispatch_ref, tm.rmk5 AS dispatch_no,
             t.source_line_no AS line_no, t.qty
        FROM "TRANSACTIONS_MASTER" tm
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
       WHERE tm.tran_code = 8 AND tm.rmk1 = 'AUTO_DISPATCH_PROD'
         AND tm.dated >= ${startDate} AND tm.dated <= ${endDate}
         AND t.itcd = ${itcd} AND COALESCE(t.sub_tran_id, 1) = 1 AND t.qty > 0
       ORDER BY tm.dated, tm.tran_id`,
  ]);
  const refs = [...new Set(prodLines.map((l) => String(l.dispatch_ref)).filter(Boolean))];
  const issues = refs.length
    ? await prisma.$queryRaw`
        SELECT tm.tran_id, tm.rmk4 AS dispatch_ref, t.source_line_no AS line_no, t.itcd, i.item, i.code, t.qty
          FROM "TRANSACTIONS_MASTER" tm
          JOIN "Transactions" t ON t.tran_id = tm.tran_id
          LEFT JOIN "Item" i ON i.itcd = t.itcd
         WHERE tm.tran_code = 7 AND tm.rmk1 = 'AUTO_DISPATCH_BOM'
           AND tm.rmk4 = ANY(${refs}::text[]) AND COALESCE(t.sub_tran_id, 1) = 1 AND t.qty > 0`
    : [];
  const issueOf = new Map();
  for (const r of issues) {
    const k = `${r.dispatch_ref}|${r.line_no ?? ""}`;
    if (!issueOf.has(k)) issueOf.set(k, []);
    issueOf.get(k).push({ itcd: Number(r.itcd), item: r.item || `Item #${r.itcd}`, code: r.code || "", qty: Number(r.qty) || 0, issue_tran_id: Number(r.tran_id) });
  }
  const dispatches = prodLines.map((l) => ({
    production_tran_id: Number(l.tran_id),
    dated: l.dated,
    dispatch_tran_id: Number(l.dispatch_ref) || null,
    dispatch_no: l.dispatch_no || null,
    line_no: l.line_no ?? null,
    produced_qty: Number(l.qty) || 0,
    materials: issueOf.get(`${l.dispatch_ref}|${l.line_no ?? ""}`) || [],
  }));
  return {
    entry: entry
      ? {
          qty_costed: Number(entry.qty_costed || 0),
          total_cost: Number(entry.total_cost || 0),
          cost_per_unit: Number(entry.cost_per_unit || 0),
          cc_cost: Number(entry.cc_cost || 0),
          calculated_at: entry.calculated_at,
          materials: entry.details.map((d) => ({
            itcd: d.material_id, item: d.material_name, code: d.material_code,
            qty: Number(d.actual_qty || 0), rate: Number(d.actual_unit_cost ?? d.unit_cost ?? 0),
            cost: Number(d.actual_cost || 0), source: d.cost_source,
          })),
        }
      : null,
    dispatches,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("dispatch_detail")) {
      const itcd = parseInt(searchParams.get("dispatch_detail"));
      const m = parseInt(searchParams.get("month") || new Date().getMonth() + 1);
      const y = parseInt(searchParams.get("year") || new Date().getFullYear());
      if (!itcd) return NextResponse.json({ error: "dispatch_detail needs an item" }, { status: 400 });
      return NextResponse.json(await dispatchDetail(itcd, m, y));
    }
    const month     = parseInt(searchParams.get("month")  || new Date().getMonth() + 1);
    const year      = parseInt(searchParams.get("year")   || new Date().getFullYear());
    const search    = searchParams.get("search") || "";
    const status    = searchParams.get("status") || "all";
    const itcdParam = searchParams.get("itcd") ? parseInt(searchParams.get("itcd")) : null;
    const codeParam = searchParams.get("code") || "";
    // source: order | dispatch | noplan ; category: item category id ; type: cost entry item_type
    const sourceParam   = searchParams.get("source") || "all";
    const categoryParam = searchParams.get("category") ? parseInt(searchParams.get("category")) : null;
    const typeParam     = searchParams.get("type") || "all";
    const page      = Math.max(1, parseInt(searchParams.get("page")  || "1"));
    const limit     = Math.min(100, Math.max(5, parseInt(searchParams.get("limit") || "30")));

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0, 23, 59, 59);

    const periodLocked = await isPeriodLocked(month, year);

    // ── 0. Process orders of the month that are NOT posted (Completed / still
    // open): no issue or production vouchers yet, so stock and costing do not
    // see them — listed so they get posted (Process Orders → Send to Production).
    const unpostedOrders = (await prisma.productionPlanMaster.findMany({
      where: { dated: { gte: startDate, lte: endDate }, NOT: { status: "Posted" } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, dated: true, qty: true, finished_id: true, item: { select: { item: true, code: true, unit: true } } },
    })).map((p) => ({
      id: p.id,
      status: p.status || "—",
      dated: p.dated,
      qty: Number(p.qty || 0),
      finished_id: p.finished_id,
      item_name: p.item?.item || `Item #${p.finished_id}`,
      item_code: p.item?.code || "",
      unit: p.item?.unit || "",
    }));

    // ── 1. ALL T8 receipt groups for the period (primary source) ─────────────
    // Grouped by (itcd, plan_id_raw) so each unique item×plan pairing is one row.
    // rmk5 stores the plan_id as a numeric string; empty/null → orphan.
    const t8Groups = await prisma.$queryRaw`
      SELECT
        t.itcd                                                                  AS finished_id,
        i.item                                                                  AS finished_item,
        i.code                                                                  AS finished_code,
        i.unit,
        i.ic_id                                                                 AS ic_id,
        ic.ic_name                                                              AS ic_name,
        COALESCE(SUM(t.qty), 0)                                                 AS receipt_qty,
        MIN(tm.tran_id)                                                         AS first_tran_id,
        NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'')::integer AS plan_id_raw,
        MIN(tm.dated)                                                           AS first_date,
        MAX(tm.dated)                                                           AS last_date,
        COUNT(DISTINCT tm.tran_id)                                              AS tran_count,
        -- produce-on-dispatch (lib/dispatch/bomProduction.js): rmk5 = dispatch no.
        COUNT(DISTINCT tm.tran_id) FILTER (WHERE tm.rmk1 = 'AUTO_DISPATCH_PROD') AS dispatch_vouchers,
        string_agg(DISTINCT CASE WHEN tm.rmk1 = 'AUTO_DISPATCH_PROD' THEN tm.rmk5 END, ', ') AS dispatch_nos
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t  ON t.tran_id = tm.tran_id
      LEFT JOIN "Item"    i  ON i.itcd    = t.itcd
      LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id
      WHERE tm.tran_code  = 8
        AND tm.dated     >= ${startDate}
        AND tm.dated     <= ${endDate}
        AND t.sub_tran_id = 1
        AND t.qty         > 0
      GROUP BY t.itcd, i.item, i.code, i.unit, i.ic_id, ic.ic_name,
               NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''),'[^0-9]','','g'),'')::integer
      ORDER BY i.item ASC, plan_id_raw ASC NULLS LAST
    `;

    if (t8Groups.length === 0) {
      return NextResponse.json({
        plans: [], orphan_productions: [], unposted_orders: unpostedOrders,
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
            // one per production item (output_line) — the row's item picks its own
            costEntries: {
              orderBy: { output_line: "asc" },
              select: {
                id: true, itcd: true, output_line: true, total_cost: true, cost_per_unit: true,
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
            actual_cost_per_unit: true, qty_costed: true, item_type: true,
            calculated_at: true, calculated_by: true,
          },
        })
      : [];
    const orphanPceMap = new Map(orphanPces.map(e => [Number(e.itcd), e]));

    // ── 4. Build unified row list (plan-linked + orphan) ──────────────────────
    const allRows = t8Groups.map(r => ({ ...rowOf(r), ic_id: r.ic_id != null ? Number(r.ic_id) : null, ic_name: r.ic_name || "" }));
    function rowOf(r) {
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
            item_type:           pce.item_type || null,
            calculated_at:       pce.calculated_at,
            calculated_by:       pce.calculated_by,
          } : null,
          is_orphan:     true,
          // Produced on dispatch: linked to its own BOM issue through the
          // dispatch (lib/costing/noPlanCosting.js) — not a missing plan
          on_dispatch:   Number(r.dispatch_vouchers || 0) > 0 && Number(r.dispatch_vouchers) === Number(r.tran_count || 0),
          dispatch_count: Number(r.dispatch_vouchers || 0),
          dispatch_nos:  r.dispatch_nos || null,
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
          is_costed:     !!costEntryOf(plan, finishedId),
          cost_entry:    costEntryOf(plan, finishedId),
          is_orphan:     false,
          tran_id:       Number(r.first_tran_id || 0),
          rmk5:          String(planIdRaw),
          first_date:    r.first_date,
          last_date:     r.last_date,
          tran_count:    Number(r.tran_count || 1),
        };
      }
    }

    // ── 5. Summary counts (plan-linked rows only; orphans tracked separately) ─
    const planLinkedRows  = allRows.filter(r => !r.is_orphan);
    const orphanRowsAll   = allRows.filter(r =>  r.is_orphan);
    const fullMonthTotal  = planLinkedRows.length;
    const fullMonthCosted = planLinkedRows.filter(r => r.is_costed).length;

    // ── 6. In-memory filters (the whole month, before paging) ─────────────────
    const sourceOf = (r) => (!r.is_orphan ? "order" : r.on_dispatch ? "dispatch" : "noplan");
    const sourceCounts = { order: 0, dispatch: 0, noplan: 0 };
    for (const r of allRows) sourceCounts[sourceOf(r)]++;
    const categories = [...new Map(allRows.filter((r) => r.ic_id != null).map((r) => [r.ic_id, r.ic_name || `Category ${r.ic_id}`]))]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let filtered = allRows;
    if (sourceParam !== "all") filtered = filtered.filter((r) => sourceOf(r) === sourceParam);
    if (categoryParam) filtered = filtered.filter((r) => r.ic_id === categoryParam);
    if (typeParam !== "all") filtered = filtered.filter((r) => r.cost_entry?.item_type === typeParam);
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
        (!isNaN(numId) && (r.id === numId || r.finished_id === numId)) ||
        (r.dispatch_nos || "").split(", ").includes(search.trim())
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
      unposted_orders:    unpostedOrders,
      source_counts:      sourceCounts,
      categories,
      filtered_total:     filteredTotal,
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
        on_dispatch:  op.on_dispatch,
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

    // Settings → Features "costing.engine": "plan" (default) = one cost per
    // process order (lib/costing/planCosting.js); "item" = one cost per
    // production item of each order (lib/costing/productionCosting.js)
    const run = (await feature("costing.engine")) === "item" ? runProductionCosting : runPlanCosting;
    const out = await run(body, { month, year, calculatedBy });
    return NextResponse.json(out);
  } catch (error) {
    if (error?.statusCode === 400) return NextResponse.json({ error: error.message }, { status: 400 });
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
