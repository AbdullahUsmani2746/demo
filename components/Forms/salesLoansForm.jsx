"use client";

// ============================================================
// SALES LOAN REGISTER
// ============================================================
// A loan is between TWO customers: goods out of customer A's Sale Order /
// Dispatch (FROM) are given to customer B (GIVEN TO), who returns them later.
// The register keeps the quantity issued, the issue date, every return with
// its date, and the live status (Open / Partially returned / Returned /
// Overdue).
//
// A memo register only — saving here never touches stock, the ledger,
// invoices or any report.
//
// A sales person records loans out of their own customers' orders and sees
// every loan where either customer is theirs; managers see all
// (lib/salesLoans/core.js).
// ============================================================

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import * as XLSX from "xlsx";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SearchableSelect from "@/components/ui/searchable-select";
import KeyboardHint, { KeyCombo } from "@/components/ui/KeyboardHint";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  HandCoins,
  Loader2,
  Package,
  PackageOpen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

// ── formatting ──────────────────────────────────────────────

const qtyFmt = (n) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const dateFmt = (v) => (v ? format(new Date(v), "dd MMM yyyy") : "—");
const isoDay = (v) => (v ? format(new Date(v), "yyyy-MM-dd") : "");
const today = () => format(new Date(), "yyyy-MM-dd");

const TH =
  "h-11 whitespace-nowrap border-b-2 border-slate-300 bg-slate-100 px-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700";
const TD = "border-b border-slate-200 px-3 py-3 align-top text-sm";

const STATUS_STYLE = {
  OPEN: { label: "Open", cls: "bg-sky-100 text-sky-800 ring-sky-300", bar: "bg-sky-500" },
  PARTIAL: { label: "Partially returned", cls: "bg-amber-100 text-amber-800 ring-amber-300", bar: "bg-amber-500" },
  RETURNED: { label: "Returned", cls: "bg-emerald-100 text-emerald-800 ring-emerald-300", bar: "bg-emerald-500" },
};

const apiError = (err, fallback) =>
  err?.response?.data?.error || err?.message || fallback;

