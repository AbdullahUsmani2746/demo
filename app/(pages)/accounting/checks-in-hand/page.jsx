"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { DateField } from "@/components/ui/date-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  FileBarChart,
  RefreshCw,
  Wallet,
  Clock3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LabHeader,
  LabEmpty,
  Chip,
  CHIP,
  CODE_CHIP,
  TH_ROW,
  TH,
  TD,
  NUM,
  TOTAL_ROW,
} from "@/components/Material/shared/LabUI";
import CheckEntryDialog from "@/components/ChecksInHand/CheckEntryDialog";
import CustomerCombobox from "@/components/ChecksInHand/CustomerCombobox";
import TransferBankCombobox from "@/components/ChecksInHand/TransferBankCombobox";
import { CHECK_STATUS } from "@/lib/accounts/checksInHand";
import { formatDMY, toISODate, todayISO } from "@/lib/date-format";

const PAGE_SIZES = [25, 50, 100, 200];

const money = (n) =>
  Number(n || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

// Every date on this screen is day-first (DD-MM-YYYY), typed and read the same
// way — see lib/date-format.js.
const showDate = (value) => formatDMY(value);

const startOfYearISO = () => toISODate(new Date(new Date().getFullYear(), 0, 1));

const DEFAULT_FILTERS = {
  dateFrom: startOfYearISO(),
  dateTo: todayISO(),
  dateField: "chqDate",
  acno: "",
  depAcno: "",
  salesPerson: "",
  status: "all",
  category: "all",
  search: "",
};

// Windowed page list with ellipses: 1 … 4 5 [6] 7 8 … 42
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push("…");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push("…");
  out.push(total);
  return out;
}

