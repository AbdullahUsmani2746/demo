"use client";
// Accounting → Settings → Fixed assets (/api/fixed-assets/settings).
// Company rules (lib/fixedAssets/settingsDefs.js: default method / life /
// rate / salvage, first and last month, reducing balance end of life, GRN
// capitalisation, minimum capitalisation value, asset number format) and the
// per-category defaults + four posting accounts (fa_category_defaults; blank =
// the company default / Finance → Account Settings → Fixed Assets).
// Holders of settings.manage change them; everyone else sees them read-only.
// Which flows run at all is Settings → Features → Fixed assets.
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Building2, Save, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, api } from "@/components/HR/shared";

export default function FixedAssetSettings() {
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [cats, setCats] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api("/api/fixed-assets/settings");
      setData(r);
      setValues(r.settings);
      setCats(r.categories);
    } catch (e) {
      toast.error(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const ro = !data.canEdit;
  const setV = (k, v) => setValues((s) => ({ ...s, [k]: v }));
  const setC = (i, k, v) => setCats((list) => list.map((c, j) => (j === i ? { ...c, [k]: v } : c)));

  const save = async () => {
    setSaving(true);
    try {
      const settings = Object.fromEntries(data.defs.map((d) => [d.key, d.type === "number" ? Number(values[d.key]) : values[d.key]]));
      const categories = cats.map((c) => ({
        ic_id: c.ic_id, method: c.method || null, useful_life_months: c.useful_life_months, rb_rate: c.rb_rate, salvage_pct: c.salvage_pct,
        ...Object.fromEntries(data.accountColumns.map((a) => [a.col, c[a.col]])),
      }));
      const r = await api("/api/fixed-assets/settings", { method: "PUT", body: { settings, categories } });
      toast.success(r.message);
      setData(r);
      setValues(r.settings);
      setCats(r.categories);
    } catch (e) {
      toast.error(e.data?.errors ? Object.values(e.data.errors).join(" · ") : e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Fixed assets</h2>
            <p className="text-[12.5px] text-muted-foreground">
              How assets are depreciated and posted. Switch the flows on in <Link className="text-primary underline" href="/accounting/settings?tab=features">Features</Link>;
              default accounts in <Link className="text-primary underline" href="/accounting/settings/accounts">Account settings</Link>.
            </p>
          </div>
        </div>
        {ro ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Lock className="h-3.5 w-3.5" />Read-only (settings.manage)</span>
        ) : (
          <Button onClick={save} disabled={saving} className="max-sm:w-full"><Save className="mr-1.5 h-4 w-4" />{saving ? "Saving…" : "Save"}</Button>
        )}
      </div>

      {data.groups.map((g) => (
        <section key={g.id} className="rounded-xl border border-border">
          <div className="border-b border-primary/15 bg-primary/5 px-4 py-2.5">
            <h3 className="text-sm font-bold text-primary">{g.title}</h3>
            <p className="text-[12px] text-muted-foreground">{g.description}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
            {data.defs.filter((d) => d.group === g.id).map((d) => (
              <label key={d.key} className="block min-w-0 text-sm">
                <span className="mb-1 block font-semibold">{d.label}</span>
                {d.type === "choice" ? (
                  <NativeSelect className="w-full" value={values[d.key]} disabled={ro} onChange={(e) => setV(d.key, e.target.value)}>
                    {d.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </NativeSelect>
                ) : (
                  <Input type={d.type === "number" ? "number" : "text"} value={values[d.key] ?? ""} disabled={ro} onChange={(e) => setV(d.key, e.target.value)} />
                )}
                <span className="mt-1 block text-[11.5px] text-muted-foreground">
                  {d.type === "choice" ? d.options.find((o) => o.value === values[d.key])?.help : d.help}
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-border">
        <div className="border-b border-primary/15 bg-primary/5 px-4 py-2.5">
          <h3 className="text-sm font-bold text-primary">Categories</h3>
          <p className="text-[12px] text-muted-foreground">
            Per fixed-asset category; blank = the company default above (accounts: {data.accountDefaults.map((a) => `${a.label} ${a.acno ? `${a.acno}` : "not set"}`).join(" · ")}).
          </p>
        </div>
        {!cats.length ? (
          <p className="p-4 text-sm text-muted-foreground">No fixed-asset categories yet (Setup → Fixed Asset Categories).</p>
        ) : (
          <div className="divide-y divide-border">
            {cats.map((c, i) => (
              <div key={c.ic_id} className="p-4">
                <p className="mb-2 font-semibold">{c.name}</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <label className="text-[12px]"><span className="mb-1 block text-muted-foreground">Method</span>
                    <NativeSelect className="w-full" value={c.method ?? ""} disabled={ro} onChange={(e) => setC(i, "method", e.target.value)}>
                      <option value="">Default</option>
                      {data.methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </NativeSelect>
                  </label>
                  <label className="text-[12px]"><span className="mb-1 block text-muted-foreground">Life (months)</span><Input type="number" value={c.useful_life_months ?? ""} disabled={ro} onChange={(e) => setC(i, "useful_life_months", e.target.value)} /></label>
                  <label className="text-[12px]"><span className="mb-1 block text-muted-foreground">Rate % a year</span><Input type="number" value={c.rb_rate ?? ""} disabled={ro} onChange={(e) => setC(i, "rb_rate", e.target.value)} /></label>
                  <label className="text-[12px]"><span className="mb-1 block text-muted-foreground">Salvage %</span><Input type="number" value={c.salvage_pct ?? ""} disabled={ro} onChange={(e) => setC(i, "salvage_pct", e.target.value)} /></label>
                  {data.accountColumns.map((a) => (
                    <label key={a.col} className="text-[12px]" title={a.help}>
                      <span className="mb-1 block text-muted-foreground">{a.label} (acno)</span>
                      <Input type="number" value={c[a.col] ?? ""} disabled={ro} onChange={(e) => setC(i, a.col, e.target.value)} />
                      {c[`${a.col}_name`] && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{c[`${a.col}_name`]}</span>}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
