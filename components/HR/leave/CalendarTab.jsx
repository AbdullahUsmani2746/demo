"use client";

// components/HR/leave/CalendarTab.jsx — month calendar of who is on leave.
// Solid = approved, dashed = waiting for approval.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { eachDay, weekdayOf, WEEKDAYS } from "@/lib/hr/time";
import { api, fmtMonth, NativeSelect } from "@/components/HR/shared";

const shiftMonth = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function CalendarTab({ meta }) {
  const [month, setMonth] = useState(meta.today.slice(0, 7));
  const [department, setDepartment] = useState("");
  const params = new URLSearchParams({ month, ...(department && { department }) });
  const { data, isLoading } = useQuery({ queryKey: ["hr-leave-calendar", month, department], queryFn: () => api(`/api/hr/leave/calendar?${params}`) });

  const cells = useMemo(() => {
    if (!data) return [];
    const days = eachDay(data.from, data.to);
    const lead = weekdayOf(data.from); // Sunday-first grid
    const holiday = new Map(data.holidays.map((h) => [h.date, h.name]));
    return [
      ...Array(lead).fill(null),
      ...days.map((d) => ({ day: d, holiday: holiday.get(d), leaves: data.leaves.filter((l) => l.from <= d && l.to >= d) })),
    ];
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
          <p className="flex-1 text-center text-sm font-semibold text-primary sm:w-40 sm:flex-none" aria-live="polite">{fmtMonth(month)}</p>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full sm:ml-auto sm:w-56" aria-label="Department">
          <option value="">All departments</option>
          {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
        </NativeSelect>
      </div>
      {/* The month grid scrolls sideways inside its card on phones. */}
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="overflow-x-auto overscroll-x-contain">
          <div className="min-w-[640px] md:min-w-0">
            <div className="grid grid-cols-7 bg-primary text-center text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
              {WEEKDAYS.map((d) => <div key={d.value} className="py-2">{d.short}</div>)}
            </div>
            {isLoading ? (
              <div className="grid grid-cols-7 gap-px p-px">{[...Array(35)].map((_, i) => <Skeleton key={i} className="h-[96px] rounded-none sm:h-[110px]" />)}</div>
            ) : (
              <div className="grid grid-cols-7">
                {cells.map((c, i) =>
                  !c ? (
                    <div key={`x${i}`} className="min-h-[96px] border-b border-r border-border/60 bg-muted/40 sm:min-h-[110px]" />
                  ) : (
                    <div key={c.day} className={cn("min-h-[96px] min-w-0 border-b border-r border-border/60 p-1.5 sm:min-h-[110px]", c.holiday && "bg-primary/5")}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums", c.day === data.today ? "bg-primary text-primary-foreground" : "text-foreground/90")}>{Number(c.day.slice(8))}</span>
                        {c.leaves.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{c.leaves.length} off</span>}
                      </div>
                      {c.holiday && <p className="mb-1 truncate text-[10px] font-semibold text-primary" title={c.holiday}>{c.holiday}</p>}
                      <div className="space-y-0.5">
                        {c.leaves.slice(0, 4).map((l) => (
                          <p key={l.id} title={`${l.employee.name} · ${l.type.name}${l.half_day ? " (½ day)" : ""} · ${l.status}`}
                            className={cn("truncate rounded px-1.5 py-0.5 text-[11px] font-medium", l.status === "pending" && "border border-dashed bg-background")}
                            style={l.status === "pending" ? { borderColor: l.type.color, color: l.type.color } : { background: `${l.type.color}1f`, color: l.type.color }}>
                            {l.half_day ? "½ " : ""}{l.employee.name}
                          </p>
                        ))}
                        {c.leaves.length > 4 && <p className="px-1.5 text-[10px] text-muted-foreground">+{c.leaves.length - 4} more</p>}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground sm:text-xs">
        {meta.leaveTypes.filter((t) => t.is_active).map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: t.color }} />{t.name}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded border border-dashed border-muted-foreground" />waiting for approval</span>
      </div>
    </div>
  );
}
