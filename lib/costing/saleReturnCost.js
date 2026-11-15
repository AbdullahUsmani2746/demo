// lib/costing/saleReturnCost.js
// ============================================================
// Sale returns at the cost of the month they were sold in — Settings →
// Features "saleReturn.costAtOriginalMonth" (ported from Accounting
// lib/costing/costRates.js, rewritten for per-godown opening stock).
//
//   September: dispatch costed at the September rate (COGS)
//   October:   return of that dispatch → stock comes back at the SAME
//              September rate; COGS reverses it at that cost
//
// A return finds its dispatch through dispatch_no (tran_code 6; a trial
// billing part shares the number — the earliest date counts). The month's
// rate: locking a month writes the NEXT month's opening rates
// (lib/openingStockGenerate.js), so those rates are the month's closing cost;
// a month not locked yet is computed from its own Stock Activity With Rate.
// A return of a dispatch from before the system started (ref_dispatch_no,
// no dispatch_no) carries its cost on each line (Transactions.cost_rate): the
// system-start opening rate, or typed when the item has none.
// Same-month returns are untouched: they net against that month's sales.
//
// Opening rates are read only through lib/openingStock.js.
// ============================================================
import prisma from "@/lib/prisma";
import { getOpeningRates, getFirstOpeningPeriod } from "@/lib/openingStock";
import { getProductionSetup, isFinishedCategory } from "@/lib/production/setup";

export const COST_AT_ORIGINAL_MONTH_FEATURE = "saleReturn.costAtOriginalMonth";

