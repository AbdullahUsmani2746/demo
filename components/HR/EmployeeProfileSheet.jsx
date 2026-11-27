"use client";
import { roleLabel } from "@/lib/auth/roleNames";

// components/HR/EmployeeProfileSheet.jsx — one employee, all of HR in one place:
// details, attendance for a month, leave balances, salary, payslips, loans.
// Sections come from /api/hr/employees/[id] by the viewer's HR rights; someone
// without any HR right still sees the record's basics and can edit it.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/hr/attendance/rules";
import { LOAN_KINDS, LOAN_STATUS, addMonths } from "@/lib/hr/loans/schedule";
import { fmtDays } from "@/lib/hr/leave/policy";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { daysBetween, fmtMinutes } from "@/lib/hr/time";
import { api, CHIP, EmployeeCell, fmtMonth, HR_TABS_LIST, HR_TABS_TRIGGER, ShiftChip } from "@/components/HR/shared";
import { paidByText } from "@/lib/hr/paymentMethods";

const LEAVE_TONE = { approved: CHIP.ok, pending: CHIP.warn, rejected: CHIP.bad, cancelled: CHIP.muted };

function service(from, to) {
  const days = daysBetween(from, to);
  if (days < 0) return "not joined yet";
  const y = Math.floor(days / 365.25);
  const m = Math.floor((days - y * 365.25) / 30.44);
  return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(" ") || `${days} days`;
}

/**
 * @param {object}   props.employee  the list row ({ id, firstName, … }) — shown while loading / without HR rights
 * @param {Function} props.onEdit    opens the edit form
 */
