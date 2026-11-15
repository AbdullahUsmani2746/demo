"use client";

// components/HR/attendance/OffSwaps.jsx — Attendance → Off-day swaps.
// "Works on <a week-off / holiday>, off on <a working day> instead", for one
// employee or a whole group (lib/hr/attendance/swaps.js). Goes to Approvals
// unless an attendance approver enters and approves it at once. A week-off
// worked WITHOUT a swap earns a comp-off day instead (shift setting).
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Ban, Check, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SearchableSelect from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { LEAVE_REQUEST_STATUS } from "@/lib/hr/leave/policy";
import { api, BRAND_BTN, EmployeeCell, EmptyState, fmtDayLong, fmtWhen, NativeSelect } from "@/components/HR/shared";
import { Card, Chip, CodeChip, DIALOG, DIALOG_FOOTER, LEAVE_TONE, SCROLL, TH, TH_STICKY, TR } from "@/components/HR/payroll/ui";

const QUERY_KEYS = ["hr-off-swaps", "hr-att-day", "hr-att-month", "hr-leave-balances"];

const ACTIONS = {
  approve: { title: "Approve swap", verb: "Approve", tone: "bg-[#2f5139] hover:bg-[#243f2c] text-white" },
  reject: { title: "Reject swap", verb: "Reject", tone: "bg-red-600 hover:bg-red-700 text-white" },
  cancel: { title: "Cancel swap", verb: "Cancel swap", tone: "bg-primary text-primary-foreground hover:bg-primary/90" },
};

function SwapStatus({ status }) {
  return <Chip tone={LEAVE_TONE[status] ?? "warn"}>{LEAVE_REQUEST_STATUS[status]?.label ?? status}</Chip>;
}

