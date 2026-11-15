"use client";
// components/bi/designer/DataAccess.jsx — which datasets each department may
// use on its dashboards. Nothing ticked = no limit (every dataset). Row limits
// (godowns, customers …) are separate: Admin → Permissions → Data scope.
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { Panel, SmallBtn } from "./ui";

export default function DataAccess() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState({});
  const [error, setError] = useState(null);

  async function load() {
    try {
      const { data: d } = await axios.get("/api/bi/access");
      setData(d);
      setDraft(Object.fromEntries(d.departments.map((dep) => [dep.id, d.access[dep.id] ?? []])));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function save(depId) {
    setBusy(depId);
    try {
      await axios.put("/api/bi/access", { departmentId: depId, datasets: draft[depId] ?? [] });
      setMsg((m) => ({ ...m, [depId]: null }));
      toast.success("Data access saved");
    } catch (e) {
      setMsg((m) => ({ ...m, [depId]: e.response?.data?.error || e.message }));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
        Could not load data access: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-xl border border-border bg-background" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Tick the datasets a department&apos;s dashboards may use — e.g. SCM: Purchases + Stock only. Leave all unticked for no limit.
          Which <em>rows</em> they see (their godowns, their customers) is set in Admin → Permissions → Data scope, and always applies.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.departments.map((dep) => {
          const chosen = draft[dep.id] ?? [];
          return (
            <Panel
              key={dep.id}
              title={dep.dept_name}
              action={<span className="text-[11px] text-muted-foreground">{chosen.length ? `${chosen.length} dataset(s)` : "All datasets"}</span>}
            >
              {data.datasets.map((ds) => (
                <label key={ds.key} className="-mx-1 flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-primary/[0.04]" title={ds.description}>
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[#800000]"
                    checked={chosen.includes(ds.key)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [dep.id]: e.target.checked ? [...chosen, ds.key] : chosen.filter((k) => k !== ds.key),
                      }))
                    }
                  />
                  <span>{ds.label}</span>
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <SmallBtn tone="primary" onClick={() => save(dep.id)} disabled={busy === dep.id}>
                  {busy === dep.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                </SmallBtn>
                {msg[dep.id] && <span className="text-xs text-destructive">{msg[dep.id]}</span>}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
