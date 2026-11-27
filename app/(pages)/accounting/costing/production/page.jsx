"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Calculator,
  Save,
  RefreshCw,
  AlertTriangle,
  Layers,
  Info,
  Loader2,
  ListFilter,
  X,
  Zap,
  Hash,
  Factory,
  Package,
  GitBranch,
  Activity,
  BarChart3,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeft,
  ClipboardCheck,
  Edit,
  DollarSign,
  Trash2,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LabHeader, LabCard, LabEmpty, Chip, CODE_CHIP, CHIP, TH, TD, NUM, TOTAL_ROW,
  DIALOG, DIALOG_HEAD, DIALOG_BODY, DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";
import {
  CostingFrame, PeriodPicker, SearchBox, Segmented, Signed, Note, IconBtn, TONE_TEXT,
} from "@/components/Costing/CostingUI";
import { Skeleton } from "@/components/ui/skeleton";
import SemiCcPanel from "@/components/Costing/SemiCcPanel";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import { useFeatures } from "@/hooks/useFeatures";

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

function fmt(v)    { return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0); }
function fmtQty(v) { return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(v) || 0); }
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Item-type badge ───────────────────────────────────────────────────────────
// Step labels match the 6-step costing sequence in route.js
const TYPE_CFG = {
  semi_finished_l1:    { label: "Semi-Fin L1",  tone: "muted", icon: Layers,     step: "Step 2" },
  semi_finished_lN:    { label: "Semi-Fin LN",  tone: "warn",  icon: GitBranch,  step: "Step 3–4" },
  semi_finished_other: { label: "Semi-Fin",     tone: "muted", icon: Package,    step: "Step 5" },
  mixed:               { label: "Mixed FG",     tone: "ok",    icon: Package,    step: "Step 6" },
  finished_good:       { label: "Finished Good",tone: "brand", icon: Factory,    step: "Step 6" },
};
function ItemTypeBadge({ type }) {
  const cfg = TYPE_CFG[type] || TYPE_CFG.finished_good;
  const Icon = cfg.icon;
  return (
    <Chip tone={cfg.tone} className="whitespace-nowrap text-[10.5px]">
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Chip>
  );
}

// ── Cost source badge ──────────────────────────────────────────────────────────
const SRC_CFG = {
  opening_stock:          { label: "Opening Stock",   tone: "ok" },
  weighted_avg:           { label: "Wtd Avg",         tone: "muted" },
  last_purchase:          { label: "Last Purchase",   tone: "brand" },
  production_cost_entry:  { label: "Prod Cost",       tone: "brand" },
  not_found:              { label: "No Cost",         tone: "bad" },
  not_in_bom:             { label: "Not in BOM",      tone: "warn" },
  computed:               { label: "Computed",        tone: "muted" },
};
function CostSourceBadge({ source }) {
  const c = SRC_CFG[source] || { label: source || "—", tone: "muted" };
  return <Chip tone={c.tone} className="whitespace-nowrap text-[10.5px]">{c.label}</Chip>;
}

// ── Variance indicator — signed: over BOM = bad, under = ok ───────────────────
function VarianceCell({ value, format = fmt }) {
  return <Signed value={value} format={format} />;
}

// ── BOM Tree Node ──────────────────────────────────────────────────────────────
function BOMNode({ node, isRoot = false }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isRaw      = node.is_raw_material;
  const isSemi     = node.is_semi_finished;
  const isFinished = isRoot;
  const noCost     = isRaw && node.cost_source === "not_found";

  // Left accent per node kind (legend in the card header).
  const accent = isFinished
    ? "border-l-primary"
    : isSemi
    ? "border-l-amber-500"
    : isRaw
    ? noCost ? "border-l-red-600" : "border-l-[#2f5139] dark:border-l-emerald-400"
    : "border-l-muted-foreground";

  return (
    <div className={cn("mt-1", !isRoot && "ml-1")}>
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border border-l-4 border-border bg-background p-2",
          accent,
          isFinished && "bg-primary/5",
          noCost && "bg-red-50/60 dark:bg-red-950/20",
          hasChildren && "cursor-pointer hover:bg-muted/40",
        )}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <div className="mt-0.5 flex items-center gap-1">
          {hasChildren
            ? expanded
              ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            : <span className="h-3.5 w-3.5 flex-shrink-0" />
          }
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground">{node.material_name || `Item #${node.material_id}`}</span>
            {node.material_code && <span className={cn(CODE_CHIP, "text-[10.5px]")}>{node.material_code}</span>}
            <CostSourceBadge source={node.cost_source} />
            {node.percentage && <span className="text-[11px] text-muted-foreground">({node.percentage}%)</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>Qty: <strong className="tabular-nums text-foreground">{fmtQty(node.qty)}</strong></span>
            <span>Rate: <strong className="tabular-nums text-foreground">{fmt(node.unit_cost)}</strong></span>
            <span>Total: <strong className="tabular-nums text-primary">{fmt(node.total_cost)}</strong></span>
          </div>
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-border pl-2 sm:ml-4">
          {node.children.map((child, i) => <BOMNode key={i} node={child} />)}
        </div>
      )}
    </div>
  );
}

