"use client";

// components/HR/shifts/ShiftsTab.jsx — shift cards + the shift form.
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Power, Users, Moon, Sun, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { fullDayMinutes, shiftSpan } from "@/lib/hr/attendance/rules";
import { fmtMinutes, hmToMinutes, minutesToHm, normalizeHm, WEEKDAYS } from "@/lib/hr/time";
import { api, BRAND_BTN, CHIP, EmptyState } from "@/components/HR/shared";

const BLANK = {
  code: "", name: "", start_time: "09:00", end_time: "17:00", break_minutes: 60, grace_minutes: 10, early_grace_minutes: 10,
  half_day_late_minutes: 120, half_day_minutes: 240, full_day_minutes: 0, overtime_enabled: true, overtime_after_minutes: 30,
  lates_per_day_cut: 3, early_counts_as_late: true, week_off_days: [0], off_day_work: "COMP_OFF", color: "#800000", is_active: true,
};
// Dialogs: near full width on phones, scroll when tall; footer buttons stack with a gap.
const DIALOG = "w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6";
const DIALOG_FOOTER = "gap-2 sm:space-x-0";

const COLORS = ["#800000", "#b45309", "#047857", "#1e3a8a", "#6d28d9", "#be185d", "#0f766e", "#475569"];

/** 24 h ruler with the shift drawn on it (two pieces when it runs past midnight). */
export function ShiftTimeline({ shift, className }) {
  const span = shiftSpan(shift);
  if (!span) return null;
  const pieces = span.end <= 1440 ? [[span.start, span.end]] : [[span.start, 1440], [0, span.end - 1440]];
  return (
    <div className={cn("relative h-2.5 rounded-full bg-muted", className)}>
      {pieces.map(([a, b], i) => (
        <div key={i} className="absolute top-0 h-full rounded-full" style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%`, background: shift.color || "#800000" }} />
      ))}
      {[6, 12, 18].map((h) => (
        <div key={h} className="absolute top-full mt-0.5 -translate-x-1/2 text-[9px] text-muted-foreground" style={{ left: `${(h / 24) * 100}%` }}>{h}</div>
      ))}
    </div>
  );
}

/** The shift's rules in words. */
export function ruleLines(s) {
  const span = shiftSpan(s);
  if (!span) return [];
  const lateAfter = minutesToHm(span.start + (s.grace_minutes || 0));
  const out = [`Late after ${lateAfter}${s.grace_minutes ? ` (${s.grace_minutes} min grace)` : ""}`];
  if (s.half_day_late_minutes > 0) out.push(`Half day if in after ${minutesToHm(span.start + s.half_day_late_minutes)}`);
  if (s.lates_per_day_cut > 0) out.push(`Every ${s.lates_per_day_cut} late${s.early_counts_as_late ? " / early-out" : ""} marks = 1 day cut`);
  else out.push("Lates are recorded, no day cut");
  out.push(`Full day needs ${fmtMinutes(fullDayMinutes(s))} worked${s.half_day_minutes ? ` · under ${fmtMinutes(s.half_day_minutes)} = absent` : ""}`);
  out.push(s.overtime_enabled ? `Overtime once out after ${minutesToHm(span.end + (s.overtime_after_minutes || 0))}` : "No overtime");
  out.push(
    s.off_day_work === "OVERTIME"
      ? "Work on a week-off / holiday = overtime"
      : "Work on a week-off / holiday (not swapped) = comp-off day",
  );
  return out;
}

export default function ShiftsTab({ meta }) {
  const qc = useQueryClient();
  const canManage = meta.rights.shifts;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["hr-shifts"], queryFn: () => api("/api/hr/shifts") });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hr-shifts"] });
    qc.invalidateQueries({ queryKey: ["hr-meta"] });
    qc.invalidateQueries({ queryKey: ["hr-assignments"] });
  };

  const run = async (key, fn) => {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(r.message);
      refresh();
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const body = { ...form, start_time: normalizeHm(form.start_time), end_time: normalizeHm(form.end_time) };
    const ok = await run("form", () =>
      form.id ? api(`/api/hr/shifts/${form.id}`, { method: "PUT", body }) : api("/api/hr/shifts", { method: "POST", body }),
    );
    if (ok) setForm(null);
  };

  const shifts = data?.shifts ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="max-w-3xl text-sm text-muted-foreground">Each shift carries its own late, half-day, overtime and week-off rules. Changing a rule applies to every day not yet locked by payroll.</p>
        {canManage && (
          <Button className={cn(BRAND_BTN, "h-10 w-full shrink-0 sm:h-9 sm:w-auto")} onClick={() => setForm({ ...BLANK })}>
            <Plus className="mr-1.5 h-4 w-4" />New shift
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      ) : !shifts.length ? (
        <div className="rounded-xl border border-border bg-background"><EmptyState icon={Clock} title="No shifts yet" hint="Create the shifts your people work, then assign them." /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shifts.map((s) => {
            const span = shiftSpan(s);
            const night = span && span.end > 1440;
            return (
              <div key={s.id} className={cn("relative flex flex-col overflow-hidden rounded-xl border bg-background transition-colors", s.is_active ? "border-border hover:border-primary/30" : "border-dashed border-border opacity-70")}>
                <div className="h-1.5" style={{ background: s.color }} />
                <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md px-1.5 py-0.5 text-xs font-bold text-white" style={{ background: s.color }}>{s.code}</span>
                        {!s.is_active && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", CHIP.muted)}>OFF</span>}
                      </div>
                      <p className="mt-1.5 truncate font-semibold text-foreground">{s.name}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="flex items-center justify-end gap-1.5 text-base font-bold tabular-nums text-foreground sm:text-lg">
                        {night ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-amber-500" />}
                        {s.start_time}–{s.end_time}
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground">{fmtMinutes(span ? span.length : 0)} · break {fmtMinutes(s.break_minutes)}</p>
                    </div>
                  </div>
                  <ShiftTimeline shift={s} className="mb-3" />
                  <ul className="space-y-1 text-xs text-foreground/70">
                    {ruleLines(s).map((l) => <li key={l} className="flex gap-1.5"><span className="text-primary">•</span>{l}</li>)}
                  </ul>
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((d) => (
                      <span key={d.value} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", s.week_off_days.includes(d.value) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} title={s.week_off_days.includes(d.value) ? `${d.label}: week off` : `${d.label}: working`}>
                        {d.short}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                    <span className="flex items-center gap-1.5 text-sm text-foreground/70"><Users className="h-4 w-4 shrink-0" /><span className="tabular-nums">{s.employees}</span> on it today</span>
                    {canManage && (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-primary/70 hover:bg-primary/10 hover:text-primary" onClick={() => setForm({ ...s })} title="Edit" aria-label={`Edit shift ${s.code}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-9 w-9" disabled={busy === `${s.id}:power`} title={s.is_active ? "Switch off" : "Switch on"} aria-label={`${s.is_active ? "Switch off" : "Switch on"} shift ${s.code}`}
                          onClick={() => run(`${s.id}:power`, () => api(`/api/hr/shifts/${s.id}`, { method: "PUT", body: { ...s, is_active: !s.is_active } }))}>
                          <Power className={cn("h-4 w-4", s.is_active ? "text-[#2f5139] dark:text-emerald-400" : "text-muted-foreground")} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete shift ${s.code}`} onClick={() => setConfirm(s)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ShiftForm form={form} setForm={setForm} onSave={save} saving={busy === "form"} />

      <AlertDialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shift {confirm?.code}?</AlertDialogTitle>
            <AlertDialogDescription>Only a shift that was never assigned can be deleted. A shift in use can be switched off instead — its history stays.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={DIALOG_FOOTER}>
            <AlertDialogCancel disabled={Boolean(busy)}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(busy)}
              onClick={async (e) => { e.preventDefault(); if (await run("delete", () => api(`/api/hr/shifts/${confirm.id}`, { method: "DELETE" }))) setConfirm(null); }}
            >
              {busy === "delete" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NumberField({ label, hint, value, onChange, suffix = "min", step = 1, min = 0 }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-foreground/70">{label}</Label>
      <div className="relative">
        <Input id={id} type="number" inputMode="decimal" min={min} step={step} value={value} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className="pr-12 tabular-nums" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h3 className="border-b border-primary/15 pb-1.5 text-xs font-bold uppercase tracking-wider text-primary">{title}</h3>
      {children}
    </div>
  );
}

function ShiftForm({ form, setForm, onSave, saving }) {
  if (!form) return null;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const hours = (k) => (form[k] === "" ? "" : Math.round((form[k] / 60) * 100) / 100);
  const setHours = (k) => (v) => setForm((f) => ({ ...f, [k]: v === "" ? "" : Math.round(Number(v) * 60) }));
  const preview = normalizeHm(form.start_time) && normalizeHm(form.end_time)
    ? { ...form, start_time: normalizeHm(form.start_time), end_time: normalizeHm(form.end_time), break_minutes: Number(form.break_minutes) || 0 }
    : null;
  const toggleDay = (d) =>
    setForm((f) => ({ ...f, week_off_days: f.week_off_days.includes(d) ? f.week_off_days.filter((x) => x !== d) : [...f.week_off_days, d].sort() }));

  return (
    <Dialog open onOpenChange={(o) => !o && setForm(null)}>
      <DialogContent className={cn(DIALOG, "sm:max-w-3xl")}>
        <DialogHeader>
          <DialogTitle>{form.id ? `Edit shift ${form.code}` : "New shift"}</DialogTitle>
          <DialogDescription>Times are Karachi time. An end before the start means the shift runs past midnight.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1fr_260px] md:gap-6">
          <div className="space-y-6">
            <Section title="Timing">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="shift-code" className="text-xs text-foreground/70">Code</Label>
                  <Input id="shift-code" value={form.code} onChange={(e) => set("code")(e.target.value.toUpperCase().slice(0, 20))} placeholder="GEN" autoFocus={!form.id} className="font-mono" />
                </div>
                <div className="col-span-1 space-y-1.5 sm:col-span-3">
                  <Label htmlFor="shift-name" className="text-xs text-foreground/70">Name</Label>
                  <Input id="shift-name" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="General 09:00–17:00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shift-start" className="text-xs text-foreground/70">Start</Label>
                  <Input id="shift-start" inputMode="numeric" value={form.start_time} onChange={(e) => set("start_time")(e.target.value)} onBlur={(e) => normalizeHm(e.target.value) && set("start_time")(normalizeHm(e.target.value))} placeholder="09:00" className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shift-end" className="text-xs text-foreground/70">End</Label>
                  <Input id="shift-end" inputMode="numeric" value={form.end_time} onChange={(e) => set("end_time")(e.target.value)} onBlur={(e) => normalizeHm(e.target.value) && set("end_time")(normalizeHm(e.target.value))} placeholder="17:00" className="tabular-nums" />
                </div>
                <NumberField label="Break" value={form.break_minutes} onChange={set("break_minutes")} />
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground/70">Colour</Label>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => set("color")(c)} className={cn("h-7 w-7 rounded-full ring-offset-2 transition sm:h-6 sm:w-6", form.color === c && "ring-2 ring-foreground ring-offset-background")} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={form.color === c} />
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Late & early">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <NumberField label="Late grace" hint="In this late is still on time" value={form.grace_minutes} onChange={set("grace_minutes")} />
                <NumberField label="Half day if late by more than" hint="0 = never" value={form.half_day_late_minutes} onChange={set("half_day_late_minutes")} />
                <NumberField label="Early-out grace" value={form.early_grace_minutes} onChange={set("early_grace_minutes")} />
                <NumberField label="Late marks for 1 day cut" hint="0 = record only, no cut" value={form.lates_per_day_cut} onChange={set("lates_per_day_cut")} suffix="marks" />
                <label className="col-span-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className="text-sm text-foreground/85">Early outs count as late marks</span>
                  <Switch checked={form.early_counts_as_late} onCheckedChange={set("early_counts_as_late")} />
                </label>
              </div>
            </Section>

            <Section title="Day length & overtime">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <NumberField label="Absent if worked under" hint="0 = never" value={hours("half_day_minutes")} onChange={setHours("half_day_minutes")} suffix="hours" step={0.5} />
                <NumberField label="Full day needs" hint={`0 = shift − break − 2 h${preview ? ` (${fmtMinutes(fullDayMinutes({ ...preview, full_day_minutes: 0 }))})` : ""}`} value={hours("full_day_minutes")} onChange={setHours("full_day_minutes")} suffix="hours" step={0.5} />
                <NumberField label="Overtime after end +" value={form.overtime_after_minutes} onChange={set("overtime_after_minutes")} />
                <label className="col-span-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 sm:col-span-3">
                  <span className="text-sm text-foreground/85">Count overtime</span>
                  <Switch checked={form.overtime_enabled} onCheckedChange={set("overtime_enabled")} />
                </label>
              </div>
            </Section>

            <Section title="Work on a week-off or holiday">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { value: "COMP_OFF", label: "Comp-off day", hint: "Earns a day off to take within the comp-off validity (½ for half a day). No overtime." },
                  { value: "OVERTIME", label: "Overtime", hint: "Every hour worked is overtime (when overtime is counted)." },
                ].map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => set("off_day_work")(o.value)}
                    aria-pressed={(form.off_day_work || "COMP_OFF") === o.value}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors",
                      (form.off_day_work || "COMP_OFF") === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span className="block text-sm font-semibold text-foreground">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">A day planned with an off-day swap (Attendance → Off-day swaps) is a normal working day instead.</p>
            </Section>

            <Section title="Weekly off">
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => {
                  const off = form.week_off_days.includes(d.value);
                  return (
                    <button key={d.value} type="button" onClick={() => toggleDay(d.value)} aria-pressed={off}
                      className={cn("h-9 min-w-[3rem] rounded-lg border px-3 text-sm font-medium transition", off ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground/70 hover:border-primary/40 hover:text-primary")}>
                      {d.short}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">Filled = week off. An employee can be given different days when assigned.</p>
            </Section>
          </div>

          <aside className="h-fit space-y-4 rounded-xl border border-primary/15 bg-primary/[0.03] p-4 md:sticky md:top-0">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Preview</p>
            {preview && shiftSpan(preview) ? (
              <>
                <div>
                  <p className="text-2xl font-bold tabular-nums text-foreground">{preview.start_time}–{preview.end_time}</p>
                  <p className="text-xs text-muted-foreground">{fmtMinutes(shiftSpan(preview).length)} on site{shiftSpan(preview).end > 1440 ? " · overnight" : ""}</p>
                </div>
                <ShiftTimeline shift={preview} className="mb-4" />
                <ul className="space-y-1.5 text-xs text-foreground/85">
                  {ruleLines({ ...preview, ...numeric(form) }).map((l) => <li key={l} className="flex gap-1.5"><span className="text-primary">•</span>{l}</li>)}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Enter a start and end time.</p>
            )}
            {hmToMinutes(normalizeHm(form.start_time)) === hmToMinutes(normalizeHm(form.end_time)) && preview && (
              <p className="text-xs text-destructive">Start and end cannot be the same.</p>
            )}
          </aside>
        </div>

        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          <Button className={BRAND_BTN} onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const numeric = (f) =>
  Object.fromEntries(
    ["grace_minutes", "half_day_late_minutes", "half_day_minutes", "full_day_minutes", "overtime_after_minutes", "lates_per_day_cut"].map((k) => [k, Number(f[k]) || 0]),
  );
