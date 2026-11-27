import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getOpeningOne, getOpening, getLatestOpeningRates } from "@/lib/openingStock";

// GET /api/costing/checking?itcd=&month=&year=
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const itcd  = parseInt(searchParams.get("itcd"),  10);
    const month = parseInt(searchParams.get("month"), 10);
    const year  = parseInt(searchParams.get("year"),  10);

    if (!itcd || !month || !year) {
      return NextResponse.json({ error: "itcd, month, year are required" }, { status: 400 });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month,     1);  // exclusive upper bound

    // ── 1. Item info ────────────────────────────────────────────────────────
    const itemRow = await prisma.item.findUnique({
      where: { itcd },
      select: { itcd: true, item: true, code: true, ic_id: true, unit: true },
    });
    if (!itemRow) {
      return NextResponse.json({ error: `Item ${itcd} not found` }, { status: 404 });
    }

    // ── 2. Opening stock ────────────────────────────────────────────────────
    const opening = await getOpeningOne(month, year, itcd);

    // ── 3. Period transactions for this item ────────────────────────────────
    // tran_code: 4=purchase, 9=purch return, 6=sale/dispatch, 7=issuance, 8=production
    const txRows = await prisma.$queryRaw`
      SELECT
        tm.tran_id,
        tm.dated,
        tm.tran_code,
        tm.vr_no,
        ${poRefSql("tm")} AS rmk5,
        t.qty,
        t.rate,
        t.damt,
        t.camt,
        t.invoice_no
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE t.itcd = ${itcd}
        AND tm.dated >= ${startDate}
        AND tm.dated <  ${endDate}
        AND tm.tran_code IN (4, 9, 6, 7, 8)
      ORDER BY tm.dated, tm.tran_id, t.id
    `;

    // ── 4. ProductionCostEntry + details for process orders that produced this item ─
    const t8Rows     = txRows.filter(r => Number(r.tran_code) === 8);
    const procOrdNos = [...new Set(t8Rows.map(r => r.rmk5).filter(Boolean))];
    const planIdsInt = procOrdNos.map(p => parseInt(p, 10)).filter(n => !isNaN(n));

    let costEntries = [];
    if (planIdsInt.length > 0) {
      costEntries = await prisma.productionCostEntry.findMany({
        where: { plan_id: { in: planIdsInt }, month, year },
        select: {
          id:                   true,
          plan_id:              true,
          qty_costed:           true,
          total_cost:           true,
          cost_per_unit:        true,
          actual_issued_cost:   true,
          actual_cost_per_unit: true,
          cc_rate:              true,
          cc_cost:              true,
          item_type:            true,
          details: {
            select: {
              material_id:      true,
              material_name:    true,
              material_code:    true,
              qty:              true,
              unit_cost:        true,
              total_cost:       true,
              actual_qty:       true,
              actual_unit_cost: true,
              actual_cost:      true,
            },
          },
        },
      });
    }

    const entryByPlan = {};
    for (const e of costEntries) {
      if (e.plan_id != null) entryByPlan[e.plan_id] = e;
    }

    // ── 4b. ProductionCostDetail for T7 issuances of THIS item as a material ──
    const issuanceTxRows = txRows.filter(r => Number(r.tran_code) === 7);
    const t7PlanIds = [...new Set(
      issuanceTxRows.map(r => parseInt(r.rmk5, 10)).filter(n => !isNaN(n))
    )];

    let issuanceCostDetails = [];
    if (t7PlanIds.length > 0) {
      issuanceCostDetails = await prisma.productionCostDetail.findMany({
        where: {
          material_id: itcd,
          entry: { plan_id: { in: t7PlanIds } },
        },
        select: {
          qty:              true,
          unit_cost:        true,
          total_cost:       true,
          actual_qty:       true,
          actual_unit_cost: true,
          actual_cost:      true,
          entry: { select: { plan_id: true } },
        },
      });
    }

    const pcdByIssuancePlan = {};
    for (const d of issuanceCostDetails) {
      if (d.entry?.plan_id != null) pcdByIssuancePlan[d.entry.plan_id] = d;
    }

    // ── 5. BOM from productionPlanDetail ────────────────────────────────────
    const planRows = await prisma.productionPlanMaster.findMany({
      where: {
        finished_id: itcd,
        status: "Posted",
        dated: { gte: startDate, lt: endDate },
      },
      select: {
        id: true,
        qty: true,
        dated: true,
        productionPlanDetail: {
          select: {
            material_id: true,
            material_qty: true,
            material_percentage: true,
            material_desc: true,
            sno: true,
            item: { select: { itcd: true, item: true, code: true } },
          },
          orderBy: { sno: "asc" },
        },
      },
      orderBy: { dated: "asc" },
    });

    // ── 6. Assemble costing_details ─────────────────────────────────────────
    const purchases   = txRows.filter(r => Number(r.tran_code) === 4);
    const purchRets   = txRows.filter(r => Number(r.tran_code) === 9);
    const dispatches  = txRows.filter(r => Number(r.tran_code) === 6);
    const issuances   = txRows.filter(r => Number(r.tran_code) === 7);
    const productions = t8Rows;

    const sumQtyAmt = (rows, amtField = null) => {
      let qty = 0, amount = 0;
      for (const r of rows) {
        qty    += Number(r.qty || 0);
        amount += amtField ? Number(r[amtField] || 0) : Number(r.damt || r.camt || 0);
      }
      return { qty, amount };
    };

    const purchTotal    = sumQtyAmt(purchases,  "damt");  // T4: debit amount
    const purchRetTotal = sumQtyAmt(purchRets,  "camt");  // T9: credit amount
    const prodTotal     = sumQtyAmt(productions);         // T8: re-valued below
    const issTotal      = sumQtyAmt(issuances);
    const dispTotal     = sumQtyAmt(dispatches, "camt");  // T6: credit amount

    const openingQty   = Number(opening?.opening_qty   || 0);
    const openingValue = Number(opening?.opening_value || 0);

    // CC overhead totals from production entries
    const periodCcCost = costEntries.reduce((s, e) => s + Number(e.cc_cost || 0), 0);
    const periodCcQty  = costEntries.reduce((s, e) => s + Number(e.qty_costed || 0), 0);
    const periodCcRate = periodCcQty > 0 ? periodCcCost / periodCcQty : 0;

    const openingCcRate = Number(opening?.cc_rate || 0);
    const openingCcCost = Number(opening?.cc_cost || 0);

    // Actual material cost from PCE (actual_issued_cost preferred over total_cost)
    const prodActualAmount = costEntries.length > 0
      ? costEntries.reduce((s, e) => s + Number(e.actual_issued_cost ?? e.total_cost ?? 0), 0)
      : prodTotal.amount;

    const blendedQty   = openingQty + purchTotal.qty - purchRetTotal.qty + prodTotal.qty;
    const blendedValue = openingValue + purchTotal.amount - purchRetTotal.amount
                       + prodActualAmount + periodCcCost;
    const blendedRate  = blendedQty > 0 ? blendedValue / blendedQty : 0;

    const closingQty   = blendedQty - issTotal.qty - dispTotal.qty;
    const closingValue = closingQty * blendedRate;

    // ── Mappers ─────────────────────────────────────────────────────────────
    const mapTx = (r) => ({
      tran_id: Number(r.tran_id),
      date:    r.dated ? new Date(r.dated).toISOString() : null,
      qty:     Number(r.qty    || 0),
      ref:     r.invoice_no || (r.vr_no ? `#${r.vr_no}` : ""),
      rate:    Number(r.rate   || 0),
      amount:  Number(r.damt || r.camt || 0),
    });

    const mapT6 = (r) => {
      const qty      = Number(r.qty  || 0);
      const saleRate = Number(r.rate || 0);
      const saleAmt  = Number(r.camt || r.damt || 0);
      return {
        tran_id:   Number(r.tran_id),
        date:      r.dated ? new Date(r.dated).toISOString() : null,
        qty,
        ref:       r.invoice_no || (r.vr_no ? `#${r.vr_no}` : ""),
        sale_rate: saleRate,
        sale_amt:  saleAmt,
        cost_rate: blendedRate,
        cost_amt:  qty * blendedRate,
        rate:      saleRate,
        amount:    saleAmt,
      };
    };

    const mapRetTx = (r) => ({
      tran_id: Number(r.tran_id),
      date:    r.dated ? new Date(r.dated).toISOString() : null,
      qty:     Number(r.qty  || 0),
      ref:     r.invoice_no || (r.vr_no ? `#${r.vr_no}` : ""),
      rate:    Number(r.rate || 0),
      amount:  Number(r.camt || 0),
    });

    const mapT8 = (r) => {
      const planId = parseInt(r.rmk5, 10);
      const entry  = entryByPlan[planId];
      const qty    = Number(r.qty || 0);
      const rmRate = Number(entry?.actual_cost_per_unit ?? entry?.cost_per_unit ?? r.rate ?? 0);
      const rmAmt  = Number(entry?.actual_issued_cost   ?? entry?.total_cost    ?? r.damt ?? r.camt ?? 0);
      const ccRate = Number(entry?.cc_rate || 0);
      const ccAmt  = Number(entry?.cc_cost || 0);
      return {
        tran_id:     Number(r.tran_id),
        date:        r.dated ? new Date(r.dated).toISOString() : null,
        qty,
        ref:         r.invoice_no || (r.vr_no ? `#${r.vr_no}` : ""),
        proc_ord_no: r.rmk5 ? String(r.rmk5) : "",
        rm_rate:     rmRate,
        rm_amt:      rmAmt,
        cc_rate:     ccRate,
        cc_amt:      ccAmt,
        rate:        rmRate + ccRate,
        amount:      rmAmt + ccAmt,
      };
    };

    const mapT7 = (r) => {
      const planId = parseInt(r.rmk5, 10);
      const detail = pcdByIssuancePlan[planId];
      const qty    = Number(r.qty || 0);
      const rate   = Number(detail?.actual_unit_cost ?? detail?.unit_cost ?? r.rate ?? 0);
      const amount = rate > 0 ? qty * rate : Number(r.damt ?? r.camt ?? 0);
      return {
        tran_id:     Number(r.tran_id),
        date:        r.dated ? new Date(r.dated).toISOString() : null,
        qty,
        ref:         r.invoice_no || (r.vr_no ? `#${r.vr_no}` : ""),
        rate,
        amount,
        item_name:   itemRow.item,
        item_itcd:   itcd,
        item_code:   itemRow.code || "",
        proc_ord_no: r.rmk5 ? String(r.rmk5) : "",
      };
    };

    // ── 7. Production details built from PCE details ─────────────────────────
    // Uses actual_qty / actual_unit_cost / actual_cost directly — no re-fetch needed.
    const productionDetails = planIdsInt.map((planId) => {
      const t8Match = productions.find(r => parseInt(r.rmk5, 10) === planId);
      const entry   = entryByPlan[planId];
      const ccCost  = Number(entry?.cc_cost || 0);
      const ccRate  = Number(entry?.cc_rate || 0);
      const pceMatAmt = Number(entry?.actual_issued_cost ?? entry?.total_cost ?? 0);

      const materials = (entry?.details ?? []).map(d => ({
        material_itcd: d.material_id,
        material_name: d.material_name,
        material_code: d.material_code || "",
        qty:    Number(d.actual_qty       ?? d.qty        ?? 0),
        rate:   Number(d.actual_unit_cost ?? d.unit_cost  ?? 0),
        amount: Number(d.actual_cost      ?? d.total_cost ?? 0),
      }));

      const matTotal = materials.reduce(
        (s, m) => ({ qty: s.qty + m.qty, amount: s.amount + m.amount }),
        { qty: 0, amount: 0 }
      );

      return {
        proc_ord_no: String(planId),
        date:        t8Match?.dated ? new Date(t8Match.dated).toISOString() : null,
        item_type:   entry?.item_type || null,
        materials,
        cc_cost:     ccCost,
        cc_rate:     ccRate,
        total: {
          qty:    Number(t8Match?.qty || entry?.qty_costed || 0),
          amount: (pceMatAmt > 0 ? pceMatAmt : matTotal.amount) + ccCost,
        },
      };
    });

    for (const r of productions) {
      const planId = parseInt(r.rmk5, 10);
      if (!isNaN(planId) && !entryByPlan[planId]) {
        productionDetails.push({
          proc_ord_no: r.rmk5 || "Orphan",
          date:        r.dated ? new Date(r.dated).toISOString() : null,
          item_type:   null,
          materials:   [],
          cc_cost:     0,
          cc_rate:     0,
          total: { qty: Number(r.qty || 0), amount: Number(r.damt || r.camt || 0) },
        });
      }
    }

    const grandTotal = productionDetails.reduce(
      (acc, g) => ({ qty: acc.qty + g.total.qty, amount: acc.amount + g.total.amount }),
      { qty: 0, amount: 0 }
    );
    const grandRate = grandTotal.qty > 0 ? grandTotal.amount / grandTotal.qty : 0;

    // ── 8. BOM — active BomMaster (instructions = 'A') ─────────────────────
    const activeBomMaster = await prisma.bomMaster.findFirst({
      where: { finished_id: itcd, instructions: "A" },
      select: {
        id:    true,
        dated: true,
        bomDetails: {
          select: {
            id:                  true,
            material_id:         true,
            material_percentage: true,
            item: { select: { itcd: true, item: true, code: true, unit: true } },
          },
        },
      },
      orderBy: { dated: "desc" },
    });

    let originalBom = [];
    if (activeBomMaster?.bomDetails?.length) {
      // Rate map: PCE actuals first (already fetched), blended fallback for BOM-only materials
      const rateByMat = {};
      for (const e of costEntries) {
        for (const d of e.details ?? []) {
          if (d.material_id && !(d.material_id in rateByMat)) {
            rateByMat[d.material_id] = Number(d.actual_unit_cost ?? d.unit_cost ?? 0);
          }
        }
      }

      const bomMaterialIds = activeBomMaster.bomDetails.map(d => d.material_id);
      const bomOnlyMids    = bomMaterialIds.filter(mid => !(mid in rateByMat));

      if (bomOnlyMids.length > 0) {
        const [bomOpenings, bomPurchRows] = await Promise.all([
          getOpening(month, year, { itcds: bomOnlyMids }),
          prisma.transactions.findMany({
            where: {
              itcd:        { in: bomOnlyMids },
              sub_tran_id: { not: 3 },
              transactionsMaster: {
                dated:     { gte: startDate, lt: endDate },
                tran_code: { in: [4, 5] },
              },
            },
            select: {
              itcd: true,
              qty:  true,
              damt: true,
              camt: true,
              transactionsMaster: { select: { tran_code: true } },
            },
          }),
        ]);

        const bomOpeningMap = {};
        for (const r of bomOpenings) {
          bomOpeningMap[Number(r.itcd)] = {
            qty:   Number(r.opening_qty   || 0),
            rate:  Number(r.opening_rate  || 0),
            value: Number(r.opening_value || 0),
          };
        }

        const bomPurchAgg = {};
        const bomRetAgg   = {};
        for (const r of bomPurchRows) {
          const mid = Number(r.itcd);
          const tc  = Number(r.transactionsMaster.tran_code);
          if (tc === 4) {
            if (!bomPurchAgg[mid]) bomPurchAgg[mid] = { qty: 0, val: 0 };
            bomPurchAgg[mid].qty += Number(r.qty  || 0);
            bomPurchAgg[mid].val += Number(r.damt || 0);
          } else if (tc === 9) {
            if (!bomRetAgg[mid]) bomRetAgg[mid] = { qty: 0, val: 0 };
            bomRetAgg[mid].qty += Number(r.qty  || 0);
            bomRetAgg[mid].val += Number(r.camt || 0);
          }
        }

        for (const mid of bomOnlyMids) {
          const op = bomOpeningMap[mid] || { qty: 0, rate: 0, value: 0 };
          const pu = bomPurchAgg[mid]   || { qty: 0, val: 0 };
          const re = bomRetAgg[mid]     || { qty: 0, val: 0 };
          const totalQty = op.qty + pu.qty - re.qty;
          const totalVal = op.value + pu.val - re.val;
          rateByMat[mid] = totalQty > 0 ? totalVal / totalQty : op.rate;
        }

        const zeroMids = bomOnlyMids.filter(mid => !rateByMat[mid]);
        if (zeroMids.length > 0) {
          const fbRates = await getLatestOpeningRates(month, year, { itcds: zeroMids, positiveOnly: true });
          for (const [mid, r] of fbRates) {
            if (!rateByMat[mid]) rateByMat[mid] = Number(r.opening_rate);
          }
        }
      }

      const rawList = activeBomMaster.bomDetails.map(d => {
        const mid  = d.material_id;
        const pct  = Number(d.material_percentage || 0);
        const rate = rateByMat[mid] || 0;
        const cost = (pct / 100) * rate;
        return {
          itcd:       mid,
          name:       d.item?.item || `Item ${mid}`,
          code:       d.item?.code || "",
          unit:       d.item?.unit || "",
          percentage: pct,
          rate,
          cost,
        };
      });

      const totalBomCost = rawList.reduce((s, b) => s + b.cost, 0);
      originalBom = rawList.map(b => ({
        ...b,
        share_pct: totalBomCost > 0 ? (b.cost / totalBomCost) * 100 : 0,
      }));
    }

    // ── 8b. Actual-used BOM (from productionPlanDetail) ─────────────────────
    const bomMap = {};
    for (const plan of planRows) {
      for (const d of plan.productionPlanDetail) {
        const mid = d.material_id;
        if (!mid) continue;
        if (!bomMap[mid]) {
          bomMap[mid] = {
            itcd:             mid,
            item_description: d.item?.item || d.material_desc || `Item ${mid}`,
            code:             d.item?.code || "",
            qty:              0,
            cost:             0,
          };
        }
        bomMap[mid].qty  += Number(d.material_qty || 0);
        bomMap[mid].cost += Number(d.material_qty || 0) * blendedRate;
      }
    }
    const bomList      = Object.values(bomMap);
    const totalBomCost = bomList.reduce((s, b) => s + b.cost, 0);
    const bom = bomList.map(b => ({
      itcd:             b.itcd,
      item_description: b.item_description,
      code:             b.code,
      qty:              b.qty,
      pct:              totalBomCost > 0 ? (b.cost / totalBomCost) * 100 : 0,
    }));

    // ── 9. Response ─────────────────────────────────────────────────────────
    const mappedProductions = productions.map(mapT8);
    const mappedIssuances   = issuances.map(mapT7);
    const issAmountActual   = mappedIssuances.reduce((s, r) => s + r.amount, 0);

    return NextResponse.json({
      item: {
        itcd:  itemRow.itcd,
        item:  itemRow.item,
        code:  itemRow.code,
        ic_id: itemRow.ic_id,
        unit:  itemRow.unit,
      },
      costing_details: {
        opening: {
          qty:     openingQty,
          rate:    Number(opening?.opening_rate || 0),
          value:   openingValue,
          cc_rate: openingCcRate,
          cc_cost: openingCcCost,
        },
        purchases:             purchases.map(mapTx),
        purchase_total:        purchTotal,
        purchase_returns:      purchRets.map(mapRetTx),
        purchase_return_total: purchRetTotal,
        productions:           mappedProductions,
        production_total: {
          qty:     prodTotal.qty,
          amount:  prodActualAmount,
          cc_cost: periodCcCost,
        },
        blended: {
          qty:   blendedQty,
          rate:  blendedRate,
          value: blendedValue,
        },
        issuances:      mappedIssuances,
        issuance_total: { qty: issTotal.qty, amount: issAmountActual },
        dispatches:     dispatches.map(mapT6),
        dispatch_total: dispTotal,
        closing: {
          qty:   closingQty,
          rate:  blendedRate,
          value: closingValue,
        },
      },
      cc_summary: {
        opening_cc_rate:  openingCcRate,
        opening_cc_cost:  openingCcCost,
        period_cc_rate:   periodCcRate,
        period_cc_cost:   periodCcCost,
        period_cc_qty:    periodCcQty,
        total_cc_cost:    openingCcCost + periodCcCost,
      },
      production_details: productionDetails,
      grand_total: { qty: grandTotal.qty, rate: grandRate, amount: grandTotal.amount },
      bill_of_material: bom,
      original_bom: originalBom,
      bom_master_id: activeBomMaster?.id ?? null,
    });
  } catch (err) {
    console.error("[costing/checking] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
