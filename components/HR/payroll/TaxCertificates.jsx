"use client";

// components/HR/payroll/TaxCertificates.jsx — yearly salary & income-tax
// certificates (feature hr.taxCertificate, /api/hr/tax-certificate).
//   TaxCertificatesTab   HR → Payroll → Tax certificates (payroll rights)
//   MyTaxCertificate     My payslips: the employee prints their own
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileBadge, Loader2, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, EmptyState, NativeSelect } from "@/components/HR/shared";
import { Card, TH, THEAD, TR } from "@/components/HR/payroll/ui";
import { amountInWords, esc, letterhead, money, printDocument } from "@/components/HR/printDoc";

export function printCertificate(company, c) {
  const e = c.employee;
  const rows = c.months
    .map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(m.ref)}</td><td class="n">${money(m.gross)}</td><td class="n">${money(m.taxable)}</td><td class="n">${money(m.tax)}</td></tr>`)
    .join("");
  printDocument({
    title: `Tax certificate ${c.fy_label} — ${e.name}`,
    body: `${letterhead(company, `Certificate of salary paid and income tax deducted — tax year ${c.fy_label}`)}
      <p>This is to certify that the following salary was paid to, and income tax deducted from, the employee named below during
      ${esc(c.period)}, and that the tax deducted has been accounted for as tax withheld on salaries.</p>
      <div class="grid">
        <div><span>Name</span><b>${esc(e.name)}</b></div>
        <div><span>Employee no.</span><b>${esc(e.id)}</b></div>
        ${e.father ? `<div><span>Father's name</span><b>${esc(e.father)}</b></div>` : ""}
        <div><span>CNIC</span><b>${esc(e.cnic ?? "—")}</b></div>
        <div><span>Designation</span><b>${esc(e.designation ?? "—")}</b></div>
        <div><span>Department</span><b>${esc(e.department ?? "—")}</b></div>
        <div><span>Joined</span><b>${esc(e.hired)}</b></div>
        ${e.left ? `<div><span>Left</span><b>${esc(e.left)}</b></div>` : ""}
      </div>
      <table><thead><tr><th>Month</th><th>Reference</th><th class="n">Salary paid</th><th class="n">Taxable</th><th class="n">Tax deducted</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">No salary posted in this tax year.</td></tr>`}
      <tr class="total"><td colspan="2">Total</td><td class="n">${money(c.totals.gross)}</td><td class="n">${money(c.totals.taxable)}</td><td class="n">${money(c.totals.tax)}</td></tr></tbody></table>
      <div class="box">Total tax deducted: <b>Rs ${money(c.totals.tax)}</b> (${esc(amountInWords(c.totals.tax))})</div>
      <p class="muted">From posted payroll in the company's books. Issued on ${esc(new Date().toISOString().slice(0, 10))}.</p>
      <div class="sign"><div>Prepared by</div><div>Authorised signatory</div></div>`,
  });
}

export function TaxCertificatesTab() {
  const [fy, setFy] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["hr-tax-certs", fy], queryFn: () => api(`/api/hr/tax-certificate${fy ? `?fy=${fy}` : ""}`) });
  const rows = (data?.rows ?? []).filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()) || String(r.employee_id) === q.trim());
  const print = async (r) => {
    setBusy(r.employee_id);
    try {
      const d = await api(`/api/hr/tax-certificate?fy=${data.fy}&employee=${r.employee_id}`);
      printCertificate(d.company, d.certificate);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card
      title={`Tax certificates${data?.fy_label ? ` — ${data.fy_label}` : ""}`}
      icon={FileBadge}
      description="Salary paid and income tax deducted per employee in a tax year, from posted payroll."
      actions={
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <NativeSelect value={fy || data?.fy || ""} onChange={(e) => setFy(e.target.value)} className="h-9 flex-1 sm:w-36" aria-label="Tax year">
            {(data?.years ?? []).map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
          </NativeSelect>
          <label className="relative flex-1 sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or no." className="h-9 pl-8" />
          </label>
        </div>
      }
      bodyClassName="p-0"
    >
      {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
      {error && <p className="p-4 text-sm text-destructive">{error.message}</p>}
      {data && !rows.length && <EmptyState icon={FileBadge} title="Nobody here" hint="Employees appear once a payroll of the tax year is posted." />}
      {rows.length > 0 && (
        <>
          <ul className="divide-y divide-border/60 md:hidden">
            {rows.map((r) => (
              <li key={r.employee_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.name} <span className="text-xs text-muted-foreground">#{r.employee_id}</span></p>
                  <p className="text-xs text-muted-foreground tabular-nums">{r.months} month(s) · salary {fmtMoney(r.gross)} · tax <b className="text-primary">{fmtMoney(r.tax)}</b></p>
                </div>
                <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => print(r)} disabled={busy === r.employee_id}>{busy === r.employee_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}</Button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className={THEAD}><tr><th className={TH}>Emp no.</th><th className={TH}>Name</th><th className={TH}>CNIC</th><th className={`${TH} text-right`}>Months</th><th className={`${TH} text-right`}>Salary paid</th><th className={`${TH} text-right`}>Taxable</th><th className={`${TH} text-right`}>Tax deducted</th><th className={TH} /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee_id} className={TR}>
                    <td className="px-3 py-2 tabular-nums">{r.employee_id}</td>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.cnic || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.months}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.gross)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.taxable)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary">{fmtMoney(r.tax)}</td>
                    <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" className="h-8" onClick={() => print(r)} disabled={busy === r.employee_id}>{busy === r.employee_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4 mr-1.5" />}Print</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/** My payslips: pick a tax year and print one's own certificate. */
export function MyTaxCertificate() {
  const [fy, setFy] = useState("");
  const [busy, setBusy] = useState(false);
  const years = useQuery({ queryKey: ["hr-my-tax-cert-years"], queryFn: () => api("/api/hr/tax-certificate?mine=1"), staleTime: 300_000 });
  const print = async () => {
    setBusy(true);
    try {
      const d = await api(`/api/hr/tax-certificate?mine=1${fy ? `&fy=${fy}` : ""}`);
      printCertificate(d.company, d.certificate);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (years.error) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <p className="flex items-center gap-2 text-sm"><FileBadge className="h-4 w-4 text-primary" />Tax certificate — salary paid and tax deducted in a tax year</p>
      <div className="flex gap-2 max-sm:[&>*]:flex-1">
        <NativeSelect value={fy} onChange={(e) => setFy(e.target.value)} className="h-9 sm:w-32" aria-label="Tax year">
          {(years.data?.years ?? []).map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
        </NativeSelect>
        <Button size="sm" variant="outline" className="h-9" onClick={print} disabled={busy || years.isLoading}>{busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Printer className="h-4 w-4 mr-1.5" />}Print</Button>
      </div>
    </div>
  );
}