// ── Materials detail table ─────────────────────────────────────────────────────
function MaterialsTable({ items }) {
  if (!items?.length) return null;
  const totalTheoretical = items.reduce((s, r) => s + (r.total_cost   || 0), 0);
  const totalActual      = items.reduce((s, r) => s + (r.actual_cost  || 0), 0);
  const totalVariance    = items.reduce((s, r) => s + (r.variance_cost || 0), 0);
  const dash = <span className="text-muted-foreground/60">—</span>;

  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
      <table className="w-full min-w-[980px] text-xs">
        <thead>
          <tr>
            <th className={cn(TH, "left-0 z-20 text-[11px]")}>Material</th>
            <th className={cn(TH, "text-right text-[11px]")}>Source</th>
            <th className={cn(TH, "text-right text-[11px]")}>BOM Qty</th>
            <th className={cn(TH, "text-right text-[11px]")}>Rate</th>
            <th className={cn(TH, "text-right text-[11px]")}>Theoretical Cost</th>
            <th className={cn(TH, "text-right text-[11px]")}>Actual Qty</th>
            <th className={cn(TH, "text-right text-[11px]")}>Actual Rate</th>
            <th className={cn(TH, "text-right text-[11px]")}>Actual Cost</th>
            <th className={cn(TH, "text-right text-[11px]")}>Variance Qty</th>
            <th className={cn(TH, "text-right text-[11px]")}>Variance Cost</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr
              key={i}
              className={cn(
                "group border-b border-border hover:bg-muted/40",
                row.cost_source === "not_found" && "bg-red-50/50 dark:bg-red-950/20",
                row.cost_source === "not_in_bom" && "bg-amber-50/50 dark:bg-amber-950/20",
              )}
            >
              <td className="sticky left-0 z-[1] min-w-[180px] bg-background px-3 py-2 group-hover:bg-muted">
                <div className="font-medium text-foreground">{row.material_name}</div>
                {row.material_code && <span className={cn(CODE_CHIP, "text-[10.5px]")}>{row.material_code}</span>}
              </td>
              <td className="px-3 py-2 text-right"><CostSourceBadge source={row.cost_source} /></td>
              <td className={cn("px-3 py-2", NUM)}>{fmtQty(row.qty)}</td>
              <td className={cn("px-3 py-2", NUM)}>{fmt(row.unit_cost)}</td>
              <td className={cn("px-3 py-2 font-semibold text-foreground", NUM)}>{fmt(row.total_cost)}</td>
              <td className={cn("px-3 py-2", NUM)}>{row.actual_qty != null ? fmtQty(row.actual_qty) : dash}</td>
              <td className={cn("px-3 py-2", NUM)}>{row.actual_unit_cost != null ? fmt(row.actual_unit_cost) : dash}</td>
              <td className={cn("px-3 py-2 font-semibold text-foreground", NUM)}>{row.actual_cost != null ? fmt(row.actual_cost) : dash}</td>
              <td className={cn("px-3 py-2", NUM)}><VarianceCell value={row.variance_qty} format={fmtQty} /></td>
              <td className={cn("px-3 py-2", NUM)}><VarianceCell value={row.variance_cost} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-10">
          <tr className={cn(TOTAL_ROW, "bg-muted text-[11.5px]")}>
            <td colSpan={4} className="sticky left-0 bg-muted px-3 py-2 text-right">TOTAL</td>
            <td className={cn("px-3 py-2", NUM)}>{fmt(totalTheoretical)}</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className={cn("px-3 py-2", NUM)}>{totalActual > 0 ? fmt(totalActual) : "—"}</td>
            <td className="px-3 py-2" />
            <td className={cn("px-3 py-2", NUM)}><VarianceCell value={totalVariance || null} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Small building blocks for the detail panel ────────────────────────────────
// Labelled figure tile (theoretical / actual / variance / missing).
function Figure({ label, children, hint, tone }) {
  return (
    <div className={cn("rounded-lg border border-border bg-background p-3", tone && "border-l-4", tone === "bad" && "border-l-red-600", tone === "ok" && "border-l-[#2f5139] dark:border-l-emerald-400", tone === "brand" && "border-l-primary")}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{children}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// Audit check line: status icon + bold finding + muted explanation.
function Check({ tone, title, children }) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", TONE_TEXT[tone])} />
      <span>
        <strong className={TONE_TEXT[tone]}>{title}</strong>
        <span className="text-muted-foreground">{children}</span>
      </span>
    </div>
  );
}

function AuditBlock({ title, children }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

// ── Produced on dispatch: what was issued and costed, and each dispatch ─────
function DispatchIssuance({ detail, loading, unit }) {
  if (loading) {
    return <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-32 w-full" /></div>;
  }
  if (!detail) return null;
  const mats = detail.entry?.materials || [];
  const matQty = mats.reduce((s, m) => s + m.qty, 0);
  const matCost = mats.reduce((s, m) => s + m.cost, 0);
  const dispatches = detail.dispatches || [];
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
          <p className="text-xs font-semibold text-foreground">Materials issued (BOM of these dispatches)</p>
          {detail.entry ? (
            <span className="text-[11px] text-muted-foreground">
              Costed {fmtQty(detail.entry.qty_costed)} {unit} @ <strong className="tabular-nums text-foreground">{fmt(detail.entry.cost_per_unit)}</strong>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Not costed yet — run Re-Cost All</span>
          )}
        </div>
        {mats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="vl-grid w-full text-xs">
              <thead>
                <tr>
                  <th className={cn(TH, "text-[11px]")}>Material</th>
                  <th className={cn(TH, "text-right text-[11px]")}>Qty issued</th>
                  <th className={cn(TH, "text-right text-[11px]")}>Rate</th>
                  <th className={cn(TH, "text-right text-[11px]")}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {mats.map((m) => (
                  <tr key={m.itcd} className="border-b border-border/60">
                    <td data-label="Material" className={TD}>
                      {m.code && <span className={cn(CODE_CHIP, "mr-1")}>{m.code}</span>}
                      {m.item}
                    </td>
                    <td data-label="Qty issued" className={cn(TD, NUM)}>{fmtQty(m.qty)}</td>
                    <td data-label="Rate" className={cn(TD, NUM)}>{fmt(m.rate)}</td>
                    <td data-label="Cost" className={cn(TD, NUM, "font-semibold")}>{fmt(m.cost)}</td>
                  </tr>
                ))}
                <tr className={TOTAL_ROW}>
                  <td className={TD}>Total</td>
                  <td className={cn(TD, NUM)}>{fmtQty(matQty)}</td>
                  <td className={cn(TD, NUM)}>{matQty ? fmt(matCost / matQty) : "—"}</td>
                  <td className={cn(TD, NUM)}>{fmt(matCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">No cost entry yet.</p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="border-b border-border bg-muted/40 px-3 py-2">
          <p className="text-xs font-semibold text-foreground">
            Dispatches ({dispatches.length}) — production and the materials issued with it
          </p>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="vl-grid w-full text-xs">
            <thead>
              <tr>
                <th className={cn(TH, "text-[11px]")}>Date</th>
                <th className={cn(TH, "text-[11px]")}>Dispatch</th>
                <th className={cn(TH, "text-right text-[11px]")}>Produced</th>
                <th className={cn(TH, "text-[11px]")}>Issued for it</th>
              </tr>
            </thead>
            <tbody>
              {dispatches.map((d) => {
                const href = voucherHref({ tran_code: 6, tran_id: d.dispatch_tran_id });
                return (
                  <tr key={`${d.production_tran_id}-${d.line_no ?? 0}`} className="border-b border-border/60 align-top">
                    <td data-label="Date" className={cn(TD, "whitespace-nowrap")}>{fmtDate(d.dated)}</td>
                    <td data-label="Dispatch" className={cn(TD, "whitespace-nowrap")}>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">
                          {d.dispatch_no || `#${d.dispatch_tran_id}`}
                        </a>
                      ) : (
                        <span className="font-mono">{d.dispatch_no || "—"}</span>
                      )}
                    </td>
                    <td data-label="Produced" className={cn(TD, NUM)}>{fmtQty(d.produced_qty)} {unit}</td>
                    <td data-label="Issued for it" className={TD}>
                      {d.materials.length ? (
                        d.materials.map((m) => (
                          <div key={`${m.itcd}-${m.issue_tran_id}`} className="whitespace-nowrap">
                            {m.code || m.itcd} {m.item} — <span className="tabular-nums">{fmtQty(m.qty)}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-destructive">No BOM issue found</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ProductionCostingPage() {
  const now = new Date();
  // Settings → Features "costing.engine": "item" = one cost per production item
  // (produce-on-dispatch from its own BOM issues); "plan" = one per process order
  const itemEngine = useFeatures().value("costing.engine") === "item";
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());

  const [search,     setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter,   setTypeFilter]   = useState("all");
  // Source: process orders / produced on dispatch / no plan ; item category
  const [sourceFilter,   setSourceFilter]   = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sourceCounts,   setSourceCounts]   = useState({ order: 0, dispatch: 0, noplan: 0 });
  const [categories,     setCategories]     = useState([]);
  const [filteredTotal,  setFilteredTotal]  = useState(0);

  const [plans,             setPlans]             = useState([]);
  const [orphanProductions, setOrphanProductions] = useState([]);
  // Process orders of the month not posted yet (Completed / open) — not in stock or costing
  const [unpostedOrders, setUnpostedOrders] = useState([]);
  const [summary,     setSummary]     = useState({ total: 0, costed: 0, not_costed: 0, period_locked: false });
  const [loadingList, setLoadingList] = useState(false);
  const [page,        setPage]        = useState(1);
  const [totalPages,  setTotalPages]  = useState(1);
  const [itcdFilter,  setItcdFilter]  = useState("");
  const [codeFilter,  setCodeFilter]  = useState("");

  const [selectedPlan,   setSelectedPlan]   = useState(null);
  // Produced on dispatch: its materials (cost entry) and the dispatches behind it
  const [dispatchDetail, setDispatchDetail] = useState(null);
  const [loadingDispatch, setLoadingDispatch] = useState(false);
  const [costData,       setCostData]       = useState(null);
  const [activityData,   setActivityData]   = useState(null);
  const [loadingCost,    setLoadingCost]    = useState(false);
  const [loadingActivity,setLoadingActivity]= useState(false);
  const [saving,         setSaving]         = useState(false);
  const [savingAll,      setSavingAll]       = useState(false);
  const [checkedIds,     setCheckedIds]     = useState(new Set());

  // ── Fetch list ──────────────────────────────────────────────────────────────
  const fetchPlans = useCallback(async (overridePage) => {
    setLoadingList(true);
    setSelectedPlan(null);
    setCostData(null);
    setActivityData(null);
    setCheckedIds(new Set());
    try {
      const params = new URLSearchParams({ month, year, page: overridePage ?? page, limit: 30 });
      if (search)      params.set("search",       search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (itcdFilter)  params.set("itcd",         itcdFilter);
      if (codeFilter)  params.set("code",         codeFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res  = await fetch(`/api/costing/production?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setPlans(json.plans || []);
      setOrphanProductions(json.orphan_productions || []);
      setUnpostedOrders(json.unposted_orders || []);
      setSourceCounts(json.source_counts || { order: 0, dispatch: 0, noplan: 0 });
      setCategories(json.categories || []);
      setFilteredTotal(json.filtered_total ?? (json.plans || []).length);
      setTotalPages(json.totalPages || 1);
      setSummary({
        total:         json.total         || 0,
        costed:        json.costed        || 0,
        not_costed:    json.not_costed    || 0,
        period_locked: json.period_locked || false,
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingList(false);
    }
  }, [month, year, search, statusFilter, itcdFilter, codeFilter, sourceFilter, categoryFilter, typeFilter, page]);

  useEffect(() => { setPage(1); fetchPlans(1); }, [month, year]); // eslint-disable-line
  // Re-fetch when status filter or page changes
  useEffect(() => { fetchPlans(page); }, [statusFilter, page]); // eslint-disable-line
  // Every other filter applies as it changes (typing waits a moment) — page 1
  const filtersReady = useRef(false);
  useEffect(() => {
    if (!filtersReady.current) { filtersReady.current = true; return; }
    const t = setTimeout(() => { setPage(1); fetchPlans(1); }, 350);
    return () => clearTimeout(t);
  }, [search, itcdFilter, codeFilter, sourceFilter, categoryFilter, typeFilter]); // eslint-disable-line

  const activeFilterCount = [
    search, itcdFilter, codeFilter, categoryFilter,
    statusFilter !== "all", sourceFilter !== "all", typeFilter !== "all",
  ].filter(Boolean).length;
  const clearAllFilters = () => {
    setSearch(""); setItcdFilter(""); setCodeFilter(""); setCategoryFilter("");
    setStatusFilter("all"); setSourceFilter("all"); setTypeFilter("all"); setPage(1);
  };

  // ── Load BOM cost preview + T7/T8 activity in parallel ────────────────────
  const loadCostPreview = async (plan) => {
    setSelectedPlan(plan);
    setCostData(null);
    setActivityData(null);
    setDispatchDetail(null);
    // Produced on dispatch: load its materials issued and its dispatches
    if (plan.is_orphan && plan.on_dispatch) {
      setLoadingDispatch(true);
      try {
        const res = await fetch(`/api/costing/production?dispatch_detail=${plan.finished_id}&month=${month}&year=${year}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load the dispatches");
        setDispatchDetail(json);
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoadingDispatch(false);
      }
      return;
    }
    // Other rows without a Posted plan — static detail panel, no API calls
    if (plan.is_orphan) return;
    setLoadingCost(true);
    setLoadingActivity(true);
    try {
      // Use the plan's own month/year (from plan.dated), NOT the page browsing month.
      // A plan from April will have T7/T8 vouchers in April — using May would miss them.
      const planDate  = plan.dated ? new Date(plan.dated) : new Date();
      const planMonth = planDate.getMonth() + 1;  // 1-based
      const planYear  = planDate.getFullYear();

      const [costRes, actRes] = await Promise.all([
        fetch("/api/costing/bom-cost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan_id: plan.id, month: planMonth, year: planYear }),
        }),
        fetch(`/api/costing/production/plan-activity?plan_id=${plan.id}&month=${planMonth}&year=${planYear}`),
      ]);
      const [costJson, actJson] = await Promise.all([costRes.json(), actRes.json()]);
      if (!costRes.ok) throw new Error(costJson.error || "Calculation failed");
      setCostData(costJson);
      if (actRes.ok) setActivityData(actJson);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingCost(false);
      setLoadingActivity(false);
    }
  };

  // ── Save single ─────────────────────────────────────────────────────────────
  const saveCost = async () => {
    if (!selectedPlan) return;
    setSaving(true);
    try {
      // Always use the plan's own month/year so T7 issuances are looked up
      // in the correct period (not the page's browsing month).
      const planDate  = selectedPlan.dated ? new Date(selectedPlan.dated) : new Date();
      const planMonth = planDate.getMonth() + 1;
      const planYear  = planDate.getFullYear();

      const res  = await fetch("/api/costing/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: selectedPlan.id, month: planMonth, year: planYear }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      const r = json.results?.[0];
      if (r) {
        toast.success(
          `Costed: ${r.finished_item} | BOM: ${fmt(r.theoretical_cost)} | Actual: ${r.actual_issued_cost > 0 ? fmt(r.actual_issued_cost) : "no issuances linked"}`
        );
      } else {
        toast.success("Costing saved");
      }
      await fetchPlans();
      await loadCostPreview({ ...selectedPlan });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Bulk cost (manual selection) ────────────────────────────────────────────
  const saveSelectedAll = async (idsOverride) => {
    const ids = idsOverride || Array.from(checkedIds);
    if (!ids.length) { toast.info("No plans selected"); return; }
    setSavingAll(true);
    try {
      const res  = await fetch("/api/costing/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_ids: ids, month, year }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bulk save failed");
      toast.success(`${json.costed} plan(s) costed${json.failed > 0 ? `, ${json.failed} failed` : ""}`);
      setCheckedIds(new Set());
      await fetchPlans();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingAll(false);
    }
  };

  // ── Auto-sequence cost all ──────────────────────────────────────────────────
  const autoSequenceAll = async (onlyPending = false) => {
    setSavingAll(true);
    try {
      const res  = await fetch("/api/costing/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // "item" engine, one go: process orders in sequence, then the productions
        // without one (produce-on-dispatch from their own BOM issues —
        // lib/costing/noPlanCosting.js). "plan" engine: process orders only, as before.
        body: JSON.stringify({ auto_sequence: true, auto_orphans: itemEngine, only_pending: onlyPending, month, year }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Auto-sequence failed");
      const noPlan = json.orphans?.t8_grouped?.processed ?? 0;
      toast.success(
        `Costing complete: ${json.costed} process order(s)${noPlan ? ` + ${noPlan} item(s) without one` : ""}${json.failed > 0 ? `, ${json.failed} failed` : ""}`
      );
      await fetchPlans();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingAll(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteCostEntry = async (planId) => {
    try {
      const res = await fetch(`/api/costing/production?plan_id=${planId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || body.message || "Delete failed");
        return;
      }
      toast.success("Cost entry removed");
      await fetchPlans();
      if (selectedPlan?.id === planId) { setCostData(null); setSelectedPlan(null); }
    } catch { toast.error("Delete failed"); }
  };

  // ── Filtering (type filter stays client-side since it needs saved cost_entry) ──────────
  // All filters run on the server over the whole month (before paging)
  const filteredPlans = plans;

  const changePage = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
  };

  const applySearch = () => { setPage(1); fetchPlans(1); };

  const notCostedIds = plans.filter((p) => !p.is_costed).map((p) => p.id);

  // Build BOM tree from flat raw_materials when the API doesn't return a tree structure
  const bomTree = useMemo(() => {
    if (!costData) return null;
    if (costData.tree) return costData.tree;
    if (!costData.raw_materials?.length) return null;
    return {
      material_id:      costData.finished_id,
      material_name:    costData.finished_item || "Finished Item",
      material_code:    costData.finished_code,
      is_semi_finished: false,
      is_raw_material:  false,
      qty:              costData.qty_costed,
      unit_cost:        costData.cost_per_unit,
      total_cost:       costData.total_cost,
      cost_source:      "computed",
      children:         costData.raw_materials.map((m) => ({ ...m, children: [] })),
    };
  }, [costData]);

  // Merge BOM raw materials with T7 actual issuance data for the preview table.
  // Also appends T7-only rows (issued but not in BOM) as unexpected consumption.
  const mergedRawMaterials = useMemo(() => {
    if (!costData?.raw_materials) return [];
    const t7Map = new Map(
      (activityData?.t7_summary?.materials || []).map((m) => [m.itcd, m])
    );
    const bomMaterialIds = new Set();
    const merged = costData.raw_materials.map((r) => {
      bomMaterialIds.add(r.material_id);
      const t7 = t7Map.get(r.material_id);
      const actual_qty    = t7 != null ? (t7.total_qty  ?? null) : null;
      const actual_cost   = t7 != null ? (t7.total_cost ?? null) : null;
      const variance_qty  = actual_qty  != null ? actual_qty  - (r.qty        || 0) : null;
      const variance_cost = actual_cost != null ? actual_cost - (r.total_cost || 0) : null;
      return { ...r, actual_qty, actual_cost, variance_qty, variance_cost };
    });
    // Add T7 materials that are NOT in the BOM (unexpected / extra consumption)
    for (const [itcd, t7] of t7Map) {
      if (!bomMaterialIds.has(itcd)) {
        merged.push({
          material_id:   itcd,
          material_name: t7.item_name,
          material_code: t7.item_code,
          unit:          t7.unit,
          bom_level:     0,
          is_raw_material: true,
          qty:           0,
          unit_cost:     t7.unit_cost,
          total_cost:    0,
          cost_source:   "not_in_bom",
          actual_qty:    t7.total_qty,
          actual_cost:   t7.total_cost,
          variance_qty:  t7.total_qty,
          variance_cost: t7.total_cost,
        });
      }
    }
    return merged;
  }, [costData?.raw_materials, activityData?.t7_summary?.materials]);

  // ── Orphan PCE "Set Rate" dialog state ─────────────────────────────────────
  const [rateDialog,     setRateDialog]     = useState(null);   // row being edited | null
  const [rateInput,      setRateInput]      = useState("");
  const [savingRate,     setSavingRate]     = useState(false);
  const [t7Suggestion,   setT7Suggestion]   = useState(null);   // { suggested_rate, t7_total_damt, ... }
  const [loadingT7,      setLoadingT7]      = useState(false);

  const openRateDialog = async (row) => {
    setRateDialog(row);
    setT7Suggestion(null);
    setRateInput(row.effective_rate > 0 ? String(row.effective_rate) : "");
    // Fetch T7 suggestion in background
    setLoadingT7(true);
    try {
      const res  = await fetch(
        `/api/costing/bom-cost/orphan?itcd=${row.finished_id}&month=${month}&year=${year}`
      );
      const json = await res.json();
      if (res.ok) {
        setT7Suggestion(json);
        // Auto-fill with T7 suggested rate if no rate entered yet and suggestion exists
        if (json.suggested_rate > 0 && !(row.effective_rate > 0)) {
          setRateInput(String(json.suggested_rate.toFixed(4)));
        }
      }
    } catch { /* non-fatal */ }
    finally { setLoadingT7(false); }
  };
  const closeRateDialog = () => { setRateDialog(null); setRateInput(""); setT7Suggestion(null); };

  const saveOrphanRate = async () => {
    if (!rateDialog) return;
    const rate = parseFloat(rateInput);
    if (!(rate > 0)) { toast.error("Enter a valid rate > 0"); return; }
    setSavingRate(true);
    try {
      const res  = await fetch("/api/costing/bom-cost/orphan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itcd:          rateDialog.finished_id,
          month,
          year,
          qty_costed:    rateDialog.total_qty,
          cost_per_unit: rate,
          rate_source:   t7Suggestion?.suggested_rate > 0 &&
                         Math.abs(rate - t7Suggestion.suggested_rate) < 0.01
                           ? 't7_issuance'
                           : 'manual',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      toast.success(`Rate saved for ${rateDialog.finished_item}: ${fmt(rate)}`);
      closeRateDialog();
      await fetchPlans();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingRate(false);
    }
  };

  const toggleCheck = (id) => {
    setCheckedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleAll = () => {
    // Only plan-linked (non-orphan) rows can be bulk-costed
    const costableIds = filteredPlans.filter(p => !p.is_orphan).map(p => p.id);
    setCheckedIds(
      checkedIds.size === costableIds.length && costableIds.length > 0
        ? new Set()
        : new Set(costableIds)
    );
  };

  // Cost columns for the saved entry display
  const ce = selectedPlan?.cost_entry;

  // Delete asks first (was one click on the X).
  const [confirmDelete, setConfirmDelete] = useState(false);

  const costableCount = filteredPlans.filter(p => !p.is_orphan).length;

  return (
    <CostingFrame>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <LabHeader
        icon={Calculator}
        breadcrumb="Costing"
        title="Production Costing"
        subtitle="Multi-level BOM — theoretical + actual issuances · auto-sequenced"
        actions={
          <>
            <Link href="/accounting/costing" className="max-sm:!flex-none">
              <IconBtn icon={ArrowLeft} label="Back to Costing" />
            </Link>
            <PeriodPicker month={month} year={year} years={YEARS} onMonth={setMonth} onYear={setYear} />
            <IconBtn
              icon={RefreshCw}
              label="Refresh"
              onClick={() => fetchPlans()}
              disabled={loadingList}
              spin={loadingList}
              className="max-sm:!flex-none"
            />
          </>
        }
      />

      {/* Costing method + semi-finished CC start month (Settings → Features) */}
      <SemiCcPanel month={month} year={year} />

      {/* Summary chips + auto-sequence */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background p-3">
        <Chip tone="muted" className="text-xs">Total: <strong className="tabular-nums">{summary.total}</strong></Chip>
        <Chip tone="ok" className="text-xs"><CheckCircle2 className="h-3 w-3" /> Costed: <strong className="tabular-nums">{summary.costed}</strong></Chip>
        <Chip tone="warn" className="text-xs"><AlertTriangle className="h-3 w-3" /> Pending: <strong className="tabular-nums">{summary.not_costed}</strong></Chip>
        {summary.period_locked && <Chip tone="bad" className="text-xs">Period Locked</Chip>}
        {orphanProductions.some((o) => o.on_dispatch) && (
          <Chip tone="muted" className="text-xs" title={itemEngine ? "Made by dispatches (produce-on-dispatch) — each costed from its own BOM issue" : "Made by dispatches (produce-on-dispatch)"}>
            <Truck className="h-3 w-3" /> Produced on dispatch: <strong className="tabular-nums">{orphanProductions.filter((o) => o.on_dispatch).length}</strong>
          </Chip>
        )}
        {orphanProductions.some((o) => !o.on_dispatch) && (
          <Chip tone="brand" className="text-xs">
            <AlertTriangle className="h-3 w-3" /> No-Plan Receipts: <strong className="tabular-nums">{orphanProductions.filter((o) => !o.on_dispatch).length}</strong>
          </Chip>
        )}
        {unpostedOrders.length > 0 && (
          <Chip tone="bad" className="text-xs">
            <AlertTriangle className="h-3 w-3" /> Not posted: <strong className="tabular-nums">{unpostedOrders.length}</strong>
          </Chip>
        )}

        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <Button
            size="sm"
            variant="outline"
            className="h-9 flex-1 sm:flex-none"
            onClick={() => autoSequenceAll(true)}
            disabled={savingAll || summary.period_locked || summary.not_costed === 0}
          >
            {savingAll ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4" />}
            Auto-Cost Pending ({summary.not_costed})
          </Button>
          <Button
            size="sm"
            className="h-9 flex-1 sm:flex-none"
            onClick={() => autoSequenceAll(false)}
            disabled={savingAll || summary.period_locked}
          >
            {savingAll ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4" />}
            Re-Cost All
          </Button>
        </div>
      </div>

      {/* Process orders not posted yet — their issue / production vouchers do
          not exist, so stock and this costing do not include them. */}
      {unpostedOrders.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <p className="text-sm font-semibold text-foreground">
              {unpostedOrders.length} process order{unpostedOrders.length === 1 ? "" : "s"} this month {unpostedOrders.length === 1 ? "is" : "are"} not posted
            </p>
            <span className="text-xs text-muted-foreground">
              — no issue / production vouchers yet, so stock and costing leave them out. Post them (Process Orders → Send to Production), then Re-Cost All.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {unpostedOrders.map((o) => (
              <a
                key={o.id}
                href={`/accounting/material?tab=production&search=${o.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs transition hover:border-primary/40 hover:text-primary"
                title="Open this process order"
              >
                <span className="font-mono font-semibold">#{o.id}</span>
                <span className="max-w-[14rem] truncate">{o.item_code ? `${o.item_code} ` : ""}{o.item_name}</span>
                <span className="tabular-nums text-muted-foreground">{fmtQty(o.qty)} {o.unit}</span>
                <span className="text-muted-foreground">· {fmtDate(o.dated)}</span>
                <Chip tone="warn" className="px-1.5 py-0 text-[10px]">{o.status}</Chip>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Body: plans list + cost preview ─────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">

        {/* LEFT: Plans list */}
        <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-background lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">

          {/* Search + filters */}
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex gap-1.5">
              <SearchBox
                value={search}
                onChange={setSearch}
                onEnter={applySearch}
                placeholder="Search item, order # or dispatch #…"
              />
              <IconBtn icon={ListFilter} label="Apply search" onClick={applySearch} />
            </div>
            {/* ITCD + Code filters */}
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Hash className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="ITCD…"
                  aria-label="ITCD"
                  type="number"
                  value={itcdFilter}
                  onChange={(e) => setItcdFilter(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applySearch()}
                  className="h-8 bg-background pl-7 text-xs"
                />
              </div>
              <Input
                placeholder="Item code…"
                aria-label="Item code"
                value={codeFilter}
                onChange={(e) => setCodeFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
                className="h-8 flex-1 bg-background text-xs"
              />
              {(itcdFilter || codeFilter) && (
                <button
                  type="button"
                  aria-label="Clear ITCD / code filters"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => { setItcdFilter(""); setCodeFilter(""); setTimeout(applySearch, 0); }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Status tabs */}
            <Segmented
              value={statusFilter}
              onChange={(k) => { setStatusFilter(k); setPage(1); }}
              options={[
                { key: "all",       label: "All",     count: summary.total + summary.costed + summary.not_costed > 0 ? summary.total || plans.length : plans.length },
                { key: "not_costed",label: "Pending", count: summary.not_costed },
                { key: "costed",    label: "Costed",  count: summary.costed },
              ]}
            />
            {/* Source: where the production came from */}
            <Segmented
              value={sourceFilter}
              onChange={(k) => setSourceFilter(k)}
              options={[
                { key: "all",      label: "All sources" },
                { key: "order",    label: "Orders",      count: sourceCounts.order },
                { key: "dispatch", label: "On dispatch", count: sourceCounts.dispatch },
                ...(sourceCounts.noplan > 0 ? [{ key: "noplan", label: "No plan", count: sourceCounts.noplan }] : []),
              ]}
            />
            {/* Item category */}
            <div className="flex gap-1.5">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Item category"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                  title="Clear every filter"
                >
                  <X className="h-3.5 w-3.5" /> Clear ({activeFilterCount})
                </button>
              )}
            </div>
            {/* Item type filter (cost type of the saved entry) */}
            <div className="flex flex-wrap gap-1">
              {[
                { key: "all",                 label: "All Types" },
                { key: "semi_finished_l1",   label: "Semi L1" },
                { key: "semi_finished_lN",   label: "Semi LN" },
                { key: "semi_finished_other",label: "SF Other" },
                { key: "mixed",              label: "Mixed FG" },
                { key: "finished_good",      label: "Finished" },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTypeFilter(t.key)}
                  aria-pressed={typeFilter === t.key}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    typeFilter === t.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {loadingList ? "Loading…" : `${filteredTotal} row${filteredTotal === 1 ? "" : "s"}${activeFilterCount ? " match the filters" : " this month"}`}
            </p>
          </div>

          {/* Bulk action bar */}
          {checkedIds.size > 0 && (
            <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-3 py-2">
              <span className="text-xs font-semibold text-primary">{checkedIds.size} selected</span>
              <Button
                size="sm"
                className="ml-auto h-8 text-xs"
                onClick={() => saveSelectedAll()}
                disabled={savingAll}
              >
                {savingAll ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                Cost Selected
              </Button>
              <button type="button" aria-label="Clear selection" onClick={() => setCheckedIds(new Set())} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Plans list */}
          <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
            {loadingList ? (
              <div className="space-y-1.5 p-2">
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[74px] rounded-lg" />)}
              </div>
            ) : filteredPlans.length === 0 ? (
              <LabEmpty icon={ListFilter} title="No production plans" hint="Change the period, status or filters." />
            ) : (
              <div className="space-y-1.5 p-2">
                <label className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={(() => { const c = filteredPlans.filter(p => !p.is_orphan); return c.length > 0 && checkedIds.size === c.length; })()}
                    onChange={toggleAll}
                    disabled={costableCount === 0}
                    className="h-3.5 w-3.5 rounded border-border accent-[hsl(var(--primary))]"
                  />
                  Select all
                </label>

                {filteredPlans.map((plan) => {
                  const isSelected = selectedPlan?.id === plan.id;
                  const itype = plan.cost_entry?.item_type;

                  // ── Orphan T8 receipt (no plan) ──
                  if (plan.is_orphan) {
                    return (
                      <button
                        type="button"
                        key={plan.id}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg border border-l-4 p-2.5 text-left transition-colors",
                          plan.on_dispatch ? "border-l-primary/60" : "border-l-amber-500",
                          isSelected ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40",
                        )}
                        onClick={() => loadCostPreview(plan)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {plan.finished_item}
                            </span>
                            {plan.on_dispatch ? (
                              <Chip tone="muted" className="px-1.5 py-0 text-[10px]">
                                <Truck className="h-2.5 w-2.5" /> ON DISPATCH
                              </Chip>
                            ) : (
                              <Chip tone="warn" className="px-1.5 py-0 text-[10px]">NO PLAN</Chip>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {plan.finished_code && <span className="font-mono">{plan.finished_code} · </span>}
                            {fmtDate(plan.dated)}
                            <span className="ml-1 font-mono">T#{plan.tran_id}</span>
                            {plan.on_dispatch && plan.dispatch_count > 0 && (
                              <span className="ml-1">· {plan.dispatch_count} dispatch{plan.dispatch_count === 1 ? "" : "es"}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Rcvd: <strong className="tabular-nums text-foreground">{fmtQty(plan.actual_production_qty)}</strong> {plan.unit}
                            {plan.unit_cost > 0 && (
                              <span className="ml-1">@ <strong className="tabular-nums text-foreground">{fmt(plan.unit_cost)}</strong></span>
                            )}
                          </div>
                          {plan.rmk5 && (
                            <div className={cn("font-mono text-[11px]", TONE_TEXT.warn)}>
                              rmk5: {plan.rmk5}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  }

                  // ── Normal plan row ──
                  return (
                    <div
                      key={plan.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors",
                        isSelected ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20" : "border-border hover:bg-muted/40",
                      )}
                      onClick={() => loadCostPreview(plan)}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) loadCostPreview(plan); }}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${plan.finished_item || `plan ${plan.id}`}`}
                        checked={checkedIds.has(plan.id)}
                        onChange={(e) => { e.stopPropagation(); toggleCheck(plan.id); }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 h-3.5 w-3.5 flex-shrink-0 rounded border-border accent-[hsl(var(--primary))]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-foreground">
                            {plan.finished_item || `Plan #${plan.id}`}
                          </span>
                          {plan.is_costed
                            ? <CheckCircle2 className={cn("h-3.5 w-3.5 flex-shrink-0", TONE_TEXT.ok)} aria-label="Costed" />
                            : <span className="h-3 w-3 flex-shrink-0 rounded-full border-2 border-amber-500" aria-label="Pending" />
                          }
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {plan.finished_code && <span className="font-mono">{plan.finished_code} · </span>}
                          {fmtDate(plan.dated)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Yield: <strong className="tabular-nums text-foreground">{fmtQty(plan.actual_production_qty || plan.actual_yield || plan.planned_qty)}</strong> {plan.unit}
                          {plan.actual_production_qty > 0 && (
                            <span className={cn("ml-1 text-[10px] font-semibold", TONE_TEXT.ok)}>(T8)</span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {itype && <ItemTypeBadge type={itype} />}
                          {plan.is_costed && plan.cost_entry && (
                            <span className="text-[11px] font-semibold tabular-nums text-foreground">
                              {fmt(plan.cost_entry.cost_per_unit)}/unit
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Orphan productions are integrated into the plans list above as is_orphan rows */}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-shrink-0 items-center justify-between border-t border-border bg-muted/30 px-3 py-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                aria-label="Previous page"
                onClick={() => changePage(page - 1)}
                disabled={page <= 1 || loadingList}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                Page {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                aria-label="Next page"
                onClick={() => changePage(page + 1)}
                disabled={page >= totalPages || loadingList}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </section>

        {/* RIGHT: Detail panel */}
        <div className="min-w-0 space-y-4">
          {!selectedPlan && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background px-6 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Calculator className="h-6 w-6 text-primary" />
                </span>
                <p className="text-base font-semibold text-foreground">Select a production order to preview its cost</p>
                <p className="text-sm text-muted-foreground">Click any item in the list, or use Auto-Cost to process all in sequence</p>
              </div>

              {/* Prerequisites checklist */}
              <LabCard title="Costing Prerequisites" subtitle="Must complete in order" icon={Info}>
                <ol className="divide-y divide-border">
                  {[
                    {
                      step: "1",
                      title: "Calculate Opening Stock",
                      desc: "Run from Costing Hub before costing any plan. Without this, material rates fall back to purchase averages which may be incorrect.",
                      action: "Costing Hub → Calc Opening Stock",
                    },
                    {
                      step: "2",
                      title: "Cost Semi-Finished L1 (consume only Raw Materials)",
                      desc: "These must be costed first — they are inputs to higher-level assemblies.",
                      action: "Auto-Cost Pending will handle the order automatically",
                    },
                    {
                      step: "3–4",
                      title: "Cost Semi-Finished LN (consume other Semi-Finished)",
                      desc: "Mid-chain semi-finished goods. Their cost depends on L1 semi-finished being costed first.",
                      action: "Auto-sequenced — costed after their dependencies",
                    },
                    {
                      step: "5",
                      title: "Remaining Semi-Finished (no BOM defined)",
                      desc: "Semi-finished items consumed by other plans but without a BOM. Flag these for review.",
                      action: "Define a BOM or record a manual cost",
                    },
                    {
                      step: "6",
                      title: "Finished Goods (including Mixed)",
                      desc: "Final products. Theoretical cost = sum of all BOM inputs. Actual cost from tran_code=7 issuances linked via rmk5.",
                      action: "Costed last — all inputs already available",
                    },
                  ].map((item) => (
                    <li key={item.step} className="flex items-start gap-3 px-4 py-3">
                      <span className="flex h-7 min-w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-bold text-primary">
                        {item.step}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground">{item.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{item.desc}</div>
                        <div className="mt-0.5 text-[11px] italic text-muted-foreground">{item.action}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </LabCard>

              {summary.not_costed > 0 && (
                <Note tone="warn" icon={AlertTriangle} title={`${summary.not_costed} plan(s) not yet costed this period.`}>
                  Use "Auto-Cost Pending" to process them all in the correct dependency order.
                </Note>
              )}
            </div>
          )}

          {/* ── Orphan T8 receipt detail (no Posted plan linked) ── */}
          {selectedPlan?.is_orphan && (
            <LabCard
              icon={selectedPlan.on_dispatch ? Truck : AlertTriangle}
              title={selectedPlan.finished_item}
              subtitle={
                selectedPlan.on_dispatch ? (
                  <>
                    {itemEngine ? "Produced on dispatch — costed from its own BOM issue" : "Produced on dispatch"}
                    <span className="ml-1">({selectedPlan.dispatch_count} dispatch{selectedPlan.dispatch_count === 1 ? "" : "es"})</span>
                  </>
                ) : (
                  <>
                    Production Receipt — No Posted Plan
                    {selectedPlan.tran_count > 1 && <span className="ml-1">({selectedPlan.tran_count} T8 vouchers grouped)</span>}
                  </>
                )
              }
              actions={
                selectedPlan.is_costed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => openRateDialog({
                      finished_id:    selectedPlan.finished_id,
                      finished_item:  selectedPlan.finished_item,
                      total_qty:      selectedPlan.actual_production_qty,
                      unit:           selectedPlan.unit,
                      effective_rate: selectedPlan.cost_entry?.cost_per_unit || 0,
                    })}
                  >
                    <Edit className="mr-1 h-3.5 w-3.5" />Edit Rate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => openRateDialog({
                      finished_id:    selectedPlan.finished_id,
                      finished_item:  selectedPlan.finished_item,
                      total_qty:      selectedPlan.actual_production_qty,
                      unit:           selectedPlan.unit,
                      effective_rate: 0,
                    })}
                  >
                    <DollarSign className="mr-1 h-3.5 w-3.5" />Set Rate
                  </Button>
                )
              }
              bodyClassName="space-y-4 p-4"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label="Transaction"><span className="font-mono">T#{selectedPlan.tran_id}</span></Figure>
                <Figure label="Date">
                  <span className="text-sm">
                    {selectedPlan.tran_count > 1
                      ? `${fmtDate(selectedPlan.first_date)} – ${fmtDate(selectedPlan.last_date)}`
                      : fmtDate(selectedPlan.dated)}
                  </span>
                </Figure>
                <Figure label="Received Qty">{fmtQty(selectedPlan.actual_production_qty)} <span className="text-xs text-muted-foreground">{selectedPlan.unit}</span></Figure>
                <Figure label={selectedPlan.on_dispatch ? "Dispatches" : "T8 Receipts"}>
                  <span className="text-sm">
                    {selectedPlan.on_dispatch ? selectedPlan.dispatch_count : (selectedPlan.tran_count || 1)} voucher(s)
                  </span>
                </Figure>
              </div>

              {selectedPlan.on_dispatch && (
                <DispatchIssuance detail={dispatchDetail} loading={loadingDispatch} unit={selectedPlan.unit} />
              )}

              {selectedPlan.is_costed && selectedPlan.cost_entry && (
                <Note tone="ok" icon={CheckCircle2} title="Saved Cost Entry:">
                  <strong className="tabular-nums">{fmt(selectedPlan.cost_entry.cost_per_unit)}/unit</strong>
                  <span className="ml-2 tabular-nums">Total: {fmt(selectedPlan.cost_entry.total_cost)}</span>
                </Note>
              )}

              {selectedPlan.rmk5 && (
                <Note tone="warn" icon={AlertTriangle} title="rmk5:">
                  <span className="font-mono">{selectedPlan.rmk5}</span>
                  <span className="ml-2">— references a plan that does not exist or is not Posted.</span>
                </Note>
              )}

              {selectedPlan.on_dispatch ? (
                <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                  <p className="mb-1.5 text-xs font-semibold text-foreground">How this is costed</p>
                  <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    <li>Each dispatch made this item and issued its BOM materials at the same time — the two are linked automatically (same dispatch, same line).</li>
                    <li>The cost = those materials at the month rate (purchases + their services). No production plan is needed.</li>
                    <li><strong className="text-foreground">Re-Cost All</strong> works it out together with the process orders.</li>
                  </ul>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                  <p className="mb-1.5 text-xs font-semibold text-foreground">To get full BOM costing</p>
                  <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    <li>Make a <strong className="text-foreground">Process Order</strong> for this item and post its issue and production through it.</li>
                    <li>Until then, <strong className="text-foreground">Re-Cost All</strong> gives it a share of the month&apos;s issues not linked to any order.</li>
                    <li>Or use <strong className="text-foreground">Set Rate</strong> above to record the cost for this production by hand.</li>
                  </ul>
                </div>
              )}
            </LabCard>
          )}

          {selectedPlan && !selectedPlan.is_orphan && loadingCost && (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-44 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> Exploding BOM and computing costs…
              </p>
            </div>
          )}

          {selectedPlan && !loadingCost && costData && (
            <div className="space-y-4">

              {/* Plan header card */}
              <section className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/15 bg-primary/5 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-foreground">
                        {costData.finished_item || selectedPlan.finished_item}
                      </h2>
                      {costData.finished_code && <span className={CODE_CHIP}>{costData.finished_code}</span>}
                      {ce?.item_type && <ItemTypeBadge type={ce.item_type} />}
                      {costData.already_costed && (
                        <Chip tone="ok"><CheckCircle2 className="h-3 w-3" />Costed</Chip>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span>Order #<strong className="text-foreground">{costData.plan_id}</strong></span>
                      <span>Qty: <strong className="tabular-nums text-foreground">{fmtQty(costData.qty_costed)}</strong> {selectedPlan.unit}</span>
                      <span>Date: <strong className="text-foreground">{fmtDate(selectedPlan.dated)}</strong></span>
                      {selectedPlan.batch_no && <span>Batch: <strong className="text-foreground">{selectedPlan.batch_no}</strong></span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => loadCostPreview(selectedPlan)} className="h-9 bg-background">
                      <RefreshCw className="mr-1.5 h-4 w-4" />Preview
                    </Button>
                    <Button size="sm" onClick={saveCost} disabled={saving || summary.period_locked} className="h-9">
                      {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                      {costData.already_costed ? "Re-Save" : "Save Costing"}
                    </Button>
                    {costData.already_costed && (
                      <IconBtn
                        icon={Trash2}
                        label="Remove saved costing"
                        onClick={() => setConfirmDelete(true)}
                        className="hover:border-red-300 hover:text-red-700 dark:hover:text-red-300"
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  {/* Cost summary: theoretical vs actual */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Figure label="Theoretical (BOM)" hint={`${fmt(costData.cost_per_unit)}/unit`} tone="brand">
                      {fmt(costData.total_cost)}
                    </Figure>

                    {ce?.actual_issued_cost != null ? (
                      <>
                        <Figure label="Actual Issued" hint={`${fmt(ce.actual_cost_per_unit)}/unit`}>
                          {fmt(ce.actual_issued_cost)}
                        </Figure>
                        <Figure
                          label="Variance"
                          tone={ce.cost_variance > 0 ? "bad" : "ok"}
                          hint={ce.wastage_cost > 0 ? <span className={TONE_TEXT.warn}>Wastage: {fmt(ce.wastage_cost)}</span> : undefined}
                        >
                          <VarianceCell value={ce.cost_variance} />
                        </Figure>
                      </>
                    ) : (
                      <div className={cn("col-span-2 rounded-lg p-3", CHIP.warn)}>
                        <div className="text-[11px] font-semibold uppercase tracking-wide">Actual Issuances (tran_code=7)</div>
                        <div className="mt-1 flex items-start gap-1.5 text-xs">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                          <span>
                            No material issuance vouchers found linked to this plan.
                            Cost will be saved as <strong>theoretical only</strong> (BOM qty × opening rate).
                            <span className="mt-0.5 block text-[11px] opacity-90">
                              To record actual cost: post tran_code=7 issuance vouchers and set <strong>rmk5 = {selectedPlan?.id}</strong> on them.
                            </span>
                          </span>
                        </div>
                      </div>
                    )}

                    <Figure label="Missing Costs" tone={costData.missing_cost_items > 0 ? "bad" : "ok"}>
                      <span className={costData.missing_cost_items > 0 ? TONE_TEXT.bad : TONE_TEXT.ok}>
                        {costData.missing_cost_items} item{costData.missing_cost_items !== 1 ? "s" : ""}
                      </span>
                    </Figure>
                  </div>

                  {costData.missing_cost_items > 0 && (() => {
                    const missingMats = (costData.raw_materials || []).filter(r => r.cost_source === "not_found");
                    return (
                      <div className="overflow-hidden rounded-lg border border-border">
                        <div className={cn("flex items-center gap-2 px-3 py-2 text-xs font-semibold", CHIP.warn)}>
                          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                          {costData.missing_cost_items} material(s) have NO cost data — costing will be inaccurate
                        </div>
                        <div className="space-y-1 px-3 py-2">
                          {missingMats.slice(0, 8).map((m, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-foreground">
                              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                              <span className="font-medium">{m.material_name}</span>
                              {m.material_code && <span className={cn(CODE_CHIP, "text-[10.5px]")}>{m.material_code}</span>}
                              <span className="text-muted-foreground sm:ml-auto">→ Set opening stock or add a purchase transaction</span>
                            </div>
                          ))}
                          {missingMats.length > 8 && (
                            <div className="text-[11px] text-muted-foreground">…and {missingMats.length - 8} more</div>
                          )}
                          <div className="mt-1.5 border-t border-border pt-1.5 text-[11px] text-muted-foreground">
                            <strong className="text-foreground">Fix:</strong> Go to Costing Hub → "Calc Opening Stock" to recalculate opening rates, then re-preview this plan.
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Saved entry info */}
                  {costData.already_costed && ce && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      <Info className="h-4 w-4 flex-shrink-0" />
                      Last costed <strong className="text-foreground">{fmtDate(ce.calculated_at)}</strong> by <strong className="text-foreground">{ce.calculated_by || "system"}</strong>
                      {ce.item_type && <> · Type: <ItemTypeBadge type={ce.item_type} /></>}
                    </div>
                  )}
                </div>
              </section>

              {/* ── Costing Audit Panel ─────────────────────────────────────── */}
              <LabCard title="Costing Audit — What We Calculated & Why" icon={ClipboardCheck} bodyClassName="space-y-3 p-4">
                {/* QTY SOURCE */}
                <AuditBlock title="Production Quantity Source">
                  {(() => {
                    const src = costData?.qty_source;
                    const qty = costData?.qty_costed ?? 0;
                    const unit = selectedPlan?.unit;
                    if (src === "t8_receipt") return (
                      <Check tone="ok" title={`tran_code=8 receipt qty used: ${fmtQty(qty)} ${unit ?? ""}`}>
                        {" "}— Actual quantity received into stock. Most accurate basis for BOM costing.
                      </Check>
                    );
                    if (src === "actual_yield") return (
                      <Check tone="warn" title={`actual_yield from plan: ${fmtQty(qty)} ${unit ?? ""}`}>
                        {" "}— No T8 receipt linked this month. Post a T8 voucher with rmk5={selectedPlan?.id} for exact qty.
                      </Check>
                    );
                    if (src === "planned_qty") return (
                      <Check tone="bad" title={`Planned qty only: ${fmtQty(qty)} ${unit ?? ""}`}>
                        {" "}— No T8 receipt, no actual_yield. BOM is scaled to planned qty — cost may be inaccurate.
                      </Check>
                    );
                    return null;
                  })()}
                  {/* Show all three qty values so the user can compare */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>T8 received: <strong className={cn("tabular-nums", costData?.qty_t8 > 0 ? TONE_TEXT.ok : "")}>{fmtQty(costData?.qty_t8 ?? 0)}</strong></span>
                    <span>actual_yield: <strong className={cn("tabular-nums", costData?.qty_actual_yield > 0 ? TONE_TEXT.warn : "")}>{fmtQty(costData?.qty_actual_yield ?? 0)}</strong></span>
                    <span>planned: <strong className="tabular-nums">{fmtQty(costData?.qty_planned ?? 0)}</strong></span>
                    <span className="font-semibold text-primary">→ BOM costed at: <span className="tabular-nums">{fmtQty(costData?.qty_costed ?? 0)}</span></span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    BOM material quantities are proportional (%) — they scale to whatever qty is used above.
                  </div>
                </AuditBlock>

                {/* BOM STATUS */}
                <AuditBlock title="BOM Explosion (Theoretical Cost)">
                  {costData?.raw_materials?.length > 0 ? (
                    <>
                      <Check tone="ok" title={`${costData.raw_materials.length} material(s) found in BOM`}>
                        {" "}— Theoretical cost = BOM qty × material avg rate.
                      </Check>
                      {(() => {
                        const mats = costData.raw_materials || [];
                        const bySource = mats.reduce((acc, m) => { acc[m.cost_source] = (acc[m.cost_source] || 0) + 1; return acc; }, {});
                        return (
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(bySource).map(([src, cnt]) => (
                              <span key={src} className="flex items-center gap-1 text-[11px]">
                                <CostSourceBadge source={src} />
                                <span className="tabular-nums text-muted-foreground">×{cnt}</span>
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      {costData.missing_cost_items > 0 && (
                        <div className={cn("flex items-start gap-2 rounded-md p-2 text-xs", CHIP.bad)}>
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                          <span><strong>{costData.missing_cost_items} material(s) have no cost rate</strong> — theoretical cost is understated.
                            Fix: Run Opening Stock calculation from Costing Hub.</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <Check tone="bad" title="No active BOM found">
                      {" "}— Cannot compute theoretical cost. Create a BOM with instructions=&quot;A&quot; for this item.
                    </Check>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    Theoretical total: <strong className="tabular-nums text-primary">{fmt(costData?.total_cost)}</strong>
                    &nbsp;·&nbsp; Per unit: <strong className="tabular-nums text-primary">{fmt(costData?.cost_per_unit)}</strong>
                  </div>
                </AuditBlock>

                {/* ISSUANCES (T7) STATUS */}
                <AuditBlock title="Actual Issuances — tran_code=7">
                  {loadingActivity ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                    </div>
                  ) : activityData?.t7_summary?.material_count > 0 ? (
                    <>
                      <Check tone="ok" title={`${activityData.t7_summary.material_count} material(s) issued`}>
                        {" "}— Linked via rmk5={selectedPlan?.id} on the issuance voucher.
                      </Check>
                      <div className="text-[11px] text-muted-foreground">
                        Total issued qty: <strong className="tabular-nums text-foreground">{fmtQty(activityData.t7_summary.total_qty)}</strong>
                        &nbsp;·&nbsp; Valued at: <strong className="tabular-nums text-foreground">{fmt(activityData.t7_summary.total_cost)}</strong>
                      </div>
                      {costData?.raw_materials?.length > 0 && (() => {
                        const bomMats = new Set((costData.raw_materials || []).map(m => m.material_id));
                        const t7Mats  = new Set((activityData.t7_summary.materials || []).map(m => m.itcd));
                        const notInBOM = [...t7Mats].filter(id => !bomMats.has(id)).length;
                        const notIssued = [...bomMats].filter(id => !t7Mats.has(id)).length;
                        return notInBOM > 0 || notIssued > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {notInBOM > 0 && (
                              <Chip tone="warn">{notInBOM} issued but NOT in BOM (unexpected consumption)</Chip>
                            )}
                            {notIssued > 0 && (
                              <Chip tone="muted">{notIssued} BOM material(s) not issued yet</Chip>
                            )}
                          </div>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    <Check tone="warn" title="No issuances found for this plan">
                      {" "}— Cost will be theoretical only. Make sure tran_code=7 vouchers have rmk5={selectedPlan?.id}.
                    </Check>
                  )}
                </AuditBlock>

                {/* WHAT WAS DONE summary */}
                <div className="rounded-lg bg-muted/60 p-3">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What Was Calculated</div>
                  <ul className="space-y-1 text-xs text-foreground">
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                      <span><strong>Theoretical</strong> = BOM explosion × production qty → <strong className="tabular-nums text-primary">{fmt(costData?.total_cost)}</strong></span>
                    </li>
                    {(activityData?.t7_summary?.total_cost ?? 0) > 0 && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2f5139] dark:bg-emerald-400" />
                        <span><strong>Actual</strong> = Σ tran_code=7 issuances valued at opening stock rates → <strong className="tabular-nums">{fmt(activityData.t7_summary.total_cost)}</strong></span>
                      </li>
                    )}
                    {ce?.cost_variance != null && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                        <span><strong>Variance</strong> = Actual − Theoretical = <VarianceCell value={ce.cost_variance} />
                          {ce.cost_variance > 0 ? " (over-issued / wastage)" : ce.cost_variance < 0 ? " (under-issued)" : " (exact)"}
                        </span>
                      </li>
                    )}
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground" />
                      <span><strong>Saved cost/unit</strong> = {
                        ce
                          ? (ce.actual_cost_per_unit != null ? "Actual" : "Theoretical")
                          : ((activityData?.t7_summary?.total_cost ?? 0) > 0 ? "Actual" : "Theoretical")
                      } ÷ qty = <strong className="tabular-nums">{fmt(ce?.cost_per_unit ?? costData?.cost_per_unit)}</strong></span>
                    </li>
                  </ul>
                </div>
              </LabCard>

              {/* ── T8/T7 Production Activity ─────────────────────────────────── */}
              <LabCard title="Production Activity — tran_code=7 & 8" icon={Activity} bodyClassName="space-y-4 p-4">
                {loadingActivity ? (
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-1/2" />
                    <Skeleton className="h-24" />
                  </div>
                ) : (
                  <>
                    {/* T8: Production receipts */}
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <ArrowDownToLine className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">tran_code=8 — Production Receipts</span>
                        <span className="text-xs text-muted-foreground">(goods received into stock)</span>
                        {activityData?.t8_summary && (
                          <Chip tone={activityData.t8_summary.voucher_count > 0 ? "ok" : "warn"} className="ml-auto">
                            {activityData.t8_summary.voucher_count} voucher(s)
                          </Chip>
                        )}
                      </div>
                      {activityData?.item_frequency && (
                        <Note tone="muted" icon={BarChart3} className="mb-2 py-2 text-xs">
                          This item was produced <strong className="text-foreground">{activityData.item_frequency.voucher_count}</strong> time(s) this month across all plans,
                          total qty: <strong className="tabular-nums text-foreground">{fmtQty(activityData.item_frequency.total_qty)}</strong> {selectedPlan?.unit}
                        </Note>
                      )}
                      {activityData?.t8_summary?.vouchers?.length > 0 ? (
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <table className="w-full min-w-[360px] text-xs">
                            <thead>
                              <tr>
                                <th className={cn(TH, "text-[11px]")}>Date</th>
                                <th className={cn(TH, "text-right text-[11px]")}>Voucher #</th>
                                <th className={cn(TH, "text-right text-[11px]")}>Qty Received</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activityData.t8_summary.vouchers.map((v, i) => (
                                <tr key={i} className="border-b border-border hover:bg-muted/40">
                                  <td className="px-3 py-2 text-foreground">{fmtDate(v.dated)}</td>
                                  <td className="px-3 py-2 text-right">{v.vr_no != null ? <span className={CODE_CHIP}>{v.vr_no}</span> : "—"}</td>
                                  <td className={cn("px-3 py-2 font-semibold text-foreground", NUM)}>{fmtQty(v.qty)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className={TOTAL_ROW}>
                                <td colSpan={2} className="px-3 py-2 text-right">Total Received</td>
                                <td className={cn("px-3 py-2", NUM)}>{fmtQty(activityData.t8_summary.total_qty)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <Note tone="warn" icon={AlertTriangle} className="py-2 text-xs">
                          No tran_code=8 receipt found for this plan. Set rmk5={selectedPlan?.id} on the production entry voucher.
                        </Note>
                      )}
                    </div>

                    {/* T7: Material issuances */}
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <ArrowUpFromLine className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">tran_code=7 — Material Issuances</span>
                        <span className="text-xs text-muted-foreground">(consumed from stock)</span>
                        {activityData?.t7_summary && (
                          <Chip tone={activityData.t7_summary.material_count > 0 ? "brand" : "warn"} className="ml-auto">
                            {activityData.t7_summary.material_count} material(s)
                          </Chip>
                        )}
                      </div>
                      {activityData?.t7_summary?.materials?.length > 0 ? (
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <table className="w-full min-w-[480px] text-xs">
                            <thead>
                              <tr>
                                <th className={cn(TH, "text-[11px]")}>Material</th>
                                <th className={cn(TH, "text-right text-[11px]")}>Qty Issued</th>
                                <th className={cn(TH, "text-right text-[11px]")}>Rate</th>
                                <th className={cn(TH, "text-right text-[11px]")}>Issued Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activityData.t7_summary.materials.map((m, i) => (
                                <tr key={i} className="border-b border-border hover:bg-muted/40">
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-foreground">{m.item_name}</div>
                                    {m.item_code && <span className={cn(CODE_CHIP, "text-[10.5px]")}>{m.item_code}</span>}
                                  </td>
                                  <td className={cn("px-3 py-2", NUM)}>{fmtQty(m.total_qty)} <span className="text-muted-foreground">{m.unit}</span></td>
                                  <td className={cn("px-3 py-2", NUM)}>{fmt(m.unit_cost)}</td>
                                  <td className={cn("px-3 py-2 font-semibold text-foreground", NUM)}>{fmt(m.total_cost)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className={TOTAL_ROW}>
                                <td colSpan={3} className="px-3 py-2 text-right">Total Issued Value</td>
                                <td className={cn("px-3 py-2", NUM)}>{fmt(activityData.t7_summary.total_cost)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <Note tone="warn" icon={AlertTriangle} className="py-2 text-xs">
                          No tran_code=7 issuances linked. Set rmk5={selectedPlan?.id} on material issue vouchers.
                        </Note>
                      )}
                    </div>
                  </>
                )}
              </LabCard>

              {/* Saved materials table (if costed — shows both theoretical and actual) */}
              {costData.already_costed && selectedPlan?.cost_entry && (
                <LabCard title="Material Cost Breakdown — Theoretical vs Actual" icon={Layers} bodyClassName="p-3">
                  <MaterialsTable items={mergedRawMaterials.length > 0 ? mergedRawMaterials : (selectedPlan.cost_entry?.details || costData.raw_materials)} />
                </LabCard>
              )}

              {/* BOM Tree */}
              <LabCard
                title="BOM Explosion Preview"
                icon={GitBranch}
                bodyClassName="p-3 sm:p-4"
              >
                <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-1 rounded bg-primary" /> Finished Good</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-1 rounded bg-amber-500" /> Semi-Finished (from ProductionCostEntry)</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-1 rounded bg-muted-foreground" /> Sub-assembly</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-1 rounded bg-[#2f5139] dark:bg-emerald-400" /> Raw Material (costed)</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-1 rounded bg-red-600" /> Raw Material (no cost)</span>
                </div>
                {bomTree
                  ? <BOMNode node={bomTree} isRoot={true} />
                  : <LabEmpty
                      icon={GitBranch}
                      title="No BOM materials found for this plan"
                      hint="Add materials to the Production Plan Detail to see the explosion tree"
                    />
                }
              </LabCard>

              {/* Raw materials flat table — only shown before costing; once costed, Material Cost Breakdown above covers this */}
              {costData.raw_materials?.length > 0 && !costData.already_costed && (
                <LabCard title="Raw Materials Summary (BOM Preview)" icon={Package} bodyClassName="p-3">
                  <MaterialsTable items={mergedRawMaterials} />
                </LabCard>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Set Rate dialog (orphan PCE) ────────────────────────────────────── */}
      <Dialog open={!!rateDialog} onOpenChange={(o) => { if (!o) closeRateDialog(); }}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          {rateDialog && (
            <>
              <DialogHeader className={cn(DIALOG_HEAD, "pr-12 text-left")}>
                <DialogDescription className="text-xs">Set Production Cost Rate — Orphan Receipt</DialogDescription>
                <DialogTitle className="text-base">{rateDialog.finished_item}</DialogTitle>
                <p className="text-[11px] text-muted-foreground">
                  {rateDialog.finished_code && <span className="font-mono">{rateDialog.finished_code} · </span>}
                  {MONTHS[month - 1]} {year}
                </p>
              </DialogHeader>

              <div className={cn(DIALOG_BODY, "space-y-4")}>
                {/* T8 + T7 info grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-muted p-3">
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">T8 Receipts (period)</p>
                    <p className="font-semibold tabular-nums text-foreground">{fmtQty(rateDialog.total_qty)} {rateDialog.unit}</p>
                    {t7Suggestion && <p className="mt-0.5 text-[11px] text-muted-foreground">{t7Suggestion.t8_tran_count} voucher(s)</p>}
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Current Applied Rate</p>
                    <p className={cn("font-semibold tabular-nums", rateDialog.effective_rate > 0 ? "text-primary" : TONE_TEXT.bad)}>
                      {rateDialog.effective_rate > 0 ? fmt(rateDialog.effective_rate) : "No cost"}
                    </p>
                    {rateDialog.effective_rate_source && rateDialog.effective_rate_source !== "no_cost" && (
                      <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">{rateDialog.effective_rate_source.replace(/_/g, " ")}</p>
                    )}
                  </div>
                </div>

                {/* T7 suggestion box */}
                {loadingT7 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                    Loading T7 issuances…
                  </div>
                ) : t7Suggestion?.suggested_rate > 0 ? (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Activity className="h-3.5 w-3.5 text-primary" />
                        Rate from T7 Issuances
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => setRateInput(String(t7Suggestion.suggested_rate.toFixed(4)))}
                      >
                        Use This Rate
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <p className="text-muted-foreground">T7 Total Damt</p>
                        <p className="font-semibold tabular-nums text-foreground">{fmt(t7Suggestion.t7_total_damt)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">T7 Issued Qty</p>
                        <p className="font-semibold tabular-nums text-foreground">{fmtQty(t7Suggestion.t7_total_qty)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">÷ T8 Qty</p>
                        <p className="font-semibold tabular-nums text-foreground">{fmtQty(t7Suggestion.t8_total_qty)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                      <span className="text-[11px] text-muted-foreground">{t7Suggestion.suggestion_basis}</span>
                      <span className="text-sm font-bold tabular-nums text-primary">= {fmt(t7Suggestion.suggested_rate)} / unit</span>
                    </div>
                  </div>
                ) : t7Suggestion && t7Suggestion.t7_total_damt === 0 ? (
                  <Note tone="warn" icon={AlertTriangle} className="py-2 text-xs">
                    {t7Suggestion.suggestion_basis}. Enter rate manually.
                  </Note>
                ) : null}

                {/* Rate input */}
                <div>
                  <label htmlFor="orphan-rate" className="mb-1.5 block text-xs font-medium text-foreground">
                    Cost per unit <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="orphan-rate"
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    placeholder="Enter cost per unit…"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveOrphanRate()}
                    className="h-10 text-right text-sm tabular-nums"
                    autoFocus
                  />
                  {parseFloat(rateInput) > 0 ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Total value:{" "}
                      <strong className="tabular-nums text-primary">{fmt(parseFloat(rateInput) * rateDialog.total_qty)}</strong>
                      {" "}= {fmtQty(rateDialog.total_qty)} × {fmt(parseFloat(rateInput))}
                    </p>
                  ) : rateInput !== "" ? (
                    <p className="mt-1.5 text-xs text-destructive">Enter a valid rate &gt; 0</p>
                  ) : null}
                </div>

                <p className="rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                  This rate will be saved as a cost entry for <strong className="text-foreground">{MONTHS[month - 1]} {year}</strong> and used in stock valuation reports.
                </p>
              </div>

              <div className={DIALOG_FOOT}>
                <Button variant="outline" size="sm" onClick={closeRateDialog} className="h-9">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-9"
                  onClick={saveOrphanRate}
                  disabled={savingRate || !(parseFloat(rateInput) > 0)}
                >
                  {savingRate ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  Save Rate
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Remove saved costing (confirm) ─────────────────────────────────── */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove saved costing?</AlertDialogTitle>
            <AlertDialogDescription>
              The cost entry for {costData?.finished_item || selectedPlan?.finished_item || "this plan"} will be removed.
              You can cost it again with Save Costing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmDelete(false); if (selectedPlan) deleteCostEntry(selectedPlan.id); }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CostingFrame>
  );
}
