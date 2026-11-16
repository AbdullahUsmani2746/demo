"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarIcon,
  TrendingUp,
  FilterIcon,
  SaveAllIcon,
  RefreshCcw,
  FileCog,
  FileSpreadsheetIcon,
  FileIcon,
  FileTextIcon,
  Loader2,
  Database,
  ClipboardCheck,
  Edit2,
  Trash2,
  Check,
  X,
  Eye,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Percent,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import AsyncSelect from "react-select/async";

const MONTH_DISPLAY_FORMAT = "MMM yyyy";
const VOUCHER_TYPE = "sale";
const ITEMS_PER_PAGE = 15;

function getThreeMonthLabels(startDate) {
  if (!startDate) return ["", "", ""];
  const first = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const second = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const third = new Date(first.getFullYear(), first.getMonth() + 2, 1);
  return [first, second, third].map((d) => format(d, MONTH_DISPLAY_FORMAT));
}

function monthStrToInt(str) {
  if (!str) return 0;
  const d = new Date(`1 ${str}`);
  if (isNaN(d.getTime())) return 0;
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

const round2 = (val) =>
  Math.round((Number.isFinite(Number(val)) ? Number(val) : 0) * 100) / 100;

export default function SalesForecastPage() {
  const [activeTab, setActiveTab] = useState("generate");

  // ── Generate Tab ──────────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    customer: null,
    baseMonthFrom: "",
    baseMonthTo: "",
    incrementPercent: "10",
    forecastMonthFrom: "",
    forecastMonthTo: "",
  });
  const [baseMonthFromDate, setBaseMonthFromDate] = useState(null);
  const [baseMonthToDate, setBaseMonthToDate] = useState(null);
  const [forecastMonthFromDate, setForecastMonthFromDate] = useState(null);
  const [forecastMonthToDate, setForecastMonthToDate] = useState(null);
  const [rawBaseData, setRawBaseData] = useState([]);
  const [forecastData, setForecastData] = useState([]);
  const [showForecast, setShowForecast] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // ── Saved Tab ─────────────────────────────────────────────────────────────
  const [savedFilter, setSavedFilter] = useState({
    customer: null,
    monthFrom: null,
    monthTo: null,
  });
  const [savedMonthFromDate, setSavedMonthFromDate] = useState(null);
  const [savedMonthToDate, setSavedMonthToDate] = useState(null);
  const [savedData, setSavedData] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [hasSavedLoad, setHasSavedLoad] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [savedPage, setSavedPage] = useState(1);

  // ── Shared ────────────────────────────────────────────────────────────────
  const [customerOptions, setCustomerOptions] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  const customSelectStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: "white",
      borderColor: state.isFocused ? "#800000" : "#e2e8f0",
      borderRadius: "0.5rem",
      minHeight: "38px",
      boxShadow: state.isFocused ? "0 0 0 2px rgba(128,0,0,0.15)" : "none",
      "&:hover": { borderColor: "#800000" },
    }),
    menu: (base) => ({ ...base, backgroundColor: "white", zIndex: 9999 }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected
        ? "#800000"
        : state.isFocused
        ? "#fef2f2"
        : "white",
      color: state.isSelected ? "white" : "#1f2937",
      fontSize: "0.875rem",
    }),
    placeholder: (base) => ({ ...base, color: "#94a3b8", fontSize: "0.875rem" }),
    singleValue: (base) => ({ ...base, fontSize: "0.875rem" }),
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const parseYearMonthToDate = (ym) => {
    if (!ym) return null;
    const [y, m] = ym.split("-").map(Number);
    if (!y || !m) return null;
    return new Date(y, m - 1, 1);
  };

  const formatDateYMD = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // ── Fetch customers ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/reports/forecast/customers")
      .then((r) => r.json())
      .then((json) => setCustomerOptions(json.data || []))
      .catch(console.error)
      .finally(() => setLoadingCustomers(false));
  }, []);

  const loadCustomerOptions = async (inputValue) =>
    customerOptions.filter((c) =>
      c.label.toLowerCase().includes(inputValue.toLowerCase())
    );

  // ── Auto-calc base month TO ───────────────────────────────────────────────
  useEffect(() => {
    if (baseMonthFromDate) {
      const to = new Date(baseMonthFromDate);
      to.setMonth(to.getMonth() + 2);
      setBaseMonthToDate(to);
      setFormData((prev) => ({
        ...prev,
        baseMonthFrom: format(baseMonthFromDate, "yyyy-MM"),
        baseMonthTo: format(to, "yyyy-MM"),
      }));
    } else {
      setBaseMonthToDate(null);
      setFormData((prev) => ({ ...prev, baseMonthFrom: "", baseMonthTo: "" }));
    }
  }, [baseMonthFromDate]);

  // ── Auto-calc forecast month TO ───────────────────────────────────────────
  useEffect(() => {
    if (forecastMonthFromDate) {
      const to = new Date(forecastMonthFromDate);
      to.setMonth(to.getMonth() + 2);
      setForecastMonthToDate(to);
      setFormData((prev) => ({
        ...prev,
        forecastMonthFrom: format(forecastMonthFromDate, "yyyy-MM"),
        forecastMonthTo: format(to, "yyyy-MM"),
      }));
    } else {
      setForecastMonthToDate(null);
      setFormData((prev) => ({
        ...prev,
        forecastMonthFrom: "",
        forecastMonthTo: "",
      }));
    }
  }, [forecastMonthFromDate]);

  // ── Re-apply increment when % changes ────────────────────────────────────
  useEffect(() => {
    if (rawBaseData.length === 0) return;
    const factor = (Number(formData.incrementPercent) || 0) / 100;
    setForecastData(
      rawBaseData.map((rec) => ({
        ...rec,
        forecastMonth1: round2(rec.average * (1 + factor)),
        forecastMonth2: round2(rec.average * (1 + factor)),
        forecastMonth3: round2(rec.average * (1 + factor)),
      }))
    );
  }, [formData.incrementPercent, rawBaseData]);

  // ── Generate forecast ─────────────────────────────────────────────────────
  const handleGenerateForecast = async () => {
    setLoading(true);
    setShowForecast(false);
    setError(null);

    try {
      const baseStart = parseYearMonthToDate(formData.baseMonthFrom);
      if (!baseStart) throw new Error("Invalid base month");

      const months = Array.from({ length: 3 }, (_, i) => ({
        start: new Date(baseStart.getFullYear(), baseStart.getMonth() + i, 1),
        end: new Date(baseStart.getFullYear(), baseStart.getMonth() + i + 1, 1),
      }));

      const lastDay = new Date(months[2].end);
      lastDay.setDate(lastDay.getDate() - 1);

      const url = new URL(`/api/voucher/${VOUCHER_TYPE}`, window.location.origin);
      url.searchParams.set("page", "1");
      url.searchParams.set("limit", "10000");
      url.searchParams.set("startDate", formatDateYMD(months[0].start));
      url.searchParams.set("endDate", formatDateYMD(lastDay));
      if (formData.customer?.value) {
        url.searchParams.set("customerId", String(formData.customer.value));
      }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();
      const vouchers = json.data || [];

      const productMap = {};
      vouchers.forEach((master) => {
        const masterDate = master.dated ? new Date(master.dated) : null;
        if (!masterDate) return;
        const monthIndex = months.findIndex(
          (m) => masterDate >= m.start && masterDate < m.end
        );
        if (monthIndex === -1) return;

        (master.transactions || []).forEach((line) => {
          if (!line.itcd || !line.qty) return;
          if (!productMap[line.itcd]) {
            productMap[line.itcd] = {
              productCode: String(line.itcd),
              productName: line.itemDetails?.item || `Item ${line.itcd}`,
              baseMonths: [0, 0, 0],
            };
          }
          productMap[line.itcd].baseMonths[monthIndex] += Number(line.qty) || 0;
        });
      });

      const baseRows = Object.values(productMap)
        .map((rec) => {
          const [m1, m2, m3] = rec.baseMonths;
          const avg = (m1 + m2 + m3) / 3;
          return {
            productCode: rec.productCode,
            productName: rec.productName,
            baseMonth1: round2(m1),
            baseMonth2: round2(m2),
            baseMonth3: round2(m3),
            average: round2(Number.isFinite(avg) ? avg : 0),
          };
        })
        .sort((a, b) => {
          const an = Number(a.productCode);
          const bn = Number(b.productCode);
          if (!isNaN(an) && !isNaN(bn)) return an - bn;
          return a.productCode.localeCompare(b.productCode);
        });

      setRawBaseData(baseRows);
      setShowForecast(true);
      setCurrentPage(1);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to generate forecast");
      setRawBaseData([]);
      setForecastData([]);
      setShowForecast(false);
    } finally {
      setLoading(false);
    }
  };

  // ── Inline edit forecast cell ─────────────────────────────────────────────
  const handleForecastCellChange = (globalIndex, field, value) => {
    setForecastData((prev) =>
      prev.map((row, i) =>
        i === globalIndex ? { ...row, [field]: value } : row
      )
    );
  };

  // ── Reset generate tab ────────────────────────────────────────────────────
  const handleReset = () => {
    setFormData({
      customer: null,
      baseMonthFrom: "",
      baseMonthTo: "",
      incrementPercent: "10",
      forecastMonthFrom: "",
      forecastMonthTo: "",
    });
    setBaseMonthFromDate(null);
    setBaseMonthToDate(null);
    setForecastMonthFromDate(null);
    setForecastMonthToDate(null);
    setShowForecast(false);
    setRawBaseData([]);
    setForecastData([]);
    setCurrentPage(1);
    setError(null);
  };

  // ── Save forecast ─────────────────────────────────────────────────────────
  const handleSaveForecast = async () => {
    if (!formData.customer) {
      alert("Please select a customer to save the forecast.");
      return;
    }
    setIsSaving(true);
    try {
      const [fcM1, fcM2, fcM3] = getThreeMonthLabels(forecastMonthFromDate);
      if (!fcM1) {
        alert("Select forecast month range first.");
        return;
      }

      const payload = [];
      forecastData.forEach((item) => {
        const itcd = Number(item.productCode);
        const cust = formData.customer.value;
        payload.push({ month: fcM1, customer: cust, itcd, qty: Number(item.forecastMonth1) || 0 });
        payload.push({ month: fcM2, customer: cust, itcd, qty: Number(item.forecastMonth2) || 0 });
        payload.push({ month: fcM3, customer: cust, itcd, qty: Number(item.forecastMonth3) || 0 });
      });

      const res = await fetch("/api/reports/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: payload }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.message || "Failed to save."); return; }
      alert(`Forecast saved! ${payload.length} records stored.`);
    } catch (err) {
      console.error(err);
      alert("Something went wrong while saving.");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Load saved forecasts ──────────────────────────────────────────────────
  const handleLoadSaved = async () => {
    setSavedLoading(true);
    setHasSavedLoad(true);
    try {
      const url = new URL("/api/reports/forecast", window.location.origin);
      if (savedFilter.customer)
        url.searchParams.set("customer", savedFilter.customer.value);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();

      let records = json.data || [];

      if (savedMonthFromDate && savedMonthToDate) {
        const fromInt = monthStrToInt(format(savedMonthFromDate, MONTH_DISPLAY_FORMAT));
        const toInt = monthStrToInt(format(savedMonthToDate, MONTH_DISPLAY_FORMAT));
        records = records.filter((r) => {
          const mInt = monthStrToInt(r.month);
          return mInt >= fromInt && mInt <= toInt;
        });
      }

      setSavedData(records);
      setSavedPage(1);
    } catch (err) {
      console.error(err);
      alert("Failed to load saved forecasts.");
    } finally {
      setSavedLoading(false);
    }
  };

  // ── Update saved record ───────────────────────────────────────────────────
  const handleUpdateRecord = async (id, qty) => {
    try {
      const res = await fetch("/api/reports/forecast", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, qty: Number(qty) }),
      });
      if (!res.ok) throw new Error("Update failed");
      setSavedData((prev) =>
        prev.map((r) => (r.id === id ? { ...r, qty: Number(qty) } : r))
      );
      setEditingRow(null);
    } catch (err) {
      console.error(err);
      alert("Failed to update record.");
    }
  };

  // ── Delete saved record ───────────────────────────────────────────────────
  const handleDeleteRecord = async (id) => {
    if (!confirm("Delete this forecast record?")) return;
    try {
      const res = await fetch("/api/reports/forecast", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Delete failed");
      setSavedData((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error(err);
      alert("Failed to delete record.");
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const [baseM1, baseM2, baseM3] = getThreeMonthLabels(baseMonthFromDate);
  const [fcM1, fcM2, fcM3] = getThreeMonthLabels(forecastMonthFromDate);

  const handleExport = async (type) => {
    try {
      setIsExporting(true);
      if (type === "excel") await exportToExcel();
      else if (type === "pdf") exportToPDF();
      else if (type === "csv") exportToCSV();
    } catch (err) {
      console.error(err);
      alert("Failed to export.");
    } finally {
      setIsExporting(false);
    }
  };

  const exportToExcel = async () => {
    const headers = ["Product Code", "Product Name", baseM1, baseM2, baseM3, "Average", fcM1, fcM2, fcM3];
    const rows = forecastData.map((r) => [r.productCode, r.productName, r.baseMonth1, r.baseMonth2, r.baseMonth3, r.average, r.forecastMonth1, r.forecastMonth2, r.forecastMonth3]);
    const res = await fetch("/api/reports/forecast/exportForecast", {
      method: "POST",
      body: JSON.stringify({ headers, rows, title: "Sales Forecast Report", generatedOn: new Date().toLocaleDateString() }),
    });
    if (!res.ok) { alert("Failed to export."); return; }
    const blob = await res.blob();
    const a = Object.assign(document.createElement("a"), {
      href: window.URL.createObjectURL(blob),
      download: `Sales_Forecast_${Date.now()}.xlsx`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportToCSV = () => {
    const headers = ["Product Code", "Product Name", baseM1, baseM2, baseM3, "Average", fcM1, fcM2, fcM3];
    const rows = forecastData.map((r) => [r.productCode, r.productName, r.baseMonth1, r.baseMonth2, r.baseMonth3, r.average, r.forecastMonth1, r.forecastMonth2, r.forecastMonth3]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: `Sales_Forecast_${Date.now()}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text("Sales Forecast Report", 40, 40);
    doc.setFontSize(9);
    doc.setTextColor(100);
    const subtitle = formData.customer
      ? `Customer: ${formData.customer.label}  |  Base: ${baseM1} → ${baseM3}  |  Increment: ${formData.incrementPercent}%`
      : `All Customers  |  Base: ${baseM1} → ${baseM3}  |  Increment: ${formData.incrementPercent}%`;
    doc.text(subtitle, 40, 56);
    autoTable(doc, {
      head: [["#", "Product Code", "Product Name", baseM1, baseM2, baseM3, "Average", fcM1, fcM2, fcM3]],
      body: forecastData.map((r, i) => [i + 1, r.productCode, r.productName, r.baseMonth1, r.baseMonth2, r.baseMonth3, r.average, r.forecastMonth1, r.forecastMonth2, r.forecastMonth3]),
      startY: 70,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [128, 0, 0], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [253, 242, 242] },
    });
    doc.save(`Sales_Forecast_${Date.now()}.pdf`);
  };

  // ── Pagination helpers ────────────────────────────────────────────────────
  const totalPages = Math.ceil(forecastData.length / ITEMS_PER_PAGE) || 1;
  const currentDataWithIndex = forecastData
    .slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
    .map((row, i) => ({ ...row, globalIndex: (currentPage - 1) * ITEMS_PER_PAGE + i }));

  const savedTotalPages = Math.ceil(savedData.length / ITEMS_PER_PAGE) || 1;
  const savedCurrentData = savedData.slice(
    (savedPage - 1) * ITEMS_PER_PAGE,
    savedPage * ITEMS_PER_PAGE
  );

  const canGenerate =
    !!formData.baseMonthFrom &&
    !!formData.baseMonthTo &&
    !!formData.forecastMonthFrom &&
    !!formData.forecastMonthTo;

  // ── Shared date-picker field ──────────────────────────────────────────────
  const DatePickerField = ({ label, hint, date, onSelect, placeholder }) => (
    <div>
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1">
        {label}
        {hint && <span className="text-slate-400 font-normal normal-case">{hint}</span>}
      </label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal text-sm h-[38px]",
              !date && "text-slate-400"
            )}
          >
            <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" />
            {date ? format(date, "MMM yyyy") : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-auto">
          <Calendar mode="single" selected={date} onSelect={onSelect} />
        </PopoverContent>
      </Popover>
    </div>
  );

  const AutoField = ({ label, date }) => (
    <div>
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1">
        {label}
        <span className="text-slate-400 font-normal normal-case">(auto)</span>
      </label>
      <Button
        variant="outline"
        disabled
        className="w-full justify-start text-sm h-[38px] text-slate-400 cursor-default"
      >
        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
        {date ? format(date, "MMM yyyy") : "Auto calculated"}
      </Button>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50/50 p-4 md:p-6">
      <div className="mx-auto max-w-full space-y-5">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-[#7f0000] via-[#9B1111] to-[#B91C1C] text-white rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/15 backdrop-blur-sm rounded-xl">
                <TrendingUp className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Sales Forecast</h1>
                <p className="text-white/75 text-sm mt-0.5">
                  Generate, edit &amp; manage forecast data based on historical sales
                </p>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 text-white/60 text-xs">
              <span className="bg-white/10 rounded-lg px-3 py-1.5 font-medium">
                {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </span>
            </div>
          </div>
        </div>

        {/* ── TABS ───────────────────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl p-1.5 shadow-sm flex gap-1 w-fit">
          {[
            { id: "generate", label: "Generate Forecast", icon: FileCog },
            { id: "saved", label: "Saved Forecasts", icon: Database },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200",
                activeTab === id
                  ? "bg-[#800000] text-white shadow-md"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB 1 — GENERATE FORECAST
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "generate" && (
          <>
            {/* Filter Card */}
            <Card className="bg-white shadow-sm border border-slate-200/80">
              <CardHeader className="px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-[#800000] rounded-xl shadow-sm">
                    <FilterIcon className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">
                      Forecast Parameters
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Set base period (3 months), growth increment, and forecast period
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">

                  {/* Customer */}
                  <div className="xl:col-span-2">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                      Customer
                      <span className="text-slate-400 font-normal normal-case">(optional — blank = all)</span>
                    </label>
                    <AsyncSelect
                      cacheOptions
                      defaultOptions={customerOptions}
                      loadOptions={loadCustomerOptions}
                      value={formData.customer}
                      onChange={(opt) =>
                        setFormData((prev) => ({ ...prev, customer: opt }))
                      }
                      placeholder="All customers"
                      styles={customSelectStyles}
                      isClearable
                      isDisabled={loadingCustomers}
                    />
                  </div>

                  {/* Base Month From */}
                  <DatePickerField
                    label="Base Month From"
                    date={baseMonthFromDate}
                    onSelect={setBaseMonthFromDate}
                    placeholder="Select month"
                  />

                  {/* Base Month To (auto) */}
                  <AutoField label="Base Month To" date={baseMonthToDate} />

                  {/* Increment % */}
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
                      Increment %
                    </label>
                    <div className="relative">
                      <Input
                        type="number"
                        name="incrementPercent"
                        value={formData.incrementPercent}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            incrementPercent: e.target.value,
                          }))
                        }
                        placeholder="e.g. 10"
                        className="pr-9 h-[38px] text-sm"
                        min="-100"
                        max="10000"
                      />
                      <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Applied to avg. Editable in table.
                    </p>
                  </div>

                  {/* Forecast Month From */}
                  <DatePickerField
                    label="Forecast Month From"
                    date={forecastMonthFromDate}
                    onSelect={setForecastMonthFromDate}
                    placeholder="Select month"
                  />

                  {/* Forecast Month To (auto) */}
                  <AutoField label="Forecast Month To" date={forecastMonthToDate} />
                </div>
              </CardContent>

              <CardFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl flex items-center justify-between flex-wrap gap-3">
                {/* Export */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 mr-1">Export:</span>
                  {[
                    { type: "excel", icon: FileSpreadsheetIcon, label: "Excel" },
                    { type: "pdf", icon: FileTextIcon, label: "PDF" },
                    { type: "csv", icon: FileIcon, label: "CSV" },
                  ].map(({ type, icon: Icon, label }) => (
                    <Button
                      key={type}
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport(type)}
                      disabled={isExporting || forecastData.length === 0}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </Button>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    className="h-9 gap-1.5"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Reset
                  </Button>

                  <Button
                    size="sm"
                    onClick={handleGenerateForecast}
                    disabled={loading || !canGenerate}
                    className="bg-[#800000] hover:bg-[#6a0000] text-white h-9 gap-2 px-5 shadow-sm"
                  >
                    {loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileCog className="w-3.5 h-3.5" />
                    )}
                    Generate
                  </Button>

                  <Button
                    size="sm"
                    onClick={handleSaveForecast}
                    disabled={!showForecast || forecastData.length === 0 || isSaving || !formData.customer}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white h-9 gap-2 px-5 shadow-sm disabled:opacity-50"
                    title={!formData.customer ? "Select a customer to save" : ""}
                  >
                    {isSaving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <SaveAllIcon className="w-3.5 h-3.5" />
                    )}
                    Save Forecast
                  </Button>
                </div>
              </CardFooter>
            </Card>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {/* No-customer save notice */}
            {showForecast && !formData.customer && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Showing aggregated data for all customers. Select a specific customer to enable Save.
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="relative">
                  <div className="animate-spin h-12 w-12 border-4 border-[#800000]/20 border-t-[#800000] rounded-full" />
                </div>
                <p className="text-slate-500 text-sm">Analysing historical sales data...</p>
              </div>
            )}

            {/* Results Table */}
            {!loading && showForecast && (
              <Card className="shadow-sm border border-slate-200/80 overflow-hidden">
                <CardHeader className="px-6 py-4 border-b border-slate-100">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-[#800000] rounded-xl shadow-sm">
                        <ClipboardCheck className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-bold text-slate-900">
                            Forecast Results
                          </CardTitle>
                          <Badge className="bg-[#800000]/10 text-[#800000] border-0 text-xs">
                            {forecastData.length} items
                          </Badge>
                        </div>
                        <CardDescription className="text-xs text-slate-500 mt-0.5">
                          {formData.customer
                            ? `Customer: ${formData.customer.label}`
                            : "All customers (aggregated)"}
                          {" · "}Base: {baseM1} → {baseM3}
                          {" · "}Forecast: {fcM1} → {fcM3}
                          {" · "}Increment: {formData.incrementPercent}%
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                      <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                      <span className="text-blue-700 text-xs font-medium">
                        Forecast qty cells are editable
                      </span>
                    </div>
                  </div>
                </CardHeader>

                <div className="overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow className="bg-[#800000] hover:bg-[#800000]">
                        <TableHead className="text-white px-3 py-3 text-xs font-bold w-10 border-r border-white/20">
                          #
                        </TableHead>
                        <TableHead className="text-white px-3 py-3 text-xs font-bold whitespace-nowrap border-r border-white/20">
                          PRODUCT CODE
                        </TableHead>
                        <TableHead className="text-white px-4 py-3 text-xs font-bold whitespace-nowrap border-r border-white/20">
                          PRODUCT NAME
                        </TableHead>
                        <TableHead
                          colSpan={3}
                          className="text-white px-4 py-3 text-xs font-bold text-center whitespace-nowrap border-r border-white/20"
                        >
                          BASE MONTHS (QTY)
                        </TableHead>
                        <TableHead className="text-white px-4 py-3 text-xs font-bold text-center whitespace-nowrap border-r border-white/20">
                          AVG
                        </TableHead>
                        <TableHead
                          colSpan={3}
                          className="text-white px-4 py-3 text-xs font-bold text-center whitespace-nowrap"
                        >
                          FORECAST MONTHS — EDITABLE
                        </TableHead>
                      </TableRow>
                      <TableRow className="bg-[#9B1111] hover:bg-[#9B1111]">
                        <TableHead className="border-r border-white/20 py-2" />
                        <TableHead className="border-r border-white/20 py-2" />
                        <TableHead className="border-r border-white/20 py-2" />
                        <TableHead className="text-white/90 px-3 py-2 text-xs text-center whitespace-nowrap border-r border-white/20">
                          {baseM1 || "Month 1"}
                        </TableHead>
                        <TableHead className="text-white/90 px-3 py-2 text-xs text-center whitespace-nowrap border-r border-white/20">
                          {baseM2 || "Month 2"}
                        </TableHead>
                        <TableHead className="text-white/90 px-3 py-2 text-xs text-center whitespace-nowrap border-r border-white/20">
                          {baseM3 || "Month 3"}
                        </TableHead>
                        <TableHead className="border-r border-white/20 py-2" />
                        <TableHead className="text-white px-3 py-2 text-xs text-center whitespace-nowrap border-r border-white/20 font-bold">
                          {fcM1 || "FC Month 1"}
                        </TableHead>
                        <TableHead className="text-white px-3 py-2 text-xs text-center whitespace-nowrap border-r border-white/20 font-bold">
                          {fcM2 || "FC Month 2"}
                        </TableHead>
                        <TableHead className="text-white px-3 py-2 text-xs text-center whitespace-nowrap font-bold">
                          {fcM3 || "FC Month 3"}
                        </TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {forecastData.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="py-16 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <div className="p-3 bg-slate-100 rounded-full">
                                <Database className="w-6 h-6 text-slate-400" />
                              </div>
                              <p className="text-slate-500 text-sm">
                                No sales data found for the selected period
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        currentDataWithIndex.map((row) => (
                          <TableRow
                            key={row.globalIndex}
                            className="hover:bg-slate-50/70 transition-colors border-b border-slate-100"
                          >
                            <TableCell className="px-3 py-2.5 text-xs text-slate-400 border-r border-slate-100 w-10">
                              {row.globalIndex + 1}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-xs font-mono font-semibold text-slate-600 border-r border-slate-100">
                              {row.productCode}
                            </TableCell>
                            <TableCell className="px-4 py-2.5 text-sm font-medium text-slate-900 border-r border-slate-100 max-w-[200px]">
                              <span className="truncate block" title={row.productName}>
                                {row.productName}
                              </span>
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-sm text-slate-600 text-center border-r border-slate-100">
                              {row.baseMonth1}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-sm text-slate-600 text-center border-r border-slate-100">
                              {row.baseMonth2}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-sm text-slate-600 text-center border-r border-slate-100">
                              {row.baseMonth3}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-sm font-bold text-[#800000] text-center border-r border-slate-100">
                              {row.average}
                            </TableCell>
                            {/* Editable forecast cells */}
                            {["forecastMonth1", "forecastMonth2", "forecastMonth3"].map(
                              (field, fi) => (
                                <TableCell
                                  key={field}
                                  className={cn(
                                    "px-2 py-1.5",
                                    fi < 2 && "border-r border-slate-100"
                                  )}
                                >
                                  <Input
                                    type="number"
                                    value={row[field]}
                                    onChange={(e) =>
                                      handleForecastCellChange(
                                        row.globalIndex,
                                        field,
                                        e.target.value
                                      )
                                    }
                                    className="h-8 text-sm text-center w-24 border-blue-200 focus:border-blue-500 focus:ring-blue-500/20 bg-blue-50/30"
                                    min="0"
                                  />
                                </TableCell>
                              )
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex-wrap gap-3">
                  <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap gap-y-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#800000]" />
                      Increment: <strong className="text-[#800000]">{formData.incrementPercent}%</strong>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      Base: <strong className="text-slate-700">{baseM1} → {baseM3}</strong>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-600" />
                      Forecast: <strong className="text-slate-700">{fcM1} → {fcM3}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">
                      {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, forecastData.length)}–
                      {Math.min(currentPage * ITEMS_PER_PAGE, forecastData.length)} of{" "}
                      {forecastData.length}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => p - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs font-semibold text-slate-700 min-w-[50px] text-center">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((p) => p + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 2 — SAVED FORECASTS
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "saved" && (
          <>
            {/* Filter card */}
            <Card className="bg-white shadow-sm border border-slate-200/80">
              <CardHeader className="px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-[#800000] rounded-xl shadow-sm">
                    <Eye className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">
                      Browse Saved Forecasts
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      View and edit previously saved forecast records. All filters are optional.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Customer */}
                  <div className="lg:col-span-2">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                      Customer
                      <span className="text-slate-400 font-normal normal-case">(optional)</span>
                    </label>
                    <AsyncSelect
                      cacheOptions
                      defaultOptions={customerOptions}
                      loadOptions={loadCustomerOptions}
                      value={savedFilter.customer}
                      onChange={(opt) =>
                        setSavedFilter((prev) => ({ ...prev, customer: opt }))
                      }
                      placeholder="All customers"
                      styles={customSelectStyles}
                      isClearable
                    />
                  </div>

                  {/* Month From */}
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
                      Month From
                    </label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal text-sm h-[38px]",
                            !savedMonthFromDate && "text-slate-400"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" />
                          {savedMonthFromDate
                            ? format(savedMonthFromDate, "MMM yyyy")
                            : "Any month"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-auto">
                        <Calendar
                          mode="single"
                          selected={savedMonthFromDate}
                          onSelect={(d) => {
                            setSavedMonthFromDate(d);
                            setSavedFilter((prev) => ({ ...prev, monthFrom: d }));
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Month To */}
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
                      Month To
                    </label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal text-sm h-[38px]",
                            !savedMonthToDate && "text-slate-400"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" />
                          {savedMonthToDate
                            ? format(savedMonthToDate, "MMM yyyy")
                            : "Any month"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-auto">
                        <Calendar
                          mode="single"
                          selected={savedMonthToDate}
                          onSelect={(d) => {
                            setSavedMonthToDate(d);
                            setSavedFilter((prev) => ({ ...prev, monthTo: d }));
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl flex justify-end">
                <Button
                  onClick={handleLoadSaved}
                  disabled={savedLoading}
                  className="bg-[#800000] hover:bg-[#6a0000] text-white h-9 gap-2 px-6 shadow-sm"
                >
                  {savedLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                  Load Records
                </Button>
              </CardFooter>
            </Card>

            {/* Empty state after load */}
            {hasSavedLoad && !savedLoading && savedData.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="p-4 bg-slate-100 rounded-full">
                  <Database className="w-8 h-8 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-slate-700 font-semibold">No saved forecasts found</p>
                  <p className="text-slate-500 text-sm mt-1">
                    Try a different filter, or generate and save a forecast first.
                  </p>
                </div>
              </div>
            )}

            {/* Saved data table */}
            {savedData.length > 0 && (
              <Card className="shadow-sm border border-slate-200/80 overflow-hidden">
                <CardHeader className="px-6 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-600 rounded-xl shadow-sm">
                      <Database className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-bold text-slate-900">
                          Saved Forecast Records
                        </CardTitle>
                        <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">
                          {savedData.length} records
                        </Badge>
                      </div>
                      <CardDescription className="text-xs text-slate-500 mt-0.5">
                        Click the pencil icon to edit a quantity. Changes are saved immediately.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow className="bg-[#800000] hover:bg-[#800000]">
                        {["#", "Customer", "Item", "Month", "Forecast Qty", "Actions"].map(
                          (h, i) => (
                            <TableHead
                              key={h}
                              className={cn(
                                "text-white px-4 py-3 text-xs font-bold whitespace-nowrap",
                                i < 5 && "border-r border-white/20",
                                i >= 3 && "text-center"
                              )}
                            >
                              {h}
                            </TableHead>
                          )
                        )}
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {savedCurrentData.map((rec, i) => {
                        const isEditing = editingRow?.id === rec.id;
                        return (
                          <TableRow
                            key={rec.id}
                            className="hover:bg-slate-50/70 transition-colors border-b border-slate-100"
                          >
                            <TableCell className="px-4 py-3 text-xs text-slate-400 border-r border-slate-100 w-10">
                              {(savedPage - 1) * ITEMS_PER_PAGE + i + 1}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-sm font-medium text-slate-800 border-r border-slate-100">
                              {rec.customerRef?.acname || `Customer ${rec.customer}`}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-sm text-slate-700 border-r border-slate-100 max-w-[200px]">
                              <span className="truncate block" title={rec.itemRef?.item}>
                                {rec.itemRef?.item || `Item ${rec.itcd}`}
                              </span>
                            </TableCell>
                            <TableCell className="px-4 py-3 text-center border-r border-slate-100">
                              <Badge
                                variant="outline"
                                className="text-xs font-mono text-slate-600"
                              >
                                {rec.month}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-4 py-3 text-center border-r border-slate-100">
                              {isEditing ? (
                                <Input
                                  type="number"
                                  value={editingRow.qty}
                                  onChange={(e) =>
                                    setEditingRow({ ...editingRow, qty: e.target.value })
                                  }
                                  className="h-8 text-sm text-center w-28 mx-auto border-blue-300 bg-blue-50/30"
                                  autoFocus
                                  min="0"
                                />
                              ) : (
                                <span className="font-semibold text-slate-800">
                                  {rec.qty !== null && rec.qty !== undefined
                                    ? Number(rec.qty).toLocaleString()
                                    : "—"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-center">
                              {isEditing ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      handleUpdateRecord(rec.id, editingRow.qty)
                                    }
                                    className="h-7 w-7 p-0 bg-emerald-600 hover:bg-emerald-700"
                                    title="Save"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingRow(null)}
                                    className="h-7 w-7 p-0"
                                    title="Cancel"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setEditingRow({ id: rec.id, qty: rec.qty ?? 0 })
                                    }
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                    title="Edit"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleDeleteRecord(rec.id)}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/50">
                  <span className="text-xs text-slate-500">
                    {Math.min((savedPage - 1) * ITEMS_PER_PAGE + 1, savedData.length)}–
                    {Math.min(savedPage * ITEMS_PER_PAGE, savedData.length)} of {savedData.length} records
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={savedPage === 1}
                      onClick={() => setSavedPage((p) => p - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs font-semibold text-slate-700 min-w-[50px] text-center">
                      {savedPage} / {savedTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={savedPage === savedTotalPages}
                      onClick={() => setSavedPage((p) => p + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
