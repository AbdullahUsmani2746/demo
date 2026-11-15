"use client";
// components/followups/LogFollowupModal.jsx — log a follow-up (used by My
// Follow-ups and by flagged dashboard rows). Four outcomes; "Needs more time"
// asks for the next date. Shows the item's full history.
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Loader2, ThumbsUp, ThumbsDown, Clock3, MessageSquare, History, Save, User, Building2 } from "lucide-react";

const ICON = { approved: ThumbsUp, not_suitable: ThumbsDown, more_time: Clock3, other: MessageSquare };
const TONE = {
  good: "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  bad: "border-destructive bg-destructive/10 text-destructive",
  warn: "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  neutral: "border-slate-400 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};
const plusDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const when = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default function LogFollowupModal({ id, onClose, onSaved }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState("");
  const [remarks, setRemarks] = useState("");
  const [next, setNext] = useState(plusDays(7));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios
      .get(`/api/followups/${id}`)
      .then(({ data }) => setD(data))
      .catch((e) => setError(e.response?.data?.error || e.message));
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [id, onClose]);

  const needsDate = result === "more_time";
  const ready = result && remarks.trim() && (!needsDate || next);

  async function save() {
    setSaving(true);
    try {
      const { data } = await axios.post(`/api/followups/${id}`, { result, remarks, next_date: needsDate ? next : null });
      toast.success(data.message);
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px] md:p-10" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b bg-gradient-to-r from-primary/10 to-transparent px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{d?.item?.scenario ?? "Follow-up"}</p>
            <h2 className="mt-0.5 truncate text-lg font-semibold" title={d?.item?.label}>{d?.item?.label ?? "…"}</h2>
            {d && (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {d.item.customer && <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {d.item.customer}</span>}
                <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {d.item.owner}</span>
                <span>Due since {when(d.item.due_since)}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg border p-2 hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-5 px-6 py-5">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
          ) : !d ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What did the customer say?</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {d.results.map((r) => {
                    const Icon = ICON[r.key] || MessageSquare;
                    const on = result === r.key;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setResult(r.key)}
                        className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left text-sm font-semibold transition ${on ? TONE[r.tone] : "border-border hover:border-primary/40 hover:bg-muted/40"}`}
                      >
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-white/60 dark:bg-black/20" : "bg-muted"}`}><Icon className="h-4 w-4" /></span>
                        <span>
                          {r.label}
                          <span className="block text-[11px] font-normal text-muted-foreground">{r.closes ? "Closes the follow-up" : "Snooze to a date"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {needsDate && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Follow up again on</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="date" value={next} min={plusDays(1)} onChange={(e) => setNext(e.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm" />
                    {[3, 7, 14].map((n) => (
                      <button key={n} type="button" onClick={() => setNext(plusDays(n))} className={`rounded-full border px-3 py-1 text-xs font-medium ${next === plusDays(n) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                        +{n} days
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remarks</h3>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. Trial ran on their 4-colour machine — colour matched, they will order 500 kg next week."
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </section>

              {d.history.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><History className="h-3.5 w-3.5" /> History</h3>
                  <ol className="space-y-2 border-l-2 border-primary/20 pl-4">
                    {d.history.map((h, i) => (
                      <li key={i} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                        <div className="font-semibold">{h.result} <span className="font-normal text-muted-foreground">· {h.by} · {when(h.at)}</span></div>
                        <div className="text-muted-foreground">{h.remarks}</div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t bg-muted/30 px-6 py-3">
          <button onClick={onClose} className="h-10 rounded-lg border px-4 text-sm font-medium hover:bg-muted">Cancel</button>
          <button onClick={save} disabled={!ready || saving} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save follow-up
          </button>
        </footer>
      </div>
    </div>
  );
}
