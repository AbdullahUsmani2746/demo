"use client";

// components/HR/payroll/MyPayslips.jsx — the signed-in employee's payslips.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, EmptyState } from "@/components/HR/shared";
import { downloadPayslips } from "@/components/HR/payroll/payslipPdf";
import { Card } from "@/components/HR/payroll/ui";
import { MyTaxCertificate } from "@/components/HR/payroll/TaxCertificates";
import { useFeatures } from "@/hooks/useFeatures";

export default function MyPayslips() {
  const { data, isLoading } = useQuery({ queryKey: ["hr-my-payslips"], queryFn: () => api("/api/hr/payroll/mine") });
  const [busy, setBusy] = useState(null);
  const features = useFeatures();
  const cert = features.on("hr.taxCertificate") ? <MyTaxCertificate /> : null;
  const download = async (p) => {
    setBusy(p.id);
    try {
      await downloadPayslips({ company: data.company, month: p.month, slips: [{ ...p, employee: data.employee }], fileName: `payslip-${p.month}.pdf` });
    } catch (e) {
      toast.error(`Could not make the PDF: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };
  if (isLoading) return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>;
  if (!data?.payslips?.length) return <Card><EmptyState icon={FileText} title="No payslips yet" hint="Payslips appear here once a month’s payroll is posted." /></Card>;
  return (
    <div className="space-y-3">
    {cert}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {data.payslips.map((p) => (
        <div key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-background transition-colors hover:border-primary/30">
          <div className="flex items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-primary">{p.label}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{p.data.days.paid} of {p.data.days.employed} day(s) paid</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1.5 bg-background" onClick={() => download(p)} disabled={busy === p.id} aria-label={`Download payslip ${p.label}`} title="Download PDF">
              {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              PDF
            </Button>
          </div>
          <div className="px-4 pb-4 pt-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Net pay</p>
            <p className="truncate text-2xl font-bold tabular-nums text-primary">Rs {fmtMoney(p.net)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-xs">
              <div><p className="text-muted-foreground">Earned</p><p className="font-semibold tabular-nums text-foreground">{fmtMoney(p.total_earnings)}</p></div>
              <div className="text-right"><p className="text-muted-foreground">Deducted</p><p className="font-semibold tabular-nums text-red-800">{fmtMoney(p.total_deductions)}</p></div>
            </div>
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}
