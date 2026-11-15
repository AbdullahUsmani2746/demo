"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RefreshCw,
  PlayCircle,
  History,
  ListChecks,
  Undo2,
  AlertTriangle,
  Save,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Wallet,
  Users,
  Building2,
  Inbox,
  Zap,
  X,
  ArrowRight,
  Link2,
  ExternalLink,
  Loader2,
  Wrench,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { useFifoAllocation } from "@/hooks/useFifoAllocation";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import {
  LabHeader,
  LabCard,
  LabStat,
  LabEmpty,
  Chip,
  CODE_CHIP,
  TH_ROW,
  TH,
  TD,
  NUM,
  TOTAL_ROW,
  TABS_SCROLL,
  TABS_LIST,
  TABS_TRIGGER,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

// Compact form for the stat tiles — "1.8M" reads better than the full figure
// when four of them sit side by side.
function formatCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

// Returns appear only with Settings → Features "knockoff.matchReturns".
const TRAN_CODE_LABEL = { 1: "Receipt", 2: "Payment", 3: "JV", 9: "Purchase Return", 10: "Sale Return" };

// Chip tone per voucher type / run status (theme tokens, dark-mode safe).
const TRAN_CODE_TONE = { 1: "ok", 2: "warn", 3: "brand", 9: "muted", 10: "muted" };

const RUN_STATUS_TONE = {
  RUNNING: "warn",
  COMPLETED: "ok",
  FAILED: "bad",
};

const PAGE_SIZES = [10, 25, 50, 100];

/* ==========================================================================
   Shared bits
   ========================================================================== */

// One pager drives both tables so their controls behave identically.
function Pager({ page, pageCount, pageSize, total, onPage, onPageSize }) {
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-muted/30 px-3 py-2.5">
      <p className="text-xs tabular-nums text-muted-foreground">
        Showing <span className="font-semibold text-foreground">{first}</span>–
        <span className="font-semibold text-foreground">{last}</span> of{" "}
        <span className="font-semibold text-foreground">{total}</span>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
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

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page === 1}
            onClick={() => onPage(1)}
            aria-label="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page === 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 text-xs font-medium tabular-nums text-foreground">
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page >= pageCount}
            onClick={() => onPage(pageCount)}
            aria-label="Last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SortableHead({ label, field, sort, onSort, className }) {
  const active = sort.field === field;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn(TH, className)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 uppercase transition-opacity hover:opacity-80",
          !active && "opacity-90",
        )}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", !active && "opacity-50")} />
      </button>
    </th>
  );
}

