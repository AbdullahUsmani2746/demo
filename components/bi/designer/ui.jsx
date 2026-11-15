"use client";
import { useEffect, useState } from "react";
// Small form pieces shared by the BI Designer screens (app tokens, light/dark).
export const SEL =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors hover:border-primary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50";
export const INP = SEL;

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block min-w-0 space-y-1 ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

/** A card with the system's maroon-tinted header band. */
export function Panel({ title, action, children, className = "" }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-border bg-background ${className}`}>
      <div className="flex min-h-[44px] items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2">
        <h3 className="min-w-0 text-sm font-semibold text-primary">{title}</h3>
        {action}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

export function SmallBtn({ children, onClick, title, disabled, tone = "default", className = "" }) {
  const toneCls =
    tone === "danger"
      ? "border-border bg-background text-destructive hover:border-destructive/40 hover:bg-destructive/10"
      : tone === "primary"
        ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
        : "border-border bg-background text-foreground hover:border-primary/40 hover:text-primary";
  return (
    <button
      type="button"
      title={title}
      aria-label={typeof children === "string" ? undefined : title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${toneCls} ${className}`}
    >
      {children}
    </button>
  );
}

export function useDebounced(value, ms = 600) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
