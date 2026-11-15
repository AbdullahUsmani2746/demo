"use client";

// components/HR/payroll/PayslipSheet.jsx — one payslip: how it was worked out,
// and (on a draft) one-off adjustments, a different loan instalment, or hold.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, FileDown, UserMinus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN, NativeSelect } from "@/components/HR/shared";
import { downloadPayslips } from "@/components/HR/payroll/payslipPdf";
import { Chip, SHEET, SHEET_FOOTER } from "@/components/HR/payroll/ui";
import { LOAN_KINDS } from "@/lib/hr/loans/schedule";

export default function PayslipSheet({ runId, slip, canEdit, company, month, onClose, onChanged }) {
  const [adj, setAdj] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [hold, setHold] = useState(false);
  const [busy, setBusy] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (!slip) return;
    setAdj(slip.adjustments ?? []);
    setOverrides(Object.fromEntries(Object.entries(slip.loan_overrides ?? {}).map(([k, v]) => [k, String(v)])));
    setHold(slip.hold);
  }, [slip]);
  if (!slip) return null;
  const d = slip.data;

  const save = async () => {
    setBusy("save");
    try {
      await api(`/api/hr/payroll/${runId}/payslips/${slip.employee.id}`, {
        method: "PUT",
        body: { adjustments: adj.map((x) => ({ ...x, amount: Number(x.amount) })), loan_overrides: overrides, hold },
      });
      toast.success("Payslip recalculated.");
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("remove");
    try {
      const r = await api(`/api/hr/payroll/${runId}`, { method: "POST", body: { action: "remove", employee_id: slip.employee.id } });
      toast.success(r.message);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  };
  const pdf = async () => {
    try {
      await downloadPayslips({ company, month, slips: [slip], fileName: `payslip-${month}-${slip.employee.id}.pdf` });
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className={SHEET}>
        <SheetHeader className="pr-8 text-left">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="truncate">{slip.employee.name}</span>
            {slip.hold && <Chip tone="warn">On hold</Chip>}
          </SheetTitle>
          <SheetDescription>#{slip.employee.id}{slip.employee.designation ? ` · ${slip.employee.designation}` : ""}{slip.employee.department ? ` · ${slip.employee.department}` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
          {slip.warnings.length > 0 && (
            <div className="space-y-1 rounded-xl border border-[#5f4b1f]/25 bg-[#f5f0e6] p-3 text-sm text-[#5f4b1f]">
              {slip.warnings.map((w) => <p key={w} className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{w}</p>)}
            </div>
          )}

          <div className="rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] p-4 text-white shadow-md shadow-red-900/20 sm:p-5">
            <p className="text-xs uppercase tracking-wider opacity-80">Net pay</p>
            <p className="truncate text-2xl font-bold tabular-nums sm:text-3xl">Rs {fmtMoney(slip.net)}</p>
            <p className="text-xs tabular-nums opacity-80">earned {fmtMoney(slip.total_earnings)} − deducted {fmtMoney(slip.total_deductions)}{slip.hold ? " · ON HOLD" : ""}</p>
          </div>

          <Section title="Days">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-sm">
              {[["Paid", d.days.paid], ["Employed", d.days.employed], ["Present", d.days.present + d.days.late], ["Absent", d.days.absent], ["Leave", d.days.leave], ["Late cut", d.days.late_cut]].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-primary/10 bg-primary/5 py-2"><p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{l}</p><p className="font-semibold tabular-nums">{v}</p></div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              A day’s pay = monthly ÷ {d.days.divisor}. {d.days.unpaid ? `${d.days.unpaid} day(s) unpaid${d.days.unpaid_leave ? ` (incl. ${d.days.unpaid_leave} unpaid leave)` : ""}.` : "Nothing cut."}
              {!d.days.attendance && " No attendance recorded this month."}
            </p>
          </Section>

          <div className="grid sm:grid-cols-2 gap-4">
            <Section title="Earnings">
              <Rows rows={[
                ["Basic", d.basic, d.salary.basic],
                ...d.earnings.map((e) => [e.name, e.amount, e.full]),
                ...(d.overtime.amount ? [[`Overtime ${(d.overtime.minutes / 60).toFixed(1)} h × ${fmtMoney(d.overtime.hourly)} × ${d.overtime.rate_percent}%`, d.overtime.amount]] : []),
                ...d.adjustments.filter((x) => x.kind === "EARNING").map((x) => [`${x.label} (one-off)`, x.amount]),
              ]} total={slip.total_earnings} />
            </Section>
            <Section title="Deductions">
              <Rows rows={[
                ...d.deductions.map((x) => [x.name, x.amount]),
                ...(d.eobi.employee ? [["EOBI", d.eobi.employee]] : []),
                ...(d.pf?.employee ? [["Provident fund", d.pf.employee]] : []),
                ...(d.tax.month ? [["Income tax", d.tax.month]] : []),
                ...d.loans.map((l) => [`${LOAN_KINDS[l.kind]?.short ?? "Loan"} #A-${l.loan_id}${l.overridden ? " (changed)" : ""}`, l.amount, l.due]),
                ...d.adjustments.filter((x) => x.kind === "DEDUCTION").map((x) => [`${x.label} (one-off)`, x.amount]),
              ]} total={slip.total_deductions} />
            </Section>
          </div>

          {d.tax.taxable > 0 && (
            <Section title="Income tax">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Taxable this month {fmtMoney(d.tax.taxable)} · earlier this year {fmtMoney(d.tax.ytd_taxable)} (tax {fmtMoney(d.tax.ytd_tax)}) · projected for the year {fmtMoney(d.tax.projected)} → tax {fmtMoney(d.tax.annual)} ·
                ({fmtMoney(d.tax.annual)} − {fmtMoney(d.tax.ytd_tax)}) ÷ {d.tax.months_left} month(s) left = <b>{fmtMoney(d.tax.month)}</b>
              </p>
            </Section>
          )}
          {d.eobi.employer > 0 && <p className="text-xs text-muted-foreground">Employer pays EOBI {fmtMoney(d.eobi.employer)} on top (not deducted).</p>}
          {d.pf?.employer > 0 && <p className="text-xs text-muted-foreground">Employer adds {fmtMoney(d.pf.employer)} to the provident fund (not deducted).</p>}
          {d.gratuity?.provision ? <p className="text-xs text-muted-foreground">Gratuity provided this month {fmtMoney(d.gratuity.provision)} (liability {fmtMoney(d.gratuity.liability)} for {d.gratuity.years} year(s)).</p> : null}

          {canEdit && (
            <Section title="Changes for this month">
              <div className="space-y-2">
                {adj.map((x, i) => (
                  // Phones: a small card per line (type + amount, then the label); sm+: one row.
                  <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border p-2.5 sm:flex sm:flex-wrap sm:border-0 sm:p-0">
                    <NativeSelect value={x.kind} onChange={(e) => setAdj(adj.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y)))} className="w-full text-xs sm:h-8 sm:w-32" aria-label="Earning or deduction">
                      <option value="EARNING">+ Earning</option>
                      <option value="DEDUCTION">− Deduction</option>
                    </NativeSelect>
                    <Input type="number" min={0} value={x.amount} placeholder="Amount" aria-label="Amount" onChange={(e) => setAdj(adj.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} className="h-9 tabular-nums sm:order-3 sm:h-8 sm:w-28" />
                    <Input value={x.label} placeholder="e.g. Arrears, Bonus, Fine" aria-label="Label" onChange={(e) => setAdj(adj.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} className="col-span-2 h-9 sm:order-2 sm:h-8 sm:min-w-[140px] sm:flex-1" />
                    {x.kind === "EARNING" ? (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground sm:order-4"><Switch checked={x.taxable !== false} onCheckedChange={(v) => setAdj(adj.map((y, j) => (j === i ? { ...y, taxable: v } : y)))} />taxable</label>
                    ) : (
                      <span className="sm:hidden" />
                    )}
                    <Button size="icon" variant="ghost" className="h-9 w-9 justify-self-end text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:order-5 sm:h-8 sm:w-8" onClick={() => setAdj(adj.filter((_, j) => j !== i))} aria-label="Remove this line">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="h-9 w-full sm:w-auto" onClick={() => setAdj([...adj, { kind: "EARNING", label: "", amount: "", taxable: true }])}><Plus className="h-4 w-4 mr-1.5" />One-off earning / deduction</Button>
              </div>
              {d.loans.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">Loan / advance instalment this month</p>
                  {d.loans.map((l) => (
                    <div key={l.loan_id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 tabular-nums">#A-{l.loan_id} · due {fmtMoney(l.due)}</span>
                      <Input type="number" min={0} value={overrides[l.loan_id] ?? ""} placeholder={String(l.due)} aria-label={`Instalment for #A-${l.loan_id}`}
                        onChange={(e) => setOverrides({ ...overrides, [l.loan_id]: e.target.value })} className="h-9 w-28 shrink-0 tabular-nums sm:h-8 sm:w-32" />
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">Blank = the instalment due. 0 = recover nothing this month (it stays owed).</p>
                </div>
              )}
              <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm text-foreground/90">Hold salary <span className="block text-xs text-muted-foreground">Still posted as payable, but left out of the bank sheet</span></span>
                <Switch checked={hold} onCheckedChange={setHold} />
              </label>
            </Section>
          )}
        </div>
        {/* Sticks to the bottom of the panel while it scrolls. */}
        <div className={SHEET_FOOTER}>
          {canEdit && (
            <Button variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800 max-sm:w-full sm:mr-auto" onClick={() => setConfirmRemove(true)} disabled={Boolean(busy)}>
              {busy === "remove" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserMinus className="h-4 w-4 mr-1.5" />}Take out of this payroll
            </Button>
          )}
          <Button variant="outline" className="max-sm:flex-1" onClick={pdf}><FileDown className="h-4 w-4 mr-1.5" />Payslip PDF</Button>
          {canEdit && (
            <Button className={cn(BRAND_BTN, "max-sm:flex-1")} onClick={save} disabled={Boolean(busy)}>{busy === "save" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save &amp; recalculate</Button>
          )}
        </div>

        <AlertDialog open={confirmRemove} onOpenChange={(o) => !o && busy !== "remove" && setConfirmRemove(false)}>
          <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Take {slip.employee.name} out of this payroll?</AlertDialogTitle>
              <AlertDialogDescription>Their payslip is removed from this draft. They can be added again with “Add” while it is a draft.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy === "remove"}>Keep</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={busy === "remove"}
                onClick={(e) => {
                  e.preventDefault();
                  remove();
                }}
              >
                {busy === "remove" ? "Taking out…" : "Take out"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-background p-3.5 sm:p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-primary">{title}</h3>
      {children}
    </section>
  );
}

function Rows({ rows, total }) {
  return (
    <div className="space-y-1 text-sm">
      {rows.map(([label, amount, full], i) => (
        <div key={i} className="flex justify-between gap-3">
          <span className="min-w-0 break-words text-muted-foreground">{label}</span>
          <span className="shrink-0 tabular-nums text-right">
            {fmtMoney(amount)}
            {full !== undefined && full !== null && Math.abs(full - amount) > 0.004 && <span className={cn("block text-[10px] text-muted-foreground")}>of {fmtMoney(full)}</span>}
          </span>
        </div>
      ))}
      {!rows.length && <p className="text-muted-foreground">None</p>}
      <div className="mt-1 flex justify-between rounded-md border-t-2 border-primary/30 bg-primary/5 px-1.5 py-1 font-bold"><span className="text-xs uppercase tracking-wide text-primary">Total</span><span className="tabular-nums">{fmtMoney(total)}</span></div>
    </div>
  );
}
