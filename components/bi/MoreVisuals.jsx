"use client";
// components/bi/MoreVisuals.jsx — the redesign's extra visuals (lib/bi/visuals.js):
//   bullet     one row per group: a bar for the actual (measure 1), a line for
//              the target (measure 2), "expected by today" shading on a period
//              that is still running, a status dot
//   multiples  one small bar chart per value of group-by 1, group-by 2 (a date)
//              across — every chart on the same scale, so they compare
//   share      one stacked bar + its legend (e.g. receivables by age)
// And withOthers(): "Top N + Others" for any table / chart (options.topN).
import { dimLabel, formatFull, formatValue } from "./format";
import { pointFromRow } from "./drill";
import { parsePeriod } from "@/lib/bi/periods";

const SHARE_COLORS = ["#3F8A5A", "#C99A2E", "#D07A3A", "#C8483B", "#8E1E14", "#6B7A8C", "#8C8579", "#3F5E7A"];

/** Keep the biggest N rows (by the first measure) and add the rest as one "Others" row. */
export function withOthers(result, n) {
  const N = Number(n);
  const dims = result?.columns?.filter((c) => c.role === "dimension") ?? [];
  const meas = result?.columns?.filter((c) => c.role === "measure") ?? [];
  if (!N || dims.length !== 1 || result.rows.length <= N || !meas.length) return result;
  const key = meas[0].key;
  const sorted = [...result.rows].sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
  const top = sorted.slice(0, N);
  const rest = sorted.slice(N);
  const other = { [dims[0].key]: `Others (${rest.length})`, __others: true };
  for (const m of meas) other[m.key] = ["sum", "count"].includes(m.agg) ? rest.reduce((s, r) => s + (Number(r[m.key]) || 0), 0) : null;
  return { ...result, rows: [...top, other] };
}

/** How far through a running period we are (0–1), for "expected by today". */
function elapsedShare(period) {
  const p = parsePeriod(period);
  if (!p) return null;
  const now = new Date();
  if (now > p.to) return null; // the period is over
  const share = (now - p.from) / (p.to - p.from);
  return share > 0 && share < 1 ? share : null;
}

export function BulletBody({ result, period, onDrill }) {
  const d0 = result.columns.find((c) => c.role === "dimension");
  const [mA, mT] = result.columns.filter((c) => c.role === "measure");
  if (!d0 || !mA || !mT) return <div className="bi-empty">Bullet needs one group-by and two measures (actual, target).</div>;
  const scale = Math.max(1, ...result.rows.flatMap((r) => [Number(r[mA.key]) || 0, Number(r[mT.key]) || 0])) * 1.08;
  const exp = elapsedShare(period);
  return (
    <div className="bi-bullets">
      {exp !== null && (
        <div className="bi-bullets-legend">
          <span><i className="a" />{mA.label}</span><span><i className="t" />{mT.label}</span><span><i className="e" />Expected by today</span>
        </div>
      )}
      {result.rows.map((r, i) => {
        const a = Number(r[mA.key]) || 0;
        const t = Number(r[mT.key]) || 0;
        const expected = exp !== null ? t * exp : t;
        const tone = !t ? "none" : a >= expected ? "good" : a >= expected * 0.8 ? "warn" : "bad";
        return (
          <button key={i} type="button" className="bi-bullet-row" onClick={onDrill ? () => onDrill(pointFromRow(result, r)) : undefined}>
            <span className="name" title={dimLabel(r[d0.key], d0)}>{dimLabel(r[d0.key], d0)}</span>
            <span className="track">
              {exp !== null && t > 0 && <span className="exp" style={{ width: `${(expected / scale) * 100}%` }} />}
              <span className="bar" style={{ width: `${(a / scale) * 100}%` }} />
              {t > 0 && <span className="line" style={{ left: `${(t / scale) * 100}%` }} />}
            </span>
            <span className="fig num">
              <b>{formatValue(a, mA.format)}</b> <span>/ {formatValue(t, mT.format)}</span>
              <i className={`dot ${tone}`} aria-hidden="true" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MultiplesBody({ result, onDrill }) {
  const [d0, d1] = result.columns.filter((c) => c.role === "dimension");
  const m = result.columns.find((c) => c.role === "measure");
  if (!d0 || !d1 || !m) return <div className="bi-empty">Small charts need two group-bys (the chart, then the date) and one measure.</div>;
  const groups = [...new Set(result.rows.map((r) => dimLabel(r[d0.key], d0)))];
  const xs = [...new Set(result.rows.map((r) => String(r[d1.key])))].sort();
  const max = Math.max(1, ...result.rows.map((r) => Number(r[m.key]) || 0));
  return (
    <div className="bi-multiples">
      {groups.map((g) => {
        const rows = result.rows.filter((r) => dimLabel(r[d0.key], d0) === g);
        const by = new Map(rows.map((r) => [String(r[d1.key]), Number(r[m.key]) || 0]));
        const last = by.get(xs[xs.length - 1]) ?? 0;
        return (
          <button key={g} type="button" className="bi-multiple" onClick={onDrill ? () => onDrill({ d0: rows[0]?.[d0.key] }) : undefined}>
            <span className="head"><span className="name" title={g}>{g}</span><b className="num">{formatValue(last, m.format)}</b></span>
            <span className="bars">
              {xs.map((x, i) => (
                <span key={x} className={i === xs.length - 1 ? "now" : ""} style={{ height: `${((by.get(x) ?? 0) / max) * 100}%` }}
                  title={`${dimLabel(x, d1)}: ${formatFull(by.get(x) ?? 0, m.format)}`} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ShareBody({ result, onDrill }) {
  const d0 = result.columns.find((c) => c.role === "dimension");
  const m = result.columns.find((c) => c.role === "measure");
  if (!d0 || !m) return <div className="bi-empty">Share needs one group-by and one measure.</div>;
  const rows = result.rows.map((r) => ({ r, v: Math.max(Number(r[m.key]) || 0, 0) }));
  const total = rows.reduce((s, x) => s + x.v, 0) || 1;
  return (
    <div className="bi-share">
      <div className="bar" role="img" aria-label={`${m.label} by ${d0.label}`}>
        {rows.map((x, i) => (
          <span key={i} style={{ width: `${(x.v / total) * 100}%`, background: SHARE_COLORS[i % SHARE_COLORS.length] }}
            title={`${dimLabel(x.r[d0.key], d0)}: ${formatFull(x.v, m.format)}`} />
        ))}
      </div>
      <ul>
        {rows.map((x, i) => (
          <li key={i}>
            <button type="button" onClick={onDrill ? () => onDrill(pointFromRow(result, x.r)) : undefined}>
              <i style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }} aria-hidden="true" />
              <span className="name">{dimLabel(x.r[d0.key], d0)}</span>
              <span className="pct num">{Math.round((x.v / total) * 100)}%</span>
              <b className="num">{formatValue(x.v, m.format)}</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
