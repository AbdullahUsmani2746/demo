// lib/openingStock.js
// ============================================================
// Single access layer for monthly opening stock.
//
// Two tables back it:
//   MonthlyOpeningStock  (month, year, itcd, godown) → opening_qty
//   MonthlyOpeningRate   (month, year, itcd)         → opening_rate, cc_rate, rm_rate
//
// Quantity is per godown; rate is per item. "All godowns" is always
// SUM(opening_qty) — there is no stored aggregate row. Values
// (opening_value, rm_value, cc_cost) are derived here, never stored.
//
// Every route/report that needs opening stock goes through these helpers
// (or the `openingSql` fragment for raw-SQL CTEs). Do not query the two
// Prisma models directly elsewhere.
// ============================================================
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const num = (v) => Number(v || 0);

// Merge a rate row and a summed qty into the flat shape every consumer uses.
function mergeRow(itcd, rate, qty, extra = {}) {
  const opening_qty = num(qty);
  const opening_rate = num(rate?.opening_rate);
  const cc_rate = num(rate?.cc_rate);
  // rm_rate falls back to opening_rate - cc_rate when not stored.
  const rm_rate = rate?.rm_rate != null ? num(rate.rm_rate) : opening_rate - cc_rate;
  return {
    itcd,
    opening_qty,
    opening_rate,
    cc_rate,
    rm_rate,
    opening_value: opening_qty * opening_rate,
    cc_cost: opening_qty * cc_rate,
    rm_value: opening_qty * rm_rate,
    ...extra,
  };
}

// ── Readers ──────────────────────────────────────────────────────────────────

/** Map<itcd, {opening_rate, cc_rate, rm_rate}> for a month. */
export async function getOpeningRates(month, year, { itcds, itemWhere } = {}) {
  const rows = await prisma.monthlyOpeningRate.findMany({
    where: {
      month,
      year,
      ...(itcds && { itcd: { in: itcds } }),
      ...(itemWhere && { item: itemWhere }),
    },
    select: { itcd: true, opening_rate: true, cc_rate: true, rm_rate: true },
  });
  return new Map(rows.map((r) => [r.itcd, r]));
}

/**
 * Map<itcd, qty> for a month. With `godown` → that godown only;
 * without → summed across all godowns.
 */
export async function getOpeningQty(month, year, { itcds, godown, itemWhere } = {}) {
  const g = godown ? parseInt(godown) : null;
  const rows = await prisma.monthlyOpeningStock.groupBy({
    by: ["itcd"],
    where: {
      month,
      year,
      ...(g && { godown: g }),
      ...(itcds && { itcd: { in: itcds } }),
      ...(itemWhere && { item: itemWhere }),
    },
    _sum: { opening_qty: true },
  });
  return new Map(rows.map((r) => [r.itcd, num(r._sum.opening_qty)]));
}

/**
 * Merged rows [{ itcd, opening_qty, opening_rate, cc_rate, rm_rate,
 * opening_value, cc_cost, rm_value }] — one per item, union of items that
 * have a rate OR a qty. `godown` narrows qty to one godown; rate is
 * item-level either way. `include` adds `item` (with itemCategories).
 */
export async function getOpening(month, year, opts = {}) {
  const { include } = opts;
  const [rates, qtys] = await Promise.all([
    getOpeningRates(month, year, opts),
    getOpeningQty(month, year, opts),
  ]);
  const itcds = new Set([...rates.keys(), ...qtys.keys()]);

  let itemMap = null;
  if (include?.item && itcds.size) {
    const items = await prisma.item.findMany({
      where: { itcd: { in: [...itcds] } },
      include: { itemCategories: true },
    });
    itemMap = new Map(items.map((i) => [i.itcd, i]));
  }

  return [...itcds]
    .sort((a, b) => a - b)
    .map((itcd) =>
      mergeRow(itcd, rates.get(itcd), qtys.get(itcd), itemMap ? { item: itemMap.get(itcd) || null } : {}),
    );
}

/** Same as getOpening but keyed: Map<itcd, row>. */
export async function getOpeningMap(month, year, opts = {}) {
  const rows = await getOpening(month, year, opts);
  return new Map(rows.map((r) => [r.itcd, r]));
}

/** One item, merged. Returns null when neither a rate nor a qty exists. */
export async function getOpeningOne(month, year, itcd, { godown } = {}) {
  const rows = await getOpening(month, year, { itcds: [itcd], godown });
  return rows[0] || null;
}

