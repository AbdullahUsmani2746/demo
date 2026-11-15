// lib/bi/engine.js
// ============================================================
// BI QUERY ENGINE — turns a Question's config into one safe SQL query.
//
// A question config (stored as JSON on BiQuestion.config):
//   {
//     dataset:    "sales",
//     measures:   [{ key: "amount", agg: "sum", label? }],
//     dimensions: [{ field: "dated", grain: "month" }, { field: "customer" }],
//     filters:    [{ field: "godown", op: "eq", value: "<godown name>" }],
//     period:     "mtd",                       // lib/bi/visuals.js PERIODS
//     sort:       { by: "m0" | "d0" | …, dir: "desc" },
//     limit:      10,
//     visual:     { type: "bar", options: { … } },
//     lockPeriod: true                         // ignore the dashboard period bar
//   }
//
// Safety: every field / measure is looked up BY KEY in lib/bi/datasets.js
// and only those trusted fragments reach the SQL; every user value goes in
// as a bound parameter. The user's data scope (department / personal limits,
// lib/auth/scope.js) is applied to every query — a dataset that cannot be
// limited the way the user is limited is refused, never run in full.
// ============================================================
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { datasetByKey } from "./datasets";
import { visualByKey, KPI_PERIODS, LY_VISUALS } from "./visuals";
import { parsePeriod, dayKey } from "./periods";
import { scopeFor, isUnrestricted } from "@/lib/auth/scope";
import { SCOPE_DIMENSIONS, typedValues } from "@/lib/auth/scopeDimensions";
import { hasFullAccess } from "@/lib/auth/permissions";
import { visibleSalesPersons } from "@/lib/auth/salesScope";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";

export class BiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "BiError";
    this.status = status;
  }
}

const MAX_ROWS = 5000;
const col = (name) => Prisma.raw(`b."${name}"`);

// ── Periods ──────────────────────────────────────────────────────────────
// lib/bi/periods.js — fixed keys ("yday", "mtd" …) and custom ranges.

/** { from, to } for a period, or null for "all" / an unreadable period. */
export function periodRange(key, now = new Date()) {
  const p = parsePeriod(key, now);
  return p ? { from: p.from, to: p.to } : null;
}

// ── Validation (config → resolved registry entries) ────────────────────────
function resolve(config) {
  const ds = datasetByKey(config?.dataset);
  if (!ds) throw new BiError("Choose a dataset.");

  const measures = (config.measures || []).map((m, i) => {
    const def = ds.measures.find((x) => x.key === m.key);
    if (!def) throw new BiError(`Unknown measure "${m.key}".`);
    const aggs = def.ratio ? ["ratio"] : def.aggs ?? ["sum", "avg", "min", "max"];
    const agg = m.agg && [...aggs, ...(def.ratio ? [] : ["count"])].includes(m.agg) ? m.agg : aggs[0];
    return { ...def, agg, alias: `m${i}`, label: m.label || def.label };
  });
  if (measures.length === 0) throw new BiError("Add at least one measure.");
  if (measures.length > 8) throw new BiError("At most 8 measures.");

  const dimensions = (config.dimensions || []).map((d, i) => {
    const def = ds.fields.find((x) => x.key === d.field);
    if (!def) throw new BiError(`Unknown field "${d.field}".`);
    const grain = def.type === "date" ? (["day", "week", "month", "quarter", "year"].includes(d.grain) ? d.grain : "month") : null;
    return { ...def, grain, alias: `d${i}` };
  });
  // The Table visual takes up to 5 (follow-up lists); charts are held to
  // their own maximum by the builder (lib/bi/visuals.js dims).
  // The follow-up sync (lib/bi/followups.js) adds its hidden owner / party
  // columns on top, so it may go to 8 — config.__internalDims, set only there.
  const maxDims = config.__internalDims ? 8 : 5;
  if (dimensions.length > maxDims) throw new BiError(`At most ${maxDims} group-by fields.`);

  const filters = (config.filters || []).filter((f) => f && f.field).map((f) => {
    const def = ds.fields.find((x) => x.key === f.field);
    if (!def) throw new BiError(`Unknown filter field "${f.field}".`);
    return { ...f, def };
  });

  const visual = visualByKey(config.visual?.type) ?? visualByKey("table");
  return { ds, measures, dimensions, filters, visual };
}

