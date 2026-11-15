"use client";

// components/HR/shared.jsx — building blocks shared by the HR screens.
// The look follows the redesigned setup screens (components/shared/DataTable.jsx,
// EntityPageLayout.jsx): maroon through the `primary` token, theme tokens for
// surfaces so dark mode works, cards that sit on a bg-muted/40 page.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_META } from "@/lib/hr/attendance/rules";

export const BRAND_BTN = "bg-primary text-primary-foreground hover:bg-primary/90";

/** Page shell: the muted page and the centred container every HR screen uses. */
export const HR_PAGE = "min-h-screen bg-muted/40";
export const HR_MAIN = "mx-auto max-w-[1600px] px-3 pb-8 pt-4 sm:px-6";

/** Underline tabs over the shadcn Tabs; wrap the list in HR_TABS_SCROLL so it scrolls sideways on a phone. */
export const HR_TABS_SCROLL = "-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0";
export const HR_TABS_LIST = "h-auto w-max min-w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 text-muted-foreground";
export const HR_TABS_TRIGGER =
  "-mb-px h-10 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 font-semibold text-muted-foreground shadow-none hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none";

/** Small status chips: ok / warn / bad / muted / brand. */
export const CHIP = {
  ok: "bg-[#edf2ee] text-[#2f5139] dark:bg-emerald-950/40 dark:text-emerald-300",
  warn: "bg-[#f5f0e6] text-[#5f4b1f] dark:bg-amber-950/40 dark:text-amber-300",
  bad: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
  brand: "bg-primary/10 text-primary",
};
/** A code / id chip. */
export const CODE_CHIP = "rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-primary";
/** Maroon table header: the <tr> and each <th>. */
export const TH_ROW = "bg-primary text-left text-primary-foreground";
export const TH = "whitespace-nowrap px-3 py-2.5 text-[11.5px] font-bold uppercase tracking-wide";

