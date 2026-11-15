"use client";

// components/HR/payroll/TaxAndRules.jsx — income-tax slabs and payroll rules.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Receipt, SlidersHorizontal, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { fiscalYearOf, slabTax } from "@/lib/hr/payroll/compute";
import { api, BRAND_BTN, NativeSelect } from "@/components/HR/shared";
import { Card } from "@/components/HR/payroll/ui";

const fyLabel = (y) => `${y}–${String(Number(y) + 1).slice(2)}`;
const SLAB_COLS = [["from_amount", "From (Rs a year)"], ["to_amount", "Up to"], ["fixed_amount", "Fixed tax"], ["rate_percent", "Rate on the excess"]];

export function TaxTab({ meta }) {
  const qc = useQueryClient();
  const canEdit = meta.rights.payrollManage;
  const [year, setYear] = useState(fiscalYearOf(meta.today.slice(0, 7)));
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tryIncome, setTryIncome] = useState(1800000);
  const { data, isLoading } = useQuery({ queryKey: ["hr-tax", year], queryFn: () => api(`/api/hr/payroll/tax?year=${year}`) });
  useEffect(() => {
    if (data) setRows(data.slabs.map((s) => ({ from_amount: s.from_amount, to_amount: s.to_amount ?? "", fixed_amount: s.fixed_amount, rate_percent: s.rate_percent })));
  }, [data]);

  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const add = () => setRows((r) => {
    const last = r[r.length - 1];
    return [...r, { from_amount: last?.to_amount || 0, to_amount: "", fixed_amount: 0, rate_percent: 0 }];
  });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/payroll/tax", { method: "PUT", body: { fiscal_year: year, slabs: rows } });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-tax"] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const asSlabs = rows.map((r) => ({ from_amount: Number(r.from_amount), to_amount: r.to_amount === "" ? null : Number(r.to_amount), fixed_amount: Number(r.fixed_amount), rate_percent: Number(r.rate_percent) }));
  const sample = slabTax(Number(tryIncome) || 0, asSlabs, { surchargeThreshold: meta.settings.taxSurchargeThreshold, surchargePercent: meta.settings.taxSurchargePercent });

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card
        className="xl:col-span-2"
        title={`Salaried income tax — fiscal year ${fyLabel(year)}`}
        icon={Receipt}
        actions={
          <NativeSelect value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-36" aria-label="Fiscal year">
            {Array.from({ length: 5 }, (_, i) => fiscalYearOf(meta.today.slice(0, 7)) + 1 - i).map((y) => <option key={y} value={y}>FY {fyLabel(y)}</option>)}
          </NativeSelect>
        }
        bodyClassName="p-4 sm:p-5 space-y-3"
      >
        <p className="flex gap-2 rounded-lg border border-[#5f4b1f]/25 bg-[#f5f0e6] px-3 py-2 text-xs text-[#5f4b1f]">
          <AlertTriangle className="h-4 w-4 shrink-0" />Check these against the Finance Act of the year before running payroll. Tax = fixed amount + rate % of yearly taxable income above “from”.
        </p>
        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          // Phones: one card per slab with labelled fields; sm+: a compact grid under one header row.
          <div className="space-y-2 text-sm">
            <div className="hidden grid-cols-[repeat(4,minmax(0,1fr))_2.25rem] gap-2 border-b border-primary/15 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-primary sm:grid">
              {SLAB_COLS.map(([, label]) => <span key={label}>{label}</span>)}
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[repeat(4,minmax(0,1fr))_2.25rem] sm:items-center sm:border-0 sm:p-0">
                <p className="col-span-2 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-primary sm:hidden">
                  Slab {i + 1}
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove slab ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </p>
                {SLAB_COLS.map(([k, label]) => (
                  <label key={k} className="min-w-0 space-y-1 sm:space-y-0">
                    <span className="block text-[11px] text-muted-foreground sm:sr-only">{label}</span>
                    <span className="relative block">
                      <Input type="number" min={0} value={r[k]} disabled={!canEdit} placeholder={k === "to_amount" ? "no limit" : "0"} onChange={(e) => set(i, k, e.target.value)} className="h-9 pr-7 tabular-nums sm:h-8" />
                      {k === "rate_percent" && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>}
                    </span>
                  </label>
                ))}
                <span className="hidden sm:block">
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove slab ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </span>
              </div>
            ))}
            {!rows.length && <p className="rounded-lg border border-dashed border-border py-6 text-center text-muted-foreground">No slabs for this year — payroll deducts no tax until they are entered.</p>}
          </div>
        )}
        {canEdit && (
          <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-3 sm:flex-row sm:justify-between">
            <Button size="sm" variant="outline" className="h-9" onClick={add}><Plus className="h-4 w-4 mr-1.5" />Add slab</Button>
            <Button size="sm" className={`${BRAND_BTN} h-9`} onClick={save} disabled={busy || !rows.length}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save slabs</Button>
          </div>
        )}
      </Card>
      <Card title="Try it" icon={SlidersHorizontal} className="h-fit" bodyClassName="p-4 sm:p-5 space-y-3 text-sm">
        <Label className="text-xs text-muted-foreground">Yearly taxable income</Label>
        <Input type="number" value={tryIncome} onChange={(e) => setTryIncome(e.target.value)} className="tabular-nums" />
        <div className="space-y-1.5 rounded-lg border border-primary/15 bg-primary/5 p-3">
          <p className="flex justify-between"><span className="text-muted-foreground">Tax for the year</span><b className="tabular-nums text-primary">{fmtMoney(sample)}</b></p>
          <p className="flex justify-between"><span className="text-muted-foreground">A month (12)</span><span className="tabular-nums">{fmtMoney(sample / 12)}</span></p>
          <p className="flex justify-between"><span className="text-muted-foreground">Effective rate</span><span className="tabular-nums">{tryIncome > 0 ? ((sample / tryIncome) * 100).toFixed(2) : "0"}%</span></p>
        </div>
        <p className="text-xs text-muted-foreground">
          Each month payroll projects the year (taxable so far + this month × months left), takes the year’s tax, subtracts tax already deducted and divides by the months left — so increments and bonuses even out over the year.
          A surcharge of {meta.settings.taxSurchargePercent}% applies above {fmtMoney(meta.settings.taxSurchargeThreshold)} (Rules).
        </p>
      </Card>
    </div>
  );
}

