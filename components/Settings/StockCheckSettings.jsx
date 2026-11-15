"use client";
// Accounting → Settings → Stock checking (lib/stock/policy.js).
// One mode per stock-out document type — No check / Warn / Block — saved in
// the Settings row "stockCheckPolicy" through PUT /api/settings/stock-check.
// Every stock-out save follows it (lib/stock/checkStock.js), and so do the
// forms. Holders of settings.manage change it; everyone else sees it read-only.
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Boxes, Info, RefreshCw, RotateCcw, Save, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStockPolicy, STOCK_POLICY_QUERY_KEY } from "@/hooks/useStockPolicy";
import { clearStockPolicyCache } from "@/lib/stock/policyClient";
import {
  STOCK_CHECK_TYPES,
  STOCK_MODES,
  MODE_LABELS,
  resolveStockPolicy,
} from "@/lib/stock/policyConfig";

const MODE_STYLE = {
  off: "bg-muted text-foreground",
  warn: "bg-[#fdf3e1] text-[#8a5a00] ring-1 ring-[#e9c46a]",
  block: "bg-primary text-primary-foreground",
};

const MODE_NOTES = [
  { mode: "off", text: "Not checked at all — the form does not limit the qty and the save never looks at stock." },
  { mode: "warn", text: "The shortage is shown in amber on the form and listed after the save, but the document is saved." },
  { mode: "block", text: "The form stops at the stock in the godown, and the save is refused while any item is short." },
];

