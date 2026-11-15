"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { useGrandMasterBOM } from "@/hooks/useGrandMasterBom";
import Select from "react-select";
import * as XLSX from "xlsx";
import {
  TrendingUp, Calendar, Search, Download, Box, RefreshCw, Printer, X,
  Layers, CheckCircle, AlertCircle, BarChart2, ListTree,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useProductionSetup } from "@/hooks/useProductionSetup";
import {
  isFinishedCategory,
  isSemiFinishedCategory,
  isRawMaterialCategory,
  isPackingCategory,
} from "@/lib/production/setupConfig";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import {
  LabHeader, LabCard, LabStat, Chip, CODE_CHIP, TH, TD, NUM, TOTAL_ROW,
  TABS_SCROLL, TABS_LIST, TABS_TRIGGER, LabEmpty,
} from "@/components/Material/shared/LabUI";

// ── constants ──────────────────────────────────────────────────────────────────
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
// Category kinds come from Settings → Production setup
const categoryName = (setup, id) =>
  isFinishedCategory(setup, id) ? "Finished"
    : isSemiFinishedCategory(setup, id) ? "Semi Finished"
      : isRawMaterialCategory(setup, id) ? "Raw Material"
        : isPackingCategory(setup, id) ? "Packaging Material"
          : "Unknown";
