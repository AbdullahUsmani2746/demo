"use client";
// /dashboard/followups — My Follow-ups: every follow-up the person owns (and,
// for managers, their team's), from the follow-up scenarios of the BI
// Designer (Free of Cost / Trial orders, late shipments …).
//   Overdue  — due now; escalated ones pulse
//   Snoozed  — "Needs more time", due again on a date
//   Done     — logged with a result
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ClipboardCheck, AlarmClock, PauseCircle, CheckCircle2, Search, Loader2, Flame, Lock, Building2, User, MessageSquare, ArrowRight, Sparkles,
} from "lucide-react";
import LogFollowupModal from "@/components/followups/LogFollowupModal";
import SearchSelect from "@/components/bi/SearchSelect";

const BOXES = [
  { key: "overdue", label: "Overdue", Icon: AlarmClock },
  { key: "snoozed", label: "Snoozed", Icon: PauseCircle },
  { key: "done", label: "Done", Icon: CheckCircle2 },
];
const RESULT_TONE = {
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  not_suitable: "bg-destructive/10 text-destructive",
  more_time: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  other: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};
const date = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—");

function Stat({ label, value, Icon, tone, hint }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm">
      <div className={`absolute inset-x-0 top-0 h-1 ${tone.bar}`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span className={`grid h-11 w-11 place-items-center rounded-xl ${tone.icon}`}><Icon className="h-5 w-5" /></span>
      </div>
    </div>
  );
}

function Card({ it, showOwner, onLog }) {
  const overdue = it.status === "open" && it.overdue_days >= 0 && new Date(it.due_since) <= new Date();
  return (
    <article
      className={`group relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        it.escalated && it.status === "open" ? "border-destructive/50 ring-1 ring-destructive/20" : ""
      }`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${it.status === "done" ? "bg-emerald-500" : it.escalated ? "bg-destructive" : overdue ? "bg-amber-500" : "bg-slate-300"}`} />
      <div className="flex items-start justify-between gap-2 pl-1">
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">{it.scenario}</span>
        {it.status === "open" && overdue && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              it.escalated ? "animate-pulse bg-destructive text-destructive-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            }`}
            title={it.escalated ? "Escalated" : "Overdue"}
          >
            {it.escalated && <Flame className="h-3 w-3" />}
            {it.overdue_days === 0 ? "Due today" : `${it.overdue_days}d overdue`}
          </span>
        )}
        {it.status === "open" && !overdue && <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Due {date(it.due_since)}</span>}
        {it.status === "done" && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${RESULT_TONE[it.result] || RESULT_TONE.other}`}>{it.result_label}</span>}
      </div>

      <h3 className="pl-1 text-[15px] font-semibold leading-snug" title={it.label}>{it.label}</h3>

      <div className="space-y-1 pl-1 text-xs text-muted-foreground">
        {it.customer && <div className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> <span className="truncate">{it.customer}</span></div>}
        {showOwner && <div className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {it.owner}</div>}
        {it.blocks && it.status === "open" && overdue && (
          <div className="flex items-center gap-1.5 font-medium text-destructive"><Lock className="h-3.5 w-3.5" /> Blocks new Free of Cost / Trial orders for this customer</div>
        )}
      </div>

      {it.last_note || it.remarks ? (
        <p className="line-clamp-2 rounded-lg bg-muted/50 px-3 py-2 pl-3 text-xs text-muted-foreground">
          <MessageSquare className="mr-1 inline h-3 w-3" />
          {it.remarks || it.last_note}
          {it.last_note_by && <span className="ml-1 text-[11px] opacity-80">— {it.last_note_by}{it.last_note_at ? `, ${date(it.last_note_at)}` : ""}</span>}
        </p>
      ) : (
        it.status === "open" && overdue && (
          <p className="rounded-lg border border-dashed border-amber-500/40 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            No response yet from {showOwner ? it.owner : "you"}
          </p>
        )
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pl-1">
        <span className="text-[11px] text-muted-foreground">
          {it.status === "done" ? `by ${it.done_by || "—"} · ${date(it.done_at)}` : it.next_date ? `snoozed to ${date(it.next_date)}` : `since ${date(it.due_since)}`}
        </span>
        <button
          onClick={() => onLog(it.id)}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition ${
            it.status === "done" ? "border hover:bg-muted" : "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          }`}
        >
          {it.status === "done" ? "History" : "Log follow-up"} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

