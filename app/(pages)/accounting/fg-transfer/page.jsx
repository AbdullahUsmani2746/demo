"use client";
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowRightLeft,
  ArrowRight,
  Warehouse,
  ClipboardCheck,
  Clock,
  TrendingUp,
  Loader2,
  InboxIcon,
  ShieldCheck,
  AlertCircle,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import axios from "axios";
import {
  LabHeader, LabCard, LabStat, LabEmpty, Chip, CODE_CHIP, TH, TD, NUM,
} from "@/components/Material/shared/LabUI";

/* ─────────────────────────────── constants ─────────────────────────────── */

const STATUS_OPTIONS = [
  { value: "all",      label: "All Requests" },
  { value: "Pending",  label: "Pending"       },
  { value: "Accepted", label: "Accepted"      },
  { value: "Rejected", label: "Rejected"      },
];

// Status → Chip tone (components/Material/shared/LabUI.jsx) + icon.
const STATUS_META = {
  Pending:  { tone: "warn", icon: Clock        },
  Accepted: { tone: "ok",   icon: CheckCircle2 },
  Rejected: { tone: "bad",  icon: XCircle      },
};

const fmtDate = (v, opts = { day: "2-digit", month: "short", year: "numeric" }) =>
  v ? new Date(v).toLocaleDateString("en-GB", opts) : "—";

/* ─────────────────────────── sub-components ────────────────────────────── */

const StatusPill = ({ status }) => {
  const meta = STATUS_META[status] ?? { tone: "muted", icon: AlertCircle };
  const Icon = meta.icon;
  return (
    <Chip tone={meta.tone}>
      <Icon className="h-3 w-3" />
      {status ?? "Unknown"}
    </Chip>
  );
};

const RowSkeleton = () => (
  <tr>
    <td colSpan={8} className="px-3 py-3">
      <Skeleton className="h-6 w-full rounded-md" />
    </td>
  </tr>
);

