"use client";
// Quality Assurance → Production QC. Every finished-goods process order waiting
// for QC, and every QC record by status (Pending / On hold / Re-test / Passed /
// Failed). A row opens the QC sheet of its process order. Data:
// /api/forms/qualitycontrol (lib/quality/productionQc.js does the writing).
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ClipboardCheck, FlaskConical, Printer, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, CODE_CHIP, EmptyState, HR_MAIN, HR_PAGE, ListSkeleton, PageHeader, Panel, TH, TH_ROW } from "@/components/HR/shared";
import { CountTabs, fmtDay, fmtQty, printProductionQc, QcStatusChip } from "@/components/Quality/qcUi";
import { useFeatures } from "@/hooks/useFeatures";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "AWAITING", label: "Awaiting QC" },
  { key: "DRAFT", label: "Pending" },
  { key: "HOLD", label: "On hold" },
  { key: "REWORK", label: "Re-test" },
  { key: "APPROVED", label: "Passed" },
  { key: "REJECTED", label: "Failed" },
  { key: "ALL", label: "All" },
];
const PAGE_SIZE = 25;

export default function ProductionQcPage() {
  return (
    <Suspense fallback={null}>
      <ProductionQcList />
    </Suspense>
  );
}

function ProductionQcList() {
  const router = useRouter();
  const sp = useSearchParams();
  const { data: session } = useSession();
  const { company } = useCompany();
  const features = useFeatures();
  const [tab, setTab] = useState(sp.get("status") || "AWAITING");
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

  // "/" jumps to the search box.
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
    queryKey: ["production-qc", tab, q, page],
    queryFn: () => api(`/api/forms/qualitycontrol?${params}`),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data || [];
  const totalPages = data?.totalPages || 1;
  const counts = data?.counts || {};

  const changeTab = (k) => {
    setTab(k);
    setPage(1);
    router.replace(`?status=${k}`, { scroll: false });
  };

  const print = async (row) => {
    const id = toast.loading("Preparing certificate…");
    try {
      const sheet = await api(`/api/forms/qualitycontrol/${row.id}`);
      await printProductionQc(sheet, { company, userName: session?.user?.name });
      toast.dismiss(id);
    } catch (e) {
      toast.error(e.message || "Could not print", { id });
    }
  };

  const openHref = (r) => `/accounting/forms/qualitycontrol/${r.id}`;

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={FlaskConical}
        breadcrumb="Quality Assurance"
        title="Production QC"
        subtitle="Test each finished-goods process order against its item's quality standards, then pass, re-test, hold or fail the batch."
        badge={counts.AWAITING ? `${counts.AWAITING} awaiting` : undefined}
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Refresh
          </Button>
        }
      />
      <main className={cn(HR_MAIN, "space-y-4")}>
        {features.on("production.qcBeforeSend") && (
          <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-[13px] text-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              <span className="font-semibold">QC gate is on.</span> A finished-goods process order can be sent to production only after QC has passed it (Settings → Features).
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CountTabs tabs={TABS} value={tab} onChange={changeTab} counts={counts} />
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Process order, batch, item…  ( / )"
              className="h-9 pl-9"
              aria-label="Search"
            />
          </div>
        </div>

        <Panel
          title={TABS.find((t) => t.key === tab)?.label}
          icon={ClipboardCheck}
          actions={<span className="text-xs text-muted-foreground tabular-nums">{data ? `${data.total} record${data.total === 1 ? "" : "s"}` : ""}</span>}
        >
          {isLoading ? (
            <ListSkeleton rows={6} />
          ) : error ? (
            <EmptyState icon={ShieldAlert} title="Could not load QC records" hint={error.message} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              title={tab === "AWAITING" ? "No process order is waiting for QC" : "No QC records here"}
              hint={q ? "Nothing matches the search." : tab === "AWAITING" ? "Finished-goods process orders appear here until their QC is started." : undefined}
            />
          ) : (
            <>
              {/* Table from md */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      <th className={TH}>Process order</th>
                      <th className={TH}>Item</th>
                      <th className={cn(TH, "text-right")}>Batch size</th>
                      <th className={TH}>Batch no</th>
                      <th className={TH}>{tab === "AWAITING" ? "Plan date" : "Mfg / Expiry"}</th>
                      <th className={TH}>Status</th>
                      <th className={cn(TH, "text-right")}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && router.push(openHref(r))}
                        onClick={() => router.push(openHref(r))}
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-primary/[0.03] focus:bg-primary/[0.05] focus:outline-none",
                          r.status === "REJECTED" && "bg-red-50/40 dark:bg-red-950/10",
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <span className={CODE_CHIP}>#{r.id}</span>
                          {r.plan_status && <p className="mt-1 text-[11px] text-muted-foreground">{r.plan_status}</p>}
                        </td>
                        <td className="max-w-[320px] px-3 py-2.5">
                          <p className="truncate font-semibold text-foreground">{r.item_name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="font-mono">{r.item_code}</span>
                            {r.customer_name && ` · ${r.customer_name}`}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.batch_size)}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">{r.batch_no || <span className="text-muted-foreground">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                          {tab === "AWAITING" ? fmtDay(r.plan_date) : [fmtDay(r.mfg_date), fmtDay(r.expiry_date)].filter(Boolean).join(" → ") || "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <QcStatusChip status={r.status} />
                          {r.reason && <p className="mt-1 max-w-[220px] truncate text-[11px] text-muted-foreground" title={r.reason}>{r.reason}</p>}
                          {!r.reason && r.attempt_no > 1 && <p className="mt-1 text-[11px] text-muted-foreground">Attempt {r.attempt_no}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1.5">
                            {(r.status === "APPROVED" || r.status === "REJECTED") && (
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => print(r)} title={r.status === "REJECTED" ? "Print non-conformity report" : "Print certificate"} aria-label="Print">
                                <Printer className="h-4 w-4" />
                              </Button>
                            )}
                            <Button asChild size="sm" variant={r.status ? "outline" : "default"} className="h-8">
                              <Link href={openHref(r)}>{!r.status ? "Start QC" : r.status === "APPROVED" || r.status === "REJECTED" ? "View" : "Test"}</Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cards under md */}
              <div className="divide-y divide-border/70 md:hidden">
                {rows.map((r) => (
                  <Link key={r.id} href={openHref(r)} className="block px-4 py-3 active:bg-muted/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{r.item_name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <span className={CODE_CHIP}>#{r.id}</span> <span className="font-mono">{r.item_code}</span>
                        </p>
                      </div>
                      <QcStatusChip status={r.status} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Batch size</span>
                      <span className="text-right tabular-nums">{fmtQty(r.batch_size)}</span>
                      <span className="text-muted-foreground">Batch no</span>
                      <span className="text-right font-mono">{r.batch_no || "—"}</span>
                      <span className="text-muted-foreground">{tab === "AWAITING" ? "Plan date" : "Mfg date"}</span>
                      <span className="text-right">{fmtDay(tab === "AWAITING" ? r.plan_date : r.mfg_date) || "—"}</span>
                    </div>
                    {r.reason && <p className="mt-1.5 truncate text-xs text-muted-foreground">{r.reason}</p>}
                  </Link>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground tabular-nums">Page {page} of {totalPages}</span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
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