// ── SQL pieces ───────────────────────────────────────────────────────────
function measureSql(m, extraWhere = null) {
  const filter = extraWhere ? Prisma.sql` FILTER (WHERE ${extraWhere})` : Prisma.empty;
  // Ratio (e.g. Achievement % = actual ÷ target) — computed on the totals of
  // the group, never by averaging per-row percentages.
  if (m.ratio) {
    return Prisma.sql`(COALESCE(SUM(${col(m.ratio.num)})${filter}, 0) * 100.0 / NULLIF(SUM(${col(m.ratio.den)})${filter}, 0))`;
  }
  const c = col(m.column);
  switch (m.agg) {
    case "avg": return Prisma.sql`AVG(${c})${filter}`;
    case "min": return Prisma.sql`MIN(${c})${filter}`;
    case "max": return Prisma.sql`MAX(${c})${filter}`;
    case "count": return Prisma.sql`COUNT(${c})${filter}`;
    case "distinct": return Prisma.sql`COUNT(DISTINCT ${c})${filter}`;
    default: return Prisma.sql`COALESCE(SUM(${c})${filter}, 0)`;
  }
}

function dimensionSql(d) {
  if (d.type === "date") return Prisma.sql`date_trunc(${d.grain}, ${col(d.key)})::date`;
  return Prisma.sql`COALESCE(${col(d.key)}::text, '(blank)')`;
}

function filterSql({ def, op, value }) {
  const c = col(def.key);
  const isNum = def.type === "number";
  const isDate = def.type === "date";
  const typed = (v) => (isDate ? Prisma.sql`${String(v)}::date` : isNum ? Prisma.sql`${Number(v)}` : Prisma.sql`${String(v)}`);
  const asText = Prisma.sql`${c}::text`;
  switch (op) {
    case "empty": return Prisma.sql`(${c} IS NULL OR ${asText} = '')`;
    case "notEmpty": return Prisma.sql`(${c} IS NOT NULL AND ${asText} <> '')`;
    case "in": {
      const list = (Array.isArray(value) ? value : String(value ?? "").split(",")).map((v) => String(v).trim()).filter(Boolean);
      return list.length ? Prisma.sql`${asText} = ANY(${list}::text[])` : Prisma.sql`FALSE`;
    }
    case "contains": return Prisma.sql`${asText} ILIKE ${"%" + String(value ?? "").replace(/[\\%_]/g, (x) => "\\" + x) + "%"}`;
    case "neq": return isNum || isDate ? Prisma.sql`${c} <> ${typed(value)}` : Prisma.sql`${asText} <> ${String(value ?? "")}`;
    case "gt": return Prisma.sql`${c} > ${typed(value)}`;
    case "gte": return Prisma.sql`${c} >= ${typed(value)}`;
    case "lt": return Prisma.sql`${c} < ${typed(value)}`;
    case "lte": return Prisma.sql`${c} <= ${typed(value)}`;
    default: return isNum || isDate ? Prisma.sql`${c} = ${typed(value)}` : Prisma.sql`${asText} = ${String(value ?? "")}`;
  }
}

// ── Sales persons see only their own customers ─────────────────────────────
// The same rule as the Sales Team MIS / Customer Aging (lib/auth/salesScope.js),
// applied to anyone who IS a sales person — i.e. has customers assigned to
// them (ACNO.salesArea = their User.id) — unless they may see all sales
// (salesTeam.viewAll / ADMIN / ACCOUNTANT). People with no customers of their
// own (Finance, Dispatch …) are not touched by it. Cached briefly per user.
// Customer main accounts come from Finance → Account Settings ("customers").
const SP_CACHE_MS = 60 * 1000;
const spCache = new Map();

async function salesPersonLimit(session) {
  const me = session?.user?.id;
  if (!me) return null;
  const hit = spCache.get(me);
  if (hit && Date.now() - hit.at < SP_CACHE_MS) return hit.value;
  // null = no limit; else the sales persons whose customers they may see
  // (themselves + their team — Permissions → Sales visibility).
  let value = null;
  const visible = await visibleSalesPersons(session);
  if (visible !== null) {
    const owns = await prisma.aCNO.count({ where: { macno: { in: await getCustomerMacnos() }, salesArea: me } });
    if (owns > 0 || visible.length > 1) value = visible;
  }
  spCache.set(me, { at: Date.now(), value });
  return value;
}

