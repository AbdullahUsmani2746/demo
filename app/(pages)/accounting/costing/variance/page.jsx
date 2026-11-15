"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Info,
  ArrowLeft,
  Layers,
  Package,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LabHeader, LabCard, LabStat, LabEmpty, Chip, CODE_CHIP, TH, TD, NUM, TOTAL_ROW,
} from "@/components/Material/shared/LabUI";
import {
  CostingFrame, PeriodPicker, SearchBox, Segmented, Signed, Note, SkeletonRows, IconBtn, varianceTone, TONE_TEXT,
} from "@/components/Costing/CostingUI";

// ── Constants ─────────────────────────────────────────────────────────────────
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

function formatCurrency(v) {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
}
function formatQty(v) {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v || 0);
}
function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Variance status config ────────────────────────────────────────────────────
const STATUS_CFG = {
  over_issued:  { label: "Over Issued",  icon: TrendingUp,    tone: "bad" },
  under_issued: { label: "Under Issued", icon: TrendingDown,  tone: "warn" },
  not_issued:   { label: "Not Issued",   icon: AlertTriangle, tone: "warn" },
  not_in_bom:   { label: "Not in BOM",   icon: Info,          tone: "brand" },
  match:        { label: "Match",        icon: CheckCircle2,  tone: "ok" },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.match;
  const Icon = cfg.icon;
  return (
    <Chip tone={cfg.tone} className="whitespace-nowrap">
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Chip>
  );
}

// Pinned identity column (product) while the figures scroll sideways.
const PIN = "sticky left-0 z-[1] bg-background";

