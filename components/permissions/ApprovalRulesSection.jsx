"use client";
import { roleLabel } from "@/lib/auth/roleNames";
import { useRoles } from "@/hooks/useRoles";
// components/permissions/ApprovalRulesSection.jsx — Admin → Permissions → Approvals →
// "Approval rules": put an approval on ANY voucher form without code.
//   Form · conditions on its fields (all / any) · approvers (people / roles)
//   · message to the requester · active
// e.g. Material Issue · "Production #" is empty → the approver (a person or a role).
// Engine: lib/approvals/rules.js + conditions.js; requests: /dashboard/approvals.
// "Approve in steps": the entry goes from step to step (any form) and the last
// step posts it — lib/approvals/docChains.js. Step editor shared with the HR chains.
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Select from "react-select";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Loader2, Workflow, Pencil, Inbox, GitBranch, ChevronRight } from "lucide-react";
import { StepEditor, blankStep } from "@/components/permissions/HrChainsSection";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import SearchSelect from "@/components/bi/SearchSelect";
import { CONDITION_OPS, describeConditions } from "@/lib/approvals/conditions";

const INP = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:bg-muted/60 disabled:text-muted-foreground";
const LABEL = "text-[11px] font-bold uppercase tracking-wider text-primary";
const blank = { name: "", doc_type: "", match: "all", applies_on: "create", mode: "hold", conditions: [{ field: "", op: "empty", value: "" }], approver_users: [], approver_roles: [], steps: [], watchers: [], message: "", is_active: true };
const MATCH = [
  { value: "all", label: "ALL of these are true" },
  { value: "any", label: "ANY of these is true" },
];

/** react-select over plain { value, label } options; hands back the bare value, as the old <select> did. */
function Pick({ options, value, onChange, ariaLabel }) {
  return (
    <Select
      aria-label={ariaLabel}
      options={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o?.value)}
      isSearchable={options.length > 8}
      styles={selectStyles(false)}
      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
    />
  );
}

