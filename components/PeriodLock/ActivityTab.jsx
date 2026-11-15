"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Lock, Unlock, KeyRound, Ban, ShieldX, CheckCircle2, RefreshCw, ScrollText, CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { documentLabel } from "@/lib/periodLockCatalog";
import { CHIP } from "@/components/Material/shared/LabUI";
import { Panel, Segmented, EmptyState, ListSkeleton, fmtDay, fmtStamp, fmtRelative } from "./shared";

const EVENTS = {
  MONTH_LOCK: { label: "Month locked", icon: CalendarDays, tone: CHIP.bad },
  MONTH_UNLOCK: { label: "Month unlocked", icon: CalendarDays, tone: CHIP.warn },
  RANGE_LOCK: { label: "Range locked", icon: Lock, tone: CHIP.bad },
  RANGE_RELOCK: { label: "Range locked again", icon: Lock, tone: CHIP.bad },
  RANGE_UNLOCK: { label: "Range unlocked", icon: Unlock, tone: CHIP.warn },
  EXCEPTION_GRANT: { label: "Access granted", icon: KeyRound, tone: CHIP.brand },
  EXCEPTION_REVOKE: { label: "Access revoked", icon: Ban, tone: CHIP.muted },
  EXCEPTION_USED: { label: "Exception used", icon: CheckCircle2, tone: CHIP.ok },
  BLOCKED: { label: "Blocked", icon: ShieldX, tone: CHIP.bad },
};

const FILTERS = {
  all: "",
  blocked: "BLOCKED",
  used: "EXCEPTION_USED",
  access: "EXCEPTION_GRANT,EXCEPTION_REVOKE",
  locks: "MONTH_LOCK,MONTH_UNLOCK,RANGE_LOCK,RANGE_RELOCK,RANGE_UNLOCK",
};
const ACTION_LABEL = { create: "Create", update: "Edit", delete: "Delete" };

export default function ActivityTab() {
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = FILTERS[filter] ? `?event=${FILTERS[filter]}&limit=300` : "?limit=300";
      const res = await fetch(`/api/period-lock/log${q}`);
      const d = await res.json();
      if (res.ok) setRows(d); else toast.error(d.error || "Failed to load activity");
    } catch { toast.error("Server error"); } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <Panel
      title="Activity" icon={ScrollText}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={filter} onChange={setFilter} options={[
            ["all", "All"], ["blocked", "Blocked"], ["used", "Exceptions used"], ["access", "Access"], ["locks", "Locks"],
          ]} />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} disabled={loading} aria-label="Refresh activity">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      }
    >
      {loading && !rows.length ? <ListSkeleton rows={5} /> : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No activity yet" hint="Locks, access grants, blocked attempts and exception use appear here." />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const ev = EVENTS[r.event] || { label: r.event, icon: ScrollText, tone: CHIP.muted };
            const Icon = ev.icon;
            const doc = r.tran_code != null
              ? `${documentLabel(r.tran_code)}${r.action ? ` · ${ACTION_LABEL[r.action] || r.action}` : ""}${r.doc_date ? ` · dated ${fmtDay(r.doc_date)}` : ""}`
              : null;
            return (
              <li key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className={`rounded-lg p-2 shrink-0 ${ev.tone}`}><Icon className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-3">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{ev.label}</span>
                      <span className="text-muted-foreground"> by {r.actor_name || "system"}</span>
                    </p>
                    <time className="text-xs text-muted-foreground/80 shrink-0" title={fmtStamp(r.created_at)}>
                      {fmtRelative(r.created_at)}
                    </time>
                  </div>
                  {doc && <p className="text-xs font-medium text-muted-foreground mt-0.5">{doc}</p>}
                  {r.detail && <p className="text-xs text-muted-foreground mt-0.5 break-words">{r.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