// ── Production Plan Row ────────────────────────────────────────────────────────
function PlanRow({ plan }) {
  const [expanded, setExpanded] = useState(false);

  const hasIssues = plan.over_issued_count > 0 || plan.not_issued_count > 0 || plan.not_in_bom_count > 0;

  return (
    <>
      <tr
        className={cn(
          "group cursor-pointer border-b border-border transition-colors hover:bg-muted/40",
          expanded && "bg-primary/[0.03]",
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <td className={cn(TD, PIN, "w-10 pr-0 group-hover:bg-muted")}>
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", expanded ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        </td>
        <td className={cn(TD, PIN, "left-10 min-w-[200px] group-hover:bg-muted")}>
          <div className="flex items-center gap-1.5">
            {!plan.is_costed ? (
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" title="Not costed" />
            ) : hasIssues ? (
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" title="Has issues" />
            ) : null}
            <span className="font-medium text-foreground">{plan.finished_item}</span>
          </div>
          {plan.finished_code && <span className={cn(CODE_CHIP, "mt-1 inline-block text-[11px]")}>{plan.finished_code}</span>}
        </td>
        <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{formatDate(plan.dated)}</td>
        <td className={cn(TD, NUM, "whitespace-nowrap")}>
          {formatQty(plan.qty_produced)} <span className="text-xs text-muted-foreground">{plan.unit}</span>
        </td>
        <td className={cn(TD, "text-center")}>
          {plan.is_costed
            ? <Chip tone="ok"><CheckCircle2 className="h-3 w-3" />Costed</Chip>
            : <Chip tone="warn">Not Costed</Chip>}
        </td>
        <td className={cn(TD, NUM)}>{formatCurrency(plan.bom_total_cost)}</td>
        <td className={cn(TD, NUM)}>{formatCurrency(plan.actual_total_cost)}</td>
        <td className={cn(TD, NUM)}>
          <Signed value={plan.cost_variance} format={formatCurrency} />
        </td>
        <td className={TD}>
          <div className="flex flex-wrap justify-end gap-1">
            {plan.over_issued_count > 0 && <Chip tone="bad">{plan.over_issued_count} over</Chip>}
            {plan.under_issued_count > 0 && <Chip tone="warn">{plan.under_issued_count} under</Chip>}
            {plan.not_issued_count > 0 && <Chip tone="warn">{plan.not_issued_count} missing</Chip>}
            {plan.not_in_bom_count > 0 && <Chip tone="brand">{plan.not_in_bom_count} extra</Chip>}
            {plan.match_count > 0 && plan.over_issued_count === 0 && plan.not_issued_count === 0 && (
              <Chip tone="ok">All match</Chip>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border">
          <td colSpan={9} className="bg-muted/30 p-0">
            <div className="space-y-3 px-3 py-3 sm:px-6">
              {!plan.is_costed && (
                <Note tone="warn" icon={AlertTriangle}>
                  This production order has not been costed yet. BOM expected quantities will be zero. Run production costing first for accurate variance.
                </Note>
              )}

              <div className="overflow-x-auto rounded-lg border border-border bg-background">
                <table className="w-full min-w-[880px] text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left font-semibold">Material</th>
                      <th className="px-3 py-2 text-right font-semibold">BOM Expected Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Actual Issued Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Variance Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Variance %</th>
                      <th className="px-3 py-2 text-right font-semibold">Unit Cost</th>
                      <th className="px-3 py-2 text-right font-semibold">BOM Cost</th>
                      <th className="px-3 py-2 text-right font-semibold">Actual Cost</th>
                      <th className="px-3 py-2 text-right font-semibold">Cost Variance</th>
                      <th className="px-3 py-2 text-center font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.materials.map((m, idx) => {
                      const qtyTone = varianceTone(m.variance_qty, 0.001);
                      return (
                        <tr key={idx} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-1.5">
                            <div className="font-medium text-foreground">{m.item_name}</div>
                            {m.item_code && <span className={cn(CODE_CHIP, "text-[10.5px]")}>{m.item_code}</span>}
                          </td>
                          <td className={cn("px-3 py-1.5", NUM)}>{formatQty(m.bom_expected_qty)}</td>
                          <td className={cn("px-3 py-1.5", NUM)}>{formatQty(m.actual_issued_qty)}</td>
                          <td className={cn("px-3 py-1.5", NUM)}>
                            <Signed value={m.variance_qty} format={formatQty} eps={0.001} />
                          </td>
                          <td className={cn("px-3 py-1.5", NUM, TONE_TEXT[qtyTone])}>
                            {m.bom_expected_qty > 0 ? `${m.variance_pct > 0 ? "+" : ""}${m.variance_pct.toFixed(1)}%` : "—"}
                          </td>
                          <td className={cn("px-3 py-1.5", NUM)}>{formatCurrency(m.unit_cost)}</td>
                          <td className={cn("px-3 py-1.5", NUM)}>{formatCurrency(m.bom_expected_cost)}</td>
                          <td className={cn("px-3 py-1.5", NUM)}>{formatCurrency(m.actual_issued_cost)}</td>
                          <td className={cn("px-3 py-1.5", NUM)}>
                            <Signed value={m.cost_variance} format={formatCurrency} eps={0.01} />
                          </td>
                          <td className="px-3 py-1.5 text-center"><StatusBadge status={m.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className={TOTAL_ROW}>
                      <td className="px-3 py-2 text-right" colSpan={6}>Plan Total</td>
                      <td className={cn("px-3 py-2", NUM)}>{formatCurrency(plan.bom_total_cost)}</td>
                      <td className={cn("px-3 py-2", NUM)}>{formatCurrency(plan.actual_total_cost)}</td>
                      <td className={cn("px-3 py-2", NUM)}>
                        <Signed value={plan.cost_variance} format={formatCurrency} />
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function VariancePage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | issues | match | not_costed

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/costing/variance?month=${month}&year=${year}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const results = data?.results || [];
  const summary = data?.summary || {};

  const searchLow = search.toLowerCase();
  const filtered = results.filter((r) => {
    const matchSearch = !searchLow || r.finished_item.toLowerCase().includes(searchLow) || r.finished_code?.toLowerCase().includes(searchLow);
    const matchFilter =
      filter === "all" ||
      (filter === "issues" && (r.over_issued_count > 0 || r.not_issued_count > 0 || r.not_in_bom_count > 0)) ||
      (filter === "match" && r.match_count > 0 && r.over_issued_count === 0 && r.not_issued_count === 0) ||
      (filter === "not_costed" && !r.is_costed);
    return matchSearch && matchFilter;
  });

  const totalVariance = filtered.reduce((s, r) => s + r.cost_variance, 0);

  return (
    <CostingFrame>
      <LabHeader
        icon={BarChart3}
        breadcrumb="Costing"
        title="Issuance vs BOM Variance"
        subtitle="BOM expected consumption vs actual material issued per production order"
        actions={
          <>
            <Link href="/accounting/costing" className="max-sm:!flex-none">
              <IconBtn icon={ArrowLeft} label="Back to Costing" />
            </Link>
            <PeriodPicker month={month} year={year} years={YEARS} onMonth={setMonth} onYear={setYear} />
            <IconBtn icon={RefreshCw} label="Refresh" onClick={fetchData} disabled={loading} spin={loading} className="max-sm:!flex-none" />
          </>
        }
      />

      {/* KPI row */}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
          <LabStat label="Total Plans" value={summary.total_plans} icon={Layers} />
          <LabStat label="BOM Expected Cost" value={formatCurrency(summary.total_bom_cost)} icon={Scale} />
          <LabStat label="Actual Issued Cost" value={formatCurrency(summary.total_actual_cost)} icon={Package} />
          <LabStat
            label="Net Cost Variance"
            value={<Signed value={summary.total_cost_variance} format={formatCurrency} className="font-semibold" />}
            hint={summary.total_cost_variance > 0 ? "Issued more than BOM" : summary.total_cost_variance < 0 ? "Issued less than BOM" : "On BOM"}
            icon={summary.total_cost_variance > 0 ? TrendingUp : TrendingDown}
            tone={varianceTone(summary.total_cost_variance) === "muted" ? "brand" : varianceTone(summary.total_cost_variance)}
          />
          {summary.plans_with_over_issue > 0 && (
            <LabStat label="Plans with Over-Issue" value={summary.plans_with_over_issue} icon={TrendingUp} tone="bad" />
          )}
          {summary.plans_with_missing_issue > 0 && (
            <LabStat label="Plans with Missing Issue" value={summary.plans_with_missing_issue} icon={AlertTriangle} tone="warn" />
          )}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-background">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search product…" className="min-w-[200px] sm:max-w-sm" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { key: "all", label: "All" },
              { key: "issues", label: "Has Issues" },
              { key: "match", label: "Match" },
              { key: "not_costed", label: "Not Costed" },
            ]}
          />
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {filtered.length} of {results.length} plans
          </span>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr>
                <th className={cn(TH, "left-0 z-20 w-10")}></th>
                <th className={cn(TH, "left-10 z-20")}>Product</th>
                <th className={TH}>Date</th>
                <th className={cn(TH, "text-right")}>Qty Produced</th>
                <th className={cn(TH, "text-center")}>Costed</th>
                <th className={cn(TH, "text-right")}>BOM Cost</th>
                <th className={cn(TH, "text-right")}>Actual Cost</th>
                <th className={cn(TH, "text-right")}>Variance</th>
                <th className={cn(TH, "text-right")}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={9} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <LabEmpty
                      icon={BarChart3}
                      title="No production plans found for this period"
                      hint={results.length ? "Try clearing the search or filter." : "Pick another month, or post production orders first."}
                    />
                  </td>
                </tr>
              ) : (
                filtered.map((plan) => <PlanRow key={plan.plan_id} plan={plan} />)
              )}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className={cn(TOTAL_ROW, "bg-muted")}>
                  <td colSpan={5} className={cn(TD, "sticky left-0 bg-muted text-right")}>Totals</td>
                  <td className={cn(TD, NUM)}>{formatCurrency(filtered.reduce((s, r) => s + r.bom_total_cost, 0))}</td>
                  <td className={cn(TD, NUM)}>{formatCurrency(filtered.reduce((s, r) => s + r.actual_total_cost, 0))}</td>
                  <td className={cn(TD, NUM)}>
                    <Signed value={totalVariance} format={formatCurrency} />
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </CostingFrame>
  );
}
