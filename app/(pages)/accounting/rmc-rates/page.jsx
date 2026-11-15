"use client";
// RMC Input Rates — the company's own rate per raw / packing material for the
// RMC report's "Input Based" summary type (RmcInputRate, app/api/rmc-rates).
// Feature "reports.rmcInputRates". Shows the items the RMC report prices (raw
// material / packaging of active BOMs). The rate box starts at the monthly
// rate; a changed rate is saved as the item's input rate. MonthlyOpeningRate
// never changes.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Calculator, FileChartColumn, Loader2, Lock, RefreshCw, RotateCcw, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeatures } from "@/hooks/useFeatures";
import { HR_PAGE, HR_MAIN, PageHeader, Panel, EmptyState, ListSkeleton, CODE_CHIP, TH_ROW, TH, api } from "@/components/HR/shared";

const FEATURE = "reports.rmcInputRates";
const fmt = (n) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

export default function RmcRatesPage() {
  const features = useFeatures();
  const enabled = features.on(FEATURE);
  const [rows, setRows] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [edits, setEdits] = useState({}); // itcd → typed text ("" = back to the monthly rate)
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const body = await api("/api/rmc-rates");
      setRows(body.data || []);
      setCanEdit(Boolean(body.canEdit));
      setEdits({});
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (enabled) load();
  }, [enabled]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => `${r.code} ${r.item}`.toLowerCase().includes(t)) : rows;
  }, [rows, q]);

  // Only real changes are sent: a new rate, or an input rate cleared
  const changes = useMemo(
    () =>
      Object.entries(edits)
        .map(([itcd, text]) => {
          const row = rows.find((r) => String(r.itcd) === itcd);
          if (!row) return null;
          const t = String(text).trim();
          if (t === "") return row.input_rate != null ? { itcd: row.itcd, rate: null } : null;
          const n = Number(t);
          if (!Number.isFinite(n)) return null;
          return n !== row.rate ? { itcd: row.itcd, rate: n } : null;
        })
        .filter(Boolean),
    [edits, rows],
  );

  const save = async () => {
    if (!changes.length || saving) return;
    setSaving(true);
    try {
      const body = await api("/api/rmc-rates", { method: "PUT", body: { rates: changes } });
      setRows(body.data || []);
      setEdits({});
      toast.success(body.message || "Saved");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!features.isLoading && !enabled) {
    return (
      <div className={HR_PAGE}>
        <PageHeader icon={Calculator} title="RMC Input Rates" />
        <main className={HR_MAIN}>
          <Panel>
            <EmptyState icon={Lock} title="RMC input rates are switched off" hint="Turn on “RMC input rates” in Settings → Features to use them." />
          </Panel>
        </main>
      </div>
    );
  }

  const inputCount = rows.filter((r) => r.input_rate != null).length;
  const valueOf = (r) => {
    const key = String(r.itcd);
    return key in edits ? edits[key] : r.input_rate != null ? r.input_rate : r.normal_rate;
  };
  const isEdited = (r) => changes.some((c) => c.itcd === r.itcd);
  const rateInput = (r) => (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={valueOf(r)}
        disabled={!canEdit}
        onChange={(e) => setEdits((p) => ({ ...p, [String(r.itcd)]: e.target.value }))}
        className={`h-8 w-28 rounded-md border bg-background px-2 text-right font-mono text-sm font-semibold tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60 ${r.input_rate != null ? "border-primary text-primary" : "border-input"}`}
      />
      {canEdit && r.input_rate != null && (
        <button
          type="button"
          title="Back to the monthly rate (removes the input rate on Save)"
          onClick={() => setEdits((p) => ({ ...p, [String(r.itcd)]: "" }))}
          className="p-1 text-muted-foreground hover:text-primary"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={Calculator}
        title="RMC Input Rates"
        badge={rows.length ? `${inputCount} / ${rows.length}` : undefined}
        subtitle="Your own rate per raw / packing material for the RMC report's Input Based summary. An item with no input rate keeps its monthly rate; monthly opening rates are not changed."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/accounting/reports/rmc">
                <FileChartColumn className="mr-1.5 h-4 w-4" /> RMC report
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
          title="Materials of active BOMs"
          icon={Calculator}
          actions={
            <div className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 sm:w-64">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or item…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          {loading && !rows.length ? (
            <ListSkeleton />
          ) : shown.length === 0 ? (
            <EmptyState icon={Calculator} title="No items" hint="Raw / packing materials appear here once they are on an active BOM." />
          ) : (
            <>
              {/* phone: cards */}
              <ul className="divide-y divide-border md:hidden">
                {shown.map((r) => (
                  <li key={r.itcd} className={`px-3 py-3 ${isEdited(r) ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                    <div className="flex items-start gap-2">
                      <span className={CODE_CHIP}>{r.code}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{r.item}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        Monthly <span className="font-mono tabular-nums text-foreground">{fmt(r.normal_rate)}</span>
                      </span>
                      {rateInput(r)}
                    </div>
                    {r.input_rate != null && (
                      <p className="mt-1 text-right text-[11px] text-muted-foreground">
                        {fmtDate(r.updated_at)}
                        {r.updated_by ? ` · ${r.updated_by}` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {/* desktop: table */}
              <div className="hidden max-h-[70vh] overflow-auto md:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className={TH_ROW}>
                      <th className={`${TH} w-12`}>#</th>
                      <th className={TH}>Code</th>
                      <th className={TH}>Item</th>
                      <th className={`${TH} text-right`}>Monthly rate</th>
                      <th className={`${TH} text-right`}>Input rate</th>
                      <th className={TH}>Last input</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={r.itcd} className={`border-b border-border/70 ${isEdited(r) ? "bg-amber-50 dark:bg-amber-950/20" : "hover:bg-muted/40"}`}>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-1.5"><span className={CODE_CHIP}>{r.code}</span></td>
                        <td className="px-3 py-1.5">{r.item}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{fmt(r.normal_rate)}</td>
                        <td className="px-3 py-1.5">{rateInput(r)}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          {r.input_rate != null ? `${fmtDate(r.updated_at)}${r.updated_by ? ` · ${r.updated_by}` : ""}` : "—"}
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
