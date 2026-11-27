"use client";

// components/HR/payroll/BankFiles.jsx — feature hr.bankDisbursement.
//   BankFilesDialog   from an approved / posted payroll: one transfer file per
//                     bank (laid out by its format), the bank advice letter,
//                     the cash and cheque lists, and who has no bank details
//   BankFormatsTab    HR → Payroll → Bank files: the layouts, as data
// Files are built with lib/hr/payroll/bankFile.js from /api/hr/payroll/[id]/bank-files.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileText, Landmark, Loader2, Plus, Printer, Trash2, ArrowUp, ArrowDown, Banknote, AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN, EmptyState, NativeSelect } from "@/components/HR/shared";
import { Card, Chip, DIALOG } from "@/components/HR/payroll/ui";
import { AMOUNT_FORMATS, BANK_FILE_FIELDS, buildBankFile, DATE_FORMATS, toCsv } from "@/lib/hr/payroll/bankFile";
import { amountInWords, esc, letterhead, money, printDocument } from "@/components/HR/printDoc";

function saveBlob(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function BankFilesDialog({ runId, open, onClose }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["hr-bank-files", String(runId)], queryFn: () => api(`/api/hr/payroll/${runId}/bank-files`), enabled: open });
  const [date, setDate] = useState("");
  const [debit, setDebit] = useState("");
  const [pick, setPick] = useState({});
  useEffect(() => {
    if (data?.run) setDate(data.run.pay_date);
  }, [data?.run]);
  const formats = data?.formats?.formats ?? [];
  const formatOf = (b) => formats.find((f) => f.id === (pick[b.bank_id] ?? b.format_id)) ?? formats[0];
  const ctx = data && { date, month: data.run.month, monthLabel: data.run.label, runId: data.run.id, debitAccount: debit };

  const download = async (b) => {
    const f = formatOf(b);
    const file = buildBankFile(f, b.rows, ctx);
    const name = `salary-${data.run.month}-${slug(b.bank)}`;
    if (f.file === "xlsx") {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...(file.header ? [file.header] : []), ...file.lines]), "Transfer");
      XLSX.writeFile(wb, `${name}.xlsx`);
    } else {
      saveBlob(toCsv(file, f.delimiter), `${name}.csv`, "text/csv;charset=utf-8");
    }
  };

  const advice = (b) => {
    try {
      const rows = b.rows
        .map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.title)}</td><td>${esc(r.account)}</td><td>${esc(r.branch_code || r.branch)}</td><td>${esc(r.emp_id)}</td><td class="n">${money(r.amount)}</td></tr>`)
        .join("");
      printDocument({
        title: `Bank advice — ${b.bank} — ${data.run.label}`,
        body: `${letterhead(data.company)}
          <p>Date: ${esc(date)}</p>
          <p>The Manager<br/>${esc(b.bank)}</p>
          <p><b>Subject: Transfer of salaries for ${esc(data.run.label)}</b></p>
          <p>Please debit our account${debit ? ` no. <b>${esc(debit)}</b>` : ""} with <b>Rs ${money(b.total)}</b> (${esc(amountInWords(b.total))})
          and credit the accounts of the ${b.rows.length} employee(s) below with the amounts shown, value date ${esc(date)}.</p>
          <table><thead><tr><th>#</th><th>Account title</th><th>Account no.</th><th>Branch</th><th>Emp no.</th><th class="n">Amount</th></tr></thead>
          <tbody>${rows}<tr class="total"><td colspan="5">Total</td><td class="n">${money(b.total)}</td></tr></tbody></table>
          <p class="muted">Payroll #P-${esc(data.run.id)} (${esc(data.run.status.toLowerCase())}).</p>
          <div class="sign"><div>Authorised signatory</div><div>Authorised signatory</div></div>`,
      });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const printList = (title, list) => {
    try {
      const rows = list.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.emp_id)}</td><td>${esc(r.name)}</td><td>${esc(r.department)}</td><td class="n">${money(r.amount)}</td><td style="width:140px"></td></tr>`).join("");
      printDocument({
        title: `${title} — ${data.run.label}`,
        body: `${letterhead(data.company, `${title} — salaries ${data.run.label} (#P-${data.run.id})`)}
          <table><thead><tr><th>#</th><th>Emp no.</th><th>Name</th><th>Department</th><th class="n">Net pay</th><th>Signature</th></tr></thead>
          <tbody>${rows}<tr class="total"><td colspan="4">Total (${list.rows.length})</td><td class="n">${money(list.total)}</td><td></td></tr></tbody></table>
          <div class="sign"><div>Prepared by</div><div>Paid by</div><div>Approved by</div></div>`,
      });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const other = (title, list, icon) =>
    list?.rows?.length ? (
      <div className="rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
          <p className="flex items-center gap-2 text-sm font-semibold">{icon}{title} · {list.rows.length} · <span className="tabular-nums">{fmtMoney(list.total)}</span></p>
          <Button size="sm" variant="outline" className="h-8 bg-background" onClick={() => printList(title, list)}><Printer className="h-4 w-4 mr-1.5" />Print list</Button>
        </div>
        <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto text-sm">
          {list.rows.map((r) => (
            <li key={r.emp_id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="min-w-0 truncate">{r.name} <span className="text-muted-foreground">#{r.emp_id}</span>{r.problem ? <span className="text-xs text-red-700"> · {r.problem}</span> : null}</span>
              <span className="shrink-0 tabular-nums">{fmtMoney(r.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`${DIALOG} sm:max-w-3xl`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" />Bank files{data?.run ? ` — ${data.run.label}` : ""}</DialogTitle>
          <DialogDescription>One transfer file per bank, laid out as that bank wants (HR → Payroll → Bank files), and its advice letter. Held payslips are left out.</DialogDescription>
        </DialogHeader>
        {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error.message}</p>}
        {data && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Value date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Company account to debit (for the letter / file)</Label><Input value={debit} onChange={(e) => setDebit(e.target.value)} placeholder="Account number" /></div>
            </div>
            {!data.banks.length && <EmptyState icon={Landmark} title="Nobody is paid by bank transfer" hint="Employees with payment method “Direct deposit”, a bank and an account number appear here." />}
            <div className="space-y-2">
              {data.banks.map((b) => {
                const paid = b.rows.filter((r) => r.paid_by).length;
                return (
                  <div key={b.bank_id} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-primary">{b.bank}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{b.rows.length} employee(s) · Rs {fmtMoney(b.total)}{paid ? ` · ${paid} already paid in the books` : ""}</p>
                    </div>
                    <NativeSelect value={pick[b.bank_id] ?? b.format_id} onChange={(e) => setPick({ ...pick, [b.bank_id]: e.target.value })} className="h-9 sm:w-48" aria-label={`Layout for ${b.bank}`}>
                      {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </NativeSelect>
                    <div className="flex gap-2 max-sm:[&>*]:flex-1">
                      <Button size="sm" className={`${BRAND_BTN} h-9`} onClick={() => download(b)}><Download className="h-4 w-4 mr-1.5" />{formatOf(b)?.file === "xlsx" ? "Excel" : "CSV"}</Button>
                      <Button size="sm" variant="outline" className="h-9" onClick={() => advice(b)}><FileText className="h-4 w-4 mr-1.5" />Advice letter</Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {other("Paid in cash", data.cash, <Banknote className="h-4 w-4 text-primary" />)}
            {other("Paid by cheque", data.cheque, <FileText className="h-4 w-4 text-primary" />)}
            {(data.through ?? []).map((t) => (
              <div key={t.id ?? "none"}>{other(`Handed through ${t.name}`, t, <Users className="h-4 w-4 text-primary" />)}</div>
            ))}
            {other("Bank transfer, but bank details missing", data.missing, <AlertTriangle className="h-4 w-4 text-red-700" />)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const BLANK_FORMAT = { id: "", name: "", bank_ids: [], file: "csv", delimiter: ",", header: true, date_format: "DD/MM/YYYY", amount_format: "0.00", columns: [{ field: "account", header: "Account Number" }, { field: "amount", header: "Amount" }] };

export function BankFormatsTab({ meta }) {
  const qc = useQueryClient();
  const canEdit = Boolean(meta?.rights?.bankFile);
  const { data, isLoading, error } = useQuery({ queryKey: ["hr-bank-formats"], queryFn: () => api("/api/hr/payroll/bank-formats") });
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.formats) setV(structuredClone(data.formats));
  }, [data?.formats]);
  if (isLoading || !v) return error ? <Card><p className="p-4 text-sm text-destructive">{error.message}</p></Card> : <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  const banks = data.banks ?? [];
  const setF = (i, patch) => setV({ ...v, formats: v.formats.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const setCol = (i, c, patch) => setF(i, { columns: v.formats[i].columns.map((x, k) => (k === c ? { ...x, ...patch } : x)) });
  const move = (i, c, d) => {
    const cols = [...v.formats[i].columns];
    const t = c + d;
    if (t < 0 || t >= cols.length) return;
    [cols[c], cols[t]] = [cols[t], cols[c]];
    setF(i, { columns: cols });
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/payroll/bank-formats", { method: "PUT", body: v });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-bank-formats"] });
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="text-xs text-muted-foreground sm:text-sm">Each bank’s salary transfer file: columns in order, header row, date and amount layout. A bank not named in any layout uses the default one.</p>
        {canEdit && (
          <div className="flex gap-2 max-sm:[&>*]:flex-1">
            <Button variant="outline" onClick={() => setV({ ...v, formats: [...v.formats, { ...structuredClone(BLANK_FORMAT), id: `f${Date.now() % 100000}`, name: "New layout" }] })}><Plus className="h-4 w-4 mr-1.5" />Add layout</Button>
            <Button className={BRAND_BTN} onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save layouts</Button>
          </div>
        )}
      </div>
      {v.formats.map((f, i) => (
        <Card
          key={i}
          title={f.name || "Layout"}
          icon={Landmark}
          actions={
            <div className="flex items-center gap-2">
              {v.default === f.id ? <Chip tone="ok">Default</Chip> : canEdit && <Button size="sm" variant="ghost" className="h-8" onClick={() => setV({ ...v, default: f.id })}>Make default</Button>}
              {canEdit && v.formats.length > 1 && <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Remove layout" onClick={() => setV({ ...v, formats: v.formats.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          }
          bodyClassName="p-4 space-y-4"
        >
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Name</Label><Input value={f.name} onChange={(e) => setF(i, { name: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">File</Label>
                <NativeSelect value={f.file} onChange={(e) => setF(i, { file: e.target.value })} className="h-9 w-full"><option value="csv">CSV (text)</option><option value="xlsx">Excel</option></NativeSelect>
              </div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">CSV separator</Label>
                <NativeSelect value={f.delimiter} onChange={(e) => setF(i, { delimiter: e.target.value })} className="h-9 w-full"><option value=",">Comma ,</option><option value=";">Semicolon ;</option><option value="|">Pipe |</option><option value={"\t"}>Tab</option></NativeSelect>
              </div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Date layout</Label>
                <NativeSelect value={f.date_format} onChange={(e) => setF(i, { date_format: e.target.value })} className="h-9 w-full">{DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}</NativeSelect>
              </div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Amount layout</Label>
                <NativeSelect value={f.amount_format} onChange={(e) => setF(i, { amount_format: e.target.value })} className="h-9 w-full">{AMOUNT_FORMATS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</NativeSelect>
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={f.header} onChange={(e) => setF(i, { header: e.target.checked })} className="h-4 w-4 accent-[#800000]" />Header row</label>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Banks using this layout</Label>
              <div className="flex flex-wrap gap-1.5">
                {banks.map((b) => {
                  const on = f.bank_ids.includes(b.id);
                  return (
                    <button key={b.id} type="button" onClick={() => setF(i, { bank_ids: on ? f.bank_ids.filter((x) => x !== b.id) : [...f.bank_ids, b.id] })} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground"}`} aria-pressed={on}>
                      {b.name}
                    </button>
                  );
                })}
                {!banks.length && <span className="text-xs text-muted-foreground">No banks yet (HR → Payroll setup → Banks).</span>}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Columns, in file order</Label>
              {f.columns.map((c, k) => (
                <div key={k} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-border/60 p-2 sm:grid-cols-[2rem_1fr_1fr_1fr_auto] sm:items-center">
                  <span className="hidden text-center text-xs text-muted-foreground sm:block">{k + 1}</span>
                  <NativeSelect value={c.field} onChange={(e) => setCol(i, k, { field: e.target.value })} className="h-9 w-full" aria-label="Holds">{BANK_FILE_FIELDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</NativeSelect>
                  <Input value={c.header} onChange={(e) => setCol(i, k, { header: e.target.value })} placeholder="Header text" className="max-sm:col-span-2" />
                  {c.field === "fixed" ? <Input value={c.value ?? ""} onChange={(e) => setCol(i, k, { value: e.target.value })} placeholder="Text written" className="max-sm:col-span-2" /> : <span className="hidden sm:block" />}
                  <div className="flex justify-end gap-1 max-sm:col-start-2 max-sm:row-start-1">
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, k, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, k, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={() => setF(i, { columns: f.columns.filter((_, j) => j !== k) })} aria-label="Remove column"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => setF(i, { columns: [...f.columns, { field: "name", header: "Name" }] })}><Plus className="h-4 w-4 mr-1.5" />Add column</Button>
            </div>
          </fieldset>
        </Card>
      ))}
      {!canEdit && <p className="text-xs text-muted-foreground">Changing layouts needs “bank files”.</p>}
    </div>
  );
}
