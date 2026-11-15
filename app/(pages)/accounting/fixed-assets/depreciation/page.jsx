"use client";
// Fixed Assets → Depreciation (lib/fixedAssets/depreciation.js,
// /api/fixed-assets/depreciation). Choose a month → preview per asset and the
// journal → Post (one system journal, read-only). A month is posted once; runs
// go month by month; the newest run can be reversed (mirror journal) here.
// The rules (first / last month, defaults) are Settings → Fixed assets.
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Calculator, Eye, Send, Undo2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HR_PAGE, HR_MAIN, PageHeader, Panel, StatTile, EmptyState, ListSkeleton, TH, TH_ROW, CHIP, api } from "@/components/HR/shared";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import { methodLabel } from "@/lib/fixedAssets/settingsDefs";

const money = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lastMonth = () => {
  const d = new Date();
  d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const RULE_TEXT = {
  firstMonthRule: { PRORATA: "first month pro-rata from the in-service date", FULL: "full first month", NEXT: "starts the month after" },
  lastMonthRule: { PRORATA: "disposal month pro-rata", FULL: "full disposal month", NONE: "nothing in the disposal month" },
};

export default function DepreciationRunPage() {
  const [period, setPeriod] = useState(lastMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  const load = async (p = period) => {
    setLoading(true);
    try {
      const r = await api(`/api/fixed-assets/depreciation?period=${p}`);
      setData(r);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const post = async () => {
    if (!window.confirm(`Post depreciation for ${data.preview.label}? One journal of ${money(data.preview.total)} is posted and cannot be edited.`)) return;
    setPosting(true);
    try {
      const r = await api("/api/fixed-assets/depreciation", { method: "POST", body: { period } });
      toast.success(r.message);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPosting(false);
    }
  };
  const reverse = async (run) => {
    const reason = window.prompt(`Why is the ${run.period} run reversed?`);
    if (!reason) return;
    try {
      const r = await api(`/api/fixed-assets/depreciation/${run.id}/reverse`, { method: "POST", body: { reason } });
      toast.success(r.message);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const pv = data?.preview;
  const charged = pv?.rows.filter((r) => r.amount > 0) ?? [];
  const newestPosted = data?.runs.find((r) => r.status === "POSTED");

  return (
    <div className={HR_PAGE}>
      <PageHeader icon={Calculator} title="Depreciation" subtitle="Monthly run: preview per asset, then post one journal (Dr depreciation expense, Cr accumulated depreciation)." />
      <main className={HR_MAIN}>
        {error && !data ? (
          <Panel className="mt-2"><EmptyState icon={AlertTriangle} title="Cannot open the run screen" hint={error} /></Panel>
        ) : (
          <>
            <Panel className="mt-2" title="Month" icon={Calculator} bodyClassName="p-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 sm:flex-none">
                  <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Month</span>
                  <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="sm:w-48" />
                </label>
                <Button variant="outline" onClick={() => load(period)} disabled={loading} className="max-sm:flex-1"><Eye className="mr-1.5 h-4 w-4" />Preview</Button>
                <Button onClick={post} disabled={!pv || posting || !!pv.blocked || !!pv.missing_accounts.length || !(pv.total > 0)} className="max-sm:flex-1">
                  <Send className="mr-1.5 h-4 w-4" />{posting ? "Posting…" : "Post"}
                </Button>
              </div>
              {pv && (
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  Posted on {pv.posting_date} · {RULE_TEXT.firstMonthRule[pv.rules.firstMonthRule]} · {RULE_TEXT.lastMonthRule[pv.rules.lastMonthRule]} ·{" "}
                  <Link className="text-primary underline" href="/accounting/settings?tab=fixedAssets">change the rules</Link>
                </p>
              )}
              {pv?.blocked && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${CHIP.warn}`}>{pv.blocked}</p>}
              {pv?.missing_accounts?.map((m) => <p key={m} className={`mt-2 rounded-lg px-3 py-2 text-sm ${CHIP.bad}`}>{m}</p>)}
            </Panel>

            {pv && (
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Month" value={pv.label} />
                <StatTile label="Assets charged" value={pv.asset_count} />
                <StatTile label="Depreciation" value={money(pv.total)} tone="brand" />
                <StatTile label="Journal lines" value={pv.journal.length} />
              </div>
            )}

            {pv && (
              <Panel className="mt-4" title={`Preview — ${pv.label}`} bodyClassName="">
                {loading ? <ListSkeleton rows={5} /> : !charged.length ? (
                  <EmptyState icon={Calculator} title="Nothing to depreciate" hint="No asset in service has depreciation due for this month." />
                ) : (
                  <>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className={TH_ROW}>
                            {["Asset", "Item", "Method", "Cost", "Opening NBV", "Month share", "Depreciation", "Closing NBV"].map((h, i) => (
                              <th key={h} className={`${TH} ${i >= 3 ? "text-right" : ""}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {charged.map((r) => (
                            <tr key={r.asset_id} className="border-b border-border">
                              <td className="px-3 py-2 font-mono font-semibold text-primary">{r.asset_label}</td>
                              <td className="px-3 py-2">{r.item}<span className="block text-[11px] text-muted-foreground">{r.category}</span></td>
                              <td className="px-3 py-2">{methodLabel(r.method)}{r.method === "RB" ? ` ${r.rb_rate}%` : r.life_months ? ` · ${r.life_months} m` : ""}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{money(r.cost)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{money(r.opening_nbv)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{Math.round(r.factor * 10000) / 100}%</td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(r.amount)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{money(r.closing_nbv)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="divide-y divide-border md:hidden">
                      {charged.map((r) => (
                        <div key={r.asset_id} className="px-4 py-3">
                          <p className="font-semibold">{r.item}</p>
                          <p className="text-[12px] text-muted-foreground">{r.asset_label} · {methodLabel(r.method)} · {Math.round(r.factor * 10000) / 100}% of the month</p>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                            <div><span className="block text-muted-foreground">Opening</span>{money(r.opening_nbv)}</div>
                            <div><span className="block text-muted-foreground">Charge</span><b>{money(r.amount)}</b></div>
                            <div><span className="block text-muted-foreground">Closing</span>{money(r.closing_nbv)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-border p-4">
                      <p className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-primary">Journal to be posted</p>
                      {pv.journal.map((l, i) => (
                        <div key={i} className="flex flex-wrap justify-between gap-2 py-1 text-sm">
                          <span className="min-w-0">{l.acno} · {l.narration}</span>
                          <span className="tabular-nums">{l.damt ? `Dr ${money(l.damt)}` : `Cr ${money(l.camt)}`}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Panel>
            )}

            <Panel className="mt-4" title="Runs" bodyClassName="divide-y divide-border">
              {!data?.runs?.length ? <EmptyState icon={Calculator} title="No runs yet" /> : data.runs.map((run) => (
                <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-semibold">{run.period}</span>{" "}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${run.status === "POSTED" ? CHIP.ok : CHIP.muted}`}>{run.status === "POSTED" ? "Posted" : "Reversed"}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {run.asset_count} asset(s) · {money(run.total)}
                      {run.reverse_reason ? ` · reversed: ${run.reverse_reason}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {run.jv_tran_id && <Link className="text-primary underline" href={voucherHref({ tran_id: run.jv_tran_id, tran_code: 3 })}>JV #{run.jv_tran_id}</Link>}
                    {run.reversal_tran_id && <Link className="text-primary underline" href={voucherHref({ tran_id: run.reversal_tran_id, tran_code: 3 })}>Reversal #{run.reversal_tran_id}</Link>}
                    {newestPosted?.id === run.id && <Button size="sm" variant="outline" onClick={() => reverse(run)}><Undo2 className="mr-1.5 h-4 w-4" />Reverse</Button>}
                  </div>
                </div>
              ))}
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}