function NewSwapDialog({ open, onClose, meta }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ ids: [], work_date: "", off_date: "", reason: "", approve_now: false });
  const [busy, setBusy] = useState(false);
  const empQ = useQuery({
    queryKey: ["hr-employee-options"],
    queryFn: () => api("/api/hr/shifts/assignments"),
    enabled: open,
    staleTime: 60_000,
  });
  const employees = useMemo(() => (empQ.data?.employees ?? []).map(({ employee }) => employee), [empQ.data]);
  const picked = employees.filter((e) => f.ids.includes(e.id));
  const options = employees
    .filter((e) => !f.ids.includes(e.id))
    .map((e) => ({ value: e.id, label: `${e.name} (#${e.id})${e.department ? ` · ${e.department}` : ""}` }));
  const add = (ids) => setF((x) => ({ ...x, ids: [...new Set([...x.ids, ...ids])] }));
  const remove = (id) => setF((x) => ({ ...x, ids: x.ids.filter((i) => i !== id) }));

  const send = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/attendance/swaps", {
        method: "POST",
        body: { employee_ids: f.ids, work_date: f.work_date, off_date: f.off_date, reason: f.reason, approve_now: f.approve_now },
      });
      toast.success(r.message);
      QUERY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setF({ ids: [], work_date: "", off_date: "", reason: "", approve_now: false });
      onClose();
    } catch (e) {
      toast.error(e.message, { duration: 9000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8"><ArrowLeftRight className="h-5 w-5 shrink-0 text-primary" />Swap an off day</DialogTitle>
          <DialogDescription>
            They work their week-off (or a holiday) and take another working day off instead. The worked day counts as a normal day — no overtime, no comp-off.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Employees</Label>
            <SearchableSelect options={options} value={null} onChange={(v) => v && add([Number(v)])} placeholder="Search employee to add…" isLoading={empQ.isLoading} />
            {meta.departments?.length > 1 && (
              <NativeSelect
                value=""
                onChange={(e) => {
                  const dept = Number(e.target.value);
                  if (dept) add(employees.filter((x) => x.departmentId === dept).map((x) => x.id));
                }}
                className="w-full"
                aria-label="Add a whole department"
              >
                <option value="">+ Add a whole department…</option>
                {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </NativeSelect>
            )}
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {picked.map((e) => (
                  <span key={e.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
                    {e.name}
                    <button type="button" onClick={() => remove(e.id)} className="rounded-full p-0.5 hover:bg-primary/15" aria-label={`Remove ${e.name}`}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Works on (their week-off / a holiday)</Label>
              <Input type="date" value={f.work_date} onChange={(e) => setF({ ...f, work_date: e.target.value })} />
              {f.work_date && <p className="text-xs text-muted-foreground">{fmtDayLong(f.work_date)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Off on instead (a working day)</Label>
              <Input type="date" value={f.off_date} onChange={(e) => setF({ ...f, off_date: e.target.value })} />
              {f.off_date && <p className="text-xs text-muted-foreground">{fmtDayLong(f.off_date)}</p>}
            </div>
          </div>
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Two days off together another week (e.g. Saturday + Sunday): enter one swap for each Sunday worked, each with its own off day.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reason</Label>
            <Textarea rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. urgent dispatch on Sunday" />
          </div>
          {meta.rights.approve && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span className="text-sm text-foreground/85">Approve now (I am an attendance approver)</span>
              <Switch checked={f.approve_now} onCheckedChange={(v) => setF({ ...f, approve_now: v })} />
            </label>
          )}
        </div>
        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className={BRAND_BTN} disabled={busy || !f.ids.length || !f.work_date || !f.off_date} onClick={send}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {f.approve_now ? "Save & approve" : "Send for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OffSwaps({ meta }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [act, setAct] = useState(null); // { row, action }
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["hr-off-swaps", status],
    queryFn: () => api(`/api/hr/attendance/swaps${status ? `?status=${status}` : ""}`),
  });
  const rows = q.data?.swaps ?? [];

  const run = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/hr/attendance/swaps/${act.row.id}`, { method: "POST", body: { action: act.action, note } });
      toast.success(r.message);
      QUERY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setAct(null);
      setNote("");
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };
  const open = (row, action) => {
    setNote("");
    setAct({ row, action });
  };
  const needNote = act && (act.action === "reject" || (act.action === "cancel" && act.row.status === "approved"));
  const actions = (r, phone) => (
    <>
      {r.can.decide && (
        <>
          <Button size="sm" variant={phone ? "outline" : "ghost"} className={cn("text-[#2f5139] hover:text-[#243f2c]", phone && "h-9 flex-1")} onClick={() => open(r, "approve")}><Check className="mr-1 h-4 w-4" />Approve</Button>
          <Button size="sm" variant={phone ? "outline" : "ghost"} className={cn("text-red-700 hover:text-red-800", phone && "h-9 flex-1")} onClick={() => open(r, "reject")}><X className="mr-1 h-4 w-4" />Reject</Button>
        </>
      )}
      {r.can.cancel && <Button size="sm" variant="ghost" className={cn("text-muted-foreground", phone && "h-9 flex-1")} onClick={() => open(r, "cancel")}><Ban className="mr-1 h-4 w-4" />Cancel</Button>}
    </>
  );
  const trail = (r) => `by ${r.requested_by} · ${fmtWhen(r.requested_at)}${r.decided_by ? ` · ${r.status} by ${r.decided_by}` : ""}${r.decision_note ? ` — ${r.decision_note}` : ""}`;
  const day = (d) => fmtDayLong(d);

  return (
    <Card
      title="Off-day swaps"
      icon={ArrowLeftRight}
      description="Planned: work a week-off, take another day off. Worked a week-off without a swap? It earns a comp-off day (Leave → Comp off), to take within 30 days."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </NativeSelect>
          {meta.rights.mark && (
            <Button size="sm" className={cn(BRAND_BTN, "h-9")} onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />Swap off day</Button>
          )}
        </div>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <div className="space-y-2 p-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={ArrowLeftRight} title="No swaps" hint="Use “Swap off day” when someone works their week-off and takes another day off." />
      ) : (
        <>
          <ul className="divide-y divide-border/60 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className={cn("space-y-2 px-3 py-3", r.status === "pending" && "bg-[#f5f0e6]/50")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><EmployeeCell employee={r.employee} compact /></div>
                  <div className="flex shrink-0 flex-col items-end gap-1"><SwapStatus status={r.status} /><CodeChip>S-{r.id}</CodeChip></div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Works</span>{day(r.work_date)}</div>
                  <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Off instead</span>{day(r.off_date)}</div>
                </div>
                {r.reason && <p className="break-words text-sm text-muted-foreground">{r.reason}</p>}
                <p className="break-words text-xs text-muted-foreground">{trail(r)}</p>
                {(r.can.decide || r.can.cancel) && <div className="flex gap-2 pt-0.5">{actions(r, true)}</div>}
              </li>
            ))}
          </ul>
          <div className={cn("hidden md:block", SCROLL)}>
            <table className="w-full text-sm">
              <thead className={TH_STICKY}>
                <tr className="text-left">
                  <th className={TH}>#</th>
                  <th className={TH}>Employee</th>
                  <th className={TH}>Works on</th>
                  <th className={TH}>Off on instead</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Reason / decision</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cn(TR, r.status === "pending" && "bg-[#f5f0e6]/50")}>
                    <td className="px-4 py-2.5"><CodeChip>S-{r.id}</CodeChip></td>
                    <td className="max-w-[240px] px-4 py-2.5"><EmployeeCell employee={r.employee} compact /></td>
                    <td className="whitespace-nowrap px-4 py-2.5">{day(r.work_date)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{day(r.off_date)}</td>
                    <td className="px-4 py-2.5"><SwapStatus status={r.status} /></td>
                    <td className="max-w-[280px] px-4 py-2.5 text-xs text-muted-foreground">
                      {r.reason && <p className="truncate" title={r.reason}>{r.reason}</p>}
                      <p className="truncate" title={trail(r)}>{trail(r)}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">{actions(r, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <NewSwapDialog open={creating} onClose={() => setCreating(false)} meta={meta} />

      <Dialog open={Boolean(act)} onOpenChange={(o) => !o && setAct(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          {act && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{ACTIONS[act.action].title} #S-{act.row.id}</DialogTitle>
                <DialogDescription>
                  {act.row.employee.name} · works {act.row.work_date}, off {act.row.off_date}
                  {act.action !== "cancel" && " — the decision covers everyone sent with this swap."}
                  {act.action === "cancel" && act.row.status === "approved" && " — both days go back to normal."}
                </DialogDescription>
              </DialogHeader>
              <Textarea autoFocus rows={3} maxLength={500} aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={needNote ? "Reason (required)" : "Note (optional)"} />
              <DialogFooter className={DIALOG_FOOTER}>
                <Button variant="ghost" onClick={() => setAct(null)}>Back</Button>
                <Button className={ACTIONS[act.action].tone} disabled={busy || (needNote && !note.trim())} onClick={run}>
                  {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{ACTIONS[act.action].verb}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
