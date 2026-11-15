"use client";

// HR → Payroll → one run: payslips, adjustments, approval, posting, paying.
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, RefreshCw, Send, Undo2, Check, X, BookCheck, RotateCcw, Trash2, UserPlus, FileSpreadsheet, FileDown, Landmark,
  AlertTriangle, Loader2, Search, PauseCircle, ScrollText, ShieldAlert, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN, EmployeeCell, NoAccess, useHrMeta } from "@/components/HR/shared";
import { RunStatus } from "@/components/HR/payroll/RunsTab";
import PayslipSheet from "@/components/HR/payroll/PayslipSheet";
import { downloadPayslips } from "@/components/HR/payroll/payslipPdf";
import PaymentsPanel, { PayDialog } from "@/components/HR/payroll/PaymentsPanel";
import { BankFilesDialog } from "@/components/HR/payroll/BankFiles";
import { useFeatures } from "@/hooks/useFeatures";
import { Card, Chip, CodeChip, DIALOG, DIALOG_FOOTER, MAIN, PAGE, PageSkeleton, SCROLL, Stepper, TFOOT, TH, TH_STICKY, TR } from "@/components/HR/payroll/ui";

// The run's life cycle on the stepper: prepared → sent → approved → posted → paid.
const STEPS = [
  { key: "DRAFT", label: "Prepared" },
  { key: "PENDING", label: "Sent for approval" },
  { key: "APPROVED", label: "Approved" },
  { key: "POSTED", label: "Posted" },
  { key: "PAID", label: "Paid" },
];
function stepOf(run, fullyPaid) {
  if (run.status === "REVERSED") return { done: 3, stopped: "Reversed" };
  if (fullyPaid) return { done: 4 };
  return { done: Math.max(0, STEPS.findIndex((s) => s.key === run.status)) };
}

const ACTIONS = {
  recalculate: { title: "Recalculate every payslip", body: "Attendance, salaries, loans and rules are read again. Adjustments, instalment changes and holds you entered stay.", verb: "Recalculate" },
  add: { title: "Add employees", body: "Everyone employed this month in your departments who is not yet in a payroll of this month is added and calculated.", verb: "Add them" },
  submit: { title: "Send for approval", body: "The payroll is locked while it waits; payroll approvers are notified.", verb: "Send", note: "optional" },
  withdraw: { title: "Withdraw from approval", body: "It becomes a draft again so it can be changed.", verb: "Withdraw" },
  approve: { title: "Approve payroll", body: "It can then be posted to accounts.", verb: "Approve", note: "optional", tone: "bg-[#2f5139] hover:bg-[#243f2c] text-white" },
  reject: { title: "Reject payroll", body: "It goes back to draft with your reason.", verb: "Reject", note: "required", tone: "bg-red-600 hover:bg-red-700 text-white" },
  post: { title: "Post to accounts", body: "The journal voucher is created, loan instalments are recorded and the month’s attendance is locked — all at once. Salaries are paid afterwards, from Salary payments.", verb: "Post" },
  reverse: { title: "Reverse posted payroll", body: "A mirror journal voucher is posted, loan recoveries are undone and the month’s attendance opens again. Salary payments must be reversed first.", verb: "Reverse", note: "required", tone: "bg-red-600 hover:bg-red-700 text-white" },
  delete: { title: "Delete this draft", body: "The draft and its payslips are removed. Nothing was posted.", verb: "Delete", tone: "bg-red-600 hover:bg-red-700 text-white" },
};

