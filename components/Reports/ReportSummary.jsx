"use client";

// KPI strip — the report's summary figures (config.summaryFields read from the
// API's `summary`) as one row of tiles inside the report card, divided by
// hairlines (design: artifact "Wide Report Layout", `.kpis`). Up to 5 tiles
// show (6 on very wide screens); "+N more" opens the strip in place. Two per
// row on a phone. Exports keep their own summary logic — this is display only.

import React, { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAmount } from "./layout";
import { amountInWords } from "@/lib/reports/displayPrefs";

const SHOWN = 5; // tiles before "+N more"
const SHOWN_WIDE = 6; // the same on a very wide screen (≥1600px)

const nf = (min, max) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: min, maximumFractionDigits: max });
const isPercent = (f) => f.type === "percent" || f.type === "percentage";

// "1,234,567.5" · "1,234.6k" (in thousands) · "12.50%" · plain text.
// Amounts follow the user's Display settings (12,34,567.50 or 1,234,567.50,
// thousand / lakh / crore, negatives).
function formatKpi(f, val, { scale }) {
  if (val === null || val === undefined || val === "") return "—";
  const n = Number(val);
  if (f.type === "currency") {
    if (!Number.isFinite(n)) return String(val);
    return formatAmount(n, scale);
  }
  if (isPercent(f)) return Number.isFinite(n) ? `${n.toFixed(2)}%` : String(val);
  if (typeof val === "number") return val.toLocaleString();
  return String(val);
}

function KpiTile({ f, val, currencyCode, scale, className = "" }) {
  const n = Number(val ?? 0);
  const neg = Number.isFinite(n) && n < 0;
  const text = formatKpi(f, val, { scale });
  const unit = f.type === "currency" ? currencyCode : f.unit || "";
  return (
    <div className={`min-w-0 border-b border-r border-border px-3 py-2.5 sm:px-4 sm:py-3 ${className}`}>
      <span className="block truncate text-[11.5px] text-muted-foreground" title={f.label}>
        {f.label}
      </span>
      <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
        {isPercent(f) ? (
          <span
            className={`rounded px-1.5 py-0.5 text-[15px] font-semibold tabular-nums leading-tight ${
              neg
                ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                : "bg-[#edf2ee] text-[#2f5139] dark:bg-[#1f2e23] dark:text-[#a9d3b4]"
            }`}
          >
            {text}
          </span>
        ) : (
          <b
            className={`min-w-0 truncate text-[15px] font-semibold tabular-nums leading-tight sm:text-[17px] ${
              f.type === "currency" && neg ? "text-destructive" : "text-foreground"
            }`}
            title={f.type === "currency" && Number.isFinite(n) ? `${text} — ${amountInWords(n)}` : text}
          >
            {text}
          </b>
        )}
        {unit ? <em className="shrink-0 text-[11px] not-italic text-muted-foreground">{unit}</em> : null}
      </div>
    </div>
  );
}

/**
 * fields      config.summaryFields
 * summary     the API's summary object ({} while nothing has loaded)
 * loading     first load — skeleton tiles
 * fetching    a refetch — the previous values stay, dimmed
 * scale       the user's "Show amounts as" (full | k | lakh | crore)
 */
export default function ReportSummary({ fields = [], summary = {}, loading, fetching, currencyCode, scale = "full" }) {
  const [expanded, setExpanded] = useState(false);
  const tiles = useMemo(() => fields.filter((f) => summary[f.field] !== undefined), [fields, summary]);

  if (loading && tiles.length === 0) {
    const n = Math.min(Math.max(fields.length, 2), SHOWN);
    return (
      <div className="overflow-hidden border-b border-border" aria-busy="true">
        <div className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 lg:[grid-template-columns:var(--kpi-cols)]" style={{ "--kpi-cols": `repeat(${n},minmax(0,1fr))` }}>
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="space-y-2 border-b border-r border-border px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (tiles.length === 0) return null;

  const total = tiles.length;
  const moreLg = !expanded && total > SHOWN;
  const moreXl = !expanded && total > SHOWN_WIDE;
  // Collapsed: one row, the tiles share the width and "+N more" takes what it needs.
  // Expanded: every tile, wrapping 5 (6) to a row.
  const colsLg = expanded ? `repeat(${Math.min(total, SHOWN)},minmax(0,1fr))` : `repeat(${Math.min(total, SHOWN)},minmax(0,1fr))${moreLg ? " auto" : ""}`;
  const colsXl = expanded ? `repeat(${Math.min(total, SHOWN_WIDE)},minmax(0,1fr))` : `repeat(${Math.min(total, SHOWN_WIDE)},minmax(0,1fr))${moreXl ? " auto" : ""}`;

  const tileClass = (i) => {
    if (expanded || i < SHOWN) return "";
    if (i < SHOWN_WIDE) return "hidden min-[1600px]:block";
    return "hidden";
  };

  return (
    <div className={`overflow-hidden border-b border-border bg-background transition-opacity duration-200 ${fetching ? "opacity-60" : ""}`}>
      <div
        className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 lg:[grid-template-columns:var(--kpi-lg)] min-[1600px]:[grid-template-columns:var(--kpi-xl)]"
        style={{ "--kpi-lg": colsLg, "--kpi-xl": colsXl }}
      >
        {tiles.map((f, i) => (
          <KpiTile
            key={f.field}
            f={f}
            val={summary[f.field]}
            currencyCode={currencyCode}
            scale={scale}
            className={tileClass(i)}
          />
        ))}
        {(moreLg || expanded) && total > SHOWN && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className={`flex min-h-10 items-center justify-center whitespace-nowrap border-b border-r border-border px-4 py-3 text-xs font-semibold text-primary hover:bg-primary/5 ${
              !expanded && !moreXl ? "min-[1600px]:hidden" : ""
            }`}
          >
            {expanded ? (
              "Show less"
            ) : (
              <>
                <span className="min-[1600px]:hidden">+{total - SHOWN} more</span>
                {moreXl && <span className="hidden min-[1600px]:inline">+{total - SHOWN_WIDE} more</span>}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