/** fetch → JSON; a non-2xx answer throws an Error carrying the body. */
export async function api(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Rights, departments, shifts and rules — every HR screen starts here. */
export function useHrMeta() {
  return useQuery({ queryKey: ["hr-meta"], queryFn: () => api("/api/hr/meta"), staleTime: 60_000 });
}

// The small line above the title, from where the page lives.
function crumbFor(pathname) {
  if (!pathname) return null;
  if (pathname.startsWith("/accounting/hr")) return "HR";
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/accounting")) return "Accounting";
  return null;
}

/**
 * Page title row: maroon badge, breadcrumb, title, subtitle; actions on the right
 * (a full-width row of equal buttons on a phone). It draws its own container, so it
 * goes straight inside the page shell, above <main className={HR_MAIN}>.
 */
export function PageHeader({ icon: Icon, title, subtitle, actions, breadcrumb, badge }) {
  const pathname = usePathname();
  const crumb = breadcrumb === undefined ? crumbFor(pathname) : breadcrumb;
  return (
    <header className="mx-auto max-w-[1600px] px-3 pt-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            {crumb && <p className="text-[12.5px] text-muted-foreground">{crumb}</p>}
            <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
              {title}
              {badge !== undefined && badge !== null && (
                <span className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-bold tabular-nums text-primary">{badge}</span>
              )}
            </h1>
            {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 max-sm:[&>*]:flex-1 sm:w-auto sm:justify-end">{actions}</div>}
      </div>
    </header>
  );
}

/** Whole-page loading state while meta loads: header, a KPI row and a card, as skeletons. */
export function PageLoading({ label = "Loading…" }) {
  return (
    <div className={HR_PAGE} aria-busy="true" aria-label={label}>
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-48" />
          </div>
        </div>
        <Skeleton className="mt-6 h-10 w-full max-w-md" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[84px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-4 h-72 rounded-xl" />
      </div>
    </div>
  );
}

/** Skeleton rows for a list that is loading. */
export function ListSkeleton({ rows = 6, className }) {
  return (
    <div className={cn("divide-y divide-border/60", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

export function StatusChip({ status, manual, className }) {
  const m = STATUS_META[status] ?? STATUS_META.PENDING;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", m.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
      {manual && <span className="font-normal opacity-70">· set</span>}
    </span>
  );
}

const initialsOf = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export function EmployeeCell({ employee, sub, compact }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-bold text-primary ring-1 ring-primary/15",
          compact ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs",
        )}
      >
        {employee.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={employee.photo} alt="" className="h-full w-full object-cover" />
        ) : (
          initialsOf(employee.name)
        )}
      </div>
      <div className="min-w-0">
        <p className={cn("truncate font-semibold text-foreground", compact ? "text-xs" : "text-sm")}>{employee.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          <span className="font-mono">#{employee.id}</span>
          {sub !== undefined ? sub : [employee.designation, employee.department].filter(Boolean).map((t) => ` · ${t}`).join("")}
        </p>
      </div>
    </div>
  );
}

export function ShiftChip({ shift, className }) {
  if (!shift) return <span className="text-xs text-muted-foreground">No shift</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground", className)}>
      <span className="h-2 w-2 rounded-sm" style={{ background: shift.color || "#800000" }} />
      <span className="font-semibold">{shift.code}</span>
      <span className="tabular-nums text-muted-foreground">{shift.start_time}–{shift.end_time}</span>
    </span>
  );
}

/** A card: maroon-tinted header with the title and optional actions, then the body. */
export function Panel({ title, icon: Icon, actions, children, className, bodyClassName }) {
  return (
    // overflow-clip (not hidden) rounds the corners without breaking sticky bars inside the body.
    <section className={cn("min-w-0 overflow-clip rounded-xl border border-border bg-background", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 border-b border-primary/15 bg-primary/5 px-4 py-2.5 sm:px-5">
          {title && (
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-primary sm:text-[15px]">
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              {title}
            </h2>
          )}
          {/* A single action (a link) stays beside the title; a toolbar gets its own full-width row on phones. */}
          {actions && <div className="flex flex-wrap items-center gap-2 max-sm:[&:has(>:nth-child(2))]:w-full sm:ml-auto">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A figure tile for KPI rows: label, big tabular number, optional hint; a link when href is set. */
export function StatTile({ label, value, hint, icon: Icon, tone = "slate", href, className }) {
  const tones = {
    slate: "text-foreground",
    amber: "text-[#8a6a1f] dark:text-amber-400",
    red: "text-red-700 dark:text-red-400",
    emerald: "text-[#2f5139] dark:text-emerald-400",
    brand: "text-primary",
  };
  const iconTones = { slate: CHIP.muted, amber: CHIP.warn, red: CHIP.bad, emerald: CHIP.ok, brand: CHIP.brand };
  const body = (
    <div
      className={cn(
        "relative h-full min-w-0 overflow-hidden rounded-xl border bg-background p-3.5 sm:p-4",
        tone === "brand" ? "border-primary/25" : "border-border",
        href && "transition-colors hover:border-primary/40 hover:bg-primary/[0.02]",
        className,
      )}
    >
      {tone === "brand" && <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate pt-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", iconTones[tone] ?? iconTones.slate)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className={cn("truncate text-lg font-bold tabular-nums sm:text-2xl", tones[tone] ?? tones.slate)}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center sm:py-14">
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/[0.07] ring-8 ring-primary/[0.03]">
          <Icon className="h-6 w-6 text-primary/60" />
        </div>
      )}
      <p className="font-semibold text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NoAccess() {
  return (
    <div className="min-h-[60vh] bg-muted/40 px-3 pt-16">
      <div className="mx-auto flex max-w-lg items-start gap-3 rounded-xl border border-[#e6dcc6] bg-[#f5f0e6] px-5 py-4 text-[#5f4b1f] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">You do not have access to this HR screen.</p>
          <p className="mt-1 text-sm opacity-90">Ask an administrator for the HR rights on Admin → Permissions.</p>
        </div>
      </div>
    </div>
  );
}

/** "Mon 27 Oct 2026" from a day key. */
export function fmtDayLong(dayKey) {
  if (!dayKey) return "";
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function fmtWhen(value) {
  if (!value) return "never";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });
}

/** Native select styled like the shadcn inputs — fast for long lists and toolbars. */
export function NativeSelect({ className, children, ...props }) {
  return (
    <select
      className={cn(
        "h-9 max-w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
