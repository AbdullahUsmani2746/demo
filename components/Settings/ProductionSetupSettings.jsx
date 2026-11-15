"use client";
// Accounting → Settings → Production setup (lib/production/setupConfig.js).
// Which item categories are finished goods / semi finished / raw / packing
// material, and which godowns production uses — values that used to be fixed
// numbers in the code. Saved in the Settings row "productionSetup" through
// PUT /api/settings/production-setup. Holders of settings.manage change it;
// everyone else sees it read-only.
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory, Lock, RefreshCw, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProductionSetup, PRODUCTION_SETUP_QUERY_KEY } from "@/hooks/useProductionSetup";
import { PRODUCTION_SETUP_FIELDS, categoryOverlapError } from "@/lib/production/setupConfig";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function CategoryPicker({ field, value, categories, takenBy, onChange, disabled }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id].sort((a, b) => a - b));
  return (
    <div role="group" aria-label={field.label} className="flex flex-wrap gap-1.5">
      {categories.map((c) => {
        const on = value.includes(c.id);
        const other = !on && takenBy.get(c.id);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(c.id)}
            title={other ? `Also set as ${other}` : undefined}
            className={`rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
              on
                ? "border-primary bg-primary text-primary-foreground"
                : other
                  ? "border-dashed border-border text-muted-foreground/70 hover:border-primary/40"
                  : "border-border text-foreground/85 hover:border-primary/40 hover:text-primary"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {c.ic_name}
            <span className={`ml-1 text-[10.5px] ${on ? "text-white/75" : "text-muted-foreground"}`}>#{c.id}</span>
          </button>
        );
      })}
      {categories.length === 0 && <span className="text-[12.5px] text-muted-foreground">No item categories.</span>}
    </div>
  );
}

export default function ProductionSetupSettings() {
  const queryClient = useQueryClient();
  const { data, setup, isLoading, refetch, isFetching } = useProductionSetup();
  const canEdit = Boolean(data?.canEdit);
  const [draft, setDraft] = useState(setup);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(setup), [setup]);

  const { data: categories = [] } = useQuery({
    queryKey: ["productionSetup", "itemCategories"],
    queryFn: async () => (await axios.get("/api/setup/item_categories", { params: { limit: 1000 } })).data?.data || [],
    staleTime: 60_000,
  });
  const { data: godowns = [] } = useQuery({
    queryKey: ["productionSetup", "godowns"],
    queryFn: async () => (await axios.get("/api/setup/godowns", { params: { includeInactive: true, limit: 1000 } })).data?.data || [],
    staleTime: 60_000,
  });
  const sortedCats = useMemo(() => [...categories].sort((a, b) => a.id - b.id), [categories]);

  const changed = PRODUCTION_SETUP_FIELDS.filter((f) => !same(draft[f.key], setup[f.key])).map((f) => f.key);
  const nonDefault = PRODUCTION_SETUP_FIELDS.filter((f) => !same(setup[f.key], f.default)).length;
  const overlap = categoryOverlapError(draft);
  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));

  const save = async (body, okText) => {
    setSaving(true);
    try {
      const res = await axios.put("/api/settings/production-setup", body);
      queryClient.setQueryData(PRODUCTION_SETUP_QUERY_KEY, res.data);
      toast.success(res.data?.message || okText);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save the production setup.");
    } finally {
      setSaving(false);
    }
  };
  const onSave = () => save({ values: Object.fromEntries(changed.map((k) => [k, draft[k]])) }, "Production setup saved.");
  const onReset = () => save({ reset: true }, "Production setup is back to the defaults.");

  // which kind each category already is (to show a category is one kind only)
  const kindOf = (exceptKey) => {
    const m = new Map();
    for (const f of PRODUCTION_SETUP_FIELDS) {
      if (f.type !== "categories" || f.key === exceptKey) continue;
      for (const id of draft[f.key] || []) m.set(id, f.label);
    }
    return m;
  };

  return (
    <section className="rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Factory className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">Production setup</h2>
            <p className="text-[13px] text-muted-foreground">
              Which item categories are finished goods, semi finished, raw and packing material, and the godowns production uses.
              BOMs, process orders, costing and the production reports follow it.
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
            <Button size="sm" onClick={onSave} disabled={saving || changed.length === 0 || !!overlap}>
              <Save className="mr-1.5 h-4 w-4" /> Save{changed.length ? ` (${changed.length})` : ""}
            </Button>
          )}
        </div>
      </header>

      {!canEdit && !isLoading && (
        <p className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground sm:mx-5">
          <Lock className="h-4 w-4 flex-shrink-0" /> Read only — changing the production setup needs the Settings right.
        </p>
      )}
      {overlap && (
        <p className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive sm:mx-5">{overlap}</p>
      )}

      <div className="divide-y divide-border">
        {[
          { type: "categories", title: "Item categories", description: "Tick the categories of each kind. A category is one kind only; one that is none of them is left alone." },
          { type: "godown", title: "Godowns", description: "Defaults — a process order may still pick another godown per line." },
        ].map((g) => (
          <div key={g.type} className="px-4 py-4 sm:px-5">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-primary">{g.title}</h3>
            <p className="mb-3 text-[12.5px] text-muted-foreground">{g.description}</p>
            <ul className="space-y-3">
              {PRODUCTION_SETUP_FIELDS.filter((f) => f.type === g.type).map((f) => {
                const v = draft[f.key];
                const dirty = !same(v, setup[f.key]);
                return (
                  <li key={f.key} className={`rounded-lg border p-3 ${dirty ? "border-primary/50 bg-primary/[0.03]" : "border-border"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 basis-64">
                        <p className="text-sm font-semibold text-foreground">
                          {f.label}
                          {!same(v, f.default) && (
                            <span className="ml-2 rounded bg-[#fdf3e1] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#8a5a00]">changed from default</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{f.description}</p>
                      </div>
                      {f.type === "godown" && (
                        <select
                          value={v ?? ""}
                          onChange={(e) => set(f.key, Number(e.target.value))}
                          disabled={!canEdit || saving}
                          aria-label={f.label}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm sm:w-64"
                        >
                          {!godowns.some((x) => x.id === v) && <option value={v}>{`Godown ${v}`}</option>}
                          {godowns
                            .filter((x) => x.is_active !== false || x.id === v)
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.godown}
                                {x.is_active === false ? " (closed)" : ""}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                    {f.type === "categories" && (
                      <div className="mt-2.5">
                        <CategoryPicker
                          field={f}
                          value={v || []}
                          categories={sortedCats}
                          takenBy={kindOf(f.key)}
                          onChange={(x) => set(f.key, x)}
                          disabled={!canEdit || saving}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {data?.changedAt && (
        <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground sm:px-5">
          Last changed {new Date(data.changedAt).toLocaleString()} {data.changedBy ? `· ${data.changedBy}` : ""}
        </p>
      )}
    </section>
  );
}
