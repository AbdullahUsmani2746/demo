"use client";
// components/bi/Cards.jsx — the dashboard's headline pieces (2026-11 redesign):
//   HeroCard   big figure + unit, vs previous period, vs last year, trend line,
//              target bullet bar (visual.options.monthlyTarget prorated to the
//              period, or options.target as a fixed line), source footer
//   MiniCard   the compact row: figure + change
//   AlertTile  "Needs attention": a dot by its colour rule, figure, Seen / Open
// Sections choose them by kind (DashboardCanvas): hero · compact · attention.
import { Info } from "lucide-react";
import { formatFull, formatValue, valueParts } from "./format";
import { ruleColorKey } from "./drill";
import { parsePeriod, prorateMonthly } from "@/lib/bi/periods";

const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/** % change, or null when there is nothing to compare with. */
export function pctChange(cur, base) {
  const a = num(cur);
  const b = num(base);
  if (a === null || b === null || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

/** The figures a KPI result gives a card: main value, previous, last year. */
export function kpiFigures(result) {
  const k = result?.kpi || {};
  const m = result?.columns?.find((c) => c.role === "measure");
  if (result?.meta?.pointInTime) return { value: k.now, format: m?.format, pointInTime: true };
  return { value: k.sel ?? k.mtd, prev: k.prev, ly: k.ly, spark: k.spark || [], format: m?.format };
}

function Delta({ value, goodWhenDown, suffix }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const up = value > 0.05;
  const down = value < -0.05;
  const good = goodWhenDown ? down : up;
  const bad = goodWhenDown ? up : down;
  return (
    <span className={`bi-delta ${good ? "good" : bad ? "bad" : "flat"}`}>
      {up ? "▲" : down ? "▼" : ""} {Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%{suffix ? ` ${suffix}` : ""}
    </span>
  );
}

function Spark({ points }) {
  const vals = (points || []).map((p) => Number(p.v) || 0);
  if (vals.length < 2 || vals.every((v) => v === 0)) return null;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const pts = vals.map((v, i) => `${(i * 96) / (vals.length - 1)},${32 - ((v - min) / (max - min || 1)) * 28}`).join(" ");
  return (
    <svg className="bi-spark" viewBox="0 0 96 36" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Target for this period: a monthly target spread over its days, or a fixed one. */
export function cardTarget(options, period) {
  if (options?.monthlyTarget) return { value: prorateMonthly(options.monthlyTarget, parsePeriod(period)), label: "Target", monthly: true };
  if (options?.target) return { value: Number(options.target), label: options.targetLabel || "Target" };
  return null;
}

function Bullet({ value, target, format, label }) {
  const v = num(value);
  const t = num(target);
  if (v === null || !t) return null;
  const scale = Math.max(v, t) * 1.15 || 1;
  const pct = (v / t) * 100;
  const tone = pct >= 100 ? "good" : pct >= 80 ? "warn" : "bad";
  return (
    <div className="bi-bullet" title={`${label} ${formatFull(t, format)}`}>
      <div className="track">
        <span className={`bar ${tone}`} style={{ width: `${(v / scale) * 100}%` }} />
        <span className="line" style={{ left: `${(t / scale) * 100}%` }} />
      </div>
      <div className="meta">
        <span>{label} {formatValue(t, format)}</span>
        <b className="num">{pct.toFixed(0)}%</b>
      </div>
    </div>
  );
}

export function HeroCard({ name, description, datasetLabel, result, period, options = {}, compare, onOpen, onInfo, onWhy, updatedAt }) {
  const f = kpiFigures(result);
  const parts = valueParts(f.value, f.format);
  const target = cardTarget(options, period);
  const goodWhenDown = options.goodWhen === "down";
  return (
    <div className="bi-hero-card" role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen}
      onKeyDown={onOpen ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen()) : undefined}
      title={formatFull(f.value, f.format)}>
      <div className="head">
        <span className="lbl">
          {name}
          {(description || onInfo) && (
            <button type="button" className="info" aria-label={`How is ${name} worked out?`} title={description || "How is this worked out?"}
              onClick={(e) => { e.stopPropagation(); onInfo?.(); }}>
              <Info size={13} />
            </button>
          )}
        </span>
        {!f.pointInTime && <Spark points={f.spark} />}
      </div>
      <div className="fig num"><span className="v">{parts.value}</span>{parts.unit && <span className="u">{parts.unit}</span>}</div>
      <div className="deltas">
        {f.pointInTime ? (
          <span className="bi-delta flat">As of now</span>
        ) : compare ? (
          <>
            {onWhy && pctChange(f.value, f.prev) !== null ? (
              <button type="button" className="bi-why-btn" title="Why did it change?" onClick={(e) => { e.stopPropagation(); onWhy(); }}>
                <Delta value={pctChange(f.value, f.prev)} goodWhenDown={goodWhenDown} suffix="vs prev." />
              </button>
            ) : (
              <Delta value={pctChange(f.value, f.prev)} goodWhenDown={goodWhenDown} suffix="vs prev." />
            )}
            {pctChange(f.value, f.ly) !== null && <span className="bi-delta ly">{pctChange(f.value, f.ly) > 0 ? "+" : ""}{pctChange(f.value, f.ly).toFixed(0)}% vs last year</span>}
          </>
        ) : null}
      </div>
      {target && <Bullet value={f.value} target={target.value} format={f.format} label={target.label} />}
      <div className="foot">{datasetLabel ? `Source: ${datasetLabel}` : ""}{updatedAt ? ` · updated ${updatedAt}` : ""}</div>
    </div>
  );
}

export function MiniCard({ name, result, compare, options = {}, onOpen }) {
  const f = kpiFigures(result);
  const parts = valueParts(f.value, f.format);
  return (
    <button type="button" className="bi-mini-card" onClick={onOpen} title={formatFull(f.value, f.format)}>
      <span className="lbl">{name}</span>
      <span className="fig num"><b>{parts.value}</b>{parts.unit && <small>{parts.unit}</small>}</span>
      {f.pointInTime ? <span className="bi-delta flat">As of now</span> : compare && <Delta value={pctChange(f.value, f.prev)} goodWhenDown={options.goodWhen === "down"} />}
    </button>
  );
}

/** Main figure of a number / KPI result, for an attention tile. */
export function alertValue(result) {
  if (!result) return null;
  if (result.kpi) return kpiFigures(result);
  const m = result.columns?.find((c) => c.role === "measure");
  return { value: result.rows?.[0]?.[m?.key], format: m?.format };
}

/** How urgent a tile is, from its colour rule: rust 3, brass 2, other 1, 0 when nothing to do. */
export function alertSeverity(result, options = {}) {
  const f = alertValue(result);
  const key = ruleColorKey(f?.value, options.rules);
  if (key === "rust") return 3;
  if (key === "brass") return 2;
  if (key) return 1;
  return Number(f?.value) ? 1 : 0;
}

export function AlertTile({ name, result, options = {}, seen, onSeen, onOpen, actionLabel }) {
  const f = alertValue(result);
  const key = ruleColorKey(f?.value, options.rules);
  const parts = valueParts(f?.value, f?.format);
  return (
    <div className={`bi-alert ${key || "none"} ${seen ? "seen" : ""}`}>
      <span className="dot" aria-hidden="true" />
      <button type="button" className="body" onClick={onOpen}>
        <span className="lbl">{name}</span>
        <span className="fig num">{parts.value}{parts.unit && <small> {parts.unit}</small>}</span>
      </button>
      {onSeen && (
        <button type="button" className="bi-btn act" onClick={onSeen} aria-pressed={seen}>
          {actionLabel || (seen ? "Unsee" : "Seen")}
        </button>
      )}
    </div>
  );
}