const n = (v) => Number(v || 0);
const ZERO = { total_rate: 0, cc_rate: 0, rm_rate: 0 };
const monthLabel = (m, y) => `${String(m).padStart(2, "0")}/${y}`;
const ints = (list) => [...new Set((list || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];

/** Map<itcd, ic_id> */
async function categoriesOf(itcds) {
  const ids = ints(itcds);
  if (!ids.length) return new Map();
  const rows = await prisma.item.findMany({ where: { itcd: { in: ids } }, select: { itcd: true, ic_id: true } });
  return new Map(rows.map((r) => [Number(r.itcd), r.ic_id]));
}

/** Opening-rate rows → Map<itcd, {total_rate, cc_rate, rm_rate}>; CC only for finished goods (as the COGS report). */
async function splitRates(rateMap, itcds) {
  const setup = await getProductionSetup();
  const cats = await categoriesOf(itcds);
  const out = new Map();
  for (const [itcd, r] of rateMap) {
    const total_rate = n(r.opening_rate);
    if (!(total_rate > 0)) continue;
    const cc_rate = isFinishedCategory(setup, cats.get(Number(itcd))) ? n(r.cc_rate) : 0;
    out.set(Number(itcd), { total_rate, cc_rate, rm_rate: total_rate - cc_rate });
  }
  return out;
}

/**
 * The cost-rate split of one Stock Activity With Rate row — the same one the
 * COGS report uses, so the reversal and the report always agree.
 */
export function cogsCostSplit(row, setup) {
  const total_rate = n(row.avg_rate_after_purchase);
  // carries_cc: set by the stock activity row (CC categories of that month, lib/costing/ccPolicy.js)
  const carries = row.carries_cc ?? isFinishedCategory(setup, row.category_id);
  const cc_rate = carries ? n(row.cc_rate || row.opening_cc_rate) : 0;
  return { total_rate, cc_rate, rm_rate: total_rate - cc_rate };
}

/** First month with opening rates, and those rates (only items with a rate > 0). */
export async function getSystemStartRates(itcds) {
  const start = await getFirstOpeningPeriod();
  const ids = ints(itcds);
  if (!start || !ids.length) return { start, rates: new Map() };
  const raw = await getOpeningRates(start.month, start.year, { itcds: ids });
  return { start, rates: await splitRates(raw, ids) };
}

/**
 * Cost rates of one month per item.
 *   Locked (next month's opening rates exist) → those rates.
 *   Otherwise → computed from that month's Stock Activity With Rate.
 * @param {(filters) => Promise<object[]>} computeMonth  Stock Activity With Rate runner
 */
export async function getMonthCostRates({ month, year, itcds }, computeMonth) {
  const ids = ints(itcds);
  if (!ids.length) return { locked: false, rates: new Map() };
  const next = month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
  const stored = await getOpeningRates(next.month, next.year, { itcds: ids });
  if (stored.size) return { locked: true, rates: await splitRates(stored, ids) };

  const setup = await getProductionSetup();
  const filters = {
    dateFrom: new Date(year, month - 1, 1, 0, 0, 0, 0),
    dateTo: new Date(year, month, 0, 23, 59, 59, 999),
    showZeroStock: "true",
  };
  const rows = ids.length <= 5
    ? (await Promise.all(ids.map((itcd) => computeMonth({ ...filters, product: String(itcd) })))).flat()
    : await computeMonth(filters);
  const want = new Set(ids);
  return {
    locked: false,
    rates: new Map(rows.filter((r) => want.has(Number(r.product_code))).map((r) => [Number(r.product_code), cogsCostSplit(r, setup)])),
  };
}

/** Map<dispatch_no, Date> — the date each dispatch was made (earliest part). */
async function dispatchDates(dispatchNos) {
  const nos = ints(dispatchNos);
  if (!nos.length) return new Map();
  const rows = await prisma.transactionsMaster.findMany({
    where: { tran_code: 6, dispatch_no: { in: nos } },
    select: { dispatch_no: true, dated: true },
  });
  const out = new Map();
  for (const r of rows) {
    const k = Number(r.dispatch_no);
    if (!out.has(k) || r.dated < out.get(k)) out.set(k, r.dated);
  }
  return out;
}

const returnLineWhere = { qty: { not: null }, itcd: { not: null }, OR: [{ sub_tran_id: null }, { sub_tran_id: { not: 3 } }] };

/**
 * Cost of one Sale Return, line by line, at the rate of the month its
 * dispatch was sold in (GET /api/voucher/sale-return-cost).
 */
export async function getSaleReturnCost(tranId, computeMonth) {
  const ret = await prisma.transactionsMaster.findFirst({
    where: { tran_id: Number(tranId), tran_code: 10 },
    select: { tran_id: true, dated: true, dispatch_no: true, ref_dispatch_no: true },
  });
  if (!ret) return { error: "Sale Return not found" };
  const lines = await prisma.transactions.findMany({
    where: { tran_id: ret.tran_id, ...returnLineWhere },
    select: { itcd: true, qty: true, cost_rate: true, itemDetails: { select: { item: true, code: true } } },
    orderBy: { id: "asc" },
  });
  const itcds = lines.map((l) => l.itcd);
  const shape = (l, r, extra = {}) => {
    const qty = n(l.qty);
    return {
      itcd: l.itcd, item: l.itemDetails?.item ?? "", code: l.itemDetails?.code ?? "", qty,
      total_rate: r.total_rate, rm_rate: r.rm_rate, cc_rate: r.cc_rate,
      cost_value: qty * r.total_rate, rm_value: qty * r.rm_rate, cc_value: qty * r.cc_rate,
      rate_found: r.total_rate > 0, ...extra,
    };
  };
  const totals = (out) => {
    const sum = (k) => out.reduce((s, l) => s + l[k], 0);
    return { qty: sum("qty"), cost_value: sum("cost_value"), rm_value: sum("rm_value"), cc_value: sum("cc_value") };
  };

  if (!ret.dispatch_no && String(ret.ref_dispatch_no || "").trim()) {
    const { start, rates } = await getSystemStartRates(itcds);
    const out = lines.map((l) => {
      const total_rate = n(l.cost_rate);
      const sr = rates.get(Number(l.itcd));
      const cc_rate = sr ? Math.min(sr.cc_rate, total_rate) : 0;
      return shape(l, { total_rate, cc_rate, rm_rate: total_rate - cc_rate }, { manual: !sr });
    });
    return {
      dispatch_no: null, ref_dispatch_no: ret.ref_dispatch_no, legacy: true, locked: true, same_month: false,
      source_month: start ? `Before ${monthLabel(start.month, start.year)}` : "Before system start",
      lines: out, totals: totals(out),
    };
  }
  if (!ret.dispatch_no) return { dispatch_no: null, lines: [], message: "No dispatch is linked to this return, so its cost cannot be traced." };

  const saleDate = (await dispatchDates([ret.dispatch_no])).get(Number(ret.dispatch_no));
  if (!saleDate) return { dispatch_no: ret.dispatch_no, lines: [], message: `Dispatch ${ret.dispatch_no} was not found.` };
  const month = saleDate.getMonth() + 1;
  const year = saleDate.getFullYear();
  const { locked, rates } = await getMonthCostRates({ month, year, itcds }, computeMonth);
  const out = lines.map((l) => shape(l, rates.get(Number(l.itcd)) ?? ZERO));
  return {
    dispatch_no: ret.dispatch_no, sale_date: saleDate, source_month: monthLabel(month, year),
    same_month: month === ret.dated.getMonth() + 1 && year === ret.dated.getFullYear(),
    locked, legacy: false, lines: out, totals: totals(out),
  };
}

/**
 * Sale returns dated in [dateFrom, dateTo] whose dispatch was made before
 * monthStart (or before the system started), valued at their original cost.
 * @returns Map<itcd, { qty, sale_amount, cost_value, cc_value, rm_value, sources: string[] }>
 */
export async function getPriorMonthReturns({ dateFrom, dateTo, monthStart, product, category, godown }, computeMonth) {
  const out = new Map();
  if (!dateFrom || !dateTo) return out;
  const masters = await prisma.transactionsMaster.findMany({
    where: {
      tran_code: 10,
      dated: { gte: dateFrom, lte: dateTo },
      ...(godown ? { OR: [{ godown: parseInt(godown, 10) }, { godown2: parseInt(godown, 10) }] } : {}),
    },
    select: { tran_id: true, dispatch_no: true, ref_dispatch_no: true },
  });
  if (!masters.length) return out;
  const dates = await dispatchDates(masters.map((m) => m.dispatch_no));
  const sourceOf = new Map(); // tran_id → "legacy" | { month, year }
  for (const m of masters) {
    if (m.dispatch_no) {
      const d = dates.get(Number(m.dispatch_no));
      if (d && d < monthStart) sourceOf.set(m.tran_id, { month: d.getMonth() + 1, year: d.getFullYear() });
    } else if (String(m.ref_dispatch_no || "").trim()) {
      sourceOf.set(m.tran_id, "legacy");
    }
  }
  if (!sourceOf.size) return out;

  const lines = await prisma.transactions.findMany({
    where: {
      tran_id: { in: [...sourceOf.keys()] },
      ...returnLineWhere,
      ...(product ? { itcd: parseInt(product, 10) } : {}),
      ...(category ? { itemDetails: { ic_id: parseInt(category, 10) } } : {}),
    },
    select: { tran_id: true, itcd: true, qty: true, damt: true, cost_rate: true },
  });
  if (!lines.length) return out;

  const acc = (itcd) => {
    if (!out.has(itcd)) out.set(itcd, { qty: 0, sale_amount: 0, cost_value: 0, cc_value: 0, rm_value: 0, sources: [] });
    return out.get(itcd);
  };

  // Dispatches from before system start: each line's own cost rate
  const legacy = lines.filter((l) => sourceOf.get(l.tran_id) === "legacy");
  if (legacy.length) {
    const { start, rates } = await getSystemStartRates(legacy.map((l) => l.itcd));
    const label = start ? `Before ${monthLabel(start.month, start.year)}` : "Before system start";
    for (const l of legacy) {
      const itcd = Number(l.itcd);
      const qty = n(l.qty);
      const cost = qty * n(l.cost_rate);
      const sr = rates.get(itcd);
      const cc = sr ? Math.min(qty * sr.cc_rate, cost) : 0;
      const a = acc(itcd);
      a.qty += qty; a.sale_amount += n(l.damt); a.cost_value += cost; a.cc_value += cc; a.rm_value += cost - cc;
      a.sources.push(label);
    }
  }

  // Earlier months: that month's rate (one rate lookup per source month)
  const byMonth = new Map();
  for (const l of lines) {
    const s = sourceOf.get(l.tran_id);
    if (!s || s === "legacy") continue;
    const key = `${s.year}-${s.month}`;
    if (!byMonth.has(key)) byMonth.set(key, { ...s, lines: [] });
    byMonth.get(key).lines.push(l);
  }
  for (const { month, year, lines: ls } of byMonth.values()) {
    const { rates } = await getMonthCostRates({ month, year, itcds: ls.map((l) => l.itcd) }, computeMonth);
    for (const l of ls) {
      const itcd = Number(l.itcd);
      const r = rates.get(itcd) ?? ZERO;
      const qty = n(l.qty);
      const a = acc(itcd);
      a.qty += qty; a.sale_amount += n(l.damt);
      a.cost_value += qty * r.total_rate; a.cc_value += qty * r.cc_rate; a.rm_value += qty * r.rm_rate;
      a.sources.push(monthLabel(month, year));
    }
  }
  return out;
}