export default function FgTransferPage() {
  const [rows,         setRows]         = useState([]);
  const [total,        setTotal]        = useState(0);
  const [totalPages,   setTotalPages]   = useState(1);
  const [stats,        setStats]        = useState({ pending: 0, accepted: 0, rejected: 0 });
  const [page,         setPage]         = useState(1);
  const [loading,      setLoading]      = useState(false);
  const [processing,   setProcessing]   = useState(null);
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [search,       setSearch]       = useState("");
  const LIMIT = 15;
  const searchRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page:  String(page),
        limit: String(LIMIT),
        ...(statusFilter !== "all" && { status: statusFilter }),
      });
      const { data } = await axios.get(`/api/manufacturing/fg-transfer?${params}`);
      setRows(data.data ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      toast.error("Failed to load FG Transfer requisitions");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const [p, a, r] = await Promise.all([
        axios.get("/api/manufacturing/fg-transfer?status=Pending&limit=1"),
        axios.get("/api/manufacturing/fg-transfer?status=Accepted&limit=1"),
        axios.get("/api/manufacturing/fg-transfer?status=Rejected&limit=1"),
      ]);
      setStats({ pending: p.data.total ?? 0, accepted: a.data.total ?? 0, rejected: r.data.total ?? 0 });
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchData(); },  [fetchData]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { setPage(1); },   [statusFilter]);

  const handleAction = async (tran_id, action) => {
    setProcessing(tran_id);
    try {
      const { data } = await axios.patch("/api/manufacturing/fg-transfer", { tran_id, action });
      toast.success(
        action === "accept"
          ? "✅ Transfer accepted — stock moved to FG godown"
          : "Requisition rejected",
      );
      // Short stock while Settings → Stock checking is on Warn.
      for (const w of data?.warnings ?? []) toast.warning(w, { duration: 12000 });
      fetchData();
      fetchStats();
    } catch (err) {
      toast.error(err?.response?.data?.error ?? "Action failed");
    } finally {
      setProcessing(null);
    }
  };

  const filtered = search.trim()
    ? rows.filter((r) => {
        const q    = search.toLowerCase();
        const name = r.details?.[0]?.item?.item?.toLowerCase() ?? "";
        return (
          String(r.tran_id).includes(q) ||
          String(r.plan_id ?? "").includes(q) ||
          name.includes(q)
        );
      })
    : rows;

  // "/" focuses the search (Ctrl+K is the header's menu search).
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pageQty = filtered.reduce((s, r) => s + Number(r.details?.[0]?.qty || 0), 0);

  return (
    <div className="min-h-screen bg-muted/40">
      <main className="mx-auto max-w-[1600px] space-y-5 px-3 py-5 sm:px-6">

        {/* ── Header ── */}
        <LabHeader
          icon={ArrowRightLeft}
          breadcrumb="Accounting"
          title="FG Transfer — Acceptance"
          subtitle="Finished Goods department · Review & accept Production Floor transfers"
          actions={
            <Button variant="outline" size="sm" className="h-9" onClick={() => { fetchData(); fetchStats(); }} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          }
        />

        {/* ── Stat tiles ── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <LabStat label="Pending"  value={stats.pending}  icon={Clock}       tone="warn"  hint="Awaiting acceptance" />
          <LabStat label="Accepted" value={stats.accepted} icon={ShieldCheck} tone="ok"    hint="Stock transferred" />
          <LabStat label="Rejected" value={stats.rejected} icon={XCircle}     tone="bad"   hint="Declined transfers" />
          <LabStat label="Total"    value={stats.pending + stats.accepted + stats.rejected} icon={TrendingUp} tone="brand" hint="All requisitions" />
        </div>

        {/* ── List card ── */}
        <LabCard
          icon={ClipboardCheck}
          title="Transfer Requisitions"
          subtitle={`${total} result${total !== 1 ? "s" : ""}`}
          actions={statusFilter === "Pending" && stats.pending > 0 ? <Chip tone="warn">{stats.pending} pending review</Chip> : null}
        >
          {/* Toolbar: status filter + search */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/60 p-0.5" role="tablist" aria-label="Status">
              {STATUS_OPTIONS.map((o) => {
                const on = statusFilter === o.value;
                const count = o.value !== "all" ? stats[o.value.toLowerCase()] : 0;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setStatusFilter(o.value)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      on ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.label}
                    {count > 0 && (
                      <span className={`rounded-full px-1.5 text-[11px] font-semibold leading-5 tabular-nums ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:max-w-md">
              <Search className="h-4 w-4 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search req #, process order, item name…"
                aria-label="Search requisitions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearch("")}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
              {search ? (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
              )}
            </label>
            {search.trim() && (
              <span className="text-xs text-muted-foreground">Searching this page only</span>
            )}
          </div>

          {/* Table — a card per row under md (table.vl-grid in app/globals.css) */}
          <div className="max-h-[70vh] overflow-auto">
            <table className="vl-grid w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Req #</th>
                  <th className={TH}>Date</th>
                  <th className={TH}>Process Ord.</th>
                  <th className={TH}>Item</th>
                  <th className={`${TH} text-right`}>Qty</th>
                  <th className={TH}>From → To</th>
                  <th className={TH}>Status</th>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <LabEmpty
                        icon={InboxIcon}
                        title="No requisitions found"
                        hint={statusFilter === "Pending"
                          ? "All transfers have been reviewed — great work!"
                          : "Try changing the filter or search query"}
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => {
                    const detail     = row.details?.[0];
                    const item       = detail?.item;
                    const isPending  = row.status === "Pending";
                    const isLoading  = processing === row.tran_id;
                    const fromGodown = row.godown2Details?.godown ?? `Godown ${row.issued_by ?? "—"}`;
                    const toGodown   = row.godownDetails?.godown  ?? `Godown ${row.issued_for ?? "—"}`;

                    return (
                      <tr key={row.tran_id} className="transition-colors hover:bg-muted/40">
                        <td className={TD} data-label="Req #">
                          <span className={CODE_CHIP}>#{row.tran_id}</span>
                        </td>
                        <td className={`${TD} whitespace-nowrap tabular-nums text-muted-foreground`} data-label="Date">
                          {fmtDate(row.dated)}
                        </td>
                        <td className={TD} data-label="Process Ord.">
                          {row.plan_id ? <span className={CODE_CHIP}>PO #{row.plan_id}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={`${TD} max-md:col-span-2`} data-label="Item">
                          <p className="font-semibold text-foreground md:max-w-[280px] md:truncate">
                            {item?.item ?? (detail?.itcd ? `Item #${detail.itcd}` : "—")}
                          </p>
                          {item?.code && <p className="font-mono text-xs text-muted-foreground">{item.code}</p>}
                        </td>
                        <td className={`${TD} ${NUM} whitespace-nowrap`} data-label="Qty">
                          <span className="font-semibold text-foreground">
                            {detail?.qty != null ? Number(detail.qty).toFixed(2) : "—"}
                          </span>
                          {item?.unit && <span className="ml-1 text-xs text-muted-foreground">{item.unit}</span>}
                          {detail?.ap_qty != null && (
                            <p className="text-xs font-semibold text-[#2f5139] dark:text-emerald-300" title="Accepted quantity">
                              ✓ {Number(detail.ap_qty).toFixed(2)}
                            </p>
                          )}
                        </td>
                        <td className={`${TD} max-md:col-span-2`} data-label="From → To">
                          <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-foreground">
                            <Warehouse className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                            <span className="truncate">{fromGodown}</span>
                            <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                            <span className="truncate font-medium">{toGodown}</span>
                          </span>
                        </td>
                        <td className={TD} data-label="Status">
                          <StatusPill status={row.status} />
                        </td>
                        <td className={`${TD} vl-actions text-right`}>
                          {isPending ? (
                            <div className="inline-flex flex-wrap justify-end gap-1.5 max-md:w-full max-md:[&>*]:flex-1">
                              <Button
                                size="sm"
                                disabled={isLoading}
                                onClick={() => handleAction(row.tran_id, "accept")}
                                className="h-8 gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                              >
                                {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isLoading}
                                onClick={() => handleAction(row.tran_id, "reject")}
                                className="h-8 gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" title="Decided on">
                              {row.app_date ? fmtDate(row.app_date) : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!loading && filtered.length > 0 && (
                <tfoot className="max-md:hidden">
                  <tr className="border-t-2 border-primary bg-muted/50 font-semibold">
                    <td className={TD} colSpan={4}>Total · {filtered.length} on this page</td>
                    <td className={`${TD} ${NUM}`}>{pageQty.toFixed(2)}</td>
                    <td className={TD} colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
              <span className="text-sm text-muted-foreground">
                Page <span className="font-semibold text-foreground">{page}</span> of{" "}
                <span className="font-semibold text-foreground">{totalPages}</span>
                <span className="ml-2">({total} total)</span>
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                  return (
                    <Button
                      key={p}
                      size="sm"
                      variant={p === page ? "default" : "outline"}
                      onClick={() => setPage(p)}
                      aria-current={p === page ? "page" : undefined}
                      className={`h-8 w-8 p-0 tabular-nums ${p === page ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
                    >
                      {p}
                    </Button>
                  );
                })}
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </LabCard>
      </main>
    </div>
  );
}
