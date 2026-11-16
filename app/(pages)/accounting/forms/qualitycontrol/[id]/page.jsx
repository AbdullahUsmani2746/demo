"use client";
// Quality Assurance → Production QC → the QC sheet of one process order.
// Results of the current attempt against each parameter's standard (pass /
// out-of-standard marked as you type), batch dates and remarks, then the
// decision: Pass (batch number given), Re-test (next attempt), On hold, Fail.
// Earlier attempts stay read-only. Ctrl+S saves; Enter moves to the next result.
// Server rules: lib/quality/productionQc.js via /api/forms/qualitycontrol/[id].
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ArrowLeft, CheckCircle2, ClipboardList, FlaskConical, History, Info, Loader2, PauseCircle, Printer, RotateCcw, Save, ScanLine, ShieldAlert, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, BRAND_BTN, CHIP, CODE_CHIP, EmptyState, HR_MAIN, HR_PAGE, PageHeader, PageLoading, Panel, TH, TH_ROW } from "@/components/HR/shared";
import { Fact, fmtDay, fmtQty, printProductionQc, QcStatusChip, ResultMark, resultTone } from "@/components/Quality/qcUi";
import { checkResult, NEEDS_REASON, QC_STATUS, sheetVerdict } from "@/lib/quality/qc";
import { usePermissions } from "@/hooks/usePermissions";
import { useFeatures } from "@/hooks/useFeatures";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";

const DECISIONS = {
  APPROVED: { label: "Pass", icon: CheckCircle2, className: "bg-[#2f5139] text-white hover:bg-[#25412d]" },
  REWORK: { label: "Re-test", icon: RotateCcw, className: "border-[#d9c79c] bg-[#f5f0e6] text-[#5f4b1f] hover:bg-[#ede4d0] dark:bg-amber-950/30 dark:text-amber-200" },
  HOLD: { label: "On hold", icon: PauseCircle, className: "border-border bg-background text-foreground hover:bg-muted" },
  REJECTED: { label: "Fail", icon: XCircle, className: "bg-red-700 text-white hover:bg-red-800" },
};

export default function QcSheetPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <QcSheet />
    </Suspense>
  );
}

