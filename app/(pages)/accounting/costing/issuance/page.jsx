"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  RefreshCw,
  Package,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  ArrowLeft,
  Lock,
  Warehouse,
  Factory,
  ArrowRight,
  Clock,
  XCircle,
  Download,
  Layers,
  Scale,
  FileText,
} from "lucide-react";
import * as XLSX from "xlsx";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  LabHeader, LabCard, LabStat, LabEmpty, Chip, CODE_CHIP, CHIP, TH, TD, NUM, TOTAL_ROW,
} from "@/components/Material/shared/LabUI";
import {
  CostingFrame, PeriodPicker, SearchBox, Segmented, Note, SkeletonRows, IconBtn, MONTHS,
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

// ── Prerequisite Check Step ────────────────────────────────────────────────────
// status: 'checking' | 'done' | 'missing' | 'partial'
function PrereqStep({ step, icon: Icon, title, detail, status, actionLabel, actionHref }) {
  const isChecking = status === "checking";
  const isDone     = status === "done";
  const isMissing  = status === "missing";
  const isPartial  = status === "partial";

  const tone = isDone ? "ok" : isMissing ? "bad" : isPartial ? "warn" : "muted";
  const StatusIcon = isDone ? CheckCircle2 : isMissing ? XCircle : isPartial ? AlertTriangle : Clock;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-4">
      <div className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold", CHIP[tone])}>
        {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : isDone ? <CheckCircle2 className="h-4 w-4" /> : step}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {!isChecking && (
            <Chip tone={tone}>
              <StatusIcon className="h-3 w-3" />
              {isDone ? "Complete" : isMissing ? "Not done" : isPartial ? "Incomplete" : "Checking…"}
            </Chip>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
        {(isMissing || isPartial) && actionHref && (
          <Button asChild size="sm" className="mt-2.5 h-8">
            <Link href={actionHref}>
              {actionLabel} <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

const SRC = {
  opening_stock:          { label: "Opening Stock", tone: "ok" },
  weighted_avg:           { label: "Wtd Avg",       tone: "muted" },
  production_cost_entry:  { label: "Produced",      tone: "brand" },
  not_found:              { label: "No Cost",       tone: "bad" },
};
function CostSourceBadge({ source }) {
  const c = SRC[source] || { label: source || "—", tone: "muted" };
  return <Chip tone={c.tone} className="whitespace-nowrap">{c.label}</Chip>;
}

// ── Voucher Row (expandable) ──────────────────────────────────────────────────
function VoucherRow({ voucher }) {
  const [expanded, setExpanded] = useState(false);
  const hasNoCost = voucher.lines.some((l) => l.cost_source === "not_found");

  return (
    <>
      <tr
        className={cn("group cursor-pointer border-b border-border transition-colors hover:bg-muted/40", expanded && "bg-primary/[0.03]")}
        onClick={() => setExpanded(!expanded)}
      >
        <td className={cn(TD, "sticky left-0 z-[1] w-10 bg-background pr-0 group-hover:bg-muted")}>
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", expanded ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        </td>
        <td className={cn(TD, "sticky left-10 z-[1] bg-background group-hover:bg-muted")}>
          <span className={CODE_CHIP}>#{voucher.vr_no}</span>
        </td>
        <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{formatDate(voucher.dated)}</td>
        <td className={TD}>{voucher.godown_name || "—"}</td>
        <td className={cn(TD, "max-w-[220px] text-muted-foreground")}>
          <span className="line-clamp-1">{voucher.rmk || "—"}</span>
          {voucher.process_order_ref && (
            <span className={cn(CODE_CHIP, "mt-0.5 inline-block text-[10.5px]")}>PO#{voucher.process_order_ref}</span>
          )}
        </td>
        <td className={cn(TD, NUM, "text-muted-foreground")}>{voucher.lines.length}</td>
        <td className={cn(TD, NUM)}>{formatQty(voucher.total_qty)}</td>
        <td className={cn(TD, NUM, "font-semibold", hasNoCost ? "text-amber-700 dark:text-amber-300" : "text-foreground")}>
          {hasNoCost && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
          {formatCurrency(voucher.total_cost)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border">
          <td colSpan={8} className="bg-muted/30 px-3 py-3 sm:px-6">
            <div className="overflow-x-auto rounded-lg border border-border bg-background">
              <table className="w-full min-w-[620px] text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold">Material</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold">Unit Cost</th>
                    <th className="px-3 py-2 text-right font-semibold">Total Cost</th>
                    <th className="px-3 py-2 text-center font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {voucher.lines.map((line) => (
                    <tr
                      key={line.line_id}
                      className={cn("border-b border-border last:border-0", line.cost_source === "not_found" && "bg-red-50/60 dark:bg-red-950/20")}
                    >
                      <td className="px-3 py-1.5">
                        <div className="font-medium text-foreground">{line.item_name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {line.item_code && <span className={cn(CODE_CHIP, "text-[10.5px]")}>{line.item_code}</span>}
                          <span className="font-mono text-[10.5px] text-muted-foreground">#{line.itcd}</span>
                        </div>
                      </td>
                      <td className={cn("px-3 py-1.5", NUM)}>{formatQty(line.qty)} <span className="text-muted-foreground">{line.unit}</span></td>
                      <td className={cn("px-3 py-1.5", NUM)}>{formatCurrency(line.unit_cost)}</td>
                      <td className={cn("px-3 py-1.5 font-semibold", NUM, line.cost_source === "not_found" ? "text-red-700 dark:text-red-300" : "text-foreground")}>
                        {formatCurrency(line.total_cost)}
                      </td>
                      <td className="px-3 py-1.5 text-center"><CostSourceBadge source={line.cost_source} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={TOTAL_ROW}>
                    <td className="px-3 py-2 text-right" colSpan={3}>Voucher Total</td>
                    <td className={cn("px-3 py-2", NUM)}>{formatCurrency(voucher.total_cost)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function IssuanceCostingPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [search, setSearch] = useState("");
  const [view,   setView]   = useState("vouchers"); // vouchers | items

  // ── Prerequisite state ──────────────────────────────────────────────────────
  const [prereq,         setPrereq]         = useState(null);  // summary API response
  const [prereqLoading,  setPrereqLoading]  = useState(false);
  const [readyToLoad,    setReadyToLoad]    = useState(false); // user explicitly clicked "Load"

  // ── Issuance data ───────────────────────────────────────────────────────────
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  // ── Step 1: check prerequisites whenever month/year changes ────────────────
  const checkPrereqs = useCallback(async () => {
    setPrereqLoading(true);
    setPrereq(null);
    setData(null);
    setReadyToLoad(false);
    try {
      const res  = await fetch(`/api/costing/summary?month=${month}&year=${year}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load period status");
      setPrereq(json);
    } catch (err) {
      toast.error("Could not check period status: " + err.message);
    } finally {
      setPrereqLoading(false);
    }
  }, [month, year]);

  useEffect(() => { checkPrereqs(); }, [checkPrereqs]);

  // ── Derived prerequisite flags ──────────────────────────────────────────────
  const hasOpeningStock     = (prereq?.opening_stock_items ?? 0) > 0;
  const totalPlans          = prereq?.production_total_plans   ?? 0;
  const costedPlans         = prereq?.production_costed_plans  ?? 0;
  const hasProductionCosted = totalPlans === 0 || costedPlans >= totalPlans;
  const productionPartial   = totalPlans > 0 && costedPlans > 0 && costedPlans < totalPlans;
  const allPrereqsMet       = hasOpeningStock && hasProductionCosted;

  // ── Step 2: load issuance data (only when prerequisites are met) ────────────
  const fetchData = useCallback(async () => {
    if (!allPrereqsMet) return;
    setLoading(true);
    try {
      const res  = await fetch(`/api/costing/issuance?month=${month}&year=${year}&limit=2000`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [month, year, allPrereqsMet]);

  // Auto-load once prerequisites are confirmed and user triggers load
  useEffect(() => {
    if (readyToLoad && allPrereqsMet) fetchData();
  }, [readyToLoad, allPrereqsMet, fetchData]);

  // ── Filter ──────────────────────────────────────────────────────────────────
  const searchLow = search.toLowerCase();
  const filteredVouchers = (data?.vouchers || []).filter(
    (v) =>
      !searchLow ||
      v.godown_name?.toLowerCase().includes(searchLow) ||
      String(v.vr_no).includes(searchLow) ||
      v.rmk?.toLowerCase().includes(searchLow) ||
      v.lines.some(
        (l) =>
          l.item_name.toLowerCase().includes(searchLow) ||
          l.item_code?.toLowerCase().includes(searchLow) ||
          String(l.itcd).includes(searchLow)
      )
  );

  const filteredItems = (data?.item_summary || []).filter(
    (i) =>
      !searchLow ||
      i.item_name.toLowerCase().includes(searchLow) ||
      i.item_code?.toLowerCase().includes(searchLow) ||
      String(i.itcd).includes(searchLow)
  );

  const summary = data?.summary || {};

  // ── Excel Export ────────────────────────────────────────────────────────────
  const exportToExcel = () => {
    if (!data) return;

    const monthName = MONTHS[month - 1];

    // Sheet 1: Voucher Detail (all lines flattened)
    const voucherRows = [];
    (data.vouchers || []).forEach((v) => {
      v.lines.forEach((line) => {
        voucherRows.push({
          "Voucher #":     v.vr_no,
          "Date":          v.dated ? new Date(v.dated).toLocaleDateString("en-PK") : "",
          "Godown":        v.godown_name || "",
          "Remarks":       v.rmk || "",
          "PO Ref":        v.process_order_ref || "",
          "ITCD":          line.itcd,
          "Material Name": line.item_name,
          "Material Code": line.item_code || "",
          "Qty":           line.qty,
          "Unit":          line.unit || "",
          "Unit Cost":     line.unit_cost,
          "Total Cost":    line.total_cost,
          "Cost Source":   line.cost_source || "",
        });
      });
    });

    // Sheet 2: Item Summary
    const itemRows = (data.item_summary || []).map((item) => ({
      "ITCD":             item.itcd,
      "Material Name":    item.item_name,
      "Material Code":    item.item_code || "",
      "Voucher Count":    item.voucher_count,
      "Total Qty Issued": item.total_qty,
      "Unit":             item.unit || "",
      "Unit Cost":        item.unit_cost,
      "Total Cost":       item.total_cost,
      "Cost Source":      item.cost_source || "",
      "% of Total":       summary.total_cost > 0
                            ? parseFloat(((item.total_cost / summary.total_cost) * 100).toFixed(2))
                            : 0,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(voucherRows), "Voucher Detail");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), "Item Summary");

    XLSX.writeFile(wb, `Issuance_Costing_${monthName}_${year}.xlsx`);
  };

  // ── Opening step status ─────────────────────────────────────────────────────
  const openingStatus  = prereqLoading ? "checking"
                       : !prereq       ? "checking"
                       : hasOpeningStock ? "done" : "missing";

  const productionStatus = prereqLoading ? "checking"
                         : !prereq       ? "checking"
                         : hasProductionCosted ? "done"
                         : productionPartial   ? "partial"
                         : "missing";

  return (
    <CostingFrame>
      <LabHeader
        icon={Package}
        breadcrumb="Costing"
        title="Issuance Costing"
        subtitle={`Material issuances valued at blended cost rates — ${MONTHS[month - 1]} ${year}`}
        actions={
          <>
            <Link href="/accounting/costing" className="max-sm:!flex-none">
              <IconBtn icon={ArrowLeft} label="Back to Costing" />
            </Link>
            <PeriodPicker month={month} year={year} years={YEARS} onMonth={setMonth} onYear={setYear} />
            <IconBtn
              icon={RefreshCw}
              label="Re-check period status"
              onClick={() => { checkPrereqs(); }}
              disabled={prereqLoading}
              spin={prereqLoading}
              className="max-sm:!flex-none"
            />
            {data && (
              <>
                <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="h-9">
                  <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />
                  Refresh
                </Button>
                <Button size="sm" onClick={exportToExcel} className="h-9">
                  <Download className="mr-1.5 h-4 w-4" />
                  Export Excel
                </Button>
              </>
            )}
          </>
        }
      />

      {/* KPI row — only shown when data is loaded */}
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <LabStat label="Total Issuance Cost" value={formatCurrency(summary.total_cost)} icon={Scale} />
          <LabStat label="Vouchers" value={summary.voucher_count} icon={FileText} tone="muted" />
          <LabStat label="Materials" value={summary.item_count} icon={Layers} tone="muted" />
          <LabStat label="Total Qty Issued" value={formatQty(summary.total_qty)} icon={Package} tone="muted" />
          {summary.zero_cost_lines > 0 && (
            <LabStat
              label="Zero-Cost Lines"
              value={summary.zero_cost_lines}
              hint="No cost rate found for these items"
              icon={AlertTriangle}
              tone="bad"
            />
          )}
        </div>
      )}

      {/* ── PREREQUISITE GATE ──────────────────────────────────────────────── */}
      {!data && !(readyToLoad && loading) && (
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="text-center">
            <span className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-6 w-6 text-primary" />
            </span>
            <h2 className="text-lg font-semibold text-foreground">Complete prerequisite steps first</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Issuance costing requires accurate cost rates. Both steps below must be completed
              before issuance values will be correct.
            </p>
          </div>

          <div className="space-y-3">
            <PrereqStep
              step={1}
              icon={Warehouse}
              title="Calculate Opening Stock"
              detail={
                hasOpeningStock
                  ? `${prereq?.opening_stock_items ?? 0} items found in opening stock for ${MONTHS[month - 1]} ${year} — total value PKR ${formatCurrency(prereq?.opening_stock_value ?? 0)}.`
                  : `No opening stock records found for ${MONTHS[month - 1]} ${year}. Go to the Costing Hub and click "Calc Opening Stock" first.`
              }
              status={openingStatus}
              actionLabel="Go to Costing Hub"
              actionHref="/accounting/costing"
            />
            <PrereqStep
              step={2}
              icon={Factory}
              title="Run Production Costing"
              detail={
                totalPlans === 0
                  ? `No production orders found for ${MONTHS[month - 1]} ${year}. This step is not required.`
                  : hasProductionCosted
                  ? `All ${costedPlans} production order(s) have been costed for this period. Actual cost rates are available.`
                  : productionPartial
                  ? `${costedPlans} of ${totalPlans} production orders costed. Run production costing for the remaining ${totalPlans - costedPlans} order(s) before loading issuance. Semi-finished items will have wrong rates otherwise.`
                  : `${totalPlans} production order(s) exist for this period but none have been costed yet. Issuance valuation for produced items will be wrong without this step.`
              }
              status={productionStatus}
              actionLabel="Go to Production Costing"
              actionHref="/accounting/costing/production"
            />
          </div>

          {/* Action area */}
          {prereqLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Checking period status…</span>
            </div>
          ) : allPrereqsMet ? (
            <div className="rounded-xl border border-border bg-background p-5 text-center">
              <span className={cn("mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full", CHIP.ok)}>
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div className="mb-1 font-semibold text-foreground">All prerequisites complete</div>
              <div className="mb-4 text-sm text-muted-foreground">
                Opening stock and production costing are both done for {MONTHS[month - 1]} {year}.
                Issuance values will be accurate.
              </div>
              <Button onClick={() => setReadyToLoad(true)} className="px-6">
                <Package className="mr-2 h-4 w-4" />
                Load Issuance Costing
              </Button>
            </div>
          ) : (
            <Note tone="bad" icon={AlertTriangle} title="Prerequisites not met.">
              Complete the steps above before loading issuance costing. Loading without them
              will produce <strong>incorrect cost valuations</strong> for semi-finished
              and produced items.
              <span className="mt-3 flex flex-col gap-2 sm:flex-row">
                {!hasOpeningStock && (
                  <Button asChild variant="outline" size="sm" className="bg-background">
                    <Link href="/accounting/costing"><Warehouse className="mr-1.5 h-4 w-4" /> Calc Opening Stock</Link>
                  </Button>
                )}
                {!hasProductionCosted && (
                  <Button asChild variant="outline" size="sm" className="bg-background">
                    <Link href="/accounting/costing/production"><Factory className="mr-1.5 h-4 w-4" /> Run Production Costing</Link>
                  </Button>
                )}
              </span>
            </Note>
          )}
        </div>
      )}

      {/* ── Main content (skeleton while the first load runs) ──────────────── */}
      {(data || (readyToLoad && loading)) && (
        <section className="overflow-hidden rounded-xl border border-border bg-background">
          {/* Search + view toggle */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search by item name, code, ITCD or voucher #…"
              className="min-w-[220px] sm:max-w-md"
            />
            <Segmented
              value={view}
              onChange={setView}
              options={[{ key: "vouchers", label: "By Voucher" }, { key: "items", label: "By Item" }]}
            />
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {view === "vouchers" ? `${filteredVouchers.length} vouchers` : `${filteredItems.length} materials`}
            </span>
          </div>

          {view === "vouchers" ? (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr>
                    <th className={cn(TH, "left-0 z-20 w-10")}></th>
                    <th className={cn(TH, "left-10 z-20")}>Vr #</th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Godown</th>
                    <th className={TH}>Remarks</th>
                    <th className={cn(TH, "text-right")}>Lines</th>
                    <th className={cn(TH, "text-right")}>Total Qty</th>
                    <th className={cn(TH, "text-right")}>Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {!data ? (
                    <SkeletonRows rows={8} cols={8} />
                  ) : filteredVouchers.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <LabEmpty icon={Package} title="No issuance vouchers found for this period" hint={search ? "Try clearing the search." : undefined} />
                      </td>
                    </tr>
                  ) : (
                    filteredVouchers.map((v) => <VoucherRow key={v.tran_id} voucher={v} />)
                  )}
                </tbody>
                {data && filteredVouchers.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10">
                    <tr className={cn(TOTAL_ROW, "bg-muted")}>
                      <td colSpan={6} className={cn(TD, "sticky left-0 bg-muted text-right")}>Grand Total</td>
                      <td className={cn(TD, NUM)}>
                        {formatQty(filteredVouchers.reduce((s, v) => s + v.total_qty, 0))}
                      </td>
                      <td className={cn(TD, NUM)}>
                        {formatCurrency(filteredVouchers.reduce((s, v) => s + v.total_cost, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr>
                    <th className={cn(TH, "left-0 z-20")}>Material</th>
                    <th className={cn(TH, "text-right")}>Vouchers</th>
                    <th className={cn(TH, "text-right")}>Total Qty Issued</th>
                    <th className={cn(TH, "text-right")}>Unit Cost</th>
                    <th className={cn(TH, "text-right")}>Total Cost</th>
                    <th className={cn(TH, "text-center")}>Cost Source</th>
                    <th className={cn(TH, "text-right")}>% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {!data ? (
                    <SkeletonRows rows={8} cols={7} />
                  ) : filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <LabEmpty icon={Layers} title="No items found" hint={search ? "Try clearing the search." : undefined} />
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const pct = summary.total_cost > 0 ? (item.total_cost / summary.total_cost) * 100 : 0;
                      const noCost = item.cost_source === "not_found";
                      return (
                        <tr key={item.itcd} className="group border-b border-border hover:bg-muted/40">
                          <td className={cn(TD, "sticky left-0 z-[1] min-w-[200px] bg-background group-hover:bg-muted")}>
                            <div className="font-medium text-foreground">{item.item_name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              {item.item_code && <span className={cn(CODE_CHIP, "text-[10.5px]")}>{item.item_code}</span>}
                              <span className="font-mono text-[10.5px] text-muted-foreground">#{item.itcd}</span>
                            </div>
                          </td>
                          <td className={cn(TD, NUM, "text-muted-foreground")}>{item.voucher_count}</td>
                          <td className={cn(TD, NUM)}>{formatQty(item.total_qty)} <span className="text-xs text-muted-foreground">{item.unit}</span></td>
                          <td className={cn(TD, NUM)}>{formatCurrency(item.unit_cost)}</td>
                          <td className={cn(TD, NUM, "font-semibold", noCost ? "text-red-700 dark:text-red-300" : "text-foreground")}>
                            {formatCurrency(item.total_cost)}
                          </td>
                          <td className={cn(TD, "text-center")}><CostSourceBadge source={item.cost_source} /></td>
                          <td className={TD}>
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-16 rounded-full bg-muted">
                                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                              <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {data && filteredItems.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10">
                    <tr className={cn(TOTAL_ROW, "bg-muted")}>
                      <td colSpan={4} className={cn(TD, "sticky left-0 bg-muted text-right")}>Grand Total</td>
                      <td className={cn(TD, NUM)}>
                        {formatCurrency(filteredItems.reduce((s, i) => s + i.total_cost, 0))}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>
      )}
    </CostingFrame>
  );
}
