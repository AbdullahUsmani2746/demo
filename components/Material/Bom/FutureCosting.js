"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import {
  TrendingUp, Calendar, Save, Edit3, Trash2,
  CheckCircle, RefreshCw, Search, Download, AlertCircle,
  Package, BarChart2, ArrowRight, Plus, Percent, Hash,
  Printer, Check, X, Database, FileText, Activity,
  Settings, Filter, Tag, TrendingDown, Layers,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LabHeader, LabCard, LabStat, Chip, CODE_CHIP, TH, TD, NUM, TOTAL_ROW,
  TABS_SCROLL, TABS_LIST, TABS_TRIGGER, LabEmpty,
} from "@/components/Material/shared/LabUI";

// ── constants ──────────────────────────────────────────────────────────────────
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NOW_MONTH = new Date().getMonth() + 1;
const NOW_YEAR  = new Date().getFullYear();
const YEAR_OPTIONS = [NOW_YEAR - 2, NOW_YEAR - 1, NOW_YEAR, NOW_YEAR + 1, NOW_YEAR + 2];

const mLabel  = (m, y) => `${MONTHS[m - 1]} ${y}`;
const mShort  = (m, y) => `${MONTHS_SHORT[m - 1]} '${String(y).slice(2)}`;
const fmt2    = (v) => (v == null ? "—" : Number(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmt4    = (v) => (v == null ? "—" : Number(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const lastDay = (m, y) => new Date(y, m, 0).getDate();

// Avg rate fallback priority:
//   1. future_qty + future_rate both given  → weighted avg: (closing_amt + future_amt) / (closing_qty + future_qty)
//   2. only future_rate given (no qty)      → use future_rate directly
//   3. neither given                        → fall back to closing_rate
const computeAvgRate = (closingQty, closingRate, futureQty, futureRate) => {
  const cQty  = Number(closingQty)  || 0;
  const cRate = Number(closingRate) || 0;
  const fQty  = Number(futureQty)  || 0;
  const fRate = Number(futureRate) || 0;

  if (fQty > 0 && fRate > 0) {
    const totalQty = cQty + fQty;
    if (totalQty === 0) return fRate;
    return (cQty * cRate + fQty * fRate) / totalQty;
  }
  if (fRate > 0) return fRate;   // only rate entered → use it directly
  return cRate;                   // nothing entered  → closing rate
};

// % change of the avg rate against the base (closing) rate — display only.
const deltaPct = (base, avg) => {
  const b = Number(base) || 0;
  const a = Number(avg)  || 0;
  return b > 0 && a > 0 ? ((a - b) / b) * 100 : null;
};

const errText = (e) => e?.response?.data?.error || e?.message || "Something went wrong";

// ── look ────────────────────────────────────────────────────────────────────────
// Inputs follow the shadcn input: theme border, maroon focus ring.
const FIELD = "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60";
const CELL_INPUT = "h-8 w-28 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60";
// Item column pinned to the left while the figures scroll (table layout only).
const PIN_TH = "md:sticky md:left-0 md:z-20";
const PIN_TD = "bg-background group-hover:bg-muted md:sticky md:left-0 md:z-[1] md:shadow-[1px_0_0_hsl(var(--border))]";
// Column-group header row (above the column names) and the row under it.
const GROUP_TH = "sticky top-0 z-10 h-8 bg-[#5c0000] px-3 text-center text-[11px] font-semibold uppercase tracking-wide text-primary-foreground whitespace-nowrap";
const TH2 = "top-8";

// ── sub-components ──────────────────────────────────────────────────────────────
/** Signed % change chip: a dearer rate is "bad", a cheaper one "ok". */
const DeltaChip = ({ pct }) => {
  if (pct == null) return <span className="text-xs text-muted-foreground">—</span>;
  const tone = pct > 0.01 ? "bad" : pct < -0.01 ? "ok" : "muted";
  return <Chip tone={tone} className="tabular-nums">{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</Chip>;
};

/** Saved-period chips (month · item count). */
const PeriodChips = ({ periods, isActive, onPick }) => (
  <div className="flex flex-wrap gap-2">
    {periods.map((p) => {
      const active = isActive(p);
      return (
        <button key={`${p.month}-${p.year}`} type="button" onClick={() => onPick(p)}
          aria-pressed={active}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
            active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-primary"
          )}>
          {mLabel(p.month, p.year)}
          <span className={cn("tabular-nums", active ? "opacity-80" : "opacity-60")}>({p.item_count})</span>
        </button>
      );
    })}
  </div>
);

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

/** Item cell shared by the three tables: ITCD + code chips over the name. */
const ItemCell = ({ itcd, code, name, extra }) => (
  <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-1">
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{itcd}</span>
      {code && <span className={CODE_CHIP}>{code}</span>}
      {extra}
    </div>
    <p className="mt-0.5 truncate font-medium text-foreground md:max-w-[260px]" title={name}>{name}</p>
  </div>
);

/** Month + year pair of native selects. */
const MonthYear = ({ idPrefix, month, year, onMonth, onYear }) => (
  <div className="grid grid-cols-2 gap-2">
    <div>
      <label htmlFor={`${idPrefix}-m`} className="mb-1 block text-xs text-muted-foreground">Month</label>
      <select id={`${idPrefix}-m`} value={month} onChange={(e) => onMonth(parseInt(e.target.value))} className={cn(FIELD, "w-full")}>
        {MONTHS.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
      </select>
    </div>
    <div>
      <label htmlFor={`${idPrefix}-y`} className="mb-1 block text-xs text-muted-foreground">Year</label>
      <select id={`${idPrefix}-y`} value={year} onChange={(e) => onYear(parseInt(e.target.value))} className={cn(FIELD, "w-full")}>
        {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
const FutureCosting = () => {
  const [tab, setTab] = useState("table");

  const [periods, setPeriods]     = useState([]);
  const [periodsLoading, setPL]   = useState(false);

  // One search box is on screen per tab; "/" focuses it.
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      // "/" focuses the search (Ctrl+K is the header's menu search).
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Confirmation dialog (replaces window.confirm): { title, description, action, onConfirm }.
  const [confirmBox, setConfirmBox] = useState(null);

  const loadPeriods = useCallback(async () => {
    setPL(true);
    try {
      const { data } = await axios.get("/api/future-costing");
      setPeriods(data.data || []);
    } catch { } finally { setPL(false); }
  }, []);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  // ── TAB 1 – RATES TABLE ────────────────────────────────────────────────────
  const [tblMonth,   setTblMonth]   = useState(null);
  const [tblYear,    setTblYear]    = useState(null);
  const [tblRows,    setTblRows]    = useState([]);
  const [tblLoading, setTblLoad]    = useState(false);
  const [tblSearch,  setTblSearch]  = useState("");
  const [editId,     setEditId]     = useState(null);
  const [editRate,   setEditRate]   = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadTableRows = useCallback(async (m, y) => {
    setTblLoad(true); setTblRows([]);
    try {
      const { data } = await axios.get(`/api/future-costing?month=${m}&year=${y}`);
      setTblRows(data.data || []);
    } catch { } finally { setTblLoad(false); }
  }, []);

  useEffect(() => {
    if (tab === "table" && periods.length > 0 && !tblMonth) {
      const first = periods[0];
      setTblMonth(first.month); setTblYear(first.year);
    }
  }, [tab, periods, tblMonth]);

  useEffect(() => {
    if (tblMonth && tblYear) loadTableRows(tblMonth, tblYear);
  }, [tblMonth, tblYear, loadTableRows]);

  const handleEditSave = async (id) => {
    if (editRate === "" || isNaN(parseFloat(editRate))) { toast.warning("Enter a valid rate"); return; }
    setEditSaving(true);
    try {
      await axios.put(`/api/future-costing/${id}`, { rate: parseFloat(editRate) });
      setTblRows((prev) => prev.map((r) => r.id === id ? { ...r, rate: parseFloat(editRate) } : r));
      setEditId(null);
      toast.success("Rate updated");
    } catch (e) { toast.error("Update failed", { description: errText(e) }); } finally { setEditSaving(false); }
  };

  const handleDeleteRow = (id) => {
    setConfirmBox({
      title: "Delete this rate entry?",
      description: "The saved future rate for this item will be removed.",
      action: "Delete",
      onConfirm: async () => {
        try {
          await axios.delete(`/api/future-costing/${id}`);
          setTblRows((prev) => prev.filter((r) => r.id !== id));
          loadPeriods();
          toast.success("Rate entry deleted");
        } catch (e) { toast.error("Delete failed", { description: errText(e) }); }
      },
    });
  };

  const handleDeletePeriod = (m, y) => {
    setConfirmBox({
      title: `Delete ALL rates for ${mLabel(m, y)}?`,
      description: "Every saved future rate of this month will be removed.",
      action: "Delete all",
      onConfirm: async () => {
        try {
          await axios.delete(`/api/future-costing?month=${m}&year=${y}`);
          setTblRows([]); setTblMonth(null); setTblYear(null);
          loadPeriods();
          toast.success(`Rates for ${mLabel(m, y)} deleted`);
        } catch (e) { toast.error("Delete failed", { description: errText(e) }); }
      },
    });
  };

  const tblFiltered = tblRows.filter((r) =>
    !tblSearch ||
    (r.item?.item  || "").toLowerCase().includes(tblSearch.toLowerCase()) ||
    String(r.itcd).includes(tblSearch) ||
    (r.item?.code  || "").toLowerCase().includes(tblSearch.toLowerCase())
  );

  // ── TAB 2 – INSERT RATES ───────────────────────────────────────────────────
  const [insMonth,   setInsMonth]   = useState(NOW_MONTH === 12 ? 1 : NOW_MONTH + 1);
  const [insYear,    setInsYear]    = useState(NOW_MONTH === 12 ? NOW_YEAR + 1 : NOW_YEAR);
  const [baseMonth,  setBaseMonth]  = useState(NOW_MONTH);
  const [baseYear,   setBaseYear]   = useState(NOW_YEAR);
  const [rateMode,   setRateMode]   = useState("direct");
  const [globalPct,  setGlobalPct]  = useState("");
  const [insItems,   setInsItems]   = useState([]);
  const [insLoading, setInsLoading] = useState(false);
  const [insError,   setInsError]   = useState(null);
  const [insSearch,  setInsSearch]  = useState("");
  const [saving,     setSaving]     = useState(false);
  const [saveOk,     setSaveOk]     = useState(false);

  const loadInsertItems = useCallback(async () => {
    setInsLoading(true); setInsError(null); setInsItems([]);
    try {
      // Full month date range
      const dFrom = `${baseYear}-${String(baseMonth).padStart(2, "0")}-01`;
      const dTo   = `${baseYear}-${String(baseMonth).padStart(2, "0")}-${String(lastDay(baseMonth, baseYear)).padStart(2, "0")}`;

      // Fetch stock activity with rate (uses closing_rate = blended avg cost)
      const { data: sarData } = await axios.get(
        `/api/reports/stockActivityWithRate?dateFrom=${dFrom}&dateTo=${dTo}&limit=9999`
      );

      const allItems = sarData.allData || sarData.data || [];
      // Filter to raw materials (3) and packaging (4) only
      const rawMaterials = allItems.filter(
        (it) => Number(it.category_id) === 3 || Number(it.category_id) === 4
      );

      if (rawMaterials.length === 0) {
        throw new Error(`No raw materials or packaging found for ${mLabel(baseMonth, baseYear)}.`);
      }

      // Pre-fill already-saved future rates + inputs
      const { data: savedData } = await axios.get(
        `/api/future-costing?month=${insMonth}&year=${insYear}`
      );
      const savedMap = {};
      (savedData.data || []).forEach((s) => {
        savedMap[s.itcd] = {
          rate:         s.rate,
          future_qty:   s.future_qty   || 0,
          future_rate:  s.future_rate  || 0,
        };
      });

      setInsItems(
        rawMaterials.map((it) => {
          const currentRate    = Number(it.closing_rate || it.total_cost_rate || it.opening_rate || 0);
          const closingQty     = Number(it.closing_qty  || 0);
          const closingAmount  = Number(it.closing_value || (closingQty * currentRate));
          const itcd  = Number(it.product_code);
          const saved = savedMap[itcd];
          const preFillFutQty  = saved ? saved.future_qty  : 0;
          const preFillFutRate = saved ? saved.future_rate : 0;
          return {
            itcd,
            item_name:       it.product_name || "—",
            code:            it.ink_code || String(itcd),
            category:        it.category || "—",
            category_id:     Number(it.category_id),
            current_rate:    currentRate,
            closing_qty:     closingQty,
            closing_amount:  closingAmount,
            selected:        true,
            future_qty:      preFillFutQty  > 0 ? String(preFillFutQty)  : "",
            future_rate:     preFillFutRate > 0 ? String(preFillFutRate) : "",
            avg_rate:        computeAvgRate(closingQty, currentRate, preFillFutQty, preFillFutRate),
            pct:             "",
          };
        })
      );
    } catch (e) { setInsError(e.message); } finally { setInsLoading(false); }
  }, [baseMonth, baseYear, insMonth, insYear]);

  const applyGlobalPct = (pctStr) => {
    setGlobalPct(pctStr);
    const p = parseFloat(pctStr);
    if (isNaN(p)) return;
    setInsItems((prev) => prev.map((m) => {
      const base = parseFloat(m.current_rate) || 0;
      const newRate = +(base * (1 + p / 100)).toFixed(4);
      return { ...m, pct: pctStr, future_rate: String(newRate),
        avg_rate: computeAvgRate(m.closing_qty, m.current_rate, parseFloat(m.future_qty) || 0, newRate) };
    }));
  };

  const updateItemPct = (itcd, pctStr) => {
    setInsItems((prev) => prev.map((m) => {
      if (m.itcd !== itcd) return m;
      const p = parseFloat(pctStr);
      const base = parseFloat(m.current_rate) || 0;
      const newRate = isNaN(p) ? parseFloat(m.future_rate) || 0 : +(base * (1 + p / 100)).toFixed(4);
      return { ...m, pct: pctStr,
        future_rate: isNaN(p) ? m.future_rate : String(newRate),
        avg_rate: computeAvgRate(m.closing_qty, m.current_rate, parseFloat(m.future_qty) || 0, newRate) };
    }));
  };

  const updateItemRate = (itcd, rateStr) =>
    setInsItems((prev) => prev.map((m) => {
      if (m.itcd !== itcd) return m;
      return { ...m, future_rate: rateStr, pct: "",
        avg_rate: computeAvgRate(m.closing_qty, m.current_rate, parseFloat(m.future_qty) || 0, parseFloat(rateStr) || 0) };
    }));

  const updateItemQty = (itcd, qtyStr) =>
    setInsItems((prev) => prev.map((m) => {
      if (m.itcd !== itcd) return m;
      return { ...m, future_qty: qtyStr,
        avg_rate: computeAvgRate(m.closing_qty, m.current_rate, parseFloat(qtyStr) || 0, parseFloat(m.future_rate) || 0) };
    }));

  const toggleItem  = (itcd) =>
    setInsItems((prev) => prev.map((m) => (m.itcd === itcd ? { ...m, selected: !m.selected } : m)));

  const toggleAll = () => {
    const allOn = insItems.every((m) => m.selected);
    setInsItems((prev) => prev.map((m) => ({ ...m, selected: !allOn })));
  };

  const handleSave = async () => {
    const valid = insItems.filter(
      (m) => m.selected && (
        (m.future_rate !== "" && !isNaN(parseFloat(m.future_rate))) ||
        (m.avg_rate != null && !isNaN(m.avg_rate) && m.avg_rate > 0)
      )
    );
    if (valid.length === 0) { toast.warning("Nothing to save", { description: "No selected item has a rate." }); return; }
    setSaving(true);
    try {
      await axios.post("/api/future-costing", {
        month: insMonth,
        year:  insYear,
        items: valid.map((m) => ({
          itcd:         m.itcd,
          rate:         parseFloat((m.avg_rate || 0).toFixed(4)),
          closing_qty:  m.closing_qty   || 0,
          closing_rate: m.current_rate  || 0,
          future_qty:   parseFloat(m.future_qty)  || 0,
          future_rate:  parseFloat(m.future_rate) || 0,
        })),
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
      toast.success(`${valid.length} avg rates saved for ${mLabel(insMonth, insYear)}`);
      loadPeriods();
    } catch (e) { toast.error("Save failed", { description: errText(e) }); } finally { setSaving(false); }
  };

  const insFiltered   = insItems.filter((m) =>
    !insSearch ||
    (m.item_name || "").toLowerCase().includes(insSearch.toLowerCase()) ||
    String(m.itcd).includes(insSearch) ||
    (m.code || "").toLowerCase().includes(insSearch.toLowerCase())
  );
  const selectedCount = insItems.filter((m) => m.selected).length;
  const rmCount       = insItems.filter((m) => m.category_id === 3).length;
  const pkgCount      = insItems.filter((m) => m.category_id === 4).length;

  // ── TAB 3 – REPORT ─────────────────────────────────────────────────────────
  const [rptMonth,   setRptMonth]   = useState(null);
  const [rptYear,    setRptYear]    = useState(null);
  const [rptRows,    setRptRows]    = useState([]);
  const [rptLoading, setRptLoad]    = useState(false);
  const [rptSearch,  setRptSearch]  = useState("");
  const printRef = useRef(null);

  useEffect(() => {
    if (tab === "report" && periods.length > 0 && !rptMonth) {
      const first = periods[0];
      setRptMonth(first.month); setRptYear(first.year);
    }
  }, [tab, periods, rptMonth]);

  useEffect(() => {
    if (!rptMonth || !rptYear) return;
    setRptLoad(true);
    axios.get(`/api/future-costing?month=${rptMonth}&year=${rptYear}`)
      .then(({ data }) => setRptRows(data.data || []))
      .catch(() => {})
      .finally(() => setRptLoad(false));
  }, [rptMonth, rptYear]);

  const rptFiltered = rptRows.filter((r) =>
    !rptSearch ||
    (r.item?.item  || "").toLowerCase().includes(rptSearch.toLowerCase()) ||
    String(r.itcd).includes(rptSearch) ||
    (r.item?.code  || "").toLowerCase().includes(rptSearch.toLowerCase())
  );

  const exportReport = () => {
    if (!rptFiltered.length) return;
    const ws = XLSX.utils.json_to_sheet(
      rptFiltered.map((r, i) => ({
        "#":              i + 1,
        "ITCD":           r.itcd,
        "Item Code":      r.item?.code || r.itcd,
        "Item Name":      r.item?.item || "—",
        "Month":          mLabel(rptMonth, rptYear),
        "Base Rate (PKR)": r.closing_rate || "—",
        "Avg Rate (PKR)": r.rate,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Future Rates");
    XLSX.writeFile(wb, `FutureCosting_${mLabel(rptMonth, rptYear)}.xlsx`);
  };

  const printReport = () => {
    const win = window.open("", "_blank");
    const trs = rptFiltered.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.itcd}</td>
        <td>${r.item?.code || r.itcd}</td>
        <td>${r.item?.item || "—"}</td>
        <td style="text-align:right;color:#475569">${r.closing_rate != null && r.closing_rate > 0 ? fmt2(r.closing_rate) : "—"}</td>
        <td style="text-align:right;font-weight:800;color:#3730a3">${fmt2(r.rate)}</td>
      </tr>`).join("");
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Future Costing — ${mLabel(rptMonth, rptYear)}</title>
      <style>
        *{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;padding:32px;color:#111;background:#fff}
        .header{border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:20px}
        h2{margin:0;font-size:22px;color:#312e81;font-weight:800}
        .meta{color:#6b7280;font-size:12px;margin-top:6px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
        th{background:#1e1b4b;color:#fff;padding:9px 12px;text-align:left;font-weight:700}
        th:last-child{text-align:right}
        td{padding:7px 12px;border-bottom:1px solid #e5e7eb}
        tr:nth-child(even) td{background:#f5f3ff}
        .footer{margin-top:16px;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between}
        @media print{body{padding:0}.no-print{display:none}}
      </style></head><body>
      <div class="header">
        <h2>Future Costing Rate Report</h2>
        <div class="meta">
          Period: <strong>${mLabel(rptMonth, rptYear)}</strong> &nbsp;|&nbsp;
          Items: <strong>${rptFiltered.length}</strong> &nbsp;|&nbsp;
          Generated: ${new Date().toLocaleString()}
        </div>
      </div>
      <table>
        <thead><tr><th>#</th><th>ITCD</th><th>Code</th><th>Item Name</th><th style="text-align:right">Base Rate</th><th style="text-align:right">Avg Rate (PKR)</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>
      <div class="footer">
        <span>Future Costing System</span>
        <span>Total: ${rptFiltered.length} items</span>
      </div>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  // ── display-only counts for the summary tiles ─────────────────────────────
  const totalSavedItems = periods.reduce((s, p) => s + (p.item_count || 0), 0);
  const tblUp   = tblRows.filter((r) => (deltaPct(r.closing_rate, r.rate) ?? 0) > 0.01).length;
  const tblDown = tblRows.filter((r) => (deltaPct(r.closing_rate, r.rate) ?? 0) < -0.01).length;
  const insClosingAmt = insItems.reduce((s, m) => s + (Number(m.closing_amount) || (Number(m.closing_qty) || 0) * (Number(m.current_rate) || 0)), 0);
  const insRising     = insItems.filter((m) => m.selected && (deltaPct(m.current_rate, m.avg_rate) ?? 0) > 0.01).length;
  // Totals row of the rate-entry table (the rows on screen).
  const insTotals = insFiltered.reduce((t, m) => {
    const cQty = Number(m.closing_qty) || 0;
    const cRate = Number(m.current_rate) || 0;
    t.closingAmt += Number(m.closing_amount) || (cQty * cRate);
    t.futureAmt  += (parseFloat(m.future_qty) || 0) * (parseFloat(m.future_rate) || 0);
    return t;
  }, { closingAmt: 0, futureAmt: 0 });

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="max-w-full space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <LabHeader
        icon={TrendingUp}
        title="Future Costing"
        subtitle="Plan, project and manage raw material rates by period"
        badge={periodsLoading ? "…" : `${periods.length} periods`}
        actions={
          <Button variant="outline" size="sm" onClick={loadPeriods} disabled={periodsLoading}>
            <RefreshCw className={cn(periodsLoading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {/* Tab navigation */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className={TABS_SCROLL}>
          <TabsList className={TABS_LIST}>
            {[
              { id: "table",  icon: BarChart2, label: "Rates Table"  },
              { id: "insert", icon: Plus,      label: "Insert Rates" },
              { id: "report", icon: FileText,  label: "Report"       },
            ].map(({ id, icon: Icon, label }) => (
              <TabsTrigger key={id} value={id} className={TABS_TRIGGER}>
                <Icon className="h-4 w-4" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {/* ══════════════ TAB 1 – RATES TABLE ══════════════════════════════════ */}
      {tab === "table" && (
        <div className="space-y-4">

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <LabStat icon={Calendar} label="Saved periods" value={periods.length} hint={`${totalSavedItems} rates in all`} />
            <LabStat icon={Package} label="Items this period" value={tblMonth ? tblRows.length : "—"} hint={tblMonth ? mLabel(tblMonth, tblYear) : "pick a period"} />
            <LabStat icon={TrendingUp} tone="bad" label="Above base rate" value={tblMonth ? tblUp : "—"} hint="avg rate higher" />
            <LabStat icon={TrendingDown} tone="ok" label="Below base rate" value={tblMonth ? tblDown : "—"} hint="avg rate lower" />
          </div>

          {/* Period selector */}
          <LabCard
            icon={Calendar}
            title="Select period"
            subtitle="Saved future-costing months, newest first"
            actions={tblMonth && tblYear && (
              <Button variant="outline" size="sm" onClick={() => handleDeletePeriod(tblMonth, tblYear)}
                className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground">
                <Trash2 /> Delete {mShort(tblMonth, tblYear)}
              </Button>
            )}
            bodyClassName="px-4 py-3">
            {periodsLoading && periods.length === 0 ? (
              <div className="flex flex-wrap gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-28 rounded-full" />)}</div>
            ) : periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved future costing records. Use <strong className="text-foreground">Insert Rates</strong> to get started.</p>
            ) : (
              <PeriodChips periods={periods}
                isActive={(p) => tblMonth === p.month && tblYear === p.year}
                onPick={(p) => { setTblMonth(p.month); setTblYear(p.year); setEditId(null); }} />
            )}
          </LabCard>

          {/* Rates table */}
          {tblMonth && tblYear ? (
            <LabCard
              icon={BarChart2}
              title={mLabel(tblMonth, tblYear)}
              subtitle={`${tblFiltered.length} of ${tblRows.length} items${tblSearch ? " (filtered)" : ""}`}
              actions={
                <SearchBox ref={searchRef} value={tblSearch} onChange={setTblSearch}
                  placeholder="Search ITCD, code or name…" className="w-full sm:w-64" />
              }>
              {tblLoading ? <TableSkeleton /> : tblFiltered.length === 0 ? (
                <LabEmpty icon={Package}
                  title={tblSearch ? "No items match your search" : "No data for this month"}
                  hint={tblSearch ? "Try a different ITCD, code or name." : undefined} />
              ) : (
                <div className="md:max-h-[65vh] md:overflow-auto">
                  <table className="vl-grid w-full text-sm">
                    <thead>
                      <tr>
                        <th className={cn(TH, PIN_TH)}>Item</th>
                        <th className={cn(TH, "text-right")}>Base Rate</th>
                        <th className={cn(TH, "text-right")}>Avg Rate (PKR)</th>
                        <th className={cn(TH, "text-center")}>Δ vs Base</th>
                        <th className={cn(TH, "w-28 text-center")}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {tblFiltered.map((row) => {
                        const isEditing = editId === row.id;
                        return (
                          <tr key={row.id} className={cn("group transition-colors", isEditing ? "bg-muted" : "hover:bg-muted")}>
                            <td className={cn(TD, "vl-check", PIN_TD, isEditing && "bg-muted")}>
                              <ItemCell itcd={row.itcd} code={row.item?.code} name={row.item?.item || "—"} />
                            </td>
                            <td data-label="Base Rate" className={cn(TD, NUM, "text-muted-foreground")}>
                              {row.closing_rate != null && row.closing_rate > 0 ? fmt2(row.closing_rate) : "—"}
                            </td>
                            <td data-label="Avg Rate (PKR)" className={cn(TD, NUM)}>
                              {isEditing ? (
                                <input type="number" min="0" step="0.01" aria-label="Avg rate"
                                  value={editRate} onChange={(e) => setEditRate(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(row.id); if (e.key === "Escape") setEditId(null); }}
                                  autoFocus className={cn(CELL_INPUT, "w-32 font-semibold")} />
                              ) : (
                                <span className="font-semibold text-primary">{fmt2(row.rate)}</span>
                              )}
                            </td>
                            <td data-label="Δ vs Base" className={cn(TD, "text-center")}>
                              <DeltaChip pct={deltaPct(row.closing_rate, row.rate)} />
                            </td>
                            <td className={cn(TD, "vl-actions")}>
                              <div className="flex items-center justify-center gap-1 max-md:justify-start">
                                {isEditing ? (
                                  <>
                                    <Button size="sm" onClick={() => handleEditSave(row.id)} disabled={editSaving}>
                                      {editSaving ? <RefreshCw className="animate-spin" /> : <Check />} Save
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditId(null)} aria-label="Cancel">
                                      <X />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-primary"
                                      onClick={() => { setEditId(row.id); setEditRate(String(row.rate)); }} title="Edit rate" aria-label="Edit rate">
                                      <Edit3 />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                      onClick={() => handleDeleteRow(row.id)} title="Delete" aria-label="Delete">
                                      <Trash2 />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!tblLoading && tblFiltered.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
                  <p>
                    Showing <strong className="text-foreground">{tblFiltered.length}</strong> items
                    {tblSearch && ` matching "${tblSearch}"`}
                  </p>
                  <p>Period: {mLabel(tblMonth, tblYear)}</p>
                </div>
              )}
            </LabCard>
          ) : periods.length > 0 ? (
            <LabCard>
              <LabEmpty icon={Calendar} title="No period selected" hint="Select a period above to view its future rates." />
            </LabCard>
          ) : null}
        </div>
      )}

      {/* ══════════════ TAB 2 – INSERT RATES ═════════════════════════════════ */}
      {tab === "insert" && (
        <div className="space-y-4">

          {/* Configuration panel */}
          <LabCard icon={Settings} title="Configure period & rate mode"
            subtitle="Choose the target future month and the base reference month"
            bodyClassName="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">

              {/* Target month */}
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                  <TrendingUp className="h-3.5 w-3.5" /> Target future month
                </p>
                <MonthYear idPrefix="fc-ins" month={insMonth} year={insYear} onMonth={setInsMonth} onYear={setInsYear} />
              </div>

              {/* Base month */}
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Database className="h-3.5 w-3.5" /> Base reference month
                </p>
                <MonthYear idPrefix="fc-base" month={baseMonth} year={baseYear} onMonth={setBaseMonth} onYear={setBaseYear} />
              </div>

              {/* Rate mode */}
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" /> Rate input mode
                </p>
                <div className="space-y-2">
                  {[
                    { val: "direct",    icon: Hash,    label: "Direct rate entry", desc: "Type future rates manually" },
                    { val: "increment", icon: Percent, label: "Increment by %",    desc: "Apply % increase on base rate" },
                  ].map(({ val, icon: Ic, label, desc }) => (
                    <label key={val}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors",
                        rateMode === val ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      )}>
                      <input type="radio" name="rateMode" value={val}
                        checked={rateMode === val} onChange={() => setRateMode(val)}
                        className="mt-0.5 accent-[#800000]" />
                      <div>
                        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <Ic className="h-3 w-3 text-primary" />{label}
                        </p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Flow + actions bar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
                <Chip tone="muted">{mShort(baseMonth, baseYear)}</Chip>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <Chip tone="brand">{mShort(insMonth, insYear)}</Chip>
              </div>

              <Button onClick={loadInsertItems} disabled={insLoading} className="max-sm:flex-1">
                {insLoading ? <RefreshCw className="animate-spin" /> : <Activity />}
                {insLoading ? "Loading from Stock Activity…" : "Load Raw Materials"}
              </Button>

              {rateMode === "increment" && insItems.length > 0 && (
                <label className="flex items-center gap-2 sm:ml-auto">
                  <span className="text-xs font-medium text-muted-foreground">Apply % globally</span>
                  <span className="relative">
                    <input type="number" step="0.1" placeholder="e.g. 5"
                      value={globalPct} onChange={(e) => applyGlobalPct(e.target.value)}
                      className={cn(FIELD, "w-28 pr-7 text-right font-semibold")} />
                    <Percent className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  </span>
                </label>
              )}
            </div>
          </LabCard>

          {/* Error */}
          {insError && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold text-destructive">Failed to load</p>
                <p className="text-xs text-muted-foreground">{insError}</p>
              </div>
            </div>
          )}

          {insLoading && (
            <LabCard><TableSkeleton rows={10} /></LabCard>
          )}

          {/* Items table */}
          {insItems.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <LabStat icon={Layers} label="Loaded items" value={insItems.length} hint={`${rmCount} raw mat. · ${pkgCount} packaging`} />
                <LabStat icon={CheckCircle} label="Selected" value={selectedCount} hint={`of ${insItems.length} items`} />
                <LabStat icon={Package} label={`Closing amount (${mShort(baseMonth, baseYear)})`} value={fmt2(insClosingAmt)} hint="PKR, all loaded items" />
                <LabStat icon={TrendingUp} tone="bad" label="Avg rate rising" value={insRising} hint="selected items above closing rate" />
              </div>

              <LabCard
                icon={Plus}
                title="Raw materials — rate entry"
                subtitle={`Base ${mLabel(baseMonth, baseYear)} → Target ${mLabel(insMonth, insYear)}`}
                actions={
                  <>
                    <SearchBox ref={searchRef} value={insSearch} onChange={setInsSearch}
                      placeholder="Search ITCD, code or name…" className="w-full sm:w-60" />
                    <Button onClick={handleSave} disabled={saving || selectedCount === 0} className="max-sm:flex-1">
                      {saving ? <RefreshCw className="animate-spin" /> : saveOk ? <CheckCircle /> : <Save />}
                      {saving ? "Saving…" : saveOk ? "Saved!" : `Save ${selectedCount} Avg Rates`}
                    </Button>
                  </>
                }>
                {insFiltered.length === 0 ? (
                  <LabEmpty icon={Filter} title={insSearch ? "No items match your search" : "No items loaded"} />
                ) : (
                  <div className="md:max-h-[65vh] md:overflow-auto">
                    <table className="vl-grid w-full text-sm md:min-w-[1100px]">
                      <thead>
                        {/* Group header row */}
                        <tr>
                          <th className={cn(GROUP_TH, PIN_TH, "z-30 text-left")}></th>
                          <th colSpan={3} className={cn(GROUP_TH, "border-l border-white/20")}>
                            Closing stock ({mShort(baseMonth, baseYear)})
                          </th>
                          <th colSpan={rateMode === "increment" ? 4 : 3} className={cn(GROUP_TH, "border-l border-white/20")}>
                            Future entry ({mShort(insMonth, insYear)})
                          </th>
                          <th colSpan={2} className={cn(GROUP_TH, "border-l border-white/20")}>
                            Result
                          </th>
                        </tr>
                        {/* Column header row */}
                        <tr>
                          <th className={cn(TH, TH2, PIN_TH, "z-30")}>
                            <label className="flex items-center gap-2">
                              <input type="checkbox" checked={insItems.every((m) => m.selected)}
                                onChange={toggleAll} aria-label="Select all"
                                className="h-4 w-4 cursor-pointer rounded accent-white" />
                              Item
                            </label>
                          </th>
                          {/* Closing group */}
                          <th className={cn(TH, TH2, "border-l border-white/20 text-right")}>Closing Qty</th>
                          <th className={cn(TH, TH2, "text-right")}>Closing Rate</th>
                          <th className={cn(TH, TH2, "text-right")}>Closing Amt</th>
                          {/* Future group */}
                          {rateMode === "increment" && (
                            <th className={cn(TH, TH2, "border-l border-white/20 text-right")}>Incr. %</th>
                          )}
                          <th className={cn(TH, TH2, "text-right", rateMode !== "increment" && "border-l border-white/20")}>Future Qty</th>
                          <th className={cn(TH, TH2, "text-right")}>Future Rate</th>
                          <th className={cn(TH, TH2, "text-right")}>Future Amt</th>
                          {/* Result group */}
                          <th className={cn(TH, TH2, "border-l border-white/20 text-right")}>Avg Rate</th>
                          <th className={cn(TH, TH2, "text-center")}>Δ vs Closing</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {insFiltered.map((m) => {
                          const cQty   = Number(m.closing_qty)    || 0;
                          const cRate  = Number(m.current_rate)   || 0;
                          const cAmt   = Number(m.closing_amount) || (cQty * cRate);
                          const fQty   = parseFloat(m.future_qty)  || 0;
                          const fRate  = parseFloat(m.future_rate) || 0;
                          const fAmt   = fQty * fRate;
                          const avgR   = m.avg_rate != null ? m.avg_rate : 0;
                          const chg    = cRate > 0 ? ((avgR - cRate) / cRate) * 100 : 0;
                          const isRM   = m.category_id === 3;
                          return (
                            <tr key={m.itcd} className={cn("group transition-colors hover:bg-muted", !m.selected && "opacity-50")}>
                              <td className={cn(TD, "vl-check", PIN_TD)}>
                                <div className="flex items-start gap-2.5">
                                  <input type="checkbox" checked={m.selected} onChange={() => toggleItem(m.itcd)}
                                    aria-label={`Select ${m.item_name}`}
                                    className="mt-1 h-4 w-4 flex-shrink-0 cursor-pointer rounded accent-[#800000]" />
                                  <ItemCell itcd={m.itcd} code={m.code} name={m.item_name}
                                    extra={<Chip tone={isRM ? "ok" : "muted"} className="px-1.5 py-0 text-[10.5px]">{isRM ? "RM" : "PKG"}</Chip>} />
                                </div>
                              </td>
                              {/* Closing group */}
                              <td data-label="Closing Qty" className={cn(TD, NUM, "md:border-l md:border-border")}>{fmt4(cQty)}</td>
                              <td data-label="Closing Rate" className={cn(TD, NUM)}>{fmt2(cRate)}</td>
                              <td data-label="Closing Amt" className={cn(TD, NUM, "text-muted-foreground")}>{fmt2(cAmt)}</td>
                              {/* Future group */}
                              {rateMode === "increment" && (
                                <td data-label="Incr. %" className={cn(TD, "md:border-l md:border-border")}>
                                  <div className="relative ml-auto w-24 max-md:ml-0">
                                    <input type="number" step="0.1" value={m.pct} aria-label="Increment %"
                                      onChange={(e) => updateItemPct(m.itcd, e.target.value)}
                                      disabled={!m.selected}
                                      className={cn(CELL_INPUT, "w-full pr-6")} />
                                    <Percent className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                                  </div>
                                </td>
                              )}
                              <td data-label="Future Qty" className={cn(TD, rateMode !== "increment" && "md:border-l md:border-border")}>
                                <div className="flex justify-end max-md:justify-start">
                                  <input type="number" min="0" step="0.01" value={m.future_qty} aria-label="Future qty"
                                    onChange={(e) => updateItemQty(m.itcd, e.target.value)}
                                    disabled={!m.selected}
                                    placeholder="0"
                                    className={cn(CELL_INPUT, "max-md:w-full")} />
                                </div>
                              </td>
                              <td data-label="Future Rate" className={TD}>
                                <div className="flex justify-end max-md:justify-start">
                                  <input type="number" min="0" step="0.01" value={m.future_rate} aria-label="Future rate"
                                    onChange={(e) => updateItemRate(m.itcd, e.target.value)}
                                    disabled={!m.selected}
                                    placeholder="0.00"
                                    className={cn(CELL_INPUT, "max-md:w-full")} />
                                </div>
                              </td>
                              <td data-label="Future Amt" className={cn(TD, NUM, fAmt > 0 ? "text-foreground" : "text-muted-foreground")}>
                                {fAmt > 0 ? fmt2(fAmt) : "—"}
                              </td>
                              {/* Result group */}
                              <td data-label="Avg Rate" className={cn(TD, NUM, "bg-primary/5 md:border-l md:border-border")}>
                                <span className={cn("font-semibold", avgR > 0 ? "text-primary" : "text-muted-foreground")}>
                                  {avgR > 0 ? fmt2(avgR) : "—"}
                                </span>
                              </td>
                              <td data-label="Δ vs Closing" className={cn(TD, "bg-primary/5 text-center")}>
                                <DeltaChip pct={cRate > 0 && avgR > 0 ? chg : null} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="max-md:hidden">
                        <tr className={TOTAL_ROW}>
                          <td className={cn(TD, "bg-muted md:sticky md:left-0")}>Total · {insFiltered.length} items</td>
                          <td className={TD}></td>
                          <td className={TD}></td>
                          <td className={cn(TD, NUM)}>{fmt2(insTotals.closingAmt)}</td>
                          {rateMode === "increment" && <td className={TD}></td>}
                          <td className={TD}></td>
                          <td className={TD}></td>
                          <td className={cn(TD, NUM)}>{insTotals.futureAmt > 0 ? fmt2(insTotals.futureAmt) : "—"}</td>
                          <td className={TD}></td>
                          <td className={TD}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Footer save bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    <p>
                      <strong className="text-foreground">{selectedCount}</strong> of <strong className="text-foreground">{insItems.length}</strong> items selected
                    </p>
                    <span className="rounded-md bg-background px-2.5 py-1 font-mono text-[11px] ring-1 ring-border">
                      Avg Rate = (Closing Amt + Future Amt) ÷ (Closing Qty + Future Qty)
                    </span>
                    {insItems.filter((m) => m.selected && (m.avg_rate || 0) === 0).length > 0 && (
                      <Chip tone="warn">
                        <AlertCircle className="h-3 w-3" />
                        Some items have no qty/rate entered — avg rate will be zero
                      </Chip>
                    )}
                  </div>
                  <Button onClick={handleSave} disabled={saving || selectedCount === 0} className="max-sm:w-full">
                    {saving ? <RefreshCw className="animate-spin" /> : saveOk ? <CheckCircle /> : <Save />}
                    {saving ? "Saving…" : saveOk ? "Saved Successfully!" : `Save ${mLabel(insMonth, insYear)} Avg Rates`}
                  </Button>
                </div>
              </LabCard>
            </>
          )}

          {insItems.length === 0 && !insLoading && !insError && (
            <LabCard>
              <LabEmpty icon={Activity}
                title="Load raw materials to begin"
                hint={`Set the base month (${mLabel(baseMonth, baseYear)}) and click "Load Raw Materials". Enter Future Qty + Future Rate per item — the system will compute Avg Rate = (Closing Amt + Future Amt) ÷ (Closing Qty + Future Qty).`} />
            </LabCard>
          )}
        </div>
      )}

      {/* ══════════════ TAB 3 – REPORT ═══════════════════════════════════════ */}
      {tab === "report" && (
        <div className="space-y-4">

          {/* Period selector + actions */}
          <LabCard
            icon={FileText}
            title="Period report"
            subtitle="Saved avg rates of one month — export or print"
            actions={
              <>
                {rptRows.length > 0 && (
                  <SearchBox ref={searchRef} value={rptSearch} onChange={setRptSearch}
                    placeholder="Search…" className="w-full sm:w-52" />
                )}
                <Button variant="outline" size="sm" onClick={exportReport} disabled={!rptFiltered.length} className="max-sm:flex-1">
                  <Download /> Export
                </Button>
                <Button variant="outline" size="sm" onClick={printReport} disabled={!rptFiltered.length} className="max-sm:flex-1">
                  <Printer /> Print
                </Button>
              </>
            }
            bodyClassName="px-4 py-3">
            {periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No future costing records found.</p>
            ) : (
              <PeriodChips periods={periods}
                isActive={(p) => rptMonth === p.month && rptYear === p.year}
                onPick={(p) => { setRptMonth(p.month); setRptYear(p.year); }} />
            )}
          </LabCard>

          {/* Report stats */}
          {rptMonth && rptYear && rptFiltered.length > 0 && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <LabStat icon={Package}    label="Total items"  value={rptFiltered.length} hint="saved rates" />
              <LabStat icon={TrendingUp} label="Highest rate" value={fmt2(Math.max(...rptFiltered.map((r) => r.rate)))} hint="PKR" />
              <LabStat icon={Tag}        label="Lowest rate"  value={fmt2(Math.min(...rptFiltered.map((r) => r.rate)))} hint="PKR" />
              <LabStat icon={BarChart2}  label="Average rate" value={fmt2(rptFiltered.reduce((s, r) => s + r.rate, 0) / rptFiltered.length)} hint="PKR, simple mean" />
            </div>
          )}

          {/* Report table */}
          {rptMonth && rptYear ? (
            <div ref={printRef}>
              <LabCard
                icon={FileText}
                title="Future costing report"
                subtitle={`Period ${mLabel(rptMonth, rptYear)} · ${rptFiltered.length} items${rptSearch ? " (filtered)" : ""}`}
                actions={
                  <span className="text-xs text-muted-foreground">
                    Generated {new Date().toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                }>
                {rptLoading ? <TableSkeleton /> : rptFiltered.length === 0 ? (
                  <LabEmpty icon={Package} title={rptSearch ? "No items match your search" : "No data for this month"} />
                ) : (
                  <div className="md:max-h-[65vh] md:overflow-auto">
                    <table className="vl-grid w-full text-sm">
                      <thead>
                        <tr>
                          <th className={cn(TH, "w-12")}>#</th>
                          <th className={cn(TH, PIN_TH)}>Item</th>
                          <th className={cn(TH, "text-right")}>Base Rate</th>
                          <th className={cn(TH, "text-right")}>Avg Rate (PKR)</th>
                          <th className={cn(TH, "text-center")}>Δ vs Base</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rptFiltered.map((row, idx) => (
                          <tr key={row.id} className="group transition-colors hover:bg-muted">
                            <td data-label="#" className={cn(TD, "font-mono text-xs text-muted-foreground")}>{idx + 1}</td>
                            <td className={cn(TD, "vl-check", PIN_TD)}>
                              <ItemCell itcd={row.itcd} code={row.item?.code} name={row.item?.item || "—"} />
                            </td>
                            <td data-label="Base Rate" className={cn(TD, NUM, "text-muted-foreground")}>
                              {row.closing_rate != null && row.closing_rate > 0 ? fmt2(row.closing_rate) : "—"}
                            </td>
                            <td data-label="Avg Rate (PKR)" className={cn(TD, NUM, "font-semibold text-primary")}>{fmt2(row.rate)}</td>
                            <td data-label="Δ vs Base" className={cn(TD, "text-center")}>
                              <DeltaChip pct={deltaPct(row.closing_rate, row.rate)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="max-md:hidden">
                        <tr className={TOTAL_ROW}>
                          <td className={TD}></td>
                          <td className={TD}>{rptFiltered.length} items</td>
                          <td className={TD}></td>
                          <td className={cn(TD, NUM, "text-primary")}>
                            <span className="mr-1.5 text-xs font-normal text-muted-foreground">avg</span>
                            {fmt2(rptFiltered.reduce((s, r) => s + r.rate, 0) / rptFiltered.length)}
                          </td>
                          <td className={TD}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {!rptLoading && rptFiltered.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-4">
                      <span>Total items: <strong className="text-foreground">{rptFiltered.length}</strong></span>
                      <span>Avg rate: <strong className="text-primary">{fmt2(rptFiltered.reduce((s, r) => s + r.rate, 0) / rptFiltered.length)}</strong></span>
                    </div>
                    <p>Future Costing System · {new Date().toLocaleDateString()}</p>
                  </div>
                )}
              </LabCard>
            </div>
          ) : periods.length > 0 ? (
            <LabCard>
              <LabEmpty icon={FileText} title="No period selected" hint="Select a period above to view the report." />
            </LabCard>
          ) : null}
        </div>
      )}

      {/* Confirmation (replaces window.confirm) */}
      <AlertDialog open={!!confirmBox} onOpenChange={(o) => !o && setConfirmBox(null)}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmBox?.title}</AlertDialogTitle>
            {confirmBox?.description && <AlertDialogDescription>{confirmBox.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })}
              onClick={() => { const fn = confirmBox?.onConfirm; setConfirmBox(null); fn?.(); }}>
              {confirmBox?.action || "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FutureCosting;
