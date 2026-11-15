"use client";

// components/Material/shared/LabUI.jsx — the look every Lab tab shares
// (BOM, Recipe, Machine, Process Order, Production Plan, Grand Master BOM,
// Material Usage BOM, Future Costing). Same tokens as the rest of the system:
// maroon primary, rounded-xl cards with a tinted header, maroon table header.
import { cn } from "@/lib/utils";

/** Page header: maroon badge, "Lab" breadcrumb, title, subtitle, actions on the right. */
export function LabHeader({ icon: Icon, title, subtitle, breadcrumb = "Lab", badge, actions, className }) {
  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row lg:items-center", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          {breadcrumb && <p className="text-[12.5px] text-muted-foreground">{breadcrumb}</p>}
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            {title}
            {badge != null && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{badge}</span>
            )}
          </h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && (
        // Phones: a full-width row of equal buttons under the title.
        <div className="flex w-full flex-wrap items-center gap-2 max-sm:[&>*]:flex-1 lg:ml-auto lg:w-auto lg:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

/** Card with an optional tinted header strip. */
export function LabCard({ title, subtitle, icon: Icon, actions, children, className, bodyClassName }) {
  return (
    <section className={cn("overflow-clip rounded-xl border border-border bg-background", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {Icon && <Icon className="h-4 w-4 flex-shrink-0 text-primary" />}
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-semibold text-primary">{title}</h2>}
              {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Summary tile: muted label, big tabular value, optional hint. */
export function LabStat({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12px] text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
        {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <span className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg", CHIP[tone] || CHIP.brand)}>
          <Icon className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

// Status chips: ok / warn / bad / muted / brand.
export const CHIP = {
  ok: "bg-[#edf2ee] text-[#2f5139] dark:bg-emerald-950/40 dark:text-emerald-300",
  warn: "bg-[#f5f0e6] text-[#5f4b1f] dark:bg-amber-950/40 dark:text-amber-300",
  bad: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
  brand: "bg-primary/10 text-primary",
};
export function Chip({ tone = "muted", className, children }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", CHIP[tone], className)}>
      {children}
    </span>
  );
}

// Item / document codes.
export const CODE_CHIP = "rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[12px] text-primary";

// Tables: maroon header row; sticky inside a scrolling card.
export const TH_ROW = "bg-primary text-primary-foreground";
export const TH = "sticky top-0 z-10 bg-primary px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-primary-foreground whitespace-nowrap";
export const TD = "px-3 py-2.5 align-middle";
export const NUM = "text-right tabular-nums";
export const TOTAL_ROW = "border-t-2 border-primary bg-muted/50 font-semibold";

// Underline tabs (shadcn Tabs): scroll sideways on a phone.
export const TABS_SCROLL = "-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0";
export const TABS_LIST = "inline-flex h-auto w-max min-w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0";
export const TABS_TRIGGER =
  "relative gap-1.5 rounded-none border-b-2 border-transparent px-3 pb-2.5 pt-2 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none";

// Dialogs: near full width on phones, scroll when tall, footer sticks to the bottom.
export const DIALOG = "flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden rounded-xl p-0";
export const DIALOG_HEAD = "border-b border-primary/15 bg-primary/5 px-4 py-3 sm:px-6";
export const DIALOG_BODY = "min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6";
export const DIALOG_FOOT = "flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:px-6";

/** Empty state for a list. */
export function LabEmpty({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </span>
      )}
      <p className="font-semibold text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}