const RULES = [
  { title: "Days & attendance", keys: [["payrollDaysDivisor", "days"], ["payNoAttendanceFull", "1 / 0"]] },
  { title: "Overtime", keys: [["otRatePercent", "%"], ["otHoursPerDay", "hours"], ["otBaseGross", "1 / 0"]] },
  { title: "EOBI", keys: [["eobiMinWage", "Rs"], ["eobiEmployeePercent", "%"], ["eobiEmployerPercent", "%"]] },
  { title: "Income tax", keys: [["taxSurchargeThreshold", "Rs"], ["taxSurchargePercent", "%"]] },
];

export function PayrollRulesTab({ meta }) {
  const qc = useQueryClient();
  const canEdit = meta.rights.shifts || meta.rights.payrollManage;
  const { data } = useQuery({ queryKey: ["hr-settings"], queryFn: () => api("/api/hr/settings") });
  const [v, setV] = useState(meta.settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(meta.settings), [meta.settings]);
  const keys = RULES.flatMap((g) => g.keys.map(([k]) => k));
  const dirty = keys.some((k) => Number(v[k]) !== meta.settings[k]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/settings", { method: "PUT", body: Object.fromEntries(keys.map((k) => [k, Number(v[k])])) });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-meta"] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="text-xs text-muted-foreground sm:text-sm">Used by every payroll calculation. Draft payrolls pick changes up when recalculated; posted ones never change.</p>
        {canEdit && dirty && <span className="text-xs font-semibold text-primary sm:ml-auto">Unsaved changes</span>}
        {canEdit && <Button className={`${BRAND_BTN} w-full shrink-0 sm:w-auto`} onClick={save} disabled={busy || !dirty}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save rules</Button>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {RULES.map((g) => (
          <Card key={g.title} title={g.title} icon={SlidersHorizontal} bodyClassName="divide-y divide-border/60 px-4 sm:px-5">
            {g.keys.map(([k, unit]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-3">
                <Label htmlFor={`rule-${k}`} className="min-w-0 text-sm text-foreground/90">{data?.defs?.[k]?.label ?? k}</Label>
                <div className="relative w-32 shrink-0 sm:w-36">
                  <Input id={`rule-${k}`} type="number" value={v[k] ?? ""} disabled={!canEdit} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="pr-12 tabular-nums" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
      {!canEdit && <p className="text-xs text-muted-foreground">Changing these needs “manage payroll”.</p>}
    </div>
  );
}
