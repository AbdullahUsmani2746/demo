"use client";

// components/HR/attendance/MonthlySheet.jsx — employees × days for a month,
// with the month's totals (late marks → days cut, overtime, paid days).
// Click a day to open it in the daily register.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Search, Users, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/hr/attendance/rules";
import { fmtMinutes, WEEKDAYS } from "@/lib/hr/time";
import { api, EmployeeCell, EmptyState, fmtMonth, NativeSelect, StatTile } from "@/components/HR/shared";

const LEGEND = ["PRESENT", "LATE", "HALF_DAY", "ABSENT", "LEAVE", "OFF", "HOLIDAY", "PENDING"];
const SUMMARY_COLS = [
  { key: "PRESENT", label: "P", title: "Present (on time)" },
  { key: "LATE", label: "L", title: "Late" },
  { key: "HALF_DAY", label: "H", title: "Half days" },
  { key: "ABSENT", label: "A", title: "Absent" },
  { key: "LEAVE", label: "LV", title: "Leave" },
  { key: "OFF", label: "O", title: "Week off" },
  { key: "HOLIDAY", label: "HD", title: "Holidays" },
];

const shiftMonth = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

function cellTitle(day, c) {
  if (!c) return `${day} · not employed`;
  const parts = [`${day} · ${STATUS_META[c.s]?.label ?? c.s}${c.m ? " (set by hand)" : ""}`];
  if (c.i) parts.push(`In ${c.i}${c.o ? ` · Out ${c.o}` : " · no out"}`);
  if (c.w) parts.push(`Worked ${fmtMinutes(c.w)}`);
  if (c.l) parts.push(`Late ${fmtMinutes(c.l)}`);
  if (c.e) parts.push(`Early out ${fmtMinutes(c.e)}`);
  if (c.ot) parts.push(`Overtime ${fmtMinutes(c.ot)}`);
  if (c.r) parts.push("⚠ needs review");
  if (c.note) parts.push(`Note: ${c.note}`);
  if (c.sw) parts.push(c.sw.t === "OFF" ? `⇄ Off — swapped for working ${c.sw.d}` : `⇄ Working day — off on ${c.sw.d} instead`);
  if (c.co) parts.push(`+${c.co === 0.5 ? "½" : "1"} comp-off day earned (week-off / holiday worked)`);
  if (c.k) parts.push("Locked (payroll posted)");
  return parts.join("\n");
}

