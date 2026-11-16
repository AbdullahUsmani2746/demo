"use client";

// HR → Pay history (feature hr.payHistory): one employee's pay month by month —
// payslips (drill to the payslip on its payroll), salary changes, advances /
// loans and final settlements. /api/hr/pay-history/[employeeId].
import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2, FileText, TrendingUp, HandCoins, UserMinus, ChevronRight } from "lucide-react";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, EmptyState, NoAccess, PageHeader, useHrMeta } from "@/components/HR/shared";
import { Card, Chip, Fig, MAIN, PAGE, PageSkeleton, TFOOT, TH, THEAD, TR } from "@/components/HR/payroll/ui";
import EmployeePicker from "@/components/HR/EmployeePicker";
import { useFeatures } from "@/hooks/useFeatures";

const RUN_TONE = { DRAFT: "muted", PENDING: "warn", APPROVED: "info", POSTED: "ok" };

function History_() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const meta = useHrMeta();
  const features = useFeatures();
  const [emp, setEmp] = useState(null);
  const id = emp?.id ?? (Number(sp.get("employee")) || null);
  const { data, isLoading, error } = useQuery({ queryKey: ["hr-pay-history", id], queryFn: () => api(`/api/hr/pay-history/${id}`), enabled: Boolean(id) && features.on("hr.payHistory") });
  if (meta.isLoading || features.isLoading) return <PageSkeleton />;
  const r = meta.data?.rights;
  if (!features.on("hr.payHistory")) return <NoAccess title="Pay history is switched off." hint="Turn on “Pay history” in Settings → Features to use it." />;
  if (!(r?.payrollView || r?.salaryView)) return <NoAccess />;
  const pick = (e) => {
    setEmp(e);
    const p = new URLSearchParams(sp);
    if (e) p.set("employee", String(e.id));
    else p.delete("employee");
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const shown = emp ?? (data?.employee ? { id: data.employee.id, name: data.employee.name, department: data.employee.department } : null);
  return (
    <div className={PAGE}>
      <PageHeader icon={History} title="Pay history" subtitle="Every payslip month by month, salary changes, advances and loans of one employee" />
      <main className={`${MAIN} space-y-4`}>
        <div className="max-w-md"><EmployeePicker value={shown} onChange={pick} includeLeft /></div>
        {!id && <Card><EmptyState icon={History} title="Choose an employee" hint="Search by name or employee number — people who have left are included." /></Card>}
        {id && isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error.message}</p>}
        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-3 lg:grid-cols-6">
              <Fig label="Joined" value={data.employee.hired} />
              <Fig label={data.employee.left ? "Left" : "Status"} value={data.employee.left ?? (data.employee.active ? "Active" : "Inactive")} />
              <Fig label="Months paid" value={data.totals.months} />
              <Fig label="Earned (posted)" value={fmtMoney(data.totals.earnings)} />
              <Fig label="Tax deducted" value={fmtMoney(data.totals.tax)} />
              <Fig label="Net paid" value={fmtMoney(data.totals.net)} tone="text-primary" />
            </div>

            <Card title="Payslips" icon={FileText} bodyClassName="p-0">
              {!data.payslips.length ? <EmptyState icon={FileText} title="No payslips yet" /> : (
                <>
                  <ul className="divide-y divide-border/60 md:hidden">
                    {data.payslips.map((p) => (
                      <li key={`${p.run_id}`}>
                        <Link href={`/accounting/hr/payroll/${p.run_id}?slip=${data.employee.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-primary/5">
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 font-semibold">{p.label}<Chip tone={RUN_TONE[p.status] ?? "muted"}>{p.status.toLowerCase()}</Chip></p>
                            <p className="text-xs text-muted-foreground tabular-nums">Earned {fmtMoney(p.earnings)} · tax {fmtMoney(p.tax)} · deducted {fmtMoney(p.deductions)}</p>
                          </div>
                          <span className="text-right"><span className="block text-[10px] uppercase text-muted-foreground">Net</span><b className="tabular-nums text-primary">{fmtMoney(p.net)}</b></span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead className={THEAD}>
                        <tr>{["Month", "Payroll", "Paid days", "Gross salary", "Earned", "Income tax", "EOBI", "PF", "Loans", "Deductions", "Net"].map((h, i) => <th key={h} className={`${TH} ${i > 1 ? "text-right" : ""}`}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {data.payslips.map((p) => (
                          <tr key={p.run_id} className={TR}>
                            <td className="px-3 py-2"><Link className="font-medium text-primary hover:underline" href={`/accounting/hr/payroll/${p.run_id}?slip=${data.employee.id}`}>{p.label}</Link></td>
                            <td className="px-3 py-2"><span className="tabular-nums">P-{p.run_id}</span> <Chip tone={RUN_TONE[p.status] ?? "muted"}>{p.status.toLowerCase()}</Chip></td>
                            <td className="px-3 py-2 text-right tabular-nums">{p.paid_days}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.gross)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.earnings)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.tax)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.eobi)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.pf)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.loans)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.deductions)}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary">{fmtMoney(p.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className={TFOOT}>
                          <td className="px-3 py-2" colSpan={4}>Posted total ({data.totals.months} month(s))</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(data.totals.earnings)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(data.totals.tax)}</td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(data.totals.pf)}</td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(data.totals.deductions)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(data.totals.net)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Salary changes" icon={TrendingUp} bodyClassName="divide-y divide-border/60">
                {!data.salary.length && <EmptyState icon={TrendingUp} title="No salary set" />}
                {data.salary.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold">From {s.from} {s.status === "pending" && <Chip tone="warn">waiting approval</Chip>}</p>
                      <p className="text-xs text-muted-foreground">Basic {fmtMoney(s.basic)}{s.reason ? ` · ${s.reason}` : ""}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">{fmtMoney(s.gross)}</p>
                      {s.change !== null && <p className={`text-xs tabular-nums ${s.change >= 0 ? "text-emerald-700" : "text-red-700"}`}>{s.change >= 0 ? "+" : ""}{fmtMoney(s.change)}{s.change_pct !== null ? ` (${s.change_pct}%)` : ""}</p>}
                    </div>
                  </div>
                ))}
              </Card>
              <Card title="Advances & loans" icon={HandCoins} bodyClassName="divide-y divide-border/60">
                {!data.loans.length && <EmptyState icon={HandCoins} title="None" />}
                {data.loans.map((l) => (
                  <div key={l.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold">{l.kind} A-{l.id} <Chip tone="muted">{l.status}</Chip></p>
                      <p className="text-xs text-muted-foreground">{l.disbursed ? `Paid out ${l.disbursed}` : "Not paid out"} · {fmtMoney(l.installment)} a month</p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <p className="text-sm font-semibold tabular-nums">{fmtMoney(l.amount)}</p>
                      <p className="tabular-nums text-muted-foreground">recovered {fmtMoney(l.recovered)} · owed {fmtMoney(l.outstanding)}</p>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
            {data.settlements.length > 0 && (
              <Card title="Final settlements" icon={UserMinus} bodyClassName="divide-y divide-border/60">
                {data.settlements.map((s) => (
                  <Link key={s.id} href={`/accounting/hr/leaving?separation=${s.separation_id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-primary/5">
                    <span>S-{s.id} · leaving {s.dor} <Chip tone="muted">{s.status.toLowerCase()}</Chip></span>
                    <b className="tabular-nums text-primary">{fmtMoney(s.net)}</b>
                  </Link>
                ))}
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <History_ />
    </Suspense>
  );
}