function TableSkeleton({ rows = 5, cols = 7 }) {
  return (
    <tbody className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          <td colSpan={cols} className="px-3 py-2.5">
            <Skeleton className="h-5 w-full" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

// The exact row invoice_no lands on: TRANSACTIONS_MASTER.tran_id -> the
// Transactions line id. Shown wherever an allocation is displayed so it is
// obvious which record is being written to.
function RecordRef({ tranId, lineId, vrNo, className }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1 gap-y-0.5 font-mono text-[11px] leading-tight", className)}>
      {vrNo != null && <span className={cn(CODE_CHIP, "mr-0.5 font-sans text-[11px] font-semibold")}>VR {vrNo}</span>}
      <span className="whitespace-nowrap">
        <span className="text-muted-foreground">Tran</span>
        <span className="font-semibold text-foreground"> #{tranId}</span>
        <span className="mx-1 text-muted-foreground/60">/</span>
        <span className="text-muted-foreground">Line</span>
        <span className="font-semibold text-foreground"> #{lineId}</span>
      </span>
    </div>
  );
}

/* ==========================================================================
   Page
   ========================================================================== */

export default function KnockoffReviewPage() {
  const queryClient = useQueryClient();
  const [partyTypeFilter, setPartyTypeFilter] = useState("all");
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [runToReverse, setRunToReverse] = useState(null);
  const [refifoOpen, setRefifoOpen] = useState(false);
  const { can } = usePermissions();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ field: "dated", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [runPage, setRunPage] = useState(1);
  const [runPageSize, setRunPageSize] = useState(10);

  // ── Run history ─────────────────────────────────────────────
  const { data: runsData, isFetching: runsLoading } = useQuery({
    queryKey: ["knockoffRuns"],
    queryFn: async () => {
      const res = await axios.get("/api/invoice-knockoff/runs?limit=100");
      return res.data?.data || [];
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.post("/api/invoice-knockoff/run");
      return res.data;
    },
    onSuccess: (result) => {
      toast.success(
        `Run complete — ${result.linesMatched}/${result.linesScanned} line(s) matched, ${formatCurrency(result.amountMatched)} allocated.`,
      );
      queryClient.invalidateQueries({ queryKey: ["knockoffRuns"] });
      queryClient.invalidateQueries({ queryKey: ["knockoffCandidates"] });
    },
    onError: (err) => {
      toast.error(
        "Run failed: " + (err?.response?.data?.message || err.message || ""),
      );
    },
  });

  const reverseRunMutation = useMutation({
    mutationFn: async (runId) => {
      const res = await axios.post(`/api/invoice-knockoff/runs/${runId}/reverse`);
      return res.data;
    },
    onSuccess: (result) => {
      toast.success(`Reversed ${result.reversedCount} allocation(s).`);
      setRunToReverse(null);
      queryClient.invalidateQueries({ queryKey: ["knockoffRuns"] });
      queryClient.invalidateQueries({ queryKey: ["knockoffCandidates"] });
    },
    onError: (err) => {
      toast.error(
        "Reverse failed: " + (err?.response?.data?.message || err.message || ""),
      );
    },
  });

  // ── Candidates awaiting review ──────────────────────────────
  const { data: candidatesData, isFetching: candidatesLoading } = useQuery({
    queryKey: ["knockoffCandidates", partyTypeFilter],
    queryFn: async () => {
      const params =
        partyTypeFilter !== "all" ? `?partyType=${partyTypeFilter}` : "";
      const res = await axios.get(`/api/invoice-knockoff/candidates${params}`);
      return res.data?.data || [];
    },
  });

  const candidates = useMemo(() => candidatesData || [], [candidatesData]);
  const runs = useMemo(() => runsData || [], [runsData]);

  // ── Headline numbers ────────────────────────────────────────
  const stats = useMemo(() => {
    let remaining = 0;
    let customers = 0;
    let vendors = 0;
    for (const c of candidates) {
      remaining += Number(c.remaining) || 0;
      if (c.partyType === "customer") customers += 1;
      else vendors += 1;
    }
    return { lines: candidates.length, remaining, customers, vendors };
  }, [candidates]);

  const lastRun = runs[0];

  // ── Search + sort + page (client side: the API returns the full set) ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      const label = TRAN_CODE_LABEL[c.tranCode] || "";
      return (
        String(c.partyName || "").toLowerCase().includes(q) ||
        String(c.partyAcno || "").includes(q) ||
        String(c.vrNo || "").toLowerCase().includes(q) ||
        label.toLowerCase().includes(q)
      );
    });
  }, [candidates, search]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const { field, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let av = a[field];
      let bv = b[field];
      if (field === "dated") {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      } else if (field === "partyName") {
        av = String(av || "").toLowerCase();
        bv = String(bv || "").toLowerCase();
        return av < bv ? -1 * mul : av > bv ? 1 * mul : 0;
      } else {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
      }
      return (av - bv) * mul;
    });
    return rows;
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const runPageCount = Math.max(1, Math.ceil(runs.length / runPageSize));
  const pagedRuns = useMemo(
    () => runs.slice((runPage - 1) * runPageSize, runPage * runPageSize),
    [runs, runPage, runPageSize],
  );

  // Any change to the result set can leave the cursor past the last page.
  useEffect(() => {
    setPage(1);
  }, [search, partyTypeFilter, pageSize]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    if (runPage > runPageCount) setRunPage(runPageCount);
  }, [runPage, runPageCount]);

  const toggleSort = (field) =>
    setSort((s) =>
      s.field === field
        ? { field, dir: s.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "desc" },
    );

  const openReview = (candidate) => {
    setSelectedCandidate(candidate);
    setReviewOpen(true);
  };

  const closeReview = () => {
    setReviewOpen(false);
    setSelectedCandidate(null);
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["knockoffRuns"] });
    queryClient.invalidateQueries({ queryKey: ["knockoffCandidates"] });
  };

  const router = useRouter();
  const searchRef = useRef(null);

  // "/" focuses the queue search (Ctrl+K is the header's menu search).
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

  // Totals of the lines matching the search (every page, not just this one).
  const queueTotals = useMemo(
    () =>
      sorted.reduce(
        (t, c) => ({
          line: t.line + (Number(c.lineAmount) || 0),
          allocated: t.allocated + (Number(c.alreadyAllocated) || 0),
          remaining: t.remaining + (Number(c.remaining) || 0),
        }),
        { line: 0, allocated: 0, remaining: 0 },
      ),
    [sorted],
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/40">
        <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-5 sm:px-6">
          {/* ── Header ─────────────────────────────────────────── */}
          <LabHeader
            icon={ListChecks}
            breadcrumb="Accounting"
            title="Invoice Knock-Off Review"
            subtitle="FIFO-matched settlements, oldest invoice first — review and override anything left over"
            actions={
              <>
                {lastRun && (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 max-sm:!flex-[1_1_100%]">
                    <div className="min-w-0 leading-tight">
                      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Last run
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {format(new Date(lastRun.started_at), "dd MMM, HH:mm")}
                      </p>
                    </div>
                    <Chip tone={RUN_STATUS_TONE[lastRun.status] || "muted"} className="ml-auto">
                      {lastRun.status}
                    </Chip>
                  </div>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={refreshAll}
                      className="h-10 w-10 max-sm:!flex-none"
                      aria-label="Refresh"
                    >
                      <RefreshCw
                        className={cn(
                          "h-4 w-4",
                          (runsLoading || candidatesLoading) && "animate-spin",
                        )}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => runNowMutation.mutate()}
                  disabled={runNowMutation.isPending}
                  className="h-10 font-semibold"
                >
                  {runNowMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Running…
                    </>
                  ) : (
                    <>
                      <PlayCircle className="mr-2 h-4 w-4" />
                      Run Now
                    </>
                  )}
                </Button>
                {can("knockoff.refifo") && (
                  <Button variant="outline" onClick={() => setRefifoOpen(true)} className="h-10 font-semibold">
                    <Wrench className="mr-2 h-4 w-4" />
                    Fix FIFO order
                  </Button>
                )}
              </>
            }
          />

          {/* ── Stats ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <LabStat
              icon={Inbox}
              label="Awaiting review"
              value={stats.lines.toLocaleString()}
              hint="settlement lines not fully allocated"
              tone="warn"
            />
            <LabStat
              icon={Wallet}
              label="Unallocated value"
              value={formatCompact(stats.remaining)}
              hint={formatCurrency(stats.remaining)}
              tone="bad"
            />
            <LabStat
              icon={Users}
              label="Customer receipts"
              value={stats.customers.toLocaleString()}
              hint="lines against debtor accounts"
              tone="brand"
            />
            <LabStat
              icon={Building2}
              label="Vendor payments"
              value={stats.vendors.toLocaleString()}
              hint="lines against creditor accounts"
              tone="muted"
            />
          </div>

          {/* ── Tabs ───────────────────────────────────────────── */}
          <Tabs defaultValue="candidates" className="space-y-4">
            <div className={TABS_SCROLL}>
              <TabsList className={TABS_LIST}>
                <TabsTrigger value="candidates" className={TABS_TRIGGER}>
                  <ListChecks className="h-4 w-4" />
                  Awaiting Review
                  <span className="rounded-full bg-primary/10 px-2 text-[11px] font-semibold tabular-nums text-primary">
                    {stats.lines}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="runs" className={TABS_TRIGGER}>
                  <History className="h-4 w-4" />
                  Run History
                  <span className="rounded-full bg-muted px-2 text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {runs.length}
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Candidates: the review queue ─────────────────── */}
            <TabsContent value="candidates" className="m-0">
              <LabCard
                title="Unmatched / partially-matched lines"
                subtitle="Open a line to allocate it against outstanding invoices"
                icon={ListChecks}
              >
                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
                  <label className="flex h-10 min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:basis-[260px] sm:max-w-md">
                    <Search className="h-4 w-4 flex-shrink-0" />
                    <input
                      ref={searchRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setSearch("")}
                      placeholder="Search party, account, voucher…"
                      aria-label="Search lines"
                      className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                    />
                    {search ? (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        className="hover:text-foreground"
                        aria-label="Clear search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : (
                      <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">
                        /
                      </kbd>
                    )}
                  </label>

                  <div
                    role="tablist"
                    aria-label="Party type"
                    className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1 max-sm:w-full"
                  >
                    {["all", "customer", "vendor"].map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={partyTypeFilter === key}
                        onClick={() => setPartyTypeFilter(key)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition-colors max-sm:flex-1",
                          partyTypeFilter === key
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-background hover:text-foreground",
                        )}
                      >
                        {key}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:max-h-[calc(100vh-18rem)] md:min-h-[280px] md:overflow-auto">
                  <table className="vl-grid w-full text-sm md:min-w-[1040px]">
                    <thead>
                      <tr className={TH_ROW}>
                        <SortableHead label="Date" field="dated" sort={sort} onSort={toggleSort} />
                        <th className={TH}>Type</th>
                        <SortableHead
                          label="Party"
                          field="partyName"
                          sort={sort}
                          onSort={toggleSort}
                          className="left-0 z-20 md:sticky"
                        />
                        <th className={TH}>Record</th>
                        <SortableHead
                          label="Line Amount"
                          field="lineAmount"
                          sort={sort}
                          onSort={toggleSort}
                          className="text-right"
                        />
                        <th className={TH}>Allocation</th>
                        <SortableHead
                          label="Remaining"
                          field="remaining"
                          sort={sort}
                          onSort={toggleSort}
                          className="text-right"
                        />
                        <th className={cn(TH, "text-right")}>Action</th>
                      </tr>
                    </thead>

                    {candidatesLoading && candidates.length === 0 ? (
                      <TableSkeleton rows={8} cols={8} />
                    ) : (
                      <tbody className="divide-y divide-border">
                        {paged.map((c) => {
                          const pct =
                            c.lineAmount > 0
                              ? Math.min(
                                  100,
                                  (Number(c.alreadyAllocated) /
                                    Number(c.lineAmount)) *
                                    100,
                                )
                              : 0;
                          const href = voucherHref({ tran_code: c.tranCode, tran_id: c.sourceTranId });
                          return (
                            <tr
                              key={c.lineId}
                              onClick={() => openReview(c)}
                              className="group cursor-pointer bg-background transition-colors hover:bg-muted"
                            >
                              <td data-label="Date" className={cn(TD, "whitespace-nowrap tabular-nums text-foreground")}>
                                {c.dated ? format(new Date(c.dated), "dd MMM yyyy") : "—"}
                              </td>
                              <td data-label="Type" className={TD}>
                                <Chip tone={TRAN_CODE_TONE[c.tranCode] || "muted"}>
                                  {TRAN_CODE_LABEL[c.tranCode] || c.tranCode}
                                </Chip>
                              </td>
                              <td
                                data-label="Party"
                                className={cn(
                                  TD,
                                  "left-0 z-[1] max-w-[260px] bg-background max-md:col-span-2 max-md:max-w-none md:sticky md:shadow-[inset_-1px_0_0_hsl(var(--border))] md:group-hover:bg-muted",
                                )}
                              >
                                <p className="truncate font-medium text-foreground">{c.partyName || "—"}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  A/c <span className={CODE_CHIP}>{c.partyAcno}</span>
                                </p>
                              </td>
                              <td data-label="Record" className={cn(TD, "max-md:col-span-2")}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div>
                                      <RecordRef tranId={c.sourceTranId} lineId={c.lineId} vrNo={c.vrNo} />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    invoice_no will be written on
                                    Transactions #{c.lineId}
                                  </TooltipContent>
                                </Tooltip>
                              </td>
                              <td data-label="Line amount" className={cn(TD, NUM, "whitespace-nowrap font-semibold text-foreground")}>
                                {formatCurrency(c.lineAmount)}
                              </td>
                              <td data-label="Allocation" className={cn(TD, "md:w-[190px]")}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="space-y-1">
                                      <Progress value={pct} className="h-1.5" />
                                      <p className="text-xs tabular-nums text-muted-foreground">
                                        {formatCurrency(c.alreadyAllocated)} allocated
                                      </p>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {pct.toFixed(0)}% of this line is
                                    allocated
                                  </TooltipContent>
                                </Tooltip>
                              </td>
                              <td data-label="Remaining" className={cn(TD, NUM, "whitespace-nowrap font-bold text-primary")}>
                                {formatCurrency(c.remaining)}
                              </td>
                              <td className="vl-actions px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1 max-md:justify-start">
                                  {href && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                                          aria-label="Open voucher"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            router.push(href);
                                          }}
                                        >
                                          <ExternalLink className="h-3.5 w-3.5" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Open voucher</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Button
                                    size="sm"
                                    className="h-8"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openReview(c);
                                    }}
                                  >
                                    Review
                                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}

                        {paged.length === 0 && (
                          <tr>
                            <td colSpan={8} className="p-0">
                              <LabEmpty
                                icon={search ? Search : ListChecks}
                                title={search ? "No lines match your search" : "Everything is matched"}
                                hint={
                                  search
                                    ? "Try a different party name, account number or voucher number."
                                    : "No settlement line is waiting on review. Run the matcher again after posting new receipts or payments."
                                }
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    )}

                    {sorted.length > 0 && (
                      <tfoot className="max-md:block">
                        <tr className={cn(TOTAL_ROW, "max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:px-3.5 max-md:py-2.5")}>
                          <td colSpan={4} className={cn(TD, "max-md:col-span-2 max-md:p-0")}>
                            Total · {sorted.length} line{sorted.length === 1 ? "" : "s"}
                          </td>
                          <td className={cn(TD, NUM, "whitespace-nowrap max-md:p-0 max-md:text-left")}>
                            <span className="text-[10.5px] font-bold uppercase text-muted-foreground md:hidden">Lines </span>
                            {formatCurrency(queueTotals.line)}
                          </td>
                          <td className={cn(TD, "whitespace-nowrap tabular-nums max-md:hidden")}>
                            {formatCurrency(queueTotals.allocated)}
                          </td>
                          <td className={cn(TD, NUM, "whitespace-nowrap text-primary max-md:p-0 max-md:text-left")}>
                            <span className="text-[10.5px] font-bold uppercase text-muted-foreground md:hidden">Remaining </span>
                            {formatCurrency(queueTotals.remaining)}
                          </td>
                          <td className="max-md:hidden" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                <Pager
                  page={page}
                  pageCount={pageCount}
                  pageSize={pageSize}
                  total={sorted.length}
                  onPage={setPage}
                  onPageSize={setPageSize}
                />
              </LabCard>
            </TabsContent>

            {/* ── Run history ─────────────────────────────────── */}
            <TabsContent value="runs" className="m-0">
              <LabCard
                title="Matcher runs"
                subtitle="Twice-daily cron plus any manual runs. Reversing a run soft-reverses every allocation it made."
                icon={History}
              >
                <div className="md:overflow-x-auto">
                  <table className="vl-grid w-full text-sm md:min-w-[760px]">
                    <thead>
                      <tr className={TH_ROW}>
                        <th className={TH}>Started</th>
                        <th className={TH}>Trigger</th>
                        <th className={TH}>Status</th>
                        <th className={cn(TH, "text-right")}>Scanned</th>
                        <th className={cn(TH, "text-right")}>Matched</th>
                        <th className={cn(TH, "text-right")}>Amount</th>
                        <th className={cn(TH, "text-right")}>Action</th>
                      </tr>
                    </thead>

                    {runsLoading && runs.length === 0 ? (
                      <TableSkeleton rows={5} cols={7} />
                    ) : (
                      <tbody className="divide-y divide-border">
                        {pagedRuns.map((run) => (
                          <tr key={run.id} className="hover:bg-muted/50">
                            <td data-label="Started" className={cn(TD, "whitespace-nowrap tabular-nums text-foreground")}>
                              {format(new Date(run.started_at), "dd MMM yyyy, HH:mm")}
                            </td>
                            <td data-label="Trigger" className={TD}>
                              <Chip tone="muted">{run.trigger}</Chip>
                            </td>
                            <td data-label="Status" className={TD}>
                              <Chip tone={RUN_STATUS_TONE[run.status] || "muted"}>{run.status}</Chip>
                            </td>
                            <td data-label="Scanned" className={cn(TD, NUM, "text-muted-foreground")}>
                              {run.lines_scanned ?? "—"}
                            </td>
                            <td data-label="Matched" className={cn(TD, NUM, "font-semibold text-foreground")}>
                              {run.lines_matched ?? "—"}
                            </td>
                            <td data-label="Amount" className={cn(TD, NUM, "whitespace-nowrap font-semibold text-foreground")}>
                              {run.amount_matched != null ? formatCurrency(run.amount_matched) : "—"}
                            </td>
                            <td className={cn("vl-actions px-3 py-2 text-right", !(run._count?.allocations > 0) && "max-md:hidden")}>
                              {run._count?.allocations > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => setRunToReverse(run)}
                                >
                                  <Undo2 className="mr-1 h-3.5 w-3.5" />
                                  Reverse
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}

                        {pagedRuns.length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-0">
                              <LabEmpty
                                icon={History}
                                title="No runs yet"
                                hint='Click "Run Now" to match untagged receipts and payments against outstanding invoices.'
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    )}
                  </table>
                </div>

                <Pager
                  page={runPage}
                  pageCount={runPageCount}
                  pageSize={runPageSize}
                  total={runs.length}
                  onPage={setRunPage}
                  onPageSize={setRunPageSize}
                />
              </LabCard>
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Reverse-run confirmation ─────────────────────────── */}
        <AlertDialog
          open={!!runToReverse}
          onOpenChange={(open) => !open && setRunToReverse(null)}
        >
          <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-xl sm:max-w-[460px]">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Reverse this run?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This soft-reverses every allocation created by run #
                {runToReverse?.id}. Invoices it settled will show as outstanding
                again until re-matched. Nothing is deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={reverseRunMutation.isPending}
                onClick={(e) => {
                  // Stay open until the reverse lands (onSuccess closes it).
                  e.preventDefault();
                  reverseRunMutation.mutate(runToReverse.id);
                }}
              >
                {reverseRunMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reverse Run
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── Manual review / override ─────────────────────────── */}
        <ReviewDialog
          open={reviewOpen}
          candidate={selectedCandidate}
          onClose={closeReview}
          onSaved={() => {
            closeReview();
            queryClient.invalidateQueries({ queryKey: ["knockoffCandidates"] });
            queryClient.invalidateQueries({ queryKey: ["knockoffRuns"] });
          }}
        />

        {/* ── Fix FIFO order (knockoff.refifo) ─────────────────── */}
        {refifoOpen && <RefifoDialog open={refifoOpen} onClose={() => setRefifoOpen(false)} onChanged={refreshAll} />}
      </div>
    </TooltipProvider>
  );
}

/* ==========================================================================
   Fix FIFO order dialog (lib/ledger/refifo.js)
   ========================================================================== */

const REFIFO_KIND_LABEL = { apply: "Fix", resume: "Resume", restore: "Undo" };
const REFIFO_PARTY = [
  { value: "all", label: "Customers and vendors" },
  { value: "customer", label: "Customers" },
  { value: "vendor", label: "Vendors" },
];

function RefifoDialog({ open, onClose, onChanged }) {
  const queryClient = useQueryClient();
  const [party, setParty] = useState("all");
  // "apply" | { restore: stamp } — the action waiting for a second click.
  const [confirm, setConfirm] = useState(null);

  const { data, isFetching, error } = useQuery({
    queryKey: ["knockoffRefifo", party],
    queryFn: async () => (await axios.get(`/api/invoice-knockoff/refifo?party=${party}`)).data,
    enabled: open,
    // Poll while a job runs so its log streams in.
    refetchInterval: (q) => (q.state.data?.job?.status === "running" ? 3000 : false),
  });

  const job = data?.job;
  const running = job?.status === "running";
  const parties = useMemo(() => data?.parties || [], [data]);
  const backups = data?.backups || [];
  const totals = useMemo(
    () => ({ lines: parties.reduce((s, p) => s + p.lines, 0), amount: parties.reduce((s, p) => s + p.fifoAmount, 0) }),
    [parties],
  );

  // Refresh the page's lists once a job ends.
  const lastStatus = useRef(null);
  useEffect(() => {
    if (lastStatus.current === "running" && job && job.status !== "running") onChanged?.();
    lastStatus.current = job?.status ?? null;
  }, [job, onChanged]);

  const startMutation = useMutation({
    mutationFn: async ({ action, stamp }) =>
      (await axios.post(`/api/invoice-knockoff/refifo?action=${action}`, { stamp, party })).data,
    onSuccess: () => {
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["knockoffRefifo"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || err.message),
  });
  const start = (action, stamp) => startMutation.mutate({ action, stamp });
  const busy = running || startMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-[900px]")}>
        <DialogHeader className={DIALOG_HEAD}>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" />
            Fix FIFO order
          </DialogTitle>
          <DialogDescription>
            Parties whose automatic knock-offs were put on newer invoices while older ones stayed open
          </DialogDescription>
        </DialogHeader>

        <div className={cn(DIALOG_BODY, "space-y-5")}>
          {error && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error?.response?.data?.message || error.message}
            </p>
          )}

          <p className="text-sm text-muted-foreground">
            For each party below, the automatic knock-offs are taken off and matched again, oldest invoice first. A
            backup is taken first, and every voucher is checked to keep the same debit / credit totals. Voucher totals,
            the ledger and the trial balance do not change; only <em>which invoice</em> each receipt or payment settled
            does. Manual knock-offs and invoice numbers typed on a voucher are kept.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Check</span>
            <Select value={party} onValueChange={setParty} disabled={busy}>
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFIFO_PARTY.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Running / last job ───────────────────────── */}
          {job && (
            <div
              className={cn(
                "rounded-xl border p-4",
                running && "border-primary/30 bg-primary/5",
                job.status === "completed" && "border-emerald-600/30 bg-emerald-500/5",
                job.status === "failed" && "border-destructive/40 bg-destructive/5",
              )}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {running && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {REFIFO_KIND_LABEL[job.kind]} — {running ? "running…" : job.status === "completed" ? "finished" : "stopped"}
                </p>
                <p className="text-xs text-muted-foreground">
                  started {format(new Date(job.startedAt), "dd MMM, HH:mm")}
                  {job.by ? ` by ${job.by}` : ""}
                </p>
              </div>
              <div className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-xs text-foreground/80">
                {job.log.map((l, i) => (
                  <p key={i}>
                    <span className="text-muted-foreground">{format(new Date(l.at), "HH:mm:ss")}</span> {l.message}
                  </p>
                ))}
              </div>
              {job.status === "failed" && (
                <p className="mt-2 text-sm text-destructive">
                  Use <strong>Resume</strong> below to finish it, or <strong>Undo</strong> to put everything back.
                </p>
              )}
            </div>
          )}

          {/* ── Affected parties ─────────────────────────── */}
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">
              {isFetching && !data
                ? "Checking…"
                : `${parties.length} parties · ${totals.lines.toLocaleString()} lines · ${formatCurrency(totals.amount)} to re-match`}
            </p>
            {isFetching && !data ? (
              <Skeleton className="h-40 w-full" />
            ) : parties.length === 0 ? (
              <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
                Every party is in FIFO order — nothing to fix.
              </p>
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {parties.map((p) => (
                    <div key={`${p.side}-${p.acno}`} className="rounded-lg border border-border p-3 text-sm">
                      <p className="font-medium">
                        {p.acname} <span className="text-xs text-muted-foreground">{p.acno}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Oldest open {format(new Date(p.oldestOpen), "dd MMM yyyy")} · newer paid{" "}
                        {format(new Date(p.newestPaid), "dd MMM yyyy")}
                      </p>
                      <p className="mt-1 tabular-nums">
                        {formatCurrency(p.openAmount)} open · {p.lines} lines
                      </p>
                    </div>
                  ))}
                </div>
                <div className="hidden max-h-64 overflow-y-auto rounded-lg border border-border md:block [&_td]:px-3 [&_th]:px-3">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/60">
                      <TableRow>
                        <TableHead>Party</TableHead>
                        <TableHead>Oldest open invoice</TableHead>
                        <TableHead>Newer invoice paid</TableHead>
                        <TableHead className="text-right">Open on invoices</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parties.map((p) => (
                        <TableRow key={`${p.side}-${p.acno}`}>
                          <TableCell>
                            <span className="font-medium">{p.acname}</span>{" "}
                            <span className="text-xs text-muted-foreground">{p.acno}</span>
                          </TableCell>
                          <TableCell>{format(new Date(p.oldestOpen), "dd MMM yyyy")}</TableCell>
                          <TableCell>{format(new Date(p.newestPaid), "dd MMM yyyy")}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(p.openAmount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.lines}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>

          {/* ── Backups: resume / undo ───────────────────── */}
          {backups.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Earlier fixes (backups)</p>
              <div className="divide-y divide-border rounded-lg border border-border">
                {backups.map((b) => (
                  <div key={b.stamp} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <p className="text-sm text-foreground/80">
                      <span className="font-mono">{b.stamp}</span> · {b.parties} part{b.parties === 1 ? "y" : "ies"}
                      {b.by ? ` · ${b.by}` : ""}
                    </p>
                    {confirm?.restore === b.stamp ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-destructive">Put these parties back as before?</span>
                        <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>
                          No
                        </Button>
                        <Button size="sm" disabled={busy} onClick={() => start("restore", b.stamp)}>
                          Yes, undo
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => start("resume", b.stamp)}>
                          <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                          Resume
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          className="text-destructive"
                          onClick={() => setConfirm({ restore: b.stamp })}
                        >
                          <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                          Undo
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={cn(DIALOG_FOOT, "flex flex-wrap items-center justify-end gap-3")}>
          {confirm === "apply" ? (
            <>
              <span className="mr-auto text-sm text-foreground/80">
                Re-match {parties.length} parties now? Make sure a database backup was taken today.
              </span>
              <Button variant="outline" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => start("apply")}>
                Yes, fix them
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button disabled={busy || parties.length === 0} onClick={() => setConfirm("apply")}>
                <Wrench className="mr-2 h-4 w-4" />
                {running ? "Running…" : `Fix ${parties.length} parties`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ==========================================================================
   Review dialog
   ========================================================================== */

function ReviewDialog({ open, candidate, onClose, onSaved }) {
  const router = useRouter();
  const {
    outstandingInvoices,
    dataLoaded,
    loadInvoices,
    handleToggle,
    handleManualAmount,
    reset,
    selectedInvoices,
    totalAllocated,
    unallocated,
  } = useFifoAllocation(candidate?.lineAmount || 0);

  const [invoiceSearch, setInvoiceSearch] = useState("");

  const { data: existingAllocations } = useQuery({
    queryKey: ["knockoffAllocations", candidate?.lineId],
    queryFn: async () => {
      const res = await axios.get(
        `/api/invoice-knockoff?source_line_id=${candidate.lineId}`,
      );
      return res.data?.data || [];
    },
    enabled: !!candidate?.lineId && open,
  });

  useEffect(() => {
    if (!open || !candidate) return;
    reset();
    setInvoiceSearch("");
    (async () => {
      try {
        const res = await axios.get(
          `/api/voucher/outstanding?type=${candidate.partyType}&account=${candidate.partyAcno}`,
        );
        loadInvoices(res.data?.data || []);
      } catch (err) {
        toast.error("Failed to load outstanding invoices for this party");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidate?.lineId]);

  const visibleInvoices = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return outstandingInvoices;
    return outstandingInvoices.filter((inv) =>
      String(inv.invoiceNo || "").toLowerCase().includes(q),
    );
  }, [outstandingInvoices, invoiceSearch]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.post("/api/invoice-knockoff", {
        source_line_id: candidate.lineId,
        allocations: selectedInvoices.map((inv) => ({
          invoice_no: inv.invoiceNo,
          amount: round2(inv.amountAdjusted),
        })),
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success("Allocation saved.");
      onSaved();
    },
    onError: (err) => {
      toast.error(
        "Save failed: " + (err?.response?.data?.message || err.message || ""),
      );
    },
  });

  const reverseOneMutation = useMutation({
    mutationFn: async (id) => {
      const res = await axios.post(`/api/invoice-knockoff/${id}`);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Allocation reversed.");
      onSaved();
    },
    onError: (err) => {
      toast.error(
        "Reverse failed: " + (err?.response?.data?.message || err.message || ""),
      );
    },
  });

  if (!candidate) return null;

  const allocatedPct =
    candidate.lineAmount > 0
      ? Math.min(100, (totalAllocated / candidate.lineAmount) * 100)
      : 0;

  // Mirrors resyncLineSplit on the server: the posted line is rebuilt as one
  // row per invoice it pays off, plus a trailing untagged row for whatever is
  // left unapplied. The first row reuses the original line's id.
  const pendingSlices = (() => {
    const rows = selectedInvoices
      .filter((i) => i.invoiceNo && round2(i.amountAdjusted) > 0)
      .map((i) => ({
        invoiceNo: i.invoiceNo,
        amount: round2(i.amountAdjusted),
        // A partial knock-off leaves the invoice open for the difference.
        balanceAfter: round2(i.balanceAfter),
      }));

    const remainder = round2(candidate.lineAmount - totalAllocated);
    if (rows.length === 0) {
      rows.push({ invoiceNo: null, amount: round2(candidate.lineAmount) });
    } else if (remainder > 0.01) {
      rows.push({ invoiceNo: null, amount: remainder });
    }
    return rows;
  })();

  const sourceHref = voucherHref({ tran_code: candidate.tranCode, tran_id: candidate.sourceTranId });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-[900px]")}>
        {/* Header: the line under review */}
        <DialogHeader className={cn(DIALOG_HEAD, "space-y-0 pr-12 text-left")}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={TRAN_CODE_TONE[candidate.tranCode] || "muted"}>
              {TRAN_CODE_LABEL[candidate.tranCode] || candidate.tranCode}
            </Chip>
            {candidate.vrNo && <span className={CODE_CHIP}>VR {candidate.vrNo}</span>}
            <span className="text-xs tabular-nums text-muted-foreground">
              {candidate.dated ? format(new Date(candidate.dated), "dd MMM yyyy") : ""}
            </span>
            {sourceHref && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                onClick={() => router.push(sourceHref)}
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Open voucher
              </Button>
            )}
          </div>
          <DialogTitle className="mt-2 text-lg font-bold text-primary sm:text-xl">
            {candidate.partyName}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            A/c #{candidate.partyAcno} · Tran #{candidate.sourceTranId} · Line #
            {candidate.lineId}
          </DialogDescription>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Line amount
              </p>
              <p className="truncate font-semibold tabular-nums text-foreground">
                {formatCurrency(candidate.lineAmount)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Allocating now
              </p>
              <p className="truncate font-semibold tabular-nums text-primary">{formatCurrency(totalAllocated)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Will stay open
              </p>
              <p className="truncate font-semibold tabular-nums text-foreground">{formatCurrency(unallocated)}</p>
            </div>
          </div>
          <Progress value={allocatedPct} className="mt-3 h-1.5" />
        </DialogHeader>

        {/* Body */}
        <div className={cn(DIALOG_BODY, "space-y-4")}>
          {existingAllocations?.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
                <Zap className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Current active allocations
                </span>
              </div>
              <table className="vl-grid w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invoice</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Written on</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                    <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {existingAllocations.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Invoice" className="px-3 py-2">
                        <span className={CODE_CHIP}>{a.invoice_no}</span>
                      </td>
                      <td data-label="Written on" className="px-3 py-2">
                        <RecordRef tranId={a.source_tran_id} lineId={a.source_line_id} />
                      </td>
                      <td data-label="Amount" className={cn("px-3 py-2 font-semibold", NUM)}>
                        {formatCurrency(a.allocated_amount)}
                      </td>
                      <td data-label="Source" className="px-3 py-2 md:text-center">
                        <Chip tone={a.is_manual ? "brand" : "muted"}>{a.is_manual ? "Manual" : "Auto"}</Chip>
                      </td>
                      <td className="vl-actions px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={reverseOneMutation.isPending}
                          onClick={() => reverseOneMutation.mutate(a.id)}
                        >
                          <Undo2 className="mr-1 h-3.5 w-3.5" />
                          Reverse
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-foreground">
              Saving replaces <strong>all</strong> active allocations for this
              line with your selection below.
            </p>
          </div>

          {/* Exactly what the save writes back to the ledger row */}
          <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
            <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2">
              <Link2 className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Will be written back to the ledger
              </span>
            </div>
            <div className="px-4 py-3 font-mono text-xs">
              <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                <span className="rounded border border-border bg-background px-2 py-1 font-semibold text-foreground">
                  Transactions #{candidate.lineId}
                </span>
                <ArrowRight className="h-3.5 w-3.5" />
                <span>
                  {pendingSlices.length === 1
                    ? "1 row"
                    : `${pendingSlices.length} rows`}
                </span>
              </div>
              <div className="space-y-1.5">
                {pendingSlices.map((slice, i) => (
                  <div
                    key={`${slice.invoiceNo || "unapplied"}-${i}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="w-24 shrink-0 rounded border border-border bg-background px-2 py-1 text-muted-foreground">
                      {i === 0 ? `#${candidate.lineId}` : "new row"}
                    </span>
                    <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-foreground">
                      {formatCurrency(slice.amount)}
                    </span>
                    {slice.invoiceNo ? (
                      <span className="rounded bg-primary px-2 py-1 font-semibold text-primary-foreground">
                        {slice.invoiceNo}
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-2 py-1 font-semibold text-muted-foreground">
                        NULL
                      </span>
                    )}
                    {slice.invoiceNo && slice.balanceAfter > 0.01 && (
                      <Chip tone="warn" className="font-sans text-[11px] font-medium">
                        partial — {formatCurrency(slice.balanceAfter)} still open
                      </Chip>
                    )}
                    {!slice.invoiceNo && (
                      <span className="font-sans text-[11px] text-muted-foreground">
                        unapplied — stays in the queue for the next run
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {pendingSlices.length > 1 && (
              <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                The line is split into one row per invoice. The rows still sum
                to {formatCurrency(candidate.lineAmount)}, so the voucher
                balances exactly as posted.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              Outstanding invoices
              <span className="ml-2 font-normal text-muted-foreground">oldest first</span>
            </p>
            {dataLoaded && outstandingInvoices.length > 6 && (
              <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:w-56">
                <Search className="h-3.5 w-3.5 flex-shrink-0" />
                <input
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="Find invoice…"
                  aria-label="Find invoice"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
              </label>
            )}
          </div>

          {!dataLoaded ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="vl-grid w-full text-sm">
                <thead>
                  <tr className={TH_ROW}>
                    <th className={cn(TH, "static w-10")}>
                      <span className="sr-only">Select</span>
                    </th>
                    <th className={cn(TH, "static")}>Invoice #</th>
                    <th className={cn(TH, "static text-right")}>Outstanding</th>
                    <th className={cn(TH, "static text-right")}>Allocate</th>
                    <th className={cn(TH, "static text-right")}>Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={cn("transition-colors", inv.selected ? "bg-primary/5" : "hover:bg-muted/50")}
                    >
                      <td className={cn(TD, "vl-check")}>
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={inv.selected}
                            onCheckedChange={(checked) =>
                              handleToggle(inv.id, checked)
                            }
                            aria-label={`Select invoice ${inv.invoiceNo}`}
                          />
                          <span className="text-xs font-semibold text-muted-foreground md:hidden">
                            {inv.selected ? "Selected" : "Select"}
                          </span>
                        </label>
                      </td>
                      <td data-label="Invoice #" className={TD}>
                        <span className={CODE_CHIP}>{inv.invoiceNo}</span>
                      </td>
                      <td data-label="Outstanding" className={cn(TD, NUM, "whitespace-nowrap text-foreground")}>
                        {formatCurrency(inv.amountReceivable)}
                      </td>
                      <td data-label="Allocate" className={cn(TD, "md:text-right")}>
                        <Input
                          type="number"
                          value={inv.amountAdjusted || ""}
                          onChange={(e) =>
                            handleManualAmount(inv.id, e.target.value)
                          }
                          aria-label={`Allocate to ${inv.invoiceNo}`}
                          className={cn(
                            "h-9 w-full text-right tabular-nums md:ml-auto md:w-32",
                            inv.selected && inv.amountAdjusted > 0 && "border-primary/40 font-semibold",
                          )}
                        />
                      </td>
                      <td data-label="Balance after" className={cn(TD, NUM, "whitespace-nowrap font-semibold text-foreground")}>
                        {formatCurrency(inv.balanceAfter)}
                      </td>
                    </tr>
                  ))}

                  {visibleInvoices.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <LabEmpty
                          icon={Inbox}
                          title={invoiceSearch ? "No invoice matches" : "No outstanding invoices"}
                          hint={
                            invoiceSearch
                              ? "Clear the search to see every open invoice for this party."
                              : "This party has nothing open to settle against."
                          }
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sticky action bar: count + total, then the decision */}
        <div className={cn(DIALOG_FOOT, "items-center justify-between")}>
          <div className="min-w-0 flex-1 basis-full text-sm sm:basis-auto">
            <p className="font-semibold text-foreground">
              Total allocated · {selectedInvoices.length} invoice
              {selectedInvoices.length === 1 ? "" : "s"}
              <span className="ml-2 tabular-nums text-primary">{formatCurrency(totalAllocated)}</span>
            </p>
            {unallocated > 0.01 && (
              <p className="text-xs text-muted-foreground">
                {formatCurrency(unallocated)} of this line will remain
                unallocated and stay in the review queue.
              </p>
            )}
          </div>

          <div className="flex gap-2 max-sm:w-full">
            <Button variant="outline" className="max-sm:flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="max-sm:flex-1"
              disabled={saveMutation.isPending || selectedInvoices.length === 0}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Allocation
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