export default function EmployeeProfileSheet({ employee, onClose, onEdit }) {
  const [month, setMonth] = useState(null);
  const id = employee?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-employee-profile", id, month],
    queryFn: () => api(`/api/hr/employees/${id}${month ? `?month=${month}` : ""}`),
    enabled: Boolean(id),
    retry: (n, e) => e?.status !== 403 && n < 2,
    placeholderData: (prev) => (prev?.employee?.id === id ? prev : undefined),
  });
  if (!employee) return null;
  const e = data?.employee;
  const name = [employee.firstName, employee.middleName, employee.surname].filter(Boolean).join(" ");
  const lite = e ?? { id: employee.id, name, designation: employee.Designation?.desg_name, department: employee.department?.dept_name, photo: employee.photographUrl };
  const noHr = error?.status === 403;

  const tabs = [
    ["overview", "Details"],
    data?.attendance && ["attendance", "Attendance"],
    data?.leave && ["leave", "Leave"],
    (data?.salary || data?.payslips) && ["pay", "Pay"],
    data?.loans && ["loans", "Loans"],
  ].filter(Boolean);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto bg-background p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-3 border-b border-primary/15 bg-primary/5 p-4 text-left sm:p-6">
          <SheetTitle className="sr-only">{name}</SheetTitle>
          <SheetDescription className="sr-only">Employee profile</SheetDescription>
          <div className="flex items-start gap-3 pr-8">
            <div className="min-w-0 flex-1 [&_p:first-child]:text-base"><EmployeeCell employee={lite} /></div>
            {onEdit && <Button size="sm" variant="outline" className="h-9 shrink-0 bg-background sm:h-8" onClick={() => onEdit(employee)}><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("rounded-full px-2 py-0.5 font-semibold", employee.status === "ACTIVE" ? CHIP.ok : CHIP.muted)}>
              {employee.status === "ACTIVE" ? "Active" : "Inactive"}
            </span>
            {data?.shift !== undefined && <ShiftChip shift={data.shift} />}
            {e && <span className="text-muted-foreground">Joined {e.hired} · {service(e.hired, e.left ?? new Date().toISOString().slice(0, 10))}{e.left ? ` · left ${e.left}` : ""}</span>}
          </div>
        </SheetHeader>

        <div className="p-4 sm:p-6">
          {isLoading ? (
            <div className="space-y-3"><Skeleton className="h-10 w-2/3 rounded-lg" /><Skeleton className="h-48 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div>
          ) : noHr || !data ? (
            <div className="space-y-4">
              <Facts rows={[
                ["Phone", employee.phoneNumber],
                ["E-mail", employee.emailAddress],
                ["Department", employee.department?.dept_name],
                ["Designation", employee.Designation?.desg_name],
              ]} />
              {noHr ? <p className="text-xs text-muted-foreground">Attendance, leave and pay need HR rights.</p> : error && <p className="text-sm text-destructive">{error.message}</p>}
            </div>
          ) : (
            <Tabs defaultValue="overview">
              {/* Phones: the tab strip scrolls sideways */}
              <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
                <TabsList className={HR_TABS_LIST}>
                  {tabs.map(([k, l]) => <TabsTrigger key={k} value={k} className={HR_TABS_TRIGGER}>{l}</TabsTrigger>)}
                </TabsList>
              </div>
              <TabsContent value="overview" className="mt-4 space-y-4">
                <Facts rows={[
                  ["Phone", e.phone],
                  ["E-mail", e.email],
                  ["CNIC", e.cnic],
                  ["Date of birth", e.dob],
                  ["Gender", e.gender],
                  ["Reports to", e.manager],
                  ["Cost centre", e.cost_center],
                  ["EOBI no.", e.eobi_no],
                  ["Machine id", e.attendanceId || `${e.id} (emp no)`],
                  ["System login", e.login ? `${e.login.username} · ${roleLabel(e.login.role)}${e.login.active ? "" : " (disabled)"}` : "None"],
                  ...(e.bank ? [["Salary paid by", paidByText(e.bank)]] : []),
                ]} />
              </TabsContent>
              {data.attendance && (
                <TabsContent value="attendance" className="mt-4">
                  <AttendanceTab a={data.attendance} onMonth={setMonth} />
                </TabsContent>
              )}
              {data.leave && (
                <TabsContent value="leave" className="mt-4 space-y-4">
                  <Section title={`Balances ${data.leave.label}`}>
                    {data.leave.balances.length ? data.leave.balances.map((b) => {
                      const total = b.entitled + b.carry_forward + b.adjustment;
                      return (
                        <div key={b.type.id} className="py-1.5">
                          <div className="flex justify-between text-sm">
                            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: b.type.color }} />{b.type.name}</span>
                            <span className="tabular-nums text-muted-foreground">{b.unlimited ? `${fmtDays(b.used)} taken` : <><b className="text-foreground">{fmtDays(b.available)}</b> of {fmtDays(total)} left</>}</span>
                          </div>
                          {!b.unlimited && total > 0 && (
                            <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, ((b.used + b.pending) / total) * 100)}%`, background: b.type.color }} /></div>
                          )}
                        </div>
                      );
                    }) : <p className="text-sm text-muted-foreground">No leave entitlement.</p>}
                  </Section>
                  <Section title="Recent applications">
                    {data.leave.requests.length ? data.leave.requests.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
                        <span className="font-medium">{r.type} <span className="font-mono text-xs text-muted-foreground">#L-{r.id}</span></span>
                        <span className="text-xs tabular-nums text-muted-foreground">{r.from}{r.to !== r.from ? ` → ${r.to}` : ""} · {fmtDays(r.days)}d · <span className={cn("rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold capitalize", LEAVE_TONE[r.status] ?? CHIP.muted)}>{r.status}</span></span>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">None.</p>}
                  </Section>
                </TabsContent>
              )}
              {(data.salary || data.payslips) && (
                <TabsContent value="pay" className="mt-4 space-y-4">
                  {data.salary && (
                    <Section title={data.salary.current ? `Salary since ${data.salary.current.since}` : "Salary"}>
                      {data.salary.current ? (
                        <div className="space-y-1 text-sm">
                          <Row l="Basic" r={fmtMoney(data.salary.current.basic)} />
                          {data.salary.current.lines.map((l, i) => <Row key={i} l={l.name} r={`${l.kind === "DEDUCTION" ? "−" : "+"}${fmtMoney(l.amount)}`} />)}
                          <Row l="Gross" r={fmtMoney(data.salary.current.gross)} strong />
                        </div>
                      ) : <p className="text-sm text-muted-foreground">No salary set.</p>}
                      {data.salary.history.length > 1 && (
                        <p className="mt-3 text-xs text-muted-foreground">History: {data.salary.history.map((h) => `${h.from} ${fmtMoney(h.gross)}${h.status === "pending" ? " (waiting)" : ""}`).join(" · ")}</p>
                      )}
                    </Section>
                  )}
                  {data.payslips && (
                    <Section title="Posted payslips">
                      {data.payslips.length ? data.payslips.map((p) => (
                        <Link key={p.id} href={`/accounting/hr/payroll/${p.run_id}`} className="-mx-2 flex min-h-[40px] items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-primary/[0.03]">
                          <span>{p.label}</span>
                          <span className="flex items-center gap-2 tabular-nums"><b>{fmtMoney(p.net)}</b><span className="text-xs text-muted-foreground">tax {fmtMoney(p.income_tax)}</span><ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /></span>
                        </Link>
                      )) : <p className="text-sm text-muted-foreground">None yet.</p>}
                    </Section>
                  )}
                </TabsContent>
              )}
              {data.loans && (
                <TabsContent value="loans" className="mt-4">
                  <Section title="Advances & loans">
                    {data.loans.length ? data.loans.map((l) => (
                      <div key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
                        <span className="font-medium">{LOAN_KINDS[l.kind]?.short ?? l.kind} <span className="font-mono text-xs text-muted-foreground">#A-{l.id}</span> <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset", LOAN_STATUS[l.status]?.chip)}>{LOAN_STATUS[l.status]?.label}</span></span>
                        <span className="text-xs tabular-nums text-muted-foreground">{fmtMoney(l.amount)} · paid {fmtMoney(l.recovered)} · <b className="text-foreground">owes {fmtMoney(l.outstanding)}</b></span>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">None.</p>}
                  </Section>
                </TabsContent>
              )}
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AttendanceTab({ a, onMonth }) {
  const s = a.summary;
  const nowMonth = (a.today ?? "").slice(0, 7);
  return (
    <div className="space-y-4">
      <div className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-background p-0.5">
        <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-8 sm:w-8" onClick={() => onMonth(addMonths(a.month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="w-36 text-center text-sm font-bold text-foreground">{fmtMonth(a.month)}</span>
        <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-8 sm:w-8" onClick={() => onMonth(addMonths(a.month, 1))} disabled={a.month >= nowMonth} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      {s && (
        <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {[["Present", s.counts.PRESENT + s.counts.LATE], ["Late", s.lateMarks], ["Half", s.counts.HALF_DAY], ["Absent", s.counts.ABSENT], ["Leave", s.counts.LEAVE], ["Paid days", s.paidDays]].map(([l, v]) => (
            <div key={l} className={cn("rounded-lg border py-2", l === "Paid days" ? "border-primary/25 bg-primary/5" : "border-border bg-background")}><p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{l}</p><p className={cn("text-base font-bold tabular-nums", l === "Paid days" && "text-primary")}>{v}</p></div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-7 gap-1">
        {a.days.map((d) => {
          const m = d.status ? STATUS_META[d.status] : null;
          return (
            <div
              key={d.day}
              className={cn("rounded-md px-1 py-1.5 text-center text-[11px]", m ? m.cell : "bg-muted/50 text-muted-foreground/60")}
              title={[d.day, m?.label, d.holiday, d.leave, d.check_in && `${d.check_in}–${d.check_out ?? "?"}`, d.late_minutes && `late ${fmtMinutes(d.late_minutes)}`].filter(Boolean).join(" · ")}
            >
              <p className="font-semibold">{Number(d.day.slice(8))}</p>
              <p className="opacity-90">{m?.short ?? ""}</p>
            </div>
          );
        })}
      </div>
      {s && <p className="text-xs text-muted-foreground">Late time {fmtMinutes(s.lateMinutes)}{s.lateCutDays ? ` · ${s.lateCutDays} day(s) cut for lates` : ""} · overtime {fmtMinutes(s.overtimeMinutes)}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="min-w-0 overflow-clip rounded-xl border border-border bg-background">
      <h3 className="border-b border-primary/15 bg-primary/5 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-primary sm:px-4">{title}</h3>
      <div className="p-3.5 sm:p-4">{children}</div>
    </section>
  );
}

function Facts({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-border p-3.5 sm:grid-cols-2 sm:p-4">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{k}</dt>
          <dd className="truncate text-sm text-foreground">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

const Row = ({ l, r, strong }) => (
  <div className={cn("flex justify-between", strong && "border-t border-border pt-1 font-semibold")}>
    <span className="text-foreground/70">{l}</span><span className="tabular-nums">{r}</span>
  </div>
);
