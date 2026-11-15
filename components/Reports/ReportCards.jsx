"use client";
// Phone layout of the wide report table (under md): each row is a card with
// its title, subtitle and up to four figures; "All figures" opens the full
// list in place. Row groups become section heads, and the grand total stays
// pinned at the bottom. Long reports draw in batches so a phone never builds
// thousands of cards at once. Numbers follow the user's Display settings
// (grouping, thousand / lakh / crore, negatives) through formatValue.
import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { FieldGroups, ActionButtons } from "./RowDetailPanel";
import { fieldText, formatValue } from "./layout";

const BATCH = 80;

function Card({ model, row, figures, amounts, actionsFor, onOpen, tone }) {
  const [open, setOpen] = useState(false);
  const title = fieldText(model, model.card.title, row);
  const sub = model.card.subtitle ? fieldText(model, model.card.subtitle, row) : "";
  const [lead, ...rest] = figures;
  // tone: the report's warnings / the user's highlight rules (WideTable cardTone).
  return (
    <div className={`grid gap-2 rounded-xl border border-border bg-background p-3 ${tone?.className || ""}`} style={tone?.style}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => onOpen(row)} className="min-w-0 text-left">
          {sub && <span className="rounded bg-primary/10 px-1.5 py-px text-[11.5px] font-semibold text-primary">{sub}</span>}
          <b className="block break-words text-[13.5px] leading-snug text-foreground">{title || "—"}</b>
        </button>
        {lead && (
          <div className="shrink-0 text-right">
            <span className="block text-[10.5px] text-muted-foreground">{lead.label}</span>
            <b className="text-[16px] font-extrabold tabular-nums text-foreground">{formatValue(lead.col, lead.get(row), { amounts }) || "–"}</b>
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <div className="grid grid-cols-3 gap-1 text-[11px]">
          {rest.map((f) => (
            <div key={f.key} className="min-w-0">
              <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</span>
              <b className="font-semibold tabular-nums text-foreground">{formatValue(f.col, f.get(row), { amounts }) || "–"}</b>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 justify-self-start text-xs font-semibold text-primary"
      >
        {open ? "Fewer figures" : "All figures"}
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="grid gap-2">
          <FieldGroups model={model} row={row} amounts={amounts} compact />
          <ActionButtons actions={actionsFor(row)} />
        </div>
      )}
    </div>
  );
}

export default function ReportCards({ model, items, figures, totals, amounts, actionsFor, onOpen, onToggleGroup, showTotals, toneFor }) {
  const [limit, setLimit] = useState(BATCH);
  useEffect(() => setLimit(BATCH), [items]);
  const shown = items.slice(0, limit);
  const totalFigs = figures.filter((f) => totals[f.key] !== undefined).slice(0, 2);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="grid gap-2 p-2">
        {shown.map((it, i) => {
          if (it.type === "group") {
            // A grouped document's header (layout.groupRows) is a card head
            // of its own: label, its header figures and the voucher button.
            const headActs = it.row ? actionsFor(it.row) : [];
            const headFigs = it.fields ? figures.filter((f) => it.fields.has(f.key) && Number(f.get(it.row))) : [];
            if (it.row && (headActs.length || headFigs.length)) {
              return (
                <div
                  key={it.id}
                  className="grid gap-1.5 rounded-xl border border-primary/25 bg-primary/5 p-2.5"
                  style={{ marginLeft: it.depth * 8 }}
                >
                  <button
                    type="button"
                    onClick={() => onToggleGroup(it.id)}
                    aria-expanded={!it.collapsed}
                    className="flex items-start gap-1 text-left text-[12.5px] font-semibold text-primary"
                  >
                    {it.collapsed ? <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <span className="min-w-0 break-words">
                      {it.label} <span className="font-normal text-muted-foreground">· {it.count}</span>
                    </span>
                  </button>
                  {headFigs.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px]">
                      {headFigs.slice(0, 3).map((f) => (
                        <span key={f.key} className="flex gap-1.5">
                          <span className="text-muted-foreground">{f.label}</span>
                          <b className="font-bold tabular-nums text-foreground">{formatValue(f.col, f.get(it.row), { amounts }) || "–"}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  {headActs.length > 0 && <ActionButtons actions={headActs} />}
                </div>
              );
            }
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onToggleGroup(it.id)}
                aria-expanded={!it.collapsed}
                className="flex items-center gap-1 px-0.5 pt-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-primary"
                style={{ paddingLeft: it.depth * 10 }}
              >
                {it.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {it.label} · {it.count}
              </button>
            );
          }
          if (it.type === "sub") {
            const subFigs = figures.filter((f) => it.totals[f.key] !== undefined).slice(0, 3);
            if (!subFigs.length) return null;
            return (
              <div key={it.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted px-3 py-1.5 text-[11.5px]">
                <span className="text-muted-foreground">{it.label}</span>
                {subFigs.map((f) => (
                  <b key={f.key} className="font-bold tabular-nums text-foreground">
                    {formatValue(f.col, it.totals[f.key], { amounts }) || "–"}
                  </b>
                ))}
              </div>
            );
          }
          return (
            <Card key={i} model={model} row={it.row} figures={figures} amounts={amounts} actionsFor={actionsFor} onOpen={onOpen} tone={toneFor?.(it.row)} />
          );
        })}
        {items.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((n) => n + BATCH * 2)}
            className="h-10 rounded-lg border border-border bg-background text-sm font-medium text-primary"
          >
            Show more ({items.length - limit} left)
          </button>
        )}
      </div>
      {showTotals && totalFigs.length > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-wrap justify-between gap-x-4 gap-y-1 bg-primary px-3.5 py-2.5 text-[12.5px] text-primary-foreground">
          {totalFigs.map((f) => (
            <span key={f.key} className="flex gap-2">
              <span className="opacity-80">Total {f.label}</span>
              <b className="font-bold tabular-nums">{formatValue(f.col, totals[f.key], { amounts }) || "0"}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
