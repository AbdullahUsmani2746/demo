"use client";

// ============================================================
// SALE RETURN REMARKS — the sales person's reason for every Sale Return
// ============================================================
// Each sale return (tran_code 10) gets a reason:
//   · Commercial — remarks written, done.
//   · Technical  — remarks written, then approved / rejected by a saleReturn.approve
//                  holder on /accounting/forms/saleReturnApprovals.
// A sales person sees only their own customers' returns; salesTeam.viewAll holders
// and salesTeam.viewAll see everyone's.
// Rules: lib/saleReturns/remarks.js
// ============================================================

import { Fragment, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeyCombo } from "@/components/ui/KeyboardHint";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import {
  BadgeCheck,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  PencilLine,
  RotateCcw,
  Search,
  Undo2,
  Wrench,
  XCircle,
} from "lucide-react";

const qtyFmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const amtFmt = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = (v) => (v ? format(new Date(v), "dd MMM yyyy") : "—");
const dateTimeFmt = (v) => (v ? format(new Date(v), "dd MMM yyyy, hh:mm a") : "—");

// Default date range: the current month (1st → last day), as yyyy-MM-dd.
const monthStart = () => {
  const d = new Date();
  return format(new Date(d.getFullYear(), d.getMonth(), 1), "yyyy-MM-dd");
};
const monthEnd = () => {
  const d = new Date();
  return format(new Date(d.getFullYear(), d.getMonth() + 1, 0), "yyyy-MM-dd");
};

const TH =
  "h-11 whitespace-nowrap border-b-2 border-slate-300 bg-slate-100 px-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700";
const TD = "border-b border-slate-200 px-3 py-2.5 text-sm";
const FIELD =
  "h-9 rounded-lg border border-primary/40 bg-background px-3 text-sm focus:border-primary focus:outline-none";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "none", label: "Not entered" },
  { value: "commercial", label: "Commercial" },
  { value: "technical", label: "Technical" },
  // { value: "pending", label: "Waiting approval" },
  // { value: "approved", label: "Approved" },
  // { value: "rejected", label: "Rejected" },
];

