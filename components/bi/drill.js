// components/bi/drill.js — turn a click on a chart / table into the
// { d0, d1 } "point" the drill API narrows to, using the RAW values from the
// result (dates as YYYY-MM-DD), not the formatted labels.
import { dimLabel } from "./format";

const uniq = (a) => [...new Set(a)];

export function pointFromChart(type, result, p) {
  const dims = result.columns.filter((c) => c.role === "dimension");
  const meas = result.columns.filter((c) => c.role === "measure");
  if (!dims.length || !p) return {};
  const raw = (dim, label) => {
    const r = result.rows.find((x) => dimLabel(x[dim.key], dim) === label);
    return r ? r[dim.key] : label;
  };
  const [d0, d1] = dims;

  switch (type) {
    case "heatmap": {
      const xs = uniq(result.rows.map((r) => dimLabel(r[d0.key], d0)));
      const ys = uniq(result.rows.map((r) => dimLabel(r[d1.key], d1)));
      return { d0: raw(d0, xs[p.value?.[0]]), d1: raw(d1, ys[p.value?.[1]]) };
    }
    case "treemap":
    case "sunburst": {
      let names = (p.treePathInfo || []).slice(1).map((x) => x.name);
      if (!names.length && p.name) names = [p.name];
      const out = { d0: raw(d0, names[0]) };
      if (d1 && names[1]) out.d1 = raw(d1, names[1]);
      return out;
    }
    case "sankey": {
      if (p.dataType === "edge") return { d0: raw(d0, p.data.source), d1: raw(d1, String(p.data.target).replace(/ ›$/, "")) };
      const name = String(p.name).replace(/ ›$/, "");
      return result.rows.some((r) => dimLabel(r[d0.key], d0) === name) ? { d0: raw(d0, name) } : { d1: raw(d1, name) };
    }
    case "radar":
    case "gauge":
      return {};
    default: {
      const out = { d0: raw(d0, p.name) };
      // Two group-bys drawn as series (stacked / multi-line): the series is d1.
      if (d1 && p.seriesName && !meas.some((m) => m.label === p.seriesName)) out.d1 = raw(d1, p.seriesName);
      return out;
    }
  }
}

/** A table row's point: every group-by column's raw value. */
export function pointFromRow(result, row) {
  const out = {};
  result.columns.filter((c) => c.role === "dimension").forEach((c) => { out[c.key] = row[c.key]; });
  return out;
}

/** Human description of a point, for the drill window title. */
export function describePoint(result, point) {
  return result.columns
    .filter((c) => c.role === "dimension" && c.key in point)
    .map((c) => `${c.label}: ${dimLabel(point[c.key], c)}`)
    .join(" · ");
}

// ── Colour rules / targets ────────────────────────────────────────────────
export const RULE_COLORS = {
  moss: "var(--moss)",
  rust: "var(--rust)",
  brass: "var(--brass)",
  steel: "var(--steel)",
};

/** First matching rule's colour KEY (rust / brass / moss / steel …), or undefined. */
export function ruleColorKey(value, rules) {
  const v = Number(value);
  if (!Array.isArray(rules) || Number.isNaN(v)) return undefined;
  for (const r of rules) {
    const a = Number(r.value);
    const b = Number(r.value2);
    const hit =
      r.op === ">" ? v > a :
      r.op === ">=" ? v >= a :
      r.op === "<" ? v < a :
      r.op === "<=" ? v <= a :
      r.op === "between" ? v >= Math.min(a, b) && v <= Math.max(a, b) :
      false;
    if (hit) return r.color;
  }
  return undefined;
}

/** First matching rule's colour for a value, or undefined. */
export function ruleColor(value, rules) {
  const v = Number(value);
  if (!Array.isArray(rules) || Number.isNaN(v)) return undefined;
  for (const r of rules) {
    const a = Number(r.value);
    const b = Number(r.value2);
    const hit =
      r.op === ">" ? v > a :
      r.op === ">=" ? v >= a :
      r.op === "<" ? v < a :
      r.op === "<=" ? v <= a :
      r.op === "between" ? v >= Math.min(a, b) && v <= Math.max(a, b) :
      false;
    if (hit) return RULE_COLORS[r.color] || r.color;
  }
  return undefined;
}

// ── Row highlight rules (follow-up flags) ─────────────────────────────────
// visual.options.rowRules: [{ column, op, value, value2?, color, label }]
//   column — "d:<field key>" (a group-by column) or "m:<measure key>"
//   op     — > >= < <= between | = != contains | empty notEmpty
// A table row matching a rule is highlighted in its colour and carries the
// label as a pill (e.g. "Follow up"). First matching rule wins. Written by the
// BI Designer, so any scenario ("Free of Cost dispatched 7+ days ago",
// "ETA passed", "bad-payment customer") is a setting, not code.
export const ROW_RULE_OPS = [
  { key: ">=", label: "≥ (at least)" },
  { key: ">", label: "> (more than)" },
  { key: "<=", label: "≤ (at most)" },
  { key: "<", label: "< (less than)" },
  { key: "between", label: "between" },
  { key: "=", label: "is" },
  { key: "!=", label: "is not" },
  { key: "contains", label: "contains" },
  { key: "empty", label: "is empty" },
  { key: "notEmpty", label: "is not empty" },
];

/** The result column a rule points at ("d:order_type" / "m:days_since_dispatch"). */
export function ruleColumn(columns, ref) {
  const [kind, key] = String(ref || "").split(":");
  return columns.find((c) => (kind === "d" ? c.role === "dimension" && c.field === key : c.role === "measure" && c.measure === key));
}

function ruleHit(raw, r) {
  const isEmpty = raw === null || raw === undefined || raw === "";
  if (r.op === "empty") return isEmpty;
  if (r.op === "notEmpty") return !isEmpty;
  if (isEmpty) return false;
  const text = String(raw).toLowerCase();
  const want = String(r.value ?? "").toLowerCase();
  if (r.op === "=") return text === want;
  if (r.op === "!=") return text !== want;
  if (r.op === "contains") return text.includes(want);
  const v = Number(raw);
  const a = Number(r.value);
  const b = Number(r.value2);
  if (Number.isNaN(v) || Number.isNaN(a)) return false;
  return r.op === ">" ? v > a
    : r.op === ">=" ? v >= a
    : r.op === "<" ? v < a
    : r.op === "<=" ? v <= a
    : r.op === "between" ? v >= Math.min(a, b) && v <= Math.max(a, b)
    : false;
}

/** The first rule a row matches → { color, label } or null. */
export function rowFlag(row, columns, rules) {
  if (!Array.isArray(rules) || !rules.length) return null;
  for (const r of rules) {
    const c = ruleColumn(columns, r.column);
    if (c && ruleHit(row[c.key], r)) return { color: RULE_COLORS[r.color] || RULE_COLORS.rust, label: r.label || "" };
  }
  return null;
}
