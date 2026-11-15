"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
  TrendingUp,
  Package,
  Factory,
  Warehouse,
  Calculator,
  Info,
  Layers,
  FlaskConical,
  Search,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  LabHeader, LabStat, LabEmpty, Chip, CODE_CHIP, CHIP, TH, TD, NUM, TOTAL_ROW,
} from "@/components/Material/shared/LabUI";
import {
  CostingFrame, PeriodPicker, SearchBox, Note, SkeletonRows, IconBtn, MONTHS,
} from "@/components/Costing/CostingUI";

// ── Constants ──────────────────────────────────────────────────────────────────
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

function fmt(v) {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
}
function fmtQty(v) {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(v) || 0);
}

// ── Cost source config ─────────────────────────────────────────────────────────
const SRC_CFG = {
  opening_stock:          { label: "Opening Stock",     tone: "ok",    Icon: Warehouse },
  weighted_avg:           { label: "Wtd Avg",           tone: "muted", Icon: TrendingUp },
  production_cost_entry:  { label: "Production Cost",   tone: "brand", Icon: Factory },
  production_tran8:       { label: "Produced (No PCE)", tone: "warn",  Icon: AlertTriangle },
  not_found:              { label: "No Cost Found",     tone: "bad",   Icon: AlertTriangle },
};
// Bar fill per tone (distribution cards).
const BAR = { ok: "bg-[#2f5139] dark:bg-emerald-400", muted: "bg-muted-foreground", brand: "bg-primary", warn: "bg-amber-600", bad: "bg-red-600" };

function CostSourceBadge({ source }) {
  const cfg = SRC_CFG[source] || { label: source || "—", tone: "muted", Icon: Info };
  const { Icon } = cfg;
  return (
    <Chip tone={cfg.tone} className="whitespace-nowrap">
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Chip>
  );
}

// One line of the breakdown: label on the left, qty × rate = value on the right.
function BreakLine({ icon: Icon, label, note, children, extra }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" /> {label}
          {note}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-muted-foreground">{children}</div>
      </div>
      {extra}
    </div>
  );
}

