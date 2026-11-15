// lib/bi/summary.js — the one-line summary at the top of a dashboard, written
// from its own figures by fixed rules (no AI, no external service):
//   "Yesterday: sales 18.4 m, up 21%. Receipts 22.1 m, above target.
//    Needs attention: overdue receivables 241 m · 7 dispatches not invoiced."
// Pure: takes the dashboard layout + results, returns { lead, rest } or null.
import { periodTitle, parsePeriod, prorateMonthly } from "./periods";

const sectionsOf = (layout) => layout?.sections ?? [];

function short(v, format) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const f = (x, d) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (format === "currency") {
    if (a >= 1e9) return `${f(n / 1e9, 2)} bn`;
    if (a >= 1e6) return `${f(n / 1e6, a >= 1e8 ? 0 : 1)} m`;
    if (a >= 1e3) return `${f(n / 1e3, 0)} k`;
    return f(n, 0);
  }
  if (format === "percent") return `${f(n, 0)}%`;
  if (format === "qty") return f(n, a < 100 && !Number.isInteger(n) ? 1 : 0);
  return f(n, Number.isInteger(n) ? 0 : 1);
}

const pct = (a, b) => (Number(b) ? ((Number(a) - Number(b)) / Math.abs(Number(b))) * 100 : null);
const move = (p) => (p === null ? "" : Math.abs(p) < 0.5 ? "level" : `${p > 0 ? "up" : "down"} ${Math.abs(p).toFixed(0)}%`);

function kpiOf(r) {
  const k = r?.result?.kpi;
  if (!k) return null;
  const m = r.result.columns?.find((c) => c.role === "measure");
  return r.result.meta?.pointInTime
    ? { value: k.now, format: m?.format, pointInTime: true }
    : { value: k.sel ?? k.mtd, prev: k.prev, format: m?.format };
}

export function buildSummary(layout, results, period, { compare = true } = {}) {
  const items = (kind) => sectionsOf(layout).filter((s) => s.kind === kind).flatMap((s) => s.items ?? []);
  const heroes = items("hero").map((it) => results?.[it.questionId]).filter((r) => r?.result?.kpi);
  if (!heroes.length) return null;
  const range = parsePeriod(period);
  const title = periodTitle(period);

  const parts = heroes.map((r) => {
    const f = kpiOf(r);
    const opts = r.config?.visual?.options || {};
    const target = opts.monthlyTarget ? prorateMonthly(opts.monthlyTarget, range) : opts.target ? Number(opts.target) : null;
    return {
      name: r.name,
      text: short(f.value, f.format),
      change: compare && !f.pointInTime ? pct(f.value, f.prev) : null,
      vsTarget: target ? Number(f.value) / target : null,
      pointInTime: f.pointInTime,
    };
  });

  const [first, ...others] = parts;
  const lead = `${title}: ${first.name.toLowerCase()} ${first.text}${first.change !== null ? `, ${move(first.change)}` : ""}.`;

  const notes = others
    .map((p) => ({ ...p, weight: Math.abs(p.change ?? 0) + (p.vsTarget !== null ? Math.abs(1 - p.vsTarget) * 100 : 0) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((p) => {
      const bits = [`${p.name} ${p.text}`];
      if (p.vsTarget !== null) bits.push(p.vsTarget >= 1 ? "above target" : `${Math.round(p.vsTarget * 100)}% of target`);
      else if (p.change !== null) bits.push(move(p.change));
      return `${bits.join(", ")}.`;
    });

  // Needs attention: the red tiles first, then amber — named with their figure.
  const urgent = items("attention")
    .map((it) => results?.[it.questionId])
    .filter(Boolean)
    .map((r) => {
      const opts = r.config?.visual?.options || {};
      const m = r.result?.columns?.find((c) => c.role === "measure");
      const v = r.result?.kpi ? kpiOf(r)?.value : r.result?.rows?.[0]?.[m?.key];
      const rule = (opts.rules || []).find((x) => {
        const n = Number(v);
        const a = Number(x.value);
        return x.op === ">" ? n > a : x.op === ">=" ? n >= a : x.op === "<" ? n < a : x.op === "<=" ? n <= a : false;
      });
      return { name: r.name, text: short(v, m?.format), level: rule?.color === "rust" ? 2 : rule?.color === "brass" ? 1 : 0 };
    })
    .filter((x) => x.level > 0)
    .sort((a, b) => b.level - a.level)
    .slice(0, 3);
  const attention = urgent.length ? `Needs attention: ${urgent.map((u) => `${u.name.toLowerCase()} ${u.text}`).join(" · ")}.` : "";

  return { lead, rest: [...notes, attention].filter(Boolean).join(" ") };
}
