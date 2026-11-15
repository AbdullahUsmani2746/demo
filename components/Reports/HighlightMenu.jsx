"use client";
// "Highlight" on every report — each user's own colour rules, no code:
//   When [column] [is less than …] [value] → colour [the row | that cell] [colour]
// Saved on the user's account per report (lib/reports/displayPrefs.js `rules`,
// hooks/useReportDisplay.js); WideTable.jsx applies them on the table and the
// phone cards. "On every report" holds the two quick rules (amount ≥ X,
// negative amounts).
import { useEffect, useState } from "react";
import { Highlighter, Plus, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RULE_COLORS, RULE_OPS, RULE_OPS_NO_VALUE } from "@/lib/reports/displayPrefs";

// Swatch + tint of each rule colour (row tint, cell tint, text).
export const RULE_TONES = {
  red: { swatch: "bg-red-500", row: "rgba(220,38,38,0.12)", cell: "rgba(220,38,38,0.22)", text: "text-red-800 dark:text-red-300", label: "Red" },
  amber: { swatch: "bg-amber-400", row: "rgba(245,158,11,0.18)", cell: "rgba(245,158,11,0.32)", text: "text-amber-900 dark:text-amber-200", label: "Amber" },
  green: { swatch: "bg-emerald-500", row: "rgba(16,185,129,0.14)", cell: "rgba(16,185,129,0.26)", text: "text-emerald-800 dark:text-emerald-300", label: "Green" },
  blue: { swatch: "bg-sky-500", row: "rgba(14,165,233,0.14)", cell: "rgba(14,165,233,0.26)", text: "text-sky-800 dark:text-sky-300", label: "Blue" },
  purple: { swatch: "bg-violet-500", row: "rgba(139,92,246,0.14)", cell: "rgba(139,92,246,0.26)", text: "text-violet-800 dark:text-violet-300", label: "Purple" },
};

const selectCls =
  "h-8 min-w-0 rounded-md border border-input bg-background px-1.5 text-[12.5px] outline-none focus:border-primary";

function RuleRow({ rule, columns, onChange, onDelete }) {
  const needsValue = !RULE_OPS_NO_VALUE.has(rule.op);
  return (
    <div className="grid gap-1.5 rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <span className="shrink-0 font-semibold text-muted-foreground">When</span>
        <select aria-label="Column" value={rule.field} onChange={(e) => onChange({ field: e.target.value })} className={`${selectCls} flex-1`}>
          {columns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.headerName}
            </option>
          ))}
        </select>
        <button type="button" onClick={onDelete} aria-label="Delete rule" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <select aria-label="Condition" value={rule.op} onChange={(e) => onChange({ op: e.target.value })} className={`${selectCls} flex-1`}>
          {RULE_OPS.map(([id, text]) => (
            <option key={id} value={id}>
              {text}
            </option>
          ))}
        </select>
        {needsValue && (
          <input
            aria-label="Value"
            value={rule.value}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="value"
            className={`${selectCls} w-24 px-2`}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="font-semibold text-muted-foreground">Colour</span>
        <select aria-label="Colour what" value={rule.scope} onChange={(e) => onChange({ scope: e.target.value })} className={selectCls}>
          <option value="row">the whole row</option>
          <option value="cell">just that cell</option>
        </select>
        <div className="flex gap-1" role="radiogroup" aria-label="Colour">
          {RULE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={rule.color === c}
              aria-label={RULE_TONES[c].label}
              title={RULE_TONES[c].label}
              onClick={() => onChange({ color: c })}
              className={`h-6 w-6 rounded-full ${RULE_TONES[c].swatch} ${rule.color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HighlightMenu({ reportType, columns, display, onChange }) {
  const rules = display.rules?.[reportType] || [];
  const setRules = (next) => onChange({ rules: { ...(display.rules || {}), [reportType]: next } });
  const [hlText, setHlText] = useState(display.hlMin ? String(display.hlMin) : "");
  useEffect(() => setHlText(display.hlMin ? String(display.hlMin) : ""), [display.hlMin]);
  const active = rules.length + (display.hlMin ? 1 : 0) + (display.hlNegative ? 1 : 0);

  const addRule = () => {
    const first = columns.find((c) => c.numeric) || columns[0];
    if (!first) return;
    setRules([
      ...rules,
      { id: Math.random().toString(36).slice(2, 10), field: first.key, op: first.numeric ? "lt" : "contains", value: first.numeric ? "0" : "", color: "red", scope: "row" },
    ]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[12.5px] font-medium hover:border-primary hover:text-primary data-[state=open]:border-primary data-[state=open]:bg-primary data-[state=open]:text-primary-foreground"
        >
          <Highlighter className="h-3.5 w-3.5" /> Highlight
          {active > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950">{active}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(80vh,640px)] w-[min(372px,calc(100vw-1.5rem))] overflow-y-auto rounded-xl p-4">
        <p className="text-[15px] font-extrabold">Highlight</p>
        <p className="text-xs text-muted-foreground">Your own colour rules · saved on your account</p>

        <p className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">On this report</p>
        <div className="flex flex-col gap-2">
          {rules.length === 0 && <p className="text-[12.5px] text-muted-foreground">No rules yet — e.g. “When Closing is less than 0, colour the row red”.</p>}
          {rules.map((r, i) => (
            <RuleRow
              key={r.id}
              rule={r}
              columns={columns}
              onChange={(patch) => setRules(rules.map((x, xi) => (xi === i ? { ...x, ...patch } : x)))}
              onDelete={() => setRules(rules.filter((_, xi) => xi !== i))}
            />
          ))}
          {rules.length < 20 && columns.length > 0 && (
            <button
              type="button"
              onClick={addRule}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 text-[13px] font-semibold text-primary hover:bg-primary/5"
            >
              <Plus className="h-4 w-4" /> Add a rule
            </button>
          )}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">On every report</p>
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-[13px]">
          <label className="flex items-center gap-2">
            <span className={`h-3 w-3 shrink-0 rounded-full ${RULE_TONES.amber.swatch}`} />
            <span className="shrink-0">Amount ≥</span>
            <input
              inputMode="decimal"
              value={hlText}
              onChange={(e) => setHlText(e.target.value.replace(/[^\d.]/g, ""))}
              onBlur={() => onChange({ hlMin: hlText ? Number(hlText) : null })}
              onKeyDown={(e) => e.key === "Enter" && onChange({ hlMin: hlText ? Number(hlText) : null })}
              placeholder="e.g. 500000"
              aria-label="Highlight rows with an amount at or above"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus:border-primary"
            />
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={display.hlNegative}
            onClick={() => onChange({ hlNegative: !display.hlNegative })}
            className="flex min-h-8 w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex items-center gap-2">
              <span className={`h-3 w-3 shrink-0 rounded-full ${RULE_TONES.red.swatch}`} />
              Rows with a negative amount
            </span>
            <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${display.hlNegative ? "bg-primary" : "bg-muted-foreground/30"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${display.hlNegative ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </button>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          The report’s own warnings (e.g. stock below re-order level) always show as well.
        </p>
      </PopoverContent>
    </Popover>
  );
}
