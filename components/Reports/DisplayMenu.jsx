"use client";
// "Display" on every report (design: artifact "Report Table Redesign", screen 2).
// The user's own settings — saved on their account (hooks/useReportDisplay.js)
// and used by the table, phone cards, KPI strip and Excel / PDF.

import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_DISPLAY } from "@/lib/reports/displayPrefs";

function Seg({ label, value, options, onChange }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div role="group" aria-label={label} className="flex gap-0.5 rounded-lg bg-muted p-0.5">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={`h-8 min-w-0 flex-1 truncate rounded-md px-1.5 text-[12.5px] transition-colors ${
              value === id ? "bg-background font-bold text-primary shadow-sm" : "font-medium text-muted-foreground hover:text-foreground"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ checked, onChange, children }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-9 w-full items-center justify-between gap-3 text-left text-[13px]"
    >
      <span>{children}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

const BOLD_OPTIONS = [
  ["amount", "Amounts"],
  ["rate", "Rates / prices"],
  ["qty", "Quantities"],
  ["totals", "Totals"],
];

export default function DisplayMenu({ display, onChange, compareAvailable, compareOn, onCompare }) {
  const set = (k) => (v) => onChange({ [k]: v });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[12.5px] font-medium hover:border-primary hover:text-primary data-[state=open]:border-primary data-[state=open]:bg-primary data-[state=open]:text-primary-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Display
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(80vh,640px)] w-[min(372px,calc(100vw-1.5rem))] overflow-y-auto rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-extrabold">Display</p>
            <p className="text-xs text-muted-foreground">Saved on your account · every report, any device</p>
          </div>
          {/* Reset the look only — highlight rules (Highlight button) stay. */}
          <button
            type="button"
            onClick={() =>
              onChange({ ...DEFAULT_DISPLAY, bold: { ...DEFAULT_DISPLAY.bold }, rules: display.rules, hlMin: display.hlMin, hlNegative: display.hlNegative })
            }
            className="h-8 rounded-md bg-muted px-2.5 text-xs font-semibold hover:bg-muted/70">
            Reset
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3.5">
          <Seg label="Text size" value={display.size} options={[["S", "Small"], ["M", "Medium"], ["L", "Large"]]} onChange={set("size")} />
          <Seg label="Bold numbers look" value={display.weight} options={[["regular", "Regular"], ["medium", "Medium"], ["bold", "Bold"]]} onChange={set("weight")} />

          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Make bold</p>
            <div className="flex flex-wrap gap-1.5">
              {BOLD_OPTIONS.map(([k, text]) => {
                const on = display.bold[k];
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ bold: { ...display.bold, [k]: !on } })}
                    className={`h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
                      on ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {on ? "✓ " : "+ "}
                    {text}
                  </button>
                );
              })}
            </div>
          </div>

          <Seg label="Number grouping" value={display.grouping} options={[["lakh", "12,34,567"], ["intl", "1,234,567"]]} onChange={set("grouping")} />
          <Seg label="Show amounts as" value={display.scale} options={[["full", "Full"], ["k", "Thousand"], ["lakh", "Lakh"], ["crore", "Crore"]]} onChange={set("scale")} />
          <Seg label="Rows" value={display.density} options={[["compact", "Compact"], ["comfortable", "Roomy"]]} onChange={set("density")} />
          <Seg label="Dates" value={display.dateFmt} options={[["short", "03 Oct 2026"], ["numeric", "03/10/2026"]]} onChange={set("dateFmt")} />

          <div className="flex flex-col">
            <Switch checked={display.zebra} onChange={set("zebra")}>Striped rows</Switch>
            <Switch checked={display.brackets} onChange={set("brackets")}>Negatives in (brackets)</Switch>
            <Switch checked={display.decimals} onChange={set("decimals")}>Show 2 decimals</Switch>
            {compareAvailable && (
              <Switch checked={!!compareOn} onChange={(v) => onCompare?.(v)}>Compare with previous period</Switch>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
