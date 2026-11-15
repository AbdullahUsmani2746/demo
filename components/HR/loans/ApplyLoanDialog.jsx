"use client";

// components/HR/loans/ApplyLoanDialog.jsx — apply for a salary advance / loan
// (own, or for an employee with "manage loans"), with the instalment plan and
// the approver's checks shown before sending.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, HandCoins, AlertTriangle, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SearchableSelect from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { addMonths, LOAN_KINDS } from "@/lib/hr/loans/schedule";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN } from "@/components/HR/shared";
import { DIALOG, DIALOG_FOOTER } from "@/components/HR/payroll/ui";

export const LOAN_KEYS = ["hr-loans", "hr-loan"];

export default function ApplyLoanDialog({ open, onClose, meta, forOthers = false }) {
  const qc = useQueryClient();
  const month = meta.today.slice(0, 7);
  const [f, setF] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setF({ employee_id: "", kind: "ADVANCE", amount: "", installment: "", count: 1, start_month: addMonths(month, 1), reason: "", approve_now: false });
    setPreview(null);
  }, [open, month]);

  const empQ = useQuery({ queryKey: ["hr-employee-options"], queryFn: () => api("/api/hr/shifts/assignments"), enabled: open && forOthers, staleTime: 60_000 });
  const options = useMemo(() => (empQ.data?.employees ?? []).map(({ employee: e }) => ({ value: e.id, label: `${e.name} (#${e.id})` })), [empQ.data]);

  // Instalment from "number of months" unless typed directly.
  const installment = f ? (f.installment !== "" ? Number(f.installment) : Number(f.amount) > 0 ? Math.ceil(Number(f.amount) / Math.max(1, Number(f.count) || 1)) : 0) : 0;

  useEffect(() => {
    if (!open || !f || !(Number(f.amount) > 0) || !(installment > 0) || (forOthers && !f.employee_id)) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setPreview({ data: await api("/api/hr/loans/preview", { method: "POST", body: { employee_id: f.employee_id || undefined, kind: f.kind, amount: Number(f.amount), installment, start_month: f.start_month } }) });
      } catch (e) {
        setPreview({ error: e.message });
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [open, forOthers, f?.employee_id, f?.kind, f?.amount, installment, f?.start_month]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/loans", {
        method: "POST",
        body: { employee_id: f.employee_id || undefined, kind: f.kind, amount: Number(f.amount), installment, start_month: f.start_month, reason: f.reason, approve_now: forOthers && f.approve_now },
      });
      toast.success(r.message);
      LOAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };
  if (!f) return null;
  const p = preview?.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-2xl")}>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="flex items-center gap-2"><HandCoins className="h-5 w-5 text-primary" />{forOthers ? "Advance / loan for an employee" : "Apply for an advance or loan"}</DialogTitle>
          <DialogDescription>Recovered from salary each month by payroll. It goes to the approvers unless approved now.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[1fr_240px]">
          <div className="space-y-4">
            {forOthers && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Employee</Label>
                <SearchableSelect options={options} value={f.employee_id || null} onChange={(v) => setF({ ...f, employee_id: v ?? "" })} placeholder="Search employee…" isLoading={empQ.isLoading} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(LOAN_KINDS).map(([k, v]) => (
                <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k, count: k === "ADVANCE" ? 1 : Math.max(f.count, 6), installment: "" })}
                  className={cn("min-h-[44px] rounded-lg border px-3 py-2.5 text-left transition-colors", f.kind === k ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40")}>
                  <p className="text-sm font-semibold text-foreground">{v.label}</p>
                  <p className="text-[11px] text-muted-foreground">{k === "ADVANCE" ? "Usually back next month" : "Paid back over months"}</p>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Amount (Rs)</Label>
                <Input type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="tabular-nums" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">First recovery month</Label>
                <Input type="month" min={month} value={f.start_month} onChange={(e) => setF({ ...f, start_month: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Over how many months</Label>
                <Input type="number" min={1} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value, installment: "" })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Monthly instalment</Label>
                <Input type="number" min={1} value={f.installment !== "" ? f.installment : installment || ""} onChange={(e) => setF({ ...f, installment: e.target.value })} className="tabular-nums" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reason</Label>
              <Textarea rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="The approver sees it" />
            </div>
            {forOthers && meta.rights.loanApprove && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#2f5139]/25 bg-[#edf2ee]/60 px-3 py-2.5">
                <span className="text-sm text-foreground/90">Approve now <span className="block text-xs text-muted-foreground">Recorded as approved — no request goes to the inbox</span></span>
                <Switch checked={f.approve_now} onCheckedChange={(v) => setF({ ...f, approve_now: v })} />
              </label>
            )}
          </div>
          <aside className="h-fit space-y-3 rounded-xl border border-primary/15 bg-primary/5 p-4 md:sticky md:top-0" aria-live="polite">
            <p className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">Plan {loading && <Loader2 className="h-3 w-3 animate-spin" />}</p>
            {preview?.error ? (
              <p className="flex gap-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{preview.error}</p>
            ) : p ? (
              <>
                <p className="truncate text-2xl font-bold tabular-nums text-foreground">{fmtMoney(installment)}<span className="text-sm font-normal text-muted-foreground"> × {p.count}</span></p>
                {p.gross ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet className="h-3.5 w-3.5" />{((installment / p.gross) * 100).toFixed(0)}% of gross salary {fmtMoney(p.gross)}</p> : null}
                <ul className="max-h-40 overflow-auto space-y-0.5 text-[11px] border-t border-primary/15 pt-2 tabular-nums">
                  {p.plan.map((r) => <li key={r.month} className="flex justify-between gap-2"><span>{r.month}</span><span>{fmtMoney(r.planned)} · left {fmtMoney(r.balance)}</span></li>)}
                </ul>
                {p.flags.length > 0 && (
                  <div className="space-y-1 rounded-lg bg-[#f5f0e6] p-2 text-[11px] text-[#5f4b1f]">
                    {p.flags.map((x) => <p key={x} className="flex gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{x}</p>)}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{forOthers && !f.employee_id ? "Pick the employee." : "Enter the amount."}</p>
            )}
          </aside>
        </div>
        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className={BRAND_BTN} onClick={send} disabled={busy || !p || Boolean(preview?.error)}>
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{forOthers && f.approve_now ? "Record approved" : "Send for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