/**
 * Per-godown breakdown: one row per (itcd, godown) with the item rate
 * merged in. Items that have a rate but no qty in any godown are omitted
 * (there is no godown to attribute them to).
 */
export async function getOpeningByGodown(month, year, { itcds, godown, itemWhere, include } = {}) {
  const g = godown ? parseInt(godown) : null;
  const [rates, qtyRows] = await Promise.all([
    getOpeningRates(month, year, { itcds, itemWhere }),
    prisma.monthlyOpeningStock.findMany({
      where: {
        month,
        year,
        ...(g && { godown: g }),
        ...(itcds && { itcd: { in: itcds } }),
        ...(itemWhere && { item: itemWhere }),
      },
      include: {
        godownDetails: { select: { id: true, godown: true } },
        ...(include?.item && { item: { include: { itemCategories: true } } }),
      },
      orderBy: [{ itcd: "asc" }, { godown: "asc" }],
    }),
  ]);
  return qtyRows.map((q) =>
    mergeRow(q.itcd, rates.get(q.itcd), q.opening_qty, {
      godown: q.godown,
      godown_name: q.godownDetails?.godown || "",
      ...(include?.item && { item: q.item }),
    }),
  );
}

/**
 * Latest known rate per item at or before (month, year), for items whose
 * rate for the exact month is missing. Map<itcd, {opening_rate, cc_rate, rm_rate}>.
 */
