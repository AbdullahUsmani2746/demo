"use client";
// Accounting → Settings → Features (lib/features/catalog.js).
// The business flows a company switches on / off or chooses between — the
// places where SMS, Eastland and Accounting worked differently. Saved in the
// Settings row "featureFlags" through PUT /api/settings/features. Holders of
// settings.manage change them; everyone else sees them read-only.
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Lock, RefreshCw, RotateCcw, Save, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useFeatures, FEATURES_QUERY_KEY } from "@/hooks/useFeatures";
import { FEATURES, FEATURE_GROUPS } from "@/lib/features/catalog";

function Choice({ def, value, onChange, disabled }) {
  return (
    <div role="radiogroup" aria-label={def.label} className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-background p-1">
      {def.options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-1.5 text-left text-sm font-semibold transition-colors ${
              on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-primary/[0.06] hover:text-primary"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className="block">{o.label}</span>
            <span className={`block text-[11px] font-normal ${on ? "text-white/80" : "text-muted-foreground"}`}>{o.origin}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function FeatureSettings() {
  const queryClient = useQueryClient();
  const { data, values, isLoading, refetch, isFetching } = useFeatures();
  const canEdit = Boolean(data?.canEdit);
  const [draft, setDraft] = useState(values);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(values), [values]);

  const changedKeys = useMemo(() => FEATURES.filter((f) => draft[f.key] !== values[f.key]).map((f) => f.key), [draft, values]);
  const nonDefault = FEATURES.filter((f) => values[f.key] !== f.default).length;
  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));

  const save = async (body, okText) => {
    setSaving(true);
    try {
      const res = await axios.put("/api/settings/features", body);
      queryClient.setQueryData(FEATURES_QUERY_KEY, res.data);
      toast.success(res.data?.message || okText);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save the features.");
    } finally {
      setSaving(false);
    }
  };
  const onSave = () => save({ values: Object.fromEntries(changedKeys.map((k) => [k, draft[k]])) }, "Features saved.");
  const onReset = () => save({ reset: true }, "Features are back to the defaults.");

  return (
    <section className="rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ToggleRight className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">Features</h2>
            <p className="text-[13px] text-muted-foreground">
              Switch business flows on or off for this company. Each change applies to every user within a few seconds.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} title="Reload">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          {canEdit && nonDefault > 0 && (
            <Button variant="outline" size="sm" onClick={onReset} disabled={saving}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Defaults
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={onSave} disabled={saving || changedKeys.length === 0}>
              <Save className="mr-1.5 h-4 w-4" /> Save{changedKeys.length ? ` (${changedKeys.length})` : ""}
            </Button>
          )}
        </div>
      </header>

      {!canEdit && !isLoading && (
        <p className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground sm:mx-5">
          <Lock className="h-4 w-4 flex-shrink-0" /> Read only — changing features needs the Settings right.
        </p>
      )}

      <div className="divide-y divide-border">
        {FEATURE_GROUPS.map((g) => {
          const items = FEATURES.filter((f) => f.group === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id} className="px-4 py-4 sm:px-5">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-primary">{g.title}</h3>
              <p className="mb-3 text-[12.5px] text-muted-foreground">{g.description}</p>
              <ul className="space-y-3">
                {items.map((f) => {
                  const v = draft[f.key];
                  const dirty = v !== values[f.key];
                  return (
                    <li key={f.key} className={`rounded-lg border p-3 ${dirty ? "border-primary/50 bg-primary/[0.03]" : "border-border"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 basis-64">
                          <p className="text-sm font-semibold text-foreground">
                            {f.label}
                            {v !== f.default && <span className="ml-2 rounded bg-[#fdf3e1] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#8a5a00]">changed from default</span>}
                          </p>
                          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{f.description}</p>
                          {f.type === "toggle" && f.origin && (
                            <p className="mt-1 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                              <Info className="h-3.5 w-3.5" /> On: {f.origin.on} · Off: {f.origin.off}
                            </p>
                          )}
                        </div>
                        {f.type === "toggle" ? (
                          <label className="flex items-center gap-2 text-sm font-medium">
                            <Switch checked={!!v} onCheckedChange={(c) => set(f.key, c)} disabled={!canEdit || saving} aria-label={f.label} />
                            {v ? "On" : "Off"}
                          </label>
                        ) : (
                          <Choice def={f} value={v} onChange={(x) => set(f.key, x)} disabled={!canEdit || saving} />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {data?.changedAt && (
        <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground sm:px-5">
          Last changed {new Date(data.changedAt).toLocaleString()} {data.changedBy ? `· ${data.changedBy}` : ""}
        </p>
      )}
    </section>
  );
}