export default function ChecksInHandPage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [showFilters, setShowFilters] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const searchRef = useRef(null);

  // "/" focuses the search (Ctrl+K is the header's menu search).
  useEffect(() => {
    const onKey = (e) => {
      const typing =
        /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const queryParams = useMemo(
    () => ({ ...filters, page, limit: pageSize }),
    [filters, page, pageSize]
  );

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["checks-in-hand", "list", queryParams],
    queryFn: async () => {
      const res = await axios.get("/api/accounts/checks-in-hand", {
        params: queryParams,
      });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });

  // Sales persons = users assigned to customers (same list as the reports)
  const { data: salesPersons = [] } = useQuery({
    queryKey: ["customer-sales-persons"],
    queryFn: async () => {
      const res = await axios.get("/api/accounts/customer-sales-persons");
      return res.data?.data ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });

  const rows = data?.data ?? [];
  const summary = data?.summary ?? {};
  const pagination = data?.pagination ?? { page: 1, totalPages: 1, total: 0 };

  const firstRow = pagination.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, pagination.total);

  // ── The one action this screen exists for: flip the status. ───────────────
  // Clearing stamps today's deposit date server-side; reverting wipes it.
  const changeStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const res = await axios.patch(`/api/accounts/checks-in-hand/${id}`, { status });
      return res.data?.data;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["checks-in-hand"] });
      if (updated?.status === CHECK_STATUS.CLEARED) {
        toast.success(
          `Cheque ${updated.chqNo} cleared — deposited ${showDate(updated.depDate)}`
        );
      } else {
        toast.success(`Cheque ${updated?.chqNo ?? ""} moved back to Pending`);
      }
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error || "Could not change the status"),
  });

  // ── Inline field edits straight from the row ─────────────────────────────
  // Transfer bank, deposit date and remarks are the three things the desk
  // changes after a cheque is already on the list, so they are editable in
  // place rather than through the edit dialog. PUT only writes the keys it is
  // given, so a one-field payload cannot blank the rest of the row.
  const saveField = useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const res = await axios.put(`/api/accounts/checks-in-hand/${id}`, fields);
      return res.data?.data;
    },
    onSuccess: (updated) => {
      if (!updated) return;
      // Patch the row in place. A full refetch here would reorder/re-render
      // the table under the cursor while the user is still editing.
      queryClient.setQueriesData({ queryKey: ["checks-in-hand", "list"] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          // PUT's response has no salesPersonName (list-only field) — keep the row's
          data: old.data.map((r) =>
            r.id === updated.id ? { ...updated, salesPersonName: r.salesPersonName } : r
          ),
        };
      });
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || "Could not save the change");
      // The optimistic value is gone — pull the truth back from the server.
      queryClient.invalidateQueries({ queryKey: ["checks-in-hand"] });
    },
  });

  const savingId = saveField.isPending ? saveField.variables?.id : null;

  const remove = useMutation({
    mutationFn: async (id) => axios.delete(`/api/accounts/checks-in-hand/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checks-in-hand"] });
      toast.success("Cheque deleted");
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || "Could not delete the cheque");
      setPendingDelete(null);
    },
  });

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (cheque) => {
    setEditing(cheque);
    setDialogOpen(true);
  };

  const applySearch = () => setFilter({ search: searchInput.trim() });

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchInput("");
    setPage(1);
  };

  const activeFilterCount = [
    filters.acno !== "",
    filters.depAcno !== "",
    filters.salesPerson !== "",
    filters.status !== "all",
    filters.category !== "all",
    filters.search !== "",
    filters.dateField !== DEFAULT_FILTERS.dateField,
    filters.dateFrom !== DEFAULT_FILTERS.dateFrom ||
      filters.dateTo !== DEFAULT_FILTERS.dateTo,
  ].filter(Boolean).length;

  // Amount of the cheques on this page (the summary tiles cover the whole
  // filtered set; this is just the visible rows).
  const pageAmount = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-muted/40">
        <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-5 sm:px-6">
          {/* ── Header ─────────────────────────────────────────────────── */}
          <LabHeader
            icon={Wallet}
            breadcrumb="Accounting"
            title="Checks In Hand"
            subtitle="Customer cheques held by the company — enter as Pending, flip the switch once deposited."
            actions={
              <>
                <Button variant="outline" className="h-10" asChild>
                  <Link href="/accounting/reports/checksInHand">
                    <FileBarChart className="h-4 w-4" />
                    Report
                  </Link>
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 max-sm:!flex-none"
                      onClick={() => refetch()}
                      disabled={isFetching}
                      aria-label="Refresh"
                    >
                      <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
                <Button className="h-10" onClick={openNew}>
                  <Plus className="h-4 w-4" />
                  New Cheque
                </Button>
              </>
            }
          />

          {/* ── Summary: full amounts (not "12.4M") — these are cheque
                totals someone reads off to a bank. ─────────────────────── */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryTile
              icon={Wallet}
              label="Total"
              count={summary.totalCount}
              amount={summary.totalAmount}
              loading={isLoading}
              tone="brand"
            />
            <SummaryTile
              icon={Clock3}
              label="Pending (in hand)"
              count={summary.pendingCount}
              amount={summary.pendingAmount}
              loading={isLoading}
              tone="warn"
            />
            <SummaryTile
              icon={CheckCircle2}
              label="Cleared (deposited)"
              count={summary.clearedCount}
              amount={summary.clearedAmount}
              loading={isLoading}
              tone="ok"
            />
          </div>

          <section className="overflow-clip rounded-xl border border-border bg-background">
            {/* ── Toolbar: search + the two controls used most, with the
                  rest behind a toggle so the default view stays one line ── */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <label className="flex h-10 min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:basis-[260px]">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  ref={searchRef}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                  placeholder="Search cheque no., bank, customer, brought by…"
                  aria-label="Search cheques"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applySearch()}
                />
                {searchInput ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchInput("");
                      setFilter({ search: "" });
                    }}
                    className="hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">
                    /
                  </kbd>
                )}
              </label>

              <Select value={filters.status} onValueChange={(v) => setFilter({ status: v })}>
                <SelectTrigger className="h-10 w-[calc(50%-0.25rem)] text-sm sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="CLEARED">Cleared</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.category}
                onValueChange={(v) => setFilter({ category: v, acno: "" })}
              >
                <SelectTrigger className="h-10 w-[calc(50%-0.25rem)] text-sm sm:w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Both books</SelectItem>
                  <SelectItem value="active">Official book</SelectItem>
                  <SelectItem value="inactive">Unofficial book</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant={showFilters ? "secondary" : "outline"}
                className="h-10"
                aria-expanded={showFilters}
                onClick={() => setShowFilters((s) => !s)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-1 rounded-full bg-primary px-1.5 text-[10.5px] font-semibold tabular-nums text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>

              {activeFilterCount > 0 && (
                <Button variant="ghost" className="h-10 text-muted-foreground" onClick={resetFilters}>
                  Reset
                </Button>
              )}
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 gap-3 border-b border-border bg-muted/30 px-3 py-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <Field label="Date field">
                  <Select value={filters.dateField} onValueChange={(v) => setFilter({ dateField: v })}>
                    <SelectTrigger className="h-10 bg-background text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chqDate">Cheque date</SelectItem>
                      <SelectItem value="chqRcvDate">Received date</SelectItem>
                      <SelectItem value="depDate">Deposit date</SelectItem>
                      <SelectItem value="dated">Entry date</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="From">
                  <DateField
                    value={filters.dateFrom}
                    onChange={(dateFrom) => setFilter({ dateFrom })}
                    inputClassName="h-10 bg-background text-sm"
                  />
                </Field>

                <Field label="To">
                  <DateField
                    value={filters.dateTo}
                    onChange={(dateTo) => setFilter({ dateTo })}
                    inputClassName="h-10 bg-background text-sm"
                  />
                </Field>

                <Field label="Customer">
                  <CustomerCombobox
                    allowAll
                    className="h-10 bg-background text-sm"
                    category={filters.category}
                    value={filters.acno}
                    onChange={(acno) => setFilter({ acno })}
                  />
                </Field>

                <Field label="Transfer to bank">
                  <TransferBankCombobox
                    allowAll
                    className="h-10 bg-background text-sm"
                    value={filters.depAcno}
                    onChange={(depAcno) => setFilter({ depAcno })}
                  />
                </Field>

                <Field label="Sales person">
                  <Select
                    value={filters.salesPerson || "all"}
                    onValueChange={(v) => setFilter({ salesPerson: v === "all" ? "" : v })}
                  >
                    <SelectTrigger className="h-10 bg-background text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sales persons</SelectItem>
                      {salesPersons.map((sp) => (
                        <SelectItem key={sp.id} value={sp.id}>
                          {sp.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            {/* ── Table: scrolls inside the card on md+, the customer column
                  stays pinned; under md every row is a card (.vl-grid). ── */}
            <div className="md:max-h-[calc(100vh-15rem)] md:min-h-[320px] md:overflow-auto">
              <table className="vl-grid w-full text-sm md:min-w-[1180px]">
                <thead>
                  <tr className={TH_ROW}>
                    <th className={cn(TH, "left-0 z-20 min-w-[230px] md:sticky")}>Customer</th>
                    <th className={TH}>Sales Person</th>
                    <th className={TH}>Check#</th>
                    <th className={TH}>Check Date</th>
                    <th className={TH}>Bank Drawn</th>
                    <th className={cn(TH, "min-w-[160px]")}>Transfer To Bank</th>
                    <th className={cn(TH, "text-right")}>Amount</th>
                    <th className={TH}>Dep Date</th>
                    <th className={cn(TH, "min-w-[140px]")}>Remarks</th>
                    <th className={cn(TH, "w-[150px] text-center")}>Status</th>
                    <th className={cn(TH, "w-[86px] text-right")}>Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={11} className="px-3 py-2.5">
                          <Skeleton className="h-5 w-full" />
                        </td>
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={11}>
                        <LabEmpty
                          icon={Wallet}
                          title="No cheques match these filters"
                          hint={
                            activeFilterCount > 0
                              ? "Clear the filters, or add a cheque."
                              : "Add the first cheque with the button below."
                          }
                          action={
                            <div className="mt-1 flex flex-wrap justify-center gap-2">
                              {activeFilterCount > 0 && (
                                <Button size="sm" variant="ghost" onClick={resetFilters}>
                                  Clear filters
                                </Button>
                              )}
                              <Button size="sm" variant="outline" onClick={openNew}>
                                <Plus className="h-4 w-4" />
                                Add a cheque
                              </Button>
                            </div>
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const cleared = row.status === CHECK_STATUS.CLEARED;
                      const busy =
                        (changeStatus.isPending && changeStatus.variables?.id === row.id) ||
                        savingId === row.id;
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            "group bg-background hover:bg-muted",
                            busy && "pointer-events-none opacity-60"
                          )}
                        >
                          <td
                            data-label="Customer"
                            className={cn(
                              TD,
                              "left-0 z-[1] bg-background max-md:col-span-2 md:sticky md:shadow-[inset_-1px_0_0_hsl(var(--border))] md:group-hover:bg-muted"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <div className="min-w-0">
                                <div
                                  className="truncate font-medium leading-tight text-foreground"
                                  title={row.customerName}
                                >
                                  {row.customerName}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                                  <span className={CODE_CHIP}>{row.acno}</span>
                                  {row.chqBrBy ? <span>via {row.chqBrBy}</span> : null}
                                </div>
                              </div>
                              <Chip
                                tone={row.customerIsActive ? "ok" : "warn"}
                                className="shrink-0 text-[10.5px]"
                              >
                                {row.category}
                              </Chip>
                            </div>
                          </td>

                          {/* The sales person the customer is assigned to */}
                          <td
                            data-label="Sales person"
                            className={cn(TD, "whitespace-nowrap text-[13px]")}
                            title={row.salesPersonName || ""}
                          >
                            {row.salesPersonName || <span className="text-muted-foreground">—</span>}
                          </td>

                          <td data-label="Check#" className={TD}>
                            <span className={CODE_CHIP}>{row.chqNo}</span>
                          </td>
                          <td data-label="Check date" className={cn(TD, "whitespace-nowrap text-[13px] tabular-nums")}>
                            {showDate(row.chqDate)}
                          </td>
                          <td data-label="Bank drawn" className={cn(TD, "whitespace-nowrap text-[13px]")} title={row.bank}>
                            {row.bank}
                          </td>

                          {/* Which of our banks the cheque was transferred
                              into — editable in place. */}
                          <td data-label="Transfer to bank" className="px-2 py-1.5 text-[13px] max-md:col-span-2">
                            <TransferBankCombobox
                              value={row.depAcno ?? ""}
                              disabled={busy}
                              placeholder="Set bank…"
                              className={cn(
                                "h-8 w-full justify-between border-transparent bg-transparent px-2 text-[13px] font-normal shadow-none max-md:border-input",
                                "hover:border-input hover:bg-background focus-visible:border-input focus-visible:bg-background"
                              )}
                              onChange={(depAcno) =>
                                saveField.mutate({ id: row.id, depAcno: depAcno || null })
                              }
                            />
                          </td>

                          <td data-label="Amount" className={cn(TD, NUM, "text-[13px] font-semibold")}>
                            {money(row.amount)}
                          </td>
                          {/* Deposit date. The server only accepts one on a
                              cleared cheque (a pending cheque has not been
                              deposited), so this is read-only until the switch
                              is flipped — with the reason on hover rather than
                              a control that silently does nothing. */}
                          <td data-label="Dep date" className="whitespace-nowrap px-2 py-1.5 text-[13px] tabular-nums">
                            {cleared ? (
                              <DateField
                                value={toISODate(row.depDate)}
                                disabled={busy}
                                onChange={(depDate) => {
                                  if (!depDate || depDate === toISODate(row.depDate)) return;
                                  saveField.mutate({ id: row.id, depDate });
                                }}
                                inputClassName={cn(
                                  "h-8 w-[120px] border-transparent bg-transparent px-2 text-[13px] tabular-nums shadow-none",
                                  "hover:border-input hover:bg-background focus:border-input focus:bg-background"
                                )}
                              />
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex h-8 items-center px-2 text-muted-foreground">—</span>
                                </TooltipTrigger>
                                <TooltipContent>Mark the cheque Cleared to set a deposit date</TooltipContent>
                              </Tooltip>
                            )}
                          </td>
                          {/* Remarks — commits on blur or Enter, Escape
                              reverts. Not on every keystroke: that would fire
                              a PUT per character. */}
                          <td data-label="Remarks" className="max-w-[260px] px-2 py-1.5 max-md:max-w-none">
                            <InlineRemark
                              value={row.rmk || ""}
                              disabled={busy}
                              onCommit={(rmk) => saveField.mutate({ id: row.id, rmk })}
                            />
                          </td>

                          {/* The status switch is the whole workflow. */}
                          <td data-label="Status" className={TD}>
                            <div className="flex items-center gap-2 md:justify-center">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <Switch
                                      checked={cleared}
                                      disabled={busy}
                                      aria-label={cleared ? "Move back to Pending" : "Mark Cleared"}
                                      onCheckedChange={(next) =>
                                        changeStatus.mutate({
                                          id: row.id,
                                          status: next ? CHECK_STATUS.CLEARED : CHECK_STATUS.PENDING,
                                        })
                                      }
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {cleared
                                    ? "Move back to Pending (clears the deposit date)"
                                    : "Mark Cleared — stamps today as the deposit date"}
                                </TooltipContent>
                              </Tooltip>
                              <Chip tone={cleared ? "ok" : "warn"} className="min-w-[70px] justify-center">
                                {busy && <RefreshCw className="h-3 w-3 animate-spin" />}
                                {cleared ? "Cleared" : "Pending"}
                              </Chip>
                            </div>
                          </td>

                          <td className="vl-actions px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-0.5 max-md:justify-start">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    aria-label="Edit cheque"
                                    onClick={() => openEdit(row)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    aria-label="Delete cheque"
                                    onClick={() => setPendingDelete(row)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete</TooltipContent>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {!isLoading && rows.length > 0 && (
                  <tfoot className="max-md:block">
                    <tr className={cn(TOTAL_ROW, "max-md:flex max-md:items-center max-md:justify-between max-md:px-3.5 max-md:py-2.5")}>
                      <td
                        colSpan={6}
                        className={cn(TD, "left-0 bg-muted text-[13px] max-md:p-0 md:sticky")}
                      >
                        This page · {rows.length} cheque{rows.length === 1 ? "" : "s"}
                      </td>
                      <td className={cn(TD, NUM, "text-[13px] max-md:p-0")}>{money(pageAmount)}</td>
                      <td colSpan={4} className="max-md:hidden" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* ── Pager ─────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-muted/30 px-3 py-2.5">
              <p className="text-xs tabular-nums text-muted-foreground">
                {pagination.total === 0
                  ? "No rows"
                  : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${pagination.total.toLocaleString()}`}
                {isFetching && !isLoading && (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    updating
                  </span>
                )}
              </p>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Rows</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[72px] bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="First page"
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {pageWindow(page, Math.max(1, pagination.totalPages)).map((p, i) =>
                  p === "…" ? (
                    <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "outline"}
                      size="icon"
                      className="h-8 w-8 text-xs tabular-nums"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  )
                )}

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Next page"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Last page"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage(pagination.totalPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <CheckEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cheque={editing}
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this cheque?</AlertDialogTitle>
            <AlertDialogDescription>
              Cheque {pendingDelete?.chqNo} ({pendingDelete?.bank}) dated{" "}
              {showDate(pendingDelete?.chqDate)} for {money(pendingDelete?.amount)}{" "}
              from {pendingDelete?.customerName} will be removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate(pendingDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

// Remarks cell. Reads as plain text until you touch it, then behaves like a
// normal input. Commits on blur or Enter and reverts on Escape, so no request
// is made per keystroke and an accidental edit is easy to abandon.
function InlineRemark({ value, onCommit, disabled }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);

  // Follow the row when it changes from outside, but never mid-edit.
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);

  const commit = () => {
    const next = text.trim();
    if (next !== (value || "")) onCommit(next);
  };

  return (
    <Input
      value={text}
      disabled={disabled}
      placeholder="—"
      title={text || "Add a remark"}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setText(value);
          // Let the revert land before blur fires commit()
          requestAnimationFrame(() => e.target.blur());
        }
      }}
      className={cn(
        "h-8 border-transparent bg-transparent px-2 text-[12px] text-muted-foreground shadow-none",
        "hover:border-input hover:bg-background",
        "focus-visible:border-input focus-visible:bg-background focus-visible:text-foreground"
      )}
    />
  );
}

function Field({ label, className, children }) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

// Full amounts (not "12.4M"): these are cheque totals someone reads off to a
// bank, so an abbreviated figure is worse than a slightly wider tile.
function SummaryTile({ icon: Icon, label, count, amount, loading, tone }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12px] text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-6 w-28" />
        ) : (
          <p className="text-xl font-semibold tabular-nums text-foreground">{money(amount)}</p>
        )}
        <p className="text-[11.5px] tabular-nums text-muted-foreground">
          {loading ? " " : `${(count ?? 0).toLocaleString()} cheque${count === 1 ? "" : "s"}`}
        </p>
      </div>
      <span className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg", CHIP[tone] || CHIP.brand)}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
  );
}
