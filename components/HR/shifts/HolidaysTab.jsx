"use client";

// components/HR/shifts/HolidaysTab.jsx — holidays of a year, and the HR rules card.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Trash2, PartyPopper, Loader2, ShieldCheck, Inbox, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { eachDay } from "@/lib/hr/time";
import { api, BRAND_BTN, CHIP, EmptyState, fmtDayLong, NativeSelect, Panel } from "@/components/HR/shared";

// Dialogs: near full width on phones, scroll when tall; footer buttons stack with a gap.
const DIALOG = "w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6";
const DIALOG_FOOTER = "gap-2 sm:space-x-0";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function HolidaysTab({ meta }) {
  const qc = useQueryClient();
  const canManage = meta.rights.holidays;
  const [year, setYear] = useState(Number(meta.today.slice(0, 4)));
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null); // the holiday to remove, once confirmed
  const { data, isLoading } = useQuery({ queryKey: ["hr-holidays", year], queryFn: () => api(`/api/hr/holidays?year=${year}`) });

  const after = () => ["hr-holidays", "hr-att-day", "hr-att-month"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const add = async () => {
    const days = form.to && form.to > form.from ? eachDay(form.from, form.to) : [form.from];
    if (days.length > 31) return toast.error("31 days at most at a time.");
    setBusy("add");
    try {
      const r = await api("/api/hr/holidays", { method: "POST", body: { dates: days, name: form.name, is_paid: form.is_paid } });
      toast.success(r.message);
      setForm(null);
      after();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (h) => {
    setBusy(h.id);
    try {
      const r = await api(`/api/hr/holidays/${h.id}`, { method: "DELETE" });
      toast.success(r.message);
      setConfirmRemove(null);
      after();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const holidays = data?.holidays ?? [];
  const byMonth = MONTHS.map((m, i) => ({ m, list: holidays.filter((h) => Number(h.date.slice(5, 7)) === i + 1) })).filter((g) => g.list.length);

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9 bg-background" onClick={() => setYear(year - 1)} aria-label="Previous year"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="w-12 text-center text-base tabular-nums">{year}</span>
          <Button variant="outline" size="icon" className="h-9 w-9 bg-background" onClick={() => setYear(year + 1)} aria-label="Next year"><ChevronRight className="h-4 w-4" /></Button>
          <span className="ml-1 text-sm font-normal text-muted-foreground"><span className="tabular-nums">{holidays.length}</span> holiday day(s)</span>
        </span>
      }
      actions={canManage && (
        <Button size="sm" className={cn(BRAND_BTN, "h-9 w-full sm:w-auto")} onClick={() => setForm({ from: meta.today, to: "", name: "", is_paid: true })}>
          <Plus className="mr-1.5 h-4 w-4" />Add holiday
        </Button>
      )}
      bodyClassName="p-3 sm:p-4"
    >
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : !holidays.length ? (
        <EmptyState icon={PartyPopper} title={`No holidays in ${year}`} hint="Add public and company holidays. On a holiday nobody is marked absent, and anyone who works gets the hours as overtime." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {byMonth.map((g) => (
            <div key={g.m} className="overflow-hidden rounded-xl border border-border">
              <p className="flex items-center justify-between border-b border-primary/15 bg-primary/5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary">
                {g.m}
                <span className="rounded-full bg-primary/10 px-2 font-bold tabular-nums">{g.list.length}</span>
              </p>
              <ul className="divide-y divide-border/60">
                {g.list.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                    <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/15 dark:bg-violet-950/40 dark:text-violet-300">
                      <span className="text-sm font-bold leading-none tabular-nums">{Number(h.date.slice(8))}</span>
                      <span className="text-[9px] font-semibold uppercase">{fmtDayLong(h.date).slice(0, 3)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{h.name}</p>
                      <span className={cn("mt-0.5 inline-block rounded-full px-2 text-[11px] font-semibold", h.is_paid ? CHIP.ok : CHIP.muted)}>{h.is_paid ? "Paid" : "Unpaid"}</span>
                    </div>
                    {canManage && (
                      <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={busy === h.id} onClick={() => setConfirmRemove(h)} title="Remove" aria-label={`Remove ${h.name} (${h.date})`}>
                        {busy === h.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(form)} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          <DialogHeader>
            <DialogTitle>Add holiday</DialogTitle>
            <DialogDescription>One day, or a range (e.g. Eid). Applies to every employee.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="hol-name" className="text-xs text-foreground/70">Name</Label>
                <Input id="hol-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Eid ul Fitr" autoFocus />
              </div>
              <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="hol-from" className="text-xs text-foreground/70">From</Label>
                  <Input id="hol-from" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hol-to" className="text-xs text-foreground/70">To (optional)</Label>
                  <Input id="hol-to" type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} />
                </div>
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm text-foreground/85">Paid holiday</span>
                <Switch checked={form.is_paid} onCheckedChange={(v) => setForm({ ...form, is_paid: v })} />
              </label>
            </div>
          )}
          <DialogFooter className={DIALOG_FOOTER}>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button className={BRAND_BTN} onClick={add} disabled={busy === "add" || !form?.name?.trim() || !form?.from}>
              {busy === "add" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmRemove)} onOpenChange={(o) => !o && busy !== confirmRemove?.id && setConfirmRemove(null)}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemove ? fmtDayLong(confirmRemove.date) : ""} becomes a normal working day again, for attendance and payroll.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={DIALOG_FOOTER}>
            <AlertDialogCancel disabled={busy === confirmRemove?.id}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy === confirmRemove?.id}
              onClick={(e) => { e.preventDefault(); remove(confirmRemove); }}
            >
              {busy === confirmRemove?.id && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

export function RulesTab({ meta }) {
  const qc = useQueryClient();
  const canManage = meta.rights.shifts;
  const [days, setDays] = useState(meta.settings.directEditDays);
  const [startMonth, setStartMonth] = useState(meta.settings.leaveYearStartMonth);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDays(meta.settings.directEditDays), [meta.settings.directEditDays]);
  useEffect(() => setStartMonth(meta.settings.leaveYearStartMonth), [meta.settings.leaveYearStartMonth]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/settings", { method: "PUT", body: { directEditDays: Number(days), leaveYearStartMonth: Number(startMonth) } });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-meta"] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Attendance corrections" icon={ShieldCheck} bodyClassName="space-y-4 p-4 sm:p-5">
        <div className="space-y-1.5">
          <Label htmlFor="rule-days">Days back that can be changed without approval</Label>
          <div className="flex gap-2">
            <Input id="rule-days" type="number" inputMode="numeric" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} disabled={!canManage} className="w-28 tabular-nums" />
            {canManage && (
              <Button className={BRAND_BTN} onClick={save} disabled={busy || (Number(days) === meta.settings.directEditDays && Number(startMonth) === meta.settings.leaveYearStartMonth)}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">1 = today only, 2 = today and yesterday, …</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule-start-month">Leave year starts in</Label>
          <NativeSelect id="rule-start-month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} disabled={!canManage} className="w-full sm:w-48">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">Balances, carry-forward and entitlements run over this year. Saved with the button above.</p>
        </div>
        <ul className="space-y-2 text-sm text-foreground/85">
          <li className="flex gap-2"><span className="text-primary">•</span>People with <b>Mark attendance</b> save days within this window directly.</li>
          <li className="flex gap-2"><span className="text-primary">•</span>Older days, and days recorded by a machine or a file, go to <b>Approvals</b> with a reason.</li>
          <li className="flex gap-2"><span className="text-primary">•</span>People with <b>Approve attendance</b> change any day directly and decide the requests.</li>
          <li className="flex gap-2"><span className="text-primary">•</span>Days locked by payroll cannot be changed by anyone.</li>
        </ul>
      </Panel>
      <LoanRules meta={meta} />
      <Panel title="Who can do what" icon={KeyRound} bodyClassName="space-y-3 p-4 text-sm text-foreground/85 sm:p-5">
        <p>Rights are given per person or per role on <b>Admin → Permissions</b>, module <b>HR</b>: view, mark, approve, import / sync, manage machines, manage shifts, manage holidays.</p>
        <p>To limit someone to certain departments, use the <b>Departments (HR)</b> data limit on the same screen — they then see and mark only those employees, everywhere in HR.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" className="h-9" asChild><Link href="/dashboard/approvals"><Inbox className="mr-1.5 h-4 w-4" />Approvals inbox</Link></Button>
          <Button variant="outline" size="sm" className="h-9" asChild><Link href="/admin/permissions"><KeyRound className="mr-1.5 h-4 w-4" />Permissions</Link></Button>
        </div>
      </Panel>
    </div>
  );
}

const LOAN_RULES = [
  ["loanMaxInstallments", "Most monthly instalments a loan may run", "months"],
  ["advanceLimitPercent", "Flag an advance above this % of gross salary", "%"],
  ["loanLimitMonths", "Flag a loan above this many months of gross salary", "× gross"],
];

/** Advance / loan limits — flagged to the approver, instalments enforced. */
function LoanRules({ meta }) {
  const qc = useQueryClient();
  const canManage = meta.rights.shifts || meta.rights.loanManage;
  const [v, setV] = useState(() => Object.fromEntries(LOAN_RULES.map(([k]) => [k, meta.settings[k]])));
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(Object.fromEntries(LOAN_RULES.map(([k]) => [k, meta.settings[k]]))), [meta.settings]);
  const dirty = LOAN_RULES.some(([k]) => Number(v[k]) !== meta.settings[k]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/settings", { method: "PUT", body: Object.fromEntries(LOAN_RULES.map(([k]) => [k, Number(v[k])])) });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-meta"] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Advances & loans" icon={ShieldCheck} bodyClassName="space-y-3 p-4 sm:p-5"
      actions={canManage && <Button size="sm" className={cn(BRAND_BTN, "h-9 w-full sm:h-8 sm:w-auto")} onClick={save} disabled={busy || !dirty}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save</Button>}>
      {LOAN_RULES.map(([k, label, unit]) => (
        <div key={k} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <Label htmlFor={`loan-${k}`} className="text-sm text-foreground/85">{label}</Label>
          <div className="relative w-full shrink-0 sm:w-32">
            <Input id={`loan-${k}`} type="number" min={0} value={v[k]} disabled={!canManage} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="pr-14 tabular-nums" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Limits are shown to the approver as warnings; the instalment count is enforced.</p>
    </Panel>
  );
}

