"use client";

// components/HR/leave/BalancesTab.jsx — employees × leave types for a leave
// year. Click a balance to adjust it (managers); close the year to carry
// unused days forward.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Search, Loader2, ArrowRightToLine, Download, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDays, leaveYearOf } from "@/lib/hr/leave/policy";
import { api, BRAND_BTN, EmployeeCell, EmptyState, NativeSelect } from "@/components/HR/shared";
import { DIALOG, DIALOG_FOOTER, TH } from "@/components/HR/payroll/ui";


export default function BalancesTab({ meta }) {
  const qc = useQueryClient();
  const canManage = meta.rights.leaveManage;
  const sm = meta.settings.leaveYearStartMonth;
  const [year, setYear] = useState(leaveYearOf(meta.today, sm));
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ year, ...(department && { department }), ...(q && { q }) });
  const { data, isLoading } = useQuery({ queryKey: ["hr-leave-balances", "all", year, department, q], queryFn: () => api(`/api/hr/leave/balances?${params}`) });
  const types = data?.types ?? [];

  const save = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/leave/balances", { method: "PUT", body: { ...edit.form, employee_id: edit.employee.id, leave_type_id: edit.type.id, year } });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-leave-balances"] });
      setEdit(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const carry = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/leave/balances/carry-forward", { method: "POST", body: { year } });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-leave-balances"] });
      setClosing(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const openEdit = (r, t) => {
    const b = r.balances[t.id];
    setEdit({ employee: r.employee, type: t, b, form: { carry_forward: b.carry_forward, adjustment: b.adjustment, note: b.note ?? "" } });
  };
  const breakdown = (b) =>
    b.comp_off
      ? `Comp off · earned ${fmtDays(b.entitled)} this year (working a week-off / holiday) · taken ${fmtDays(b.used)} · waiting ${fmtDays(b.pending)} · adjusted ${fmtDays(b.adjustment)} · left = earned in the last ${b.valid_days} days and not yet taken`
      : `Entitled ${fmtDays(b.entitled)} · carried ${fmtDays(b.carry_forward)} · adjusted ${fmtDays(b.adjustment)} · taken ${fmtDays(b.used)} · waiting ${fmtDays(b.pending)}`;

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const head = ["Emp No", "Name", "Department", ...types.flatMap((t) => [`${t.code} entitled`, `${t.code} taken`, `${t.code} left`])];
    const body = (data?.employees ?? []).map((r) => [
      r.employee.id, r.employee.name, r.employee.department ?? "",
      ...types.flatMap((t) => {
        const b = r.balances[t.id];
        return [b.entitled + b.carry_forward + b.adjustment, b.used, b.unlimited ? "" : b.available];
      }),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`Leave balances ${data.label}`], [], head, ...body]), "Balances");
    XLSX.writeFile(wb, `leave-balances-${year}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setYear(year - 1)} aria-label="Previous leave year"><ChevronLeft className="h-4 w-4" /></Button>
          <p className="flex-1 text-center text-sm font-semibold text-primary whitespace-nowrap sm:min-w-[9rem] sm:flex-none">Leave year {data?.label ?? year}</p>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setYear(year + 1)} aria-label="Next leave year"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:flex-nowrap lg:justify-end">
          <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="col-span-2 w-full sm:w-52" aria-label="Department">
            <option value="">All departments</option>
            {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </NativeSelect>
          <div className="relative col-span-2 sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee no." className="h-9 pl-8" aria-label="Search employees" />
          </div>
          <Button variant="outline" className={cn("h-9", !canManage && "col-span-2")} onClick={exportExcel} disabled={!data?.employees?.length}><Download className="h-4 w-4 mr-1.5" />Excel</Button>
          {canManage && <Button variant="outline" className="h-9" onClick={() => setClosing(true)}><ArrowRightToLine className="h-4 w-4 mr-1.5" />Carry forward</Button>}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {isLoading ? (
          <div className="space-y-2 p-3 sm:p-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 md:h-9" />)}</div>
        ) : !data?.employees?.length ? (
          <EmptyState icon={Users} title="No employees" hint="No employees match these filters for this leave year." />
        ) : (
          <>
            {/* Phone: one card per employee, a tile per leave type */}
            <ul className="divide-y divide-border/60 md:hidden">
              {data.employees.map((r) => (
                <li key={r.employee.id} className="space-y-2.5 px-3 py-3">
                  <EmployeeCell employee={r.employee} compact />
                  <div className="grid grid-cols-2 gap-2">
                    {types.map((t) => {
                      const b = r.balances[t.id];
                      const total = b.entitled + b.carry_forward + b.adjustment;
                      const low = !b.unlimited && b.available <= 0 && total > 0;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={!canManage}
                          onClick={() => openEdit(r, t)}
                          title={breakdown(b)}
                          aria-label={`${t.name}: ${breakdown(b)}`}
                          className={cn("min-h-[3rem] rounded-lg border border-border px-2.5 py-1.5 text-left transition disabled:cursor-default", canManage && "hover:border-primary/40 hover:bg-primary/[0.03]")}
                        >
                          <span className="flex items-center gap-1.5 truncate text-[11px] font-medium text-muted-foreground">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.color }} />
                            <span className="truncate">{t.name}</span>
                          </span>
                          <span className={cn("block text-sm tabular-nums", low ? "text-red-700" : "text-foreground")}>
                            {b.unlimited ? (
                              <span className="text-muted-foreground">{fmtDays(b.used)} taken</span>
                            ) : total === 0 && !b.used ? (
                              <span className="text-muted-foreground/60">—</span>
                            ) : (
                              <>
                                <span className="font-semibold">{fmtDays(b.available)}</span>
                                <span className="text-xs text-muted-foreground"> / {fmtDays(total)}</span>
                                {b.pending > 0 && <span className="ml-1 text-[10px] text-[#5f4b1f]">{fmtDays(b.pending)} waiting</span>}
                              </>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
            {/* Tablet & up: employees × leave types */}
            <div className="hidden max-h-[70vh] overflow-auto md:block">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-20">
                  <tr className="text-left">
                    <th className={cn(TH, "sticky left-0 z-20 min-w-[220px] px-4")}>Employee</th>
                    {types.map((t) => (
                      <th key={t.id} className={cn(TH, "min-w-[110px] text-center")}>
                        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full ring-1 ring-white/60" style={{ background: t.color }} />{t.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.employees.map((r) => (
                    <tr key={r.employee.id} className="hover:bg-primary/[0.03]">
                      <td className="sticky left-0 z-[1] max-w-[260px] bg-background px-4 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"><EmployeeCell employee={r.employee} compact /></td>
                      {types.map((t) => {
                        const b = r.balances[t.id];
                        const total = b.entitled + b.carry_forward + b.adjustment;
                        const low = !b.unlimited && b.available <= 0 && total > 0;
                        return (
                          <td key={t.id} className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              disabled={!canManage}
                              onClick={() => openEdit(r, t)}
                              title={breakdown(b)}
                              aria-label={`${t.name} of ${r.employee.name}: ${breakdown(b)}`}
                              className={cn("w-full rounded-md px-2 py-1 tabular-nums transition disabled:cursor-default", canManage && "hover:bg-primary/10", low && "text-red-700")}
                            >
                              {b.unlimited ? (
                                <span className="text-muted-foreground">{fmtDays(b.used)} taken</span>
                              ) : total === 0 && !b.used ? (
                                <span className="text-muted-foreground/60">—</span>
                              ) : (
                                <>
                                  <span className="font-semibold">{fmtDays(b.available)}</span>
                                  <span className="text-xs text-muted-foreground"> / {fmtDays(total)}</span>
                                  {b.pending > 0 && <span className="block text-[10px] text-[#5f4b1f]">{fmtDays(b.pending)} waiting</span>}
                                </>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Left / total. Total = entitled (from the leave type) + carried forward + adjustments. Hover a balance for the breakdown{canManage ? "; click it to adjust" : ""}.</p>

      <Dialog open={Boolean(edit)} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          {edit && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{edit.type.name} — {edit.employee.name}</DialogTitle>
                <DialogDescription>Leave year {data.label}. Entitled {fmtDays(edit.b.entitled)} by the leave type; taken {fmtDays(edit.b.used)}; waiting {fmtDays(edit.b.pending)}.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bal-carry" className="text-xs text-muted-foreground">Carried forward</Label>
                  <Input id="bal-carry" inputMode="decimal" type="number" step={0.5} min={0} value={edit.form.carry_forward} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, carry_forward: e.target.value } })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bal-adjust" className="text-xs text-muted-foreground">Adjustment (+ / −)</Label>
                  <Input id="bal-adjust" type="number" step={0.5} value={edit.form.adjustment} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, adjustment: e.target.value } })} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="bal-note" className="text-xs text-muted-foreground">Why</Label>
                  <Textarea id="bal-note" rows={2} maxLength={300} value={edit.form.note} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, note: e.target.value } })} placeholder="e.g. Opening balance from the old system" />
                </div>
              </div>
              <p className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
                Left after saving: <b className="tabular-nums text-primary">{fmtDays(edit.b.entitled + Number(edit.form.carry_forward || 0) + Number(edit.form.adjustment || 0) - edit.b.used - edit.b.pending)}</b>
              </p>
              <DialogFooter className={DIALOG_FOOTER}>
                <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
                <Button className={BRAND_BTN} onClick={save} disabled={busy || !edit.form.note.trim()}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          <DialogHeader>
            <DialogTitle className="pr-8">Carry forward from {data?.label}</DialogTitle>
            <DialogDescription>
              For every active employee you can see, unused days of each leave type that carries forward (up to its limit) become the carried-forward days of the next leave year.
              Leave still waiting for approval is not counted. Running it again recalculates — it never adds twice.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className={DIALOG_FOOTER}>
            <Button variant="ghost" onClick={() => setClosing(false)}>Cancel</Button>
            <Button className={BRAND_BTN} onClick={carry} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Carry forward</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