function StatusBadge({ status, overdue }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.OPEN;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold ring-1 ${s.cls}`}>
        {s.label}
      </span>
      {overdue ? (
        <span className="inline-flex rounded-md bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 ring-1 ring-red-300">
          Overdue
        </span>
      ) : null}
    </span>
  );
}

// Returned / issued, as a bar — reads faster than three numbers.
function ReturnProgress({ issued, returned, status }) {
  const pct = issued > 0 ? Math.min(100, Math.round((returned / issued) * 100)) : 0;
  return (
    <div className="w-full min-w-[150px]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-bold tabular-nums text-slate-900">
          {qtyFmt(returned)} <span className="font-normal text-slate-500">/ {qtyFmt(issued)}</span>
        </span>
        <span className="font-semibold tabular-nums text-slate-500">{pct}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${STATUS_STYLE[status]?.bar ?? "bg-sky-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RefChips({ loan }) {
  if (!loan.so_no && !loan.dispatch_no) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {loan.so_no ? (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
          SO {loan.so_no}
        </span>
      ) : null}
      {loan.dispatch_no ? (
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
          DSP {loan.dispatch_no}
        </span>
      ) : null}
    </div>
  );
}

function PartyCell({ tone, name, code, salesPerson, children }) {
  const tones = {
    from: "border-l-orange-400",
    to: "border-l-teal-500",
  };
  return (
    <div className={`border-l-4 pl-2.5 ${tones[tone]}`}>
      <div className="max-w-[230px] truncate font-semibold text-slate-900" title={name}>{name || "—"}</div>
      <div className="text-xs text-slate-500">
        <span className="font-mono">{code ?? "—"}</span>
        {salesPerson ? <span> · {salesPerson}</span> : null}
      </div>
      {children}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────

export default function SalesLoansForm() {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [salesPerson, setSalesPerson] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  const [editing, setEditing] = useState(null); // null | "new" | loan
  const [returning, setReturning] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // Keyboard cursor: the loan the arrow keys are on.
  const [activeId, setActiveId] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo(
    () => ({
      status,
      search: debounced || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      salesPerson: salesPerson || undefined,
    }),
    [status, debounced, dateFrom, dateTo, salesPerson],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["salesLoans", params],
    queryFn: async () => (await axios.get("/api/sales-loans", { params })).data,
  });

  const loans = data?.data ?? [];
  const summary = data?.summary;
  const seesAll = Boolean(data?.seesAll);

  const { data: salesPersons = [] } = useQuery({
    queryKey: ["salesLoanOptions", "salesPersons"],
    queryFn: async () =>
      (await axios.get("/api/sales-loans/options", { params: { kind: "salesPersons" } })).data.data,
    enabled: seesAll,
    staleTime: 5 * 60 * 1000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["salesLoans"] });

  const deleteLoan = useMutation({
    mutationFn: (loan) => axios.delete(`/api/sales-loans/${loan.id}`),
    onSuccess: () => {
      toast.success("Loan deleted");
      setDeleting(null);
      refresh();
    },
    onError: (err) => toast.error(apiError(err, "Could not delete the loan")),
  });

  const deleteReturn = useMutation({
    mutationFn: ({ loanId, returnId }) =>
      axios.delete(`/api/sales-loans/${loanId}/returns`, { params: { returnId } }),
    onSuccess: () => {
      toast.success("Return entry removed — that quantity is back on loan");
      refresh();
    },
    onError: (err) => toast.error(apiError(err, "Could not remove the return")),
  });

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resetFilters = () => {
    setStatus("pending");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setSalesPerson("");
  };

  // One row per loan line with both customers, every return date and the
  // status — the complete in/out record.
  const exportExcel = () => {
    const rows = loans.flatMap((l) =>
      l.lines.map((x) => ({
        "Loan #": l.id,
        "Issue Date": dateFmt(l.issue_date),
        "From Customer": l.customer,
        "From Code": l.acno,
        "From Sales Person": l.sales_person_name || "",
        "Sale Order": l.so_no || "",
        Dispatch: l.dispatch_no || "",
        "Given To Customer": l.to_customer || "",
        "Given To Code": l.to_acno || "",
        "Given To Sales Person": l.to_sales_person_name || "",
        "Item Code": x.itemCode || "",
        Item: x.itemName,
        Unit: x.unit || "",
        "Qty Issued": x.qty_issued,
        "Qty Returned": x.qty_returned,
        "Balance Out": x.qty_balance,
        "Expected Return": l.expected_return_date ? dateFmt(l.expected_return_date) : "",
        "Return Dates": x.returns.map((r) => `${dateFmt(r.return_date)} (${qtyFmt(r.qty)})`).join(", "),
        "Last Return": x.last_return_date ? dateFmt(x.last_return_date) : "",
        Status: STATUS_STYLE[x.status]?.label ?? x.status,
        Overdue: l.overdue ? "Yes" : "",
        Purpose: l.purpose || "",
        Remarks: l.remarks || "",
      })),
    );
    if (rows.length === 0) {
      toast.info("Nothing to export");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Loans");
    XLSX.writeFile(wb, `Sales_Loan_Register_${today()}.xlsx`);
  };

  const colCount = 10;

  /* ─── Keyboard ───────────────────────────────────────────────────────
     The register can be worked without the mouse: arrows move a cursor
     over the loans, and single keys act on the loan under it. Everything
     is off while a dialog is open; the dialogs have their own keys.     */
  const dialogOpen = Boolean(editing || returning || deleting);

  // Keep the cursor on a loan that is actually in the list.
  useEffect(() => {
    if (loans.length === 0) {
      if (activeId !== null) setActiveId(null);
    } else if (!loans.some((l) => l.id === activeId)) {
      setActiveId(loans[0].id);
    }
  }, [loans, activeId]);

  const activeLoan = loans.find((l) => l.id === activeId) ?? null;

  const moveCursor = useCallback(
    (delta) => {
      if (loans.length === 0) return;
      const i = Math.max(0, loans.findIndex((l) => l.id === activeId));
      const next = loans[Math.min(Math.max(i + delta, 0), loans.length - 1)];
      setActiveId(next.id);
      document
        .querySelectorAll(`[data-loan-id="${next.id}"]`)
        .forEach((el) => el.scrollIntoView({ block: "nearest" }));
    },
    [loans, activeId],
  );

  const STATUS_KEYS = ["pending", "open", "partial", "returned", "overdue", "all"];

  useKeyboardShortcuts(
    {
      arrowdown: () => moveCursor(1),
      j: () => moveCursor(1),
      arrowup: () => moveCursor(-1),
      k: () => moveCursor(-1),
      home: () => moveCursor(-loans.length),
      end: () => moveCursor(loans.length),
      enter: () => activeLoan && toggle(activeLoan.id),
      n: () => setEditing("new"),
      e: () => activeLoan && setEditing(activeLoan),
      r: () => activeLoan && activeLoan.status !== "RETURNED" && setReturning(activeLoan),
      delete: () => activeLoan && !activeLoan.hasReturns && setDeleting(activeLoan),
      "/": () => searchRef.current?.focus(),
      x: exportExcel,
      ...Object.fromEntries(STATUS_KEYS.map((s, i) => [String(i + 1), () => setStatus(s)])),
    },
    !dialogOpen,
  );

  const SHORTCUTS = [
    { combo: "↑/↓", label: "Move between loans (J / K too)" },
    { combo: "Home/End", label: "First / last loan" },
    { combo: "Enter", label: "Open / close the loan's details" },
    { combo: "N", label: "New loan" },
    { combo: "R", label: "Record a return on the selected loan" },
    { combo: "E", label: "Edit the selected loan" },
    { combo: "Delete", label: "Delete the selected loan" },
    { combo: "/", label: "Search" },
    { combo: "1-6", label: "Not returned · Open · Partial · Returned · Overdue · All" },
    { combo: "X", label: "Export to Excel" },
    { combo: "Ctrl+S", label: "Save (inside a form)" },
    { combo: "Esc", label: "Close a form / leave the search box" },
  ];

  return (
    <div className="min-h-screen bg-slate-100/60">
      <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {/* ═══ HEADER ═══ */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-sm">
              <HandCoins className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Sales Loan Register</h1>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                Goods from
                <span className="rounded bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-800">Customer A&apos;s Sale Order</span>
                <ArrowRight className="h-3.5 w-3.5" />
                given to
                <span className="rounded bg-teal-100 px-1.5 py-0.5 font-semibold text-teal-800">Customer B</span>
                — and returned. A record only; stock and accounts are not affected.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <KeyboardHint shortcuts={SHORTCUTS} className="hidden h-10 px-3 md:inline-flex" />
            <Button variant="outline" onClick={exportExcel} className="h-10 flex-1 gap-2 bg-white sm:flex-none">
              <Download className="h-4 w-4" />
              Excel
            </Button>
            <Button onClick={() => setEditing("new")} className="h-10 flex-1 gap-2 sm:flex-none">
              <Plus className="h-4 w-4" />
              New Loan
              <span className="hidden opacity-80 md:inline"><KeyCombo combo="N" /></span>
            </Button>
          </div>
        </div>

        {/* ═══ SUMMARY ═══ */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Open" value={summary?.open} icon={Package} tone="text-sky-700" onClick={() => setStatus("open")} active={status === "open"} />
          <Stat label="Partially returned" value={summary?.partial} icon={Undo2} tone="text-amber-700" onClick={() => setStatus("partial")} active={status === "partial"} />
          <Stat label="Returned" value={summary?.returned} icon={CheckCircle2} tone="text-emerald-700" onClick={() => setStatus("returned")} active={status === "returned"} />
          <Stat label="Overdue" value={summary?.overdue} icon={AlertTriangle} tone="text-red-700" onClick={() => setStatus("overdue")} active={status === "overdue"} />
          <Stat label="Qty issued" value={summary ? qtyFmt(summary.qty_issued) : undefined} icon={ArrowDownToLine} />
          <Stat label="Qty still out" value={summary ? qtyFmt(summary.qty_balance) : undefined} icon={Clock} tone="text-red-700" />
        </div>

        {/* ═══ GRID ═══ */}
        <Card className="overflow-hidden border-2 border-slate-300 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-white p-3">
            <Tabs value={status} onValueChange={setStatus} className="w-full overflow-x-auto lg:w-auto">
              <TabsList className="h-9 w-max">
                <TabsTrigger value="pending">Not returned</TabsTrigger>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="partial">Partial</TabsTrigger>
                <TabsTrigger value="returned">Returned</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
                placeholder="Search loan #, either customer, SO, dispatch, item…  ( / )"
                className="h-9 bg-white pl-9"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-muted"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="flex w-full items-center gap-1.5 text-sm sm:w-auto">
              <span className="text-slate-600">Issued</span>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 min-w-0 flex-1 bg-white sm:w-[140px] sm:flex-none" />
              <span className="text-slate-600">to</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 min-w-0 flex-1 bg-white sm:w-[140px] sm:flex-none" />
            </div>

            {seesAll ? (
              <div className="w-full sm:w-[220px]">
                <SearchableSelect
                  inputId="loan_sales_person"
                  value={salesPerson}
                  onChange={(v) => setSalesPerson(v || "")}
                  options={salesPersons.map((u) => ({ value: u.id, label: u.name }))}
                  placeholder="All sales persons"
                />
              </div>
            ) : (
              <Badge variant="secondary" className="h-9 px-3 font-normal">Your customers</Badge>
            )}

            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 gap-1.5 text-slate-600">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            {isFetching && !isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
          </div>

          <CardContent className="bg-white p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : loans.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
                <PackageOpen className="h-10 w-10 text-slate-400" />
                <p className="font-semibold">No loans here</p>
                <p className="max-w-sm text-sm text-slate-600">
                  {status === "pending" && !search
                    ? "Nothing is out on loan right now. Use New Loan to record goods given from one customer's order to another customer."
                    : "Try another tab or clear the filters."}
                </p>
              </div>
            ) : (
              <>
              {/* ── phones / small tablets: one card per loan ── */}
              <div className="divide-y md:hidden">
                {loans.map((loan) => (
                  <LoanCard
                    key={loan.id}
                    loan={loan}
                    active={loan.id === activeId}
                    open={expanded.has(loan.id)}
                    onToggle={() => {
                      setActiveId(loan.id);
                      toggle(loan.id);
                    }}
                    onReturn={() => setReturning(loan)}
                    onEdit={() => setEditing(loan)}
                    onDelete={() => setDeleting(loan)}
                    onDeleteReturn={(returnId) => {
                      if (window.confirm("Remove this return entry? That quantity goes back on loan.")) {
                        deleteReturn.mutate({ loanId: loan.id, returnId });
                      }
                    }}
                  />
                ))}
              </div>

              {/* ── desktop: the full register ── */}
              <div className="hidden max-h-[66vh] overflow-auto md:block">
                <table className="w-full min-w-[1300px] border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={`${TH} w-8`} />
                      <th className={TH}>Loan</th>
                      <th className={TH}>From (Sale Order of)</th>
                      <th className={`${TH} w-8 px-0`} />
                      <th className={TH}>Given To</th>
                      <th className={TH}>Items</th>
                      <th className={TH}>Returned / Issued</th>
                      <th className={TH}>Return by</th>
                      <th className={TH}>Status</th>
                      <th className={`${TH} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map((loan) => {
                      const open = expanded.has(loan.id);
                      return (
                        <Fragment key={loan.id}>
                          <tr
                            data-loan-id={loan.id}
                            className={`cursor-pointer transition-colors ${
                              loan.id === activeId
                                ? "bg-primary/10 shadow-[inset_4px_0_0_0_hsl(var(--primary))]"
                                : loan.overdue
                                  ? "bg-red-50/60 hover:bg-red-50"
                                  : "hover:bg-slate-50"
                            }`}
                            onClick={() => {
                              setActiveId(loan.id);
                              toggle(loan.id);
                            }}
                          >
                            <td className={TD}>
                              {open ? <ChevronDown className="mt-0.5 h-4 w-4" /> : <ChevronRight className="mt-0.5 h-4 w-4" />}
                            </td>
                            <td className={`${TD} whitespace-nowrap`}>
                              <div className="font-mono text-base font-bold">#{loan.id}</div>
                              <div className="text-xs text-slate-500">{dateFmt(loan.issue_date)}</div>
                            </td>
                            <td className={TD}>
                              <PartyCell tone="from" name={loan.customer} code={loan.acno} salesPerson={seesAll ? loan.sales_person_name : null}>
                                <RefChips loan={loan} />
                              </PartyCell>
                            </td>
                            <td className={`${TD} px-0 text-center`}>
                              <ArrowRight className="mx-auto mt-1 h-5 w-5 text-slate-400" />
                            </td>
                            <td className={TD}>
                              <PartyCell tone="to" name={loan.to_customer} code={loan.to_acno} salesPerson={seesAll ? loan.to_sales_person_name : null} />
                            </td>
                            <td className={TD}>
                              <div className="max-w-[220px] truncate font-medium" title={loan.lines.map((l) => l.itemName).join(", ")}>
                                {loan.lines[0]?.itemName}
                              </div>
                              <div className="text-xs text-slate-500">
                                {loan.lines.length > 1 ? `+${loan.lines.length - 1} more · ` : ""}
                                {qtyFmt(loan.qty_issued)} issued
                              </div>
                            </td>
                            <td className={TD}>
                              <ReturnProgress issued={loan.qty_issued} returned={loan.qty_returned} status={loan.status} />
                              {loan.qty_balance > 0 ? (
                                <div className="mt-1 text-xs font-semibold text-red-700">{qtyFmt(loan.qty_balance)} still out</div>
                              ) : null}
                            </td>
                            <td className={`${TD} whitespace-nowrap`}>
                              <div className={loan.overdue ? "font-bold text-red-700" : ""}>{dateFmt(loan.expected_return_date)}</div>
                              {loan.last_return_date ? (
                                <div className="text-xs text-slate-500">last back {dateFmt(loan.last_return_date)}</div>
                              ) : null}
                            </td>
                            <td className={TD}><StatusBadge status={loan.status} overdue={loan.overdue} /></td>
                            <td className={`${TD} text-right`} onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                {loan.status !== "RETURNED" ? (
                                  <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setReturning(loan)}>
                                    <Undo2 className="h-3.5 w-3.5" />
                                    Return
                                  </Button>
                                ) : null}
                                <Button size="icon" variant="outline" className="h-8 w-8" title="Edit" onClick={() => setEditing(loan)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 text-red-600 hover:bg-red-50"
                                  title={loan.hasReturns ? "Remove the returns first" : "Delete"}
                                  disabled={loan.hasReturns}
                                  onClick={() => setDeleting(loan)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {open ? (
                            <tr>
                              <td colSpan={colCount} className="border-b-2 border-slate-300 bg-slate-50 px-6 py-4">
                                <LoanDetail
                                  loan={loan}
                                  onDeleteReturn={(returnId) => {
                                    if (window.confirm("Remove this return entry? That quantity goes back on loan.")) {
                                      deleteReturn.mutate({ loanId: loan.id, returnId });
                                    }
                                  }}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {editing ? (
        <LoanDialog
          loan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      {returning ? (
        <ReturnDialog
          loan={returning}
          onClose={() => setReturning(null)}
          onSaved={() => {
            setReturning(null);
            refresh();
          }}
        />
      ) : null}

      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete loan #{deleting?.id}?</DialogTitle>
            <DialogDescription>
              {deleting?.customer} → {deleting?.to_customer} · issued {dateFmt(deleting?.issue_date)}.
              This removes the record completely.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteLoan.isPending} onClick={() => deleteLoan.mutate(deleting)}>
              {deleteLoan.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── phone card ──────────────────────────────────────────────

function LoanCard({ loan, active, open, onToggle, onReturn, onEdit, onDelete, onDeleteReturn }) {
  return (
    <div
      data-loan-id={loan.id}
      className={`p-4 ${active ? "bg-primary/5 shadow-[inset_4px_0_0_0_hsl(var(--primary))]" : loan.overdue ? "bg-red-50/60" : ""}`}
    >
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="font-mono text-base font-bold">#{loan.id}</span>
            <span className="ml-2 text-xs text-slate-500">{dateFmt(loan.issue_date)}</span>
          </div>
          <StatusBadge status={loan.status} overdue={loan.overdue} />
        </div>

        <div className="mt-3 space-y-2">
          <PartyCell tone="from" name={loan.customer} code={loan.acno}>
            <RefChips loan={loan} />
          </PartyCell>
          <div className="flex items-center gap-2 pl-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <ArrowDown className="h-4 w-4" /> given to
          </div>
          <PartyCell tone="to" name={loan.to_customer} code={loan.to_acno} />
        </div>

        <div className="mt-3">
          <ReturnProgress issued={loan.qty_issued} returned={loan.qty_returned} status={loan.status} />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-600">
          <span className="truncate">
            {loan.lines[0]?.itemName}
            {loan.lines.length > 1 ? ` +${loan.lines.length - 1}` : ""}
          </span>
          <span className={loan.overdue ? "font-bold text-red-700" : ""}>
            Return by {dateFmt(loan.expected_return_date)}
          </span>
        </div>
      </button>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button
          size="sm"
          className="h-10 gap-1 bg-emerald-600 hover:bg-emerald-700"
          disabled={loan.status === "RETURNED"}
          onClick={onReturn}
        >
          <Undo2 className="h-4 w-4" />
          Return
        </Button>
        <Button size="sm" variant="outline" className="h-10 gap-1" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-10 gap-1 text-red-600"
          disabled={loan.hasReturns}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>

      {open ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <LoanDetail loan={loan} onDeleteReturn={onDeleteReturn} />
        </div>
      ) : null}
    </div>
  );
}

// ── expanded row ────────────────────────────────────────────

function LoanDetail({ loan, onDeleteReturn }) {
  return (
    <div className="space-y-3">
      {/* the route of the goods */}
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-lg border-2 border-orange-200 bg-white p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-orange-700">From — goods taken out of</div>
          <div className="mt-1 font-semibold">{loan.customer} <span className="font-mono text-xs text-slate-500">({loan.acno})</span></div>
          <div className="mt-1 text-sm text-slate-600">
            {loan.so_no ? <>Sale Order <strong>{loan.so_no}</strong> ({dateFmt(loan.so_date)})</> : "No Sale Order"}
            {loan.dispatch_no ? <> · Dispatch <strong>{loan.dispatch_no}</strong> ({dateFmt(loan.dispatch_date)})</> : null}
          </div>
          {loan.sales_person_name ? <div className="text-xs text-slate-500">Sales person: {loan.sales_person_name}</div> : null}
        </div>
        <div className="flex items-center justify-center">
          <ArrowRight className="hidden h-6 w-6 text-slate-400 md:block" />
          <ArrowDown className="h-6 w-6 text-slate-400 md:hidden" />
        </div>
        <div className="rounded-lg border-2 border-teal-200 bg-white p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700">Given to — returns the goods</div>
          <div className="mt-1 font-semibold">{loan.to_customer || "—"} <span className="font-mono text-xs text-slate-500">({loan.to_acno ?? "—"})</span></div>
          <div className="mt-1 text-sm text-slate-600">
            Issued {dateFmt(loan.issue_date)} · return by {dateFmt(loan.expected_return_date)}
          </div>
          {loan.to_sales_person_name ? <div className="text-xs text-slate-500">Sales person: {loan.to_sales_person_name}</div> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {loan.purpose ? <span><strong>Purpose:</strong> {loan.purpose}</span> : null}
        {loan.remarks ? <span><strong>Remarks:</strong> {loan.remarks}</span> : null}
        <span className="text-slate-500">Recorded by {loan.created_by_name || "—"} on {dateFmt(loan.created_at)}</span>
      </div>

      <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
        <thead>
          <tr className="bg-slate-100 text-left text-xs font-bold uppercase text-slate-700">
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Unit</th>
            <th className="px-3 py-2 text-right">Issued</th>
            <th className="px-3 py-2 text-right">Returned</th>
            <th className="px-3 py-2 text-right">Still out</th>
            <th className="px-3 py-2">Returns (date · qty)</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {loan.lines.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2">
                <span className="mr-1.5 font-mono text-xs text-slate-500">{l.itemCode}</span>
                <span className="font-medium">{l.itemName}</span>
              </td>
              <td className="px-3 py-2">{l.unit || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(l.qty_issued)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{qtyFmt(l.qty_returned)}</td>
              <td className={`px-3 py-2 text-right font-bold tabular-nums ${l.qty_balance > 0 ? "text-red-700" : "text-slate-400"}`}>
                {qtyFmt(l.qty_balance)}
              </td>
              <td className="px-3 py-2">
                {l.returns.length === 0 ? (
                  <span className="text-slate-400">none yet</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {l.returns.map((r) => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs ring-1 ring-emerald-200"
                        title={[r.remarks, r.created_by_name && `by ${r.created_by_name}`].filter(Boolean).join(" · ")}
                      >
                        {dateFmt(r.return_date)} · <strong>{qtyFmt(r.qty)}</strong>
                        <button
                          type="button"
                          onClick={() => onDeleteReturn(r.id)}
                          className="rounded p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                          title="Remove this return entry"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── new / edit loan ─────────────────────────────────────────

const emptyLine = () => ({ key: Math.random().toString(36).slice(2), itcd: "", qty_issued: "", unit: "" });

function LoanDialog({ loan, onClose, onSaved }) {
  const isEdit = Boolean(loan);
  const locked = isEdit && loan.hasReturns; // customers + items fixed after a return

  const [form, setForm] = useState(() => ({
    acno: loan ? String(loan.acno) : "",
    to_acno: loan?.to_acno ? String(loan.to_acno) : "",
    so_no: loan?.so_no ? String(loan.so_no) : "",
    dispatch_tran_id: loan?.dispatch_tran_id ? String(loan.dispatch_tran_id) : "",
    issue_date: loan ? isoDay(loan.issue_date) : today(),
    expected_return_date: loan?.expected_return_date ? isoDay(loan.expected_return_date) : "",
    purpose: loan?.purpose ?? "",
    remarks: loan?.remarks ?? "",
  }));
  const [lines, setLines] = useState(() =>
    loan
      ? loan.lines.map((l) => ({ key: String(l.id), itcd: String(l.itcd), qty_issued: String(l.qty_issued), unit: l.unit || "" }))
      : [emptyLine()],
  );
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const opt = (kind, extra = {}) => ({
    queryKey: ["salesLoanOptions", kind, extra],
    queryFn: async () =>
      (await axios.get("/api/sales-loans/options", { params: { kind, ...extra } })).data.data ?? [],
    staleTime: 5 * 60 * 1000,
  });

  const { data: myCustomers = [], isLoading: myLoading } = useQuery(opt("customers"));
  const { data: allCustomers = [], isLoading: allLoading } = useQuery(opt("allCustomers"));
  const { data: items = [], isLoading: itemsLoading } = useQuery(opt("items"));
  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    ...opt("orders", { acno: form.acno }),
    enabled: Boolean(form.acno),
  });
  const { data: dispatches = [], isLoading: dispatchesLoading } = useQuery({
    ...opt("dispatches", { acno: form.acno, so_no: form.so_no || undefined }),
    enabled: Boolean(form.acno),
  });

  const fromOptions = useMemo(
    () => myCustomers.map((c) => ({ value: String(c.acno), label: `${c.acname} (${c.acno})` })),
    [myCustomers],
  );
  // Same account cannot be on both sides.
  const toOptions = useMemo(
    () =>
      allCustomers
        .filter((c) => String(c.acno) !== form.acno)
        .map((c) => ({
          value: String(c.acno),
          label: `${c.acname} (${c.acno})${c.salesPersonName ? ` · ${c.salesPersonName}` : ""}`,
        })),
    [allCustomers, form.acno],
  );
  const itemOptions = useMemo(
    () => items.map((i) => ({ value: String(i.itcd), label: `${i.code ? `${i.code} - ` : ""}${i.item ?? ""}`, unit: i.unit })),
    [items],
  );
  const orderOptions = useMemo(
    () => orders.map((o) => ({
      value: String(o.order_no),
      label: `SO ${o.order_no} · ${dateFmt(o.dated)}${o.sale_po ? ` · PO ${o.sale_po}` : ""}`,
    })),
    [orders],
  );
  const dispatchOptions = useMemo(
    () => dispatches.map((d) => ({
      value: String(d.tran_id),
      label: `DSP ${d.dispatch_no ?? d.vr_no ?? d.tran_id} · ${dateFmt(d.dated)}${d.so_no ? ` · SO ${d.so_no}` : ""}${d.invoice_no ? ` · INV ${d.invoice_series || "E"}-${d.invoice_no}` : ""}`,
    })),
    [dispatches],
  );

  const loadFromSO = async () => {
    if (!form.so_no) return;
    try {
      const res = await axios.get("/api/sales-loans/options", { params: { kind: "orderLines", so_no: form.so_no } });
      const soLines = res.data.data ?? [];
      if (soLines.length === 0) {
        toast.info("That Sale Order has no items");
        return;
      }
      setLines(soLines.map((l) => ({ ...emptyLine(), itcd: String(l.itcd), qty_issued: String(l.qty ?? ""), unit: l.unit || "" })));
      toast.success(`${soLines.length} item${soLines.length === 1 ? "" : "s"} loaded from SO ${form.so_no} — set the quantity actually given`);
    } catch (err) {
      toast.error(apiError(err, "Could not load the Sale Order"));
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        so_no: form.so_no || null,
        dispatch_tran_id: form.dispatch_tran_id || null,
        expected_return_date: form.expected_return_date || null,
        ...(locked ? {} : { lines: lines.map((l) => ({ itcd: l.itcd, qty_issued: l.qty_issued, unit: l.unit })) }),
      };
      return isEdit ? axios.put(`/api/sales-loans/${loan.id}`, body) : axios.post("/api/sales-loans", body);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Loan updated" : "Loan recorded");
      onSaved();
    },
    onError: (err) => toast.error(apiError(err, "Could not save the loan")),
  });

  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const canSave = !save.isPending && form.acno && form.to_acno;

  // Ctrl+S / Ctrl+Enter save from anywhere in the form; Alt+A adds an item.
  // capture: these win over the register's own keys behind the dialog.
  useKeyboardShortcuts(
    {
      "ctrl+s": { handler: () => canSave && save.mutate(), allowInInput: true },
      "ctrl+enter": { handler: () => canSave && save.mutate(), allowInInput: true },
      "alt+a": { handler: () => !locked && addLine(), allowInInput: true },
    },
    true,
    true,
  );

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty_issued) || 0), 0);
  const fromName = myCustomers.find((c) => String(c.acno) === form.acno)?.acname;
  const toName = allCustomers.find((c) => String(c.acno) === form.to_acno)?.acname;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit loan #${loan.id}` : "New loan"}</DialogTitle>
          <DialogDescription>
            Goods out of one customer&apos;s Sale Order given to another customer. A record only —
            stock and accounts are not changed.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {/* FROM → TO */}
          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
            <section className="space-y-3 rounded-xl border-2 border-orange-200 bg-orange-50/40 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">A</span>
                <h3 className="text-sm font-bold uppercase tracking-wide text-orange-800">From — goods taken out of</h3>
              </div>
              <Field label="Customer (whose Sale Order)" required>
                <SearchableSelect
                  inputId="loan_from"
                  value={form.acno}
                  onChange={(v) =>
                    set({
                      acno: v || "",
                      so_no: "",
                      dispatch_tran_id: "",
                      to_acno: form.to_acno === v ? "" : form.to_acno,
                    })
                  }
                  options={fromOptions}
                  placeholder={myLoading ? "Loading…" : "Search your customers…"}
                  isDisabled={myLoading || locked}
                  emptyMessage="No customer matches"
                />
              </Field>
              <Field label="Sale Order">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchableSelect
                      inputId="loan_so"
                      value={form.so_no}
                      onChange={(v) => set({ so_no: v || "", dispatch_tran_id: "" })}
                      options={orderOptions}
                      placeholder={!form.acno ? "Select the customer first" : ordersLoading ? "Loading…" : "Search sale order…"}
                      isDisabled={!form.acno || ordersLoading}
                      emptyMessage="No sale order for this customer"
                    />
                  </div>
                  {form.so_no && !locked ? (
                    <Button type="button" variant="outline" className="bg-white" onClick={loadFromSO} title="Fill the items from this Sale Order">
                      Load items
                    </Button>
                  ) : null}
                </div>
              </Field>
              <Field label="Dispatch (optional)">
                <SearchableSelect
                  inputId="loan_dispatch"
                  value={form.dispatch_tran_id}
                  onChange={(v) => set({ dispatch_tran_id: v || "" })}
                  options={dispatchOptions}
                  placeholder={!form.acno ? "Select the customer first" : dispatchesLoading ? "Loading…" : "Search dispatch…"}
                  isDisabled={!form.acno || dispatchesLoading}
                  emptyMessage="No dispatch for this customer"
                />
              </Field>
            </section>

            <div className="flex items-center justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-white shadow">
                <ArrowRight className="hidden h-5 w-5 lg:block" />
                <ArrowDown className="h-5 w-5 lg:hidden" />
              </div>
            </div>

            <section className="space-y-3 rounded-xl border-2 border-teal-200 bg-teal-50/40 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">B</span>
                <h3 className="text-sm font-bold uppercase tracking-wide text-teal-800">Given to — returns the goods</h3>
              </div>
              <Field label="Customer receiving the goods" required>
                <SearchableSelect
                  inputId="loan_to"
                  value={form.to_acno}
                  onChange={(v) => set({ to_acno: v || "" })}
                  options={toOptions}
                  placeholder={allLoading ? "Loading…" : "Search any customer…"}
                  isDisabled={allLoading || locked}
                  emptyMessage="No customer matches"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issue date" required>
                  <Input type="date" className="bg-white" value={form.issue_date} onChange={(e) => set({ issue_date: e.target.value })} required />
                </Field>
                <Field label="Return by">
                  <Input
                    type="date"
                    className="bg-white"
                    value={form.expected_return_date}
                    min={form.issue_date || undefined}
                    onChange={(e) => set({ expected_return_date: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Purpose of loan">
                <Input className="bg-white" value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="e.g. urgent need, short supply cover" maxLength={500} />
              </Field>
            </section>
          </div>

          {/* one-line summary of what is being recorded */}
          {fromName && toName ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm text-white">
              <span className="font-semibold">{fromName}</span>
              {form.so_no ? <span className="rounded bg-white/15 px-1.5 font-mono text-xs">SO {form.so_no}</span> : null}
              <ArrowRight className="h-4 w-4 text-slate-300" />
              <span className="font-semibold">{toName}</span>
              <span className="ml-auto tabular-nums text-slate-300">{qtyFmt(totalQty)} total qty</span>
            </div>
          ) : null}

          {/* items */}
          <div className="overflow-hidden rounded-xl border-2 border-slate-200">
            <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2">
              <span className="text-sm font-bold uppercase tracking-wide text-slate-700">Items given</span>
              {locked ? (
                <span className="text-xs text-amber-700">Returns are recorded, so customers and items are fixed. Remove the returns to change them.</span>
              ) : (
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={addLine}>
                  <Plus className="h-3.5 w-3.5" />
                  Add item
                  <span className="hidden opacity-70 md:inline"><KeyCombo combo="Alt+A" /></span>
                </Button>
              )}
            </div>
            <div className="hidden grid-cols-[28px_1fr_140px_90px_36px] gap-2 border-b bg-white px-3 py-1.5 text-xs font-bold uppercase text-slate-500 sm:grid">
              <span>#</span><span>Item</span><span className="text-right">Qty</span><span>Unit</span><span />
            </div>
            <div className="divide-y bg-white">
              {lines.map((line, i) => (
                // Phones: item on its own row, then qty · unit · remove.
                <div key={line.key} className="grid grid-cols-[1fr_80px_36px] items-center gap-2 px-3 py-2 sm:grid-cols-[28px_1fr_140px_90px_36px]">
                  <span className="hidden text-sm font-semibold text-slate-400 sm:block">{i + 1}</span>
                  <div className="col-span-3 sm:col-span-1">
                  <SearchableSelect
                    inputId={`loan_item_${i}`}
                    value={line.itcd}
                    onChange={(v, o) =>
                      setLines((ls) => ls.map((x) => (x.key === line.key ? { ...x, itcd: v || "", unit: x.unit || o?.unit || "" } : x)))
                    }
                    options={itemOptions}
                    placeholder={itemsLoading ? "Loading items…" : "Search item by code or name…"}
                    isDisabled={itemsLoading || locked}
                    emptyMessage="No item matches"
                  />
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Qty"
                    value={line.qty_issued}
                    disabled={locked}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.key === line.key ? { ...x, qty_issued: e.target.value } : x)))}
                    className="text-right font-semibold tabular-nums"
                  />
                  <Input
                    placeholder="Unit"
                    value={line.unit}
                    disabled={locked}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.key === line.key ? { ...x, unit: e.target.value } : x)))}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-slate-500 hover:text-red-600"
                    disabled={locked || lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== line.key))}
                    title="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <Field label="Remarks">
            <Textarea value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} rows={2} maxLength={1000} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSave}>
              {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              {isEdit ? "Save changes" : "Record loan"}
              <span className="ml-1.5 hidden opacity-80 md:inline"><KeyCombo combo="Ctrl+S" /></span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── record a return ─────────────────────────────────────────

function ReturnDialog({ loan, onClose, onSaved }) {
  const openLines = loan.lines.filter((l) => l.qty_balance > 0);
  const [returnDate, setReturnDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  const [qty, setQty] = useState(() => Object.fromEntries(openLines.map((l) => [l.id, ""])));

  const save = useMutation({
    mutationFn: () =>
      axios.post(`/api/sales-loans/${loan.id}/returns`, {
        return_date: returnDate,
        remarks,
        lines: Object.entries(qty)
          .filter(([, v]) => Number(v) > 0)
          .map(([line_id, v]) => ({ line_id: Number(line_id), qty: Number(v) })),
      }),
    onSuccess: () => {
      toast.success("Return recorded");
      onSaved();
    },
    onError: (err) => toast.error(apiError(err, "Could not record the return")),
  });

  const over = openLines.some((l) => Number(qty[l.id]) > l.qty_balance + 1e-6);
  const anyQty = openLines.some((l) => Number(qty[l.id]) > 0);
  const canSave = !save.isPending && !over && anyQty;
  const returnAll = () => setQty(Object.fromEntries(openLines.map((l) => [l.id, String(l.qty_balance)])));

  useKeyboardShortcuts(
    {
      "ctrl+s": { handler: () => canSave && save.mutate(), allowInInput: true },
      "ctrl+enter": { handler: () => canSave && save.mutate(), allowInInput: true },
      "alt+a": { handler: returnAll, allowInInput: true },
    },
    true,
    true,
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record return · loan #{loan.id}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="font-semibold text-teal-800">{loan.to_customer}</span>
              returns to
              <span className="font-semibold text-orange-800">{loan.customer}</span>
              {loan.so_no ? <span className="font-mono text-xs">(SO {loan.so_no})</span> : null}
              · issued {dateFmt(loan.issue_date)}
            </div>
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
            <Field label="Return date" required>
              <Input type="date" value={returnDate} min={isoDay(loan.issue_date)} onChange={(e) => setReturnDate(e.target.value)} required />
            </Field>
            <Field label="Remarks">
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={1} maxLength={500} />
            </Field>
          </div>

          <div className="overflow-x-auto rounded-lg border-2 border-slate-200">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-slate-100 text-left text-xs font-bold uppercase text-slate-700">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Issued</th>
                  <th className="px-3 py-2 text-right">Returned</th>
                  <th className="px-3 py-2 text-right">Still out</th>
                  <th className="w-[170px] px-3 py-2 text-right">Returning now</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {openLines.map((l) => {
                  const bad = Number(qty[l.id]) > l.qty_balance + 1e-6;
                  return (
                    <tr key={l.id}>
                      <td className="px-3 py-2">
                        <span className="mr-1 font-mono text-xs text-slate-500">{l.itemCode}</span>
                        {l.itemName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(l.qty_issued)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(l.qty_returned)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-red-700">{qtyFmt(l.qty_balance)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={qty[l.id]}
                            onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                            className={`h-9 text-right tabular-nums ${bad ? "border-red-500 bg-red-50" : ""}`}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 px-2 text-xs"
                            onClick={() => setQty((q) => ({ ...q, [l.id]: String(l.qty_balance) }))}
                            title="Return everything still out"
                          >
                            All
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {over ? (
            <p className="text-sm font-semibold text-red-600">A quantity is more than what is still out on that item.</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={returnAll}>
              Return everything
              <span className="ml-1.5 hidden opacity-70 md:inline"><KeyCombo combo="Alt+A" /></span>
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSave} className="bg-emerald-600 hover:bg-emerald-700">
              {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" />}
              Save return
              <span className="ml-1.5 hidden opacity-80 md:inline"><KeyCombo combo="Ctrl+S" /></span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── small parts ─────────────────────────────────────────────

function Field({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold text-slate-700">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = "text-slate-900", onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex items-start justify-between gap-2 rounded-xl border-2 bg-white p-3 text-left shadow-sm transition ${
        active ? "border-primary ring-2 ring-primary/25" : "border-slate-300"
      } ${onClick ? "hover:border-slate-400" : ""}`}
    >
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</div>
        {value === undefined ? (
          <Skeleton className="mt-1 h-7 w-14" />
        ) : (
          <div className={`text-2xl font-extrabold tabular-nums ${tone}`}>{value}</div>
        )}
      </div>
      <Icon className={`h-5 w-5 shrink-0 ${tone}`} />
    </button>
  );
}