export function ReasonBadge({ row }) {
  if (!row.reason_type) {
    return <span className="text-xs font-semibold text-slate-400">Not entered</span>;
  }
  if (row.reason_type === "COMMERCIAL") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 ring-1 ring-sky-300">
        <Briefcase className="h-3 w-3" />
        Commercial
      </span>
    );
  }
  // No approval any more: Technical shows just its type badge.
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800 ring-1 ring-violet-300">
      <Wrench className="h-3 w-3" />
      Technical
    </span>
  );
  // eslint-disable-next-line no-unreachable
  const status = {
    PENDING: { cls: "bg-amber-100 text-amber-800 ring-amber-300", icon: Clock, text: "Waiting approval" },
    APPROVED: { cls: "bg-emerald-100 text-emerald-800 ring-emerald-300", icon: BadgeCheck, text: "Approved" },
    REJECTED: { cls: "bg-red-100 text-red-800 ring-red-300", icon: XCircle, text: "Rejected" },
  }[row.status] ?? { cls: "bg-slate-100 text-slate-700 ring-slate-300", icon: Clock, text: row.status };
  const Icon = status.icon;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800 ring-1 ring-violet-300">
        <Wrench className="h-3 w-3" />
        Technical
      </span>
      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ring-1 ${status.cls}`}>
        <Icon className="h-3 w-3" />
        {status.text}
      </span>
    </span>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value ?? 0}</p>
    </div>
  );
}

export default function SaleReturnRemarksForm() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(monthEnd);
  const [salesPerson, setSalesPerson] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");

  // Opened from a notification: /…/saleReturnRemarks?search=<tran_id>.
  // The return may be from an earlier month, so drop the month filter.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("search");
    if (q) {
      setSearch(q);
      setDateFrom("");
      setDateTo("");
    }
  }, []);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["saleReturnRemarks", dateFrom, dateTo],
    queryFn: async () =>
      (
        await axios.get("/api/sale-returns/remarks", {
          params: { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
        })
      ).data,
    refetchInterval: 60_000,
  });

  const all = data?.data ?? [];
  const summary = data?.summary ?? {};
  const seesAll = Boolean(data?.seesAll);

  // Every sales person assigned to a customer (ACNO.salesArea) — same list as
  // the Sales Team MIS. Only needed when this user sees everyone's returns.
  const { data: spData } = useQuery({
    queryKey: ["customerSalesPersons"],
    queryFn: async () => (await axios.get("/api/accounts/customer-sales-persons")).data,
    enabled: seesAll,
    staleTime: 5 * 60_000,
  });
  const salesPeople = useMemo(
    () => (spData?.data ?? []).map((u) => [u.id, u.name]),
    [spData],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (salesPerson && r.sales_person !== salesPerson) return false;
      if (filter === "none" && r.reason_type) return false;
      if (filter === "commercial" && r.reason_type !== "COMMERCIAL") return false;
      if (filter === "technical" && r.reason_type !== "TECHNICAL") return false;
      if (["pending", "approved", "rejected"].includes(filter) && r.status !== filter.toUpperCase()) return false;
      if (!q) return true;
      return [r.vr_no, r.tran_id, r.customer, r.acno, r.invoice_no, r.sales_person_name, r.remarks,
        ...r.lines.flatMap((l) => [l.item, l.code])]
        .filter((v) => v !== null && v !== undefined)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [all, filter, search, salesPerson]);

  const save = useMutation({
    mutationFn: (body) => axios.post("/api/sale-returns/remarks", body),
    onSuccess: (res) => {
      toast.success(res.data?.message || "Saved");
      closeEditor();
      queryClient.invalidateQueries({ queryKey: ["saleReturnRemarks"] });
    },
    onError: (err) => toast.error(err?.response?.data?.error || "Could not save remarks"),
  });

  const openEditor = (row) => {
    setEditing(row);
    setReason(row.reason_type || "");
    setRemarks(row.remarks || "");
  };
  const closeEditor = () => {
    setEditing(null);
    setReason("");
    setRemarks("");
  };
  const confirmSave = () => {
    if (!editing || save.isPending) return;
    if (!reason) return toast.error("Select Technical or Commercial reason");
    if (!remarks.trim()) return toast.error("Write the reason in remarks");
    save.mutate({ tran_id: editing.tran_id, reason_type: reason, remarks });
  };

  useKeyboardShortcuts(
    {
      "ctrl+enter": { handler: confirmSave, allowInInput: true },
      "ctrl+s": { handler: confirmSave, allowInInput: true },
    },
    Boolean(editing),
    true,
  );

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reset = () => {
    setFilter("all");
    setSearch("");
    setDateFrom(monthStart());
    setDateTo(monthEnd());
    setSalesPerson("");
  };

  const colCount = seesAll ? 10 : 9;

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-sm">
            <Undo2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Sale Return Remarks</h1>
            <p className="max-w-3xl text-sm text-slate-600">
              {/* Give every sale return a reason. A <strong>Commercial</strong> reason is saved as is; a{" "}
              <strong>Technical</strong> reason goes for approval. */}
              Give every sale return a reason — <strong>Technical</strong> or{" "}
              <strong>Commercial</strong>.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Sale returns" value={summary.total} tone="text-slate-900" />
          <StatCard label="Not entered" value={summary.none} tone="text-slate-500" />
          <StatCard label="Commercial" value={summary.commercial} tone="text-sky-700" />
          <StatCard label="Technical" value={summary.technical} tone="text-violet-700" />
          {/* <StatCard label="Waiting approval" value={summary.pending} tone="text-amber-600" />
          <StatCard label="Approved" value={summary.approved} tone="text-emerald-700" />
          <StatCard label="Rejected" value={summary.rejected} tone="text-red-600" /> */}
        </div>

        <Card className="overflow-hidden border-2 border-slate-300 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 p-3">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList className="h-9 flex-wrap">
                {FILTERS.map((f) => (
                  <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search return #, customer, item…"
                className={`${FIELD} w-64 pl-8`}
              />
            </div>
            <span className="text-sm text-slate-600">Date</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={FIELD} />
            <span className="text-sm text-slate-600">to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={FIELD} />
            {seesAll ? (
              <select value={salesPerson} onChange={(e) => setSalesPerson(e.target.value)} className={`${FIELD} w-52`}>
                <option value="">All sales persons</option>
                {salesPeople.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            ) : null}
            <Button variant="ghost" size="sm" className="gap-1" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            {isFetching && !isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
          </div>
          {!dateFrom && !dateTo && all.length >= 500 ? (
            <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
              Showing the latest 500 sale returns — pick a date range to see older ones.
            </div>
          ) : null}

          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
                <Undo2 className="h-10 w-10 text-slate-400" />
                <p className="font-semibold">No sale returns here</p>
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[1150px] border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={`${TH} w-8`} />
                      <th className={TH}>Return #</th>
                      <th className={TH}>Date</th>
                      <th className={TH}>Customer</th>
                      {seesAll ? <th className={TH}>Sales person</th> : null}
                      <th className={TH}>Items</th>
                      <th className={`${TH} text-right`}>Qty</th>
                      <th className={TH}>Reason</th>
                      <th className={TH}>Remarks</th>
                      <th className={`${TH} text-right`}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const open = expanded.has(r.tran_id);
                      return (
                        <Fragment key={r.tran_id}>
                          <tr className="cursor-pointer transition-colors hover:bg-slate-50" onClick={() => toggle(r.tran_id)}>
                            <td className={TD}>
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </td>
                            <td className={`${TD} font-mono font-bold`}>{r.vr_no}</td>
                            <td className={`${TD} whitespace-nowrap`}>{dateFmt(r.dated)}</td>
                            <td className={TD}>
                              <div className="max-w-[260px] truncate font-semibold" title={r.customer}>{r.customer}</div>
                              <div className="font-mono text-xs text-slate-500">{r.acno}</div>
                            </td>
                            {seesAll ? <td className={`${TD} whitespace-nowrap`}>{r.sales_person_name || "—"}</td> : null}
                            <td className={TD}>
                              <div className="max-w-[220px] truncate" title={r.lines.map((l) => l.item).join(", ")}>
                                {r.lines[0]?.item ?? "—"}
                              </div>
                              {r.lines.length > 1 ? (
                                <div className="text-xs text-slate-500">+{r.lines.length - 1} more</div>
                              ) : null}
                            </td>
                            <td className={`${TD} text-right font-semibold tabular-nums`}>{qtyFmt(r.total_qty)}</td>
                            <td className={TD}><ReasonBadge row={r} /></td>
                            <td className={TD}>
                              <div className="max-w-[260px] truncate text-slate-700" title={r.remarks || ""}>
                                {r.remarks || "—"}
                              </div>
                              {r.status === "REJECTED" && r.decision_remarks ? (
                                <div className="max-w-[260px] truncate text-xs text-red-600" title={r.decision_remarks}>
                                  Rejected: {r.decision_remarks}
                                </div>
                              ) : null}
                            </td>
                            <td className={`${TD} text-right`} onClick={(e) => e.stopPropagation()}>
                              {/* No approval any more — every reason can be edited */}
                              {false ? (
                                <span className="text-xs font-semibold text-emerald-700">Approved</span>
                              ) : (
                                <Button size="sm" variant={r.reason_type ? "outline" : "default"} className="h-8 gap-1" onClick={() => openEditor(r)}>
                                  <PencilLine className="h-3.5 w-3.5" />
                                  {r.reason_type ? "Edit" : "Add reason"}
                                </Button>
                              )}
                            </td>
                          </tr>
                          {open ? (
                            <tr>
                              <td colSpan={colCount} className="border-b-2 border-slate-300 bg-slate-50 px-6 py-4">
                                <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                                  {r.invoice_no ? <span><strong>Invoice:</strong> {r.invoice_no}</span> : null}
                                  {r.created_by ? <span><strong>Return entered by:</strong> {r.created_by}</span> : null}
                                  {r.entered_by ? <span><strong>Reason by:</strong> {r.entered_by} · {dateTimeFmt(r.entered_at)}</span> : null}
                                  {r.decided_by ? (
                                    <span>
                                      <strong>{r.status === "APPROVED" ? "Approved" : "Rejected"} by:</strong> {r.decided_by} · {dateTimeFmt(r.decided_at)}
                                    </span>
                                  ) : null}
                                  {r.narration ? <span><strong>Narration:</strong> {r.narration}</span> : null}
                                </div>
                                <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
                                  <thead>
                                    <tr className="bg-slate-100 text-left text-xs font-bold uppercase text-slate-700">
                                      <th className="px-3 py-2">Code</th>
                                      <th className="px-3 py-2">Item</th>
                                      <th className="px-3 py-2">Unit</th>
                                      <th className="px-3 py-2 text-right">Qty (KG)</th>
                                      <th className="px-3 py-2 text-right">Rate</th>
                                      <th className="px-3 py-2 text-right">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {r.lines.map((l) => (
                                      <tr key={l.id}>
                                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{l.code || l.itcd}</td>
                                        <td className="px-3 py-2 font-medium">{l.item}</td>
                                        <td className="px-3 py-2">{l.unit || "KG"}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(l.qty)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{l.rate ? amtFmt(l.rate) : "—"}</td>
                                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{amtFmt(l.amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && closeEditor()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sale Return #{editing?.vr_no} — reason</DialogTitle>
            <DialogDescription>
              {editing ? (
                <>
                  <strong>{editing.customer}</strong> — {editing.lines.length} item
                  {editing.lines.length === 1 ? "" : "s"}, {qtyFmt(editing.total_qty)} KG.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-600">Remarks</p>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${FIELD} w-full`}>
                <option value="">Select reason…</option>
                <option value="TECHNICAL">1 · Technical Reason</option>
                <option value="COMMERCIAL">2 · Commercial Reason</option>
              </select>
            </div>
            {reason ? (
              <>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={reason === "TECHNICAL" ? "Describe the technical reason" : "Describe the commercial reason"}
                  rows={3}
                  maxLength={1000}
                />
                {/* {reason === "TECHNICAL" ? (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                    A Technical reason goes to the approvers for approval.
                  </p>
                ) : null} */}
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEditor}>Cancel</Button>
            <Button disabled={save.isPending} onClick={confirmSave}>
              {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {/* {reason === "TECHNICAL" ? "Send for approval" : "Save"} */}
              Save
              <span className="ml-1.5 hidden opacity-80 md:inline"><KeyCombo combo="Ctrl+Enter" /></span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
