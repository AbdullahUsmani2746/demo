"use client";
// components/permissions/HrChainsSection.jsx — Admin → Permissions →
// Approvals → "HR approval chains" (lib/hr/chains.js, /api/hr/approval-chains).
// Who approves leave, salary advances and loans, step by step — changed here,
// never in code. Editing a chain changes NEW requests; ones already waiting
// keep the steps they started with.
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronRight, Eye, GitBranch, Loader2, Pencil, Plus, Save, Trash2, Wallet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import SearchSelect from "@/components/bi/SearchSelect";
import { roleLabel } from "@/lib/auth/roleNames";

const LABEL = "text-[11px] font-bold uppercase tracking-wider text-primary";
const INPUT =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

export const blankStep = (n) => ({ id: `s${Date.now()}${n}`, label: "", type: "approve", final: false, users: [], roles: [], manager: false, pickNext: false });
const blankChain = () => ({
  name: "",
  doc_type: "hrLeave",
  loan_kind: "",
  work_location_ids: [],
  department_ids: [],
  steps: [blankStep(1)],
  watchers: [],
  is_active: true,
  sort: 0,
});

// Shared with the approval rules (ApprovalRulesSection — "Approve in steps").
export function StepEditor({
  step, index, count, meta, payAllowed, onChange, onMove, onRemove,
  showFinal = true, managerLabel = "The employee's reporting manager",
}) {
  const set = (patch) => onChange({ ...step, ...patch });
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
        <input
          aria-label={`Step ${index + 1} name`}
          value={step.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Initial review"
          className={`${INPUT} min-w-0 flex-1`}
        />
        {meta.stepTypes && (
        <select
          aria-label={`Step ${index + 1} type`}
          value={step.type}
          onChange={(e) => set({ type: e.target.value, final: e.target.value === "pay" ? false : step.final })}
          className={`${INPUT} w-auto`}
        >
          {(meta.stepTypes ?? [{ value: "approve", label: "Approve" }]).filter((t) => payAllowed || t.value !== "pay").map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        )}
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="outline" className="h-9 w-9" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="h-9 w-9" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="h-9 w-9 text-destructive" disabled={count === 1} onClick={onRemove} aria-label="Remove step">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <span className={LABEL}>{step.type === "pay" ? "Who pays (any one)" : "Who decides (any one)"}</span>
        <SearchSelect
          multi
          width="100%"
          placeholder="Search and add people…"
          value={step.users}
          options={meta.users.map((u) => ({ value: u.id, label: `${u.name} · ${roleLabel(u.role)}` }))}
          onChange={(v) => set({ users: v ?? [] })}
        />
      </div>
      <div className="space-y-1.5">
        <span className={LABEL}>Or everyone in a role</span>
        <div className="flex flex-wrap gap-1.5">
          {meta.roles.map((r) => {
            const on = step.roles.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() => set({ roles: on ? step.roles.filter((x) => x !== r) : [...step.roles, r] })}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"}`}
              >
                {roleLabel(r)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={step.manager} onChange={(e) => set({ manager: e.target.checked })} className="h-4 w-4 accent-[#800000]" />
          {managerLabel}
        </label>
        {showFinal && step.type === "approve" && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={step.final} onChange={(e) => set({ final: e.target.checked })} className="h-4 w-4 accent-[#800000]" />
            Final approval (the request counts from here)
          </label>
        )}
        {index < count - 1 && step.type === "approve" && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={step.pickNext} onChange={(e) => set({ pickNext: e.target.checked })} className="h-4 w-4 accent-[#800000]" />
            Chooses who takes the next step
          </label>
        )}
      </div>
    </div>
  );
}

function ChainEditor({ initial, meta, onSaved, onCancel }) {
  const [c, setC] = useState(() => ({
    ...blankChain(),
    ...initial,
    loan_kind: initial?.loan_kind || "",
    steps: (initial?.steps?.length ? initial.steps : [blankStep(1)]).map((s) => ({ ...blankStep(0), ...s })),
    watchers: (initial?.watchers ?? []).map(String),
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const type = meta.docTypes.find((t) => t.value === c.doc_type);
  const set = (patch) => setC((x) => ({ ...x, ...patch }));
  const setStep = (i, s) => setC((x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? s : s.final && y.final ? { ...y, final: false } : y)) }));
  const move = (i, d) =>
    setC((x) => {
      const steps = [...x.steps];
      [steps[i], steps[i + d]] = [steps[i + d], steps[i]];
      return { ...x, steps };
    });

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body = { ...c, loan_kind: c.loan_kind || null };
      const { data } = c.id ? await axios.put("/api/hr/approval-chains", body) : await axios.post("/api/hr/approval-chains", body);
      onSaved(data.message);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border-2 border-primary/30 bg-primary/[0.02] p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={LABEL}>Chain name</span>
          <input value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Head Office — Loans" className={INPUT} />
        </label>
        <label className="space-y-1.5">
          <span className={LABEL}>For</span>
          <select
            value={c.doc_type}
            onChange={(e) => set({ doc_type: e.target.value, steps: c.steps.map((s) => (e.target.value === "hrLeave" && s.type === "pay" ? { ...s, type: "approve" } : s)) })}
            className={INPUT}
          >
            {meta.docTypes.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        {type?.kinds && (
          <label className="space-y-1.5">
            <span className={LABEL}>Which</span>
            <select value={c.loan_kind} onChange={(e) => set({ loan_kind: e.target.value })} className={INPUT}>
              {meta.loanKinds.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
        )}
        <label className="space-y-1.5">
          <span className={LABEL}>Order (lower is tried first)</span>
          <input type="number" value={c.sort} onChange={(e) => set({ sort: e.target.value })} className={INPUT} />
        </label>
        <div className="space-y-1.5">
          <span className={LABEL}>Work locations (empty = all)</span>
          <SearchSelect
            multi
            width="100%"
            placeholder="All locations"
            value={c.work_location_ids}
            options={meta.locations.map((l) => ({ value: l.id, label: l.name }))}
            onChange={(v) => set({ work_location_ids: (v ?? []).map(Number) })}
          />
        </div>
        <div className="space-y-1.5">
          <span className={LABEL}>Departments (empty = all)</span>
          <SearchSelect
            multi
            width="100%"
            placeholder="All departments"
            value={c.department_ids}
            options={meta.departments.map((d) => ({ value: d.id, label: d.name }))}
            onChange={(v) => set({ department_ids: (v ?? []).map(Number) })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <span className={LABEL}>Steps, in order</span>
        {c.steps.map((s, i) => (
          <StepEditor
            key={s.id}
            step={s}
            index={i}
            count={c.steps.length}
            meta={meta}
            payAllowed={Boolean(type?.pay)}
            onChange={(v) => setStep(i, v)}
            onMove={(d) => move(i, d)}
            onRemove={() => set({ steps: c.steps.filter((_, j) => j !== i) })}
          />
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => set({ steps: [...c.steps, blankStep(c.steps.length + 1)] })}>
          <Plus className="h-4 w-4" /> Add step
        </Button>
        <p className="text-[11px] text-muted-foreground">
          No step ticked &quot;Final approval&quot; → the last Approve step is the final one. A Pay out step finishes when the advance / loan is paid on the
          Advances &amp; Loans screen.
        </p>
      </div>

      <div className="space-y-1.5">
        <span className={LABEL}>Kept informed at every step (see it in their Approvals)</span>
        <SearchSelect
          multi
          width="100%"
          placeholder="Nobody"
          value={c.watchers}
          options={meta.users.map((u) => ({ value: u.id, label: u.name }))}
          onChange={(v) => set({ watchers: (v ?? []).map(String) })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="h-4 w-4 accent-[#800000]" />
        Active
      </label>

      {err && (
        <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
        <Button type="button" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save chain
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5">
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>
    </div>
  );
}

function ChainCard({ chain, meta, onEdit, onDelete }) {
  const nameOf = (id) => meta.users.find((u) => String(u.id) === String(id))?.name ?? id;
  const type = meta.docTypes.find((t) => t.value === chain.doc_type);
  const kind = meta.loanKinds.find((k) => k.value === (chain.loan_kind || ""))?.label;
  const where = [
    chain.work_location_ids.length ? chain.work_location_ids.map((id) => meta.locations.find((l) => l.id === id)?.name ?? id).join(", ") : "All locations",
    chain.department_ids.length ? chain.department_ids.map((id) => meta.departments.find((d) => d.id === id)?.name ?? id).join(", ") : "all departments",
  ].join(" · ");
  const steps = Array.isArray(chain.steps) ? chain.steps : [];
  const finalAt = steps.findIndex((s) => s.final) >= 0 ? steps.findIndex((s) => s.final) : steps.map((s) => s.type).lastIndexOf("approve");
  const who = (s) =>
    [...(s.users ?? []).map(nameOf), ...(s.roles ?? []).map(roleLabel), ...(s.manager ? ["Reporting manager"] : [])].join(" / ") || "—";

  return (
    <section className={`overflow-hidden rounded-xl border bg-background ${chain.is_active ? "border-border" : "border-dashed border-border opacity-70"}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
        <div className="min-w-0">
          <h4 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-primary">
            {chain.name}
            {!chain.is_active && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Off</span>}
            {chain.pending > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{chain.pending} waiting</span>}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {type?.label}
            {type?.kinds ? ` · ${kind}` : ""} · {where}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 bg-background text-xs" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 bg-background text-xs text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </header>
      <ol className="flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-stretch sm:p-4">
        {steps.map((s, i) => (
          <li key={s.id || i} className="flex items-center gap-2">
            <div className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 sm:min-w-[150px]">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{i + 1}</span>
                {s.type === "pay" && <Wallet className="h-3.5 w-3.5 text-[#2f5139]" />}
                <span className="truncate">{s.label}</span>
                {i === finalAt && <span className="rounded bg-[#edf2ee] px-1.5 text-[10px] text-[#2f5139]">final</span>}
              </div>
              <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                {who(s)}
                {s.pickNext ? " · chooses next" : ""}
              </p>
            </div>
            {i < steps.length - 1 && <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />}
          </li>
        ))}
      </ol>
      {chain.watchers?.length > 0 && (
        <p className="flex items-center gap-1.5 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
          <Eye className="h-3.5 w-3.5" /> Kept informed: {chain.watchers.map(nameOf).join(", ")}
        </p>
      )}
    </section>
  );
}

export default function HrChainsSection() {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // chain | "new" | null
  const [msg, setMsg] = useState(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    axios
      .get("/api/hr/approval-chains")
      .then(({ data }) => setMeta(data))
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, [rev]);

  const byType = useMemo(() => {
    if (!meta) return [];
    return meta.docTypes.map((t) => ({ type: t, chains: meta.chains.filter((c) => c.doc_type === t.value) }));
  }, [meta]);

  async function saveFallback(docType, value) {
    try {
      await axios.put("/api/hr/approval-chains", { fallbacks: { [docType]: value } });
      setMsg({ ok: true, text: "Saved." });
      setRev((x) => x + 1);
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || e.message });
    }
  }

  async function remove(chain) {
    if (!confirm(`Delete the chain "${chain.name}"? Requests already waiting finish on their own steps.`)) return;
    try {
      const { data } = await axios.delete(`/api/hr/approval-chains?id=${chain.id}`);
      setMsg({ ok: true, text: data.message });
      setRev((x) => x + 1);
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || e.message });
    }
  }

  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>;
  if (!meta) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const done = (text) => {
    setEditing(null);
    setMsg({ ok: true, text });
    setRev((x) => x + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-primary">HR approval chains</h3>
            <p className="text-xs text-muted-foreground">
              Who approves leave, salary advances and loans — step by step. Each step&apos;s people get it in their Approvals; the employee and the
              people kept informed are told at every step. Changes here apply to new requests.
            </p>
          </div>
        </div>
        {editing !== "new" && (
          <Button type="button" size="sm" className="gap-1.5" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> New chain
          </Button>
        )}
      </div>

      {msg && (
        <p className={`flex items-center gap-1.5 text-xs ${msg.ok ? "font-semibold text-[#2f5139]" : "text-destructive"}`}>
          {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} {msg.text}
        </p>
      )}

      {editing === "new" && <ChainEditor initial={null} meta={meta} onSaved={done} onCancel={() => setEditing(null)} />}

      {byType.map(({ type, chains }) => (
        <div key={type.value} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{type.label}</h4>
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              When no chain fits:
              <select
                value={meta.fallbacks[type.value]}
                onChange={(e) => saveFallback(type.value, e.target.value)}
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
              >
                {meta.fallbackOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          {chains.length === 0 && <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">No chain — the setting above applies.</p>}
          {chains.map((c) =>
            editing && editing !== "new" && editing.id === c.id ? (
              <ChainEditor key={c.id} initial={c} meta={meta} onSaved={done} onCancel={() => setEditing(null)} />
            ) : (
              <ChainCard key={c.id} chain={c} meta={meta} onEdit={() => setEditing(c)} onDelete={() => remove(c)} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}
