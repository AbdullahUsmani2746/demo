// lib/reports/materialProcurement.js
//
// Material Procurement — what we hold, what we burn, and what to order.
//
// One row per raw / packaging material:
//   where the stock physically is (factory, production, finished goods),
//   what is landed but not cleared (bond) and what is still at sea (transit),
//   how much was consumed in each month of the period,
//   and from that, whether it needs reordering.
//
// Derived figures, all from the monthly consumption:
//   Avg Cons 6 Month  = consumption in the period / 6   (see AVG_MONTHS)
//   Max Cons 6 Month  = the largest single month
//   Re Order Level    = Max Cons x REORDER_MULTIPLIER
//   Order Qty         = Re Order Level - Total Stock    (blank when negative)
//   Stock Sufficient  = Total Stock / Max Cons          (months of cover)
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getLatestOpeningPeriod, openingQtySql, openingQtyByGodownSql } from "@/lib/openingStock";
import { getProductionSetup, procuredCategoryIds } from "@/lib/production/setup";

// ─────────────────────────────────────────────────────────────────────────────
//  Tuning — everything a user is likely to want moved lives here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which godowns feed each stock column.
 *
 * To move a godown between columns, or add a new one, edit only this map:
 * the SQL pivot, the row fields and the totals are all generated from it.
 * Add a whole new column by adding a key here and a matching entry in
 * components/Reports/config.js.
 *
 * Godown ids (see the Godown setup table):
 *   1 FACTORY   2 PRODUCTION   3 FG-DESPATCH   4 BOND   5 LAB TESTING
 *   6 DIFF-ADJ/WASTAGE   7 PROD-CONSUMED   8 STORES-CONSUMED
 *   9 FG-READY STOCK   10 LAB-REUSEABLE STOCK   11 FG-MULTAN   12 NO PROD DESP
 */
export const STOCK_BUCKETS = {
  stock_factory: { label: "Stock Factory", godowns: [1] },
  stock_prod: { label: "Stock Prod", godowns: [2] },
  stock_fg: { label: "Stock FG", godowns: [3, 9] },
};

// Consumption is always spread over six months even when the chosen period is
// shorter — this is the existing house convention and what the printed report
// has always shown. Change it to `null` to divide by the months in range.
const AVG_MONTHS = 6;

const REORDER_MULTIPLIER = 2;

// Raw material + packaging (Settings → Production setup). Finished and
// semi-finished are not procured.

// Material Issue — what actually consumes raw material.
const CONSUMPTION_TRAN_CODE = 7;

// Stock movement sign convention, as used across the stock reports.
const STOCK_IN_CODES = [4, 8, 10, 12];
const STOCK_OUT_CODES = [5, 6, 7, 9];

const num = (v) => Number(v) || 0;
const round2 = (v) => Number((num(v)).toFixed(2));