/** Data-scope conditions for this dataset, or throws if it cannot be limited. */
async function scopeConditions(session, ds) {
  if (!session?.user?.id) throw new BiError("Sign in required.", 401);
  if (hasFullAccess(session)) return [];
  const out = [];
  for (const dim of SCOPE_DIMENSIONS) {
    const scope = await scopeFor(session, dim.key);
    if (isUnrestricted(scope)) continue;
    const column = ds.scope?.[dim.key];
    if (!column) {
      // Same rule as reports: a strict limit (customer, region) refuses a
      // dataset it cannot narrow; a godown limit leaves money datasets alone.
      if (dim.reports?.strict === false) continue;
      throw new BiError(
        `You are limited to specific ${dim.label.toLowerCase()}, and "${ds.label}" cannot be narrowed that way.`,
        403,
      );
    }
    // Compared as text: scope values are stored as strings, columns vary
    // (int godown / customer ids, text regions).
    const vals = typedValues(dim, scope.values).map(String);
    out.push(vals.length ? Prisma.sql`${col(column)}::text IN (${Prisma.join(vals)})` : Prisma.sql`FALSE`);
  }

  // A sales person: only their own customers on any dataset that has them.
  const sp = await salesPersonLimit(session);
  if (sp && ds.scope?.customer) {
    out.push(Prisma.sql`${col(ds.scope.customer)} IN (SELECT a2.acno FROM "acno" a2 WHERE a2.sales_ares = ANY(${sp}::text[]))`);
  }
  return out;
}