function Segmented({ value, options, onChange, disabled, size = "md" }) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div role="radiogroup" className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-background p-1">
      {options.map((m) => {
        const on = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(m)}
            className={`rounded-md font-semibold transition-colors ${pad} ${
              on ? MODE_STYLE[m] : "text-muted-foreground hover:bg-primary/[0.06] hover:text-primary"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

// What the screen shows as chosen for a type: the saved choice, else the default.
const toDraft = (policy) => {
  const r = resolveStockPolicy(policy);
  return { modes: { ...r.modes }, explicit: { ...r.explicit }, allowNegativeGodowns: r.allowNegativeGodowns };
};

export default function StockCheckSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useStockPolicy();
  const canEdit = Boolean(data?.canEdit);
  const saved = useMemo(() => toDraft(data?.policy ?? null), [data]);
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(saved), [saved]);

  const changed = STOCK_CHECK_TYPES.filter(
    (t) => draft.modes[t.key] !== saved.modes[t.key] || draft.explicit[t.key] !== saved.explicit[t.key],
  ).length;

  const setMode = (key, mode) =>
    setDraft((d) => ({ ...d, modes: { ...d.modes, [key]: mode }, explicit: { ...d.explicit, [key]: true } }));

  const setAll = (mode) =>
    setDraft((d) => {
      const modes = {};
      const explicit = {};
      for (const t of STOCK_CHECK_TYPES) {
        const allowed = t.modes || STOCK_MODES;
        modes[t.key] = allowed.includes(mode) ? mode : allowed[allowed.length - 1];
        explicit[t.key] = true;
      }
      return { ...d, modes, explicit };
    });

  const allSame = STOCK_CHECK_TYPES.every((t) => draft.modes[t.key] === draft.modes[STOCK_CHECK_TYPES[0].key]);
  const allValue = allSame ? draft.modes[STOCK_CHECK_TYPES[0].key] : null;

  const afterSave = (res) => {
    clearStockPolicyCache();
    queryClient.setQueryData(STOCK_POLICY_QUERY_KEY, res.data);
    toast.success(res.data?.message || "Saved");
  };

  const save = async () => {
    setSaving(true);
    try {
      const types = {};
      for (const t of STOCK_CHECK_TYPES) if (draft.explicit[t.key]) types[t.key] = draft.modes[t.key];
      const res = await axios.put("/api/settings/stock-check", {
        policy: { default: null, types, allowNegativeGodowns: draft.allowNegativeGodowns },
      });
      afterSave(res);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not save stock checking");
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    if (!window.confirm("Put every document back to its default stock check?")) return;
    setSaving(true);
    try {
      afterSave(await axios.put("/api/settings/stock-check", { reset: true }));
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not reset stock checking");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Stock checking</h2>
            <p className="text-xs text-muted-foreground">What happens when a document takes out more than the godown holds</p>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {changed > 0 && (
              <span className="rounded-full bg-[#fdf3e1] px-2.5 py-1 text-xs font-semibold text-[#8a5a00]">
                {changed} {changed === 1 ? "change" : "changes"} not saved
              </span>
            )}
            {changed > 0 && (
              <Button variant="outline" onClick={() => setDraft(saved)} disabled={saving} className="h-10 gap-2 bg-background">
                <RefreshCw className="h-4 w-4" /> Undo
              </Button>
            )}
            <Button variant="outline" onClick={resetDefaults} disabled={saving} className="h-10 gap-2 bg-background">
              <RotateCcw className="h-4 w-4" /> Reset to defaults
            </Button>
            <Button onClick={save} disabled={saving || changed === 0} className="h-10 gap-2">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>

      {!canEdit && !isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 flex-shrink-0" />
          Read only — changing stock checking needs the “Change company settings” permission.
        </div>
      )}

      {/* Set all */}
      {canEdit && (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="border-b border-primary/15 bg-primary/5 px-4 py-3">
            <h3 className="text-[15px] font-semibold text-primary">Set all to</h3>
            <p className="text-xs text-muted-foreground">One switch for the whole system — e.g. Block to close stock everywhere. Then fine-tune below.</p>
          </div>
          <div className="p-4">
            <Segmented value={allValue} options={STOCK_MODES} onChange={setAll} disabled={saving} />
          </div>
        </div>
      )}

      {/* Per document type */}
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="border-b border-primary/15 bg-primary/5 px-4 py-3">
          <h3 className="text-[15px] font-semibold text-primary">Per document</h3>
          <p className="text-xs text-muted-foreground">Every save that takes stock out of a godown</p>
        </div>

        {isLoading ? (
          <div className="py-8 text-center">
            <RefreshCw className="mx-auto mb-3 h-7 w-7 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {STOCK_CHECK_TYPES.map((t) => {
              const mode = draft.modes[t.key];
              const isDefault = !draft.explicit[t.key];
              const screenDiffers = isDefault && t.screen && t.screen !== t.default;
              return (
                <li key={t.key} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 md:max-w-[60%]">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{t.label}</p>
                      {isDefault && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Default</span>
                      )}
                      {t.screenOnly && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Form only</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.covers}</p>
                    {screenDiffers && (
                      <p className="mt-1 text-xs text-[#8a5a00]">
                        Today the form limits to stock ({MODE_LABELS[t.screen]}) while the save only {t.default === "off" ? "does not check" : "warns"}.
                        Choose a mode to make both the same.
                      </p>
                    )}
                  </div>
                  {canEdit ? (
                    <Segmented
                      size="sm"
                      value={mode}
                      options={t.modes || STOCK_MODES}
                      onChange={(m) => setMode(t.key, m)}
                      disabled={saving}
                    />
                  ) : (
                    <span className={`inline-flex w-fit rounded-md px-2.5 py-1 text-xs font-semibold ${MODE_STYLE[mode]}`}>
                      {MODE_LABELS[mode]}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Modes explained */}
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
          <Info className="h-4 w-4" />
          Good to know
        </h3>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {MODE_NOTES.map((n) => (
            <li key={n.mode} className="flex gap-2">
              <span className={`mt-0.5 inline-flex h-fit flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${MODE_STYLE[n.mode]}`}>
                {MODE_LABELS[n.mode]}
              </span>
              <span>{n.text}</span>
            </li>
          ))}
          <li>Stock is the godown&apos;s latest monthly opening plus every movement since (control rows excluded). Editing a document leaves its own saved lines out.</li>
          <li>Closed godowns are refused as before; the Despatch Without Godown godown is never checked.</li>
          <li>A change reaches every screen within about 30 seconds. Who changed it is in the Audit Trail.</li>
        </ul>
        {data?.changedAt && (
          <p className="mt-3 text-xs text-muted-foreground">
            Last changed {new Date(data.changedAt).toLocaleString()} {data.changedBy ? `· ${data.changedBy}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
