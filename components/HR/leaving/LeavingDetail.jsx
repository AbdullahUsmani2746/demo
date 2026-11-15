"use client";

// components/HR/leaving/LeavingDetail.jsx — one leaving: notice, clearance
// checklist, completion, and the full & final settlement (work out → approval
// → post → pay, with reversals), plus the printable settlement statement.
// API: /api/hr/leaving/[id]. Feature hr.leavingProcess.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, Calculator, Send, BookCheck, Banknote, Undo2, Printer, Plus, Trash2, UserCheck, AlertTriangle } from "lucide-react";
import ReactSelect from "react-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { api, BRAND_BTN, NativeSelect } from "@/components/HR/shared";
import { Chip, Fig, SHEET } from "@/components/HR/payroll/ui";
import { amountInWords, esc, letterhead, money, printDocument } from "@/components/HR/printDoc";

export const SEP_TONE = { pending: "warn", approved: "info", completed: "ok", rejected: "bad", cancelled: "muted" };
const SET_TONE = { DRAFT: "muted", PENDING: "warn", APPROVED: "info", POSTED: "ok" };

function printStatement(company, sep, s) {
  const d = s.data;
  const earn = d.lines.filter((l) => l.kind === "EARNING");
  const ded = d.lines.filter((l) => l.kind === "DEDUCTION");
  const rows = (list) => list.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${money(l.amount)}</td></tr>`).join("") || `<tr><td class="muted" colspan="2">—</td></tr>`;
  printDocument({
    title: `Final settlement — ${sep.employee?.name ?? sep.employee_id}`,
    body: `${letterhead(company, `Full & final settlement statement #S-${s.id}`)}
      <div class="grid">
        <div><span>Employee</span><b>${esc(sep.employee?.name)} (#${esc(sep.employee_id)})</b></div>
        <div><span>Department</span><b>${esc(sep.employee?.department ?? "—")}</b></div>
        <div><span>Designation</span><b>${esc(sep.employee?.designation ?? "—")}</b></div>
        <div><span>Leaving</span><b>${esc(sep.kind_label)}</b></div>
        <div><span>Joined</span><b>${esc(d.hired)}</b></div>
        <div><span>Last working day</span><b>${esc(d.dor)}</b></div>
        <div><span>Service</span><b>${esc(d.service_months)} month(s)</b></div>
        <div><span>Notice</span><b>${esc(sep.served)} of ${esc(sep.notice_days)} day(s)${sep.waive_notice ? " (waived)" : ""}</b></div>
        <div><span>Last basic / gross</span><b>${money(d.salary_basic)} / ${money(d.salary_gross)}</b></div>
        <div><span>Status</span><b>${esc(s.status.toLowerCase())}${s.jv_label ? ` — ${esc(s.jv_label)}` : ""}</b></div>
      </div>
      <h2>Payable to the employee</h2>
      <table><thead><tr><th>Item</th><th class="n">Amount</th></tr></thead><tbody>${rows(earn)}<tr class="total"><td>Total</td><td class="n">${money(s.total_earnings)}</td></tr></tbody></table>
      <h2>Recovered from the employee</h2>
      <table><thead><tr><th>Item</th><th class="n">Amount</th></tr></thead><tbody>${rows(ded)}<tr class="total"><td>Total</td><td class="n">${money(s.total_deductions)}</td></tr></tbody></table>
      <div class="box">Net payable: <b>Rs ${money(s.net)}</b> (${esc(amountInWords(s.net))})${s.pay_label ? ` — paid ${esc(s.paid_on)}, ${esc(s.pay_label)}` : ""}</div>
      ${d.gratuity ? `<p class="muted">Gratuity: ${esc(d.gratuity.years)} year(s) × ${esc(fmtMoney(d.gratuity.day_rate))} a day.</p>` : ""}
      ${d.pf ? `<p class="muted">Provident fund: own share ${money(d.pf.employee)}, employer share ${money(d.pf.employer)}${d.pf.forfeited ? ` (forfeited ${money(d.pf.forfeited)})` : ""}.</p>` : ""}
      <p>I have received the above amount in full and final settlement of all my dues and have no further claim on the company.</p>
      <div class="sign"><div>Employee</div><div>Prepared by (HR)</div><div>Approved by</div><div>Finance</div></div>`,
  });
}

function Adjustments({ value, onChange, disabled }) {
  const set = (i, patch) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {value.map((x, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-border/60 p-2 sm:grid-cols-[8rem_1fr_8rem_6rem_auto] sm:items-center">
          <NativeSelect value={x.kind} disabled={disabled} onChange={(e) => set(i, { kind: e.target.value })} className="h-9" aria-label="Kind"><option value="EARNING">Addition</option><option value="DEDUCTION">Deduction</option></NativeSelect>
          <Input value={x.label} disabled={disabled} onChange={(e) => set(i, { label: e.target.value })} placeholder="e.g. Bonus, Damage" className="max-sm:col-span-2" />
          <Input type="number" value={x.amount} disabled={disabled} onChange={(e) => set(i, { amount: e.target.value })} placeholder="Amount" className="tabular-nums" />
          <Input value={x.acno ?? ""} disabled={disabled} onChange={(e) => set(i, { acno: e.target.value })} placeholder="Account" title="Account no. (blank = Account Settings)" />
          {!disabled && <Button type="button" size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>}
        </div>
      ))}
      {!disabled && <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => onChange([...value, { kind: "EARNING", label: "", amount: "", acno: "" }])}><Plus className="h-4 w-4 mr-1.5" />Add addition / deduction</Button>}
    </div>
  );
}

export default function LeavingDetail({ id, onClose }) {
  const qc = useQueryClient();
  const key = ["hr-leaving", String(id)];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api(`/api/hr/leaving/${id}`), enabled: Boolean(id) });
  const [busy, setBusy] = useState(null);
  const [inputs, setInputs] = useState({ unpaid_days: 0, tax: 0, adjustments: [] });
  const [lwd, setLwd] = useState("");
  const [date, setDate] = useState("");
  const [cashAcno, setCashAcno] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const can = data?.can ?? {};
  const cash = useQuery({ queryKey: ["hr-cash-accounts"], queryFn: () => api("/api/hr/cash-accounts"), enabled: Boolean(can.pay), staleTime: 300_000 });
  useEffect(() => {
    if (!data) return;
    const i = data.settlement?.inputs;
    setInputs({ unpaid_days: i?.unpaid_days ?? 0, tax: i?.tax ?? 0, adjustments: (i?.adjustments ?? []).map((x) => ({ ...x, acno: x.acno ?? "" })) });
    setLwd(data.separation.last_working_day);
    setDate(data.today);
  }, [data]);

  const act = async (action, body = {}, done) => {
    setBusy(action);
    try {
      const r = await api(`/api/hr/leaving/${id}`, { method: "POST", body: { action, ...body } });
      toast.success(r.message, { duration: 7000 });
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["hr-leavings"] });
      done?.();
    } catch (e) {
      toast.error(e.message, { duration: 10000 });
    } finally {
      setBusy(null);
    }
  };
  const B = ({ action, children, icon: Icon, className = "", body, variant, disabled }) => (
    <Button size="sm" variant={variant} className={`h-9 ${variant ? "" : BRAND_BTN} ${className}`} disabled={Boolean(busy) || disabled} onClick={() => act(action, typeof body === "function" ? body() : body)}>
      {busy === action ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : Icon ? <Icon className="h-4 w-4 mr-1.5" /> : null}{children}
    </Button>
  );

  const sep = data?.separation;
  const s = data?.settlement;
  const cleared = sep ? sep.clearance.filter((c) => c.done).length : 0;
  const cashOptions = (cash.data?.accounts ?? []).map((a) => ({ value: String(a.acno), label: `${a.name} (${a.acno})` }));
  const inputsBody = () => ({ inputs: { ...inputs, adjustments: inputs.adjustments.map((x) => ({ ...x, amount: Number(x.amount), acno: x.acno === "" ? null : Number(x.acno) })) } });

  return (
    <Sheet open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className={SHEET}>
        <SheetHeader>
          <SheetTitle>{sep ? `${sep.kind_label} — ${sep.employee?.name ?? sep.employee_id}` : "Leaving"}</SheetTitle>
          <SheetDescription>{sep ? `#L-${sep.id} · notice ${sep.notice_date} · last day ${sep.last_working_day}` : ""}</SheetDescription>
        </SheetHeader>
        {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error.message}</p>}
        {sep && (
          <div className="mt-4 space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border p-3 sm:grid-cols-4">
              <Fig label="Status" value={<Chip tone={SEP_TONE[sep.status]}>{sep.status}</Chip>} />
              <Fig label="Joined" value={sep.employee?.hired} />
              <Fig label="Notice" value={`${sep.served} / ${sep.notice_days} day(s)`} />
              <Fig label="Short" value={sep.waive_notice ? "waived" : `${sep.short} day(s)`} tone={sep.short && !sep.waive_notice ? "text-red-700" : ""} />
            </div>
            {sep.reason && <p className="text-muted-foreground">“{sep.reason}”</p>}
            {sep.status === "pending" && <p className="rounded-lg border border-[#5f4b1f]/20 bg-[#f5f0e6] px-3 py-2 text-[#5f4b1f]">Waiting for approval in Approvals.</p>}
            {sep.decision_note && <p className="text-xs text-muted-foreground">Decision note: {sep.decision_note}</p>}

            {can.terms && (
              <section className="space-y-2">
                <h3 className="font-semibold text-primary">Terms</h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Last working day</Label><Input type="date" value={lwd} onChange={(e) => setLwd(e.target.value)} /></div>
                  <B action="terms" variant="outline" body={() => ({ last_working_day: lwd })}>Save day</B>
                  <B action="terms" variant="outline" body={{ waive_notice: !sep.waive_notice }}>{sep.waive_notice ? "Do not waive notice" : "Waive short notice"}</B>
                </div>
              </section>
            )}

            {["approved", "completed"].includes(sep.status) && (
              <section className="space-y-2">
                <h3 className="font-semibold text-primary">Clearance · {cleared} of {sep.clearance.length}</h3>
                <ul className="divide-y divide-border/60 rounded-xl border border-border">
                  {sep.clearance.map((c) => (
                    <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {c.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0"><span className={c.done ? "" : "font-medium"}>{c.label}</span>{c.at && <span className="block text-xs text-muted-foreground">{String(c.at).slice(0, 10)}</span>}</span>
                      </span>
                      {can.clearance && <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={Boolean(busy)} onClick={() => act("clearance", { key: c.key, done: !c.done })}>{c.done ? "Undo" : "Clear"}</Button>}
                    </li>
                  ))}
                </ul>
                {can.complete && (
                  <div className="flex flex-col gap-2 rounded-lg border border-primary/15 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">Completing sets the employee’s leaving date to {sep.last_working_day} and status to inactive. Needs every item cleared and the last day reached.</p>
                    <B action="complete" icon={UserCheck} disabled={cleared < sep.clearance.length || data.today < sep.last_working_day}>Complete leaving</B>
                  </div>
                )}
              </section>
            )}

            {(s || can.calculate) && (
              <section className="space-y-3">
                <h3 className="flex flex-wrap items-center gap-2 font-semibold text-primary">Full & final settlement {s && <><span className="text-muted-foreground">#S-{s.id}</span><Chip tone={SET_TONE[s.status]}>{s.status.toLowerCase()}</Chip></>}</h3>
                {can.calculate && (
                  <div className="space-y-3 rounded-xl border border-border p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label className="text-xs text-muted-foreground">Unpaid days (last salary)</Label><Input type="number" min={0} step="0.5" value={inputs.unpaid_days} onChange={(e) => setInputs({ ...inputs, unpaid_days: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs text-muted-foreground">Income tax to deduct</Label><Input type="number" min={0} value={inputs.tax} onChange={(e) => setInputs({ ...inputs, tax: e.target.value })} /></div>
                    </div>
                    <Adjustments value={inputs.adjustments} onChange={(adjustments) => setInputs({ ...inputs, adjustments })} />
                    <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
                      <B action="calculate" icon={Calculator} body={inputsBody}>{s ? "Recalculate" : "Work out settlement"}</B>
                      {can.submit && <B action="submit" icon={Send} variant="outline">Submit for approval</B>}
                      {can.submit && <B action="delete_draft" icon={Trash2} variant="outline">Delete draft</B>}
                    </div>
                  </div>
                )}
                {s && (
                  <>
                    {(s.data.warnings ?? []).map((w) => <p key={w} className="flex items-start gap-2 rounded-lg bg-[#f5f0e6] px-3 py-2 text-xs text-[#5f4b1f]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</p>)}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {["EARNING", "DEDUCTION"].map((k) => (
                        <div key={k} className="rounded-xl border border-border">
                          <p className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{k === "EARNING" ? "Payable" : "Recovered"}</p>
                          <ul className="divide-y divide-border/60">
                            {s.data.lines.filter((l) => l.kind === k).map((l) => <li key={l.key} className="flex justify-between gap-3 px-3 py-2"><span className="min-w-0">{l.label}</span><span className="shrink-0 tabular-nums">{fmtMoney(l.amount)}</span></li>)}
                            {!s.data.lines.some((l) => l.kind === k) && <li className="px-3 py-2 text-muted-foreground">—</li>}
                          </ul>
                          <p className="flex justify-between border-t border-border px-3 py-2 font-semibold"><span>Total</span><span className="tabular-nums">{fmtMoney(k === "EARNING" ? s.total_earnings : s.total_deductions)}</span></p>
                        </div>
                      ))}
                    </div>
                    <p className="flex items-center justify-between rounded-lg border border-primary/15 bg-primary/5 px-3 py-2"><span>Net payable</span><b className="text-lg tabular-nums text-primary">Rs {fmtMoney(s.net)}</b></p>
                    <p className="text-xs text-muted-foreground">{s.jv_label ? `Posted: ${s.jv_label}. ` : ""}{s.pay_label ? `Paid ${s.paid_on}: ${s.pay_label}.` : ""}{s.decision_note ? ` Note: ${s.decision_note}` : ""}</p>

                    {(can.post || can.pay || can.reverse || can.reversePayment) && (
                      <div className="space-y-3 rounded-xl border border-border p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Voucher date</Label><Input type="date" value={date} max={data.today} onChange={(e) => setDate(e.target.value)} /></div>
                          {can.pay && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Pay from</Label>
                              <ReactSelect options={cashOptions} value={cashOptions.find((o) => o.value === cashAcno) ?? null} onChange={(o) => setCashAcno(o?.value ?? "")} styles={selectStyles} isLoading={cash.isLoading} placeholder="Cash / bank account" menuPortalTarget={typeof document !== "undefined" ? document.body : null} />
                            </div>
                          )}
                          {can.pay && <div className="space-y-1"><Label className="text-xs text-muted-foreground">Cheque / transfer ref.</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>}
                          {(can.reverse || can.reversePayment) && <div className="space-y-1"><Label className="text-xs text-muted-foreground">Reason (for a reversal)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>}
                        </div>
                        <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
                          {can.post && <B action="post" icon={BookCheck} body={() => ({ date })}>Post journal</B>}
                          {can.pay && <B action="pay" icon={Banknote} body={() => ({ date, cash_acno: Number(cashAcno), reference })} disabled={!cashAcno}>Pay {fmtMoney(s.net)}</B>}
                          {can.reversePayment && <B action="reverse_payment" icon={Undo2} variant="outline" body={() => ({ date, note })} disabled={!note.trim()}>Reverse payment</B>}
                          {can.reverse && <B action="reverse" icon={Undo2} variant="outline" body={() => ({ date, note })} disabled={!note.trim()}>Reverse settlement</B>}
                        </div>
                      </div>
                    )}
                    <Button size="sm" variant="outline" className="h-9 w-full sm:w-auto" onClick={() => { try { printStatement(data.company, sep, s); } catch (e) { toast.error(e.message); } }}><Printer className="h-4 w-4 mr-1.5" />Print settlement statement</Button>
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
