"use client";
// Planned Quantities — planned qty per item per month or quarter (INPUT_FOR_PP,
// app/api/material/input-for-pp, lib/production/plannedQuantities.js). Ported
// from Accounting's "Input for PP". A planning input: the Production Planning
// report shows the plan month's figure and the quarter's (Qtr Qty). A quarter
// entry overrides the sum of its months. Empty a box to remove that entry.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarRange, FileChartColumn, Loader2, Plus, RefreshCw, Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import ItemSelect from "@/components/Material/Production/ItemSelect";
import { HR_PAGE, HR_MAIN, PageHeader, Panel, EmptyState, ListSkeleton, CODE_CHIP, TH_ROW, TH, api } from "@/components/HR/shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PERIODS = {
  MONTHLY: { label: "Monthly", cols: MONTHS.map((m, i) => ({ key: i + 1, label: m })) },
  QUARTERLY: { label: "Quarterly", cols: [1, 2, 3, 4].map((q) => ({ key: q, label: `Q${q}` })) },
};
const thisYear = new Date().getFullYear();

export default function PlannedQuantitiesPage() {
  const [year, setYear] = useState(thisYear);
  const [period, setPeriod] = useState("MONTHLY");
  const [items, setItems] = useState([]); // [{ itcd, code, item, unit }]
  const [stored, setStored] = useState({}); // "itcd|col" → qty
  const [edits, setEdits] = useState({}); // "itcd|col" → typed text
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(null);

  const cols = PERIODS[period].cols;
  const colOf = (r) => (period === "MONTHLY" ? r.month : r.quarter);

  const load = async () => {
    setLoading(true);
    try {
      const body = await api(`/api/material/input-for-pp?year=${year}&period_type=${period}`);
      const byItem = new Map();
      const values = {};
      for (const r of body.data || []) {
        if (r.item) byItem.set(r.itcd, { itcd: r.itcd, code: r.item.code, item: r.item.item, unit: r.item.unit });
        values[`${r.itcd}|${colOf(r)}`] = r.qty;
      }
      setItems([...byItem.values()]);
      setStored(values);
      setEdits({});
      setCanEdit(Boolean(body.canEdit));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [year, period]);

  const changes = useMemo(
    () =>
      Object.entries(edits)
        .map(([key, text]) => {
          const [itcd, col] = key.split("|").map(Number);
          const t = String(text).trim();
          const before = stored[key];
          if (t === "") return before != null ? { itcd, col, qty: null } : null;
          const n = Number(t);
          if (!Number.isFinite(n) || n < 0 || n === before) return null;
          return { itcd, col, qty: n };
        })
        .filter(Boolean),
    [edits, stored],
  );

  const save = async () => {
    if (!changes.length || saving) return;
    setSaving(true);
    try {
      const entries = changes.map((c) => ({
        itcd: c.itcd,
        period_type: period,
        year,
        ...(period === "MONTHLY" ? { month: c.col } : { quarter: c.col }),
        qty: c.qty,
      }));
      const body = await api("/api/material/input-for-pp", { method: "PUT", body: { entries } });
      toast.success(body.message || "Saved");
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const addItem = (opt) => {
    if (!opt) return;
    if (!items.some((i) => i.itcd === opt.value)) {
      setItems((p) => [...p, { itcd: opt.value, code: opt.code, item: opt.name, unit: opt.unit }]);
    }
    setAdding(null);
  };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((r) => `${r.code} ${r.item}`.toLowerCase().includes(t)) : items;
  }, [items, q]);

  const valueOf = (itcd, col) => {
    const key = `${itcd}|${col}`;
    return key in edits ? edits[key] : stored[key] ?? "";
  };
  const box = (r, c) => {
    const key = `${r.itcd}|${c.key}`;
    const edited = changes.some((x) => x.itcd === r.itcd && x.col === c.key);
    return (
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        aria-label={`${r.code || r.itcd} ${c.label}`}
        value={valueOf(r.itcd, c.key)}
        disabled={!canEdit}
        onChange={(e) => setEdits((p) => ({ ...p, [key]: e.target.value }))}
        className={`h-8 w-full min-w-[4.5rem] rounded-md border bg-background px-2 text-right font-mono text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60 ${edited ? "border-amber-500" : "border-input"}`}
      />
    );
  };

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={CalendarRange}
        title="Planned Quantities"
        badge={items.length ? String(items.length) : undefined}
        subtitle="Planned quantity per item for each month or quarter. The Production Planning report shows the plan month's figure and the quarter's (a quarter entry overrides the sum of its months)."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/accounting/reports/productionPlanning">
                <FileChartColumn className="mr-1.5 h-4 w-4" /> Production Planning
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            {canEdit && (
              <Button size="sm" onClick={save} disabled={!changes.length || saving}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                Save{changes.length ? ` (${changes.length})` : ""}
              </Button>
            )}
          </>
        }
      />
      <main className={`${HR_MAIN} space-y-4`}>
        <Panel
          title={`${PERIODS[period].label} plan ${year}`}
          icon={CalendarRange}
          actions={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                aria-label="Year"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {Array.from({ length: 7 }, (_, i) => thisYear - 3 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <div className="inline-flex rounded-md border border-input p-0.5">
                {Object.entries(PERIODS).map(([k, p]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPeriod(k)}
                    className={`h-8 rounded px-3 text-xs font-semibold ${period === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 sm:w-56 sm:flex-none">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or item…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
              </div>
            </div>
          }
        >
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1 sm:max-w-md">
                <ItemSelect value={adding} onChange={addItem} placeholder="Add an item to plan…" minWidth="0" />
              </div>
            </div>
          )}
          {loading && !items.length ? (
            <ListSkeleton />
          ) : shown.length === 0 ? (
            <EmptyState icon={CalendarRange} title="No planned quantities" hint={canEdit ? "Add an item above and type its planned quantities." : "Nothing planned for this year yet."} />
          ) : (
            <>
              {/* phone: cards */}
              <ul className="divide-y divide-border md:hidden">
                {shown.map((r) => (
                  <li key={r.itcd} className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <span className={CODE_CHIP}>{r.code || r.itcd}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{r.item}</span>
                      {r.unit && <span className="text-xs text-muted-foreground">{r.unit}</span>}
                    </div>
                    <div className={`mt-2 grid gap-2 ${period === "MONTHLY" ? "grid-cols-3" : "grid-cols-2"}`}>
                      {cols.map((c) => (
                        <label key={c.key} className="text-[11px] text-muted-foreground">
                          {c.label}
                          {box(r, c)}
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {/* desktop: table */}
              <div className="hidden max-h-[70vh] overflow-auto md:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className={TH_ROW}>
                      <th className={TH}>Code</th>
                      <th className={TH}>Item</th>
                      {cols.map((c) => (
                        <th key={c.key} className={`${TH} text-right`}>{c.label}</th>
                      ))}
                      <th className={`${TH} w-8`} />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.itcd} className="border-b border-border/70 hover:bg-muted/40">
                        <td className="px-3 py-1.5"><span className={CODE_CHIP}>{r.code || r.itcd}</span></td>
                        <td className="px-3 py-1.5">{r.item}{r.unit ? <span className="ml-1 text-xs text-muted-foreground">{r.unit}</span> : null}</td>
                        {cols.map((c) => (
                          <td key={c.key} className="px-1 py-1">{box(r, c)}</td>
                        ))}
                        <td className="px-1 py-1 text-center">
                          {canEdit && (
                            <button
                              type="button"
                              title="Clear this item's quantities (removed on Save)"
                              onClick={() => setEdits((p) => ({ ...p, ...Object.fromEntries(cols.map((c) => [`${r.itcd}|${c.key}`, ""])) }))}
                              className="p-1 text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </main>
    </div>
  );
}