export async function getLatestOpeningRates(month, year, { itcds, positiveOnly = false } = {}) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (itcd) itcd, opening_rate, cc_rate, rm_rate
    FROM "MonthlyOpeningRate"
    WHERE (year < ${year} OR (year = ${year} AND month <= ${month}))
      ${itcds?.length ? Prisma.sql`AND itcd IN (${Prisma.join(itcds)})` : Prisma.empty}
      ${positiveOnly ? Prisma.sql`AND opening_rate > 0` : Prisma.empty}
    ORDER BY itcd, year DESC, month DESC
  `;
  return new Map(rows.map((r) => [Number(r.itcd), r]));
}

/**
 * Most recent month that has a stored opening qty and whose 1st is on or
 * before `date` → { month, year } or null when nothing has been generated
 * yet. Reports use it as the anchor to roll stock forward from, instead of
 * summing every transaction since the beginning of time.
 */
export async function getLatestOpeningPeriod(date) {
  const d = date instanceof Date ? date : new Date(date);
  const row = await prisma.monthlyOpeningStock.findFirst({
    where: {
      OR: [
        { year: { lt: d.getFullYear() } },
        { year: d.getFullYear(), month: { lte: d.getMonth() + 1 } },
      ],
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { month: true, year: true },
  });
  return row ? { month: row.month, year: row.year } : null;
}

/**
 * First month the system holds opening rates for ({ month, year } or null) —
 * the system start. Its rates are the cost of anything sold before it (e.g. a
 * sale return of a dispatch from before go-live, lib/costing/saleReturnCost.js).
 */
export async function getFirstOpeningPeriod() {
  const row = await prisma.monthlyOpeningRate.findFirst({
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: { month: true, year: true },
  });
  return row ? { month: row.month, year: row.year } : null;
}

// ── Raw-SQL fragment ─────────────────────────────────────────────────────────

/**
 * Quantity-only SELECT fragment for a CTE:
 *   WITH opening AS (${openingQtySql(month, year, { godown })}) ...
 * Columns: itcd, opening_qty. `godown` → that godown's rows only; without →
 * summed over all godowns. One row per item that has a qty.
 */
export function openingQtySql(month, year, { godown } = {}) {
  return Prisma.sql`
    SELECT itcd, SUM(opening_qty) AS opening_qty
    FROM "MonthlyOpeningStock"
    WHERE month = ${month} AND year = ${year}
      ${godown ? Prisma.sql`AND godown = ${Number(godown)}` : Prisma.empty}
    GROUP BY itcd
  `;
}

/**
 * Quantity per (item, godown) SELECT fragment for a CTE — columns: itcd,
 * godown, opening_qty. For reports that roll each godown forward from its
 * opening.
 */
export function openingQtyByGodownSql(month, year) {
  return Prisma.sql`
    SELECT itcd, godown, SUM(opening_qty) AS opening_qty
    FROM "MonthlyOpeningStock"
    WHERE month = ${month} AND year = ${year}
    GROUP BY itcd, godown
  `;
}

/**
 * SELECT fragment for use inside a CTE:
 *   WITH opening AS (${openingSql(month, year)}) ...
 * Columns: itcd, opening_qty (summed over godowns), opening_rate, cc_rate,
 * rm_rate, opening_value. One row per item that has a rate or a qty.
 */
export function openingSql(month, year) {
  return Prisma.sql`
    SELECT
      COALESCE(r.itcd, q.itcd)                                   AS itcd,
      COALESCE(q.opening_qty, 0)                                 AS opening_qty,
      COALESCE(r.opening_rate, 0)                                AS opening_rate,
      COALESCE(r.cc_rate, 0)                                     AS cc_rate,
      COALESCE(r.rm_rate, r.opening_rate - COALESCE(r.cc_rate, 0), 0) AS rm_rate,
      COALESCE(q.opening_qty, 0) * COALESCE(r.opening_rate, 0)   AS opening_value
    FROM (
      SELECT itcd, opening_rate, cc_rate, rm_rate
      FROM "MonthlyOpeningRate"
      WHERE month = ${month} AND year = ${year}
    ) r
    FULL OUTER JOIN (
      SELECT itcd, SUM(opening_qty) AS opening_qty
      FROM "MonthlyOpeningStock"
      WHERE month = ${month} AND year = ${year}
      GROUP BY itcd
    ) q ON q.itcd = r.itcd
  `;
}

// ── Writers ──────────────────────────────────────────────────────────────────

/** Upsert one item's rate for a month. */
export async function upsertOpeningRate(month, year, itcd, { opening_rate, cc_rate, rm_rate }) {
  const data = {
    opening_rate: Number.isFinite(opening_rate) ? opening_rate : 0,
    cc_rate: cc_rate == null ? null : Number.isFinite(cc_rate) ? cc_rate : 0,
    rm_rate: rm_rate == null ? null : Number.isFinite(rm_rate) ? rm_rate : 0,
  };
  return prisma.monthlyOpeningRate.upsert({
    where: { month_year_itcd: { month, year, itcd } },
    update: data,
    create: { month, year, itcd, ...data },
  });
}

/** Upsert one item's qty in one godown for a month. */
export async function upsertOpeningQty(month, year, itcd, godown, opening_qty) {
  const qty = Number.isFinite(opening_qty) ? opening_qty : 0;
  return prisma.monthlyOpeningStock.upsert({
    where: { month_year_itcd_godown: { month, year, itcd, godown } },
    update: { opening_qty: qty },
    create: { month, year, itcd, godown, opening_qty: qty },
  });
}

/**
 * Replace a whole month atomically.
 *   rates: [{ itcd, opening_rate, cc_rate?, rm_rate? }]
 *   qtys:  [{ itcd, godown, opening_qty }]
 * Existing rows for (month, year) are deleted first so re-generating a
 * month never leaves stale items behind. Zero-qty rows are dropped.
 */
export async function replaceOpening(month, year, { rates = [], qtys = [] }) {
  const rateData = rates.map((r) => ({
    month,
    year,
    itcd: Number(r.itcd),
    opening_rate: Number.isFinite(r.opening_rate) ? r.opening_rate : 0,
    cc_rate: r.cc_rate == null ? null : Number.isFinite(r.cc_rate) ? r.cc_rate : 0,
    rm_rate: r.rm_rate == null ? null : Number.isFinite(r.rm_rate) ? r.rm_rate : 0,
  }));
  const qtyData = qtys
    .filter((q) => Number.isFinite(q.opening_qty) && q.opening_qty !== 0)
    .map((q) => ({
      month,
      year,
      itcd: Number(q.itcd),
      godown: Number(q.godown),
      opening_qty: q.opening_qty,
    }));

  await prisma.$transaction(async (tx) => {
    await tx.monthlyOpeningRate.deleteMany({ where: { month, year } });
    await tx.monthlyOpeningStock.deleteMany({ where: { month, year } });
    if (rateData.length) await tx.monthlyOpeningRate.createMany({ data: rateData, skipDuplicates: true });
    if (qtyData.length) await tx.monthlyOpeningStock.createMany({ data: qtyData, skipDuplicates: true });
  });

  return { rates: rateData.length, qtys: qtyData.length };
}
