"use client";

// components/HR/leave/MyLeave.jsx — the signed-in employee's balances and leave.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plane, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDays } from "@/lib/hr/leave/policy";
import { api, BRAND_BTN, EmptyState } from "@/components/HR/shared";
import { Card, Chip } from "@/components/HR/payroll/ui";
import ApplyLeaveDialog from "@/components/HR/leave/ApplyLeaveDialog";
import LeaveRequestList from "@/components/HR/leave/LeaveRequestList";

export function BalanceCard({ type, b }) {
  const total = b.entitled + b.carry_forward + b.adjustment;
  const usedPct = total > 0 ? Math.min(100, ((b.used + b.pending) / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-background p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: type.color }} /><span className="truncate">{type.name}</span></p>
        {!type.is_paid && <Chip tone="muted" dot={false} className="px-2 text-[10px] uppercase">unpaid</Chip>}
      </div>
      {b.unlimited ? (
        <p className="mt-3 text-2xl font-bold text-foreground">No limit<span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{fmtDays(b.used)} taken</span></p>
      ) : (
        <>
          <p className="mt-3 text-3xl font-bold tabular-nums text-foreground">{fmtDays(b.available)}<span className="ml-1.5 text-sm font-normal text-muted-foreground">of {fmtDays(total)} left</span></p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Used">
            <div className="h-full rounded-full" style={{ width: `${usedPct}%`, background: type.color }} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
            {fmtDays(b.used)} taken{b.pending ? ` · ${fmtDays(b.pending)} waiting` : ""}
            {b.carry_forward ? ` · ${fmtDays(b.carry_forward)} carried` : ""}
            {b.adjustment ? ` · ${b.adjustment > 0 ? "+" : ""}${fmtDays(b.adjustment)} adjusted` : ""}
          </p>
        </>
      )}
    </div>
  );
}

export default function MyLeave({ meta }) {
  const [applying, setApplying] = useState(false);
  const balQ = useQuery({ queryKey: ["hr-leave-balances", "mine"], queryFn: () => api("/api/hr/leave/balances?mine=1") });
  const reqQ = useQuery({ queryKey: ["hr-leave-requests", "mine"], queryFn: () => api("/api/hr/leave/requests?mine=1") });
  const me = balQ.data?.employees?.[0];
  const types = (balQ.data?.types ?? []).filter((t) => t.is_active && (me?.balances[t.id]?.entitled > 0 || me?.balances[t.id]?.used > 0 || t.allow_negative || me?.balances[t.id]?.carry_forward || me?.balances[t.id]?.adjustment));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-foreground">Hello, {meta.self.name.split(" ")[0]}</p>
          <p className="text-sm text-muted-foreground">Your leave for {balQ.data?.label ?? "this year"}</p>
        </div>
        <Button className={`${BRAND_BTN} h-10 w-full sm:ml-auto sm:h-9 sm:w-auto`} onClick={() => setApplying(true)}><Plus className="h-4 w-4 mr-1.5" />Apply for leave</Button>
      </div>
      {balQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : types.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {types.map((t) => <BalanceCard key={t.id} type={t} b={me.balances[t.id]} />)}
        </div>
      ) : (
        <Card>
          <EmptyState icon={Plane} title="No leave balances yet" hint="Your leave balances show here once HR sets up the leave types." />
        </Card>
      )}
      <Card title="My applications" icon={Wallet} description="Each application with its status and the approver’s note">
        <LeaveRequestList rows={reqQ.data?.requests ?? []} loading={reqQ.isLoading} showEmployee={false} emptyHint="Leave you apply for shows here with its status." />
      </Card>
      <ApplyLeaveDialog open={applying} onClose={() => setApplying(false)} meta={meta} />
    </div>
  );
}
