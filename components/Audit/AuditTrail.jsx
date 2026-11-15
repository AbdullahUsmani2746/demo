"use client";

// components/Audit/AuditTrail.jsx — the Audit Trail screen (/dashboard/audit-trail):
// who created, changed or deleted what, and when, over every audited table.
//
//   Filters      date range, area, tables, action, user, source, search — all
//                in the URL, so a filtered view is a shareable link
//   Timeline     grouped by day; adjacent rows of one save boxed together
//   Detail       side sheet: field diff / full record + jumps to the record's
//                history, its whole document and the save
//   Scopes       ?doc_model=&doc_id= (a voucher with all its lines, all time),
//                ?record=&model= (one record), ?batch= (one save)
//
// Data: GET /api/audit (audit.view; 403 → no-access card), /api/audit/meta.
import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FilePen,
  FilePlus2,
  FileStack,
  FileX2,
  History,
  Layers,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api, BRAND_BTN, EmptyState, PageHeader, StatTile } from "@/components/HR/shared";
import { auditLabel } from "@/lib/audit/catalog";
import AuditFilters, { ActiveChips } from "./AuditFilters";
import AuditTimeline, { whoOf } from "./AuditTimeline";
import AuditDetailSheet from "./AuditDetailSheet";
import { FILTER_KEYS, SCOPE_KEYS, fmtDateTime, fmtDayShort, fmtNum, fmtValue, humanize, presetRange, scopeOf } from "./format";

const PAGE_SIZE = 50;
const EXPORT_SIZE = 200;
const EXPORT_MAX = 2000;

/** "Vouchers" → "Voucher" for headings about one document. */
const singular = (label) => (/ies$/.test(label) ? label.replace(/ies$/, "y") : /[^s]s$/.test(label) ? label.slice(0, -1) : label);

function TimelineSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading changes">
      <Skeleton className="h-4 w-32" />
      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3.5">
            <Skeleton className="hidden h-3 w-10 sm:block" />
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-48 max-w-full" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NoAuditAccess() {
  return (
    <div className="mx-auto mt-10 flex max-w-lg items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div>
        <p className="font-semibold">You do not have access to the audit trail.</p>
        <p className="mt-1 text-sm">It needs the “View audit trail” right (audit.view). Ask an administrator to grant it on Admin → Permissions.</p>
      </div>
    </div>
  );
}

function ScopeCard({ scope, params, first, total, onBack }) {
  let icon = FileStack;
  let title = "";
  let hint = "";
  if (scope === "document") {
    title = `${singular(auditLabel(params.doc_model))} #${params.doc_id} — full history`;
    hint = "The document and every line that belongs to it, over all time.";
  } else if (scope === "record") {
    icon = History;
    title = `${singular(auditLabel(params.model))} #${params.record} — record history`;
    hint = "Every change to this one record, over all time.";
  } else {
    icon = Layers;
    title = "One save — everything written together";
    hint = first ? `${whoOf(first)} · ${fmtDateTime(first.dated)}` : "Every row written by the same save.";
  }
  const Icon = icon;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#800000]/20 bg-gradient-to-r from-[#800000]/[0.05] to-white p-4 shadow-sm sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="shrink-0 rounded-lg bg-[#800000]/10 p-2 text-[#800000]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">{title}</h2>
          <p className="text-xs text-slate-600 sm:text-sm">
            {hint}
            {total != null && <span className="tabular-nums"> · {fmtNum(total)} change{total === 1 ? "" : "s"}</span>}
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="h-9 sm:ml-auto" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        All changes
      </Button>
    </div>
  );
}

