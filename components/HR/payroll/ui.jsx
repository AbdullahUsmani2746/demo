"use client";

// components/HR/payroll/ui.jsx — the look of the leave / loans / payroll /
// salary / self-service screens: page shell, maroon-headed cards, underline
// tabs, status chips, a stepper, table classes and dialog classes. Layout
// only — no data, no rights. (components/HR/shared.jsx holds the HR-wide
// building blocks; these are the extras those screens share.)
import { forwardRef } from "react";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Page background and content column. */
export const PAGE = "min-h-screen bg-muted/40";
export const MAIN = "mx-auto max-w-[1600px] px-3 py-5 sm:px-6";

/** A card with a tinted header (title in brand colour) — the header is optional. */
export function Card({ title, icon: Icon, description, actions, children, className, bodyClassName }) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-xl border border-border bg-background", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
          {title && (
            <div className="flex min-w-0 items-start gap-3">
              {Icon && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-primary">{title}</h2>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
              </div>
            </div>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1 sm:ml-auto">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A filter / action bar above a list: wraps on phones. */
export function Toolbar({ children, className }) {
  return <div className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background p-3", className)}>{children}</div>;
}

/** Underline tabs on top of the Radix Tabs; the strip scrolls sideways on a phone. */
export const UnderlineTabsList = forwardRef(function UnderlineTabsList({ className, children, ...props }, ref) {
  return (
    <div className="-mx-3 overflow-x-auto border-b border-border px-3 sm:mx-0 sm:px-0">
      <TabsList ref={ref} className={cn("h-auto w-max gap-1 rounded-none bg-transparent p-0 text-muted-foreground", className)} {...props}>
        {children}
      </TabsList>
    </div>
  );
});

export const UnderlineTab = forwardRef(function UnderlineTab({ className, ...props }, ref) {
  return (
    <TabsTrigger
      ref={ref}
      className={cn(
        "-mb-px h-10 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 text-sm font-medium text-muted-foreground shadow-none hover:text-primary",
        "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-none",
        className,
      )}
      {...props}
    />
  );
});

/** Status chip tones (ok / warn / bad / info / muted) — same palette as CHIP in components/HR/shared.jsx. */
export const TONES = {
  ok: "bg-[#edf2ee] text-[#2f5139] dark:bg-emerald-950/40 dark:text-emerald-300",
  warn: "bg-[#f5f0e6] text-[#5f4b1f] dark:bg-amber-950/40 dark:text-amber-300",
  bad: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  info: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
};

export function Chip({ tone = "muted", dot = true, className, children, title }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", TONES[tone] ?? TONES.muted, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** A record number in the brand chip: P-12, L-7 … */
export function CodeChip({ children, className }) {
  return <span className={cn("whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-primary", className)}>{children}</span>;
}

/**
 * Steps of a life cycle. Steps 0..`done` are complete; the one after is next.
 * `stopped` (rejected, reversed, cancelled …) replaces the next step's label
 * and shows it in red.
 */
export function Stepper({ steps, done, stopped, className }) {
  return (
    <ol className={cn("flex items-start overflow-x-auto pb-1", className)}>
      {steps.map((s, i) => {
        const state = i <= done ? "done" : i === done + 1 ? (stopped ? "stopped" : "next") : "todo";
        return (
          <li key={s.label} className="flex min-w-[76px] flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1", i === 0 ? "invisible" : i <= done ? "bg-primary" : "bg-border")} />
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold tabular-nums",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "next" && "border-primary bg-background text-primary",
                  state === "stopped" && "border-red-700 bg-red-50 text-red-800",
                  state === "todo" && "border-border bg-background text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("h-0.5 flex-1", i === steps.length - 1 ? "invisible" : i < done ? "bg-primary" : "bg-border")} />
            </div>
            <p
              className={cn(
                "mt-1.5 px-1 text-[11.5px] font-semibold leading-tight",
                state === "done" ? "text-foreground" : state === "next" ? "text-primary" : state === "stopped" ? "text-red-800" : "text-muted-foreground",
              )}
            >
              {state === "stopped" ? stopped : s.label}
            </p>
            {s.hint && <p className="px-1 text-[10.5px] leading-tight text-muted-foreground">{s.hint}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** Table classes: maroon header row, header cells, body rows, totals row. */
export const THEAD = "bg-primary text-left";
export const TH = "whitespace-nowrap bg-primary px-3 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground";
export const TH_STICKY = "sticky top-0 z-10";
export const TR = "border-b border-border/60 transition-colors hover:bg-primary/[0.03]";
export const TFOOT = "border-t-2 border-primary/30 bg-background font-bold [&>td]:bg-primary/5";
/** A scroll box for long lists, so the header stays in sight. */
export const SCROLL = "overflow-x-auto md:max-h-[70vh] md:overflow-auto";

/** Dialogs: near full width on phones, scroll when tall, footer sticks to the bottom. */
export const DIALOG = "w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6";
export const DIALOG_FOOTER = "sticky -bottom-4 z-10 -mx-4 -mb-4 gap-2 border-t border-border bg-background px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:space-x-0 sm:px-6";
/** Sheets (side panels): scroll, footer sticks to the bottom. */
export const SHEET = "w-full overflow-y-auto p-4 sm:max-w-2xl sm:p-6";
export const SHEET_FOOTER = "sticky -bottom-4 z-10 -mx-4 -mb-4 mt-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6";

/** Loading placeholder for a page body. */
export function PageSkeleton() {
  return (
    <div className={PAGE}>
      <div className={MAIN}>
        <div className="mb-4 flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-48" />
          </div>
        </div>
        <Skeleton className="mb-4 h-10 w-full max-w-md" />
        <div className="space-y-2 rounded-xl border border-border bg-background p-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A small label + value, used in figure strips. */
export function Fig({ label, value, tone, className }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="truncate text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("truncate text-sm font-semibold tabular-nums text-foreground", tone)}>{value}</p>
    </div>
  );
}

/** Chip tone of each leave / loan status (labels stay in lib/hr/*). */
export const LEAVE_TONE = { pending: "warn", approved: "ok", rejected: "bad", cancelled: "muted" };
export const LOAN_TONE = { pending: "warn", active: "info", settled: "ok", rejected: "bad", cancelled: "muted" };
