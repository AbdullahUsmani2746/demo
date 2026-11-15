"use client";
// Fixed Assets → Register (lib/fixedAssets/register.js, /api/fixed-assets).
// Every asset with cost, accumulated depreciation, NBV, holder and status.
// A row opens the asset: its own overrides (until the first depreciation is
// posted), holder (only while the Relocation voucher is switched off), the
// movement history, the depreciation schedule and — for a disposed asset —
// "Reverse disposal" (fixedAsset.dispose). Reports: FIXED ASSET REPORTS.
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Building2, Search, RefreshCw, Undo2, Save, History, CalendarRange, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { HR_PAGE, HR_MAIN, PageHeader, Panel, StatTile, EmptyState, NativeSelect, ListSkeleton, TH, TH_ROW, CHIP, api } from "@/components/HR/shared";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import { methodLabel } from "@/lib/fixedAssets/settingsDefs";

const money = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FROM = { asset: "this asset", category: "category", company: "company default" };

function StatusBadge({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status === "DISPOSED" ? CHIP.bad : CHIP.ok}`}>{status === "DISPOSED" ? "Disposed" : "In use"}</span>;
}

function Field({ label, children, hint }) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function AssetSheet({ id, meta, onClose, onChanged }) {
  const [asset, setAsset] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [depts, setDepts] = useState([]);
  const [emps, setEmps] = useState([]);
  const [locs, setLocs] = useState([]);

  const load = async () => {
    try {
      const { data } = await api(`/api/fixed-assets/${id}`);
      setAsset(data);
      setForm({
        method: data.method ?? "", useful_life_months: data.useful_life_months ?? "", rb_rate: data.rb_rate ?? "",
        salvage_value: data.salvage_value ?? "", in_service_date: data.in_service, opening_accumulated: data.opening_accumulated ?? 0,
        cost: data.cost, department_id: data.department_id ?? "", employee_id: data.employee_id ?? "", location_id: data.location_id ?? "",
        remarks: data.remarks ?? "",
      });
    } catch (e) {
      toast.error(e.message);
    }
  };
  useEffect(() => {
    if (!id) return;
    setAsset(null);
    load();
    Promise.all([api("/api/setup/departments?limit=500"), api("/api/setup/employees?limit=1000"), api("/api/setup/work_locations?limit=500")])
      .then(([d, e, l]) => { setDepts(d.data || d || []); setEmps(e.data || e || []); setLocs(l.data || l || []); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      const body = { remarks: form.remarks };
      if (asset.editable) {
        Object.assign(body, {
          method: form.method || null, useful_life_months: form.useful_life_months, rb_rate: form.rb_rate,
          salvage_value: form.salvage_value, in_service_date: form.in_service_date, opening_accumulated: form.opening_accumulated,
        });
        if (asset.cost_editable) body.cost = form.cost;
      }
      if (asset.holder_editable) Object.assign(body, { department_id: form.department_id, employee_id: form.employee_id, location_id: form.location_id });
      await api(`/api/fixed-assets/${id}`, { method: "PUT", body });
      toast.success("Asset saved");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  const reverse = async () => {
    const reason = window.prompt("Why is this disposal reversed?");
    if (!reason) return;
    try {
      const r = await api(`/api/fixed-assets/disposals/${asset.disposal.tran_id}/reverse`, { method: "POST", body: { reason } });
      toast.success(r.message);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{asset ? `${asset.asset_label} — ${asset.item ?? ""}` : "Asset"}</SheetTitle>
          <SheetDescription>{asset ? `${asset.category ?? "No category"} · in service ${asset.in_service}` : "Loading…"}</SheetDescription>
        </SheetHeader>
        {!asset ? <ListSkeleton rows={6} /> : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Cost" value={money(asset.cost)} />
              <StatTile label="Accumulated" value={money(asset.accumulated)} />
              <StatTile label="Net book value" value={money(asset.nbv)} tone="brand" />
              <StatTile label="Status" value={asset.status === "DISPOSED" ? "Disposed" : "In use"} tone={asset.status === "DISPOSED" ? "red" : "emerald"} />
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {asset.grn_tran_id && <Link className="text-primary underline" href={voucherHref({ tran_id: asset.grn_tran_id, tran_code: 14 })}>Fixed Assets GRN #{asset.grn_tran_id}</Link>}
              {asset.capitalisation_tran_id && <Link className="text-primary underline" href={voucherHref({ tran_id: asset.capitalisation_tran_id, tran_code: 3 })}>Capitalisation JV #{asset.capitalisation_tran_id}</Link>}
            </div>

            <Panel title="Depreciation rules" icon={Settings2} bodyClassName="p-4">
              <p className="mb-3 text-[12.5px] text-muted-foreground">
                In use now: {methodLabel(asset.rules.method)} ({FROM[asset.rules.from.method]}), life {asset.rules.lifeMonths ?? "—"} months ({FROM[asset.rules.from.lifeMonths]}),
                {asset.rules.method === "RB" ? ` rate ${asset.rules.rbRate}% (${FROM[asset.rules.from.rbRate]}),` : ""} salvage {money(asset.rules.salvage)} ({FROM[asset.rules.from.salvage]}).
                {!asset.editable && " Fixed now — depreciation is posted (or the asset is disposed of)."} Blank = the category / company default.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Method">
                  <NativeSelect className="w-full" value={form.method} onChange={set("method")} disabled={!asset.editable}>
                    <option value="">Default</option>
                    <option value="SL">Straight line</option>
                    <option value="RB">Reducing balance</option>
                  </NativeSelect>
                </Field>
                <Field label="Useful life (months)"><Input type="number" value={form.useful_life_months} onChange={set("useful_life_months")} disabled={!asset.editable} /></Field>
                <Field label="Reducing balance rate % a year"><Input type="number" value={form.rb_rate} onChange={set("rb_rate")} disabled={!asset.editable} /></Field>
                <Field label="Salvage value"><Input type="number" value={form.salvage_value} onChange={set("salvage_value")} disabled={!asset.editable} /></Field>
                <Field label="In-service date"><Input type="date" value={form.in_service_date} onChange={set("in_service_date")} disabled={!asset.editable} /></Field>
                <Field label="Accumulated depreciation brought forward"><Input type="number" value={form.opening_accumulated} onChange={set("opening_accumulated")} disabled={!asset.editable} /></Field>
                <Field label="Cost" hint={asset.capitalisation_tran_id ? "Posted by the capitalisation journal." : undefined}>
                  <Input type="number" value={form.cost} onChange={set("cost")} disabled={!asset.cost_editable} />
                </Field>
              </div>
            </Panel>

            <Panel title="Holder" icon={Building2} bodyClassName="p-4">
              {!asset.holder_editable && asset.status === "IN_USE" && (
                <p className="mb-3 text-[12.5px] text-muted-foreground">Moved with a <Link className="text-primary underline" href="/accounting/report/fixedAssetRelocation">Fixed Asset Relocation</Link> voucher.</p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Department">
                  <NativeSelect className="w-full" value={form.department_id} onChange={set("department_id")} disabled={!asset.holder_editable}>
                    <option value="">—</option>
                    {depts.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Employee">
                  <NativeSelect className="w-full" value={form.employee_id} onChange={set("employee_id")} disabled={!asset.holder_editable}>
                    <option value="">—</option>
                    {emps.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.surname}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Location">
                  <NativeSelect className="w-full" value={form.location_id} onChange={set("location_id")} disabled={!asset.holder_editable}>
                    <option value="">—</option>
                    {locs.map((l) => <option key={l.id} value={l.id}>{l.location_name}</option>)}
                  </NativeSelect>
                </Field>
              </div>
              <div className="mt-3"><Field label="Remarks"><Input value={form.remarks} onChange={set("remarks")} /></Field></div>
              <div className="mt-3 flex justify-end">
                <Button onClick={save} disabled={saving} className="max-sm:w-full"><Save className="mr-1.5 h-4 w-4" />{saving ? "Saving…" : "Save"}</Button>
              </div>
            </Panel>

            {asset.disposal && (
              <Panel title="Disposal" icon={Undo2} bodyClassName="p-4 text-sm">
                <p>{asset.disposal.kind === "SALE" ? "Sold" : "Scrapped"} on {String(asset.disposal.dated).slice(0, 10)} — proceeds {money(asset.disposal.proceeds)}, NBV {money(asset.disposal.nbv)}, {asset.disposal.gain_loss >= 0 ? "gain" : "loss"} {money(Math.abs(asset.disposal.gain_loss))}.</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Link className="text-primary underline" href={voucherHref({ tran_id: asset.disposal.tran_id, tran_code: 15 })}>Disposal voucher #{asset.disposal.tran_id}</Link>
                  {asset.disposal.jv_tran_id && <Link className="text-primary underline" href={voucherHref({ tran_id: asset.disposal.jv_tran_id, tran_code: 3 })}>Disposal JV #{asset.disposal.jv_tran_id}</Link>}
                  {meta?.canDispose && <Button variant="outline" size="sm" onClick={reverse}><Undo2 className="mr-1.5 h-4 w-4" />Reverse disposal</Button>}
                </div>
              </Panel>
            )}

            <Panel title="History" icon={History} bodyClassName="divide-y divide-border text-sm">
              {asset.movements.map((m) => (
                <div key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                  <span className="font-semibold">{m.dated} · {m.kind.replace("_", " ").toLowerCase()}</span>
                  <span className="text-muted-foreground">{m.from !== "—" ? `${m.from} → ` : ""}{m.to}</span>
                </div>
              ))}
            </Panel>

            {asset.schedule?.length > 0 && (
              <Panel title="Depreciation schedule" icon={CalendarRange} actions={<Link className="text-sm text-primary underline" href={`/accounting/reports/fixedAssetSchedule?asset=${asset.asset_no}&status=all`}>Full report</Link>} bodyClassName="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className={TH_ROW}><th className={TH}>Month</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Depreciation</th><th className={`${TH} text-right`}>Closing NBV</th></tr></thead>
                  <tbody>
                    {asset.schedule.slice(0, 24).map((s) => (
                      <tr key={s.period} className="border-b border-border">
                        <td className="px-3 py-1.5">{s.period}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{s.status.toLowerCase()}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(s.amount)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(s.closing_nbv)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function FixedAssetRegisterPage() {
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [totals, setTotals] = useState({ cost: 0, accumulated: 0, nbv: 0 });
  const [status, setStatus] = useState("IN_USE");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const r = await api(`/api/fixed-assets?status=${status}`);
      setRows(r.data);
      setTotals(r.totals);
      setMeta(r.meta);
      setError(null);
    } catch (e) {
      setError(e.message);
      setRows([]);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (rows || []).filter((a) => !t || [a.asset_label, a.item, a.category, a.department, a.employee, a.location].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [rows, search]);

  const backfill = async () => {
    try {
      const r = await api("/api/fixed-assets", { method: "POST", body: { action: "backfill" } });
      toast.success(r.message);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={Building2}
        title="Fixed Asset Register"
        subtitle="Every asset with its cost, accumulated depreciation, net book value and holder."
        badge={rows ? shown.length : undefined}
        actions={
          <>
            <Button variant="outline" onClick={backfill} title="Register asset units of Fixed Assets GRNs saved before the register existed (no journals)">
              <RefreshCw className="mr-1.5 h-4 w-4" />Register old GRNs
            </Button>
            <Button asChild variant="outline"><Link href="/accounting/reports/fixedAssetRegister">Register report</Link></Button>
          </>
        }
      />
      <main className={HR_MAIN}>
        <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Assets" value={shown.length} />
          <StatTile label="Cost" value={money(totals.cost)} />
          <StatTile label="Accumulated depreciation" value={money(totals.accumulated)} />
          <StatTile label="Net book value" value={money(totals.nbv)} tone="brand" />
        </div>
        <Panel
          className="mt-4"
          title="Assets"
          actions={
            <>
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search asset, item, holder…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="IN_USE">In use</option>
                <option value="DISPOSED">Disposed</option>
                <option value="all">All</option>
              </NativeSelect>
            </>
          }
        >
          {rows === null ? <ListSkeleton rows={6} /> : error ? (
            <EmptyState icon={Building2} title="Cannot open the register" hint={error} />
          ) : !shown.length ? (
            <EmptyState icon={Building2} title="No assets" hint="Assets join the register when a Fixed Assets GRN is saved (Settings → Features → Fixed assets)." />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      {["Asset No", "Item", "Category", "In service", "Method", "Cost", "Accumulated", "NBV", "Holder", "Status"].map((h, i) => (
                        <th key={h} className={`${TH} ${i >= 5 && i <= 7 ? "text-right" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((a) => (
                      <tr key={a.id} onClick={() => setOpen(a.id)} className="cursor-pointer border-b border-border hover:bg-primary/[0.03]">
                        <td className="px-3 py-2 font-mono font-semibold text-primary">{a.asset_label}</td>
                        <td className="px-3 py-2">{a.item}</td>
                        <td className="px-3 py-2 text-muted-foreground">{a.category}</td>
                        <td className="px-3 py-2 tabular-nums">{a.in_service}</td>
                        <td className="px-3 py-2">{methodLabel(a.rules.method)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(a.cost)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(a.accumulated)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(a.nbv)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{[a.department, a.employee].filter(Boolean).join(" / ") || "—"}</td>
                        <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {shown.map((a) => (
                  <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="block w-full px-4 py-3 text-left">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{a.item}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{a.asset_label} · {a.category} · {a.department ?? "—"}</p>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                      <div><span className="block text-muted-foreground">Cost</span><span className="tabular-nums">{money(a.cost)}</span></div>
                      <div><span className="block text-muted-foreground">Accum.</span><span className="tabular-nums">{money(a.accumulated)}</span></div>
                      <div><span className="block text-muted-foreground">NBV</span><span className="font-semibold tabular-nums">{money(a.nbv)}</span></div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </Panel>
      </main>
      <AssetSheet id={open} meta={meta} onClose={() => setOpen(null)} onChanged={load} />
    </div>
  );
}
