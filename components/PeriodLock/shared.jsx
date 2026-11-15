"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Lock, Unlock, Loader2, Check } from "lucide-react";
import { LOCKABLE_DOCUMENTS } from "@/lib/periodLockCatalog";
import { CHIP } from "@/components/Material/shared/LabUI";

export const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
export const BRAND = "bg-primary text-primary-foreground hover:bg-primary/90";

// ── Date helpers (work on "YYYY-MM-DD" strings; no timezone drift) ──────────
const pad = (n) => String(n).padStart(2, "0");
export const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayStr = (v) => (v ? String(v).slice(0, 10) : "");

export function fmtDay(value, withYear = true) {
  const s = dayStr(value);
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1].slice(0, 3)}${withYear ? ` ${y}` : ""}`;
}
export function fmtSpan(from, to) {
  const a = dayStr(from), b = dayStr(to);
  if (a === b) return fmtDay(a);
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${fmtDay(a, !sameYear)} – ${fmtDay(b)}`;
}
export function daysBetween(from, to) {
  const a = Date.parse(`${dayStr(from)}T00:00:00Z`);
  const b = Date.parse(`${dayStr(to)}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}
export function fmtStamp(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-PK", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
/** "in 3h 20m" / "2d 4h ago" relative to now. */
export function fmtRelative(value) {
  if (!value) return "";
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const parts = m < 60 ? `${m}m`
    : m < 1440 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`
      : `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)}h` : ""}`;
  return diff >= 0 ? `in ${parts}` : `${parts} ago`;
}
export const who = (email) => (email ? String(email).split("@")[0] : "—");
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function datePresets() {
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6);
  return [
    { label: "Today", from: isoLocal(now), to: isoLocal(now) },
    { label: "Yesterday", from: isoLocal(y), to: isoLocal(y) },
    { label: "Last 7 days", from: isoLocal(weekAgo), to: isoLocal(now) },
    { label: "Month to date", from: isoLocal(firstThis), to: isoLocal(now) },
    { label: "Previous month", from: isoLocal(firstPrev), to: isoLocal(lastPrev) },
  ];
}

// ── Presentational pieces ───────────────────────────────────────────────────
// Same tokens as the rest of the system (components/Material/shared/LabUI.jsx):
// maroon primary, theme colours only so dark mode works.
const PILL = {
  locked: CHIP.bad,
  open: CHIP.ok,
  active: CHIP.brand,
  expired: CHIP.muted,
  revoked: CHIP.muted,
  unlocked: CHIP.muted,
};
const PILL_LABEL = {
  locked: "Locked", open: "Open", active: "Active", expired: "Expired", revoked: "Revoked", unlocked: "Unlocked",
};

export function Pill({ kind, children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${PILL[kind]}`}>
      {kind === "locked" && <Lock className="h-3 w-3" />}
      {(kind === "open" || kind === "active") && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children ?? PILL_LABEL[kind]}
    </span>
  );
}

export function Chip({ on, onClick, children, disabled, className = "" }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
      } ${className}`}
    >
      {on && <Check className="h-3 w-3" />}
      {children}
    </button>
  );
}

// tone: slate (neutral) / red (locked) / green (open) / blue + brand (maroon).
const STAT_TONE = { slate: CHIP.muted, red: CHIP.bad, green: CHIP.ok, blue: CHIP.brand, brand: CHIP.brand };

export function StatCard({ icon: Icon, label, value, hint, tone = "slate", loading }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-[12px] text-muted-foreground">{label}</p>
        {loading ? <Skeleton className="mt-1 h-6 w-24" /> : (
          <p className="truncate text-xl font-semibold tabular-nums text-foreground">{value}</p>
        )}
        {hint && !loading && <p className="truncate text-[11.5px] text-muted-foreground">{hint}</p>}
      </div>
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${STAT_TONE[tone] || STAT_TONE.slate}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
  );
}

/** Card with a tinted header strip (title, icon, actions on the right). */
export function Panel({ title, icon: Icon, actions, children, className = "" }) {
  return (
    <section className={`overflow-clip rounded-xl border border-border bg-background ${className}`}>
      {(title || actions) && (
        <div className="flex flex-col gap-3 border-b border-primary/15 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center">
          {title && (
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-primary">
              {Icon && <Icon className="h-4 w-4" />}{title}
            </h2>
          )}
          {actions && <div className="sm:ml-auto">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-border bg-muted/60 p-0.5 text-xs font-medium">
      {options.map(([key, label]) => (
        <button
          key={key} type="button" onClick={() => onChange(key)} aria-pressed={value === key}
          className={`rounded-md px-3 py-1.5 transition-colors ${
            value === key ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </span>
      <p className="font-semibold text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ListSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
    </div>
  );
}

/** Form card (lock a range / grant access): tinted header, padded body. */
export function FormCard({ title, subtitle, icon: Icon, onSubmit, children, footer }) {
  return (
    <form onSubmit={onSubmit} className="overflow-clip rounded-xl border border-border bg-background lg:sticky lg:top-4">
      <div className="border-b border-primary/15 bg-primary/5 px-4 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-primary">
          {Icon && <Icon className="h-4 w-4" />}{title}
        </h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="space-y-4 p-4">{children}</div>
      {footer && <div className="border-t border-border bg-muted/30 px-4 py-3">{footer}</div>}
    </form>
  );
}

// Outline button for "Unlock" / "Revoke" — the cautionary action.
export const WARN_BTN = "border-amber-300 text-amber-800 hover:bg-amber-50 hover:text-amber-900 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40 dark:hover:text-amber-200";

/**
 * Document-type picker. value [] = all documents.
 * Clicking a type while "All" is on narrows to just that type.
 */
export function DocumentPicker({ value, onChange }) {
  const all = value.length === 0;
  const toggle = (code) => {
    if (all) return onChange([code]);
    const next = value.includes(code) ? value.filter((c) => c !== code) : [...value, code];
    onChange(next);
  };
  const toggleGroup = (codes) => {
    const allIn = !all && codes.every((c) => value.includes(c));
    if (allIn) onChange(value.filter((c) => !codes.includes(c)));
    else onChange([...new Set([...(all ? [] : value), ...codes])]);
  };
  return (
    <div className="space-y-2.5">
      <Chip on={all} onClick={() => onChange([])}>All documents</Chip>
      {LOCKABLE_DOCUMENTS.map((g) => {
        const codes = g.items.map((i) => i.code);
        const groupOn = !all && codes.every((c) => value.includes(c));
        return (
          <div key={g.group}>
            <button
              type="button" onClick={() => toggleGroup(codes)}
              className={`text-[11px] font-semibold uppercase tracking-wide mb-1 hover:underline ${groupOn ? "text-primary" : "text-muted-foreground"}`}
            >
              {g.group}
            </button>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((i) => (
                <Chip key={i.code} on={!all && value.includes(i.code)} onClick={() => toggle(i.code)}>
                  {i.label}
                </Chip>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Controlled confirmation dialog; `confirm` = { title, body: string[], action, tone, run } */
export function ConfirmDialog({ confirm, busy, onCancel, onConfirm }) {
  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-left">
            {confirm?.tone === "warn"
              ? <Unlock className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              : <Lock className="h-5 w-5 shrink-0 text-primary" />}
            {confirm?.title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5 text-left">
              {confirm?.body.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            onClick={onConfirm} disabled={busy}
            className={confirm?.tone === "warn" ? "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600" : BRAND}
          >
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {confirm?.action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** POST/PATCH JSON helper: resolves the parsed body or throws the server's message. */
export async function sendJson(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}
