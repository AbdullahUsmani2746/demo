"use client";

// components/HR/self/MyAttendance.jsx — the signed-in employee's month as a
// calendar, with "ask for a correction" on any past day (goes to Approvals).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Clock, Hourglass, Loader2, Lock, PencilLine, TimerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/hr/attendance/rules";
import { addMonths } from "@/lib/hr/loans/schedule";
import { fmtMinutes } from "@/lib/hr/time";
import { api, BRAND_BTN, fmtDayLong, fmtMonth, ShiftChip, StatusChip } from "@/components/HR/shared";
import { Card, DIALOG, DIALOG_FOOTER } from "@/components/HR/payroll/ui";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function MyAttendance({ today }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [fixing, setFixing] = useState(null);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["hr-my-attendance", month],
    queryFn: () => api(`/api/hr/attendance/mine?month=${month}`),
    placeholderData: (prev) => prev,
  });

  const days = data?.days ?? [];
  const lead = days.length ? (days[0].weekday + 6) % 7 : 0; // Monday first
  const s = data?.summary;
  const todayRow = days.find((d) => d.day === today);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background p-3 sm:gap-3">
        <div className="flex w-full items-center gap-1 sm:w-auto">
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="flex-1 text-center text-sm font-semibold text-primary sm:w-36 sm:flex-none" aria-live="polite">{fmtMonth(month)}</span>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= today.slice(0, 7)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        {month !== today.slice(0, 7) && <Button variant="outline" size="sm" className="h-9" onClick={() => setMonth(today.slice(0, 7))}>This month</Button>}
        {data?.shift && <span className="flex items-center gap-2 text-sm text-muted-foreground">Your shift <ShiftChip shift={data.shift} /></span>}
        {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {todayRow && month === today.slice(0, 7) && (
        <div className="flex flex-col gap-4 rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] px-4 py-4 text-white shadow-md sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-80">Today</p>
            <p className="text-lg font-semibold">{fmtDayLong(today)}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 min-[420px]:flex min-[420px]:flex-wrap sm:ml-auto">
            <Stat label="In" value={todayRow.check_in ?? "—"} />
            <Stat label="Out" value={todayRow.check_out ?? "—"} />
            <Stat label="Status" value={STATUS_META[todayRow.status]?.label ?? "—"} />
            {todayRow.late_minutes > 0 && <Stat label="Late by" value={fmtMinutes(todayRow.late_minutes)} />}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[88px] rounded-xl" />)}</div>
      ) : s ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Present" value={s.counts.PRESENT + s.counts.LATE} tone="PRESENT" />
          <Tile label="Late marks" value={s.lateMarks} tone="LATE" hint={s.lateCutDays ? `${s.lateCutDays} day(s) cut` : s.lateMinutes ? fmtMinutes(s.lateMinutes) : null} />
          <Tile label="Half days" value={s.counts.HALF_DAY} tone="HALF_DAY" />
          <Tile label="Absent" value={s.counts.ABSENT} tone="ABSENT" />
          <Tile label="Leave" value={s.counts.LEAVE} tone="LEAVE" />
          <Tile label="Overtime" value={fmtMinutes(s.overtimeMinutes) || "0"} tone="HOLIDAY" />
        </div>
      ) : null}

      <Card title="Calendar" icon={Clock} description="Your month day by day" bodyClassName="p-3 sm:p-4">
        {isLoading ? (
          <Skeleton className="h-80" />
        ) : !data?.employee ? (
          <p className="py-10 text-center text-sm text-muted-foreground">You were not employed in {fmtMonth(month)}.</p>
        ) : (
          <>
            {/* The month grid scrolls sideways inside the card on narrow phones. */}
            <div className="-mx-3 overflow-x-auto overscroll-x-contain px-3 pb-1 sm:mx-0 sm:px-0">
              <div className="min-w-[540px] md:min-w-0">
                <div className="grid grid-cols-7 gap-1.5 rounded-md bg-primary text-center text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                  {WEEK.map((w) => <div key={w} className="py-1.5">{w}</div>)}
                </div>
                <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                  {Array.from({ length: lead }, (_, i) => <div key={`pad${i}`} />)}
                  {days.map((d) => (
                    <DayCell key={d.day} d={d} today={today} onFix={() => setFixing(d)} />
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Tap a past day to ask for a correction.</p>
            <Legend />
          </>
        )}
      </Card>

      <FixDialog day={fixing} onClose={() => setFixing(null)} month={month} />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider opacity-75">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Tile({ label, value, tone, hint }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3.5 sm:p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_META[tone].dot)} />{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-foreground sm:text-2xl">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One day: status colour bar, times, late / overtime, and the fix button. */
function DayCell({ d, today, onFix }) {
  const n = Number(d.day.slice(8));
  if (!d.employed) return <div className="min-h-[84px] rounded-lg bg-muted/40 p-1.5 text-xs text-muted-foreground/60">{n}</div>;
  const m = STATUS_META[d.status] ?? STATUS_META.PENDING;
  const canFix = d.day <= today && !d.locked && !d.on_leave_request && !d.waiting_request;
  return (
    <div
      className={cn(
        "group relative flex min-h-[84px] flex-col overflow-hidden rounded-lg border bg-background p-1.5 text-left",
        d.day === today ? "border-primary ring-1 ring-primary/30" : "border-border",
      )}
      title={[fmtDayLong(d.day), m.label, d.holiday, d.leave?.name, d.remarks].filter(Boolean).join(" · ")}
    >
      <span className={cn("absolute inset-x-0 top-0 h-1", m.dot)} />
      <div className="flex items-center justify-between gap-1">
        <span className={cn("text-xs font-semibold tabular-nums", d.day === today ? "text-primary" : "text-foreground/90")}>{n}</span>
        {d.locked && <Lock className="h-3 w-3 text-muted-foreground/60" aria-label="Payroll posted" />}
        {d.waiting_request && <Hourglass className="h-3 w-3 text-[#5f4b1f]" aria-label={`Correction waiting #R-${d.waiting_request}`} />}
      </div>
      <span className="mt-0.5 truncate text-[10px] font-semibold text-muted-foreground">{d.leave ? `${d.leave.name}${d.leave.half ? " ½" : ""}` : d.holiday ?? m.label}</span>
      {d.check_in && <span className="text-[10px] tabular-nums text-muted-foreground">{d.check_in}–{d.check_out ?? "?"}</span>}
      <div className="mt-auto flex flex-wrap gap-1">
        {d.late_minutes > 0 && <span className="rounded bg-[#f5f0e6] px-1 text-[9px] font-semibold text-[#5f4b1f]">+{fmtMinutes(d.late_minutes)} late</span>}
        {d.overtime_minutes > 0 && <span className="rounded bg-primary/5 px-1 text-[9px] font-semibold text-primary">{fmtMinutes(d.overtime_minutes)} OT</span>}
        {d.needs_review && <span className="rounded bg-red-50 px-1 text-[9px] font-semibold text-red-700">1 punch</span>}
      </div>
      {canFix && (
        <button
          type="button"
          onClick={onFix}
          className="absolute inset-0 flex items-center justify-center bg-background/85 text-[11px] font-semibold text-primary opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
          aria-label={`Ask for a correction of ${d.day}`}
        >
          <PencilLine className="mr-1 h-3.5 w-3.5" />Fix
        </button>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-4 sm:gap-2">
      {["PRESENT", "LATE", "HALF_DAY", "ABSENT", "LEAVE", "OFF", "HOLIDAY"].map((k) => <StatusChip key={k} status={k} className="text-[10px] sm:text-xs" />)}
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground sm:text-xs"><Hourglass className="h-3 w-3 text-[#5f4b1f]" />correction waiting</span>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground sm:text-xs"><Lock className="h-3 w-3" />payroll posted</span>
    </div>
  );
}

function FixDialog({ day, onClose, month }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ check_in: "", check_out: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [lastDay, setLastDay] = useState(null);
  // Fresh form each time a day is opened (state reset while rendering, not in an effect).
  if ((day?.day ?? null) !== lastDay) {
    setLastDay(day?.day ?? null);
    if (day) setForm({ check_in: day.check_in ?? "", check_out: day.check_out ?? "", reason: "" });
  }
  const send = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/attendance/mine", { method: "POST", body: { date: day.day, ...form } });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-my-attendance", month] });
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={Boolean(day)} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle className="pr-8">Correct {day ? fmtDayLong(day.day) : ""}</DialogTitle>
          <DialogDescription>Forgot to punch, or the machine missed you? Enter your real times — HR approves it before it counts.</DialogDescription>
        </DialogHeader>
        {day && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
              <TimerOff className="h-4 w-4 text-muted-foreground" />Now: <StatusChip status={day.status} />
              {day.check_in && <span className="tabular-nums">{day.check_in}–{day.check_out ?? "?"}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fix-in">Came in</Label>
                <Input id="fix-in" type="time" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fix-out">Left</Label>
                <Input id="fix-out" type="time" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fix-reason">What happened</Label>
              <Textarea id="fix-reason" rows={3} maxLength={300} placeholder="e.g. Forgot to punch out — left at 6 pm" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
          </div>
        )}
        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className={BRAND_BTN} onClick={send} disabled={busy || !form.reason.trim() || (!form.check_in && !form.check_out)}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Send for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
