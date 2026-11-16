"use client";
// Quality Assurance → Order QC. Goods received against purchase orders (QA
// Entry) waiting for QC, passed (with their GRN) and failed. A row opens the
// receipt's QC sheet. The search box also takes a scanned QA / QC barcode
// (Enter opens that receipt). Data: /api/forms/orderqualitycontrol.
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ClipboardCheck, PackageCheck, PackagePlus, RefreshCw, ScanLine, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, CODE_CHIP, EmptyState, HR_MAIN, HR_PAGE, ListSkeleton, PageHeader, Panel, TH, TH_ROW } from "@/components/HR/shared";
import { CountTabs, fmtDay, fmtQty, QcStatusChip } from "@/components/Quality/qcUi";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "DRAFT", label: "Pending" },
  { key: "APPROVED", label: "Passed" },
  { key: "REJECTED", label: "Failed" },
  { key: "ALL", label: "All" },
];
const PAGE_SIZE = 25;

export default function OrderQcPage() {
  return (
    <Suspense fallback={null}>
      <OrderQcList />
    </Suspense>
  );
}

function OrderQcList() {
  const router = useRouter();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get("status") || "DRAFT");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const searchRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...(tab !== "ALL" ? { status: tab } : {}), ...(q ? { search: q } : {}) });
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["order-qc", tab, q, page],
    queryFn: () => api(`/api/forms/orderqualitycontrol?${params}`),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data || [];
  const totalPages = data?.totalPages || 1;

  const changeTab = (k) => {
    setTab(k);
    setPage(1);
    router.replace(`?status=${k}`, { scroll: false });
  };

  // Enter on a scanned QA / QC barcode opens that receipt.
  const onSearchKey = async (e) => {
    if (e.key !== "Enter") return;
    const v = search.trim();
    if (!/^(QA|QC|QCO)-/i.test(v)) {
      if (rows.length === 1) router.push(href(rows[0]));
      return;
    }
    try {
      const res = await api("/api/forms/orderqualitycontrol/scan", { method: "POST", body: { barcode: v } });
      router.push(`/accounting/forms/orderqualitycontrol/${res.data.order_no}?qc=${res.data.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const href = (r) => `/accounting/forms/orderqualitycontrol/${r.order_no}?qc=${r.id}`;

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={PackageCheck}
        breadcrumb="Quality Assurance"
        title="Order QC"
        subtitle="Test goods received against purchase orders. Passing a receipt posts its GRN for the received quantity."
        badge={data?.counts?.DRAFT ? `${data.counts.DRAFT} pending` : undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/accounting/forms/qaEntry">
                <PackagePlus className="h-4 w-4" /> QA Entry
              </Link>
            </Button>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />
      <main className={cn(HR_MAIN, "space-y-4")}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CountTabs tabs={TABS} value={tab} onChange={changeTab} counts={data?.counts || {}} />
          <div className="relative w-full lg:w-96">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="PO no, vendor, item, batch or scan barcode  ( / )"
              className="h-9 pl-9"
              aria-label="Search or scan"
            />
          </div>
        </div>

        <Panel
          title={TABS.find((t) => t.key === tab)?.label + " receipts"}
          icon={ClipboardCheck}
          actions={<span className="text-xs text-muted-foreground tabular-nums">{data ? `${data.total} receipt${data.total === 1 ? "" : "s"}` : ""}</span>}
        >
          {isLoading ? (
            <ListSkeleton rows={6} />
          ) : error ? (
            <EmptyState icon={ShieldAlert} title="Could not load receipts" hint={error.message} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No receipts here"
              hint={q ? "Nothing matches the search." : "The store records goods received on QA Entry; they appear here for testing."}
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      <th className={TH}>Receipt</th>
                      <th className={TH}>Purchase order</th>
                      <th className={TH}>Item</th>
                      <th className={cn(TH, "text-right")}>Received / Ordered</th>
                      <th className={TH}>Batch</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>GRN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onClick={() => router.push(href(r))}
                        onKeyDown={(e) => e.key === "Enter" && router.push(href(r))}
                        className={cn("cursor-pointer hover:bg-primary/[0.03] focus:bg-primary/[0.05] focus:outline-none", r.status === "REJECTED" && "bg-red-50/40 dark:bg-red-950/10")}
                      >
                        <td className="px-3 py-2.5">
                          <span className={CODE_CHIP}>R-{r.id}</span>
                          <p className="mt-1 text-[11px] text-muted-foreground">{fmtDay(r.received_on)}</p>
                        </td>
                        <td className="max-w-[240px] px-3 py-2.5">
                          <p className="font-semibold">PO {r.order_no}</p>
                          <p className="truncate text-xs text-muted-foreground">{r.vendor_name}</p>
                        </td>
                        <td className="max-w-[280px] px-3 py-2.5">
                          <p className="truncate font-semibold">{r.item_name}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">{r.item_code}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          <b>{fmtQty(r.received_qty)}</b> <span className="text-muted-foreground">/ {fmtQty(r.ordered_qty)} {r.unit}</span>
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">{r.batch_no || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2.5">
                          <QcStatusChip status={r.status} />
                          {r.reason && <p className="mt-1 max-w-[200px] truncate text-[11px] text-muted-foreground" title={r.reason}>{r.reason}</p>}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">{r.grn_no ? `#${r.grn_no}` : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-border/70 md:hidden">
                {rows.map((r) => (
                  <Link key={r.id} href={href(r)} className="block px-4 py-3 active:bg-muted/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{r.item_name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          <span className={CODE_CHIP}>R-{r.id}</span> PO {r.order_no} · {r.vendor_name}
                        </p>
                      </div>
                      <QcStatusChip status={r.status} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Received</span>
                      <span className="text-right tabular-nums">{fmtQty(r.received_qty)} / {fmtQty(r.ordered_qty)} {r.unit}</span>
                      <span className="text-muted-foreground">Batch</span>
                      <span className="text-right font-mono">{r.batch_no || "—"}</span>
                      <span className="text-muted-foreground">GRN</span>
                      <span className="text-right font-mono">{r.grn_no ? `#${r.grn_no}` : "—"}</span>
                    </div>
                  </Link>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground tabular-nums">Page {page} of {totalPages}</span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
                    <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Panel>
      </main>
    </div>
  );
}
