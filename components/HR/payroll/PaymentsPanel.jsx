"use client";

// components/HR/payroll/PaymentsPanel.jsx — paying a posted payroll's net
// salaries (lib/hr/payroll/pay.js). Each payment is a Payment voucher for the
// employees it names; a payment is undone by a reversal journal, never edited.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, Loader2, Undo2, Receipt, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactSelect from "react-select";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { api, BRAND_BTN } from "@/components/HR/shared";
import { Card, CodeChip, DIALOG, DIALOG_FOOTER, Fig, TFOOT } from "@/components/HR/payroll/ui";

const WHO = [
  { key: "all", label: "Everyone not paid yet", test: () => true },
  { key: "cash", label: "Paid in cash", test: (p) => p.data.bank?.method === "CASH" },
  { key: "bank", label: "Bank transfer / cheque", test: (p) => ["DIRECT_DEPOSIT", "CHEQUE"].includes(p.data.bank?.method) },
  { key: "through", label: "Handed through a person", test: (p) => p.data.bank?.method === "THROUGH_PERSON" },
  { key: "pick", label: "Choose people…", test: () => true },
];

export function PayDialog({ open, onClose, runId, run, slips, paidBy, today }) {
  const qc = useQueryClient();
  const [who, setWho] = useState("all");
  const [picked, setPicked] = useState(() => new Set());
  const [cashAcno, setCashAcno] = useState("");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const cash = useQuery({ queryKey: ["hr-cash-accounts"], queryFn: () => api("/api/hr/cash-accounts"), enabled: open, staleTime: 300_000 });

  const unpaid = useMemo(() => slips.filter((p) => !paidBy[p.employee.id] && p.net > 0), [slips, paidBy]);
  const rule = WHO.find((w) => w.key === who);
  // "Handed through a person" only when someone on this payroll is paid that way (feature hr.paidThroughPerson).
  const whoOptions = WHO.filter((w) => w.key !== "through" || slips.some((p) => p.data.bank?.method === "THROUGH_PERSON"));
  const chosen = who === "pick" ? unpaid.filter((p) => picked.has(p.employee.id)) : unpaid.filter((p) => !p.hold && rule.test(p));
  const total = chosen.reduce((s, p) => s + p.net, 0);
  const held = unpaid.filter((p) => p.hold).length;
  const cashOptions = (cash.data?.accounts ?? []).map((a) => ({ value: String(a.acno), label: `${a.name} (${a.acno})` }));

  async function pay() {
    setBusy(true);
    try {
      const r = await api(`/api/hr/payroll/${runId}`, {
        method: "POST",
        body: { action: "pay", date, cash_acno: Number(cashAcno), reference, employee_ids: chosen.map((p) => p.employee.id) },
      });
      toast.success(r.message, { duration: 8000 });
      qc.invalidateQueries({ queryKey: ["hr-payroll-run", String(runId)] });
      onClose();
    } catch (e) {
      toast.error(e.message, { duration: 10000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-lg")}>
        <DialogHeader className="text-left">
          <DialogTitle className="pr-8">Pay salaries — {run.label}</DialogTitle>
          <DialogDescription>Posts a payment voucher: Dr salaries payable for each person, Cr the cash / bank account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Who</Label>
            <div className="grid grid-cols-2 gap-2">
              {whoOptions.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  onClick={() => setWho(w.key)}
                  aria-pressed={who === w.key}
                  className={cn("min-h-[44px] rounded-lg border px-3 py-2 text-left text-sm", who === w.key ? "border-primary bg-primary/5 font-semibold text-primary ring-1 ring-primary" : "border-border text-muted-foreground hover:border-primary/40")}
                >
                  {w.label}
                </button>
              ))}
            </div>
            {held > 0 && who !== "pick" && <p className="text-xs text-[#5f4b1f]">{held} on hold are left out — pick them by name to pay them.</p>}
          </div>
          {who === "pick" && (
            <ul className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border text-sm">
              {unpaid.map((p) => (
                <li key={p.employee.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-primary/[0.03]">
                    <Checkbox
                      checked={picked.has(p.employee.id)}
                      onCheckedChange={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(p.employee.id)) n.delete(p.employee.id);
                          else n.add(p.employee.id);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{p.employee.name} <span className="text-xs text-muted-foreground">#{p.employee.id}{p.hold ? " · on hold" : ""}</span></span>
                    <span className="tabular-nums font-medium">{fmtMoney(p.net)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Paid from</Label>
              {/* Inside a dialog: the menu stays in the dialog (fixed, not portalled to body). */}
              <ReactSelect
                aria-label="Paid from"
                options={cashOptions}
                value={cashOptions.find((o) => o.value === String(cashAcno)) ?? null}
                onChange={(o) => setCashAcno(o ? o.value : "")}
                isLoading={cash.isLoading}
                placeholder={cash.isLoading ? "Loading…" : cashOptions.length ? "Choose cash / bank account…" : "No cash / bank account you may use"}
                noOptionsMessage={() => "No cash / bank account you may use"}
                menuPosition="fixed"
                styles={selectStyles(false)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input type="date" value={date} min={run.pay_date} max={today} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Cheque / transfer ref. (optional)</Label>
              <Input value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5 text-sm" aria-live="polite">
            <span>{chosen.length} employee(s)</span>
            <span className="text-base font-bold tabular-nums text-primary">{fmtMoney(total)}</span>
          </div>
        </div>
        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button className={BRAND_BTN} disabled={busy || !chosen.length || !cashAcno || !date} onClick={pay}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Pay {fmtMoney(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentsPanel({ runId, payments, canPay, canReverse, onPay, today }) {
  const qc = useQueryClient();
  const [undo, setUndo] = useState(null);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const pct = payments.total ? Math.min(100, (payments.paid / payments.total) * 100) : 0;

  async function reverse() {
    setBusy(true);
    try {
      const r = await api(`/api/hr/payroll/${runId}`, { method: "POST", body: { action: "reverse_payment", payment_id: undo.id, date, note: reason } });
      toast.success(r.message, { duration: 8000 });
      qc.invalidateQueries({ queryKey: ["hr-payroll-run", String(runId)] });
      setUndo(null);
      setReason("");
    } catch (e) {
      toast.error(e.message, { duration: 10000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Salary payments"
      icon={Banknote}
      description="Each payment is a payment voucher; a payment is undone by a reversal journal"
      actions={canPay && <Button size="sm" className={cn(BRAND_BTN, "h-9")} onClick={onPay}><Banknote className="mr-1.5 h-4 w-4" />Pay salaries</Button>}
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <Fig label="Net pay" value={fmtMoney(payments.total)} className="[&>p:last-child]:font-bold sm:[&>p:last-child]:text-lg" />
          <Fig label="Paid" value={fmtMoney(payments.paid)} tone="text-[#2f5139]" className="[&>p:last-child]:font-bold sm:[&>p:last-child]:text-lg" />
          <Fig label="Still to pay" value={fmtMoney(payments.unpaid)} tone="text-primary" className="[&>p:last-child]:font-bold sm:[&>p:last-child]:text-lg" />
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Paid" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        {payments.unpaid <= 0 && payments.total > 0 && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-[#2f5139]"><CheckCircle2 className="h-4 w-4" />Everyone is paid.</p>
        )}
        {payments.list.length > 0 && (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border text-sm">
            {payments.list.map((p) => (
              <li key={p.id} className={cn("flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center", p.reversal_tran_id && "bg-muted/40 text-muted-foreground")}>
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium", p.reversal_tran_id ? "line-through" : "text-foreground")}>
                    {p.date} · {p.account} · {p.count} employee(s){p.reference ? ` · ${p.reference}` : ""}
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <CodeChip className="inline-flex items-center gap-1"><Receipt className="h-3 w-3" />PV #{p.tran_id}</CodeChip>
                    by {p.by}
                    {p.reversal_tran_id && <span className="text-red-800">· reversed by JV #{p.reversal_tran_id} ({p.reverse_reason})</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="font-semibold tabular-nums">{fmtMoney(p.amount)}</span>
                  {canReverse && !p.reversal_tran_id && (
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-700 hover:bg-red-50" title="Reverse this payment" aria-label="Reverse this payment" onClick={() => setUndo(p)}>
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {payments.list.length > 1 && (
              <li className={cn(TFOOT, "flex items-center justify-between gap-2 border-t-0 px-3 py-2")}>
                <span className="text-xs uppercase tracking-wide text-primary">Paid (not reversed)</span>
                <span className="tabular-nums">{fmtMoney(payments.list.filter((p) => !p.reversal_tran_id).reduce((s, p) => s + (Number(p.amount) || 0), 0))}</span>
              </li>
            )}
          </ul>
        )}
      </div>

      <Dialog open={Boolean(undo)} onOpenChange={(o) => !o && setUndo(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          <DialogHeader className="text-left">
            <DialogTitle className="pr-8">Reverse payment voucher #{undo?.tran_id}</DialogTitle>
            <DialogDescription>A journal voucher mirroring it is posted; the original stays in the books. Its {undo?.count} employee(s) show as unpaid again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></div>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" placeholder="Reason (required)" />
          </div>
          <DialogFooter className={DIALOG_FOOTER}>
            <Button variant="ghost" onClick={() => setUndo(null)}>Back</Button>
            <Button className="bg-red-600 text-white hover:bg-red-700" disabled={busy || !reason.trim() || !date} onClick={reverse}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Reverse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
