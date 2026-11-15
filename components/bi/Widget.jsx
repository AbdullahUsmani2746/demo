"use client";
// components/bi/Widget.jsx — one question drawn as KPI card / number / table /
// pivot / any ECharts visual, in the bi.css look.
//   visual.options.target — KPI / number: progress to target; charts: a target line
//   visual.options.rules  — colour rules [{ op, value, value2?, color }] on the
//                           main figure (KPI / number) or the first measure (table)
//   onDrill(point)        — click a bar / slice / row / card → its records
import { useMemo, useState } from "react";
import { Search, X, Flag, CheckCircle2, PauseCircle, PenLine } from "lucide-react";
import EChart from "./EChart";
import { buildOption } from "./chartOption";
import { dimLabel, formatValue, formatFull, PERIOD_LABEL } from "./format";
import { pointFromChart, pointFromRow, ruleColor, rowFlag } from "./drill";
import { visualByKey, KPI_PERIODS } from "@/lib/bi/visuals";
import { HeroCard } from "./Cards";
import { BulletBody, MultiplesBody, ShareBody, withOthers } from "./MoreVisuals";
import { TOPN_VISUALS } from "@/lib/bi/visuals";

function TargetBar({ value, target, format }) {
  const t = Number(target);
  if (!t) return null;
  const pct = (Number(value) / t) * 100;
  const under = pct < 85;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
        <span>Target <b className="num" style={{ color: "var(--text)" }}>{formatValue(t, format)}</b></span>
        <b className="num" style={{ color: under ? "var(--rust)" : "var(--moss)" }}>{pct.toFixed(0)}%</b>
      </div>
      <div style={{ height: 6, background: "var(--border-soft)", borderRadius: 4, overflow: "hidden", marginTop: 5 }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: under ? "var(--rust)" : "var(--brass)", borderRadius: 4 }} />
      </div>
    </div>
  );
}

function KpiBody({ result, period, options }) {
  const m = result.columns.find((c) => c.role === "measure");
  const k = result.kpi || {};
  if (result.meta?.pointInTime) {
    return (
      <>
        <div className="bi-kpi-primary num" style={{ color: ruleColor(k.now, options.rules) }}>{formatValue(k.now, m?.format)}</div>
        <div className="bi-kpi-period">As of now</div>
        <TargetBar value={k.now} target={options.target} format={m?.format} />
      </>
    );
  }
  const main = KPI_PERIODS.includes(period) ? period : "mtd";
  return (
    <>
      <div className="bi-kpi-primary num" style={{ color: ruleColor(k[main], options.rules) }}>{formatValue(k[main], m?.format)}</div>
      <div className="bi-kpi-period">{PERIOD_LABEL[main]}</div>
      <div className="bi-kpi-rows">
        {KPI_PERIODS.map((p) => (
          <div key={p} className={`bi-kpi-row ${p === main ? "hi" : ""}`}>
            <span>{PERIOD_LABEL[p]}</span>
            <b className="num">{formatValue(k[p], m?.format)}</b>
          </div>
        ))}
      </div>
      <TargetBar value={k[main]} target={options.target} format={m?.format} />
    </>
  );
}

function NumberBody({ result, options }) {
  const ms = result.columns.filter((c) => c.role === "measure");
  const row = result.rows[0] || {};
  return (
    <>
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
        {ms.map((m, i) => (
          <div key={m.key}>
            {ms.length > 1 && <div className="bi-sub" style={{ marginBottom: 4 }}>{m.label}</div>}
            <div
              className={i === 0 ? "bi-big num" : "num"}
              style={i ? { fontSize: 20, fontWeight: 600 } : { color: ruleColor(row[m.key], options.rules) }}
            >
              {formatValue(row[m.key], m.format)}
            </div>
          </div>
        ))}
      </div>
      <TargetBar value={row[ms[0]?.key]} target={options.target} format={ms[0]?.format} />
    </>
  );
}

