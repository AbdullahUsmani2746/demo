"use client";

// components/HR/loans/LoansList.jsx — advances and loans (mine, or everyone's).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LOAN_KINDS } from "@/lib/hr/loans/schedule";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN, EmployeeCell, EmptyState, NativeSelect, StatTile } from "@/components/HR/shared";
import { Card, CodeChip, SCROLL, TFOOT, TH, TH_STICKY, TR } from "@/components/HR/payroll/ui";
import ApplyLoanDialog from "@/components/HR/loans/ApplyLoanDialog";
import LoanDetail, { LoanStatus } from "@/components/HR/loans/LoanDetail";

export default function LoansList({ meta, mine = false }) {
  const [status, setStatus] = useState(mine ? "" : "active");
  const [kind, setKind] = useState("");
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [applying, setApplying] = useState(false);
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ ...(mine && { mine: "1" }), ...(kind && { kind }), ...(department && { department }), ...(q && { q }) });
  const { data, isLoading } = useQuery({ queryKey: ["hr-loans", mine, kind, department, q], queryFn: () => api(`/api/hr/loans?${params}`) });
  const all = useMemo(() => data?.loans ?? [], [data]);
  const rows = status ? all.filter((l) => l.status === status) : all;
  // Footer totals of the rows shown (display only).
  const totals = rows.reduce(
    (t, l) => ({ amount: t.amount + l.amount, recovered: t.recovered + l.recovered, outstanding: t.outstanding + l.outstanding }),
    { amount: 0, recovered: 0, outstanding: 0 },
  );
  const sums = useMemo(() => {
    const active = all.filter((l) => l.status === "active");
    return {
      active: active.length,
      owed: active.reduce((s, l) => s + l.outstanding, 0),
      due: active.reduce((s, l) => s + l.due_this_month, 0),
      pending: all.filter((l) => l.status === "pending").length,
    };
  }, [all]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Running" value={isLoading ? "…" : sums.active} />
        <StatTile label="Still owed" value={isLoading ? "…" : fmtMoney(sums.owed)} tone="brand" />
        <StatTile label={`Due in ${data?.month ?? "this month"}`} value={isLoading ? "…" : fmtMoney(sums.due)} />
        <StatTile label="Waiting for approval" value={isLoading ? "…" : sums.pending} tone={sums.pending ? "amber" : "slate"} />
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 xl:flex-row xl:items-center">
        {/* Status filter: scrolls sideways on phones */}
        <div className="-mx-3 overflow-x-auto px-3 xl:mx-0 xl:px-0">
          <div className="flex w-max gap-1 rounded-lg bg-muted/40 p-1" role="group" aria-label="Status">
            {[["", "All"], ["pending", "Waiting"], ["active", "Running"], ["settled", "Settled"], ["rejected", "Rejected"], ["cancelled", "Cancelled"]].map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={status === k}
                onClick={() => setStatus(k)}
                className={cn("inline-flex h-8 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors", status === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground")}
              >
                {label}<span className={cn("ml-1.5 rounded px-1 text-xs tabular-nums", status === k ? "bg-white/20" : "bg-muted/70")}>{k ? all.filter((l) => l.status === k).length : all.length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap xl:justify-end">
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)} className="w-full sm:w-40" aria-label="Type">
            <option value="">Advances &amp; loans</option>
            {Object.entries(LOAN_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </NativeSelect>
          {!mine && (
            <>
              <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full sm:w-48" aria-label="Department">
                <option value="">All departments</option>
                {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </NativeSelect>
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee no." className="h-9 pl-8" aria-label="Search employees" />
              </div>
            </>
          )}
          {(mine || meta.rights.loanManage) && (
            <Button className={cn(BRAND_BTN, "w-full sm:w-auto")} onClick={() => setApplying(true)}><Plus className="h-4 w-4 mr-1.5" />{mine ? "Apply" : "For employee"}</Button>
          )}
        </div>
      </div>

      {/* Phone: one card per advance / loan */}
      <ul className="space-y-2 md:hidden">
        {isLoading && [...Array(4)].map((_, i) => <li key={i}><Skeleton className="h-28 rounded-xl" /></li>)}
        {!isLoading && rows.map((l) => {
          const pct = Math.min(100, (l.recovered / l.amount) * 100);
          return (
            <li key={l.id}>
              <button type="button" onClick={() => setOpenId(l.id)} className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:border-primary/30 active:bg-primary/[0.05]">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {mine ? (
                      <p className="flex items-center gap-2 font-semibold text-foreground">{LOAN_KINDS[l.kind].short} <CodeChip>A-{l.id}</CodeChip></p>
                    ) : (
                      <EmployeeCell employee={l.employee} compact sub={` · ${LOAN_KINDS[l.kind].short} · A-${l.id}`} />
                    )}
                  </div>
                  <LoanStatus status={l.status} />
                  {l.pay_with && <PayWith p={l.pay_with} />}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                  <span className="text-xs tabular-nums text-muted-foreground">{Math.round(pct)}% back</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="min-w-0"><p className="text-muted-foreground">Amount</p><p className="truncate font-semibold tabular-nums text-foreground">{fmtMoney(l.amount)}</p></div>
                  <div className="min-w-0"><p className="text-muted-foreground">Instalment</p><p className="truncate font-semibold tabular-nums text-foreground">{fmtMoney(l.installment)}</p></div>
                  <div className="min-w-0 text-right"><p className="text-muted-foreground">Owed</p><p className="truncate font-bold tabular-nums text-primary">{fmtMoney(l.outstanding)}</p></div>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Recovery from {l.start_month}</p>
              </button>
            </li>
          );
        })}
        {!isLoading && !rows.length && (
          <li className="rounded-xl border border-border bg-background">
            <EmptyState icon={HandCoins} title="Nothing here" hint={mine ? "Advances and loans you apply for show here." : undefined} />
          </li>
        )}
      </ul>

      {/* Tablet & up: table */}
      <Card
        className="hidden md:block"
        title={mine ? "My advances & loans" : "Advances & loans"}
        icon={HandCoins}
        description={isLoading ? "Loading…" : `${rows.length} shown · click one for its schedule and actions`}
      >
        <div className={SCROLL}>
          <table className="w-full text-sm">
            <thead className={TH_STICKY}>
              <tr className="text-left">
                <th className={TH}>#</th>
                {!mine && <th className={TH}>Employee</th>}
                <th className={TH}>Type</th>
                <th className={cn(TH, "text-right")}>Amount</th>
                <th className={cn(TH, "min-w-[160px]")}>Recovered</th>
                <th className={cn(TH, "text-right")}>Owed</th>
                <th className={cn(TH, "text-right")}>Instalment</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && [...Array(6)].map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-3"><Skeleton className="h-7" /></td></tr>)}
              {!isLoading && rows.map((l) => (
                <tr
                  key={l.id}
                  tabIndex={0}
                  onClick={() => setOpenId(l.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(l.id))}
                  className={cn(TR, "cursor-pointer focus:bg-primary/[0.05] focus:outline-none")}
                >
                  <td className="px-4 py-2.5"><CodeChip>A-{l.id}</CodeChip></td>
                  {!mine && <td className="px-4 py-2.5 max-w-[240px]"><EmployeeCell employee={l.employee} compact /></td>}
                  <td className="px-4 py-2.5">{LOAN_KINDS[l.kind].short}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(l.amount)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (l.recovered / l.amount) * 100)}%` }} /></div>
                      <span className="text-xs tabular-nums text-muted-foreground">{Math.round((l.recovered / l.amount) * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-primary">{fmtMoney(l.outstanding)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtMoney(l.installment)}<span className="block text-[10px] text-muted-foreground">from {l.start_month}</span></td>
                  <td className="px-4 py-2.5"><LoanStatus status={l.status} />{l.pay_with && <PayWith p={l.pay_with} />}</td>
                </tr>
              ))}
            </tbody>
            {!isLoading && rows.length > 1 && (
              <tfoot className="sticky bottom-0">
                <tr className={TFOOT}>
                  <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-primary" colSpan={mine ? 2 : 3}>Total · {rows.length}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(totals.amount)}</td>
                  <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">{fmtMoney(totals.recovered)} back</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-primary">{fmtMoney(totals.outstanding)}</td>
                  <td className="px-4 py-2.5" colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {!isLoading && !rows.length && <EmptyState icon={HandCoins} title="Nothing here" hint={mine ? "Advances and loans you apply for show here." : undefined} />}
      </Card>
      <ApplyLoanDialog open={applying} onClose={() => setApplying(false)} meta={meta} forOthers={!mine} />
      <LoanDetail loanId={openId} onClose={() => setOpenId(null)} meta={meta} />
    </div>
  );
}

// Approved, waiting to be paid out by the person the approval chain sent it to.
function PayWith({ p }) {
  return (
    <span className={cn("ml-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", p.mine ? "bg-[#800000]/10 text-[#800000]" : "bg-muted text-muted-foreground")}>
      {p.mine ? "To pay — you" : `With ${p.names.join(" / ")} for payment`}
    </span>
  );
}
