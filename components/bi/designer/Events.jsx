"use client";
// components/bi/designer/Events.jsx — BI Designer → Events: dated notes shown
// as flags on every dashboard trend chart ("Price +6%", "Plant shutdown").
// /api/bi/events (bi.design to add / remove).
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Flag, Loader2, Plus, Trash2 } from "lucide-react";
import { Field, INP, Panel, SmallBtn } from "./ui";

export default function Events() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ dated: new Date().toISOString().slice(0, 10), label: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = () =>
    axios
      .get("/api/bi/events")
      .then(({ data: d }) => setRows(d.data || []))
      .catch((e) => setError(e.response?.data?.error || e.message));
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy(true);
    try {
      await axios.post("/api/bi/events", form);
      toast.success("Event added — it shows on the trend charts");
      setForm((f) => ({ ...f, label: "", note: "" }));
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id) {
    try {
      await axios.delete("/api/bi/events", { params: { id } });
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Panel title={<span className="flex items-center gap-1.5"><Flag size={14} /> Add an event</span>}>
        <div className="space-y-3">
          <Field label="Date"><input className={INP} type="date" value={form.dated} onChange={(e) => setForm({ ...form, dated: e.target.value })} /></Field>
          <Field label="Label (short)" hint="Shown on the chart, e.g. Price +6% or Plant shutdown">
            <input className={INP} maxLength={60} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <Field label="Note (optional)"><input className={INP} maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <SmallBtn tone="primary" className="h-9 px-3" disabled={busy || !form.label.trim()} onClick={add}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add event
          </SmallBtn>
        </div>
      </Panel>
      <Panel title="Events on the charts">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!rows && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
        <ul className="divide-y divide-border">
          {rows?.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{e.dated}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{e.label}</span>
                {e.note && <span className="block truncate text-xs text-muted-foreground">{e.note}</span>}
              </span>
              <SmallBtn tone="danger" title="Remove" className="h-8 w-8 justify-center px-0" onClick={() => remove(e.id)}><Trash2 size={13} /></SmallBtn>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