/** First day of the month, local time. */
function monthStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** ["2026-04", …] for every month the period touches. */
function monthKeys(from, to) {
  const keys = [];
  const cur = monthStart(from);
  const end = monthStart(to);
  while (cur <= end) {
    keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return keys;
}

/** "2026-04" → "m_2026_04", the row/column field name. */
export const monthField = (key) => `m_${key.replace("-", "_")}`;

/** "2026-04" → "APR-26", the column heading. */
export function monthLabel(key) {
  const [y, m] = key.split("-");
  const names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${names[Number(m) - 1]}-${y.slice(2)}`;
}

/**
 * The reporting period: always the six months ENDING at the month chosen.
 *
 * The user picks one month, not a range — pick September and the report
 * covers April to September, which is what "6 month consumption" has always
 * meant here. A free date range would let someone pick four months and still
 * see the figure divided by six.
 *
 * dateFrom/dateTo are still honoured when no month is given, so an existing
 * saved link or an API caller passing dates keeps working.
 */
export function procurementPeriod(filters = {}) {
  const month = Number(filters.month);
  const year = Number(filters.year);
  const byMonth = month >= 1 && month <= 12 && year > 0;

  let to;
  if (byMonth) {
    to = new Date(year, month, 0); // last day of the chosen month
  } else if (filters.dateTo) {
    to = new Date(filters.dateTo);
  } else {
    to = new Date();
  }
  to.setHours(23, 59, 59, 999);

  let from;
  if (!byMonth && filters.dateFrom) {
    from = new Date(filters.dateFrom);
  } else {
    from = monthStart(to);
    from.setMonth(from.getMonth() - (AVG_MONTHS - 1));
  }
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * Local and imported material are bought on different lead times and
 * different terms, so they are reported as separate sections rather than
 * interleaved and told apart by a column.
 */
const SECTIONS = [
  { key: "LOCAL", label: "Local Purchase" },
  { key: "IMPORTED", label: "Imported" },
  { key: "OTHER", label: "Unclassified" },
];

const sectionKey = (importType) => {
  const t = String(importType || "").trim().toUpperCase();
  if (t === "LOCAL") return "LOCAL";
  if (t === "IMPORTED" || t === "IMPORT") return "IMPORTED";
  return "OTHER";
};

export async function getMaterialProcurementReport(filters = {}) {
  const { from, to } = procurementPeriod(filters);
  const keys = monthKeys(from, to);

  // ── Opening stock ────────────────────────────────────────────────────────
  // The opening snapshot for the chosen month often does not exist — only
  // July 2026 has been generated so far — so this takes the most recent
  // period stored on or before that month instead of showing nothing.
  // Ask for September and you get July's, which is the last real position
  // anyone recorded. getLatestOpeningPeriod does the walk back in one
  // indexed query rather than probing month by month, and returns null when
  // no period exists at all, in which case opening stock reads 0.
  const openingPeriod = await getLatestOpeningPeriod(to);
  // Stock = that opening (per godown) + movements from its 1st up to the end
  // of the chosen month. No period generated → every movement up to then.
  const periodStart = openingPeriod
    ? new Date(openingPeriod.year, openingPeriod.month - 1, 1, 0, 0, 0, 0)
    : null;
  const moveDates = periodStart
    ? Prisma.sql`AND tm.dated >= ${periodStart} AND tm.dated <= ${to}`
    : Prisma.sql`AND tm.dated <= ${to}`;

  const itemWhere = [Prisma.sql`i.discard = false`, Prisma.sql`i.item IS NOT NULL`];
  if (filters.product) itemWhere.push(Prisma.sql`i.itcd = ${Number(filters.product)}`);
  if (filters.category) itemWhere.push(Prisma.sql`mc.id = ${Number(filters.category)}`);
  if (filters.import_type) {
    itemWhere.push(Prisma.sql`UPPER(i.import_type) = UPPER(${filters.import_type})`);
  }
  if (!filters.product) {
    const procured = procuredCategoryIds(await getProductionSetup());
    itemWhere.push(procured.length ? Prisma.sql`i.ic_id IN (${Prisma.join(procured)})` : Prisma.sql`FALSE`);
  }

  // Each bucket becomes one SUM(...) FILTER over the same movement set.
  const bucketCols = Object.entries(STOCK_BUCKETS).map(
    ([field, { godowns }]) => Prisma.sql`
      COALESCE(SUM(m.qty) FILTER (WHERE m.godown IN (${Prisma.join(godowns)})), 0) AS ${Prisma.raw(`"${field}"`)}`,
  );

  const rows = await prisma.$queryRaw`
    WITH items AS (
      SELECT i.itcd, i.item, i.code, i.unit, i.import_type, i.re_order, i.minimum_order_quantity,
             COALESCE(mc.mc_name, 'UNCATEGORISED') AS category
      FROM "Item" i
      LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
      WHERE ${Prisma.join(itemWhere, " AND ")}
    ),
    -- Stock per godown, the SAME rule as the Stock report (stockQtyBefore):
    -- latest Monthly Opening Stock per godown + movements from that month's
    -- 1st to the end of the chosen month. IN 4,8,10,12 · OUT 5,6,7,9 ·
    -- transfer 11 is OUT of godown and IN to godown2. Control rows
    -- (sub_tran_id 3) never count; a voucher with no godown is in no godown,
    -- exactly as the Stock report filtered by godown shows it.
    moves AS (
      SELECT t.itcd, tm.godown,
        CASE
          WHEN tm.tran_code IN (${Prisma.join(STOCK_IN_CODES)}) THEN COALESCE(t.qty, 0)
          ELSE -COALESCE(t.qty, 0)   -- OUT codes, and transfer out of godown
        END AS qty
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      WHERE t.qty IS NOT NULL
        AND (t.sub_tran_id IS NULL OR t.sub_tran_id <> 3)
        AND tm.godown IS NOT NULL
        AND tm.tran_code IN (${Prisma.join([...STOCK_IN_CODES, ...STOCK_OUT_CODES, 11])})
        ${moveDates}
      UNION ALL
      -- transfer IN to godown2
      SELECT t.itcd, tm.godown2, COALESCE(t.qty, 0)
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      WHERE t.qty IS NOT NULL
        AND (t.sub_tran_id IS NULL OR t.sub_tran_id <> 3)
        AND tm.tran_code = 11
        AND tm.godown2 IS NOT NULL
        ${moveDates}
      UNION ALL
      ${openingPeriod
        ? Prisma.sql`SELECT o.itcd, o.godown, o.opening_qty FROM (${openingQtyByGodownSql(openingPeriod.month, openingPeriod.year)}) o`
        : Prisma.sql`SELECT NULL::int, NULL::int, 0::double precision WHERE FALSE`}
    ),
    stock AS (
      SELECT m.itcd, ${Prisma.join(bucketCols, ",")}
      FROM moves m
      WHERE m.godown IS NOT NULL
      GROUP BY m.itcd
    ),
    -- Landed into a bonded warehouse but not yet cleared on an ex-bond GRN.
    bonded AS (
      SELECT idt.itcd, SUM(idt.qty) AS qty
      FROM "InboundDetail" idt
      JOIN "InboundMaster" im ON im.id = idt.inbound_id
      WHERE im.dated IS NULL OR im.dated <= ${to}
      GROUP BY 1
    ),
    ex_bond AS (
      SELECT t.itcd, SUM(t.qty) AS qty
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id AND t.sub_tran_id = 1
      WHERE tm.tran_code = 4 AND tm.bond_id IS NOT NULL AND tm.dated <= ${to}
      GROUP BY 1
    ),
    -- Still at sea. Same rule as the Imported Material in Transit report: an
    -- L/C has shipped (bl_date) and has neither an in-bond entry nor a GRN,
    -- so the two reports can never disagree about what is in transit.
    lcs AS (SELECT l.* FROM "LCMaster" l WHERE l.bl_date IS NOT NULL),
    lc_bonds AS (
      SELECT l.id AS lcm_id, im.id AS inbound_id
      FROM lcs l JOIN "InboundMaster" im ON im."lCMasterId" = l.id
      UNION
      SELECT l.id, im.id FROM lcs l JOIN "InboundMaster" im ON im.lc_no = l.lc_gl
    ),
    lc_grn AS (
      SELECT l.id AS lcm_id
      FROM lcs l JOIN "TRANSACTIONS_MASTER" tm ON tm.lc_no = l.lc_no AND tm.tran_code = 4
      UNION
      SELECT b.lcm_id
      FROM lc_bonds b JOIN "TRANSACTIONS_MASTER" tm ON tm.bond_id = b.inbound_id AND tm.tran_code = 4
    ),
    transit AS (
      SELECT d.itcd, SUM(d.qty) AS qty
      FROM "LCDetail" d
      JOIN lcs l ON l.id = d.lcm_id
      WHERE l.id NOT IN (SELECT lcm_id FROM lc_bonds)
        AND l.id NOT IN (SELECT lcm_id FROM lc_grn)
      GROUP BY 1
    ),
    opening AS (
      ${
        openingPeriod
          ? openingQtySql(openingPeriod.month, openingPeriod.year)
          : // No opening period has ever been generated: an empty set, so the
            // LEFT JOIN below leaves every item on 0.
            Prisma.sql`SELECT NULL::int AS itcd, 0::double precision AS opening_qty WHERE FALSE`
      }
    )
    SELECT
      it.itcd, it.item, it.code, it.unit, it.import_type, it.category, it.re_order, it.minimum_order_quantity,
      ${Prisma.join(
        Object.keys(STOCK_BUCKETS).map(
          (f) => Prisma.sql`COALESCE(s.${Prisma.raw(`"${f}"`)}, 0) AS ${Prisma.raw(`"${f}"`)}`,
        ),
        ",",
      )},
      GREATEST(COALESCE(b.qty, 0) - COALESCE(e.qty, 0), 0) AS stock_bond,
      COALESCE(tr.qty, 0) AS stock_transit,
      COALESCE(op.opening_qty, 0) AS opening_stock
    FROM items it
    LEFT JOIN stock s   ON s.itcd = it.itcd
    LEFT JOIN bonded b  ON b.itcd = it.itcd
    LEFT JOIN ex_bond e ON e.itcd = it.itcd
    LEFT JOIN transit tr ON tr.itcd = it.itcd
    LEFT JOIN opening op ON op.itcd = it.itcd
    ORDER BY it.category, it.code
  `;

  // Monthly consumption, one grouped pass for the whole period.
  const consumption = await prisma.$queryRaw`
    SELECT t.itcd,
           to_char(date_trunc('month', tm.dated), 'YYYY-MM') AS ym,
           SUM(t.qty) AS qty
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    WHERE tm.tran_code = ${CONSUMPTION_TRAN_CODE}
      AND t.sub_tran_id = 1
      AND t.itcd IS NOT NULL
      AND tm.dated >= ${from} AND tm.dated <= ${to}
    GROUP BY 1, 2
  `;

  const byItem = new Map();
  for (const c of consumption) {
    if (!byItem.has(c.itcd)) byItem.set(c.itcd, {});
    byItem.get(c.itcd)[c.ym] = num(c.qty);
  }

  const divisor = AVG_MONTHS ?? keys.length ?? 1;

  const data = rows.map((r) => {
    const months = byItem.get(r.itcd) || {};
    const monthly = keys.map((k) => num(months[k]));
    const consumed = monthly.reduce((s, v) => s + v, 0);
    const maxCons = monthly.length ? Math.max(...monthly) : 0;
    const avgCons = consumed / divisor;

    const bucketQty = Object.keys(STOCK_BUCKETS).reduce((s, f) => s + num(r[f]), 0);
    const bond = num(r.stock_bond);
    const transit = num(r.stock_transit);
    // Transit is reported but deliberately NOT counted: it has not landed, so
    // it cannot cover consumption and must not suppress a reorder.
    const totalStock = bucketQty + bond;

    const reorderLevel = maxCons * REORDER_MULTIPLIER;
    const orderQty = reorderLevel - totalStock;

    const row = {
      category: r.category,
      code: r.code || String(r.itcd),
      itcd: r.itcd,
      product_description: r.item || "",
      unit: r.unit || "",
      import_type: r.import_type || "",
      avg_cons_6m: Math.round(avgCons),
      max_cons_6m: Math.round(maxCons),
      // Opening of the latest Monthly Opening Stock period (the base the
      // stock columns are rolled forward from).
      opening_stock: round2(r.opening_stock),
      total_stock: round2(totalStock),
      stock_bond: round2(bond),
      stock_transit: round2(transit),
      re_order_level: Math.round(reorderLevel),
      // The item's own re-order level / minimum order qty (Item form) — shown
      // beside the computed level; stock below it is flagged.
      item_re_order: r.re_order != null ? Number(r.re_order) : "",
      min_order_qty: r.minimum_order_quantity != null ? Number(r.minimum_order_quantity) : "",
      below_item_re_order: r.re_order != null && totalStock < Number(r.re_order),
      order_qty: orderQty > 0 ? Math.round(orderQty) : 0,
      // Months of cover. With no consumption there is no meaningful cover, so
      // it is left blank rather than shown as a division by zero.
      stock_sufficient_months: maxCons > 0 ? round2(totalStock / maxCons) : "",
      total_consumption: round2(consumed),
    };
    for (const f of Object.keys(STOCK_BUCKETS)) row[f] = round2(r[f]);
    keys.forEach((k, i) => { row[monthField(k)] = round2(monthly[i]); });

    return row;
  });

  // An item with no stock anywhere and nothing consumed is not being procured
  // and would only pad the report.
  const materials = data.filter(
    (r) =>
      r.total_stock !== 0 ||
      r.stock_transit !== 0 ||
      r.total_consumption !== 0 ||
      r.opening_stock !== 0,
  );

  // ── Flat rows for the wide report layout (CLAUDE.md rule 15) ─────────────
  // One row per material, Local first, then Imported, then Unclassified;
  // category and code order inside each. The viewer draws the section groups
  // and their subtotals from `section_no` / `section_label` (config
  // `layout.rowGroupBy`) — the same sums the old section / grand total rows
  // carried (opening, stock columns, bond, transit, order qty, months).
  const out = [];
  SECTIONS.forEach((sec, si) => {
    const inSection = materials
      .filter((r) => sectionKey(r.import_type) === sec.key)
      .sort(
        (a, b) =>
          String(a.category).localeCompare(String(b.category)) ||
          String(a.code).localeCompare(String(b.code), undefined, { numeric: true }),
      );
    for (const r of inSection) {
      out.push({ section: sec.key, section_no: si + 1, section_label: sec.label, ...r });
    }
  });

  return out;
}

export function calculateMaterialProcurementSummary(rows = []) {
  // Rows are flat material rows; a row_type other than material_row (older
  // shape: headers / subtotals) would double every figure, so it is skipped.
  const data = rows.filter((r) => !r.row_type || r.row_type === "material_row");
  const sum = (f) => data.reduce((s, r) => s + num(r[f]), 0);
  return {
    total_items: data.length,
    total_opening_stock: round2(sum("opening_stock")),
    total_stock: round2(sum("total_stock")),
    total_bond: round2(sum("stock_bond")),
    total_transit: round2(sum("stock_transit")),
    total_consumption: round2(sum("total_consumption")),
    total_order_qty: round2(sum("order_qty")),
    items_to_reorder: data.filter((r) => num(r.order_qty) > 0).length,
  };
}