// Status-like values get a coloured pill so a list reads at a glance:
// green = done, amber = in progress / waiting, red = needs action.
const TONE_RULES = [
  [/^(fully dispatched|received|received \(grn\)|closed|yes|invoiced|approved|open deal)$/i, "good"],
  [/(not dispatched|expired|eta passed|bad|late|rejected|overdue|^no$|not invoiced)/i, "bad"],
  [/(partly|pending|expiring|in transit|in bond|arrived|negotiation|trial|free of cost|open)/i, "warn"],
];
const PILL_FIELD = /(status|stage|\?|type|invoiced)/i;
function toneOf(text) {
  for (const [re, tone] of TONE_RULES) if (re.test(text)) return tone;
  return "neutral";
}
function DimCell({ value, col, first }) {
  const text = dimLabel(value, col);
  if (PILL_FIELD.test(col.label || "") && text && text !== "(blank)") {
    return <span className={`bi-pill bi-pill-${toneOf(text)}`}>{text}</span>;
  }
  return <span className={first ? "bi-cell-key" : "bi-cell-text"} title={text}>{text}</span>;
}

// Only sums and counts add up across rows (averages / distincts do not).
const summable = (c) => c.role === "measure" && ["sum", "count"].includes(c.agg);

// Follow-up status of a row (scenario questions — BI Designer → Follow-up).
const followupOf = (followup, cols, row) => {
  if (!followup?.items) return null;
  const field = String(followup.key || "").replace(/^d:/, "");
  const col = cols.find((c) => c.role === "dimension" && c.field === field);
  return col ? followup.items[String(row[col.key] ?? "")] ?? null : null;
};
const isSnoozed = (fu) => fu?.status === "open" && fu.due && new Date(fu.due) > new Date();
const shortDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "");

