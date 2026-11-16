"use client";
// Quality Assurance → Order QC → one receipt (?qc=<id>) of purchase order [id].
// Batch number / dates / remarks and the results against each standard, then
// Pass (posts the GRN for the received quantity) or Fail (with reason). Other
// receipts of the same order are listed on the side. Ctrl+S saves.
// Server rules: lib/quality/orderQc.js via /api/forms/orderqualitycontrol/[id].
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ClipboardList, ExternalLink, Info, Loader2, Package, PackageCheck, Save, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, BRAND_BTN, CHIP, CODE_CHIP, EmptyState, HR_MAIN, HR_PAGE, PageHeader, PageLoading, Panel, TH, TH_ROW } from "@/components/HR/shared";
import { Fact, fmtDay, fmtQty, QcStatusChip, ResultMark, resultTone } from "@/components/Quality/qcUi";
import { checkResult, sheetVerdict } from "@/lib/quality/qc";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

export default function OrderQcSheetPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <OrderQcSheet />
    </Suspense>
  );
}

function OrderQcSheet() {
  const { id: orderNo } = useParams();
  const sp = useSearchParams();
  const router = useRouter();
  const qcParam = sp.get("qc");
  const itcdParam = sp.get("itcd");
  const query = qcParam ? `qc=${qcParam}` : `itcd=${itcdParam || ""}`;
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManage = can("qualityControl.manage");
  const key = ["order-qc-sheet", orderNo, query];

  const { data: sheet, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api(`/api/forms/orderqualitycontrol/${orderNo}?${query}`) });

  const [values, setValues] = useState({});
  const [form, setForm] = useState({ batch_no: "", mfg_date: "", expiry_date: "", remarks: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  const inputs = useRef([]);

  useEffect(() => {
    if (!sheet) return;
    setValues(Object.fromEntries(sheet.rows.map((r) => [r.parameter_name, r.quality_realized || ""])));
    const m = sheet.master;
    setForm({ batch_no: m.batch_no ? String(m.batch_no) : "", mfg_date: m.mfg_date || "", expiry_date: m.expiry_date || "", remarks: m.remarks || "" });
    setDirty(false);
  }, [sheet]);

  const editable = Boolean(sheet?.editable && canManage);
  const rows = useMemo(
    () => (sheet?.rows || []).map((r) => ({ ...r, quality_realized: values[r.parameter_name] ?? "", check: checkResult(r.quality_standard, values[r.parameter_name]) })),
    [sheet, values],
  );
  const live = sheetVerdict(rows);
  const setF = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const body = useCallback(
    () => ({
      qc_id: sheet?.master.qc_id,
      parameters: rows.map((r) => ({ parameter_name: r.parameter_name, quality_realized: r.quality_realized })),
      batch_no: form.batch_no,
      mfg_date: form.mfg_date || null,
      expiry_date: form.expiry_date || null,
      remarks: form.remarks,
    }),
    [sheet, rows, form],
  );

  const post = async (payload) => {
    setBusy(true);
    try {
      const res = await api(`/api/forms/orderqualitycontrol/${orderNo}`, { method: "POST", body: payload });
      qc.setQueryData(key, res.sheet);
      qc.invalidateQueries({ queryKey: ["order-qc"] });
      toast.success(res.message);
      setDirty(false);
      return res;
    } catch (e) {
      if (e.data?.needsConfirm) setDecision((d) => ({ ...(d || { status: "APPROVED", reason: "" }), confirm: e.data.failed || [] }));
      else toast.error(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = useCallback(() => {
    if (editable && !busy) post(body());
  }, [editable, busy, body]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (decision.status === "REJECTED" && !decision.reason.trim()) {
      toast.error("Write the reason first.");
      return;
    }
    // Unsaved results / batch go first, then the decision.
    if (dirty && !(await post(body()))) return;
    const res = await post({ qc_id: sheet.master.qc_id, status: decision.status, reason: decision.reason.trim(), confirmFail: Boolean(decision.confirm) });
    if (res) setDecision(null);
  };

  if (isLoading) return <PageLoading label="Loading receipt…" />;
  if (error || !sheet)
    return (
      <div className={HR_PAGE}>
        <main className={HR_MAIN}>
          <EmptyState icon={ShieldAlert} title="Receipt not found" hint={error?.message} action={<Button asChild variant="outline"><Link href="/accounting/forms/orderqualitycontrol">Back to Order QC</Link></Button>} />
        </main>
      </div>
    );

  const m = sheet.master;
  const grnLink = m.grn_tran_id ? voucherHref({ tran_code: 4, tran_id: m.grn_tran_id }) : null;

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={PackageCheck}
        breadcrumb={
          <Link href="/accounting/forms/orderqualitycontrol" className="inline-flex items-center gap-1 hover:text-primary">
            <ArrowLeft className="h-3 w-3" /> Order QC
          </Link>
        }
        title={`Receipt R-${m.qc_id} · PO ${m.order_no}`}
        subtitle={[m.item_code, m.item_name, m.vendor_name].filter(Boolean).join(" · ")}
        actions={
          editable && (
            <Button className={BRAND_BTN} onClick={save} disabled={busy || !dirty} title="Save (Ctrl+S)">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
          )
        }
      />
      <main className={cn(HR_MAIN, "space-y-4")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-background px-4 py-3">
          <QcStatusChip status={m.status} className="text-sm" />
          {m.status === "APPROVED" && (
            <span className="text-[13px]">
              GRN{" "}
              {grnLink ? (
                <Link href={grnLink} className="inline-flex items-center gap-1 font-mono font-bold text-primary hover:underline">
                  #{m.grn_no} <ExternalLink className="h-3 w-3" />
                </Link>
              ) : (
                <span className="font-mono">{m.grn_no ? `#${m.grn_no}` : "not posted"}</span>
              )}
              {m.approved_by && <span className="text-muted-foreground"> · passed by {m.approved_by}</span>}
            </span>
          )}
          {m.status === "REJECTED" && m.reject_reason && <span className="text-[13px] text-red-700 dark:text-red-400">{m.reject_reason}</span>}
          {sheet.editable && !canManage && <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", CHIP.muted)}>Read only — needs QC rights</span>}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <Panel title="Results" icon={ClipboardList}>
              {rows.length === 0 ? (
                <EmptyState icon={Info} title="This item has no quality parameters" hint="QC can still pass or fail the receipt." />
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border/70 px-4 py-2 text-xs text-muted-foreground sm:px-5">
                    <span className="tabular-nums"><b className="text-foreground">{live.filled}</b> of {live.total} entered</span>
                    {live.failed > 0 && <span className="font-semibold text-red-700 dark:text-red-400">{live.failed} out of standard</span>}
                    {live.verdict === "pass" && <span className="font-semibold text-[#2f5139] dark:text-emerald-400">All within standard</span>}
                    {m.tested_on && <span>Tested {fmtDay(m.tested_on)}</span>}
                  </div>
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
                      {rows.map((r, i) => (
                        <tr key={r.parameter_name} className={cn(r.check === "fail" && "bg-red-50/50 dark:bg-red-950/10")}>
                          <td className="px-3 py-2 font-semibold">{r.parameter_name}</td>
                          <td className="px-3 py-2 font-mono text-[13px] text-muted-foreground">{r.quality_standard || "—"}</td>
                          <td className="px-3 py-1.5">
                            {editable ? (
                              <ResultInput r={r} i={i} inputs={inputs} onChange={(v) => { setValues((s) => ({ ...s, [r.parameter_name]: v })); setDirty(true); }} />
                            ) : (
                              <span className="font-mono">{r.quality_realized || "—"}</span>
                            )}
                          </td>
                          <td className="px-3 py-2"><ResultMark check={r.check} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="divide-y divide-border/70 md:hidden">
                    {rows.map((r, i) => (
                      <div key={r.parameter_name} className={cn("px-4 py-3", r.check === "fail" && "bg-red-50/50 dark:bg-red-950/10")}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold">{r.parameter_name}</p>
                          <ResultMark check={r.check} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">Standard <span className="font-mono">{r.quality_standard || "—"}</span></p>
                        <div className="mt-2">
                          {editable ? (
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

            {editable && (
              <Panel title="Decision" icon={CheckCircle2} bodyClassName="p-4 sm:p-5">
                <p className="mb-3 text-[13px] text-muted-foreground">
                  Pass needs the batch number and every result; it posts GRN for {fmtQty(m.received_qty)} {m.unit} and is final. Fail needs a reason — the quantity is open for a new receipt again.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <Button className="h-10 bg-[#2f5139] text-white hover:bg-[#25412d]" disabled={busy} onClick={() => setDecision({ status: "APPROVED", reason: "" })}>
                    <CheckCircle2 className="h-4 w-4" /> Pass &amp; post GRN
                  </Button>
                  <Button className="h-10 bg-red-700 text-white hover:bg-red-800" disabled={busy} onClick={() => setDecision({ status: "REJECTED", reason: "" })}>
                    <XCircle className="h-4 w-4" /> Fail
                  </Button>
                </div>
              </Panel>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <Panel title="Receipt" icon={Package} bodyClassName="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
              <Fact label="Received" mono>{fmtQty(m.received_qty)} {m.unit}</Fact>
              <Fact label="Ordered" mono>{fmtQty(m.ordered_qty)} {m.unit}</Fact>
              <Fact label="Received on">{fmtDay(m.received_on)}</Fact>
              <Fact label="Order date">{fmtDay(m.order_date)}</Fact>
              <div className="col-span-2"><Fact label="Vendor">{m.vendor_name}</Fact></div>
              <Fact label="QA barcode" mono>{m.qa_barcode}</Fact>
              <Fact label="QC barcode" mono>{m.qc_barcode}</Fact>
              <label className="col-span-2 space-y-1 border-t border-border/70 pt-3">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Batch no (vendor)</span>
                <Input value={form.batch_no} disabled={!editable} inputMode="numeric" maxLength={9} onChange={(e) => setF("batch_no", e.target.value.replace(/\D/g, ""))} className="h-9 font-mono" placeholder="Numbers only" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Mfg date</span>
                <Input type="date" value={form.mfg_date} disabled={!editable} onChange={(e) => setF("mfg_date", e.target.value)} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Expiry date</span>
                <Input type="date" value={form.expiry_date} disabled={!editable} onChange={(e) => setF("expiry_date", e.target.value)} className="h-9" />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Remarks</span>
                <Textarea value={form.remarks} maxLength={255} rows={2} disabled={!editable} onChange={(e) => setF("remarks", e.target.value)} />
              </label>
            </Panel>

            {sheet.receipts.length > 1 && (
              <Panel title={`Receipts of PO ${m.order_no}`} icon={PackageCheck}>
                <ul className="divide-y divide-border/70">
                  {sheet.receipts.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => router.push(`/accounting/forms/orderqualitycontrol/${m.order_no}?qc=${r.id}`)}
                        className={cn("flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-muted/50", r.id === m.qc_id && "bg-primary/5")}
                      >
                        <span className="min-w-0">
                          <span className={CODE_CHIP}>R-{r.id}</span> <span className="truncate">{r.item_name}</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">{fmtQty(r.qty)}</span>
                        </span>
                        <QcStatusChip status={r.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      </main>

      <Dialog open={Boolean(decision)} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto">
          {decision && (
            <>
              <DialogHeader>
                <DialogTitle>{decision.status === "APPROVED" ? "Pass receipt & post GRN" : "Fail receipt"}</DialogTitle>
                <DialogDescription>
                  {decision.status === "APPROVED"
                    ? `GRN for ${fmtQty(m.received_qty)} ${m.unit} of ${m.item_name}, batch ${form.batch_no || "—"}.`
                    : "The receipt is rejected; its quantity becomes open again on the order."}
                </DialogDescription>
              </DialogHeader>
              {decision.confirm && (
                <div className={cn("rounded-lg px-3 py-2 text-[13px]", CHIP.bad)}>
                  <p className="font-semibold">Out of standard:</p>
                  <ul className="mt-1 list-disc pl-5">{decision.confirm.map((f) => <li key={f}>{f}</li>)}</ul>
                  <p className="mt-1">Pass it anyway?</p>
                </div>
              )}
              {decision.status === "REJECTED" && (
                <label className="space-y-1">
                  <span className="text-sm font-medium">Reason</span>
                  <Textarea autoFocus rows={3} maxLength={255} value={decision.reason} onChange={(e) => setDecision((d) => ({ ...d, reason: e.target.value }))} />
                </label>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
                <Button className={decision.status === "APPROVED" ? "bg-[#2f5139] text-white hover:bg-[#25412d]" : "bg-red-700 text-white hover:bg-red-800"} onClick={decide} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {decision.status === "APPROVED" ? (decision.confirm ? "Pass anyway" : "Pass") : "Fail"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResultInput({ r, i, inputs, onChange }) {
  const move = (e, step) => {
    const list = inputs.current.filter(Boolean).filter((el) => el.offsetParent !== null);
    const next = list[list.indexOf(e.currentTarget) + step];
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
