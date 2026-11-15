"use client"
// components/Graphs/shared/GraphCard.jsx — the frame every dashboard chart
// sits in: a titled card, then a loading skeleton, an error, an empty state or
// the chart. While newer figures load the old chart stays, dimmed.
import { AlertTriangle, BarChart3, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

const BARS = [42, 68, 54, 80, 36, 62, 74, 48]

export function GraphState({ icon: Icon = BarChart3, title, hint, tone = "muted", height = 280 }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center",
        tone === "error" ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/30",
      )}
      style={{ minHeight: height }}
    >
      <span
        className={cn(
          "mb-3 flex h-11 w-11 items-center justify-center rounded-xl",
          tone === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <p className={cn("text-sm font-semibold", tone === "error" ? "text-destructive" : "text-foreground")}>{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function GraphSkeleton({ height = 280 }) {
  return (
    <div className="flex flex-col gap-3" style={{ minHeight: height }} aria-busy="true" aria-label="Loading chart">
      <div className="flex justify-end gap-2">
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-1 items-end gap-2 border-b border-l border-border/70 px-2 pb-1">
        {BARS.map((h, i) => (
          <div key={i} className="flex-1 animate-pulse rounded-t bg-primary/10" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

export default function GraphCard({
  title,
  subtitle,
  actions,
  className,
  loading = false,
  refreshing = false,
  error = null,
  empty = false,
  emptyIcon = BarChart3,
  emptyTitle = "No data for this period",
  emptyHint = "Try a wider date range.",
  height = 280,
  children,
}) {
  return (
    <section className={cn("flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
            <span className="truncate">{title}</span>
            {refreshing && <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary/70" aria-label="Updating" />}
          </h3>
          {subtitle && <p className="truncate text-[11.5px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex min-w-0 items-center gap-2 max-sm:w-full">{actions}</div>}
      </header>
      <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
        {loading ? (
          <GraphSkeleton height={height} />
        ) : error ? (
          <GraphState icon={AlertTriangle} tone="error" title="Could not load this chart" hint={error} height={height} />
        ) : empty ? (
          <GraphState icon={emptyIcon} title={emptyTitle} hint={emptyHint} height={height} />
        ) : (
          <div className={cn("min-w-0 transition-opacity", refreshing && "opacity-60")}>{children}</div>
        )}
      </div>
    </section>
  )
}