// ── Rate Calculation Breakdown ─────────────────────────────────────────────────
function RateBreakdown({ item }) {
  const hasOpening    = item.opening_qty > 0;
  const hasPurchase   = item.purchase_qty > 0;
  const hasProduction = item.production_qty > 0;
  const totalQty      = (item.opening_qty || 0) + (item.purchase_qty || 0) + (item.production_qty || 0);
  const totalValue    = (item.opening_value || 0) + (item.purchase_amt || 0)
                        + ((item.production_qty || 0) * (item.production_cost_per_unit || 0));

  return (
    <div className="rounded-xl border border-primary/15 bg-background">
      <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2">
        <Calculator className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">Rate Calculation Breakdown</span>
      </div>

      <div className="space-y-2 p-3">
        {hasOpening && (
          <BreakLine icon={Warehouse} label="Opening Stock">
            <span>{fmtQty(item.opening_qty)} {item.unit}</span>
            <span>×</span>
            <span>{fmt(item.opening_rate)}</span>
            <span>=</span>
            <span className="font-semibold text-foreground">{fmt(item.opening_value)}</span>
          </BreakLine>
        )}

        {hasPurchase && (
          <BreakLine icon={Package} label="Period Purchases">
            <span>{fmtQty(item.purchase_qty)} {item.unit}</span>
            <span>@ avg</span>
            <span>{fmt(item.purchase_rate)}</span>
            <span>=</span>
            <span className="font-semibold text-foreground">{fmt(item.purchase_amt)}</span>
          </BreakLine>
        )}

        {hasProduction && (
          <BreakLine
            icon={Factory}
            label={item.production_source === "tran8_only"
              ? "Production Receipt (no plan / no PCE)"
              : `Production (${item.has_actual ? "Actual PCE" : "Theoretical BOM"})`}
            note={
              item.production_source === "tran8_only"
                ? <Chip tone="warn">no Plan/PCE — rate from transaction damt</Chip>
                : !item.has_actual ? <Chip tone="warn">not yet costed</Chip> : null
            }
            extra={
              <>
                {item.production_source === "tran8_only" && (
                  <p className={cn("mt-2 rounded-md px-2 py-1.5 text-[11px]", CHIP.warn)}>
                    No productionPlanMaster / ProductionCostEntry found for this item. The rate shown is
                    derived from the production receipt transaction (damt ÷ qty). Issuance costing will use
                    the opening stock + purchase blended rate instead.
                  </p>
                )}
                {item.actual_cost_per_unit > 0 && item.theoretical_cost_per_unit > 0 && (
                  <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
                    <span>Actual: <strong className="tabular-nums text-foreground">{fmt(item.actual_cost_per_unit)}</strong></span>
                    <span>Theoretical: <strong className="tabular-nums text-foreground">{fmt(item.theoretical_cost_per_unit)}</strong></span>
                  </div>
                )}
              </>
            }
          >
            <span>{fmtQty(item.production_qty)} {item.unit}</span>
            <span>@</span>
            <span>{fmt(item.production_cost_per_unit)}</span>
            <span>=</span>
            <span className="font-semibold text-foreground">
              {fmt((item.production_qty || 0) * (item.production_cost_per_unit || 0))}
            </span>
          </BreakLine>
        )}

        {/* Total */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-t-2 border-primary bg-muted/50 px-3 py-2">
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Final Blended Rate</span>
            <span className="ml-1 tabular-nums">
              = {fmt(totalValue)} ÷ {fmtQty(totalQty)} {item.unit}
            </span>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-primary">{fmt(item.final_rate)}</div>
            <div className="text-[11px] text-muted-foreground">per {item.unit || "unit"}</div>
          </div>
        </div>

        {item.issued_qty > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" />
            <span>
              <strong className="tabular-nums text-foreground">{fmtQty(item.issued_qty)}</strong> {item.unit} issued this period
              at this rate = <strong className="tabular-nums text-foreground">{fmt((item.issued_qty || 0) * (item.final_rate || 0))}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Pinned identity columns (toggle + item) while the figures scroll sideways.
const PIN = "sticky z-[1] bg-background group-hover:bg-muted";

// "qty @ rate" stacked cell.
function QtyAt({ qty, rate, warn }) {
  if (!(qty > 0)) return <span className="text-xs text-muted-foreground/60">—</span>;
  return (
    <div>
      <div className="text-xs tabular-nums text-foreground">{fmtQty(qty)}</div>
      <div className="flex items-center justify-end gap-0.5 text-[11px] tabular-nums text-muted-foreground">
        @ {fmt(rate)}
        {warn && <AlertTriangle className="h-3 w-3 text-amber-600" />}
      </div>
    </div>
  );
}

// ── Item Row ───────────────────────────────────────────────────────────────────
function ItemRow({ item }) {
  const [expanded, setExpanded] = useState(false);
  const noCost = item.cost_source === "not_found";

  return (
    <>
      <tr
        className={cn("group cursor-pointer border-b border-border transition-colors hover:bg-muted/40", noCost && "bg-red-50/50 dark:bg-red-950/20")}
        onClick={() => setExpanded(!expanded)}
      >
        <td className={cn(TD, PIN, "left-0 w-10 pr-0")}>
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", expanded ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        </td>

        <td className={cn(TD, PIN, "left-10 min-w-[200px]")}>
          <div className="font-medium leading-tight text-foreground">{item.item_name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.item_code && <span className={cn(CODE_CHIP, "text-[11px]")}>{item.item_code}</span>}
            <span className="font-mono text-[11px] text-muted-foreground">#{item.itcd}</span>
          </div>
        </td>

        <td className={cn(TD, "text-xs text-muted-foreground")}>{item.category || "—"}</td>
        <td className={cn(TD, NUM)}><QtyAt qty={item.opening_qty} rate={item.opening_rate} /></td>
        <td className={cn(TD, NUM)}><QtyAt qty={item.purchase_qty} rate={item.purchase_rate} /></td>
        <td className={cn(TD, NUM)}>
          <QtyAt qty={item.production_qty} rate={item.production_cost_per_unit} warn={!item.has_actual} />
        </td>
        <td className={cn(TD, NUM, "text-xs")}>
          {item.issued_qty > 0 ? fmtQty(item.issued_qty) : <span className="text-muted-foreground/60">—</span>}
        </td>

        {/* FINAL RATE — most important column */}
        <td className={cn(TD, NUM)}>
          {noCost ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-300">
              <AlertTriangle className="h-3.5 w-3.5" /> 0.00
            </span>
          ) : (
            <div>
              <div className="font-bold text-foreground">{fmt(item.final_rate)}</div>
              <div className="text-[11px] text-muted-foreground">per {item.unit || "unit"}</div>
            </div>
          )}
        </td>

        <td className={cn(TD, "text-right")}>
          <CostSourceBadge source={item.cost_source} />
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border">
          <td colSpan={9} className="bg-muted/30 px-3 py-3 sm:px-6">
            <div className="max-w-3xl"><RateBreakdown item={item} /></div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CostRateReviewPage() {
  const now = new Date();
  const [month,    setMonth]    = useState(now.getMonth() + 1);
  const [year,     setYear]     = useState(now.getFullYear());
  const [search,   setSearch]   = useState("");
  const [catFilter,setCatFilter]= useState("all");
  const [srcFilter,setSrcFilter]= useState("all");
  const [sortBy,   setSortBy]   = useState("name"); // name | rate | issued
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month, year });
      if (catFilter !== "all") params.set("category", catFilter);
      const res  = await fetch(`/api/costing/rates?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setData(json);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [month, year, catFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filter + sort ──────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    if (!data?.data) return [];
    const q = search.toLowerCase().trim();
    let rows = data.data.filter(r => {
      if (q && !(
        r.item_name.toLowerCase().includes(q) ||
        (r.item_code || "").toLowerCase().includes(q) ||
        String(r.itcd).includes(q)
      )) return false;
      if (srcFilter !== "all" && r.cost_source !== srcFilter) return false;
      return true;
    });
    if (sortBy === "rate")   rows = [...rows].sort((a, b) => b.final_rate - a.final_rate);
    if (sortBy === "issued") rows = [...rows].sort((a, b) => b.issued_qty - a.issued_qty);
    return rows;
  }, [data, search, srcFilter, sortBy]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = data?.data || [];
    return {
      total:      all.length,
      noCost:     all.filter(r => r.cost_source === "not_found").length,
      produced:   all.filter(r => r.production_qty > 0).length,
      producedNoPce: all.filter(r => r.production_source === "tran8_only").length,
      purchased:  all.filter(r => r.purchase_qty > 0 && r.production_qty === 0).length,
      openingOnly:all.filter(r => r.opening_qty > 0 && r.purchase_qty === 0 && r.production_qty === 0).length,
    };
  }, [data]);

  const categories = data?.categories || [];

  return (
    <CostingFrame>
      <LabHeader
        icon={FlaskConical}
        breadcrumb="Costing"
        title="Cost Rate Review"
        subtitle={`Effective blended cost rate applied per item — ${MONTHS[month - 1]} ${year}`}
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

      {/* ── KPI Strip ────────────────────────────────────────────────────── */}
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <LabStat icon={Layers} label="Total Items" value={stats.total} />
          <LabStat icon={Factory} label="Produced Items" value={stats.produced} />
          {stats.producedNoPce > 0 && (
            <LabStat icon={AlertTriangle} label="No Plan / No PCE" value={stats.producedNoPce} tone="warn" />
          )}
          <LabStat icon={Package} label="Purchase-Based" value={stats.purchased} tone="muted" />
          <LabStat icon={Warehouse} label="Opening Only" value={stats.openingOnly} tone="ok" />
          {stats.noCost > 0 && (
            <LabStat icon={AlertTriangle} label="No Cost Found" value={stats.noCost} tone="bad" />
          )}
        </div>
      )}

      <Note tone="brand" icon={Info} title="How rates are computed:">
        Each item's final rate =
        (Opening Qty × Opening Rate + Period Purchases + Production Cost) ÷ Total Qty.
        For produced items, the Production Cost Entry rate is used (actual issuances preferred over BOM).
        This is the exact same rate applied in Issuance Costing.
        <strong> Click any row</strong> to see the full calculation breakdown.
      </Note>

      <section className="overflow-hidden rounded-xl border border-border bg-background">
        {/* ── Toolbar ── */}
        <div className="space-y-2.5 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search by item name, code or ITCD…" className="min-w-[220px] sm:max-w-sm" />

            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="h-9 w-full bg-background text-sm sm:w-44">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.ic_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={srcFilter} onValueChange={setSrcFilter}>
              <SelectTrigger className="h-9 w-full bg-background text-sm sm:w-48">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cost Sources</SelectItem>
                <SelectItem value="opening_stock">Opening Stock</SelectItem>
                <SelectItem value="weighted_avg">Weighted Average</SelectItem>
                <SelectItem value="production_cost_entry">Production Cost (PCE)</SelectItem>
                <SelectItem value="production_tran8">Produced (No PCE)</SelectItem>
                <SelectItem value="not_found">No Cost Found</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-9 w-full bg-background text-sm sm:w-44">
                <SelectValue placeholder="Sort by…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort: Name A→Z</SelectItem>
                <SelectItem value="rate">Sort: Rate ↓</SelectItem>
                <SelectItem value="issued">Sort: Issued Qty ↓</SelectItem>
              </SelectContent>
            </Select>

            <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {visible.length} of {stats.total} items
            </span>
          </div>

          {/* Cost source legend = quick filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source:</span>
            {Object.entries(SRC_CFG).map(([key, cfg]) => {
              const { Icon } = cfg;
              const on = srcFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSrcFilter(on ? "all" : key)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold transition-all",
                    CHIP[cfg.tone],
                    on ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "opacity-75 hover:opacity-100",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {cfg.label}
                </button>
              );
            })}
            {srcFilter !== "all" && (
              <button type="button" onClick={() => setSrcFilter("all")} className="ml-1 text-[11px] text-muted-foreground underline hover:text-foreground">
                Clear filter
              </button>
            )}
          </div>
        </div>

        {/* ── Main Table ── */}
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr>
                <th className={cn(TH, "left-0 z-20 w-10")} />
                <th className={cn(TH, "left-10 z-20")}>Item</th>
                <th className={TH}>Category</th>
                <th className={cn(TH, "text-right")}><span className="inline-flex items-center gap-1"><Warehouse className="h-3 w-3" /> Opening</span></th>
                <th className={cn(TH, "text-right")}><span className="inline-flex items-center gap-1"><Package className="h-3 w-3" /> Purchase</span></th>
                <th className={cn(TH, "text-right")}><span className="inline-flex items-center gap-1"><Factory className="h-3 w-3" /> Production</span></th>
                <th className={cn(TH, "text-right")}>Issued Qty</th>
                <th className={cn(TH, "text-right")}><span className="inline-flex items-center gap-1"><Calculator className="h-3 w-3" /> Final Rate</span></th>
                <th className={cn(TH, "text-right")}>Source</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={9} />
              ) : !data ? null : visible.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <LabEmpty icon={Search} title="No items found" hint="Try clearing your search or filter" />
                  </td>
                </tr>
              ) : (
                visible.map((item) => <ItemRow key={item.itcd} item={item} />)
              )}
            </tbody>
            {!loading && visible.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className={cn(TOTAL_ROW, "bg-muted")}>
                  <td colSpan={6} className={cn(TD, "sticky left-0 bg-muted text-right text-xs uppercase tracking-wide")}>
                    {visible.length} items shown · Issued qty
                  </td>
                  <td className={cn(TD, NUM, "text-xs")}>
                    {fmtQty(visible.reduce((s, r) => s + (r.issued_qty || 0), 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* ── Cost Source Summary Cards ─────────────────────────────────────── */}
      {data && (
        <div>
          <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Cost Source Distribution</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {Object.entries(SRC_CFG).map(([key, cfg]) => {
              const { Icon } = cfg;
              const count = (data.data || []).filter(r => r.cost_source === key).length;
              const pct   = stats.total > 0 ? ((count / stats.total) * 100).toFixed(0) : 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSrcFilter(srcFilter === key ? "all" : key)}
                  className={cn(
                    "rounded-xl border bg-background p-4 text-left transition-colors hover:border-primary/40",
                    srcFilter === key ? "border-primary ring-2 ring-primary/15" : "border-border",
                  )}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", CHIP[cfg.tone])}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-semibold text-foreground">{cfg.label}</span>
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-foreground">{count}</div>
                  <div className="text-xs text-muted-foreground">{pct}% of items</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", BAR[cfg.tone])} style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </CostingFrame>
  );
}
