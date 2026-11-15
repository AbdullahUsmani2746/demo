"use client";

// components/HR/dashboard/HrDashboard.jsx — HR at a glance (/api/hr/dashboard).
// Every block is shown only when the API sent it (the person's rights).
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Building2, Cake, CalendarClock, CalendarHeart, Clock, HandCoins, Inbox, PartyPopper,
  Plane, RefreshCw, TrendingUp, UserMinus, UserPlus, Users, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/hr/attendance/rules";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { fmtMinutes } from "@/lib/hr/time";
import { api, CHIP, EmployeeCell, fmtDayLong, Panel, StatTile, TH, TH_ROW } from "@/components/HR/shared";

const BAR_ORDER = ["PRESENT", "LATE", "HALF_DAY", "LEAVE", "ABSENT", "PENDING", "OFF", "HOLIDAY"];
const RUN_TONE = { DRAFT: CHIP.muted, PENDING: CHIP.warn, APPROVED: CHIP.brand, POSTED: CHIP.ok, REVERSED: CHIP.bad };
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const when = (d) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

export default function HrDashboard() {
  const { data: d, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["hr-dashboard"],
    queryFn: () => api("/api/hr/dashboard"),
    refetchInterval: 5 * 60_000,
  });
  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <div className="grid gap-5 xl:grid-cols-3"><Skeleton className="h-72 rounded-xl xl:col-span-2" /><Skeleton className="h-72 rounded-xl" /></div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">{error.message}</p>
        <Button size="sm" variant="outline" className="h-9 shrink-0 bg-background sm:h-8" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const t = d.today_attendance;
  const pct = t && t.expected ? Math.round((t.in / t.expected) * 100) : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
          {fmtDayLong(d.today)}
        </p>
        <Button variant="outline" size="sm" className="h-9 bg-background sm:h-8" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh dashboard">
          <RefreshCw className={cn("h-4 w-4 sm:mr-1.5", isFetching && "animate-spin")} /><span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* KPIs — two a row on phones */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile icon={Users} label="On the books" value={d.people.active} hint={`${d.people.male} men · ${d.people.female} women`} />
        {t && <StatTile icon={Clock} label="In today" value={`${t.in}/${t.expected}`} hint={pct !== null ? `${pct}% turned up` : null} href="/accounting/hr/attendance" />}
        {t && <StatTile icon={AlertTriangle} label="Late today" value={t.counts.LATE} tone={t.counts.LATE ? "amber" : "slate"} href="/accounting/hr/attendance" />}
        {t && <StatTile icon={Plane} label="On leave today" value={t.counts.LEAVE} />}
        {d.leave && <StatTile icon={Inbox} label="Leave waiting" value={d.leave.waiting} tone={d.leave.waiting ? "brand" : "slate"} href="/accounting/hr/leave?tab=requests" />}
        {d.loans && <StatTile icon={HandCoins} label="Loans owed" value={`Rs ${short(d.loans.outstanding)}`} hint={`${d.loans.active} running${d.loans.pending ? ` · ${d.loans.pending} waiting` : ""}`} href="/accounting/hr/loans?tab=all" />}
        {!t && <StatTile icon={UserPlus} label="Joined this month" value={d.people.joined.length} />}
        {!t && <StatTile icon={UserMinus} label="Left this month" value={d.people.left.length} />}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          {t && <TodayPanel t={t} />}
          {d.payroll && <PayrollPanel p={d.payroll} />}
          {d.month_lates && (
            <Panel title="Most late marks this month" icon={AlertTriangle} actions={<LinkBtn href="/accounting/reports/hrAttendanceExceptions?kind=late">Report</LinkBtn>}>
              {d.month_lates.length ? (
                <>
                  {/* Phone: one row per person */}
                  <ul className="divide-y divide-border/60 md:hidden">
                    {d.month_lates.map((r) => (
                      <li key={r.employee.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1"><EmployeeCell employee={r.employee} compact sub={` · ${fmtMinutes(r.minutes)} late`} /></div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-foreground">{r.marks} <span className="text-xs font-normal text-muted-foreground">marks</span></p>
                          {r.cut ? <p className="text-[11px] font-semibold tabular-nums text-red-700 dark:text-red-400">{r.cut} day(s) cut</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {/* Tablet & up: table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className={TH_ROW}><th className={cn(TH, "px-4")}>Employee</th><th className={cn(TH, "px-4 text-right")}>Late marks</th><th className={cn(TH, "px-4 text-right")}>Late time</th><th className={cn(TH, "px-4 text-right")}>Days cut</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {d.month_lates.map((r) => (
                          <tr key={r.employee.id} className="hover:bg-primary/[0.03]">
                            <td className="max-w-[280px] px-4 py-2"><EmployeeCell employee={r.employee} compact /></td>
                            <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.marks}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-foreground/70">{fmtMinutes(r.minutes)}</td>
                            <td className={cn("px-4 py-2 text-right tabular-nums", r.cut ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground")}>{r.cut || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : <Empty>No late marks this month.</Empty>}
            </Panel>
          )}
        </div>

        {/* Side column: two across on tablets, one column beside the main panels on wide screens */}
        <div className="grid min-w-0 content-start gap-5 md:grid-cols-2 xl:grid-cols-1">
          {d.approvals?.length > 0 && (
            <Panel title="Waiting for you" icon={Inbox} actions={<LinkBtn href="/dashboard/approvals">Approvals</LinkBtn>} bodyClassName="divide-y divide-border/60">
              {d.approvals.map((a) => (
                <Link key={a.doc_type} href="/dashboard/approvals" className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-primary/[0.03]">
                  <span className="min-w-0 truncate text-foreground/85">{a.label}</span>
                  <span className="shrink-0 rounded-full bg-primary px-2 text-xs font-bold leading-5 tabular-nums text-primary-foreground">{a.count}</span>
                </Link>
              ))}
            </Panel>
          )}
          <DepartmentsPanel list={d.people.departments} total={d.people.active} />
          {d.leave && (
            <Panel title="Leave in the next 7 days" icon={Plane} bodyClassName="divide-y divide-border/60">
              {d.leave.upcoming.length ? d.leave.upcoming.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1"><EmployeeCell employee={l.employee} compact sub={` · ${l.type}`} /></div>
                  <span className="shrink-0 rounded-md bg-primary/[0.06] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-primary">{l.from.slice(5)}{l.to !== l.from ? ` → ${l.to.slice(5)}` : ""}</span>
                </div>
              )) : <Empty>Nobody is on leave in the next week.</Empty>}
            </Panel>
          )}
          <UpcomingPanel d={d} />
        </div>
      </div>
    </div>
  );
}

function LinkBtn({ href, children }) {
  return (
    <Button variant="ghost" size="sm" className="-mr-2 h-9 text-primary hover:bg-primary/5 hover:text-primary sm:h-8" asChild>
      <Link href={href}>{children}<ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
    </Button>
  );
}

const Empty = ({ children }) => <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;

/** Today's statuses as one split bar (labelled — never colour alone) + who is late / away. */
function TodayPanel({ t }) {
  const parts = BAR_ORDER.map((k) => ({ k, n: t.counts[k] || 0 })).filter((p) => p.n > 0);
  const total = parts.reduce((s, p) => s + p.n, 0);
  return (
    <Panel title="Attendance today" icon={Clock} actions={<LinkBtn href="/accounting/hr/attendance">Register</LinkBtn>} bodyClassName="p-4 sm:p-5 space-y-4">
      {total ? (
        <>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${STATUS_META[p.k].label} ${p.n}`).join(", ")}>
            {parts.map((p) => (
              <div key={p.k} className={cn("h-full first:rounded-l-full last:rounded-r-full", STATUS_META[p.k].dot)} style={{ width: `${(p.n / total) * 100}%` }} title={`${STATUS_META[p.k].label}: ${p.n}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {parts.map((p) => (
              <span key={p.k} className="flex items-center gap-1.5 text-xs text-foreground/70">
                <span className={cn("h-2 w-2 rounded-full", STATUS_META[p.k].dot)} />{STATUS_META[p.k].label}<b className="tabular-nums text-foreground">{p.n}</b>
              </span>
            ))}
          </div>
        </>
      ) : <Empty>No one is scheduled today.</Empty>}
      <div className="grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
        <MiniList title="Late today" empty="Nobody late so far." rows={t.late.map((r) => ({ employee: r.employee, right: `+${fmtMinutes(r.minutes)}` }))} />
        <MiniList title="On leave today" empty="Nobody on leave." rows={t.on_leave.map((r) => ({ employee: r.employee, right: `${r.leave}${r.half ? " ½" : ""}` }))} />
      </div>
    </Panel>
  );
}

function MiniList({ title, rows, empty }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-primary/80">{title}</p>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.employee.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1"><EmployeeCell employee={r.employee} compact /></div>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground/70">{r.right}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">{empty}</p>}
    </div>
  );
}

/** Net pay of the last six months — one series, so no legend; values on hover and in the list below. */
function PayrollPanel({ p }) {
  const max = Math.max(1, ...p.months.map((m) => m.net));
  const posted = p.months.filter((m) => m.net > 0);
  return (
    <Panel title="Net pay — last 6 months" icon={TrendingUp} actions={<LinkBtn href="/accounting/reports/hrPayrollSummary">Report</LinkBtn>} bodyClassName="p-4 sm:p-5">
      {posted.length ? (
        <div className="flex h-44 items-end gap-1.5 border-b border-border bg-[linear-gradient(to_top,hsl(var(--border)/0.6)_1px,transparent_1px)] bg-[length:100%_25%] pt-6 sm:h-52 sm:gap-3">
          {p.months.map((m, i) => (
            <div key={m.month} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" tabIndex={m.net ? 0 : -1} aria-label={`${m.label}: Rs ${fmtMoney(m.net)}, ${m.employees} paid`}>
              {/* Tooltip on hover / focus — pinned to the edge for the outer bars so it never leaves the card */}
              <div
                className={cn(
                  "pointer-events-none absolute -top-1 z-10 hidden -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] tabular-nums text-white shadow group-hover:block group-focus:block",
                  i === 0 ? "left-0" : i === p.months.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
                )}
              >
                {m.label}: Rs {fmtMoney(m.net)} · {m.employees} paid
              </div>
              <span className="mb-1 text-[10px] font-medium tabular-nums text-muted-foreground">{m.net ? short(m.net) : ""}</span>
              <div className="w-full max-w-[44px] rounded-t-md bg-gradient-to-t from-[#5c0000] to-primary transition-opacity group-hover:opacity-80" style={{ height: `${(m.net / max) * 85}%`, minHeight: m.net ? 4 : 0 }} />
            </div>
          ))}
        </div>
      ) : <Empty>No payroll posted in the last six months.</Empty>}
      {posted.length > 0 && (
        <div className="mt-1.5 flex gap-1.5 sm:gap-3">
          {p.months.map((m) => <span key={m.month} className="min-w-0 flex-1 text-center text-[11px] text-muted-foreground">{m.label.split(" ")[0].slice(0, 3)}</span>)}
        </div>
      )}
      {p.runs.length > 0 && (
        <div className="mt-4 space-y-1 border-t border-border/60 pt-3">
          {p.runs.map((r) => (
            <Link key={r.id} href={`/accounting/hr/payroll/${r.id}`} className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-primary/[0.03]">
              <span className="flex min-w-0 items-center gap-2">
                <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-foreground sm:inline">{r.title || r.label}</span>
                  <span className="block text-xs text-muted-foreground sm:ml-1.5 sm:inline">#P-{r.id} · {r.employees} people</span>
                </span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", RUN_TONE[r.status])}>{r.status.toLowerCase()}</span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function DepartmentsPanel({ list, total }) {
  const top = list.slice(0, 8);
  const rest = list.slice(8).reduce((s, x) => s + x.count, 0);
  const rows = rest ? [...top, { name: `${list.length - 8} more`, count: rest }] : top;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel title="Staff by department" icon={Building2} bodyClassName="p-4 sm:p-5 space-y-3">
      {rows.length ? rows.map((r) => (
        <div key={r.name} title={`${r.name}: ${r.count} of ${total}`}>
          <div className="flex justify-between gap-2 text-xs"><span className="min-w-0 truncate text-foreground/70">{r.name}</span><b className="tabular-nums text-foreground">{r.count}</b></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-primary/10"><div className="h-full rounded-full bg-primary" style={{ width: `${(r.count / max) * 100}%` }} /></div>
        </div>
      )) : <Empty>No employees.</Empty>}
    </Panel>
  );
}

function UpcomingPanel({ d }) {
  const items = [
    ...d.holidays.map((h) => ({ key: `h${h.date}`, icon: CalendarHeart, text: h.name, sub: fmtDayLong(h.date) })),
    ...d.people.birthdays.map((b) => ({ key: `b${b.employee.id}`, icon: Cake, text: b.employee.name, sub: `Birthday ${when(b.in_days)}` })),
    ...d.people.anniversaries.map((a) => ({ key: `a${a.employee.id}`, icon: PartyPopper, text: a.employee.name, sub: `${a.years} year${a.years > 1 ? "s" : ""} with us ${when(a.in_days)}` })),
    ...d.people.joined.map((e) => ({ key: `j${e.id}`, icon: UserPlus, text: e.name, sub: `Joined this month${e.department ? ` · ${e.department}` : ""}` })),
    ...d.people.left.map((e) => ({ key: `l${e.id}`, icon: UserMinus, text: e.name, sub: "Leaving / left this month" })),
  ];
  return (
    <Panel title="Coming up" icon={CalendarClock} bodyClassName="divide-y divide-border/60">
      {items.length ? items.map((i) => (
        <div key={i.key} className="flex items-center gap-3 px-4 py-2.5">
          <div className="shrink-0 rounded-lg bg-primary/10 p-1.5"><i.icon className="h-4 w-4 text-primary" /></div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{i.text}</p><p className="text-[11px] text-muted-foreground">{i.sub}</p></div>
        </div>
      )) : <Empty>Nothing in the next two weeks.</Empty>}
    </Panel>
  );
}
