"use client";

// components/HR/leave/LeaveRequestList.jsx — leave applications with their
// actions (approve / reject / cancel), used by "My leave" and "Requests".
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X, Ban, Loader2, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDays, LEAVE_REQUEST_STATUS } from "@/lib/hr/leave/policy";
import { api, EmployeeCell, EmptyState, fmtDayLong, fmtWhen } from "@/components/HR/shared";
import { LEAVE_QUERY_KEYS } from "@/components/HR/leave/ApplyLeaveDialog";
import { Chip, CodeChip, DIALOG, DIALOG_FOOTER, LEAVE_TONE, SCROLL, TH, TH_STICKY, TR } from "@/components/HR/payroll/ui";

export function LeaveStatus({ status }) {
  const m = LEAVE_REQUEST_STATUS[status] ?? LEAVE_REQUEST_STATUS.pending;
  return <Chip tone={LEAVE_TONE[status] ?? "warn"}>{m.label}</Chip>;
}

export function TypeTag({ type }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: `${type.color}14`, color: type.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: type.color }} />
      {type.name}
      {type.is_paid === false && <span className="opacity-70">· unpaid</span>}
    </span>
  );
}


const span = (r) => (r.from === r.to ? fmtDayLong(r.from) : `${fmtDayLong(r.from).slice(0, 10)} → ${fmtDayLong(r.to)}`);

const ACTIONS = {
  approve: { title: "Approve leave", verb: "Approve", noteRequired: false, tone: "bg-[#2f5139] hover:bg-[#243f2c] text-white" },
  reject: { title: "Reject leave", verb: "Reject", noteRequired: true, tone: "bg-red-600 hover:bg-red-700 text-white" },
  cancel: { title: "Cancel leave", verb: "Cancel leave", noteRequired: false, tone: "bg-primary text-primary-foreground hover:bg-primary/90" },
};

export default function LeaveRequestList({ rows, loading, showEmployee = true, emptyHint }) {
  const qc = useQueryClient();
  const [act, setAct] = useState(null); // { row, action }
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/hr/leave/requests/${act.row.id}`, { method: "POST", body: { action: act.action, note } });
      toast.success(r.message);
      LEAVE_QUERY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
  const needNote = act && (ACTIONS[act.action].noteRequired || (act.action === "cancel" && act.row.status === "approved"));

  if (loading) {
    return (
      <div className="space-y-2 p-3 sm:p-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full md:h-9" />)}
      </div>
    );
  }
  if (!rows.length) return <EmptyState icon={CalendarRange} title="No leave here" hint={emptyHint} />;

  // Approve / reject / cancel buttons of a row (same on the phone card and in the table).
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
  const trail = (r) => (
    <>
      by {r.requested_by} · {fmtWhen(r.requested_at)}
      {r.decided_by && ` · ${r.status} by ${r.decided_by}`}
      {r.decision_note && ` — ${r.decision_note}`}
    </>
  );

  return (
    <>
      {/* Phone: cards */}
      <ul className="divide-y divide-border/60 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className={cn("space-y-2.5 px-3 py-3", r.status === "pending" && "bg-[#f5f0e6]/50")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {showEmployee ? <EmployeeCell employee={r.employee} compact /> : <TypeTag type={r.type} />}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <LeaveStatus status={r.status} />
                <CodeChip>L-{r.id}</CodeChip>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {showEmployee && <TypeTag type={r.type} />}
              <span className="text-foreground/90">{span(r)}</span>
              {r.half_day && <span className="rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">½ DAY</span>}
              <span className="ml-auto font-semibold tabular-nums text-foreground">{fmtDays(r.days)} <span className="text-xs font-normal text-muted-foreground">day(s)</span></span>
            </div>
            {r.reason && <p className="text-sm text-muted-foreground break-words">{r.reason}</p>}
            <p className="text-xs text-muted-foreground break-words">{trail(r)}</p>
            {(r.can.decide || r.can.cancel) && <div className="flex gap-2 pt-0.5">{actions(r, true)}</div>}
          </li>
        ))}
      </ul>

      {/* Tablet & up: table */}
      <div className={cn("hidden md:block", SCROLL)}>
        <table className="w-full text-sm">
          <thead className={TH_STICKY}>
            <tr className="text-left">
              <th className={TH}>#</th>
              {showEmployee && <th className={TH}>Employee</th>}
              <th className={TH}>Leave</th>
              <th className={TH}>Dates</th>
              <th className={cn(TH, "text-right")}>Days</th>
              <th className={TH}>Status</th>
              <th className={TH}>Reason / decision</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn(TR, r.status === "pending" && "bg-[#f5f0e6]/50")}>
                <td className="px-4 py-2.5"><CodeChip>L-{r.id}</CodeChip></td>
                {showEmployee && <td className="px-4 py-2.5 max-w-[240px]"><EmployeeCell employee={r.employee} compact /></td>}
                <td className="px-4 py-2.5"><TypeTag type={r.type} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap text-foreground/90">{span(r)}{r.half_day && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">½ DAY</span>}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtDays(r.days)}</td>
                <td className="px-4 py-2.5"><LeaveStatus status={r.status} /></td>
                <td className="px-4 py-2.5 max-w-[280px] text-xs text-muted-foreground">
                  {r.reason && <p className="truncate" title={r.reason}>{r.reason}</p>}
                  <p className="text-muted-foreground truncate" title={r.decision_note || ""}>{trail(r)}</p>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{actions(r, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(act)} onOpenChange={(o) => !o && setAct(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          {act && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{ACTIONS[act.action].title} #L-{act.row.id}</DialogTitle>
                <DialogDescription>
                  {act.row.employee.name} · {act.row.type.name} · {span(act.row)} · {fmtDays(act.row.days)} day(s)
                  {act.action === "cancel" && act.row.status === "approved" && " — its days come off attendance."}
                </DialogDescription>
              </DialogHeader>
              <Textarea autoFocus rows={3} maxLength={500} aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={needNote ? "Reason (required — the employee sees it)" : "Note (optional)"} />
              <DialogFooter className={DIALOG_FOOTER}>
                <Button variant="ghost" onClick={() => setAct(null)}>Back</Button>
                <Button className={ACTIONS[act.action].tone} disabled={busy || (needNote && !note.trim())} onClick={run}>
                  {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{ACTIONS[act.action].verb}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
