"use client";
// Accounting → Settings → Point of Sale (lib/pos/settingsConfig.js).
// The till's company choices — godown, walk-in account, categories sold, tax,
// rounding, discounts, returns window, receipt texts. Saved in the Settings row
// "posSettings" through PUT /api/settings/pos (settings.manage); everyone else
// sees it read-only. Posting accounts live in Account Settings → POS; short
// stock follows Stock checking → POS; credit sales / shifts are Features.
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Lock, RefreshCw, RotateCcw, Save, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { POS_SETTINGS_FIELDS, resolvePosSettings } from "@/lib/pos/settingsConfig";

export const POS_SETTINGS_QUERY_KEY = ["posSettings"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SECTIONS = ["Till", "Pricing", "Returns", "Receipt"];
const ACCOUNT_LABELS = {
  pos_sales: "POS Sales (default)",
  pos_cash: "POS Cash",
  pos_card: "POS Card / Bank",
  pos_tax: "POS Sales Tax Payable",
  pos_round_off: "POS Round Off",
};

const inputCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60";

export default function PosSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: POS_SETTINGS_QUERY_KEY,
    queryFn: async () => (await axios.get("/api/settings/pos")).data,
    staleTime: 60_000,
  });
  const saved = useMemo(() => data?.values ?? resolvePosSettings(null), [data]);
  const canEdit = Boolean(data?.canEdit);
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(saved), [saved]);

  const { data: godowns = [] } = useQuery({
    queryKey: ["posSettings", "godowns"],
    queryFn: async () => (await axios.get("/api/setup/godowns", { params: { includeInactive: true, limit: 1000 } })).data?.data || [],
    staleTime: 60_000,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["posSettings", "itemCategories"],
    queryFn: async () => (await axios.get("/api/setup/item_categories", { params: { limit: 1000 } })).data?.data || [],
    staleTime: 60_000,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["posSettings", "customers"],
    queryFn: async () => {
      const r = (await axios.get("/api/accounts/acno?group=customers")).data;
      return Array.isArray(r) ? r : r?.data || [];
    },
    staleTime: 60_000,
  });

  const changed = POS_SETTINGS_FIELDS.filter((f) => !same(draft[f.key], saved[f.key])).map((f) => f.key);
  const nonDefault = POS_SETTINGS_FIELDS.filter((f) => !same(saved[f.key], f.default)).length;
  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));

  const save = async (body, okText) => {
    setSaving(true);
    try {
      const res = await axios.put("/api/settings/pos", body);
      queryClient.setQueryData(POS_SETTINGS_QUERY_KEY, res.data);
      toast.success(res.data?.message || okText);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save the point of sale settings.");
    } finally {
      setSaving(false);
    }
  };
  const onSave = () => save({ values: Object.fromEntries(changed.map((k) => [k, draft[k]])) }, "Saved.");

  const control = (f) => {
    const v = draft[f.key];
    const disabled = !canEdit || saving;
    switch (f.type) {
      case "godown":
        return (
          <select value={v ?? ""} onChange={(e) => set(f.key, Number(e.target.value))} disabled={disabled} aria-label={f.label} className={`${inputCls} sm:w-64`}>
            {!godowns.some((x) => x.id === v) && <option value={v}>{`Godown ${v}`}</option>}
            {godowns.filter((x) => x.is_active !== false || x.id === v).map((x) => (
              <option key={x.id} value={x.id}>{x.godown}{x.is_active === false ? " (closed)" : ""}</option>
            ))}
          </select>
        );
      case "account":
        return (
          <select value={v ?? ""} onChange={(e) => set(f.key, e.target.value ? Number(e.target.value) : null)} disabled={disabled} aria-label={f.label} className={`${inputCls} sm:w-64`}>
            <option value="">— POS Cash / Card account —</option>
            {v != null && !customers.some((c) => c.acno === v) && <option value={v}>{`Account ${v}`}</option>}
            {customers.map((c) => <option key={c.acno} value={c.acno}>{c.acno} - {c.acname}</option>)}
          </select>
        );
      case "number":
        return (
          <input type="number" inputMode="decimal" min={f.min} max={f.max} value={v ?? ""} disabled={disabled} aria-label={f.label}
            onChange={(e) => set(f.key, e.target.value === "" ? f.default : Number(e.target.value))} className={`${inputCls} sm:w-32 text-right tabular-nums`} />
        );
      case "choice":
        return (
          <div role="radiogroup" aria-label={f.label} className="flex flex-wrap gap-1.5">
            {f.options.map((o) => (
              <button key={String(o.value)} type="button" role="radio" aria-checked={v === o.value} disabled={disabled} onClick={() => set(f.key, o.value)}
                className={`rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${v === o.value ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40 hover:text-primary"} disabled:opacity-60`}>
                {o.label}
              </button>
            ))}
          </div>
        );
      case "toggle":
        return <Switch checked={!!v} onCheckedChange={(x) => set(f.key, x)} disabled={disabled} aria-label={f.label} />;
      case "text":
        return <input type="text" value={v ?? ""} maxLength={f.max} disabled={disabled} aria-label={f.label} onChange={(e) => set(f.key, e.target.value)} className={`${inputCls} sm:w-64`} />;
      case "textarea":
        return <textarea rows={3} value={v ?? ""} maxLength={f.max} disabled={disabled} aria-label={f.label} onChange={(e) => set(f.key, e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm sm:w-96 disabled:opacity-60" />;
      case "categories": {
        const list = [...categories].sort((a, b) => String(a.ic_name).localeCompare(String(b.ic_name)));
        const toggle = (id) => set(f.key, (v || []).includes(id) ? v.filter((x) => x !== id) : [...(v || []), id].sort((a, b) => a - b));
        return (
          <div role="group" aria-label={f.label} className="flex flex-wrap gap-1.5">
            {list.map((c) => {
              const on = (v || []).includes(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => toggle(c.id)}
                  className={`rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40 hover:text-primary"} disabled:opacity-60`}>
                  {c.ic_name}
                </button>
              );
            })}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <section className="rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Store className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">Point of Sale</h2>
            <p className="text-[13px] text-muted-foreground">The till: where it sells from, who a walk-in bill is for, tax, rounding, discounts, refunds and the receipt.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} title="Reload">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          {canEdit && nonDefault > 0 && (
            <Button variant="outline" size="sm" onClick={() => save({ reset: true }, "Back to the defaults.")} disabled={saving}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Defaults
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={onSave} disabled={saving || changed.length === 0}>
              <Save className="mr-1.5 h-4 w-4" /> Save{changed.length ? ` (${changed.length})` : ""}
            </Button>
          )}
        </div>
      </header>

      {!canEdit && !isLoading && (
        <p className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground sm:mx-5">
          <Lock className="h-4 w-4 flex-shrink-0" /> Read only — changing these needs the Settings right.
        </p>
      )}

      <div className="divide-y divide-border">
        {SECTIONS.map((sec) => (
          <div key={sec} className="px-4 py-4 sm:px-5">
            <h3 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-primary">{sec}</h3>
            <ul className="space-y-3">
              {POS_SETTINGS_FIELDS.filter((f) => f.section === sec).map((f) => {
                const dirty = !same(draft[f.key], saved[f.key]);
                const wide = f.type === "categories" || f.type === "textarea";
                return (
                  <li key={f.key} className={`rounded-lg border p-3 ${dirty ? "border-primary/50 bg-primary/[0.03]" : "border-border"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 basis-64">
                        <p className="text-sm font-semibold text-foreground">
                          {f.label}
                          {!same(draft[f.key], f.default) && (
                            <span className="ml-2 rounded bg-[#fdf3e1] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#8a5a00]">changed from default</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{f.description}</p>
                      </div>
                      {!wide && <div className="w-full sm:w-auto">{control(f)}</div>}
                    </div>
                    {wide && <div className="mt-2.5">{control(f)}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="px-4 py-4 sm:px-5">
          <h3 className="mb-1 text-[12px] font-bold uppercase tracking-wider text-primary">Set elsewhere</h3>
          <p className="mb-3 text-[12.5px] text-muted-foreground">The accounts a POS sale posts to, short-stock checking and the company-wide POS switches.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(data?.accounts || []).map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
                <span className="text-muted-foreground">{ACCOUNT_LABELS[a.key] || a.key}</span>
                <span className={`truncate text-right font-medium ${a.acno ? "text-foreground" : "text-amber-700"}`}>{a.acno ? `${a.acno} - ${a.name || ""}` : "not set"}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/accounting/settings/accounts" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium hover:border-primary/40 hover:text-primary">
              Account settings → POS <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Link href="/accounting/settings?tab=stock" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium hover:border-primary/40 hover:text-primary">
              Stock checking → POS <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Link href="/accounting/settings?tab=features" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium hover:border-primary/40 hover:text-primary">
              Features → Point of sale <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
      {data?.changedAt && (
        <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground sm:px-5">
          Last changed {new Date(data.changedAt).toLocaleString()} {data.changedBy ? `· ${data.changedBy}` : ""}
        </p>
      )}
    </section>
  );
}