function QcSheet() {
  const { id } = useParams();
  const sp = useSearchParams();
  const viewOnly = sp.get("mode") === "view";
  const qc = useQueryClient();
  const { data: session } = useSession();
  const { company } = useCompany();
  const { can } = usePermissions();
  const features = useFeatures();
  const canManage = can("qualityControl.manage");

  const { data: sheet, isLoading, error } = useQuery({
    queryKey: ["production-qc-sheet", id],
    queryFn: () => api(`/api/forms/qualitycontrol/${id}`),
  });

  const [values, setValues] = useState({});
  const [dates, setDates] = useState({ mfg_date: "", expiry_date: "" });
  const [remarks, setRemarks] = useState("");
  const [shownAttempt, setShownAttempt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null); // { status, reason, confirm?: string[] }
  const inputs = useRef([]);

  // Load the sheet into the form.
  useEffect(() => {
    if (!sheet) return;
    const cur = sheet.attempts.find((a) => a.attempt_no === sheet.current_attempt);
    setValues(Object.fromEntries((cur?.rows || []).map((r) => [r.parameter_name, r.quality_realized || ""])));
    setDates({ mfg_date: sheet.master.mfg_date || "", expiry_date: sheet.master.expiry_date || "" });
    setRemarks(sheet.master.remarks || "");
    setShownAttempt(sheet.current_attempt);
    setDirty(false);
  }, [sheet]);

  const editable = Boolean(sheet?.editable && canManage && !viewOnly);
  const current = sheet?.attempts.find((a) => a.attempt_no === sheet.current_attempt);
  const shown = sheet?.attempts.find((a) => a.attempt_no === shownAttempt) || current;
  const shownIsCurrent = shown?.attempt_no === sheet?.current_attempt;

  const liveRows = useMemo(
    () =>
      (shown?.rows || []).map((r) => {
        const v = shownIsCurrent ? values[r.parameter_name] ?? "" : r.quality_realized;
        return { ...r, quality_realized: v, check: checkResult(r.quality_standard, v) };
      }),
    [shown, shownIsCurrent, values],
  );
  const live = sheetVerdict(liveRows);

  const body = useCallback(
    () => ({
      parameters: (current?.rows || []).map((r) => ({ parameter_name: r.parameter_name, quality_realized: values[r.parameter_name] ?? "" })),
      mfg_date: dates.mfg_date || null,
      expiry_date: dates.expiry_date || null,
      remarks,
    }),
    [current, values, dates, remarks],
  );

  const post = async (payload, okMessage) => {
    setBusy(true);
    try {
      const res = await api(`/api/forms/qualitycontrol/${id}`, { method: "POST", body: payload });
      qc.setQueryData(["production-qc-sheet", id], res.sheet);
      qc.invalidateQueries({ queryKey: ["production-qc"] });
      toast.success(okMessage || res.message);
      return res;
    } catch (e) {
      if (e.data?.needsConfirm) {
        setDecision((d) => ({ ...(d || { status: "APPROVED", reason: "" }), confirm: e.data.failed || [] }));
      } else toast.error(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = useCallback(() => {
    if (!editable || busy) return;
    post(body());
  }, [editable, busy, body]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const decide = async () => {
    const d = decision;
    if (NEEDS_REASON.has(d.status) && !d.reason.trim()) {
      toast.error("Write the reason first.");
      return;
    }
    const payload = { ...(editable && dirty ? body() : {}), status: d.status, reason: d.reason.trim(), confirmFail: Boolean(d.confirm) };
    const res = await post(payload);
    if (res) setDecision(null);
  };

  const print = async () => {
    try {
      await printProductionQc(sheet, { company, userName: session?.user?.name });
    } catch (e) {
      toast.error(e.message || "Could not print");
    }
  };

  if (isLoading) return <PageLoading label="Loading QC sheet…" />;
  if (error || !sheet)
    return (
      <div className={HR_PAGE}>
        <main className={HR_MAIN}>
          <EmptyState icon={ShieldAlert} title="QC sheet not found" hint={error?.message} action={<Button asChild variant="outline"><Link href="/accounting/forms/qualitycontrol">Back to Production QC</Link></Button>} />
        </main>
      </div>
    );

  const m = sheet.master;
  const reasons = sheet.attempts.filter((a) => a.reject_reason);
  const gate = features.on("production.qcBeforeSend") && m.status !== "APPROVED" && !m.posted;

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={FlaskConical}
        breadcrumb={
          <Link href="/accounting/forms/qualitycontrol" className="inline-flex items-center gap-1 hover:text-primary">
            <ArrowLeft className="h-3 w-3" /> Production QC
          </Link>
        }
        title={`QC · Process order #${m.proc_ord_no}`}
        subtitle={[m.item_code, m.item_name].filter(Boolean).join(" · ")}
        actions={
          <>
            {(m.status === "APPROVED" || m.status === "REJECTED") && (
              <Button variant="outline" onClick={print}>
                <Printer className="h-4 w-4" /> {m.status === "REJECTED" ? "NCR" : "Certificate"}
              </Button>
            )}
            {editable && (
              <Button className={BRAND_BTN} onClick={save} disabled={busy || !dirty} title="Save (Ctrl+S)">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </Button>
            )}
          </>
        }
      />

      <main className={cn(HR_MAIN, "space-y-4")}>
        {/* Status strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-background px-4 py-3">
          <QcStatusChip status={m.status} className="text-sm" />
          <span className="text-[13px] text-muted-foreground">{QC_STATUS[m.status]?.hint}</span>
          {m.batch_no && (
            <span className="text-[13px]">
              Batch <span className="font-mono font-bold text-primary">{m.batch_no}</span>
            </span>
          )}
          {m.approved_by && <span className="text-[13px] text-muted-foreground">by {m.approved_by}</span>}
          {!editable && sheet.editable && !viewOnly && !canManage && (
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", CHIP.muted)}>Read only — needs QC rights</span>
          )}
        </div>

        {gate && (
          <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-[13px]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>This process order cannot be sent to production until QC passes it.</p>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            {/* Results */}
            <Panel
              title="Results"
              icon={ClipboardList}
              actions={
                sheet.attempts.length > 1 && (
                  <div className="flex flex-wrap gap-1" role="tablist" aria-label="Attempts">
                    {sheet.attempts.map((a) => (
                      <button
                        key={a.attempt_no}
                        type="button"
                        role="tab"
                        aria-selected={a.attempt_no === shown?.attempt_no}
                        onClick={() => setShownAttempt(a.attempt_no)}
                        className={cn(
                          "h-8 rounded-md border px-2.5 text-xs font-semibold",
                          a.attempt_no === shown?.attempt_no ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Attempt {a.attempt_no}
                        {a.attempt_no === sheet.current_attempt && " · current"}
                      </button>
                    ))}
                  </div>
                )
              }
            >
              {liveRows.length === 0 ? (
                <EmptyState
                  icon={Info}
                  title="This item has no quality parameters"
                  hint="Add its parameters and standards on the item (Setup → Items → Quality). QC can still pass or fail the batch."
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/70 px-4 py-2 text-xs text-muted-foreground sm:px-5">
                    <span>
                      Attempt <b className="text-foreground">{shown?.attempt_no}</b>
                      {shown?.attempt_date && ` · ${fmtDay(shown.attempt_date)}`}
                    </span>
                    <span className="tabular-nums">
                      <b className="text-foreground">{live.filled}</b> of {live.total} entered
                    </span>
                    {live.failed > 0 && <span className="font-semibold text-red-700 dark:text-red-400">{live.failed} out of standard</span>}
                    {live.verdict === "pass" && <span className="font-semibold text-[#2f5139] dark:text-emerald-400">All within standard</span>}
                    {!shownIsCurrent && <span className={cn("rounded px-1.5 py-0.5", CHIP.muted)}>Earlier attempt — read only</span>}
                  </div>
                  {/* Table from md */}
                  <table className="hidden w-full text-sm md:table">
                    <thead>
                      <tr className={TH_ROW}>
                        <th className={cn(TH, "w-[32%]")}>Parameter</th>
                        <th className={TH}>Standard</th>
                        <th className={cn(TH, "w-[26%]")}>Result</th>
                        <th className={TH}>Check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {liveRows.map((r, i) => (
                        <tr key={r.parameter_name} className={cn(r.check === "fail" && "bg-red-50/50 dark:bg-red-950/10")}>
                          <td className="px-3 py-2 font-semibold">{r.parameter_name}</td>
                          <td className="px-3 py-2 font-mono text-[13px] text-muted-foreground">{r.quality_standard || "—"}</td>
                          <td className="px-3 py-1.5">
                            {editable && shownIsCurrent ? (
                              <ResultInput r={r} i={i} inputs={inputs} onChange={(v) => { setValues((s) => ({ ...s, [r.parameter_name]: v })); setDirty(true); }} />
                            ) : (
                              <span className="font-mono tabular-nums">{r.quality_realized || "—"}</span>
                            )}
                          </td>
                          <td className="px-3 py-2"><ResultMark check={r.check} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* Cards under md */}
                  <div className="divide-y divide-border/70 md:hidden">
                    {liveRows.map((r, i) => (
                      <div key={r.parameter_name} className={cn("px-4 py-3", r.check === "fail" && "bg-red-50/50 dark:bg-red-950/10")}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold">{r.parameter_name}</p>
                          <ResultMark check={r.check} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Standard <span className="font-mono">{r.quality_standard || "—"}</span>
                        </p>
                        <div className="mt-2">
                          {editable && shownIsCurrent ? (
                            <ResultInput r={r} i={i + 100} inputs={inputs} onChange={(v) => { setValues((s) => ({ ...s, [r.parameter_name]: v })); setDirty(true); }} />
                          ) : (
                            <p className="font-mono">{r.quality_realized || "—"}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>

            {/* Decision */}
            {sheet.allowed.length > 0 && canManage && !viewOnly && (
              <Panel title="Decision" icon={CheckCircle2} bodyClassName="p-4 sm:p-5">
                <p className="mb-3 text-[13px] text-muted-foreground">
                  {m.status === "REJECTED"
                    ? "A failed batch can only be sent for re-test (rework, then a new attempt)."
                    : "Pass gives the batch its number and is final. Re-test, On hold and Fail need a reason."}
                  {dirty && " Unsaved results are saved with the decision."}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {sheet.allowed.map((s) => {
                    const D = DECISIONS[s];
                    const Icon = D.icon;
                    return (
                      <Button key={s} variant="outline" className={cn("h-10 border", D.className)} disabled={busy} onClick={() => setDecision({ status: s, reason: "" })}>
                        <Icon className="h-4 w-4" /> {D.label}
                      </Button>
                    );
                  })}
                </div>
              </Panel>
            )}
          </div>

          {/* Side column */}
          <div className="min-w-0 space-y-4">
            <Panel title="Batch" icon={FlaskConical} bodyClassName="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
              <Fact label="Process order">
                <Link href={`/accounting/material?tab=production&search=${m.proc_ord_no}`} className={cn(CODE_CHIP, "hover:underline")}>#{m.proc_ord_no}</Link>
              </Fact>
              <Fact label="Order status">{m.plan_status}</Fact>
              <Fact label="Plan date">{fmtDay(m.plan_date)}</Fact>
              <Fact label="Batch size" mono>{fmtQty(m.batch_size)}</Fact>
              <Fact label="Batch no" mono>{m.batch_no}</Fact>
              <Fact label="QC barcode" mono>{m.qc_barcode}</Fact>
              <div className="col-span-2">
                <Fact label="Customer">{m.customer_name}{m.sale_ord_no ? ` · SO ${m.sale_ord_no}` : ""}</Fact>
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-3 border-t border-border/70 pt-3">
                <label className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Mfg date</span>
                  <Input type="date" value={dates.mfg_date} disabled={!editable} onChange={(e) => { setDates((d) => ({ ...d, mfg_date: e.target.value })); setDirty(true); }} className="h-9" />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Expiry date</span>
                  <Input type="date" value={dates.expiry_date} disabled={!editable} onChange={(e) => { setDates((d) => ({ ...d, expiry_date: e.target.value })); setDirty(true); }} className="h-9" />
                </label>
              </div>
              <label className="col-span-2 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Remarks</span>
                <Textarea value={remarks} maxLength={255} disabled={!editable} rows={2} onChange={(e) => { setRemarks(e.target.value); setDirty(true); }} placeholder="Notes for this batch" />
              </label>
            </Panel>

            <Panel title="History" icon={History} bodyClassName="p-4">
              {reasons.length === 0 && sheet.scans.length === 0 ? (
                <p className="text-sm text-muted-foreground">No decisions or scans yet.</p>
              ) : (
                <ol className="space-y-3 text-sm">
                  {reasons.map((a) => (
                    <li key={`r${a.attempt_no}`} className="flex gap-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#8a6a1f]" />
                      <div className="min-w-0">
                        <p className="font-semibold">Attempt {a.attempt_no}{a.attempt_date && <span className="font-normal text-muted-foreground"> · {fmtDay(a.attempt_date)}</span>}</p>
                        <p className="text-[13px] text-muted-foreground">{a.reject_reason}</p>
                      </div>
                    </li>
                  ))}
                  {sheet.scans.map((s, i) => (
                    <li key={`s${i}`} className="flex gap-2.5">
                      <ScanLine className={cn("mt-0.5 h-4 w-4 shrink-0", s.is_late ? "text-red-600" : "text-muted-foreground")} />
                      <div className="min-w-0">
                        <p className="font-semibold">{s.stage}{s.is_late && <span className="ml-1.5 text-xs font-normal text-red-600">late</span>}</p>
                        <p className="text-[12px] text-muted-foreground">{new Date(s.scanned_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{s.scanned_by && ` · ${s.scanned_by}`}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>
        </div>
      </main>

      <Dialog open={Boolean(decision)} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto">
          {decision && (
            <>
              <DialogHeader>
                <DialogTitle>{DECISIONS[decision.status]?.label} batch — process order #{m.proc_ord_no}</DialogTitle>
                <DialogDescription>
                  {decision.status === "APPROVED"
                    ? "The batch gets its number and the QC is closed."
                    : decision.status === "REWORK"
                      ? "Results so far stay as this attempt; the re-test is entered as the next attempt."
                      : decision.status === "HOLD"
                        ? "QC waits; testing can continue later."
                        : "The batch is rejected. It can later be sent for re-test."}
                </DialogDescription>
              </DialogHeader>
              {decision.confirm && (
                <div className={cn("rounded-lg px-3 py-2 text-[13px]", CHIP.bad)}>
                  <p className="font-semibold">Out of standard:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {decision.confirm.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                  <p className="mt-1">Pass it anyway?</p>
                </div>
              )}
              {decision.status === "APPROVED" && !decision.confirm && live.failed > 0 && (
                <p className={cn("rounded-lg px-3 py-2 text-[13px]", CHIP.warn)}>{live.failed} result(s) are out of standard.</p>
              )}
              {NEEDS_REASON.has(decision.status) && (
                <label className="space-y-1">
                  <span className="text-sm font-medium">Reason</span>
                  <Textarea autoFocus rows={3} maxLength={255} value={decision.reason} onChange={(e) => setDecision((d) => ({ ...d, reason: e.target.value }))} placeholder="Why?" />
                </label>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
                <Button className={cn("border", DECISIONS[decision.status]?.className)} onClick={decide} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {decision.confirm ? "Pass anyway" : DECISIONS[decision.status]?.label}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One result box: Enter / ↓ moves to the next, ↑ to the previous. */
function ResultInput({ r, i, inputs, onChange }) {
  const move = (e, step) => {
    const list = inputs.current.filter(Boolean).filter((el) => el.offsetParent !== null);
    const at = list.indexOf(e.currentTarget);
    const next = list[at + step];
    if (next) {
      e.preventDefault();
      next.focus();
      next.select();
    }
  };
  return (
    <Input
      ref={(el) => (inputs.current[i] = el)}
      value={r.quality_realized}
      maxLength={50}
      inputMode={/\d/.test(r.quality_standard || "") ? "decimal" : "text"}
      aria-label={`${r.parameter_name} result`}
      placeholder={r.quality_standard ? `e.g. ${r.quality_standard}` : "Result"}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "ArrowDown") move(e, 1);
        if (e.key === "ArrowUp") move(e, -1);
      }}
      className={cn("h-9 font-mono", resultTone(r.check))}
    />
  );
}