const ml  = (m, y) => `${MONTHS[m - 1]} ${y}`;
const fmt = (v) => Number(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── look ────────────────────────────────────────────────────────────────────────
// Item column pinned to the left while the figures scroll (table layout only).
const PIN_TH = "md:sticky md:left-0 md:z-20";
const PIN_TD = "bg-background group-hover:bg-muted md:sticky md:left-0 md:z-[1] md:shadow-[1px_0_0_hsl(var(--border))]";
// Column-group header row (above the column names) and the row under it.
const GROUP_TH = "sticky top-0 z-10 h-8 bg-[#5c0000] px-3 text-center text-[11px] font-semibold uppercase tracking-wide text-primary-foreground whitespace-nowrap";
const TH2 = "top-8";
const GROUP_EDGE = "border-l border-white/20";
const CELL_EDGE = "md:border-l md:border-border";

/** Signed cost difference (future − base): dearer reads red, cheaper green. */
const Variance = ({ base, future }) => {
  if (base == null || future == null) return <span className="text-xs text-muted-foreground">—</span>;
  const d = future - base;
  const cls = d > 0.005 ? "text-red-700 dark:text-red-400" : d < -0.005 ? "text-[#2f5139] dark:text-emerald-300" : "text-muted-foreground";
  return <span className={cn("font-semibold tabular-nums", cls)}>{d > 0 ? "+" : ""}{fmt(d)}</span>;
};

/** Coverage chip + thin bar. */
const Coverage = ({ pct }) => {
  const tone = pct === 100 ? "ok" : pct > 0 ? "warn" : "bad";
  return (
    <div className="flex flex-col items-center gap-1 max-md:items-start">
      <Chip tone={tone} className="tabular-nums">{pct}%</Chip>
      <div className="h-1.5 w-16 rounded-full bg-muted">
        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

/** Search box with the "/" hint; Escape clears. */
const SearchBox = React.forwardRef(({ value, onChange, placeholder, className }, ref) => (
  <label className={cn("flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15", className)}>
    <Search className="h-4 w-4 flex-shrink-0" />
    <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Escape" && onChange("")}
      placeholder={placeholder} aria-label="Search"
      className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
    {value ? (
      <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    ) : (
      <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
    )}
  </label>
));
SearchBox.displayName = "SearchBox";

/** Loading placeholder for a table. */
const TableSkeleton = ({ rows = 8 }) => (
  <div className="space-y-2 p-4">
    <Skeleton className="h-9 w-full" />
    {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
  </div>
);

/** Item cell: code chip over the name, optional chip after the code. */
const ItemCell = ({ itcd, code, name, extra }) => (
  <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-1">
      {itcd != null && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{itcd}</span>}
      {code != null && code !== "" && <span className={CODE_CHIP}>{code}</span>}
      {extra}
    </div>
    <p className="mt-0.5 truncate font-medium text-foreground md:max-w-[260px]" title={String(name ?? "")}>{name}</p>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
const FutureCostingBOMView = () => {
  const { bomItems, items: allItems, loading } = useGrandMasterBOM();
  const { setup } = useProductionSetup();
  const getCategoryName = useCallback((id) => categoryName(setup, id), [setup]);
  // made in production (has a BOM) vs. bought in (a BOM leaf)
  const isMade = useCallback((id) => isFinishedCategory(setup, id) || isSemiFinishedCategory(setup, id), [setup]);
  const isLeaf = useCallback((id) => isRawMaterialCategory(setup, id) || isPackingCategory(setup, id), [setup]);

  const [tab, setTab] = useState("detail"); // "detail" | "summary"

  // ── Product selector (Detail tab) ─────────────────────────────────────────
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [hierarchy, setHierarchy]             = useState([]);

  // ── Shared FC state ────────────────────────────────────────────────────────
  const [fcPeriods,        setFcPeriods]        = useState([]);
  const [fcSelectedPeriod, setFcSelectedPeriod] = useState(null);
  const [fcRates,          setFcRates]          = useState([]);
  const [openingStockMap,  setOpeningStockMap]  = useState({});
  const [fcLoading,        setFcLoading]        = useState(false);
  const [fcSearch,         setFcSearch]         = useState("");

  // ── Load periods on mount ─────────────────────────────────────────────────
  const loadPeriods = useCallback(async () => {
    setFcLoading(true);
    try {
      const { data } = await axios.get("/api/future-costing");
      const periods = data.data || [];
      setFcPeriods(periods);
      if (periods.length > 0) setFcSelectedPeriod(periods[0]);
    } catch { } finally { setFcLoading(false); }
  }, []);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  // ── Fetch rates when period changes ──────────────────────────────────────
  useEffect(() => {
    if (!fcSelectedPeriod) return;
    setFcLoading(true);
    axios.get(`/api/future-costing?month=${fcSelectedPeriod.month}&year=${fcSelectedPeriod.year}`)
      .then(({ data }) => setFcRates(data.data || []))
      .catch(() => {})
      .finally(() => setFcLoading(false));
  }, [fcSelectedPeriod]);

  // ── Fetch opening stock only when a product is selected ──────────────────
  useEffect(() => {
    if (!selectedProduct || !fcSelectedPeriod) { setOpeningStockMap({}); return; }
    axios.get(`/api/opening-stock?month=${fcSelectedPeriod.month}&year=${fcSelectedPeriod.year}`)
      .then(({ data }) => {
        const osMap = {};
        (data.data || []).forEach((r) => { osMap[r.itcd] = r; });
        setOpeningStockMap(osMap);
      })
      .catch(() => {});
  }, [selectedProduct, fcSelectedPeriod]);

  // ── Active-BOM lookup helper ──────────────────────────────────────────────
  const findActiveBOM = useCallback(
    (productId) => (bomItems || []).find(
      (b) => b.finished_id === productId && b.instructions === "A"
    ),
    [bomItems]
  );

  // ── BOM hierarchy builder — active BOMs only, recursive semi-finished ─────
  const buildBOMHierarchy = useCallback(
    (productId, level = 0, path = [], parentPercentage = 100, parentQuantity = 1) => {
      if (!bomItems || !allItems) return null;

      const bom = findActiveBOM(productId);
      if (!bom) return null;

      const product = allItems.find((f) => f.itcd === productId);

      const node = {
        id: `${productId}-${level}-${path.join("-")}`,
        productId,
        productName: product?.item || bom.product_name || productId,
        category:    getCategoryName(product?.ic_id),
        level,
        percentage:  parentPercentage,
        quantity:    parentQuantity,
        children:    [],
        path:        [...path, productId],
      };

      if (path.includes(productId)) return { ...node, circular: true };

      // bom_details is the snake_case field returned by the SQL query
      const bomDetails = bom.bom_details || bom.bomDetails || [];

      if (Array.isArray(bomDetails)) {
        bomDetails.forEach((detail) => {
          const childId  = detail.material_id;
          const pct      = Number(detail.material_percentage) || 0;
          const childPct = parentPercentage * (pct / 100);
          const childQty = parentQuantity   * (pct / 100);

          const childProduct = allItems.find((f) => f.itcd === childId);
          const childIcId    = childProduct?.ic_id;

          const childNode = {
            id:          `${childId}-${level + 1}-${path.join("-")}`,
            productId:   childId,
            productName: childProduct?.item || detail.material_desc || childId,
            category:    getCategoryName(childIcId),
            level:       level + 1,
            percentage:  childPct,
            quantity:    childQty,
            children:    [],
            path:        [...path, productId, childId],
          };

          // If child is Finished (1) or Semi-Finished (2), drill into its active BOM
          if (isMade(childIcId) && findActiveBOM(childId)) {
            const childHierarchy = buildBOMHierarchy(
              childId, level + 1, [...path, productId], childPct, childQty
            );
            if (childHierarchy) childNode.children = childHierarchy.children || [];
          }

          node.children.push(childNode);
        });
      }
      return node;
    },
    [bomItems, allItems, findActiveBOM, getCategoryName, isMade]
  );

  // ── Rebuild hierarchy when product/data changes ───────────────────────────
  useEffect(() => {
    if (!selectedProduct || !bomItems?.length) { setHierarchy([]); return; }
    const h = buildBOMHierarchy(selectedProduct.value, 0, [], 100, 1);
    setHierarchy(h ? [h] : []);
  }, [selectedProduct, bomItems, buildBOMHierarchy]);

  // ── Flatten a product's BOM to raw materials only (ic_id 3 & 4) ─────────
  // Drills through Finished/Semi-Finished (ic_id 1 & 2) recursively until
  // every item is a raw material or packaging. Same itcd across branches gets merged.
  const flattenToRawMaterials = useCallback((productId, parentQty = 1, visited = new Set()) => {
    const result = new Map(); // itcd → leaf item
    if (visited.has(productId)) return result; // circular guard

    const bom = findActiveBOM(productId);
    if (!bom) return result;

    const seen = new Set(visited);
    seen.add(productId);

    const bomDetails = bom.bom_details || bom.bomDetails || [];

    bomDetails.forEach((detail) => {
      const childId  = detail.material_id;
      const pct      = Number(detail.material_percentage) || 0;
      const childQty = parentQty * (pct / 100);

      const childProduct = (allItems || []).find((f) => f.itcd === childId);
      const childIcId    = childProduct?.ic_id;

      if (isLeaf(childIcId)) {
        // Leaf — raw material or packaging: collect it
        if (result.has(childId)) {
          result.get(childId).qty += childQty;
        } else {
          result.set(childId, {
            productId:   childId,
            productName: childProduct?.item || detail.material_desc || String(childId),
            code:        childProduct?.code || detail.material_code || String(childId),
            unit:        childProduct?.unit || "—",
            category_id: childIcId,
            category:    getCategoryName(childIcId),
            qty:         childQty,
          });
        }
      } else if (isMade(childIcId)) {
        // Intermediate — drill into its active BOM and merge results up
        const sub = flattenToRawMaterials(childId, childQty, seen);
        sub.forEach((subItem, subItcd) => {
          if (result.has(subItcd)) {
            result.get(subItcd).qty += subItem.qty;
          } else {
            result.set(subItcd, { ...subItem });
          }
        });
      }
      // ic_id null/unknown — silently skip
    });

    return result;
  }, [bomItems, allItems, findActiveBOM, getCategoryName, isMade, isLeaf]);

  // ── Product options ───────────────────────────────────────────────────────
  const productOptions = (allItems || [])
    .filter((it) => isMade(it.ic_id) && findActiveBOM(it.itcd))
    .map((it) => ({ value: it.itcd, label: `${it.itcd} - ${it.item} - ${it.code} (${getCategoryName(it.ic_id)})` }));

  // ── "/" focuses the search box (Ctrl+K is the header's menu search) ──────
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED: period pills + the period / search / export toolbar card
  // ══════════════════════════════════════════════════════════════════════════
  const renderPeriodPills = () => (
    <div className="flex flex-wrap gap-2">
      {fcPeriods.map((p) => {
        const active = fcSelectedPeriod?.month === p.month && fcSelectedPeriod?.year === p.year;
        return (
          <button key={`${p.month}-${p.year}`} type="button" onClick={() => setFcSelectedPeriod(p)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-primary"
            )}>
            {ml(p.month, p.year)}
            <span className={cn("tabular-nums", active ? "opacity-80" : "opacity-60")}>({p.item_count})</span>
          </button>
        );
      })}
    </div>
  );

  const renderPeriodCard = ({ searchPlaceholder, onExcel, onPrint, canExport, emptyText }) => (
    <LabCard
      icon={Calendar}
      title="Select future month"
      subtitle="Saved future-costing months, newest first"
      actions={
        <>
          <SearchBox ref={searchRef} value={fcSearch} onChange={setFcSearch}
            placeholder={searchPlaceholder} className="w-full sm:w-56" />
          <Button variant="outline" size="sm" onClick={onExcel} disabled={!canExport} className="max-sm:flex-1">
            <Download /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={onPrint} disabled={!canExport} className="max-sm:flex-1">
            <Printer /> Print
          </Button>
        </>
      }
      bodyClassName="px-4 py-3">
      {fcLoading && !fcPeriods.length ? (
        <div className="flex flex-wrap gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-28 rounded-full" />)}</div>
      ) : fcPeriods.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : renderPeriodPills()}
    </LabCard>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-1.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-6 w-56" /></div>
        </div>
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <LabCard><TableSkeleton /></LabCard>
      </div>
    );
  }

  return (
    <div className="max-w-full space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <LabHeader
        icon={TrendingUp}
        title="Future Costing · BOM view"
        subtitle="Future raw material rates against each product's active BOM"
        badge={`${fcPeriods.length} periods`}
        actions={
          <Button variant="outline" size="sm" onClick={loadPeriods} disabled={fcLoading}>
            <RefreshCw className={cn(fcLoading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {/* Tab navigation */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className={TABS_SCROLL}>
          <TabsList className={TABS_LIST}>
            <TabsTrigger value="detail" className={TABS_TRIGGER}><ListTree className="h-4 w-4" /> Detail view</TabsTrigger>
            <TabsTrigger value="summary" className={TABS_TRIGGER}><BarChart2 className="h-4 w-4" /> Summary view</TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      {/* ── Product selector (both tabs need the context) ────────────────────── */}
      <LabCard bodyClassName="p-4">
        <label htmlFor="fc-bom-product" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Finished / semi-finished product
        </label>
        <Select
          inputId="fc-bom-product"
          options={productOptions}
          value={selectedProduct}
          onChange={setSelectedProduct}
          placeholder="Type to search products…"
          isClearable
          menuPortalTarget={typeof document !== "undefined" ? document.body : null}
          styles={selectStyles(false)}
        />
      </LabCard>

      {tab === "detail" && (() => {
        const rateMap = {};
        fcRates.forEach((r) => { rateMap[r.itcd] = r; });

        const itemMap = {};
        (allItems || []).forEach((it) => { itemMap[it.itcd] = it; });

        // Flatten directly to raw materials / packaging, drilling through any Finished/Semi-Finished
        const rawMatsMap  = selectedProduct ? flattenToRawMaterials(selectedProduct.value) : new Map();
        const bomMaterials = Array.from(rawMatsMap.values());
        const totalRawQty  = bomMaterials.reduce((s, m) => s + m.qty, 0);

        const joinedRows = bomMaterials.map((m) => {
          const rec  = rateMap[m.productId];
          const idet = itemMap[m.productId] || {};
          const qty  = m.qty || 0;
          const avgRate     = rec ? Number(rec.rate)         : null;
          const closingRate = rec ? Number(rec.closing_rate) : null;
          const enteredRate = rec ? Number(rec.future_rate)  : null;
          return {
            itcd:         m.productId,
            name:         m.productName || idet.item || "—",
            code:         m.code        || idet.code || m.productId,
            unit:         m.unit        || idet.unit || "—",
            bomPct:       totalRawQty > 0 ? (qty / totalRawQty) * 100 : 0,
            bomQty:       qty,
            closingRate,
            enteredRate,
            avgRate,
            baseCost:     closingRate != null && closingRate > 0 ? qty * closingRate : null,
            futureCost:   avgRate     != null ? qty * avgRate   : null,
            hasRate:      avgRate != null,
          };
        });

        const totalMaterials  = joinedRows.length;
        const withRates       = joinedRows.filter((r) => r.hasRate).length;
        const missingRates    = totalMaterials - withRates;
        const totalFutureCost = joinedRows.reduce((s, r) => s + (r.futureCost || 0), 0);
        const totalQty        = joinedRows.reduce((s, r) => s + (r.bomQty || 0), 0);

        const filtered = joinedRows.filter((r) =>
          !fcSearch ||
          r.name.toLowerCase().includes(fcSearch.toLowerCase()) ||
          String(r.itcd).includes(fcSearch) ||
          String(r.code).toLowerCase().includes(fcSearch.toLowerCase())
        );

        const periodLabel   = fcSelectedPeriod ? ml(fcSelectedPeriod.month, fcSelectedPeriod.year) : "";
        const productLabel  = selectedProduct?.label?.split("(")[0]?.trim() || "";
        const totalBaseCost = filtered.reduce((s, r) => s + (r.baseCost || 0), 0);

        const exportExcel = () => {
          if (!filtered.length) return;
          const ws = XLSX.utils.json_to_sheet(filtered.map((r, i) => ({
            "#": i + 1,
            "Code":          r.code,
            "Raw Material":  r.name,
            "Unit":          r.unit,
            "Qty/Unit":      +r.bomQty.toFixed(4),
            "Base Rate":     r.closingRate  != null ? r.closingRate  : "—",
            "Future Rate":   r.enteredRate  != null ? r.enteredRate  : "—",
            "Avg Rate":      r.avgRate      != null ? r.avgRate      : "—",
            "Base Cost":     r.baseCost     != null ? +r.baseCost.toFixed(4)    : "—",
            "Future Cost":   r.futureCost   != null ? +r.futureCost.toFixed(4)  : "—",
          })));
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "FC Detail");
          XLSX.writeFile(wb, `FC_Detail_${productLabel}_${periodLabel}.xlsx`);
        };

        const handlePrint = () => {
          if (!filtered.length) return;
          const win = window.open("", "_blank", "width=1200,height=750");
          const rows = filtered.map((r, i) => `
            <tr style="${!r.hasRate ? "background:#fffbeb" : i % 2 === 0 ? "background:#fff" : "background:#f8fafc"}">
              <td>${i + 1}</td>
              <td style="font-family:monospace;font-size:10px">${r.code}</td>
              <td>${r.name}${!r.hasRate ? ' <em style="color:#d97706;font-size:9px">(No Rate)</em>' : ""}</td>
              <td style="text-align:center">${r.unit}</td>
              <td style="text-align:right;font-weight:700">${r.bomQty.toFixed(4)}</td>
              <td style="text-align:right">${r.closingRate != null && r.closingRate > 0 ? fmt(r.closingRate) : "—"}</td>
              <td style="text-align:right;color:#4f46e5">${r.enteredRate != null && r.enteredRate > 0 ? fmt(r.enteredRate) : "—"}</td>
              <td style="text-align:right;font-weight:800;color:#059669">${r.hasRate ? fmt(r.avgRate) : "—"}</td>
              <td style="text-align:right">${r.baseCost  != null ? fmt(r.baseCost)  : "—"}</td>
              <td style="text-align:right;font-weight:800;color:#7c3aed">${r.futureCost != null ? fmt(r.futureCost) : "—"}</td>
            </tr>`).join("");
          win.document.write(`<!DOCTYPE html><html><head>
            <title>FC Detail — ${productLabel} — ${periodLabel}</title>
            <style>
              body{font-family:Arial,sans-serif;font-size:11px;margin:18px;color:#1f2937}
              h2{margin:0 0 3px;font-size:15px}p.sub{margin:0 0 12px;color:#6b7280;font-size:10px}
              table{width:100%;border-collapse:collapse}
              thead th{background:#1e1b4b;color:#fff;padding:6px 7px;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em}
              thead tr.sub-head th{background:#374151;font-size:9px}
              td{padding:4px 7px;border-bottom:1px solid #e5e7eb;font-size:10.5px}
              tfoot td{background:#f3e8ff;font-weight:900;color:#7c3aed;font-size:12px;padding:6px 7px;border-top:2px solid #a78bfa}
              .formula{margin-top:10px;font-size:9.5px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:6px}
              @media print{body{margin:8mm}}
            </style></head><body>
            <h2>${productLabel} — Future Costing BOM Impact</h2>
            <p class="sub">Period: ${periodLabel} &nbsp;·&nbsp; ${filtered.length} raw materials &nbsp;·&nbsp; ${withRates}/${totalMaterials} with rates &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString()}</p>
            <table><thead>
              <tr>
                <th rowspan="2">#</th><th rowspan="2">Code</th><th rowspan="2">Raw Material</th><th rowspan="2">Unit</th>
                <th colspan="1" style="text-align:center;background:#1e40af">BOM</th>
                <th colspan="3" style="text-align:center;background:#3730a3">Rate Breakdown</th>
                <th colspan="2" style="text-align:center;background:#6d28d9">Cost</th>
              </tr>
              <tr class="sub-head">
                <th style="text-align:right;background:#1e40af">Qty/Unit</th>
                <th style="text-align:right;background:#3730a3">Base Rate</th>
                <th style="text-align:right;background:#3730a3">Future Rate</th>
                <th style="text-align:right;background:#3730a3">Avg Rate</th>
                <th style="text-align:right;background:#6d28d9">Base Cost</th>
                <th style="text-align:right;background:#6d28d9">Future Cost</th>
              </tr>
            </thead><tbody>${rows}</tbody>
            <tfoot><tr>
              <td colspan="4" style="text-align:right;font-size:10px;color:#374151">Total (per unit of ${productLabel})</td>
              <td style="text-align:right;font-weight:700">${totalQty.toFixed(4)}</td>
              <td colspan="3"></td>
              <td style="text-align:right">${fmt(totalBaseCost)}</td>
              <td style="text-align:right">${fmt(totalFutureCost)}</td>
            </tr></tfoot></table>
            <p class="formula">Avg Rate = (Closing Amount + Future Amount) ÷ (Closing Qty + Future Qty) &nbsp;·&nbsp; Future Cost = Qty/Unit × Avg Rate &nbsp;·&nbsp; Base Cost = Qty/Unit × Base Rate</p>
            </body></html>`);
          win.document.close();
          setTimeout(() => win.print(), 400);
        };

        // Totals row = the rows on screen (search applied) — display only.
        const shownQty    = filtered.reduce((s, r) => s + (r.bomQty || 0), 0);
        const shownFuture = filtered.reduce((s, r) => s + (r.futureCost || 0), 0);
        const productRmRate = selectedProduct ? openingStockMap[selectedProduct.value]?.rm_rate : null;

        return (
          <div className="space-y-4">

            {/* Period + search */}
            {renderPeriodCard({
              searchPlaceholder: "Search material…",
              onExcel: exportExcel,
              onPrint: handlePrint,
              canExport: filtered.length > 0,
              emptyText: "No saved future costing rates. Add rates on the Future Costing tab first.",
            })}

            {/* No product */}
            {hierarchy.length === 0 ? (
              <LabCard>
                <LabEmpty icon={Box} title="No product selected"
                  hint="Pick a product above — its raw materials will appear with their future rates." />
              </LabCard>
            ) : (
              <>
                {/* Summary tiles */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <LabStat icon={Layers} label="Raw materials" value={totalMaterials} hint="from BOM" />
                  <LabStat icon={CheckCircle} tone="ok" label="With future rates" value={withRates}
                    hint={`${totalMaterials > 0 ? Math.round(withRates / totalMaterials * 100) : 0}% coverage`} />
                  <LabStat icon={TrendingUp} label="Total future cost" value={fmt(totalFutureCost)} hint="PKR per unit" />
                  <LabStat icon={AlertCircle} tone={missingRates > 0 ? "warn" : "muted"} label="Missing rates" value={missingRates}
                    hint={missingRates > 0 ? "need rates" : "all covered"} />
                </div>

                {/* Table */}
                {!fcSelectedPeriod ? (
                  <LabCard>
                    <LabEmpty icon={Calendar} title="No month selected" hint="Select a future month above to see rates." />
                  </LabCard>
                ) : fcLoading ? (
                  <LabCard><TableSkeleton /></LabCard>
                ) : (
                  <LabCard
                    icon={ListTree}
                    title={`${productLabel} — BOM impact`}
                    subtitle={`${ml(fcSelectedPeriod.month, fcSelectedPeriod.year)} · ${filtered.length} materials`}
                    actions={<Chip tone={missingRates > 0 ? "warn" : "ok"}>{withRates}/{totalMaterials} matched</Chip>}>
                    {filtered.length === 0 ? (
                      <LabEmpty icon={Box} title={fcSearch ? "No materials match search" : "No BOM raw materials found"} />
                    ) : (
                      <div className="md:max-h-[65vh] md:overflow-auto">
                        <table className="vl-grid w-full text-sm md:min-w-[1080px]">
                          <thead>
                            <tr>
                              <th className={cn(GROUP_TH, PIN_TH)}></th>
                              <th className={GROUP_TH}></th>
                              <th className={cn(GROUP_TH, GROUP_EDGE)}>BOM</th>
                              <th colSpan={3} className={cn(GROUP_TH, GROUP_EDGE)}>Rate</th>
                              <th colSpan={3} className={cn(GROUP_TH, GROUP_EDGE)}>Cost per unit</th>
                            </tr>
                            <tr>
                              <th className={cn(TH, TH2, PIN_TH)}>Raw material</th>
                              <th className={cn(TH, TH2, "text-center")}>Unit</th>
                              <th className={cn(TH, TH2, GROUP_EDGE, "text-right")}>Qty/Unit</th>
                              <th className={cn(TH, TH2, GROUP_EDGE, "text-right")}>Base</th>
                              <th className={cn(TH, TH2, "text-right")}>Future</th>
                              <th className={cn(TH, TH2, "text-right")}>Avg</th>
                              <th className={cn(TH, TH2, GROUP_EDGE, "text-right")}>Base</th>
                              <th className={cn(TH, TH2, "text-right")}>Future</th>
                              <th className={cn(TH, TH2, "text-right")}>Variance</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {filtered.map((row) => (
                              <tr key={row.itcd} className={cn("group transition-colors hover:bg-muted", !row.hasRate && "bg-[#f5f0e6]/50 dark:bg-amber-950/20")}>
                                <td className={cn(TD, "vl-check", PIN_TD)}>
                                  <ItemCell code={row.code} name={row.name}
                                    extra={!row.hasRate && <Chip tone="warn" className="px-1.5 py-0 text-[10.5px]">No rate</Chip>} />
                                </td>
                                <td data-label="Unit" className={cn(TD, "text-center max-md:text-left")}>
                                  <Chip tone="muted">{row.unit}</Chip>
                                </td>
                                <td data-label="Qty/Unit" className={cn(TD, NUM, CELL_EDGE, "font-medium")}>{row.bomQty.toFixed(4)}</td>
                                {/* Base Rate */}
                                <td data-label="Base Rate" className={cn(TD, NUM, CELL_EDGE, "text-muted-foreground")}>
                                  {row.closingRate != null && row.closingRate > 0 ? fmt(row.closingRate) : "—"}
                                </td>
                                {/* Future Rate (entered) */}
                                <td data-label="Future Rate" className={cn(TD, NUM)}>
                                  {row.enteredRate != null && row.enteredRate > 0 ? fmt(row.enteredRate) : <span className="text-muted-foreground">—</span>}
                                </td>
                                {/* Avg Rate (saved) */}
                                <td data-label="Avg Rate" className={cn(TD, NUM)}>
                                  {row.hasRate
                                    ? <span className="font-semibold text-primary">{fmt(row.avgRate)}</span>
                                    : <Chip tone="warn">No rate</Chip>}
                                </td>
                                {/* Base Cost */}
                                <td data-label="Base Cost" className={cn(TD, NUM, CELL_EDGE, "text-muted-foreground")}>
                                  {row.baseCost != null ? fmt(row.baseCost) : "—"}
                                </td>
                                {/* Future Cost */}
                                <td data-label="Future Cost" className={cn(TD, NUM, "bg-primary/5 font-semibold")}>
                                  {row.futureCost != null ? fmt(row.futureCost) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td data-label="Variance" className={cn(TD, NUM)}>
                                  <Variance base={row.baseCost} future={row.futureCost} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="max-md:hidden">
                            <tr className={TOTAL_ROW}>
                              <td className={cn(TD, "bg-muted md:sticky md:left-0")}>Total per unit of {productLabel}</td>
                              <td className={TD}></td>
                              <td className={cn(TD, NUM)}>{shownQty.toFixed(4)}</td>
                              <td className={TD}></td>
                              <td className={TD}></td>
                              <td className={TD}></td>
                              <td className={cn(TD, NUM)}>{fmt(totalBaseCost)}</td>
                              <td className={cn(TD, NUM, "text-primary")}>{fmt(shownFuture)}</td>
                              <td className={cn(TD, NUM)}><Variance base={totalBaseCost} future={shownFuture} /></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}

                    {filtered.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span><strong className="text-foreground">{totalMaterials}</strong> materials</span>
                          <span><strong className="text-foreground">{withRates}</strong> with rates</span>
                          {missingRates > 0 && <span><strong className="text-foreground">{missingRates}</strong> missing</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span>
                            Product closing rate:{" "}
                            {productRmRate > 0
                              ? <strong className="tabular-nums text-foreground">PKR {fmt(productRmRate)}</strong>
                              : "—"}
                          </span>
                          {/* Phones: the totals row is hidden with the table head, so show it here. */}
                          <span className="md:hidden">Qty: <strong className="tabular-nums text-foreground">{shownQty.toFixed(4)}</strong></span>
                          <span className="md:hidden">Base: <strong className="tabular-nums text-foreground">PKR {fmt(totalBaseCost)}</strong></span>
                          <span className="md:hidden">Future: <strong className="tabular-nums text-primary">PKR {fmt(shownFuture)}</strong></span>
                        </div>
                      </div>
                    )}
                  </LabCard>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* ════════════════ SUMMARY TAB ════════════════════════════════════════ */}
      {tab === "summary" && (() => {
        const rateMap     = {};
        const baseRateMap = {};
        fcRates.forEach((r) => {
          rateMap[r.itcd]     = r.rate;
          baseRateMap[r.itcd] = r.closing_rate || 0;
        });
        const summaryPeriodLabel = fcSelectedPeriod ? ml(fcSelectedPeriod.month, fcSelectedPeriod.year) : "";

        const itemMaster = {};
        (allItems || []).forEach((it) => { itemMaster[it.itcd] = it; });

        const summaryRows = (allItems || [])
          .filter((it) => isMade(it.ic_id))
          .filter((it) => findActiveBOM(it.itcd))
          .map((it) => {
            const leavesMap = flattenToRawMaterials(it.itcd);
            if (!leavesMap.size) return null;
            const leaves = Array.from(leavesMap.values());
            const withR     = leaves.filter((m) => rateMap[m.productId] != null).length;
            const cost      = leaves.reduce((s, m) => s + (m.qty * (rateMap[m.productId]     || 0)), 0);
            const baseCost  = leaves.reduce((s, m) => s + (m.qty * (baseRateMap[m.productId] || 0)), 0);
            return {
              itcd: it.itcd, code: it.code || it.itcd, name: it.item,
              categoryId: it.ic_id, category: getCategoryName(it.ic_id),
              totalMaterials: leaves.length, withRates: withR,
              missingRates: leaves.length - withR,
              totalBaseCost:   baseCost,
              totalFutureCost: cost,
              coverage: leaves.length > 0 ? Math.round((withR / leaves.length) * 100) : 0,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.categoryId - b.categoryId || a.itcd - b.itcd);

        const grandBaseCost  = summaryRows.reduce((s, r) => s + r.totalBaseCost,   0);
        const grandTotal     = summaryRows.reduce((s, r) => s + r.totalFutureCost, 0);
        const fullyCosted  = summaryRows.filter((r) => r.coverage === 100).length;
        const partlyCosted = summaryRows.filter((r) => r.coverage > 0 && r.coverage < 100).length;
        const noRates      = summaryRows.filter((r) => r.coverage === 0).length;

        const filtered = summaryRows.filter((r) =>
          !fcSearch ||
          (r.name || "").toLowerCase().includes(fcSearch.toLowerCase()) ||
          String(r.itcd).includes(fcSearch) ||
          String(r.code || "").toLowerCase().includes(fcSearch.toLowerCase())
        );

        const exportSummaryExcel = () => {
          if (!filtered.length) return;
          const ws = XLSX.utils.json_to_sheet(filtered.map((r, i) => ({
            "#": i + 1, ITCD: r.itcd, Code: r.code, "Product Name": r.name,
            Category: r.category,
            "Raw Materials": r.totalMaterials,
            "With Rates": r.withRates,
            "Missing": r.missingRates,
            "Coverage %": r.coverage,
            "Base Cost/Unit":   +r.totalBaseCost.toFixed(4),
            "Future Cost/Unit": +r.totalFutureCost.toFixed(4),
          })));
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "FC Summary");
          XLSX.writeFile(wb, `FC_Summary_${summaryPeriodLabel}.xlsx`);
        };

        const handleSummaryPrint = () => {
          if (!filtered.length) return;
          const win = window.open("", "_blank", "width=1100,height=700");
          const rows = filtered.map((r, i) => {
            const cColor = r.coverage === 100 ? "#059669" : r.coverage >= 50 ? "#d97706" : "#dc2626";
            return `<tr style="${i % 2 === 0 ? "background:#fff" : "background:#f8fafc"}">
              <td>${i + 1}</td><td style="font-family:monospace">${r.itcd}</td>
              <td style="font-family:monospace;font-size:10px">${r.code}</td>
              <td style="font-weight:600">${r.name}</td>
              <td style="text-align:center">${r.category}</td>
              <td style="text-align:center">${r.totalMaterials}</td>
              <td style="text-align:center;color:#059669;font-weight:700">${r.withRates}</td>
              <td style="text-align:center;color:#d97706">${r.missingRates > 0 ? r.missingRates : "—"}</td>
              <td style="text-align:center;font-weight:800;color:${cColor}">${r.coverage}%</td>
              <td style="text-align:right;color:#374151">${r.totalBaseCost   > 0 ? fmt(r.totalBaseCost)   : "—"}</td>
              <td style="text-align:right;font-weight:800;color:#7c3aed">${r.totalFutureCost > 0 ? fmt(r.totalFutureCost) : "—"}</td>
            </tr>`;
          }).join("");
          win.document.write(`<!DOCTYPE html><html><head>
            <title>FC Summary — ${summaryPeriodLabel}</title>
            <style>
              body{font-family:Arial,sans-serif;font-size:11px;margin:18px;color:#1f2937}
              h2{margin:0 0 3px;font-size:15px}p.sub{margin:0 0 12px;color:#6b7280;font-size:10px}
              table{width:100%;border-collapse:collapse}
              th{background:#1e1b4b;color:#fff;padding:6px 8px;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em}
              td{padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:10.5px}
              tfoot td{background:#f3e8ff;font-weight:900;color:#7c3aed;font-size:12px;padding:6px 8px;border-top:2px solid #a78bfa}
              @media print{body{margin:8mm}}
            </style></head><body>
            <h2>Product Cost Summary — Future Costing</h2>
            <p class="sub">Period: ${summaryPeriodLabel} &nbsp;·&nbsp; ${filtered.length} products &nbsp;·&nbsp; ${fullyCosted} fully costed &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString()}</p>
            <table><thead><tr>
              <th>#</th><th>ITCD</th><th>Code</th><th>Product Name</th><th>Category</th>
              <th style="text-align:center">Raw Mat.</th><th style="text-align:center">With Rates</th>
              <th style="text-align:center">Missing</th><th style="text-align:center">Coverage</th>
              <th style="text-align:right">Base Cost/Unit</th>
              <th style="text-align:right">Future Cost/Unit</th>
            </tr></thead><tbody>${rows}</tbody>
            <tfoot><tr>
              <td colspan="9" style="text-align:right;font-size:10px;color:#374151;font-weight:400">Grand Total (per unit, all products)</td>
              <td style="text-align:right;color:#374151">${fmt(grandBaseCost)}</td>
              <td style="text-align:right">${fmt(grandTotal)}</td>
            </tr></tfoot></table>
            </body></html>`);
          win.document.close();
          setTimeout(() => win.print(), 400);
        };

        // Totals row = the rows on screen (search applied) — display only.
        const shownBase   = filtered.reduce((s, r) => s + r.totalBaseCost,   0);
        const shownFuture = filtered.reduce((s, r) => s + r.totalFutureCost, 0);

        return (
          <div className="space-y-4">

            {/* Period + search */}
            {renderPeriodCard({
              searchPlaceholder: "Search product…",
              onExcel: exportSummaryExcel,
              onPrint: handleSummaryPrint,
              canExport: filtered.length > 0,
              emptyText: "No saved future costing records.",
            })}

            {!fcSelectedPeriod ? (
              <LabCard>
                <LabEmpty icon={Calendar} title="No month selected" hint="Select a future month above to generate the summary." />
              </LabCard>
            ) : fcLoading ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                </div>
                <LabCard><TableSkeleton /></LabCard>
              </>
            ) : (
              <>
                {/* Summary tiles */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <LabStat icon={Layers} label="Total products" value={summaryRows.length} hint="with BOM" />
                  <LabStat icon={CheckCircle} tone="ok" label="Fully costed" value={fullyCosted} hint="100% coverage" />
                  <LabStat icon={AlertCircle} tone={partlyCosted + noRates > 0 ? "warn" : "muted"} label="Partial / missing" value={partlyCosted + noRates} hint="need more rates" />
                  <LabStat icon={TrendingUp} label="Grand total" value={fmt(grandTotal)} hint={`PKR all products · base ${fmt(grandBaseCost)}`} />
                </div>

                {/* Summary table */}
                <LabCard
                  icon={BarChart2}
                  title="Product cost summary"
                  subtitle={`${ml(fcSelectedPeriod.month, fcSelectedPeriod.year)} · ${filtered.length} products`}
                  actions={<Chip tone="ok">{fullyCosted} fully costed</Chip>}>
                  {filtered.length === 0 ? (
                    <LabEmpty icon={Box} title={fcSearch ? "No products match search" : "No finished/semi-finished products with BOMs found"} />
                  ) : (
                    <div className="md:max-h-[65vh] md:overflow-auto">
                      <table className="vl-grid w-full text-sm md:min-w-[1180px]">
                        <thead>
                          <tr>
                            <th className={cn(GROUP_TH, PIN_TH)}></th>
                            <th className={GROUP_TH}></th>
                            <th colSpan={4} className={cn(GROUP_TH, GROUP_EDGE)}>Raw-material rates</th>
                            <th colSpan={3} className={cn(GROUP_TH, GROUP_EDGE)}>Cost per unit</th>
                            <th className={cn(GROUP_TH, GROUP_EDGE)}></th>
                          </tr>
                          <tr>
                            <th className={cn(TH, TH2, PIN_TH)}>Product</th>
                            <th className={cn(TH, TH2, "text-center")}>Category</th>
                            <th className={cn(TH, TH2, GROUP_EDGE, "text-center")}>Raw Mat.</th>
                            <th className={cn(TH, TH2, "text-center")}>With Rates</th>
                            <th className={cn(TH, TH2, "text-center")}>Missing</th>
                            <th className={cn(TH, TH2, "text-center")}>Coverage</th>
                            <th className={cn(TH, TH2, GROUP_EDGE, "text-right")}>Base</th>
                            <th className={cn(TH, TH2, "text-right")}>Future</th>
                            <th className={cn(TH, TH2, "text-right")}>Variance</th>
                            <th className={cn(TH, TH2, GROUP_EDGE, "w-24 text-center")}>Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {filtered.map((row) => (
                            <tr key={row.itcd} className="group transition-colors hover:bg-muted">
                              <td className={cn(TD, "vl-check", PIN_TD)}>
                                <ItemCell itcd={row.itcd} code={row.code} name={row.name} />
                              </td>
                              <td data-label="Category" className={cn(TD, "text-center max-md:text-left")}>
                                <Chip tone={isFinishedCategory(setup, row.categoryId) ? "brand" : "muted"}>{row.category}</Chip>
                              </td>
                              <td data-label="Raw Mat." className={cn(TD, CELL_EDGE, "text-center tabular-nums max-md:text-left")}>{row.totalMaterials}</td>
                              <td data-label="With Rates" className={cn(TD, "text-center tabular-nums max-md:text-left")}>{row.withRates}</td>
                              <td data-label="Missing" className={cn(TD, "text-center tabular-nums max-md:text-left")}>
                                {row.missingRates > 0
                                  ? <span className="font-semibold text-[#5f4b1f] dark:text-amber-300">{row.missingRates}</span>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td data-label="Coverage" className={TD}>
                                <Coverage pct={row.coverage} />
                              </td>
                              <td data-label="Base Cost/Unit" className={cn(TD, NUM, CELL_EDGE, "text-muted-foreground")}>
                                {row.totalBaseCost > 0 ? fmt(row.totalBaseCost) : "—"}
                              </td>
                              <td data-label="Future Cost/Unit" className={cn(TD, NUM, "bg-primary/5 font-semibold")}>
                                {row.totalFutureCost > 0 ? fmt(row.totalFutureCost) : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td data-label="Variance" className={cn(TD, NUM)}>
                                <Variance base={row.totalBaseCost > 0 ? row.totalBaseCost : null}
                                  future={row.totalFutureCost > 0 ? row.totalFutureCost : null} />
                              </td>
                              <td className={cn(TD, "vl-actions", CELL_EDGE, "text-center")}>
                                <Button variant="outline" size="sm"
                                  onClick={() => {
                                    const opt = productOptions.find((o) => o.value === row.itcd);
                                    if (opt) { setSelectedProduct(opt); setTab("detail"); }
                                  }}>
                                  <ListTree /> Detail
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="max-md:hidden">
                          <tr className={TOTAL_ROW}>
                            <td className={cn(TD, "bg-muted md:sticky md:left-0")}>Total · {filtered.length} products</td>
                            <td className={TD}></td>
                            <td className={TD}></td>
                            <td className={TD}></td>
                            <td className={TD}></td>
                            <td className={TD}></td>
                            <td className={cn(TD, NUM)}>{fmt(shownBase)}</td>
                            <td className={cn(TD, NUM, "text-primary")}>{fmt(shownFuture)}</td>
                            <td className={cn(TD, NUM)}><Variance base={shownBase} future={shownFuture} /></td>
                            <td className={TD}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {filtered.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span><strong className="text-foreground">{summaryRows.length}</strong> products</span>
                        <span><strong className="text-foreground">{fullyCosted}</strong> fully costed</span>
                        {(partlyCosted + noRates) > 0 && <span><strong className="text-foreground">{partlyCosted + noRates}</strong> need rates</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>All products · base <strong className="tabular-nums text-foreground">PKR {fmt(grandBaseCost)}</strong></span>
                        <span>future <strong className="tabular-nums text-primary">PKR {fmt(grandTotal)}</strong></span>
                      </div>
                    </div>
                  )}
                </LabCard>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default FutureCostingBOMView;
