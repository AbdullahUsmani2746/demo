"use client";

// components/Invoicing/parts.jsx — the small, shared presentational pieces of
// the Invoicing screens: reference chips, avatars, status dots, stat tiles.
//
// Same family as the voucher list / form (components/Category/Table.jsx,
// Form.jsx) and the Lab screens (components/Material/shared/LabUI.jsx): theme
// tokens only, maroon primary, rounded-xl cards with a tinted header, so dark
// mode follows the theme.

import { useCallback } from "react";
import AsyncSelect from "react-select/async";
import axios from "axios";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { selectStyles } from "@/components/shared/EntityFormPanel";
import { CHIP } from "@/components/Material/shared/LabUI";
import { cn } from "@/lib/utils";

import { RATE_SOURCES } from "./kinds";

// ── shared surface classes ──────────────────────────────────────────────
export const UI = {
  panel: "rounded-xl border border-border bg-background",
  panelHead: "border-b border-primary/15 bg-primary/5",
  divider: "border-border",
  muted: "text-muted-foreground",
  label: "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
  well: "rounded-xl border border-border bg-muted/30",
};

// ── reference-number chip ───────────────────────────────────────────────
// A bare number is ambiguous — 9545 could be a dispatch, an order or an
// invoice. Each chip carries a tone AND a short label.
const CHIP_TONE = {
  doc: "bg-primary/10 text-primary",
  order: CHIP.warn,
  source: "bg-muted text-foreground ring-1 ring-inset ring-border",
  invoice: CHIP.ok,
  legacy: CHIP.muted,
};

export function IdChip({ tone, label, value, size = "sm", className, title }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1.5 rounded-md",
        CHIP_TONE[tone] ?? CHIP_TONE.doc,
        size === "lg" ? "px-2.5 py-1.5" : "px-1.5 py-0.5",
        className,
      )}
    >
      <span className="text-[10.5px] font-semibold uppercase tracking-wide opacity-75">{label}</span>
      <span className={cn("truncate font-mono font-semibold tabular-nums", size === "lg" ? "text-[15px]" : "text-[12px]")}>
        {value}
      </span>
    </span>
  );
}

// ── party avatar ────────────────────────────────────────────────────────
// Initials on the brand tint (one colour, not a rainbow).
export function PartyAvatar({ name, size = "sm" }) {
  const initials =
    (name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary",
        size === "lg" ? "h-11 w-11 text-sm" : "h-8 w-8 text-[11px]",
      )}
    >
      {initials}
    </span>
  );
}

// ── status dot ──────────────────────────────────────────────────────────
const DOT = {
  ready: "bg-primary",
  blocked: "bg-destructive",
  invoiced: "bg-[#4d7a5a] dark:bg-emerald-400",
  legacy: "bg-muted-foreground/50",
};

export function StatusDot({ status }) {
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[status] ?? DOT.ready)} />;
}

// ── stat tile (header) ──────────────────────────────────────────────────
// LabStat's look, clickable: a tile that filters the queue.
const STAT_TONES = {
  neutral: CHIP.brand,
  ready: CHIP.brand,
  blocked: CHIP.bad,
  value: CHIP.ok,
  invoiced: CHIP.ok,
};

export function StatChip({ icon: Icon, label, value, tone = "neutral", active, onClick, title, mono }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={title}
      className={cn(
        "flex min-w-0 items-start justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors disabled:cursor-default",
        onClick && "hover:border-primary/40 hover:bg-primary/5",
        active && "border-primary bg-primary/5 ring-2 ring-primary/20",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[12px] text-muted-foreground">{label}</p>
        <p className={cn("truncate text-xl font-semibold tabular-nums text-foreground", mono && "font-mono")}>{value}</p>
      </div>
      <span className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg", STAT_TONES[tone])}>
        <Icon className="h-4 w-4" />
      </span>
    </button>
  );
}

// ── segmented control (status tabs) ─────────────────────────────────────
export function Segmented({ value, onChange, options }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-background text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
          {o.count != null && (
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                value === o.value ? "bg-primary/10 text-primary" : "bg-background/70 text-muted-foreground",
              )}
            >
              {Number(o.count).toLocaleString("en-US")}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── rate-source badge ───────────────────────────────────────────────────
// RATE_SOURCES (kinds.js) names a tone per source; mapped onto the status
// chip palette here.
const SOURCE_TONES = {
  slate: CHIP.muted,
  blue: CHIP.brand,
  violet: CHIP.brand,
  teal: CHIP.ok,
  amber: CHIP.warn,
  red: CHIP.bad,
  primary: "bg-primary text-primary-foreground",
};

export function SourceBadge({ source }) {
  const s = RATE_SOURCES[source] || RATE_SOURCES.none;
  return (
    <span
      title="Where this rate came from"
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        SOURCE_TONES[s.tone] ?? SOURCE_TONES.slate,
      )}
    >
      {s.label}
    </span>
  );
}

// ── generate result pill ────────────────────────────────────────────────
export function ResultPill({ result, invoiceChip = "INV" }) {
  if (!result) return null;
  if (result.status === "invoiced") {
    return (
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold", CHIP.ok)}>
        <CheckCircle2 className="h-3.5 w-3.5" /> {invoiceChip} {result.invoice_no}
      </span>
    );
  }
  const blocked = result.status === "blocked";
  return (
    <span
      title={result.message}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
        blocked ? CHIP.warn : CHIP.bad,
      )}
    >
      {blocked ? <AlertTriangle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {blocked ? "Blocked" : "Failed"}
    </span>
  );
}

// ── detail field (icon + label + value) ─────────────────────────────────
export function DetailField({ icon: Icon, label, children }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
      <div className="min-w-0">
        <div className={UI.label}>{label}</div>
        <div className="truncate text-sm font-medium text-foreground">{children || "—"}</div>
      </div>
    </div>
  );
}

export function Kbd({ children, className }) {
  return (
    <kbd
      className={cn(
        "rounded border border-b-2 border-current px-1 font-mono text-[10.5px] font-semibold opacity-80",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

// ── party picker ────────────────────────────────────────────────────────
// selectStyles (EntityFormPanel) + the theme background / text colours so the
// control reads in dark mode too.
const baseStyles = selectStyles(false);
const pickerStyles = {
  ...baseStyles,
  container: (base) => ({ ...base, width: "100%" }),
  control: (base, state) => ({ ...baseStyles.control(base, state), backgroundColor: "hsl(var(--background))" }),
  singleValue: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
  input: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
};

export function PartyPicker({ endpoint, label, value, onChange }) {
  const loadOptions = useCallback(
    async (input) => {
      try {
        const res = await axios.get(`${endpoint}${input ? `&search=${encodeURIComponent(input)}` : ""}`);
        const rows = res.data?.data ?? res.data ?? [];
        return (Array.isArray(rows) ? rows : [])
          .slice(0, 100)
          .map((r) => ({ value: String(r.acno), label: `${r.acno} - ${r.acname || ""}` }));
      } catch {
        return [];
      }
    },
    [endpoint],
  );
  return (
    <AsyncSelect
      instanceId={`invoicing-party-${label}`}
      inputId={`invoicing-party-${label}`}
      aria-label={label}
      cacheOptions
      defaultOptions
      isClearable
      loadOptions={loadOptions}
      value={value}
      onChange={(opt) => onChange(opt || null)}
      placeholder={`All ${label.toLowerCase()}s`}
      styles={pickerStyles}
      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
      noOptionsMessage={() => "No matches"}
    />
  );
}