function TableBody({ result, options, onDrill, followup, onFollowup }) {
  const cols = result.columns;
  const hasDims = cols.some((c) => c.role === "dimension");
  const firstMeasure = cols.find((c) => c.role === "measure")?.key;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(null); // { key, dir }
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const rowRules = options.rowRules;
  // Follow-up flags (visual.options.rowRules), worked out once per result.
  // A row whose follow-up is done or snoozed is no longer "to follow up".
  const flags = useMemo(
    () =>
      new Map(
        result.rows.map((r) => {
          const fu = followupOf(followup, cols, r);
          return [r, fu && (fu.status === "done" || isSnoozed(fu)) ? null : rowFlag(r, cols, rowRules)];
        }),
      ),
    [result.rows, cols, rowRules, followup],
  );
  const flaggedCount = useMemo(() => [...flags.values()].filter(Boolean).length, [flags]);

  // Search across every column as it is shown; then sort by a clicked header.
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = flaggedOnly ? result.rows.filter((r) => flags.get(r)) : result.rows;
    out = term
      ? out.filter((r) =>
          cols.some((c) => String(c.role === "measure" ? formatFull(r[c.key], c.format) : dimLabel(r[c.key], c)).toLowerCase().includes(term)),
        )
      : out;
    if (sort) {
      const c = cols.find((x) => x.key === sort.key);
      const mul = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        if (c?.role === "measure") return ((Number(av) || 0) - (Number(bv) || 0)) * mul;
        return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true }) * mul;
      });
    }
    return out;
  }, [result.rows, cols, q, sort, flaggedOnly, flags]);

  // A bar inside the first measure's cells, so the biggest rows stand out.
  const barMax = hasDims && firstMeasure && options.cellBars !== false
    ? Math.max(0, ...result.rows.map((r) => Math.abs(Number(r[firstMeasure]) || 0)))
    : 0;

  const totals = hasDims && rows.length > 1
    ? Object.fromEntries(cols.filter(summable).map((c) => [c.key, rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)]))
    : null;
  const toggleSort = (key) =>
    setSort((s) => (s?.key === key ? (s.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: "desc" }));
  const showTools = hasDims && (result.rows.length > 6 || flaggedCount > 0);

  return (
    <>
      {showTools && (
        <div className="bi-table-tools" onClick={(e) => e.stopPropagation()}>
          <div className="bi-search">
            <Search size={13} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this table…" aria-label="Search this table" />
            {q && (
              <button className="clr" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>
            )}
          </div>
          {flaggedCount > 0 && (
            <button
              className={`bi-flag-toggle ${flaggedOnly ? "on" : ""}`}
              onClick={() => setFlaggedOnly((v) => !v)}
              title={flaggedOnly ? "Show every row" : "Show only the highlighted rows"}
            >
              <Flag size={12} /> {flaggedCount} to follow up{flaggedOnly ? " · showing" : ""}
            </button>
          )}
          <span className="bi-count">
            {rows.length === result.rows.length ? `${rows.length} rows` : `${rows.length} of ${result.rows.length}`}
          </span>
        </div>
      )}
      <div className="bi-table-wrap">
        <table className="bi-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`${c.role === "measure" ? "num" : ""} ${hasDims ? "sortable" : ""}`}
                  onClick={hasDims ? () => toggleSort(c.key) : undefined}
                  title={hasDims ? "Sort" : undefined}
                >
                  {c.label}
                  {sort?.key === c.key && <span className="arrow">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="bi-empty">No rows match “{q}”.</td></tr>
            ) : rows.map((r, i) => {
              const flag = flags.get(r);
              return (
              <tr
                key={i}
                className={flag ? "bi-row-flag" : undefined}
                onClick={onDrill ? () => onDrill(pointFromRow(result, r)) : undefined}
                style={{ ...(onDrill ? { cursor: "pointer" } : {}), ...(flag ? { "--flag": flag.color } : {}) }}
              >
                {cols.map((c, ci) => (
                  <td
                    key={c.key}
                    className={c.role === "measure" ? "num" : ""}
                    style={c.key === firstMeasure ? { color: ruleColor(r[c.key], options.rules) } : undefined}
                  >
                    {ci === 0 && (() => {
                      const fu = followupOf(followup, cols, r);
                      if (fu?.status === "done") return <span className="bi-fu-done" title={fu.label}><CheckCircle2 size={11} /> {fu.label}</span>;
                      if (isSnoozed(fu)) return <span className="bi-fu-snooze"><PauseCircle size={11} /> {shortDate(fu.due)}</span>;
                      return (
                        <>
                          {flag?.label && <span className="bi-flag-pill"><Flag size={10} /> {flag.label}</span>}
                          {fu && onFollowup && (
                            <button
                              type="button"
                              className="bi-fu-log"
                              onClick={(e) => {
                                e.stopPropagation();
                                onFollowup(fu.id);
                              }}
                              title="Log what the customer said"
                            >
                              <PenLine size={11} /> Log
                            </button>
                          )}
                        </>
                      );
                    })()}
                    {c.role === "measure" ? (
                      c.key === firstMeasure && barMax > 0 && rows.length > 1 ? (
                        <span className="bi-cellbar">
                          <span className="bar" style={{ width: `${(Math.abs(Number(r[c.key]) || 0) / barMax) * 100}%` }} />
                          <span className="v">{formatFull(r[c.key], c.format)}</span>
                        </span>
                      ) : formatFull(r[c.key], c.format)
                    ) : <DimCell value={r[c.key]} col={c} first={ci === 0} />}
                  </td>
                ))}
              </tr>
              );
            })}
            {totals && (
              <tr className="total">
                {cols.map((c, i) => (
                  <td key={c.key} className={c.role === "measure" ? "num" : ""} style={{ color: "var(--brass)", fontWeight: 600 }}>
                    {c.role === "measure" ? (c.key in totals ? formatFull(totals[c.key], c.format) : "") : i === 0 ? (q ? "Total (shown)" : "Total") : ""}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PivotBody({ result, options, onDrill }) {
  const [d0, d1] = result.columns.filter((c) => c.role === "dimension");
  const m = result.columns.find((c) => c.role === "measure");
  const rowsK = [...new Map(result.rows.map((r) => [dimLabel(r[d0.key], d0), r[d0.key]])).entries()];
  const colsK = [...new Map(result.rows.map((r) => [dimLabel(r[d1.key], d1), r[d1.key]])).entries()];
  const cell = new Map(result.rows.map((r) => [`${dimLabel(r[d0.key], d0)}|${dimLabel(r[d1.key], d1)}`, Number(r[m.key]) || 0]));
  return (
    <div className="bi-table-wrap">
      <table>
        <thead>
          <tr>
            <th>{d0.label} \ {d1.label}</th>
            {colsK.map(([c]) => <th key={c} className="num">{c}</th>)}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rowsK.map(([rl, rraw]) => {
            const vals = colsK.map(([cl]) => cell.get(`${rl}|${cl}`) ?? 0);
            return (
              <tr key={rl}>
                <td>{rl}</td>
                {vals.map((v, i) => (
                  <td
                    key={i}
                    className="num"
                    style={{ color: ruleColor(v, options.rules), cursor: onDrill && v ? "pointer" : undefined }}
                    onClick={onDrill && v ? () => onDrill({ d0: rraw, d1: colsK[i][1] }) : undefined}
                  >
                    {v ? formatFull(v, m.format) : "—"}
                  </td>
                ))}
                <td className="num" style={{ color: "var(--brass)" }}>{formatFull(vals.reduce((a, b) => a + b, 0), m.format)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Widget({ name, description, datasetLabel, config, result: rawResult, error, period, loading, height, onDrill, followup, onFollowup, compare = true, updatedAt, events }) {
  const type = config?.visual?.type || "table";
  const options = config?.visual?.options || {};
  // "Top N + Others" (options.topN) — the rest summed into one row.
  const result = useMemo(
    () => (rawResult && options.topN && TOPN_VISUALS.includes(type) ? withOthers(rawResult, options.topN) : rawResult),
    [rawResult, options.topN, type],
  );
  const visual = visualByKey(type);
  const option = useMemo(
    () => (result && visual?.echarts ? buildOption(type, result, { ...options, compare, events }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, type, visual, compare, events, JSON.stringify(options)],
  );

  // A KPI shows as the headline card (vs previous, vs last year, target).
  if (type === "kpi" && result?.kpi && !loading && !error) {
    return (
      <HeroCard
        name={name}
        description={description}
        datasetLabel={datasetLabel}
        result={result}
        period={period}
        options={options}
        compare={compare}
        updatedAt={updatedAt}
        onOpen={onDrill ? () => onDrill({}) : undefined}
      />
    );
  }
  const empty = result && type !== "kpi" && result.rows.length === 0;
  const cardClick = onDrill && result && (type === "kpi" || type === "number" || type === "gauge") ? () => onDrill({}) : undefined;

  return (
    <div
      className="bi-card"
      style={{ height: "100%", cursor: cardClick ? "pointer" : undefined }}
      onClick={cardClick}
      title={cardClick ? "Click to see the records" : undefined}
    >
      <div className="bi-card-title">
        <div className="min-w-0">
          <span className="lbl">{name}</span>
          {description && <span className="desc">{description}</span>}
        </div>
      </div>
      {loading ? (
        <div className="bi-skel" style={{ height: type === "kpi" ? 120 : height || 240 }} />
      ) : error ? (
        <div className="bi-error">{error}</div>
      ) : !result ? null : empty ? (
        <div className="bi-empty">No data for this period.</div>
      ) : type === "kpi" ? (
        <KpiBody result={result} period={period} options={options} />
      ) : type === "number" ? (
        <NumberBody result={result} options={options} />
      ) : type === "pivot" ? (
        <PivotBody result={result} options={options} onDrill={onDrill} />
      ) : type === "bullet" ? (
        <BulletBody result={result} period={period} onDrill={onDrill} />
      ) : type === "multiples" ? (
        <MultiplesBody result={result} onDrill={onDrill} />
      ) : type === "share" ? (
        <ShareBody result={result} onDrill={onDrill} />
      ) : visual?.echarts ? (
        <EChart
          option={option}
          height={height || options.height || 280}
          onClick={onDrill && type !== "gauge" ? (p) => onDrill(pointFromChart(type, result, p)) : undefined}
        />
      ) : (
        <TableBody result={result} options={options} onDrill={onDrill} followup={followup} onFollowup={onFollowup} />
      )}
      {result?.meta?.truncated && <div className="bi-sub" style={{ marginTop: 8 }}>Showing the first rows only.</div>}
      {!loading && (datasetLabel || updatedAt) && (
        <div className="bi-card-foot">
          {datasetLabel ? `Source: ${datasetLabel}` : ""}
          {updatedAt ? ` · updated ${updatedAt}` : ""}
          {result?.meta?.pointInTime ? " · as of now" : ""}
        </div>
      )}
    </div>
  );
}
