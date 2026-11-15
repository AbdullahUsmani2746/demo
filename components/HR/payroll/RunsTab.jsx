"use client";

// components/HR/payroll/RunsTab.jsx — payroll runs, and starting a new one.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { monthRange } from "@/lib/hr/time";
import { api, BRAND_BTN, EmptyState, NativeSelect } from "@/components/HR/shared";
import { Card, Chip, CodeChip, DIALOG, DIALOG_FOOTER, SCROLL, TFOOT, TH, TH_STICKY, TR } from "@/components/HR/payroll/ui";

export const RUN_STATUS_META = {
  DRAFT: { label: "Draft", tone: "muted" },
  PENDING: { label: "Waiting for approval", tone: "warn" },
  APPROVED: { label: "Approved — to post", tone: "info" },
  POSTED: { label: "Posted", tone: "ok" },
  REVERSED: { label: "Reversed", tone: "bad" },
};

export function RunStatus({ status }) {
  const m = RUN_STATUS_META[status] ?? RUN_STATUS_META.DRAFT;
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

const prevMonth = (today) => {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function RunsTab({ meta }) {
  const router = useRouter();
  const [year, setYear] = useState(meta.today.slice(0, 4));
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["hr-payroll-runs", year], queryFn: () => api(`/api/hr/payroll?year=${year}`) });
  const runs = data?.runs ?? [];
  // Year totals in the footer — reversed runs are left out (they are undone in the books).
  const live = runs.filter((r) => r.status !== "REVERSED");
  const sum = (k) => live.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const openRun = (id) => router.push(`/accounting/hr/payroll/${id}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3">
        <NativeSelect value={year} onChange={(e) => setYear(e.target.value)} className="w-full sm:w-32" aria-label="Year">
          {Array.from({ length: 5 }, (_, i) => String(Number(meta.today.slice(0, 4)) + 1 - i)).map((y) => <option key={y} value={y}>{y}</option>)}
        </NativeSelect>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground sm:text-sm">Draft → approval → approved → posted to accounts as a journal voucher → paid.</p>
        {meta.rights.payrollManage && (
          <Button className={cn(BRAND_BTN, "w-full sm:w-auto")} onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1.5" />New payroll</Button>
        )}
      </div>
      <Card title={`Payroll runs ${year}`} icon={Wallet} description={isLoading ? "Loading…" : `${runs.length} run(s) · open one to review, approve, post and pay`}>
        {isLoading ? (
          <div className="space-y-2 p-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : !runs.length ? (
          <EmptyState icon={Wallet} title={`No payroll in ${year}`} hint="Start with “New payroll” once a month’s attendance is in." />
        ) : (
          // Under md every run becomes a card (table.vl-grid in app/globals.css).
          <div className={SCROLL}>
            <table className="vl-grid w-full text-sm">
              <thead className={TH_STICKY}>
                <tr className="text-left">
                  <th className={TH}>Month</th>
                  <th className={TH}>Payroll</th>
                  <th className={TH}>Pay date</th>
                  <th className={cn(TH, "text-right")}>Employees</th>
                  <th className={cn(TH, "text-right")}>Earnings</th>
                  <th className={cn(TH, "text-right")}>Deductions</th>
                  <th className={cn(TH, "text-right")}>Net pay</th>
                  <th className={TH}>Status</th>
                  <th className={TH}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => openRun(r.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openRun(r.id))}
                    className={cn(TR, "group cursor-pointer focus:bg-primary/[0.05] focus:outline-none", r.status === "REVERSED" && "opacity-70")}
                  >
                    <td data-label="Month" className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <span className="text-[9.5px] font-bold uppercase leading-none">{r.label.slice(0, 3)}</span>
                          <span className="text-[11px] font-semibold tabular-nums leading-tight">{r.month.slice(2, 4)}</span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Payroll" className="max-w-[280px] px-3 py-2.5">
                      <p className="truncate font-semibold text-foreground">{r.title || `Payroll ${r.label}`}</p>
                      <p className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                        <CodeChip>P-{r.id}</CodeChip>
                        {r.jv_tran_id ? <span>JV #{r.jv_tran_id}</span> : null}
                      </p>
                    </td>
                    <td data-label="Pay date" className="whitespace-nowrap px-3 py-2.5 tabular-nums text-foreground/90">{r.pay_date}</td>
                    <td data-label="Employees" className="px-3 py-2.5 text-right tabular-nums">{r.employees}</td>
                    <td data-label="Earnings" className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.total_earnings)}</td>
                    <td data-label="Deductions" className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtMoney(r.total_deductions)}</td>
                    <td data-label="Net pay" className="px-3 py-2.5 text-right font-bold tabular-nums text-primary">{fmtMoney(r.total_net)}</td>
                    <td data-label="Status" className="px-3 py-2.5"><RunStatus status={r.status} /></td>
                    <td className="vl-actions px-3 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary md:text-muted-foreground">
                        <span className="md:sr-only">Open</span>
                        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {live.length > 1 && (
                <tfoot className="sticky bottom-0 max-md:hidden">
                  <tr className={TFOOT}>
                    <td className="px-3 py-2.5 text-xs uppercase tracking-wide text-primary" colSpan={3}>Year total{live.length < runs.length ? " (not reversed)" : ""}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{sum("employees")}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(sum("total_earnings"))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(sum("total_deductions"))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-primary">{fmtMoney(sum("total_net"))}</td>
                    <td className="px-3 py-2.5" colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
      <NewRunDialog meta={meta} open={creating} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/accounting/hr/payroll/${id}`)} />
    </div>
  );
}

function NewRunDialog({ meta, open, onClose, onCreated }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const m = prevMonth(meta.today);
    setF({ month: m, pay_date: monthRange(m).to, department: "", title: "", notes: "" });
  }, [open, meta.today]);
  const elig = useQuery({
    queryKey: ["hr-payroll-eligible", f?.month, f?.department],
    queryFn: () => api(`/api/hr/payroll/eligible?month=${f.month}${f.department ? `&department=${f.department}` : ""}`),
    enabled: Boolean(open && f?.month),
  });
  if (!f) return null;
  const create = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/payroll", { method: "POST", body: f });
      toast.success(r.message);
      onCreated(r.id);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-lg")}>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>New payroll</DialogTitle>
          <DialogDescription>Everyone employed in the month (in your departments) who is not already in another payroll of that month. It is calculated at once and stays a draft until you submit it.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Month</Label>
            <Input type="month" value={f.month} onChange={(e) => e.target.value && setF({ ...f, month: e.target.value, pay_date: monthRange(e.target.value)?.to ?? f.pay_date })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Pay date (journal date)</Label>
            <Input type="date" value={f.pay_date} onChange={(e) => setF({ ...f, pay_date: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Department</Label>
            <NativeSelect value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} className="w-full">
              <option value="">All departments</option>
              {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Title (optional)</Label>
            <Input value={f.title} maxLength={150} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Factory staff — October" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea rows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
        </div>
        <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm" aria-live="polite">
          {elig.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : elig.data ? (
            <p><b className="tabular-nums text-primary">{elig.data.eligible}</b> employee(s) will be in this payroll{elig.data.already ? ` · ${elig.data.already} already in another payroll of the month` : ""}.</p>
          ) : <p className="text-red-700">{elig.error?.message}</p>}
        </div>
        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className={BRAND_BTN} onClick={create} disabled={busy || !elig.data?.eligible}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Create &amp; calculate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
