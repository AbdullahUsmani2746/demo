"use client";
// Costing method + "Semi-finished CC from" month on Production Costing.
// Feature costing.semiFinishedCC (lib/costing/ccPolicy.js, /api/costing/semi-cc):
// hidden while the feature is off. Saving needs period.lock (checked by the API).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeatures } from "@/hooks/useFeatures";
import { MONTHS } from "@/components/Costing/CostingUI";

const label = (f) => (f ? `${MONTHS[f.month - 1]?.label ?? MONTHS[f.month - 1] ?? f.month} ${f.year}` : "");

export default function SemiCcPanel({ month, year }) {
  const { on, value } = useFeatures();
  const semiOn = on("costing.semiFinishedCC");
  const method = value("costing.method");
  const [from, setFrom] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!semiOn) return;
    fetch("/api/costing/semi-cc")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFrom(d?.from ?? null))
      .catch(() => {});
  }, [semiOn]);

  async function save(action) {
    setBusy(true);
    try {
      const r = await fetch("/api/costing/semi-cc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, month: Number(month), year: Number(year) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not save");
      setFrom(d.from ?? null);
      toast.success(d.from ? `Semi-finished goods receive CC from ${label(d.from)}` : "Semi-finished goods no longer receive CC");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (method !== "blendedCC" && !semiOn) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background p-3 text-xs">
      <span className="text-muted-foreground">
        Costing method:{" "}
        <strong className="text-foreground">{method === "blendedCC" ? "Blended issue rate, CC through stages" : "Weighted average"}</strong>
      </span>
      {semiOn && (
        <>
          <span className="text-muted-foreground sm:ml-4">
            Semi-finished CC from:{" "}
            <strong className="text-foreground">{from ? label(from) : "not set (finished goods only)"}</strong>
          </span>
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            <Button size="sm" variant="outline" className="h-8 flex-1 sm:flex-none" disabled={busy} onClick={() => save("enable")}>
              Start from {label({ month: Number(month), year: Number(year) })}
            </Button>
            {from && (
              <Button size="sm" variant="ghost" className="h-8 flex-1 sm:flex-none" disabled={busy} onClick={() => save("disable")}>
                Clear
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
