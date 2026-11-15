"use client";

// components/HR/leave/ApplyLeaveDialog.jsx — apply for leave (own, or for an
// employee with "manage leave"). Shows, before sending, which days count and
// what the balance will be.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, CalendarRange, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SearchableSelect from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { fmtDays } from "@/lib/hr/leave/policy";
import { api, BRAND_BTN, fmtDayLong } from "@/components/HR/shared";
import { DIALOG, DIALOG_FOOTER } from "@/components/HR/payroll/ui";


export const LEAVE_QUERY_KEYS = ["hr-leave-requests", "hr-leave-balances", "hr-leave-calendar", "hr-att-day", "hr-att-month"];

export default function ApplyLeaveDialog({ open, onClose, meta, forOthers = false }) {
  const qc = useQueryClient();
  const types = meta.leaveTypes.filter((t) => t.is_active);
  const [f, setF] = useState(null);
  const [preview, setPreview] = useState(null); // { ok, data } | { error }
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setF({ employee_id: forOthers ? "" : meta.self?.id ?? "", leave_type_id: String(types[0]?.id ?? ""), from: meta.today, to: meta.today, half_day: false, reason: "", approve_now: false });
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const empQ = useQuery({
    queryKey: ["hr-employee-options"],
    queryFn: () => api("/api/hr/shifts/assignments"),
    enabled: open && forOthers,
    staleTime: 60_000,
  });
  const options = useMemo(() => (empQ.data?.employees ?? []).map(({ employee: e }) => ({ value: e.id, label: `${e.name} (#${e.id})${e.department ? ` · ${e.department}` : ""}` })), [empQ.data]);
  const type = types.find((t) => String(t.id) === String(f?.leave_type_id));

  // Live preview (debounced).
  useEffect(() => {
    if (!open || !f?.leave_type_id || !f.from || (forOthers && !f.employee_id)) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        const data = await api("/api/hr/leave/preview", {
          method: "POST",
          body: { employee_id: f.employee_id || undefined, leave_type_id: Number(f.leave_type_id), from: f.from, to: f.half_day ? f.from : f.to, half_day: f.half_day },
        });
        setPreview({ data });
      } catch (e) {
        setPreview({ error: e.message });
      } finally {
        setLoadingPreview(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [open, forOthers, f?.employee_id, f?.leave_type_id, f?.from, f?.to, f?.half_day]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/leave/requests", {
        method: "POST",
        body: {
          employee_id: f.employee_id || undefined,
          leave_type_id: Number(f.leave_type_id),
          from: f.from,
          to: f.half_day ? f.from : f.to,
          half_day: f.half_day,
          reason: f.reason,
          approve_now: forOthers && f.approve_now,
        },
      });
      toast.success(r.message);
      LEAVE_QUERY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  if (!f) return null;
  const p = preview?.data;
  const canSend = p && p.fits && !preview.error && (!forOthers || f.employee_id);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8"><CalendarRange className="h-5 w-5 shrink-0 text-primary" />{forOthers ? "Apply leave for an employee" : "Apply for leave"}</DialogTitle>
          <DialogDescription>{forOthers ? "Entered on the employee’s behalf." : `For ${meta.self?.name}.`} It goes to the leave approvers unless approved now.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1fr_240px] md:gap-6">
          <div className="space-y-4">
            {forOthers && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Employee</Label>
                <SearchableSelect options={options} value={f.employee_id || null} onChange={(v) => setF({ ...f, employee_id: v ?? "" })} placeholder="Search employee…" isLoading={empQ.isLoading} />
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Leave type</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Leave type">
                {types.map((t) => {
                  const on = String(t.id) === String(f.leave_type_id);
                  return (
                    <button key={t.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, leave_type_id: String(t.id), half_day: f.half_day && t.allow_half_day })}
                      className={cn("min-h-[3rem] rounded-lg border px-3 py-2 text-left text-sm transition", on ? "border-transparent ring-2" : "border-border hover:border-primary/40")}
                      style={on ? { "--tw-ring-color": t.color, background: `${t.color}0f` } : undefined}>
                      <span className="flex items-center gap-1.5 font-medium text-foreground"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} /><span className="truncate">{t.name}</span></span>
                      <span className="text-[11px] text-muted-foreground">{t.is_paid ? "Paid" : "Unpaid"}{t.allow_negative ? " · no limit" : ` · ${fmtDays(t.annual_days)}/yr`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="leave-from" className="text-xs text-muted-foreground">From</Label>
                <Input id="leave-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave-to" className="text-xs text-muted-foreground">To</Label>
                <Input id="leave-to" type="date" value={f.half_day ? f.from : f.to} min={f.from} disabled={f.half_day} onChange={(e) => setF({ ...f, to: e.target.value })} />
              </div>
            </div>
            {type?.allow_half_day && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm text-foreground/90">Half day <span className="text-xs text-muted-foreground">(works the other half)</span></span>
                <Switch checked={f.half_day} onCheckedChange={(v) => setF({ ...f, half_day: v, to: f.from })} />
              </label>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="leave-reason" className="text-xs text-muted-foreground">Reason</Label>
              <Textarea id="leave-reason" rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Optional — the approver sees it" />
            </div>
            {forOthers && meta.rights.leaveApprove && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#2f5139]/25 bg-[#edf2ee]/60 px-3 py-2.5">
                <span className="text-sm text-foreground/90">Approve now <span className="block text-xs text-muted-foreground">Recorded as approved at once — no request goes to the inbox</span></span>
                <Switch checked={f.approve_now} onCheckedChange={(v) => setF({ ...f, approve_now: v })} />
              </label>
            )}
          </div>

          <aside className="h-fit space-y-3 rounded-xl border border-primary/15 bg-primary/5 p-4 md:sticky md:top-0" aria-live="polite">
            <p className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">Summary {loadingPreview && <Loader2 className="h-3 w-3 animate-spin" />}</p>
            {preview?.error ? (
              <p className="flex gap-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{preview.error}</p>
            ) : p ? (
              <>
                <div>
                  <p className="text-3xl font-bold tabular-nums text-foreground">{fmtDays(p.days)}</p>
                  <p className="text-xs text-muted-foreground">day(s) of leave · leave year {p.year}</p>
                </div>
                {!p.unlimited && p.balance && (
                  <div className="space-y-1 text-sm">
                    <Row label="Available now" value={fmtDays(p.balance.available)} />
                    <Row label="After this" value={fmtDays(p.after)} strong tone={p.fits ? "text-[#2f5139]" : "text-red-700"} />
                    {p.balance.pending > 0 && <p className="text-[11px] text-muted-foreground">{fmtDays(p.balance.pending)} day(s) already waiting for approval are counted.</p>}
                  </div>
                )}
                {p.unlimited && <p className="flex gap-1.5 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0" />No balance limit for this type.</p>}
                {p.fits ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-[#2f5139]"><CheckCircle2 className="h-4 w-4" />Fits the balance</p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-red-700"><AlertTriangle className="h-4 w-4" />Not enough balance</p>
                )}
                {p.dates.length > 1 && (
                  <ul className="max-h-40 overflow-auto space-y-0.5 text-[11px] border-t border-primary/15 pt-2">
                    {p.dates.map((d) => (
                      <li key={d.day} className={cn("flex justify-between gap-2 tabular-nums", d.counts ? "text-foreground/90" : "text-muted-foreground line-through decoration-muted-foreground/50")}>
                        <span>{fmtDayLong(d.day).slice(0, 10)}</span><span>{d.counts ? "leave" : d.why}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{forOthers && !f.employee_id ? "Pick the employee." : "Pick the type and dates."}</p>
            )}
          </aside>
        </div>

        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className={BRAND_BTN} onClick={send} disabled={busy || !canSend}>
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {forOthers && f.approve_now ? "Record approved leave" : "Send for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong, tone = "text-foreground" }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "font-bold", tone)}>{value}</span>
    </div>
  );
}
