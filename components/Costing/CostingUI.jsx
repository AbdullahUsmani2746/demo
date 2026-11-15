"use client";

// components/Costing/CostingUI.jsx — bits the Costing pages share
// (hub, production, issuance, variance, rates, checking). Built on the Lab
// look (components/Material/shared/LabUI.jsx): maroon primary, theme tokens,
// tinted card headers. Costing rule: figures right-aligned + tabular, a
// variance is a signed number — over BOM / over cost = bad, under = ok.
import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHIP } from "@/components/Material/shared/LabUI";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Page frame shared by every Costing screen. */
export function CostingFrame({ children, className }) {
  return (
    <div className="min-h-screen bg-muted/40">
      <div className={cn("mx-auto max-w-[1600px] space-y-4 px-3 py-5 sm:px-6", className)}>{children}</div>
    </div>
  );
}

/** Month + year pickers (values are numbers unless `asString`). */
export function PeriodPicker({ month, year, years, onMonth, onYear, asString = false, disabled }) {
  return (
    <>
      <Select value={String(month)} onValueChange={(v) => onMonth(asString ? v : Number(v))} disabled={disabled}>
        <SelectTrigger className="h-9 w-[132px] bg-background text-sm" aria-label="Month"><SelectValue /></SelectTrigger>
        <SelectContent>
          {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={String(year)} onValueChange={(v) => onYear(asString ? v : Number(v))} disabled={disabled}>
        <SelectTrigger className="h-9 w-[92px] bg-background text-sm" aria-label="Year"><SelectValue /></SelectTrigger>
        <SelectContent>
          {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
    </>
  );
}

/** Search box with the "/" shortcut (Ctrl+K stays the header's menu search). */
export function SearchBox({ value, onChange, placeholder = "Search…", onEnter, className, inputRef, slash = true }) {
  const ownRef = useRef(null);
  const ref = inputRef || ownRef;

  useEffect(() => {
    if (!slash) return undefined;
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slash, ref]);

  return (
    <label
      className={cn(
        "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15",
        className,
      )}
    >
      <Search className="h-4 w-4 flex-shrink-0" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
          if (e.key === "Enter" && onEnter) onEnter();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {value ? (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      ) : slash ? (
        <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
      ) : null}
    </label>
  );
}

/** Pill toggle group (filters, view switches). */
export function Segmented({ options, value, onChange, className }) {
  return (
    <div className={cn("inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/50 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground",
          )}
        >
          {o.label}
          {o.count != null && <span className="ml-1 opacity-70 tabular-nums">({o.count})</span>}
        </button>
      ))}
    </div>
  );
}

// Text tones for figures (same palette as the Lab chips).
export const TONE_TEXT = {
  ok: "text-[#2f5139] dark:text-emerald-300",
  warn: "text-[#5f4b1f] dark:text-amber-300",
  bad: "text-red-700 dark:text-red-300",
  muted: "text-muted-foreground",
  brand: "text-primary",
};

/** Tone of a cost variance: more than expected = bad, less = ok. */
export const varianceTone = (v, eps = 0) => (v > eps ? "bad" : v < -eps ? "ok" : "muted");

/** Signed variance figure: "+1,234.00" red / "-56.00" green / "0.00" muted. */
export function Signed({ value, format, eps = 0, className, invert = false }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const v = Number(value) || 0;
  let tone = varianceTone(v, eps);
  if (invert && tone !== "muted") tone = tone === "ok" ? "bad" : "ok";
  return (
    <span className={cn("tabular-nums font-semibold", TONE_TEXT[tone], className)}>
      {v > eps ? "+" : ""}{format(v)}
    </span>
  );
}

/** Callout strip: ok / warn / bad / brand / muted. */
export function Note({ tone = "warn", icon: Icon, title, children, className, action }) {
  return (
    <div className={cn("flex flex-wrap items-start gap-2.5 rounded-xl px-4 py-3 text-sm", CHIP[tone], className)}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <span className="font-semibold">{title} </span>}
        <span className="font-normal opacity-90">{children}</span>
      </div>
      {action}
    </div>
  );
}

/** Loading rows for a table body. */
export function SkeletonRows({ rows = 6, cols = 5 }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r} className="border-b border-border">
      {Array.from({ length: cols }, (_, c) => (
        <td key={c} className="px-3 py-3">
          <Skeleton className={cn("h-4", c === 0 ? "w-40" : "ml-auto w-20")} />
        </td>
      ))}
    </tr>
  ));
}

/** Small icon button used for row / header actions. */
export function IconBtn({ icon: Icon, label, onClick, disabled, className, spin }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50",
        className,
      )}
    >
      <Icon className={cn("h-4 w-4", spin && "animate-spin")} />
    </button>
  );
}
