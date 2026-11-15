"use client";

// components/HR/leaving/MyLeaving.jsx — My HR → Leaving (feature hr.leavingProcess):
// one's own resignation and its progress; resign from here (hr.leaving.apply).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, UserMinus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN, EmptyState } from "@/components/HR/shared";
import { Card, Chip } from "@/components/HR/payroll/ui";
import LeavingDetail, { SEP_TONE } from "@/components/HR/leaving/LeavingDetail";
import NewLeaving from "@/components/HR/leaving/NewLeaving";

export default function MyLeaving({ meta }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["hr-leavings", "mine"], queryFn: () => api("/api/hr/leaving?mine=1&status=all") });
  const rows = data?.rows ?? [];
  const hasOpen = rows.some((s) => ["pending", "approved"].includes(s.status));
  return (
    <Card
      title="Leaving"
      icon={UserMinus}
      description="Your resignation, its approval, clearance and final settlement."
      actions={meta.rights.leavingApply && !hasOpen ? <Button size="sm" className={`${BRAND_BTN} h-9`} onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1.5" />Resign</Button> : null}
      bodyClassName="p-0"
    >
      {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
      {data && !rows.length && <EmptyState icon={UserMinus} title="Nothing here" hint="A resignation you send appears here with its progress." />}
      <ul className="divide-y divide-border/60">
        {rows.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setOpen(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary/[0.03]">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.kind_label} · last day {s.last_working_day}</p>
                <p className="text-xs text-muted-foreground">Notice {s.served}/{s.notice_days} day(s){s.settlement?.status === "POSTED" ? ` · settlement ${fmtMoney(s.settlement.net)}${s.settlement.paid ? " paid" : ""}` : ""}</p>
              </div>
              <Chip tone={SEP_TONE[s.status]}>{s.status}</Chip>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      {adding && <NewLeaving open={adding} manage={false} meta={meta} onClose={(id) => { setAdding(false); if (id) setOpen(id); }} />}
      <LeavingDetail id={open} onClose={() => setOpen(null)} />
    </Card>
  );
}