const andAll = (parts) => (parts.length ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`);

// ── Run ─────────────────────────────────────────────────────────────────

/**
 * Dashboard-wide filters ({ field, value }) apply only to questions whose
 * dataset has that field — a "Godown" filter narrows Sales and Stock and
 * leaves Receipts alone. Several values (an array) mean "any of"; a single
 * string is ONE value — never split on commas ("CO.,LTD" is one name).
 */
function dashboardFilterSql(ds, extraFilters = []) {
  const out = [];
  for (const f of extraFilters || []) {
    const def = ds.fields.find((x) => x.key === f?.field);
    if (!def || def.type === "date") continue;
    const vals = (Array.isArray(f.value) ? f.value : [f.value])
      .map((v) => String(v).trim())
      .filter(Boolean);
    if (vals.length) out.push(filterSql({ def, op: "in", value: vals }));
  }
  return out;
}

/** The effective period: a question can keep its own ("lockPeriod"). */
const effectivePeriod = (config, period) =>
  config.lockPeriod ? config.period || "mtd" : period || config.period || "mtd";

/** Everything a run / drill shares: dataset, base SELECT, WHERE pieces. */
async function prepare(config, { session, period, filters: extraFilters } = {}) {
  const r = resolve(config);
  const scope = await scopeConditions(session, r.ds);
  const where = [...scope, ...r.filters.map(filterSql), ...dashboardFilterSql(r.ds, extraFilters)];
  const base = await r.ds.base({});
  const usePeriod = effectivePeriod(config, period);
  const parsed = r.ds.dateColumn ? parsePeriod(usePeriod) : null;
  const range = parsed ? { from: parsed.from, to: parsed.to } : null;
  return { ...r, where, base, usePeriod, range, parsed };
}

const rangeSql = (ds, range) =>
  Prisma.sql`${col(ds.dateColumn)} >= ${range.from} AND ${col(ds.dateColumn)} <= ${range.to}`;

/**
 * Run a question config for this session.
 * @param {object} config   question config (see header)
 * @param {object} opts     { session, period?, filters? } — period overrides
 *                          config.period unless the question locks it;
 *                          filters are the dashboard-wide filters
 * @returns {Promise<{columns, rows, kpi?, meta}>}
 */
export async function runQuestion(config, opts = {}) {
  const { ds, measures, dimensions, visual, where, base, usePeriod, range, parsed } = await prepare(config, opts);

  const columns = [
    ...dimensions.map((d) => ({ key: d.alias, role: "dimension", field: d.key, label: d.label, type: d.type, grain: d.grain })),
    ...measures.map((m) => ({ key: m.alias, role: "measure", measure: m.key, label: m.label, agg: m.agg, format: m.format })),
  ];

  // KPI card: one measure for the chosen period ("sel"), the period before
  // it ("prev"), the same dates last year ("ly"), the standard periods
  // (today / 7 days / month / last month) and a small trend ("spark").
  if (visual.key === "kpi") {
    const m = measures[0];
    let kpi;
    if (ds.dateColumn) {
      const ranges = Object.fromEntries(KPI_PERIODS.map((p) => [p, periodRange(p)]));
      if (parsed) Object.assign(ranges, { sel: range, prev: parsed.prev, ly: parsed.ly });
      const keys = Object.keys(ranges);
      const parts = keys.map((k) => Prisma.sql`${measureSql(m, rangeSql(ds, ranges[k]))} AS ${Prisma.raw(`"${k}"`)}`);
      const earliest = new Date(Math.min(...keys.map((k) => ranges[k].from.getTime())));
      const rows = await prisma.$queryRaw`
        SELECT ${Prisma.join(parts, ", ")}
        FROM (${base}) b
        WHERE ${andAll([...where, Prisma.sql`${col(ds.dateColumn)} >= ${earliest}`])}`;
      kpi = Object.fromEntries(keys.map((k) => [k, rows[0]?.[k] === null && m.ratio ? null : Number(rows[0]?.[k]) || 0]));
      if (!parsed) kpi.sel = kpi.mtd;
      kpi.spark = await sparkSeries(ds, m, where, base, range ?? ranges.mtd);
    } else {
      const rows = await prisma.$queryRaw`SELECT ${measureSql(m)} AS v FROM (${base}) b WHERE ${andAll(where)}`;
      kpi = { now: Number(rows[0]?.v) || 0 };
    }
    return { columns, rows: [], kpi, meta: { dataset: ds.key, period: usePeriod, pointInTime: !ds.dateColumn } };
  }

  const baseWhere = [...where];
  if (range) where.push(rangeSql(ds, range));

  // A field may sort by another column (aging buckets in age order).
  const ordered = dimensions.filter((d) => d.orderColumn);
  const select = [
    ...dimensions.map((d) => Prisma.sql`${dimensionSql(d)} AS ${Prisma.raw(`"${d.alias}"`)}`),
    ...measures.map((m) => Prisma.sql`${measureSql(m)} AS ${Prisma.raw(`"${m.alias}"`)}`),
    ...ordered.map((d) => Prisma.sql`MIN(${col(d.orderColumn)}) AS ${Prisma.raw(`"${d.alias}_ord"`)}`),
  ];
  const groupBy = dimensions.length
    ? Prisma.sql`GROUP BY ${Prisma.join(dimensions.map((_, i) => Prisma.raw(String(i + 1))), ", ")}`
    : Prisma.empty;

  // Sort: by a chosen column, else time / natural order ascending for the
  // first group-by, else the first measure descending (largest first).
  const known = columns.map((c) => c.key);
  const natural = dimensions[0]?.type === "date" || Boolean(dimensions[0]?.orderColumn);
  const sortBy = known.includes(config.sort?.by) ? config.sort.by : natural ? "d0" : measures.length ? "m0" : null;
  const sortDir = config.sort?.dir === "asc" || (!config.sort?.by && natural) ? "ASC" : "DESC";
  const sortCol = dimensions.find((d) => d.alias === sortBy)?.orderColumn ? `${sortBy}_ord` : sortBy;
  const orderBy = sortBy && dimensions.length
    ? Prisma.sql`ORDER BY ${Prisma.raw(`"${sortCol}"`)} ${Prisma.raw(sortDir)} NULLS LAST`
    : Prisma.empty;
  const limit = Math.min(Math.max(Number(config.limit) || (dimensions.length ? 1000 : 1), 1), MAX_ROWS);

  const rows = await prisma.$queryRaw`
    SELECT ${Prisma.join(select, ", ")}
    FROM (${base}) b
    WHERE ${andAll(where)}
    ${groupBy}
    ${orderBy}
    LIMIT ${limit + 1}`;

  // A trend grouped by date also gets the same dates last year (a dashed
  // line), keyed by the date it lines up with this year.
  let compare;
  if (parsed && dimensions.length === 1 && dimensions[0].type === "date" && LY_VISUALS.includes(visual.key) && config.visual?.options?.lastYear !== false) {
    const d = dimensions[0];
    const lyRows = await prisma.$queryRaw`
      SELECT ${dimensionSql(d)} AS k, ${measureSql(measures[0])} AS v
      FROM (${base}) b
      WHERE ${andAll([...baseWhere, rangeSql(ds, parsed.ly)])}
      GROUP BY 1`;
    const ly = {};
    for (const r of lyRows) {
      if (!(r.k instanceof Date)) continue;
      ly[dayKey(new Date(r.k.getUTCFullYear() + 1, r.k.getUTCMonth(), r.k.getUTCDate()))] = Number(r.v) || 0;
    }
    compare = { ly };
  }

  const truncated = rows.length > limit;
  const clean = rows.slice(0, limit).map((r) => {
    const o = {};
    for (const c of columns) {
      const v = r[c.key];
      o[c.key] =
        c.role === "measure"
          ? v === null && c.format === "percent" ? null : Number(v) || 0 // no target → "—", not 0%
          : v instanceof Date ? v.toISOString().slice(0, 10) : v;
    }
    return o;
  });

  return {
    columns,
    rows: clean,
    ...(compare ? { compare } : {}),
    meta: { dataset: ds.key, period: ds.dateColumn ? usePeriod : null, pointInTime: !ds.dateColumn, truncated },
  };
}

/**
 * Small trend for a KPI card, ending with the period: 14 days for a period
 * up to a month, else 12 months. [{ k: "2026-11-01", v }]
 */
async function sparkSeries(ds, m, where, base, range) {
  if (!range) return [];
  const days = Math.round((range.to - range.from) / 86400000) + 1;
  const daily = days <= 31;
  const end = range.to;
  const from = daily
    ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 13)
    : new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const grain = daily ? "day" : "month";
  const rows = await prisma.$queryRaw`
    SELECT date_trunc(${grain}, ${col(ds.dateColumn)})::date AS k, ${measureSql(m)} AS v
    FROM (${base}) b
    WHERE ${andAll([...where, Prisma.sql`${col(ds.dateColumn)} >= ${from} AND ${col(ds.dateColumn)} <= ${end}`])}
    GROUP BY 1 ORDER BY 1`;
  const byKey = new Map(
    rows.map((r) => [r.k instanceof Date ? dayKey(new Date(r.k.getUTCFullYear(), r.k.getUTCMonth(), r.k.getUTCDate())) : String(r.k), Number(r.v) || 0]),
  );
  const out = [];
  for (let i = 0; i < (daily ? 14 : 12); i++) {
    const d = daily ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + i) : new Date(from.getFullYear(), from.getMonth() + i, 1);
    const k = dayKey(d);
    out.push({ k, v: byKey.get(k) ?? 0 });
  }
  return out;
}

/**
 * The records behind one figure: same question, same scope / filters /
 * period, narrowed to the clicked point ({ d0: value, d1: value }), listing
 * the dataset's drill columns. Max 500 rows, newest first.
 */
export async function drillRows(config, opts = {}) {
  const { ds, dimensions, where, base, range } = await prepare(config, opts);
  if (range) where.push(rangeSql(ds, range));

  const point = opts.point || {};
  dimensions.forEach((d) => {
    if (!(d.alias in point)) return;
    const v = point[d.alias];
    if (d.type === "date") {
      where.push(Prisma.sql`date_trunc(${d.grain}, ${col(d.key)})::date = ${String(v)}::date`);
    } else if (v === "(blank)" || v === null) {
      where.push(Prisma.sql`${col(d.key)} IS NULL`);
    } else {
      where.push(Prisma.sql`${col(d.key)}::text = ${String(v)}`);
    }
  });

  const cols = (ds.drill?.length ? ds.drill : ds.fields.map((f) => f.key)).filter(
    (c) => ds.fields.some((f) => f.key === c) || ds.measures.some((m) => m.column === c),
  );
  const order = ds.dateColumn ? Prisma.sql`ORDER BY ${col(ds.dateColumn)} DESC` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT ${Prisma.join(cols.map((c) => Prisma.sql`${col(c)} AS ${Prisma.raw(`"${c}"`)}`), ", ")}
    FROM (${base}) b
    WHERE ${andAll(where)}
    ${order}
    LIMIT 501`;

  const columns = cols.map((c) => {
    const fld = ds.fields.find((x) => x.key === c);
    const msr = ds.measures.find((x) => x.column === c);
    return { key: c, label: fld?.label ?? msr?.label ?? c, type: fld?.type ?? "number", format: msr?.format ?? null, role: msr ? "measure" : "dimension" };
  });
  return {
    columns,
    rows: rows.slice(0, 500).map((r) => {
      const o = {};
      for (const c of cols) {
        const v = r[c];
        o[c] = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "bigint" ? Number(v) : v;
      }
      return o;
    }),
    truncated: rows.length > 500,
  };
}