export default function MonthlySheet({ meta, month, setMonth, openDay }) {
  const leaveTypeById = useMemo(() => new Map((meta.leaveTypes ?? []).map((t) => [t.id, t])), [meta.leaveTypes]);
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ month, ...(department && { department }), ...(location && { location }), ...(q && { q }) });
  const { data, isLoading } = useQuery({
    queryKey: ["hr-att-month", month, department, location, q],
    queryFn: () => api(`/api/hr/attendance/month?${params}`),
  });

  const totals = useMemo(() => {
    const t = { lateCut: 0, ot: 0, paid: 0, absent: 0, review: 0 };
    for (const r of data?.rows ?? []) {
      t.lateCut += r.summary.lateCutDays;
      t.ot += r.summary.overtimeMinutes;
      t.paid += r.summary.paidDays;
      t.absent += r.summary.counts.ABSENT;
      t.review += r.cells.filter((c) => c?.r).length;
    }
    return t;
  }, [data]);

  const exportExcel = async () => {
    if (!data?.rows?.length) return;
    try {
      const XLSX = await import("xlsx");
      const head = [
        "Emp No", "Name", "Department", "Shift",
        ...data.days.map((d) => Number(d.day.slice(8))),
        "Present", "Late", "Half", "Absent", "Leave", "Off", "Holiday", "Late marks", "Days cut", "OT (h)", "Paid days",
      ];
      const body = data.rows.map((r) => [
        r.employee.id, r.employee.name, r.employee.department ?? "", r.shift?.code ?? "",
        ...r.cells.map((c) => (c ? STATUS_META[c.s]?.short ?? c.s : "")),
        r.summary.counts.PRESENT, r.summary.counts.LATE, r.summary.counts.HALF_DAY, r.summary.counts.ABSENT,
        r.summary.counts.LEAVE, r.summary.counts.OFF, r.summary.counts.HOLIDAY, r.summary.lateMarks,
        r.summary.lateCutDays, Math.round((r.summary.overtimeMinutes / 60) * 100) / 100, r.summary.paidDays,
      ]);
      const ws = XLSX.utils.aoa_to_sheet([[`Attendance — ${fmtMonth(month)}`], [], head, ...body]);
      ws["!cols"] = [{ wch: 8 }, { wch: 26 }, { wch: 18 }, { wch: 10 }, ...data.days.map(() => ({ wch: 4 })), ...Array(11).fill({ wch: 9 })];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, month);
      XLSX.writeFile(wb, `attendance-${month}.xlsx`);
    } catch (e) {
      toast.error(`Export failed: ${e.message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMonth(shiftMonth(month, -1))} title="Previous month" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-[160px] sm:flex-none" aria-label="Month" />
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMonth(shiftMonth(month, 1))} title="Next month" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <p className="ml-2 hidden whitespace-nowrap text-sm font-bold text-foreground sm:block">{fmtMonth(month)}</p>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-2 sm:flex sm:flex-wrap lg:flex-nowrap lg:justify-end">
          <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full sm:w-56" aria-label="Department">
            <option value="">All departments</option>
            {meta.departments.map((d) => (
              <option key={d.id} value={d.id}>{d.dept_name}</option>
            ))}
          </NativeSelect>
          {meta.locations?.length > 1 && (
            <NativeSelect value={location} onChange={(e) => setLocation(e.target.value)} className="w-full sm:w-44" aria-label="Location">
              <option value="">All locations</option>
              {meta.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </NativeSelect>
          )}
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee no." className="h-9 pl-8" aria-label="Search employees" />
          </div>
          <Button variant="outline" className="h-9 w-full bg-background sm:w-auto" onClick={exportExcel} disabled={!data?.rows?.length}>
            <Download className="h-4 w-4 mr-1.5" />Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile icon={Users} label="Employees" value={data?.rows?.length ?? "…"} tone="brand" />
        <StatTile label="Absent days" value={data ? totals.absent : "…"} tone="red" />
        <StatTile label="Days cut for lates" value={data ? totals.lateCut : "…"} tone="amber" />
        <StatTile label="Overtime" value={data ? fmtMinutes(totals.ot) : "…"} tone="emerald" />
        <StatTile className="col-span-2 md:col-span-1" label="Days needing review" value={data ? totals.review : "…"} tone={totals.review ? "amber" : "slate"} />
      </div>

      {/* Legend — full labels from sm up, letter codes only on phones */}
      <div className="hidden flex-wrap items-center gap-x-4 gap-y-2 text-xs text-foreground/70 sm:flex">
        {LEGEND.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold", STATUS_META[s].cell)}>{STATUS_META[s].short}</span>
            {STATUS_META[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background" />needs review</span>
        <span className="inline-flex items-center gap-1.5"><span className="rounded-sm px-[2px] text-[9px] text-primary ring-1 ring-primary/30">⇄</span>off day swapped</span>
        <span className="inline-flex items-center gap-1.5"><span className="rounded-sm bg-violet-600 px-[3px] text-[9px] text-white">+1</span>comp-off earned</span>
      </div>
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 text-[10px] text-foreground/70 sm:hidden">
        {LEGEND.map((s) => (
          <span key={s} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background py-0.5 pl-0.5 pr-1.5" title={STATUS_META[s].label}>
            <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded text-[8px] font-bold", STATUS_META[s].cell)}>{STATUS_META[s].short}</span>
            {STATUS_META[s].label}
          </span>
        ))}
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5"><span className="h-2 w-2 rounded-full bg-amber-500" />review</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {isLoading ? (
          <div className="space-y-2 p-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : !data?.rows?.length ? (
          <EmptyState icon={Users} title="No employees" hint="No employees you work with for this month." />
        ) : (
          <div className="max-h-[70vh] overflow-auto overscroll-x-contain">
            <table className="text-xs border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 w-[150px] min-w-[150px] max-w-[150px] border-b border-r border-white/15 bg-primary px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-primary-foreground sm:w-auto sm:min-w-[230px] sm:max-w-none sm:px-3">Employee</th>
                  {data.days.map((d) => {
                    const weekend = d.weekday === 0;
                    return (
                      <th
                        key={d.day}
                        title={d.holiday ? `${d.holiday.name} (${d.holiday.is_paid ? "paid" : "unpaid"})` : undefined}
                        className={cn(
                          "sticky top-0 z-20 min-w-[30px] border-b border-white/15 px-0.5 py-1.5 text-center font-semibold text-primary-foreground",
                          // Holidays keep the holiday colour; Sundays are a darker maroon.
                          d.holiday ? "bg-violet-700" : weekend ? "bg-[#5c0000]" : "bg-primary",
                          d.day === data.today && "shadow-[inset_0_-3px_0_#fff]",
                        )}
                      >
                        <div className="text-[13px] leading-none">{Number(d.day.slice(8))}</div>
                        <div className="mt-0.5 text-[9px] font-medium uppercase opacity-75">{WEEKDAYS[d.weekday].short.slice(0, 2)}</div>
                      </th>
                    );
                  })}
                  {SUMMARY_COLS.map((c) => (
                    <th key={c.key} title={c.title} className={cn("sticky top-0 z-20 min-w-[34px] border-b border-white/15 bg-primary px-1.5 py-2 text-center font-bold text-primary-foreground", c.key === "PRESENT" && "border-l border-l-white/30")}>
                      {c.label}
                    </th>
                  ))}
                  <th title="Late marks (lates + early outs) → days cut" className="sticky top-0 z-20 min-w-[58px] border-b border-l border-white/15 border-l-white/30 bg-[#5c0000] px-2 py-2 text-center font-bold text-primary-foreground">Cut</th>
                  <th title="Overtime hours" className="sticky top-0 z-20 min-w-[52px] border-b border-white/15 bg-[#5c0000] px-2 py-2 text-center font-bold text-primary-foreground">OT</th>
                  <th title="Paid days = present + late + week off + paid holidays + leave + ½ half days − days cut" className="sticky top-0 z-20 min-w-[52px] border-b border-white/15 bg-[#5c0000] px-2 py-2 text-center font-bold text-primary-foreground">Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employee.id} className="group">
                    <td className="sticky left-0 z-10 w-[150px] min-w-[150px] max-w-[150px] border-b border-r border-border/60 bg-background px-2 py-1.5 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] group-hover:bg-muted sm:w-auto sm:min-w-[230px] sm:max-w-none sm:px-3">
                      <EmployeeCell employee={r.employee} compact sub={r.shift ? ` · ${r.shift.code} ${r.shift.start_time}–${r.shift.end_time}` : " · no shift"} />
                    </td>
                    {r.cells.map((c, i) => {
                      const day = data.days[i].day;
                      const lt = c?.lt ? leaveTypeById.get(c.lt) : null;
                      return (
                        <td key={day} className="border-b border-border/60 p-0.5 text-center group-hover:bg-primary/[0.03]">
                          {c ? (
                            <button
                              type="button"
                              onClick={() => openDay(day, r.employee.id)}
                              aria-label={`${r.employee.name}, ${day}: ${lt ? lt.name : STATUS_META[c.s]?.label ?? c.s}`}
                              title={`${cellTitle(day, c)}${lt ? `\n${lt.name}${c.lh ? " (½ day)" : ""}${lt.is_paid ? "" : " — unpaid"}` : ""}`}
                              style={lt ? { background: c.lh ? `linear-gradient(135deg, ${lt.color} 50%, #10b981 50%)` : lt.color, color: "#fff" } : undefined}
                              className={cn(
                                "relative mx-auto flex h-6 w-[26px] items-center justify-center rounded text-[9px] font-bold transition-transform hover:scale-110 hover:shadow focus:outline-none focus:ring-2 focus:ring-primary/40",
                                STATUS_META[c.s]?.cell,
                                c.m && "ring-2 ring-inset ring-black/15",
                              )}
                            >
                              {lt ? lt.code.slice(0, 2) : STATUS_META[c.s]?.short}
                              {c.r ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background" /> : null}
                              {c.sw ? <span className="absolute -bottom-1 -left-1 rounded-sm bg-background px-[1px] text-[8px] leading-none text-primary ring-1 ring-primary/30">⇄</span> : null}
                              {c.co ? <span className="absolute -bottom-1 -right-1 rounded-sm bg-violet-600 px-[2px] text-[7px] leading-[9px] text-white">+{c.co === 0.5 ? "½" : "1"}</span> : null}
                            </button>
                          ) : (
                            <span className="mx-auto block h-6 w-[26px] rounded bg-[repeating-linear-gradient(45deg,hsl(var(--muted)),hsl(var(--muted))_3px,transparent_3px,transparent_6px)]" title={`${day} · not employed`} />
                          )}
                        </td>
                      );
                    })}
                    {SUMMARY_COLS.map((c) => (
                      <td key={c.key} className={cn("border-b border-border/60 px-1.5 text-center tabular-nums text-foreground/85 group-hover:bg-primary/[0.03]", c.key === "PRESENT" && "border-l")}>
                        {r.summary.counts[c.key] || <span className="text-muted-foreground/60">0</span>}
                      </td>
                    ))}
                    <td className="border-b border-l border-border/60 bg-[#f5f0e6]/50 px-2 text-center tabular-nums dark:bg-amber-950/20" title={`${r.summary.lateMarks} late mark(s)${r.shift?.code ? ` · shift ${r.shift.code}` : ""}`}>
                      {r.summary.lateCutDays ? <b className="text-[#5f4b1f] dark:text-amber-300">{r.summary.lateCutDays}</b> : <span className="text-muted-foreground/60">0</span>}
                      {r.summary.lateMarks > 0 && <span className="ml-1 text-[10px] text-muted-foreground">/{r.summary.lateMarks}</span>}
                    </td>
                    <td className="border-b border-border/60 bg-[#edf2ee]/50 px-2 text-center tabular-nums text-[#2f5139] dark:bg-emerald-950/20 dark:text-emerald-300">
                      {r.summary.overtimeMinutes ? (r.summary.overtimeMinutes / 60).toFixed(1) : <span className="text-muted-foreground/60">0</span>}
                    </td>
                    <td className="border-b border-border/60 bg-primary/5 px-2 text-center font-bold tabular-nums text-primary">{r.summary.paidDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Leave cells show the leave type (half green = half day worked). Unpaid leave is not paid. Late marks include early outs where the shift says so; every N marks (per shift) cut one day.
      </p>
    </div>
  );
}