export default function FollowupsPage() {
  const [box, setBox] = useState("overdue");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [scenario, setScenario] = useState(null);
  const [owner, setOwner] = useState("");
  const [logId, setLogId] = useState(null);

  const load = useCallback(async (b) => {
    setLoading(true);
    try {
      const { data: d } = await axios.get("/api/followups", { params: { box: b } });
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(box);
  }, [box, load]);
  // ?open=<id> (the bell's Follow-up tab): open that item's log + history
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("open"));
    if (id) setLogId(id);
  }, []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.data ?? []).filter(
      (it) =>
        (!scenario || it.scenario_id === scenario) &&
        (!owner || it.owner_id === owner) &&
        (!term || `${it.label} ${it.customer ?? ""} ${it.owner} ${it.scenario} ${it.key}`.toLowerCase().includes(term)),
    );
  }, [data, q, scenario, owner]);

  const escalated = (data?.data ?? []).filter((x) => x.escalated && x.status === "open").length;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6">
      <header className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-primary/30" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md"><ClipboardCheck className="h-6 w-6" /></span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{data?.isManager ? "Follow-ups" : "My Follow-ups"}</h1>
              <p className="text-sm text-muted-foreground">
                Free of Cost / Trial orders and other cases to chase — log what the customer said, or snooze it to a date.
              </p>
            </div>
          </div>
          {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Overdue" value={data?.counts?.overdue ?? "–"} Icon={AlarmClock} tone={{ bar: "bg-amber-500", icon: "bg-amber-500/15 text-amber-700 dark:text-amber-400" }} hint="due now" />
            <Stat label="Escalated" value={box === "overdue" ? escalated : "–"} Icon={Flame} tone={{ bar: "bg-destructive", icon: "bg-destructive/10 text-destructive" }} hint="sent up to the manager / CEO" />
            <Stat label="Snoozed" value={data?.counts?.snoozed ?? "–"} Icon={PauseCircle} tone={{ bar: "bg-sky-500", icon: "bg-sky-500/15 text-sky-700 dark:text-sky-400" }} hint="needs more time" />
            <Stat label="Done" value={data?.counts?.done ?? "–"} Icon={CheckCircle2} tone={{ bar: "bg-emerald-500", icon: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" }} hint="logged with a result" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex gap-1 rounded-xl border bg-card p-1 shadow-sm">
              {BOXES.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setBox(key)}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    box === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                  <span className={`rounded-full px-1.5 text-[11px] font-bold ${box === key ? "bg-white/25" : "bg-muted"}`}>{data?.counts?.[key] ?? 0}</span>
                </button>
              ))}
            </nav>
            {data?.isManager && (data?.owners?.length ?? 0) > 0 && (
              <SearchSelect width={230} placeholder="All sales persons" value={owner} options={data.owners.map((o) => ({ value: o.id, label: o.name }))} onChange={(v) => setOwner(v || "")} />
            )}
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search order, customer…"
                className="h-10 w-72 max-w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>
          </div>

          {(data?.scenarios?.length ?? 0) > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setScenario(null)} className={`rounded-full border px-3 py-1 text-xs font-medium ${!scenario ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50"}`}>
                All scenarios
              </button>
              {data.scenarios.map((s) => (
                <button key={s.id} onClick={() => setScenario(s.id)} className={`rounded-full border px-3 py-1 text-xs font-medium ${scenario === s.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50"}`}>
                  {s.name}
                </button>
              ))}
            </div>
          )}

          {!data && !error ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl border bg-muted/40" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card px-6 py-16 text-center">
              <Sparkles className="h-10 w-10 text-emerald-500/70" />
              <p className="font-semibold">{box === "overdue" ? "Nothing to chase — all caught up" : box === "snoozed" ? "Nothing snoozed" : "Nothing logged yet"}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((it) => <Card key={it.id} it={it} showOwner={data?.isManager} onLog={setLogId} />)}
            </div>
          )}
        </>
      )}

      {logId && <LogFollowupModal id={logId} onClose={() => setLogId(null)} onSaved={() => load(box)} />}
    </div>
  );
}