/** Fields a figure can be broken down by ("Why did it change?"): text fields of its dataset. */
export function breakdownFields(config) {
  const ds = datasetByKey(config?.dataset);
  return (ds?.fields ?? []).filter((f) => f.type !== "date" && f.type !== "number").map((f) => ({ key: f.key, label: f.label }));
}

/**
 * "Why did it change?" — the question's first measure split by one field,
 * for the chosen period and the period before it, under the same scope and
 * filters. Returns the biggest movers (rises and falls), at most 12, plus
 * the rest as "Others".
 */
export async function breakdownChange(config, opts = {}) {
  const { ds, measures, where, base, parsed } = await prepare({ ...config, visual: { type: "table" }, dimensions: [], lockPeriod: false }, opts);
  if (!parsed) throw new BiError("This figure has no period to compare.");
  const field = ds.fields.find((f) => f.key === opts.field && f.type !== "date" && f.type !== "number");
  if (!field) throw new BiError("Choose what to break it down by.");
  const m = measures[0];
  const cur = Prisma.sql`${col(ds.dateColumn)} >= ${parsed.from} AND ${col(ds.dateColumn)} <= ${parsed.to}`;
  const prev = Prisma.sql`${col(ds.dateColumn)} >= ${parsed.prev.from} AND ${col(ds.dateColumn)} <= ${parsed.prev.to}`;
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(${col(field.key)}::text, '(blank)') AS k,
           ${measureSql(m, cur)} AS cur,
           ${measureSql(m, prev)} AS prev
    FROM (${base}) b
    WHERE ${andAll([...where, Prisma.sql`((${cur}) OR (${prev}))`])}
    GROUP BY 1`;
  const all = rows.map((r) => ({ name: r.k, cur: Number(r.cur) || 0, prev: Number(r.prev) || 0 })).map((r) => ({ ...r, diff: r.cur - r.prev }));
  const total = { cur: all.reduce((s, r) => s + r.cur, 0), prev: all.reduce((s, r) => s + r.prev, 0) };
  const movers = [...all].filter((r) => r.diff !== 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const top = movers.slice(0, 12);
  const rest = movers.slice(12);
  if (rest.length) {
    top.push({ name: `Others (${rest.length})`, other: true, cur: rest.reduce((s, r) => s + r.cur, 0), prev: rest.reduce((s, r) => s + r.prev, 0), diff: rest.reduce((s, r) => s + r.diff, 0) });
  }
  return {
    field: { key: field.key, label: field.label },
    measure: { label: m.label, format: m.format },
    total,
    rows: top.sort((a, b) => b.diff - a.diff),
    range: { from: dayKey(parsed.from), to: dayKey(parsed.to), prevFrom: dayKey(parsed.prev.from), prevTo: dayKey(parsed.prev.to) },
  };
}

/** Distinct values of a field (for filter pick-lists) — scoped like any run. */
export async function fieldValues(datasetKey, fieldKey, { session } = {}) {
  const ds = datasetByKey(datasetKey);
  const field = ds?.fields.find((f) => f.key === fieldKey);
  if (!ds || !field || field.type === "date") return [];
  const scope = await scopeConditions(session, ds);
  const base = await ds.base({});
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ${col(field.key)}::text AS v
    FROM (${base}) b
    WHERE ${andAll([...scope, Prisma.sql`${col(field.key)} IS NOT NULL`])}
    ORDER BY 1
    LIMIT 300`;
  return rows.map((r) => r.v);
}
