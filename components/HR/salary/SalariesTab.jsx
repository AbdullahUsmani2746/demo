"use client";

// components/HR/salary/SalariesTab.jsx — everyone's salary, revisions and history.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, TrendingUp, History, Loader2, Hourglass, Check, X, Ban, Download, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { fmtMoney, salaryTotals } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN, EmployeeCell, EmptyState, NativeSelect, StatTile } from "@/components/HR/shared";
import { Card, Chip, CodeChip, DIALOG, DIALOG_FOOTER, SCROLL, SHEET, TFOOT, TH, TH_STICKY, TR } from "@/components/HR/payroll/ui";

// Chip tone of a salary revision's status.
const STRUCT_STATUS = { active: "ok", pending: "warn", rejected: "bad", cancelled: "muted" };

export default function SalariesTab({ meta }) {
  const qc = useQueryClient();
  const r = meta.rights;
  const canRevise = r.salaryManage || r.salaryApprove;
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [revise, setRevise] = useState(null);
  const [history, setHistory] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const compQ = useQuery({ queryKey: ["hr-pay-components"], queryFn: () => api("/api/hr/salary/components") });
  const components = useMemo(() => compQ.data?.components ?? [], [compQ.data]);
  const params = new URLSearchParams({ ...(department && { department }), ...(q && { q }) });
  const { data, isLoading } = useQuery({ queryKey: ["hr-salaries", department, q], queryFn: () => api(`/api/hr/salary?${params}`) });
  const rows = data?.employees ?? [];
  const totals = useMemo(() => {
    const t = { basic: 0, earn: 0, ded: 0, gross: 0, net: 0, none: 0, pending: 0 };
    for (const x of rows) {
      if (x.current) {
        t.basic += x.current.totals.basic;
        t.earn += x.current.totals.totalEarnings;
        t.ded += x.current.totals.totalDeductions;
        t.gross += x.current.totals.gross;
        t.net += x.current.totals.net;
      } else t.none += 1;
      if (x.pending) t.pending += 1;
    }
    return t;
  }, [rows]);

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const comps = components.filter((c) => rows.some((x) => x.current?.lines.some((l) => l.component_id === c.id)));
    const head = ["Emp No", "Name", "Department", "Designation", "Since", "Basic", ...comps.map((c) => c.name), "Gross", "Net"];
    const body = rows.map((x) => {
      const t = x.current?.totals;
      const amt = (c) => [...(t?.earnings ?? []), ...(t?.deductions ?? [])].find((e) => e.component.id === c.id)?.amount ?? 0;
      return [x.employee.id, x.employee.name, x.employee.department ?? "", x.employee.designation ?? "", x.current?.effective_from ?? "", t?.basic ?? 0, ...comps.map(amt), t?.gross ?? 0, t?.net ?? 0];
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), "Salaries");
    XLSX.writeFile(wb, `salaries-${data.date}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Employees" value={isLoading ? "…" : rows.length} />
        <StatTile label="Monthly gross" value={isLoading ? "…" : fmtMoney(totals.gross)} tone="brand" />
        <StatTile label="Without a salary" value={isLoading ? "…" : totals.none} tone={totals.none ? "amber" : "slate"} />
        <StatTile label="Revisions waiting" value={isLoading ? "…" : totals.pending} tone={totals.pending ? "amber" : "slate"} />
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full sm:w-56" aria-label="Department">
          <option value="">All departments</option>
          {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
        </NativeSelect>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee no." className="h-9 pl-8" aria-label="Search employees" />
        </div>
        <Button variant="outline" className="h-9 w-full sm:ml-auto sm:w-auto" onClick={exportExcel} disabled={!rows.length}><Download className="h-4 w-4 mr-1.5" />Excel</Button>
      </div>

      {/* Phone: one card per employee */}
      <ul className="space-y-2 md:hidden">
        {isLoading && [...Array(5)].map((_, i) => <li key={i}><Skeleton className="h-28 rounded-xl" /></li>)}
        {!isLoading && rows.map((x) => {
          const t = x.current?.totals;
          return (
            <li key={x.employee.id} className="rounded-xl border border-border bg-background p-3">
              <EmployeeCell employee={x.employee} />
              {t ? (
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-primary/10 bg-primary/5 px-3 py-2 text-xs">
                  <div className="min-w-0"><p className="text-muted-foreground">Basic</p><p className="truncate font-semibold tabular-nums text-foreground">{fmtMoney(t.basic)}</p></div>
                  <div className="min-w-0"><p className="text-muted-foreground">Gross</p><p className="truncate font-bold tabular-nums text-primary">{fmtMoney(t.gross)}</p></div>
                  <div className="min-w-0 text-right"><p className="text-muted-foreground">Net</p><p className="truncate font-semibold tabular-nums text-foreground">{fmtMoney(t.net)}</p></div>
                  <p className="col-span-3 text-[11px] text-muted-foreground tabular-nums">
                    {t.totalEarnings ? <span className="text-[#2f5139]">+{fmtMoney(t.totalEarnings)} allowances</span> : "No allowances"}
                    {t.totalDeductions ? <span className="text-red-700"> · −{fmtMoney(t.totalDeductions)} deductions</span> : ""}
                    {` · since ${x.current.effective_from <= "2000-01-01" ? "opening" : x.current.effective_from}`}
                  </p>
                </div>
              ) : (
                <p className="mt-3 rounded-lg bg-[#f5f0e6] px-3 py-2 text-sm text-[#5f4b1f]">No salary set</p>
              )}
              {x.pending && (
                <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#f5f0e6] px-2 py-0.5 text-xs font-semibold text-[#5f4b1f]">
                  <Hourglass className="h-3 w-3 shrink-0" />Revision #S-{x.pending.id} from {x.pending.effective_from}: {fmtMoney(x.pending.totals.gross)} waiting
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => setHistory(x.employee)}><History className="h-4 w-4 mr-1.5" />History</Button>
                {canRevise && !x.pending && (
                  <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => setRevise(x)}><TrendingUp className="h-4 w-4 mr-1.5" />{x.current ? "Revise" : "Set salary"}</Button>
                )}
              </div>
            </li>
          );
        })}
        {!isLoading && !rows.length && <li className="rounded-xl border border-border bg-background"><EmptyState icon={Users} title="No employees match" /></li>}
        {!isLoading && rows.length > 1 && (
          <li className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm font-bold">
            <span className="text-xs uppercase tracking-wide text-primary">Monthly gross · {rows.length - totals.none}</span>
            <span className="tabular-nums text-primary">{fmtMoney(totals.gross)}</span>
          </li>
        )}
      </ul>

      {/* Tablet & up: table */}
      <Card className="hidden md:block" title="Salaries" icon={Users} description={isLoading ? "Loading…" : `${rows.length} employee(s) · the salary in force today`}>
        <div className={SCROLL}>
          <table className="w-full text-sm">
            <thead className={TH_STICKY}>
              <tr className="text-left">
                <th className={cn(TH, "px-4")}>Employee</th>
                <th className={cn(TH, "text-right")}>Basic</th>
                <th className={cn(TH, "text-right")}>Allowances</th>
                <th className={cn(TH, "text-right")}>Deductions</th>
                <th className={cn(TH, "text-right")}>Gross</th>
                <th className={cn(TH, "text-right")}>Net</th>
                <th className={TH}>Since</th>
                <th className={TH}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && [...Array(8)].map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-3"><Skeleton className="h-7" /></td></tr>)}
              {!isLoading && rows.map((x) => {
                const t = x.current?.totals;
                return (
                  <tr key={x.employee.id} className={TR}>
                    <td className="px-4 py-2.5 max-w-[260px]"><EmployeeCell employee={x.employee} /></td>
                    {t ? (
                      <>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(t.basic)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#2f5139]" title={t.earnings.map((e) => `${e.component.name}: ${fmtMoney(e.amount)}`).join("\n")}>{t.totalEarnings ? `+${fmtMoney(t.totalEarnings)}` : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-red-800" title={t.deductions.map((e) => `${e.component.name}: ${fmtMoney(e.amount)}`).join("\n")}>{t.totalDeductions ? `−${fmtMoney(t.totalDeductions)}` : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-primary">{fmtMoney(t.gross)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(t.net)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{x.current.effective_from <= "2000-01-01" ? "opening" : x.current.effective_from}</td>
                      </>
                    ) : (
                      <td colSpan={6} className="px-4 py-2.5"><Chip tone="warn">No salary set</Chip></td>
                    )}
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {x.pending && (
                        <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-[#f5f0e6] px-2 py-0.5 text-xs font-semibold text-[#5f4b1f]" title={`Revision #S-${x.pending.id} from ${x.pending.effective_from}: gross ${fmtMoney(x.pending.totals.gross)}`}>
                          <Hourglass className="h-3 w-3" />{fmtMoney(x.pending.totals.gross)} waiting
                        </span>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-primary/70 hover:bg-primary/10 hover:text-primary" title="History" aria-label={`Salary history of ${x.employee.name}`} onClick={() => setHistory(x.employee)}><History className="h-4 w-4" /></Button>
                      {canRevise && !x.pending && (
                        <Button size="sm" variant="outline" onClick={() => setRevise(x)}><TrendingUp className="h-4 w-4 mr-1.5" />{x.current ? "Revise" : "Set salary"}</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {!isLoading && rows.length > 1 && (
              <tfoot className="sticky bottom-0">
                <tr className={TFOOT}>
                  <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-primary">Total · {rows.length - totals.none} with a salary</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(totals.basic)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#2f5139]">{totals.earn ? `+${fmtMoney(totals.earn)}` : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-800">{totals.ded ? `−${fmtMoney(totals.ded)}` : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-primary">{fmtMoney(totals.gross)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(totals.net)}</td>
                  <td className="px-4 py-2.5" colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {!isLoading && !rows.length && <EmptyState icon={Users} title="No employees match" />}
      </Card>

      <ReviseDialog meta={meta} row={revise} components={components} onClose={() => setRevise(null)} onDone={() => { qc.invalidateQueries({ queryKey: ["hr-salaries"] }); setRevise(null); }} />
      <HistorySheet meta={meta} employee={history} onClose={() => setHistory(null)} onChanged={() => qc.invalidateQueries({ queryKey: ["hr-salaries"] })} />
    </div>
  );
}

function ReviseDialog({ meta, row, components, onClose, onDone }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = components.filter((c) => c.is_active);
  useEffect(() => {
    if (!row) return setF(null);
    const cur = row.current;
    const values = Object.fromEntries((cur?.lines ?? []).map((l) => [l.component_id, l.value]));
    setF({ effective_from: `${meta.today.slice(0, 7)}-01`, basic: cur?.basic ?? 0, values, reason: "" });
  }, [row, meta.today]);
  if (!row || !f) return null;

  const byId = new Map(components.map((c) => [c.id, c]));
  const lines = Object.entries(f.values).map(([id, value]) => ({ component: byId.get(Number(id)), value: Number(value) || 0 })).filter((l) => l.component);
  const next = salaryTotals(Number(f.basic) || 0, lines);
  const cur = row.current?.totals;
  const change = cur ? next.gross - cur.gross : null;
  const shown = [...active, ...components.filter((c) => !c.is_active && f.values[c.id])];

  const save = async () => {
    setBusy(true);
    try {
      const res = await api("/api/hr/salary", {
        method: "POST",
        body: {
          employee_id: row.employee.id,
          effective_from: f.effective_from,
          basic: Number(f.basic),
          lines: Object.entries(f.values).map(([component_id, value]) => ({ component_id: Number(component_id), value: Number(value) || 0 })),
          reason: f.reason,
        },
      });
      toast.success(res.message);
      onDone();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const group = (kind) => shown.filter((c) => c.kind === kind);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-3xl")}>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{row.current ? "Revise salary" : "Set salary"} — {row.employee.name}</DialogTitle>
          <DialogDescription>
            {meta.rights.salaryApprove ? "As an approver your revision takes effect at once (your own salary still goes for approval)." : "The revision goes to Approvals and takes effect when approved."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[1fr_250px]">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Effective from</Label>
                <Input type="date" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Basic salary (monthly)</Label>
                <Input type="number" min={0} value={f.basic} onChange={(e) => setF({ ...f, basic: e.target.value })} className="tabular-nums" autoFocus />
              </div>
            </div>
            {[["EARNING", "Allowances"], ["DEDUCTION", "Deductions"]].map(([kind, title]) => (
              <div key={kind} className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">{title}</h3>
                {!group(kind).length && <p className="text-sm text-muted-foreground">None set up — add them on Pay components.</p>}
                <div className="grid sm:grid-cols-2 gap-2">
                  {group(kind).map((c) => {
                    const amount = next[kind === "EARNING" ? "earnings" : "deductions"].find((e) => e.component.id === c.id)?.amount ?? 0;
                    return (
                      <div key={c.id} className="rounded-lg border border-border px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm text-foreground/90">{c.name}</Label>
                          {c.calc === "PERCENT_BASIC" && <span className="text-[11px] text-muted-foreground tabular-nums">= {fmtMoney(amount)}</span>}
                        </div>
                        <div className="relative mt-1">
                          <Input type="number" min={0} value={f.values[c.id] ?? ""} placeholder="0"
                            onChange={(e) => setF({ ...f, values: { ...f.values, [c.id]: e.target.value } })} className="h-8 pr-10 tabular-nums" />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{c.calc === "PERCENT_BASIC" ? "%" : "Rs"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reason</Label>
              <Textarea rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Annual increment 2026" />
            </div>
          </div>
          <aside className="h-fit space-y-2 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm md:sticky md:top-0" aria-live="polite">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Monthly</p>
            <Line label="Basic" value={next.basic} />
            <Line label="Allowances" value={next.totalEarnings} sign="+" />
            <div className="border-t border-primary/15 pt-2"><Line label="Gross" value={next.gross} strong /></div>
            <Line label="Deductions" value={next.totalDeductions} sign="−" />
            <div className="border-t border-primary/15 pt-2"><Line label="Net" value={next.net} strong /></div>
            {cur && (
              <p className={cn("rounded-lg px-3 py-2 text-xs font-medium", change > 0 ? "bg-[#edf2ee] text-[#2f5139]" : change < 0 ? "bg-red-50 text-red-800" : "bg-background text-muted-foreground")}>
                Gross {change >= 0 ? "+" : "−"}{fmtMoney(Math.abs(change))}{cur.gross ? ` (${((change / cur.gross) * 100).toFixed(1)}%)` : ""} vs now ({fmtMoney(cur.gross)})
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">Payroll adds attendance, overtime, loan instalments, EOBI and income tax.</p>
          </aside>
        </div>
        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className={BRAND_BTN} onClick={save} disabled={busy || !f.effective_from || f.basic === ""}>
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{meta.rights.salaryApprove ? "Save revision" : "Send for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value, sign, strong }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong ? "font-bold text-primary" : "text-foreground/90")}>{sign && value ? `${sign} ` : ""}{fmtMoney(value)}</span>
    </div>
  );
}

function HistorySheet({ meta, employee, onClose, onChanged }) {
  const qc = useQueryClient();
  const [act, setAct] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["hr-salary-history", employee?.id],
    queryFn: () => api(`/api/hr/salary/${employee.id}`),
    enabled: Boolean(employee),
  });
  const run = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/hr/salary/revisions/${act.s.id}`, { method: "POST", body: { action: act.action, note } });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-salary-history"] });
      onChanged();
      setAct(null);
      setNote("");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={Boolean(employee)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className={cn(SHEET, "sm:max-w-xl")}>
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>Salary history</SheetTitle>
          <SheetDescription>{employee?.name} · #{employee?.id}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3 sm:mt-5">
          {isLoading && [...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          {(data?.history ?? []).map((s) => (
            <div key={s.id} className={cn("rounded-xl border bg-background p-3.5 sm:p-4", s.status === "active" ? "border-primary/25" : "border-border")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">From {s.effective_from <= "2000-01-01" ? "the start (opening)" : s.effective_from}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><CodeChip>S-{s.id}</CodeChip>entered by {s.created_by ?? "—"}{s.decided_by ? ` · ${s.status} by ${s.decided_by}` : ""}</p>
                </div>
                <Chip tone={STRUCT_STATUS[s.status] ?? "muted"} className="shrink-0 capitalize">{s.status}</Chip>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><p className="text-[11px] text-muted-foreground">Basic</p><p className="tabular-nums">{fmtMoney(s.totals.basic)}</p></div>
                <div><p className="text-[11px] text-muted-foreground">Gross</p><p className="tabular-nums font-semibold text-primary">{fmtMoney(s.totals.gross)}</p></div>
                <div><p className="text-[11px] text-muted-foreground">Net</p><p className="tabular-nums">{fmtMoney(s.totals.net)}</p></div>
              </div>
              {[...s.totals.earnings, ...s.totals.deductions].length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {[...s.totals.earnings.map((e) => `${e.component.name} ${fmtMoney(e.amount)}`), ...s.totals.deductions.map((e) => `− ${e.component.name} ${fmtMoney(e.amount)}`)].join(" · ")}
                </p>
              )}
              {(s.reason || s.decision_note) && <p className="mt-2 text-xs text-muted-foreground">{s.reason}{s.decision_note ? ` — ${s.decision_note}` : ""}</p>}
              {s.status === "pending" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {meta.rights.salaryApprove && (
                    <>
                      <Button size="sm" className="h-9 bg-[#2f5139] text-white hover:bg-[#243f2c] sm:h-8" onClick={() => setAct({ s, action: "approve" })}><Check className="h-4 w-4 mr-1" />Approve</Button>
                      <Button size="sm" variant="outline" className="h-9 text-red-700 hover:bg-red-50 hover:text-red-800 sm:h-8" onClick={() => setAct({ s, action: "reject" })}><X className="h-4 w-4 mr-1" />Reject</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="h-9 sm:h-8" onClick={() => setAct({ s, action: "cancel" })}><Ban className="h-4 w-4 mr-1" />Cancel</Button>
                </div>
              )}
            </div>
          ))}
          {!isLoading && !data?.history?.length && <EmptyState title="No salary yet" />}
        </div>
        <Dialog open={Boolean(act)} onOpenChange={(o) => !o && setAct(null)}>
          <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
            <DialogHeader className="pr-8 text-left">
              <DialogTitle className="capitalize">{act?.action} revision #S-{act?.s.id}</DialogTitle>
              <DialogDescription>Gross {act && fmtMoney(act.s.totals.gross)} from {act?.s.effective_from}.</DialogDescription>
            </DialogHeader>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder={act?.action === "reject" ? "Reason (required)" : "Note (optional)"} />
            <DialogFooter className={DIALOG_FOOTER}>
              <Button variant="ghost" onClick={() => setAct(null)}>Back</Button>
              <Button className={BRAND_BTN} onClick={run} disabled={busy || (act?.action === "reject" && !note.trim())}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
