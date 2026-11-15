"use client";

// components/HR/shifts/AssignTab.jsx — put employees on shifts from a date.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, CalendarClock, Loader2, Users, Trash2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { WEEKDAYS } from "@/lib/hr/time";
import { api, BRAND_BTN, CHIP, EmployeeCell, EmptyState, NativeSelect, ShiftChip, TH } from "@/components/HR/shared";

// Dialogs: near full width on phones, scroll when tall; footer buttons stack with a gap.
const DIALOG = "w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6";
const DIALOG_FOOTER = "gap-2 sm:space-x-0";

const daysText = (days) => (days?.length ? days.map((d) => WEEKDAYS[d].short).join(", ") : "none");

export default function AssignTab({ meta }) {
  const qc = useQueryClient();
  const canManage = meta.rights.shifts;
  const shiftById = useMemo(() => new Map(meta.shifts.map((s) => [s.id, s])), [meta.shifts]);
  const [department, setDepartment] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // the assignment to remove, once confirmed
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ ...(department && { department }), ...(q && { q }) });
  const { data, isLoading } = useQuery({ queryKey: ["hr-assignments", department, q], queryFn: () => api(`/api/hr/shifts/assignments?${params}`) });

  const rows = useMemo(() => {
    const all = data?.employees ?? [];
    if (!shiftFilter) return all;
    if (shiftFilter === "none") return all.filter((r) => !r.current);
    return all.filter((r) => String(r.current?.shift_id) === shiftFilter);
  }, [data, shiftFilter]);

  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.employee.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const openAssign = (ids) =>
    setDialog({
      employeeIds: ids,
      shift_id: String(meta.shifts.find((s) => s.is_active)?.id ?? ""),
      effective_from: meta.today,
      week_off_override: false,
      week_off_days: [0],
    });

  const assign = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/shifts/assignments", { method: "POST", body: { ...dialog, shift_id: Number(dialog.shift_id) } });
      toast.success(r.message);
      setDialog(null);
      setSelected(new Set());
      ["hr-assignments", "hr-shifts", "hr-att-day", "hr-att-month"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeAssignment = async (a) => {
    setRemoving(true);
    try {
      const r = await api(`/api/hr/shifts/assignments?id=${a.id}`, { method: "DELETE" });
      toast.success(r.message);
      setHistory((h) => (h ? { ...h, history: h.history.filter((x) => x.id !== a.id) } : h));
      ["hr-assignments", "hr-shifts", "hr-att-day", "hr-att-month"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setConfirmRemove(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRemoving(false);
    }
  };

  const sinceText = (r) => (r.current ? (r.current.effective_from <= "2000-01-01" ? "start" : r.current.effective_from) : "—");

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-background p-3 sm:flex sm:flex-wrap sm:items-center">
        <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full sm:w-56" aria-label="Department">
          <option value="">All departments</option>
          {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
        </NativeSelect>
        <NativeSelect value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} className="w-full sm:w-56" aria-label="Shift">
          <option value="">Any shift</option>
          <option value="none">No shift</option>
          {meta.shifts.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.start_time}–{s.end_time}</option>)}
        </NativeSelect>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee no." className="h-9 pl-8" aria-label="Search employees" />
        </div>
        {canManage && (
          <label className="flex items-center gap-2 text-sm text-foreground/70 md:hidden">
            <Checkbox checked={allOn} onCheckedChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.employee.id)))} disabled={!rows.length} aria-label="Select all" />
            Select all shown
          </label>
        )}
        {canManage && !selected.size && (
          <Button className={cn(BRAND_BTN, "w-full sm:ml-auto sm:w-auto")} disabled title="Tick employees first">
            <CalendarClock className="mr-1.5 h-4 w-4" />Assign shift
          </Button>
        )}
      </div>

      {/* Selection bar — sticks to the top while employees are ticked */}
      {canManage && selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-col gap-2 rounded-xl border border-primary/25 bg-background/95 px-3 py-2.5 shadow-md shadow-red-900/5 backdrop-blur sm:flex-row sm:items-center">
          <p className="text-sm font-semibold text-foreground">
            <span className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">{selected.size}</span>
            selected
          </p>
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="ghost" className="h-9" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button className={cn(BRAND_BTN, "h-9 flex-1 sm:flex-none")} onClick={() => openAssign([...selected])}>
              <CalendarClock className="mr-1.5 h-4 w-4" />Assign shift to {selected.size}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {isLoading && (
          <div className="space-y-2 p-3 sm:p-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full md:h-8" />)}</div>
        )}

        {/* Phone: cards */}
        {!isLoading && rows.length > 0 && (
          <ul className="divide-y divide-border/60 md:hidden">
            {rows.map((r) => {
              const shift = r.current ? shiftById.get(r.current.shift_id) : null;
              const off = r.current?.week_off_override ? r.current.week_off_days : shift?.week_off_days;
              const next = r.upcoming[0];
              return (
                <li key={r.employee.id} className={cn("flex items-start gap-3 px-3 py-3", selected.has(r.employee.id) && "bg-primary/[0.03]")}>
                  {canManage && <Checkbox className="mt-2.5" checked={selected.has(r.employee.id)} onCheckedChange={() => toggle(r.employee.id)} aria-label={`Select ${r.employee.name}`} />}
                  <div className="min-w-0 flex-1 space-y-2">
                    <EmployeeCell employee={r.employee} />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <ShiftChip shift={shift} />
                      {r.current && <span className="tabular-nums">since {sinceText(r)}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Week off <span className="font-medium text-foreground/85">{daysText(off)}</span>
                      {r.current?.week_off_override && <span className={cn("ml-1.5 rounded px-1 text-[10px] font-bold", CHIP.brand)}>OWN</span>}
                    </p>
                    {next && (
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        Next <ShiftChip shift={shiftById.get(next.shift_id)} /> from <span className="tabular-nums">{next.effective_from}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-primary/70 hover:bg-primary/10 hover:text-primary" title="History" aria-label={`Shift history of ${r.employee.name}`} onClick={() => setHistory(r)}><History className="h-4 w-4" /></Button>
                    {canManage && <Button size="sm" variant="outline" className="h-9 bg-background" onClick={() => openAssign([r.employee.id])}>Change</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Tablet & up: table */}
        {!isLoading && rows.length > 0 && (
          // Long lists scroll inside the card so the maroon header stays in view.
          <div className="hidden max-h-[calc(100vh-15rem)] min-h-[320px] overflow-auto md:block">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-primary text-left text-primary-foreground">
                <tr>
                  {canManage && (
                    <th className={cn(TH, "w-10")}>
                      <Checkbox
                        checked={allOn}
                        onCheckedChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.employee.id)))}
                        aria-label="Select all"
                        className="border-white/80 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-primary"
                      />
                    </th>
                  )}
                  <th className={TH}>Employee</th>
                  <th className={TH}>Shift today</th>
                  <th className={TH}>Since</th>
                  <th className={TH}>Week off</th>
                  <th className={TH}>Coming up</th>
                  <th className={cn(TH, "w-24")}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => {
                  const shift = r.current ? shiftById.get(r.current.shift_id) : null;
                  const off = r.current?.week_off_override ? r.current.week_off_days : shift?.week_off_days;
                  const next = r.upcoming[0];
                  return (
                    <tr key={r.employee.id} className={cn("hover:bg-primary/[0.03]", selected.has(r.employee.id) && "bg-primary/[0.03]")}>
                      {canManage && <td className="px-3 py-2"><Checkbox checked={selected.has(r.employee.id)} onCheckedChange={() => toggle(r.employee.id)} aria-label={`Select ${r.employee.name}`} /></td>}
                      <td className="max-w-[280px] px-3 py-2"><EmployeeCell employee={r.employee} /></td>
                      <td className="px-3 py-2"><ShiftChip shift={shift} /></td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-foreground/70">{sinceText(r)}</td>
                      <td className="px-3 py-2 text-foreground/70">
                        {daysText(off)}
                        {r.current?.week_off_override && <span className={cn("ml-1.5 rounded px-1 text-[10px] font-bold", CHIP.brand)}>OWN</span>}
                      </td>
                      <td className="px-3 py-2 text-foreground/70">
                        {next ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><ShiftChip shift={shiftById.get(next.shift_id)} />from <span className="tabular-nums">{next.effective_from}</span></span> : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-primary/70 hover:bg-primary/10 hover:text-primary" title="History" aria-label={`Shift history of ${r.employee.name}`} onClick={() => setHistory(r)}><History className="h-4 w-4" /></Button>
                        {canManage && <Button size="sm" variant="ghost" className="text-primary hover:bg-primary/5 hover:text-primary" onClick={() => openAssign([r.employee.id])}>Change</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && !rows.length && <EmptyState icon={Users} title="No employees match" hint="Try another department, shift or search." />}
      </div>

      {/* Assign */}
      <Dialog open={Boolean(dialog)} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-lg")}>
          <DialogHeader>
            <DialogTitle>Assign shift</DialogTitle>
            <DialogDescription>
              {dialog?.employeeIds.length} employee(s). From the date below their days are read with this shift — days already locked by payroll keep theirs.
            </DialogDescription>
          </DialogHeader>
          {dialog && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="assign-shift" className="text-xs text-foreground/70">Shift</Label>
                  <NativeSelect id="assign-shift" value={dialog.shift_id} onChange={(e) => setDialog({ ...dialog, shift_id: e.target.value })} className="w-full">
                    {meta.shifts.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.start_time}–{s.end_time}</option>)}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assign-from" className="text-xs text-foreground/70">Effective from</Label>
                  <Input id="assign-from" type="date" value={dialog.effective_from} onChange={(e) => setDialog({ ...dialog, effective_from: e.target.value })} />
                </div>
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm text-foreground/85">
                  Own week-off days
                  <span className="block text-xs text-muted-foreground">Off: the shift&apos;s ({daysText(shiftById.get(Number(dialog.shift_id))?.week_off_days)})</span>
                </span>
                <Switch checked={dialog.week_off_override} onCheckedChange={(v) => setDialog({ ...dialog, week_off_override: v })} />
              </label>
              {dialog.week_off_override && (
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => {
                    const on = dialog.week_off_days.includes(d.value);
                    return (
                      <button key={d.value} type="button" aria-pressed={on}
                        onClick={() => setDialog({ ...dialog, week_off_days: on ? dialog.week_off_days.filter((x) => x !== d.value) : [...dialog.week_off_days, d.value].sort() })}
                        className={cn("h-9 min-w-[3rem] rounded-lg border px-3 text-sm font-medium transition", on ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground/70 hover:border-primary/40 hover:text-primary")}>
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <DialogFooter className={DIALOG_FOOTER}>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button className={BRAND_BTN} onClick={assign} disabled={busy || !dialog?.shift_id}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History */}
      <Dialog open={Boolean(history)} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-lg")}>
          <DialogHeader>
            <DialogTitle className="pr-8">Shift history — {history?.employee.name}</DialogTitle>
            <DialogDescription>The latest assignment on or before a day decides that day&apos;s shift.</DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {(history?.history ?? []).slice().reverse().map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
                <span className="w-24 font-medium tabular-nums text-foreground/80">{a.effective_from <= "2000-01-01" ? "From start" : a.effective_from}</span>
                <ShiftChip shift={shiftById.get(a.shift_id)} />
                {a.week_off_override && <span className="text-xs text-muted-foreground">off: {daysText(a.week_off_days)}</span>}
                {canManage && (
                  <Button size="icon" variant="ghost" className="ml-auto h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmRemove(a)} title="Remove" aria-label={`Remove assignment from ${a.effective_from}`}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            ))}
            {!history?.history?.length && <p className="px-3 py-4 text-sm text-muted-foreground">Never assigned a shift.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmRemove)} onOpenChange={(o) => !o && !removing && setConfirmRemove(null)}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this shift assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              {history?.employee.name}&apos;s assignment {confirmRemove?.effective_from <= "2000-01-01" ? "from the start" : `from ${confirmRemove?.effective_from}`} goes. The days it covered take the shift of the assignment before it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel disabled={removing}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removing}
              onClick={(e) => { e.preventDefault(); removeAssignment(confirmRemove); }}
            >
              {removing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