export default function AuditTrail() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const spString = sp.toString();
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);
  const listQuery = useRef("");

  const params = useMemo(() => {
    const s = new URLSearchParams(spString);
    return Object.fromEntries([...FILTER_KEYS, ...SCOPE_KEYS].map((k) => [k, s.get(k) || ""]));
  }, [spString]);
  const scope = scopeOf(params);

  const setParams = useCallback(
    (patch) => {
      const s = new URLSearchParams(spString);
      for (const [k, v] of Object.entries(patch)) {
        if (v === "" || v == null) s.delete(k);
        else s.set(k, v);
      }
      const qs = s.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [spString, pathname, router],
  );

  const goScope = useCallback(
    (scopeParams) => {
      if (!scope) listQuery.current = spString;
      setSelected(null);
      const qs = new URLSearchParams(scopeParams).toString();
      router.push(`${pathname}?${qs}`);
    },
    [scope, spString, pathname, router],
  );
  const leaveScope = () => {
    const qs = listQuery.current;
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const clearAll = () => {
    const keep = Object.fromEntries(Object.entries(params).filter(([k, v]) => v && (SCOPE_KEYS.includes(k) || (scope === "record" && k === "model"))));
    const qs = new URLSearchParams(keep).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // What goes to the API: the filters, the scope, and an explicit date range.
  const range = params.from || params.to ? { from: params.from || params.to, to: params.to || params.from } : presetRange("7d");
  const apiQs = useMemo(() => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "from" && k !== "to") s.set(k, v);
    if (!scope) {
      s.set("from", range.from);
      s.set("to", range.to);
    }
    return s.toString();
  }, [params, scope, range.from, range.to]);

  const meta = useQuery({ queryKey: ["audit-meta"], queryFn: () => api("/api/audit/meta"), staleTime: 5 * 60_000, retry: false });

  const q = useInfiniteQuery({
    queryKey: ["audit", apiQs],
    queryFn: ({ pageParam }) => api(`/api/audit?${apiQs}&page=${pageParam}&size=${PAGE_SIZE}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
    retry: (n, e) => e?.status !== 403 && n < 2,
    staleTime: 30_000,
  });

  const first = q.data?.pages?.[0];
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  const facets = first?.facets;
  const total = first?.total ?? 0;
  const acts = facets?.actions ?? {};
  const people = (facets?.users ?? []).filter((u) => u.id).length;
  const hasSystem = (facets?.users ?? []).some((u) => !u.id);
  const forbidden = q.error?.status === 403;

  const exportExcel = async () => {
    setExporting(true);
    try {
      const all = [];
      let totalRows = 0;
      for (let page = 1; all.length < EXPORT_MAX; page += 1) {
        const d = await api(`/api/audit?${apiQs}&page=${page}&size=${EXPORT_SIZE}`);
        totalRows = d.total;
        all.push(...d.rows);
        if (!d.rows.length || page * d.size >= d.total) break;
      }
      const XLSX = await import("xlsx");
      const head = ["Date & time", "User", "Made by", "Action", "Table", "Record", "Document", "Document no.", "Field", "Before", "After", "Save", "Entry"];
      const body = [];
      const flat = (v) => fmtValue(v).replace(/\s+/g, " ");
      for (const r of all.slice(0, EXPORT_MAX)) {
        const base = [fmtDateTime(r.dated), whoOf(r), r.source === "system" || !r.user_id ? "System" : "Person", { create: "Created", update: "Changed", delete: "Deleted" }[r.action] ?? r.action, r.model_label, r.record_id, r.doc_label, r.doc_id];
        const tail = [r.batch_id ?? "", r.id];
        if (r.action === "update" && Array.isArray(r.changes) && r.changes.length) {
          for (const c of r.changes) body.push([...base, humanize(c.field), flat(c.old), flat(c.new), ...tail]);
        } else {
          const snap = r.snapshot && typeof r.snapshot === "object" ? Object.entries(r.snapshot).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${humanize(k)}: ${flat(v)}`).join("; ") : "";
          body.push([...base, "", r.action === "delete" ? snap : "", r.action === "create" ? snap : "", ...tail]);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
      ws["!cols"] = [18, 18, 9, 9, 18, 10, 18, 12, 20, 30, 30, 12, 9].map((wch) => ({ wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Audit trail");
      const name = scope === "document" ? `audit-${params.doc_model}-${params.doc_id}` : scope === "record" ? `audit-${params.model}-${params.record}` : scope === "batch" ? "audit-save" : `audit-trail-${range.from}-to-${range.to}`;
      XLSX.writeFile(wb, `${name}.xlsx`);
      if (totalRows > EXPORT_MAX) toast.warning(`Exported the latest ${fmtNum(EXPORT_MAX)} of ${fmtNum(totalRows)} changes — narrow the filter for the rest.`);
      else toast.success(`Exported ${fmtNum(Math.min(all.length, EXPORT_MAX))} changes.`);
    } catch (e) {
      toast.error(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const exportBtn = (
    <Button variant="outline" className="h-9 shrink-0" onClick={exportExcel} disabled={exporting || !total || forbidden} aria-label="Export to Excel">
      {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      <span className="max-sm:hidden">Excel</span>
    </Button>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <PageHeader
        icon={History}
        title="Audit Trail"
        subtitle="Who created, changed or deleted what — and when — across every audited table."
        actions={
          <Button variant="outline" className="h-9" onClick={() => q.refetch()} disabled={q.isFetching || forbidden} aria-label="Refresh">
            <RefreshCw className={cn("h-4 w-4", q.isFetching && !q.isFetchingNextPage && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        {forbidden ? (
          <NoAuditAccess />
        ) : (
          <>
            {scope && <ScopeCard scope={scope} params={params} first={rows[0]} total={first ? total : null} onBack={leaveScope} />}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile
                label={scope ? "Changes" : "Changes in range"}
                icon={History}
                tone="brand"
                value={q.isLoading ? "…" : fmtNum(total)}
                hint={scope ? "All time" : `${fmtDayShort(range.from)} – ${fmtDayShort(range.to)}`}
                className="col-span-2 sm:col-span-1"
              />
              <StatTile label="Created" icon={FilePlus2} tone="emerald" value={q.isLoading ? "…" : fmtNum(acts.create)} />
              <StatTile label="Changed" icon={FilePen} tone="amber" value={q.isLoading ? "…" : fmtNum(acts.update)} />
              <StatTile label="Deleted" icon={FileX2} tone="red" value={q.isLoading ? "…" : fmtNum(acts.delete)} />
              <StatTile
                label="People"
                icon={Users}
                value={q.isLoading ? "…" : `${fmtNum(people)}${people >= 50 ? "+" : ""}`}
                hint={hasSystem ? "plus system jobs" : "made these changes"}
                className="col-span-2 sm:col-span-1"
              />
            </div>

            <AuditFilters params={params} setParams={setParams} facets={facets} meta={meta.data} scoped={scope} extra={exportBtn} />
            <ActiveChips params={params} setParams={setParams} facets={facets} meta={meta.data} scoped={scope} onClear={clearAll} />

            {first && first.extended === false && (
              <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                The audit table has not been upgraded yet — document grouping, saves and the System filter are not available until it is.
              </p>
            )}

            {q.isLoading ? (
              <TimelineSkeleton />
            ) : q.isError ? (
              <div className="rounded-xl border border-red-200 bg-white shadow-sm">
                <EmptyState
                  icon={AlertTriangle}
                  title="The audit trail could not be loaded"
                  hint={q.error?.message}
                  action={
                    <Button className={BRAND_BTN} onClick={() => q.refetch()}>
                      <RefreshCw className="h-4 w-4" />
                      Try again
                    </Button>
                  }
                />
              </div>
            ) : !rows.length ? (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <EmptyState
                  icon={History}
                  title="No changes found"
                  hint={scope ? "Nothing has been recorded for this yet." : "Nothing matches these filters. Try a wider date range or clear the filters."}
                  action={
                    !scope && (
                      <Button variant="outline" onClick={clearAll}>
                        Clear filters
                      </Button>
                    )
                  }
                />
              </div>
            ) : (
              <>
                <AuditTimeline rows={rows} onOpen={setSelected} onBatch={scope === "batch" ? null : (batch) => goScope({ batch })} />
                <div className="flex flex-col items-center gap-2 pb-4 pt-1">
                  <p className="text-xs tabular-nums text-slate-500">
                    Showing {fmtNum(rows.length)} of {fmtNum(total)}
                  </p>
                  {q.hasNextPage && (
                    <Button variant="outline" className="w-full sm:w-auto" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                      {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
                      Load more
                    </Button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>

      <AuditDetailSheet
        row={selected}
        onClose={() => setSelected(null)}
        onRecord={(r) => goScope({ record: String(r.record_id), model: r.model_name })}
        onDocument={(r) => goScope({ doc_model: r.doc_model, doc_id: String(r.doc_id) })}
        onBatch={(batch) => goScope({ batch })}
      />
    </div>
  );
}