export default function RunPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const metaQ = useHrMeta();
  const { data, isLoading, error } = useQuery({ queryKey: ["hr-payroll-run", id], queryFn: () => api(`/api/hr/payroll/${id}`) });
  const [q, setQ] = useState("");
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [act, setAct] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [openSlip, setOpenSlip] = useState(null);
  // ?slip=<employee id> opens that payslip (drill from Pay history).
  const slipParam = Number(useSearchParams().get("slip")) || null;
  useEffect(() => {
    if (slipParam && data?.payslips?.some((p) => p.employee.id === slipParam)) setOpenSlip(slipParam);
  }, [slipParam, data]);
  const [journal, setJournal] = useState(false);
  const [paying, setPaying] = useState(false);
  const [bankFiles, setBankFiles] = useState(false);
  const features = useFeatures();

  const slips = useMemo(() => data?.payslips ?? [], [data]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return slips.filter((p) => (!onlyWarn || p.warnings.length) && (!s || p.employee.name.toLowerCase().includes(s) || String(p.employee.id) === s));
  }, [slips, q, onlyWarn]);
  const sums = useMemo(() => {
    const t = { tax: 0, eobi: 0, loans: 0, ot: 0, warn: 0, hold: 0 };
    for (const p of slips) {
      t.tax += p.data.tax.month;
      t.eobi += p.data.eobi.employee;
      t.loans += p.data.loans.reduce((s, l) => s + l.amount, 0);
      t.ot += p.data.overtime.amount;
      if (p.warnings.length) t.warn += 1;
      if (p.hold) t.hold += 1;
    }
    return t;
  }, [slips]);

  if (isLoading || metaQ.isLoading) return <PageSkeleton />;
  if (error) {
    return error.status === 403 ? <NoAccess /> : (
      <div className={PAGE}>
        <div className={MAIN}>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span className="font-medium text-destructive">Could not load this payroll: {error.message}</span>
            <Button variant="outline" size="sm" asChild><Link href="/accounting/hr/payroll">Back to payroll</Link></Button>
          </div>
        </div>
      </div>
    );
  }
  const { run, can, company } = data;
  const payments = data.payments;
  const paidBy = payments?.paid_by ?? {};
  const fullyPaid = run.status === "POSTED" && payments && payments.total > 0 && payments.unpaid <= 0;

  const run_ = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/hr/payroll/${id}`, { method: "POST", body: { action: act, note } });
      toast.success(r.message, { duration: 6000 });
      setAct(null);
      setNote("");
      if (act === "delete") return router.push("/accounting/hr/payroll");
      qc.invalidateQueries({ queryKey: ["hr-payroll-run", id] });
      qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
    } catch (e) {
      toast.error(e.message, { duration: 10000 });
    } finally {
      setBusy(false);
    }
  };

  const exportRegister = async () => {
    const XLSX = await import("xlsx");
    const head = ["Emp No", "Name", "Department", "Designation", "Paid days", "Employed days", "Gross salary", "Basic paid", "Allowances", "Overtime", "Other earnings", "Total earnings", "EOBI", "Income tax", "Loans / advances", "Other deductions", "Total deductions", "Net pay", "On hold"];
    const body = slips.map((p) => {
      const d = p.data;
      const adjE = d.adjustments.filter((x) => x.kind === "EARNING").reduce((s, x) => s + x.amount, 0);
      const other = d.deductions.reduce((s, x) => s + x.amount, 0) + d.adjustments.filter((x) => x.kind === "DEDUCTION").reduce((s, x) => s + x.amount, 0);
      return [p.employee.id, p.employee.name, p.employee.department ?? "", p.employee.designation ?? "", d.days.paid, d.days.employed, d.salary.gross, d.basic, d.earnings.reduce((s, e) => s + e.amount, 0), d.overtime.amount, adjE, p.total_earnings, d.eobi.employee, d.tax.month, d.loans.reduce((s, l) => s + l.amount, 0), other, p.total_deductions, p.net, p.hold ? "Yes" : ""];
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`Payroll register — ${run.label} (#P-${run.id}) — ${run.status}`], [], head, ...body]), "Register");
    XLSX.writeFile(wb, `payroll-register-${run.month}.xlsx`);
  };
  const exportBank = async () => {
    const XLSX = await import("xlsx");
    const rows = slips.filter((p) => !p.hold && p.net > 0);
    const head = ["Emp No", "Name", "Payment", "Bank", "Account no.", "Account title", "Net pay"];
    const body = rows.map((p) => [p.employee.id, p.employee.name, p.data.bank?.method ?? "", p.data.bank?.bank ?? "", p.data.bank?.account ?? "", p.data.bank?.title ?? p.employee.name, p.net]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body, [], ["", "", "", "", "", "Total", rows.reduce((s, p) => s + p.net, 0)]]), "Salary transfer");
    XLSX.writeFile(wb, `salary-transfer-${run.month}.xlsx`);
    if (sums.hold) toast.info(`${sums.hold} payslip(s) on hold were left out.`);
  };
  const exportPdf = async () => {
    try {
      await downloadPayslips({ company, month: run.month, slips: shown });
    } catch (e) {
      toast.error(`Could not make the PDF: ${e.message}`);
    }
  };

  const meta = ACTIONS[act];
  const stepState = stepOf(run, fullyPaid);
  const toPay = run.status === "POSTED" && payments && !fullyPaid && payments.total > 0 ? `${fmtMoney(payments.unpaid)} to pay` : null;
  const stepsShown = STEPS.map((s) => (s.key === "PAID" && toPay ? { ...s, hint: toPay } : s));
  // Totals of the payslips shown (display only).
  const tot = shown.reduce(
    (t, p) => {
      const d = p.data;
      t.gross += d.salary.gross;
      t.earned += p.total_earnings;
      t.ot += d.overtime.amount;
      t.eobi += d.eobi.employee;
      t.tax += d.tax.month;
      t.loans += d.loans.reduce((s, l) => s + l.amount, 0);
      t.ded += p.total_deductions;
      t.net += p.net;
      return t;
    },
    { gross: 0, earned: 0, ot: 0, eobi: 0, tax: 0, loans: 0, ded: 0, net: 0 },
  );
  return (
    <div className={PAGE}>
      <div className={cn(MAIN, "space-y-4")}>
        {/* Header */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <Wallet className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <Link href="/accounting/hr/payroll" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-primary">
                <ArrowLeft className="h-3.5 w-3.5" />HR · Payroll
              </Link>
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {run.title || `Payroll ${run.label}`}
                <RunStatus status={run.status} />
              </h1>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                <CodeChip>P-{run.id}</CodeChip>
                <span>pay date {run.pay_date}{run.jv_tran_id ? ` · journal voucher #${run.jv_tran_id}` : ""} · created by {run.created_by}</span>
              </p>
            </div>
          </div>
          {/* Phones: the actions wrap into equal rows under the title. */}
          <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1 lg:ml-auto lg:justify-end">
            {can.edit && <Button variant="outline" size="sm" className="h-9 bg-background" onClick={() => setAct("add")}><UserPlus className="h-4 w-4 mr-1.5" />Add</Button>}
            {can.edit && <Button variant="outline" size="sm" className="h-9 bg-background" onClick={() => setAct("recalculate")}><RefreshCw className="h-4 w-4 mr-1.5" />Recalculate</Button>}
            {can.submit && <Button size="sm" className={cn(BRAND_BTN, "h-9")} onClick={() => setAct("submit")}><Send className="h-4 w-4 mr-1.5" />Send for approval</Button>}
            {can.withdraw && <Button variant="outline" size="sm" className="h-9 bg-background" onClick={() => setAct("withdraw")}><Undo2 className="h-4 w-4 mr-1.5" />Withdraw</Button>}
            {can.decide && <Button size="sm" className="h-9 bg-[#2f5139] hover:bg-[#243f2c] text-white" onClick={() => setAct("approve")}><Check className="h-4 w-4 mr-1.5" />Approve</Button>}
            {can.decide && <Button size="sm" variant="outline" className="h-9 bg-background text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setAct("reject")}><X className="h-4 w-4 mr-1.5" />Reject</Button>}
            {can.post && <Button size="sm" className={cn(BRAND_BTN, "h-9")} disabled={Boolean(can.post_blocked)} title={can.post_blocked ?? ""} onClick={() => setAct("post")}><BookCheck className="h-4 w-4 mr-1.5" />Post to accounts</Button>}
            {can.pay && <Button size="sm" className={cn(BRAND_BTN, "h-9")} onClick={() => setPaying(true)}><Landmark className="h-4 w-4 mr-1.5" />Pay salaries</Button>}
            {can.reverse && <Button size="sm" variant="outline" className="h-9 bg-background text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setAct("reverse")}><RotateCcw className="h-4 w-4 mr-1.5" />Reverse</Button>}
            <Button variant="outline" size="sm" className="h-9 bg-background" onClick={() => setJournal(true)}><ScrollText className="h-4 w-4 mr-1.5" />Journal</Button>
            {can.delete && (
              <Button variant="outline" size="sm" className="h-9 bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setAct("delete")} title="Delete this draft" aria-label="Delete this draft">
                <Trash2 className="h-4 w-4" /><span className="sm:sr-only">Delete</span>
              </Button>
            )}
          </div>
        </div>

        {/* Where the run stands */}
        <div className="rounded-xl border border-border bg-background px-2 py-3 sm:px-4">
          <Stepper steps={stepsShown} done={stepState.done} stopped={stepState.stopped} />
          {run.status === "REVERSED" && run.reversed_by && <p className="mt-1 text-center text-xs text-red-800">Reversed by {run.reversed_by}</p>}
        </div>

        {run.decision_note && run.status === "DRAFT" && (
          <Banner tone="red" icon={X}>Sent back: {run.decision_note}{run.decided_by ? ` — ${run.decided_by}` : ""}</Banner>
        )}
        {can.self_block && run.status === "PENDING" && <Banner tone="amber" icon={ShieldAlert}>{can.self_block}</Banner>}
        {can.post_blocked && <Banner tone="amber" icon={AlertTriangle}>{can.post_blocked} Posting locks the month’s attendance, so it waits for the month to end.</Banner>}
        {run.status === "REVERSED" && <Banner tone="red" icon={RotateCcw}>Reversed on {new Date(run.reversed_at).toLocaleString("en-GB")}: {run.reverse_reason}</Banner>}
        {run.notes && <Banner tone="slate" icon={ScrollText}>{run.notes}</Banner>}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Employees" value={run.employees} />
          <Kpi label="Earnings" value={fmtMoney(run.total_earnings)} />
          <Kpi label="Overtime" value={fmtMoney(sums.ot)} />
          <Kpi label="Income tax" value={fmtMoney(sums.tax)} />
          <Kpi label="EOBI (employee)" value={fmtMoney(sums.eobi)} hint={`+ ${fmtMoney(run.total_employer)} employer`} />
          <Kpi label="Loans recovered" value={fmtMoney(sums.loans)} />
          <Kpi label="Net pay" value={fmtMoney(run.total_net)} strong />
        </section>

        {payments && (
          <PaymentsPanel
            runId={id}
            payments={payments}
            canPay={can.pay}
            canReverse={can.reverse_payment}
            onPay={() => setPaying(true)}
            today={metaQ.data?.today}
          />
        )}

        <Card
          title="Payslips"
          icon={FileSpreadsheet}
          description={`${shown.length} of ${slips.length} shown · click one for how it was worked out`}
          bodyClassName="divide-y divide-border/60"
        >
          {/* Search, warnings filter and downloads */}
          <div className="flex flex-wrap items-center gap-2 p-3">
            <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 md:max-w-xs">
              <Search className="h-4 w-4 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or employee no." aria-label="Search payslips" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" />
              {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="hover:text-foreground"><X className="h-4 w-4" /></button>}
            </label>
            <button
              type="button"
              onClick={() => setOnlyWarn(!onlyWarn)}
              disabled={!sums.warn}
              aria-pressed={onlyWarn}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm", onlyWarn ? "border-[#5f4b1f]/25 bg-[#f5f0e6] font-semibold text-[#5f4b1f]" : "border-border text-muted-foreground hover:border-primary/40", !sums.warn && "opacity-50")}
            >
              <AlertTriangle className="h-4 w-4" />{sums.warn} with warnings
            </button>
            <div className="flex w-full flex-wrap gap-2 max-sm:[&>*]:flex-1 md:ml-auto md:w-auto">
              <Button variant="outline" size="sm" className="h-9" onClick={exportRegister}><FileSpreadsheet className="h-4 w-4 mr-1.5" />Register</Button>
              <Button variant="outline" size="sm" className="h-9" onClick={exportBank}><Landmark className="h-4 w-4 mr-1.5" />Bank sheet</Button>
              {features.on("hr.bankDisbursement") && metaQ.data?.rights?.bankFile && ["APPROVED", "POSTED"].includes(run.status) && (
                <Button variant="outline" size="sm" className="h-9" onClick={() => setBankFiles(true)}><Landmark className="h-4 w-4 mr-1.5" />Bank files</Button>
              )}
              <Button variant="outline" size="sm" className="h-9" onClick={exportPdf} disabled={!shown.length}><FileDown className="h-4 w-4 mr-1.5" />Payslips PDF</Button>
            </div>
          </div>

          {/* Phone: one card per payslip */}
          <ul className="divide-y divide-border/60 md:hidden">
            {shown.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpenSlip(p.employee.id)} className="w-full px-3 py-3 text-left active:bg-primary/[0.05]">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1"><EmployeeCell employee={p.employee} compact /></div>
                    {p.warnings.length > 0 && <AlertTriangle className="h-4 w-4 shrink-0 text-[#5f4b1f]" aria-label="Has warnings" />}
                    {p.hold && <PauseCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="On hold" />}
                    {paidBy[p.employee.id] && <Chip tone="ok" className="px-2 text-[10px]">Paid</Chip>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><p className="text-muted-foreground">Days</p><p className="font-semibold tabular-nums">{p.data.days.paid}/{p.data.days.employed}</p></div>
                    <div><p className="text-muted-foreground">Deductions</p><p className="font-semibold tabular-nums text-red-800">{fmtMoney(p.total_deductions)}</p></div>
                    <div className="text-right"><p className="text-muted-foreground">Net pay</p><p className="font-bold tabular-nums text-primary">{fmtMoney(p.net)}</p></div>
                  </div>
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-4 py-10 text-center text-sm text-muted-foreground">Nobody here{q || onlyWarn ? " — change the search or the filter." : "."}</li>}
            {shown.length > 1 && (
              <li className="flex items-center justify-between bg-primary/5 px-3 py-2.5 text-sm font-bold">
                <span className="text-xs uppercase tracking-wide text-primary">Net pay · {shown.length}</span>
                <span className="tabular-nums text-primary">{fmtMoney(tot.net)}</span>
              </li>
            )}
          </ul>

          {/* Tablet & up: table */}
          <div className={cn("hidden md:block", SCROLL)}>
            <table className="w-full text-sm">
              <thead className={TH_STICKY}>
                <tr className="text-left">
                  <th className={cn(TH, "px-4")}>Employee</th>
                  <th className={cn(TH, "text-right")}>Paid days</th>
                  <th className={cn(TH, "text-right")}>Gross</th>
                  <th className={cn(TH, "text-right")}>Earned</th>
                  <th className={cn(TH, "text-right")}>OT</th>
                  <th className={cn(TH, "text-right")}>EOBI</th>
                  <th className={cn(TH, "text-right")}>Tax</th>
                  <th className={cn(TH, "text-right")}>Loans</th>
                  <th className={cn(TH, "text-right")}>Deductions</th>
                  <th className={cn(TH, "px-4 text-right")}>Net pay</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const d = p.data;
                  return (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      onClick={() => setOpenSlip(p.employee.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenSlip(p.employee.id))}
                      className={cn(TR, "cursor-pointer focus:bg-primary/[0.05] focus:outline-none")}
                    >
                      <td className="max-w-[280px] px-4 py-2">
                        <div className="flex items-center gap-2">
                          <EmployeeCell employee={p.employee} compact />
                          {p.warnings.length > 0 && <span title={p.warnings.join("\n")}><AlertTriangle className="h-4 w-4 shrink-0 text-[#5f4b1f]" /></span>}
                          {p.hold && <span title="Salary on hold"><PauseCircle className="h-4 w-4 shrink-0 text-muted-foreground" /></span>}
                          {paidBy[p.employee.id] && <Chip tone="ok" className="px-2 text-[10px]">Paid</Chip>}
                        </div>
                      </td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", d.days.paid < d.days.employed && "text-[#5f4b1f]")}>{d.days.paid}<span className="text-muted-foreground">/{d.days.employed}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(d.salary.gross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.total_earnings)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.overtime.amount ? fmtMoney(d.overtime.amount) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.eobi.employee ? fmtMoney(d.eobi.employee) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.tax.month ? fmtMoney(d.tax.month) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.loans.length ? fmtMoney(d.loans.reduce((s, l) => s + l.amount, 0)) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-800">{fmtMoney(p.total_deductions)}</td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums text-primary">{fmtMoney(p.net)}</td>
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">Nobody here{q || onlyWarn ? " — change the search or the filter." : "."}</td></tr>}
              </tbody>
              {shown.length > 1 && (
                <tfoot className="sticky bottom-0">
                  <tr className={TFOOT}>
                    <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-primary" colSpan={2}>Total · {shown.length}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtMoney(tot.gross)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(tot.earned)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(tot.ot)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(tot.eobi)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(tot.tax)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(tot.loans)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-800">{fmtMoney(tot.ded)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-primary">{fmtMoney(tot.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>

      <Dialog open={Boolean(act)} onOpenChange={(o) => !o && setAct(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          {meta && (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="pr-8">{meta.title}</DialogTitle>
                <DialogDescription>{meta.body}</DialogDescription>
              </DialogHeader>
              {act === "post" && (
                <p className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-sm">Net pay <b className="tabular-nums text-primary">{fmtMoney(run.total_net)}</b> for {run.employees} employee(s), dated {run.pay_date}. Check the journal first if you have not.</p>
              )}
              {meta.note && <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder={meta.note === "required" ? "Reason (required)" : "Note (optional)"} />}
              <DialogFooter className={DIALOG_FOOTER}>
                <Button variant="ghost" onClick={() => setAct(null)}>Back</Button>
                <Button className={meta.tone ?? BRAND_BTN} disabled={busy || (meta.note === "required" && !note.trim())} onClick={run_}>
                  {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{meta.verb}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <JournalDialog id={id} open={journal} onClose={() => setJournal(false)} />
      {bankFiles && <BankFilesDialog runId={id} open={bankFiles} onClose={() => setBankFiles(false)} />}
      {paying && payments && (
        <PayDialog open={paying} onClose={() => setPaying(false)} runId={id} run={run} slips={slips} paidBy={paidBy} today={metaQ.data?.today} />
      )}
      <PayslipSheet
        runId={id}
        slip={slips.find((p) => p.employee.id === openSlip) ?? null}
        canEdit={can.edit}
        company={company}
        month={run.month}
        onClose={() => setOpenSlip(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ["hr-payroll-run", id] })}
      />
    </div>
  );
}

function Kpi({ label, value, hint, strong }) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-background px-4 py-3", strong ? "border-primary/30 bg-primary/5" : "border-border")}>
      <p className="truncate text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-base font-bold tabular-nums sm:text-lg", strong ? "text-primary" : "text-foreground")}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Banner({ tone, icon: Icon, children }) {
  const tones = { red: "border-red-200 bg-red-50 text-red-800", amber: "border-[#5f4b1f]/25 bg-[#f5f0e6] text-[#5f4b1f]", slate: "border-border bg-background text-foreground/90" };
  return <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone])}><Icon className="h-4 w-4 mt-0.5 shrink-0" /><p className="min-w-0 break-words">{children}</p></div>;
}

function JournalDialog({ id, open, onClose }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["hr-payroll-journal", id], queryFn: () => api(`/api/hr/payroll/${id}/journal`), enabled: open });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-4xl")}>
        <DialogHeader className="text-left">
          <DialogTitle className="pr-8">{data?.posted ? `Journal voucher #${data.tran_id}` : "Journal voucher this payroll will post"}</DialogTitle>
          <DialogDescription>Accounts come from Finance → Account Settings → Payroll, pay components and each employee’s own advance / loan account.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : error ? <p className="text-red-800">{error.message}</p> : (
          <>
            {data.missing.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <p className="font-semibold">Cannot post until these are set:</p>
                <ul className="mt-1 list-disc pl-5">{data.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                <Link href="/accounting/settings/accounts" className="mt-2 inline-block font-medium underline">Open Account Settings</Link>
              </div>
            )}
            {/* Phones: the voucher scrolls sideways inside its box. */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left">
                    <th className={TH}>Account</th>
                    <th className={TH}>Cost centre</th>
                    <th className={TH}>Narration</th>
                    <th className={cn(TH, "text-right")}>Debit</th>
                    <th className={cn(TH, "text-right")}>Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5"><CodeChip>{l.acno}</CodeChip> {l.acname ?? "?"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{l.ccname ?? (l.ccno || "—")}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{l.narration1}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.damt ? fmtMoney(l.damt) : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.camt ? fmtMoney(l.camt) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={TFOOT}>
                    <td colSpan={3} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-primary">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(data.debit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(data.credit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
