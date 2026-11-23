"use client";

// components/HR/loans/LoanDetail.jsx — one advance / loan: progress, schedule,
// repayments, timeline, and what may be done with it. Paying out and taking
// repayments post vouchers (lib/hr/vouchers.js); they are undone by reversal.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X, Ban, Banknote, CalendarX, Repeat, Send, Loader2, AlertTriangle, Undo2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import ReactSelect from "react-select";
import { cn } from "@/lib/utils";
import { LOAN_KINDS, LOAN_STATUS } from "@/lib/hr/loans/schedule";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { api, BRAND_BTN, fmtWhen } from "@/components/HR/shared";
import { LOAN_KEYS } from "@/components/HR/loans/ApplyLoanDialog";
import { Chip, CodeChip, DIALOG, DIALOG_FOOTER, Fig, LOAN_TONE, SHEET, Stepper, TFOOT, TH } from "@/components/HR/payroll/ui";

export function LoanStatus({ status }) {
  const m = LOAN_STATUS[status] ?? LOAN_STATUS.pending;
  return <Chip tone={LOAN_TONE[status] ?? "warn"}>{m.label}</Chip>;
}

// Life cycle shown on the stepper: how far this advance / loan has got.
const STEPS = [{ label: "Applied" }, { label: "Approved" }, { label: "Paid out" }, { label: "Recovering" }, { label: "Settled" }];
function stepOf(l, events) {
  if (l.status === "pending") return { done: 0 };
  if (l.status === "rejected") return { done: 0, stopped: "Rejected" };
  if (l.status === "cancelled") return { done: events.some((e) => /approv/i.test(e.action)) ? 1 : 0, stopped: "Cancelled" };
  if (l.status === "settled") return { done: 4 };
  if (!l.disbursed_on) return { done: 1 };
  return { done: l.recovered > 0 ? 3 : 2 };
}

const FORMS = {
  approve: { title: "Approve", fields: ["note"], tone: "bg-[#2f5139] hover:bg-[#243f2c] text-white" },
  reject: { title: "Reject", fields: ["note"], required: ["note"], tone: "bg-red-600 hover:bg-red-700 text-white" },
  cancel: { title: "Cancel", fields: ["note"], tone: "bg-primary text-primary-foreground hover:bg-primary/90" },
  repay: { title: "Receive a repayment", fields: ["amount", "date", "cash_acno", "reference"], required: ["amount", "date", "cash_acno"], tone: BRAND_BTN, hint: "Posts a receipt voucher: Dr the cash / bank account, Cr the employee's advance / loan account." },
  skip: { title: "Skip / un-skip a month", fields: ["month", "note"], required: ["month"], tone: BRAND_BTN },
  reschedule: { title: "Reschedule", fields: ["installment", "start_month", "note"], required: ["installment", "note"], tone: BRAND_BTN },
  disburse: { title: "Pay out", fields: ["date", "cash_acno", "reference"], required: ["date", "cash_acno"], tone: BRAND_BTN, hint: "Posts a payment voucher: Dr the employee's advance / loan account, Cr the cash / bank account. Payroll starts recovering it after this." },
  reverse_payout: { title: "Reverse the pay-out", fields: ["date", "note"], required: ["date", "note"], tone: "bg-red-600 hover:bg-red-700 text-white", hint: "Posts a journal voucher that mirrors the payment voucher. The original stays in the books." },
  reverse_repayment: { title: "Reverse a repayment", fields: ["date", "note"], required: ["date", "note"], tone: "bg-red-600 hover:bg-red-700 text-white", hint: "Posts a journal voucher that mirrors the receipt voucher. The amount is owed again." },
};
const LABELS = { note: "Note / reason", amount: "Amount (Rs)", date: "Date", reference: "Cheque / transfer reference", month: "Month", installment: "New monthly instalment", start_month: "Restart from (optional)", cash_acno: "Cash / bank account" };
const NEEDS_CASH = new Set(["repay", "disburse"]);