function RuleEditor({ meta, rule, onClose, onSaved }) {
  const [r, setR] = useState(() => ({
    ...blank,
    ...(rule || {}),
    conditions: rule?.conditions?.length ? rule.conditions : blank.conditions,
    steps: (Array.isArray(rule?.steps) ? rule.steps : []).map((s) => ({ ...blankStep(0), ...s })),
    watchers: Array.isArray(rule?.watchers) ? rule.watchers : [],
  }));
  const inSteps = (r.mode || "hold") === "hold" && r.steps.length > 0;
  const setStep = (i, st) => set({ steps: r.steps.map((y, j) => (j === i ? st : y)) });
  const moveStep = (i, d) => {
    const steps = [...r.steps];
    [steps[i], steps[i + d]] = [steps[i + d], steps[i]];
    set({ steps });
  };
  const toggleSteps = (on) =>
    set(
      on
        ? {
            steps: [
              { ...blankStep(1), label: "Review", users: r.approver_users, roles: r.approver_roles },
              { ...blankStep(2), label: "Final approval" },
            ],
          }
        : { steps: [], watchers: [] },
    );
  const [saving, setSaving] = useState(false);
  const form = meta.forms.find((f) => f.key === r.doc_type);
  const fields = form?.fields ?? [];
  const set = (patch) => setR((x) => ({ ...x, ...patch }));
  const setCond = (i, patch) => set({ conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const appliesOn = (meta.appliesOn || []).map((a) => ({ value: a.key, label: a.label }));
  const ops = CONDITION_OPS.map((o) => ({ value: o.key, label: o.label }));

  async function save() {
    setSaving(true);
    try {
      const body = { ...r, conditions: r.conditions.filter((c) => c.field), steps: inSteps ? r.steps : [] };
      if (r.id) await axios.put("/api/approvals/rules", body);
      else await axios.post("/api/approvals/rules", body);
      toast.success("Rule saved — it applies to new entries from now on.");
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border-2 border-primary/30 bg-background">
      <div className="flex items-center justify-between border-b border-primary/15 bg-primary/5 px-4 py-3">
        <h4 className="text-[15px] font-semibold text-primary">{r.id ? "Edit rule" : "New approval rule"}</h4>
        <button onClick={onClose} className="rounded-lg p-1.5 text-primary/70 hover:bg-primary/10 hover:text-primary" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className={LABEL}>Rule name</span>
            <input className={INP} value={r.name} placeholder="e.g. Consumption without production plan" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className={LABEL}>Form</span>
            <SearchSelect
              width="100%"
              isClearable={false}
              placeholder="Search forms…"
              value={r.doc_type}
              options={meta.forms.map((f) => ({ value: f.key, label: f.label }))}
              onChange={(v) => set({ doc_type: v, conditions: blank.conditions, mode: "hold" })}
            />
          </label>
        </div>

        {(meta.flagForms || []).includes(r.doc_type) && (
          <div className="grid gap-2 md:grid-cols-2">
            {(meta.modes || []).map((m) => (
              <label key={m.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${(r.mode || "hold") === m.key ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
                <input type="radio" className="mt-0.5 accent-primary" checked={(r.mode || "hold") === m.key} onChange={() => set({ mode: m.key })} />
                <span>
                  <span className="font-semibold">{m.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {m.key === "flag"
                      ? "The order is saved with its number and waits on Sale Order Approvals; dispatch is blocked until approved. The rule name is the reason shown."
                      : "Nothing is saved until approved (Approvals inbox)."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className={LABEL}>Conditions</div>
          <div className="grid gap-2 text-sm sm:grid-cols-[auto_minmax(0,14rem)_auto_minmax(0,14rem)] sm:items-center">
            <span className="font-semibold">Applies to</span>
            <Pick ariaLabel="Applies to" options={appliesOn} value={r.applies_on || "create"} onChange={(v) => set({ applies_on: v })} />
            <span className="font-semibold">· needs approval when</span>
            <Pick ariaLabel="Match" options={MATCH} value={r.match} onChange={(v) => set({ match: v })} />
          </div>
          {!r.doc_type && <p className="text-xs text-muted-foreground">Choose the form first.</p>}
          {r.doc_type &&
            r.conditions.map((c, i) => {
              const op = CONDITION_OPS.find((o) => o.key === c.op);
              return (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/60 bg-background p-2 md:grid-cols-[1.4fr_1fr_1fr_auto] md:border-0 md:bg-transparent md:p-0">
                  <div className="col-span-2 md:col-span-1">
                    <SearchSelect
                      width="100%"
                      isClearable={false}
                      placeholder="Field…"
                      value={c.field}
                      options={fields.map((f) => ({ value: f.key, label: `${f.label}` }))}
                      onChange={(v) => setCond(i, { field: v })}
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <Pick ariaLabel="Condition" options={ops} value={c.op} onChange={(v) => setCond(i, { op: v })} />
                  </div>
                  <input className={INP} disabled={!op?.needsValue} value={c.value ?? ""} placeholder={op?.needsValue ? "Value" : "—"} onChange={(e) => setCond(i, { value: e.target.value })} />
                  <button
                    type="button"
                    onClick={() => set({ conditions: r.conditions.filter((_, j) => j !== i) })}
                    className="rounded-lg p-2 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Remove condition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          {r.doc_type && (
            <Button type="button" variant="outline" size="sm" onClick={() => set({ conditions: [...r.conditions, { field: "", op: "eq", value: "" }] })} className="h-8 gap-1 bg-background text-xs">
              <Plus className="h-3.5 w-3.5" /> Add condition
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            No conditions = EVERY {r.applies_on === "update" ? "edit" : r.applies_on === "both" ? "entry and edit" : "new entry"} of this form needs
            approval. An edit is held with the saved document left as it is, until approved.
          </p>
        </div>

        {(r.mode || "hold") === "hold" && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 text-sm">
            <Switch checked={inSteps} onCheckedChange={toggleSteps} className="mt-0.5" />
            <span>
              <span className="flex items-center gap-1.5 font-semibold"><GitBranch className="h-4 w-4 text-primary" /> Approve in steps</span>
              <span className="block text-xs text-muted-foreground">
                The entry goes from one step to the next (e.g. Accounts review → Manager → CEO). It is posted only after the last step
                approves; anyone on a step can reject it. Entries already waiting keep the steps they started with.
              </span>
            </span>
          </label>
        )}

        {inSteps ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className={LABEL}>Steps — in order (the last one posts the entry)</div>
            {r.steps.map((st, i) => (
              <StepEditor
                key={st.id}
                step={st}
                index={i}
                count={r.steps.length}
                meta={{ users: meta.users, roles: meta.roles }}
                payAllowed={false}
                showFinal={false}
                managerLabel="Reporting manager of the person who saved it"
                onChange={(x) => setStep(i, x)}
                onMove={(d) => moveStep(i, d)}
                onRemove={() => set({ steps: r.steps.filter((_, j) => j !== i) })}
              />
            ))}
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 bg-background text-xs" onClick={() => set({ steps: [...r.steps, blankStep(r.steps.length + 1)] })}>
              <Plus className="h-3.5 w-3.5" /> Add step
            </Button>
            <label className="block space-y-1">
              <span className={LABEL}>Watchers — told at every step (optional)</span>
              <SearchSelect
                multi
                width="100%"
                placeholder="Search people…"
                value={r.watchers}
                options={meta.users.map((u) => ({ value: u.id, label: `${u.name} · ${roleLabel(u.role)}` }))}
                onChange={(v) => set({ watchers: v ?? [] })}
              />
            </label>
          </div>
        ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className={LABEL}>Approvers — people</span>
            <SearchSelect
              multi
              width="100%"
              placeholder="Search people…"
              value={r.approver_users}
              options={meta.users.map((u) => ({ value: u.id, label: `${u.name} · ${roleLabel(u.role)}` }))}
              onChange={(v) => set({ approver_users: v })}
            />
          </label>
          <div className="space-y-1">
            <span className={LABEL}>Approvers — whole role</span>
            <div className="flex flex-wrap gap-1.5">
              {meta.roles.map((role) => {
                const on = r.approver_roles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ approver_roles: on ? r.approver_roles.filter((x) => x !== role) : [...r.approver_roles, role] })}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/50 hover:text-primary"}`}
                  >
                    {roleLabel(role)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        )}

        <label className="block space-y-1">
          <span className={LABEL}>Message to the person saving (optional)</span>
          <input className={INP} value={r.message || ""} placeholder="e.g. Sent to the store manager — consumption without a production plan needs approval." onChange={(e) => set({ message: e.target.value })} />
        </label>

        {r.doc_type && (
          <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Preview: <b className="text-primary">{form?.label}</b> — {(meta.appliesOn || []).find((a) => a.key === (r.applies_on || "create"))?.label.toLowerCase()} need approval when{" "}
            {describeConditions({ ...r, conditions: r.conditions.filter((c) => c.field) }, fields)}.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={r.is_active} onCheckedChange={(v) => set({ is_active: v })} /> Active
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="bg-background">Cancel</Button>
            <Button type="button" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save rule
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalRulesSection() {
  useRoles(); // role names
  const [meta, setMeta] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} | rule
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null); // rule waiting on the delete confirmation

  const load = () =>
    axios
      .get("/api/approvals/rules")
      .then(({ data }) => setMeta(data))
      .catch((e) => setError(e.response?.data?.error || e.message));
  useEffect(() => {
    load();
  }, []);

  const userName = useMemo(() => new Map((meta?.users ?? []).map((u) => [u.id, u.name])), [meta]);
  const stepWho = (st) => [
    ...(st.users || []).map((id) => userName.get(id) || id),
    ...(st.roles || []).map((x) => `${roleLabel(x)} role`),
    ...(st.manager ? ["reporting manager"] : []),
  ];

  async function remove(rule) {
    try {
      await axios.delete(`/api/approvals/rules?id=${rule.id}`);
      toast.success(`Rule "${rule.name}" deleted.`);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    }
    load();
  }
  async function toggle(rule) {
    try {
      await axios.put("/api/approvals/rules", { ...rule, is_active: !rule.is_active });
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    }
    load();
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error} {/ApprovalRule|does not exist/i.test(error) ? "— run prisma/sql/2026-10-24_approval_rules.sql and npx prisma generate." : ""}
      </div>
    );
  }
  if (!meta) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Workflow className="h-5 w-5" /></span>
          <div>
            <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-primary">
              Approval rules — any form
              <span className="rounded-full bg-primary/10 px-2.5 text-xs font-bold text-primary">{meta.rules.length}</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              A new entry matching a rule is held — nothing posted — until its approvers (one, or step by step) approve it on{" "}
              <a href="/dashboard/approvals" className="text-primary underline">Approvals</a>.
            </p>
          </div>
        </div>
        {!editing && (
          <Button onClick={() => setEditing({})} className="gap-1.5">
            <Plus className="h-4 w-4" /> New rule
          </Button>
        )}
      </div>

      {editing && (
        <RuleEditor
          meta={meta}
          rule={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {meta.rules.length === 0 && !editing ? (
        <div className="rounded-xl border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">
          No rules yet. Examples: <b>Material Issue</b> · new entries · <i>Production # is empty</i> → <b>the store manager</b>;{" "}
          <b>Sale Order</b> · edits · <i>no condition</i> → <b>the approver</b>.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {meta.rules.map((rule) => {
            const form = meta.forms.find((f) => f.key === rule.doc_type);
            const who = [...(rule.approver_users || []).map((id) => userName.get(id) || id), ...(rule.approver_roles || []).map((x) => `${roleLabel(x)} role`)];
            return (
              <div key={rule.id} className={`overflow-hidden rounded-xl border border-border bg-background ${rule.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-primary">{rule.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {form?.label ?? rule.doc_type} · {(meta.appliesOn || []).find((a) => a.key === (rule.applies_on || "create"))?.label}
                      {rule.mode === "flag" ? " · saved, dispatch blocked" : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={!!rule.is_active}
                      onCheckedChange={() => toggle(rule)}
                      aria-label={rule.is_active ? "Turn off" : "Turn on"}
                      title={rule.is_active ? "Turn off" : "Turn on"}
                      className="mr-1"
                    />
                    <button onClick={() => setEditing(rule)} aria-label="Edit" title="Edit" className="rounded-lg p-1.5 text-primary/70 hover:bg-primary/10 hover:text-primary"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setDeleting(rule)} aria-label="Delete" title="Delete" className="rounded-lg p-1.5 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="space-y-2 px-4 py-3">
                  <p className="text-sm">
                    <span className="text-muted-foreground">When </span>
                    {describeConditions(rule, form?.fields ?? [])}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {rule.steps?.length ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><GitBranch className="h-3 w-3" /> In steps:</span>
                        {rule.steps.map((st, i) => (
                          <span key={st.id ?? i} className="inline-flex items-center gap-1">
                            <span className="rounded-full bg-muted px-2 py-0.5 font-medium" title={stepWho(st).join(", ")}>
                              {i + 1}. {st.label}
                            </span>
                            {i < rule.steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          </span>
                        ))}
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground">Approved by:</span>
                        {who.map((w) => <span key={w} className="rounded-full bg-muted px-2 py-0.5 font-medium">{w}</span>)}
                      </>
                    )}
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${rule.is_active ? "bg-[#edf2ee] text-[#2f5139]" : "bg-muted text-muted-foreground"}`}>
                      {rule.is_active ? "On" : "Off"}
                    </span>
                    {rule.pending > 0 && (
                      <a href="/dashboard/approvals" className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                        <Inbox className="h-3 w-3" /> {rule.pending} waiting
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the rule &quot;{deleting?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Requests already waiting keep their data.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const rule = deleting;
                setDeleting(null);
                remove(rule);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
