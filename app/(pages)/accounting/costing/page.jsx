"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Lock,
  Unlock,
  RefreshCw,
  BarChart3,
  Calculator,
  Factory,
  AlertTriangle,
  CheckCircle2,
  Package,
  TrendingUp,
  ArrowRight,
  Loader2,
  Warehouse,
  ClipboardList,
  ChevronRight,
  FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  LabHeader, LabCard, LabStat, LabEmpty, Chip, CODE_CHIP, TH, TD, NUM, TOTAL_ROW,
} from "@/components/Material/shared/LabUI";
import { CostingFrame, PeriodPicker, Note, SkeletonRows, IconBtn, MONTHS } from "@/components/Costing/CostingUI";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

function fmt(n) {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
}
function fmtPct(n) { return `${(Number(n) || 0).toFixed(1)}%`; }
function fmtQty(n) {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(n) || 0);
}

// ── Workflow Step Card ────────────────────────────────────────────────────────
function WorkflowStep({ step, title, subtitle, status, onAction, actionLabel, actionLoading, link }) {
  // status: 'done' | 'active' | 'pending'
  const isDone   = status === "done";
  const isActive = status === "active";
  return (
    <div
      className={cn(
        "relative flex-1 rounded-xl border bg-background p-4 transition-colors",
        isDone ? "border-border" : isActive ? "border-primary/40 ring-2 ring-primary/10" : "border-dashed border-border opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold",
            isDone ? "bg-[#edf2ee] text-[#2f5139] dark:bg-emerald-950/40 dark:text-emerald-300"
              : isActive ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {isDone ? <CheckCircle2 className="h-4 w-4" /> : step}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-semibold", isActive ? "text-primary" : "text-foreground")}>{title}</span>
            {isDone && <Chip tone="ok">Complete</Chip>}
            {status === "pending" && <Chip tone="muted">Waiting</Chip>}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
          {isActive && link && (
            <Button asChild size="sm" className="mt-2.5 h-8">
              <Link href={link}>
                {actionLabel} <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
          {isActive && onAction && (
            <Button size="sm" className="mt-2.5 h-8" onClick={onAction} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="mr-1.5 h-3.5 w-3.5" />}
              {actionLoading ? "Calculating…" : actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Nav Module Card ───────────────────────────────────────────────────────────
function ModuleCard({ href, icon: Icon, title, description, stats }) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      {stats && (
        <div className="flex flex-wrap gap-1.5">
          {stats.map((s, i) => (
            <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{s}</span>
          ))}
        </div>
      )}
    </Link>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CostingHub() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const [summary, setSummary] = useState(null);
  const [openingStock, setOpeningStock] = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingStock, setLoadingStock] = useState(false);
  const [locking, setLocking] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const { data: session } = useSession();
  const { can } = usePermissions();
  const canLock = can("period.lock");
  const [calculating, setCalculating] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const res = await fetch(`/api/costing/summary?month=${month}&year=${year}`);
      if (res.ok) setSummary(await res.json());
    } catch { /* silent */ } finally { setLoadingSummary(false); }
  }, [month, year]);

  const fetchOpeningStock = useCallback(async () => {
    setLoadingStock(true);
    try {
      const res = await fetch(`/api/opening-stock?month=${month}&year=${year}&limit=15`);
      if (res.ok) {
        const d = await res.json();
        setOpeningStock(d.data || []);
      }
    } catch { /* silent */ } finally { setLoadingStock(false); }
  }, [month, year]);

  useEffect(() => {
    fetchSummary();
    fetchOpeningStock();
  }, [month, year]);

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const res = await fetch("/api/opening-stock/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, year }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success(`Opening stock calculated: ${d.count || 0} items`);
        fetchSummary();
        fetchOpeningStock();
      } else {
        toast.error(d.error || "Calculation failed");
      }
    } catch { toast.error("Server error"); } finally { setCalculating(false); }
  };

  // Locking asks first (AlertDialog); unlocking runs straight away, as before.
  const requestLockToggle = () => {
    if (!summary) return;
    if (!summary.is_locked) setConfirmLock(true);
    else handleLockToggle();
  };

  const handleLockToggle = async () => {
    if (!summary) return;
    const action = summary.is_locked ? "unlock" : "lock";
    setLocking(true);
    try {
      const res = await fetch("/api/costing/lock-period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, year, action }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success(action === "lock" ? "Period locked" : "Period unlocked");
        fetchSummary();
      } else { toast.error(d.error || "Failed"); }
    } catch { toast.error("Server error"); } finally { setLocking(false); }
  };

  const isLocked = summary?.is_locked ?? false;
  const coveragePct = summary?.costing_coverage_pct ?? 0;
  const hasMissingCosts = (summary?.production_total_plans ?? 0) > (summary?.production_costed_plans ?? 0);
  const openingTotal = openingStock.reduce((s, r) => s + (Number(r.opening_value) || 0), 0);
  // Sort a copy — never mutate state during render.
  const topStock = [...openingStock]
    .sort((a, b) => (Number(b.opening_value) || 0) - (Number(a.opening_value) || 0))
    .slice(0, 15);
  const productionDone =
    (summary?.production_costed_plans ?? 0) >= (summary?.production_total_plans ?? 1) && (summary?.production_total_plans ?? 0) > 0;

  return (
    <CostingFrame className="space-y-5">
      <LabHeader
        icon={Calculator}
        breadcrumb="Accounting"
        title="Costing"
        badge={isLocked ? <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />Locked</span> : undefined}
        subtitle={`${MONTHS[month - 1]} ${year} — opening stock, production costing, issuance valuation and variance`}
        actions={
          <>
            <PeriodPicker month={month} year={year} years={YEARS} onMonth={setMonth} onYear={setYear} />
            <Button variant="outline" size="sm" className="h-9" onClick={handleCalculate} disabled={calculating || isLocked}>
              {calculating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-1.5 h-4 w-4" />}
              {calculating ? "Calculating…" : "Calc Opening Stock"}
            </Button>
            {canLock && (
              <Button
                size="sm"
                variant={isLocked ? "outline" : "default"}
                className="h-9"
                onClick={requestLockToggle}
                disabled={locking}
              >
                {locking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : isLocked ? <Unlock className="mr-1.5 h-4 w-4" /> : <Lock className="mr-1.5 h-4 w-4" />}
                {isLocked ? "Unlock Period" : "Lock Period"}
              </Button>
            )}
            <IconBtn
              icon={RefreshCw}
              label="Refresh"
              onClick={() => { fetchSummary(); fetchOpeningStock(); }}
              disabled={loadingSummary}
              spin={loadingSummary}
              className="max-sm:!flex-none"
            />
          </>
        }
      />

      {/* ── 3-Step Costing Workflow ────────────────────────────────────── */}
      <LabCard title="Costing Workflow" subtitle="Follow these steps in order each period" icon={FlaskConical} bodyClassName="p-3 sm:p-4">
        <div className="flex flex-col items-stretch gap-3 lg:flex-row">
          <WorkflowStep
            step={1}
            title="Select Period"
            subtitle={`${MONTHS[month - 1]} ${year} selected. Use the selectors above to change the period.`}
            status="done"
          />
          <div className="hidden items-center text-muted-foreground/50 lg:flex"><ChevronRight className="h-5 w-5" /></div>
          <WorkflowStep
            step={2}
            title="Calculate Opening Stock"
            subtitle={
              openingStock.length > 0
                ? `${openingStock.length} items loaded — total value PKR ${fmt(openingTotal)}`
                : "No opening stock found for this period. Calculate now to proceed."
            }
            status={openingStock.length > 0 ? "done" : "active"}
            onAction={handleCalculate}
            actionLabel="Calculate Opening Stock"
            actionLoading={calculating}
          />
          <div className="hidden items-center text-muted-foreground/50 lg:flex"><ChevronRight className="h-5 w-5" /></div>
          <WorkflowStep
            step={3}
            title="Run Production Costing"
            subtitle={
              productionDone
                ? `All ${summary?.production_costed_plans} production orders costed this period.`
                : `${summary?.production_costed_plans ?? 0} / ${summary?.production_total_plans ?? 0} orders costed. Run before viewing issuance costs.`
            }
            status={openingStock.length === 0 ? "pending" : productionDone ? "done" : "active"}
            link="/accounting/costing/production"
            actionLabel="Go to Production Costing"
          />
        </div>
        {/* Warning: don't load issuance before production */}
        {openingStock.length > 0 && (summary?.production_costed_plans ?? 0) < (summary?.production_total_plans ?? 0) && (
          <Note tone="warn" icon={AlertTriangle} title="Do not open Issuance Costing yet." className="mt-3">
            Complete Step 3 (Production Costing) first so semi-finished item rates are correctly calculated before issuance valuation.
          </Note>
        )}
      </LabCard>

      {/* ── Alerts ──────────────────────────────────────────────────────────── */}
      {hasMissingCosts && (
        <Note
          tone="warn"
          icon={AlertTriangle}
          title="Production costing incomplete —"
          action={
            <Link href="/accounting/costing/production" className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-2">
              Go to Production Costing <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {(summary?.production_total_plans ?? 0) - (summary?.production_costed_plans ?? 0)} production order(s) have not been costed this period.
        </Note>
      )}

      {/* ── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <LabStat label="Opening Stock Value" value={fmt(summary?.opening_stock_value ?? 0)} icon={Warehouse} hint={`${openingStock.length} items on file`} />
        <LabStat label="Total Issuance Cost" value={fmt(summary?.total_issuance_cost ?? 0)} icon={Package} hint="Valued at opening rates" />
        <LabStat
          label="Production Cost"
          value={fmt(summary?.total_production_cost ?? 0)}
          icon={Factory}
          hint={`${summary?.production_costed_plans ?? 0} / ${summary?.production_total_plans ?? 0} plans costed`}
        />
        <LabStat
          label="Coverage"
          value={fmtPct(coveragePct)}
          icon={TrendingUp}
          tone={coveragePct >= 90 ? "ok" : coveragePct >= 60 ? "warn" : "bad"}
          hint="Production orders costed"
        />
      </div>

      {/* ── Module Navigation Cards ──────────────────────────────────────── */}
      <div>
        <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Modules</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <ModuleCard
            href="/accounting/costing/production"
            icon={Factory}
            title="Production Costing"
            description="BOM explosion — cost each production order"
            stats={[
              `${summary?.production_costed_plans ?? 0} costed`,
              `${(summary?.production_total_plans ?? 0) - (summary?.production_costed_plans ?? 0)} pending`,
            ]}
          />
          <ModuleCard
            href="/accounting/costing/issuance"
            icon={Package}
            title="Issuance Costing"
            description="View material issuances valued at opening rates"
            stats={[`Total: PKR ${fmt(summary?.total_issuance_cost ?? 0)}`]}
          />
          <ModuleCard
            href="/accounting/costing/variance"
            icon={BarChart3}
            title="Variance Analysis"
            description="BOM expected vs actual issued per production order"
            stats={[`${summary?.production_total_plans ?? 0} plans to review`]}
          />
          <ModuleCard
            href="/accounting/costing/rates"
            icon={ClipboardList}
            title="Cost Rate Review"
            description="Effective blended rate applied per item this period"
            stats={["Opening · Purchase · Production", "Blended rate breakdown"]}
          />
          <ModuleCard
            href="/accounting/costing/checking"
            icon={FlaskConical}
            title="Costing Checking"
            description="Drill-down: opening · purchases · production · issuances · closing"
            stats={["Per-item period verification", "Production details + BOM"]}
          />
        </div>
      </div>

      {/* ── Opening Stock Table ──────────────────────────────────────────── */}
      <LabCard
        title="Opening Stock Rates — Top Items by Value"
        icon={Warehouse}
        actions={loadingStock ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      >
        <div className="max-h-[60vh] overflow-auto">
          <table className="vl-grid w-full text-sm">
            <thead>
              <tr>
                <th className={cn(TH, "w-10")}>#</th>
                <th className={TH}>Item</th>
                <th className={cn(TH, "text-right")}>Opening Qty</th>
                <th className={cn(TH, "text-right")}>Opening Rate</th>
                <th className={cn(TH, "text-right")}>Opening Value</th>
              </tr>
            </thead>
            <tbody>
              {loadingStock && openingStock.length === 0 ? (
                <SkeletonRows rows={5} cols={5} />
              ) : openingStock.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <LabEmpty
                      icon={Warehouse}
                      title="No opening stock for this period"
                      hint={'Click "Calc Opening Stock" to generate.'}
                    />
                  </td>
                </tr>
              ) : (
                topStock.map((row, i) => (
                  <tr key={row.id || i} className="border-b border-border hover:bg-muted/40">
                    <td className={cn(TD, "text-xs text-muted-foreground tabular-nums max-md:!hidden")}>{i + 1}</td>
                    <td className={cn(TD, "max-md:col-span-2")}>
                      <div className="font-medium text-foreground">{row.item?.item || row.itcd}</div>
                      {row.item?.code && <span className={cn(CODE_CHIP, "mt-0.5 inline-block text-[11px]")}>{row.item.code}</span>}
                    </td>
                    <td data-label="Opening Qty" className={cn(TD, NUM)}>
                      {fmtQty(row.opening_qty)} <span className="text-xs text-muted-foreground">{row.item?.unit || ""}</span>
                    </td>
                    <td data-label="Opening Rate" className={cn(TD, NUM)}>{fmt(row.opening_rate)}</td>
                    <td data-label="Opening Value" className={cn(TD, NUM, "font-semibold text-foreground")}>{fmt(row.opening_value)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {openingStock.length > 0 && (
              <tfoot className="max-md:block">
                <tr className={cn(TOTAL_ROW, "max-md:flex max-md:justify-between")}>
                  <td colSpan={4} className={cn(TD, "text-right")}>Total Opening Value</td>
                  <td className={cn(TD, NUM)}>{fmt(openingTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </LabCard>

      {/* Lock confirmation (was a browser confirm) */}
      <AlertDialog open={confirmLock} onOpenChange={setConfirmLock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock {MONTHS[month - 1]} {year} costing period?</AlertDialogTitle>
            <AlertDialogDescription>
              This will prevent further changes to opening stock rates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmLock(false); handleLockToggle(); }}>
              <Lock className="mr-1.5 h-4 w-4" />Lock Period
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CostingFrame>
  );
}