export default function LoanDetail({ loanId, onClose, meta }) {
  const qc = useQueryClient();
  const [act, setAct] = useState(null); // { action, values }
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["hr-loan", loanId], queryFn: () => api(`/api/hr/loans/${loanId}`), enabled: Boolean(loanId) });
  const l = data?.loan;
  const needsCash = Boolean(act && NEEDS_CASH.has(act.action));
  const cash = useQuery({ queryKey: ["hr-cash-accounts"], queryFn: () => api("/api/hr/cash-accounts"), enabled: needsCash, staleTime: 300_000 });

  const open = (action, extra = {}) => {
    const values = { note: "", amount: "", date: meta.today, reference: "", month: data.month, installment: l.installment, start_month: "", cash_acno: "", ...extra };
    if (action === "repay") values.amount = l.outstanding;
    setAct({ action, values });
  };
  const run = async () => {
    setBusy(true);
    try {
      const v = act.values;
      const r = await api(`/api/hr/loans/${loanId}`, {
        method: "POST",
        body: {
          action: act.action,
          ...v,
          amount: v.amount === "" ? undefined : Number(v.amount),
          installment: Number(v.installment),
          start_month: v.start_month || undefined,
          cash_acno: v.cash_acno ? Number(v.cash_acno) : undefined,
        },
      });
      toast.success(r.message);
      LOAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setAct(null);
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };
  const pct = l ? Math.min(100, (l.recovered / l.amount) * 100) : 0;
  const cashOptions = (cash.data?.accounts ?? []).map((a) => ({ value: String(a.acno), label: `${a.name} (${a.acno})` }));
  const form = act && FORMS[act.action];
  const missing = form && (form.required ?? []).some((k) => !String(act.values[k] ?? "").trim()) || (act?.action === "cancel" && l?.status === "active" && !act.values.note.trim());

  return (
    <Sheet open={Boolean(loanId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className={SHEET}>
        {isLoading || !l ? (
          <div className="mt-8 space-y-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex flex-wrap items-center gap-2 pr-6">
                {LOAN_KINDS[l.kind].label} <CodeChip className="text-sm">A-{l.id}</CodeChip> <LoanStatus status={l.status} />
              </SheetTitle>
              <SheetDescription>{l.employee.name} · #{l.employee.id}{l.employee.department ? ` · ${l.employee.department}` : ""} · applied by {l.requested_by} {fmtWhen(l.requested_at)}</SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-5">
              <div className="rounded-xl border border-border bg-background px-2 py-3">
                <Stepper steps={STEPS} {...stepOf(l, data.events)} />
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-3 gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3 sm:gap-3">
                  <Fig label="Amount" value={fmtMoney(l.amount)} className="[&>p:last-child]:text-base sm:[&>p:last-child]:text-lg" />
                  <Fig label="Recovered" value={fmtMoney(l.recovered)} tone="text-[#2f5139]" className="[&>p:last-child]:text-base sm:[&>p:last-child]:text-lg" />
                  <Fig label="Still owed" value={fmtMoney(l.outstanding)} tone="text-primary" className="[&>p:last-child]:text-base sm:[&>p:last-child]:text-lg" />
                </div>
                <div className="px-4 py-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Recovered" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {fmtMoney(l.installment)} a month from {l.start_month}
                  {l.due_this_month ? ` · ${fmtMoney(l.due_this_month)} due in ${data.month}` : ""}
                  {l.disbursed_on
                    ? ` · paid out ${l.disbursed_on}${l.disburse_tran_id ? ` (payment voucher #${l.disburse_tran_id})` : ""}${l.disbursement_ref ? ` · ${l.disbursement_ref}` : ""}`
                    : l.status === "active" ? " · not paid out yet — payroll does not recover it until it is" : ""}
                  {!l.disbursed_on && l.status === "active" && l.pay_with ? ` · with ${l.pay_with.names.join(" / ")} for payment` : ""}
                  {" · account "}{l.acno ?? "default"}
                </p>
                {l.reason && <p className="mt-2 text-sm text-foreground/90">“{l.reason}”</p>}
                {l.decision_note && <p className="mt-1 text-xs text-muted-foreground">Decision: {l.decision_note}</p>}
                </div>
              </div>

              {data.flags.length > 0 && (
                <div className="space-y-1 rounded-xl border border-[#5f4b1f]/25 bg-[#f5f0e6] p-3 text-sm text-[#5f4b1f]">
                  {data.flags.map((x) => <p key={x} className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{x}</p>)}
                </div>
              )}

              <div className="flex flex-wrap gap-2 max-sm:[&>button]:flex-1">
                {data.can.decide && (
                  <>
                    <Button size="sm" className="bg-[#2f5139] hover:bg-[#243f2c] text-white" onClick={() => open("approve")}><Check className="h-4 w-4 mr-1" />Approve</Button>
                    <Button size="sm" variant="outline" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => open("reject")}><X className="h-4 w-4 mr-1" />Reject</Button>
                  </>
                )}
                {data.can.disburse && <Button size="sm" className={BRAND_BTN} onClick={() => open("disburse")}><Send className="h-4 w-4 mr-1" />Pay out</Button>}
                {data.can.repay && <Button size="sm" variant="outline" onClick={() => open("repay")}><Banknote className="h-4 w-4 mr-1" />Receive repayment</Button>}
                {data.can.manage && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => open("skip")}><CalendarX className="h-4 w-4 mr-1" />Skip a month</Button>
                    <Button size="sm" variant="outline" onClick={() => open("reschedule")}><Repeat className="h-4 w-4 mr-1" />Reschedule</Button>
                  </>
                )}
                {data.can.reverse_payout && <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => open("reverse_payout")}><Undo2 className="h-4 w-4 mr-1" />Reverse pay-out</Button>}
                {data.can.cancel && <Button size="sm" variant="ghost" onClick={() => open("cancel")}><Ban className="h-4 w-4 mr-1" />Cancel</Button>}
              </div>

              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">Schedule</h3>
                <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className={cn(TH, "py-2 text-left")}>Month</th>
                        <th className={cn(TH, "py-2 text-right")}>Planned</th>
                        <th className={cn(TH, "py-2 text-right")}>Recovered</th>
                        <th className={cn(TH, "py-2 text-right")}>Left after</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 tabular-nums">
                      {data.schedule.map((r) => (
                        <tr key={r.month} className={cn(r.past && "text-muted-foreground", r.month === data.month && "bg-primary/5 font-semibold")}>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {r.month}
                            {r.month === data.month && <span className="ml-1.5 text-[10px] font-bold uppercase text-primary">now</span>}
                            {r.skipped && <Chip tone="warn" dot={false} className="ml-1.5 px-1.5 text-[10px]">Skipped</Chip>}
                          </td>
                          <td className="px-3 py-1.5 text-right">{r.planned == null ? "—" : fmtMoney(r.planned)}</td>
                          <td className="px-3 py-1.5 text-right text-[#2f5139]">{r.recovered ? fmtMoney(r.recovered) : "—"}</td>
                          <td className="px-3 py-1.5 text-right">{fmtMoney(r.balance)}</td>
                        </tr>
                      ))}
                      {!data.schedule.length && <tr><td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">{l.refundable === false ? "A provident fund withdrawal is not paid back." : "Nothing left to recover."}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              {data.recoveries.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">Repayments</h3>
                  <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border text-sm">
                    {data.recoveries.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0">
                          {r.date} · {r.source === "PAYROLL" ? `Payroll ${r.month}` : "Cash / bank"}{r.reference ? ` · ${r.reference}` : ""}
                          {r.tran_id && (
                            <CodeChip className="ml-1.5 inline-flex items-center gap-1"><Receipt className="h-3 w-3" />RV #{r.tran_id}</CodeChip>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums">{fmtMoney(r.amount)}</span>
                          {data.can.reverse_repayment && r.source === "CASH" && r.tran_id && (
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-700 hover:bg-red-50" onClick={() => open("reverse_repayment", { recovery_id: r.id })} title="Reverse this repayment" aria-label="Reverse this repayment">
                              <Undo2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                    <li className={cn(TFOOT, "flex items-center justify-between gap-2 border-t-0 px-3 py-2")}>
                      <span className="text-xs uppercase tracking-wide text-primary">Total recovered</span>
                      <span className="tabular-nums">{fmtMoney(data.recoveries.reduce((s, r) => s + (Number(r.amount) || 0), 0))}</span>
                    </li>
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">Timeline</h3>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {data.events.map((e) => (
                    <li key={e.id} className="text-sm">
                      <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                      <p className="font-medium capitalize text-foreground">{e.action}</p>
                      {e.detail && <p className="text-muted-foreground">{e.detail}</p>}
                      <p className="text-xs text-muted-foreground">{e.by ?? "system"} · {fmtWhen(e.at)}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </>
        )}

        <Dialog open={Boolean(act)} onOpenChange={(o) => !o && setAct(null)}>
          <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
            {act && (
              <>
                <DialogHeader className="text-left">
                  <DialogTitle className="pr-8">{form.title} — #A-{loanId}</DialogTitle>
                  <DialogDescription>{l?.employee.name} · owed {fmtMoney(l?.outstanding)}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  {form.fields.map((k) => (
                    <div key={k} className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">{LABELS[k]}{(form.required ?? []).includes(k) ? "" : " (optional)"}</Label>
                      {k === "cash_acno" ? (
                        // Inside a dialog: the menu stays in the dialog (fixed, not portalled to body).
                        <ReactSelect
                          aria-label={LABELS[k]}
                          options={cashOptions}
                          value={cashOptions.find((o) => o.value === String(act.values.cash_acno)) ?? null}
                          onChange={(o) => setAct({ ...act, values: { ...act.values, cash_acno: o ? o.value : "" } })}
                          isLoading={cash.isLoading}
                          placeholder={cash.isLoading ? "Loading…" : cashOptions.length ? "Choose…" : "No cash / bank account you may use"}
                          noOptionsMessage={() => "No cash / bank account you may use"}
                          menuPosition="fixed"
                          styles={selectStyles(false)}
                        />
                      ) : k === "note" ? (
                        <Textarea rows={3} value={act.values.note} onChange={(e) => setAct({ ...act, values: { ...act.values, note: e.target.value } })} />
                      ) : (
                        <Input
                          type={k === "date" ? "date" : k === "month" || k === "start_month" ? "month" : k === "reference" ? "text" : "number"}
                          value={act.values[k]}
                          onChange={(e) => setAct({ ...act, values: { ...act.values, [k]: e.target.value } })}
                        />
                      )}
                    </div>
                  ))}
                  {form.hint && <p className="rounded-md border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">{form.hint}</p>}
                  {act.action === "skip" && <p className="text-xs text-muted-foreground">Choosing a month already skipped puts it back. A skipped month moves to the end of the plan.</p>}
                </div>
                <DialogFooter className={DIALOG_FOOTER}>
                  <Button variant="ghost" onClick={() => setAct(null)}>Back</Button>
                  <Button className={form.tone} disabled={busy || missing} onClick={run}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Confirm</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
