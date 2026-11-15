"use client";
import { useRoles } from "@/hooks/useRoles";
// components/Settings/AlertBuilder.jsx — the "New alert / Edit alert" side
// sheet of Admin → Notifications → Alerts. One scrolling form in four steps:
//   1 What to watch   table + Created / Changed / Deleted
//   2 Conditions      [field · operator · value] rows, All / Any
//   3 Who is told     roles, users, departments, people named on the record,
//                     the employee on the record, the person who made the change
//   4 Message         type, title + message with {placeholders}, live preview
// "Test against recent changes" = POST /api/notifications/alerts { preview: true }.
// The server validates (lib/notifications/alertData.js); its message is shown
// next to the step it is about.
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FlaskConical,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  Users,
  Eye,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { renderTemplate, templateVarNames } from "@/lib/notifications/template";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import ReactSelect from "react-select";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { TYPE_META, TypeIcon } from "@/components/Notifications/notificationUi";
import {
  ACTIONS,
  ALERT_OPS,
  COMMON_VARS,
  TEMPLATE_LIMITS,
  VALUE_HINTS,
  describeAlert,
  fieldKind,
  fieldLabel,
  looksLikeEmployeeField,
  looksLikeUserField,
  opsFor,
  roleLabel,
  sampleVars,
  toBody,
} from "./alertShared";

const LABEL = "block text-[12.5px] font-semibold text-foreground/80";
// Condition pickers live inside the sheet (a Radix dialog that blocks pointer
// events outside itself), so their menus are not portalled to <body>; they are
// position: fixed (CONDITION_MENU) so the step cards and the sheet's scroll
// area don't clip them.
const CONDITION_SELECT = {
  ...selectStyles(false),
  container: (base) => ({ ...base, minWidth: 0 }),
  menu: (base) => ({ ...base, borderRadius: 8, overflow: "hidden", zIndex: 60 }),
};
const CONDITION_MENU = { menuPosition: "fixed", menuPlacement: "auto" };
const BOOL_OPTIONS = [
  { value: "true", label: "Yes (true)" },
  { value: "false", label: "No (false)" },
];

/** Which step an API error is about. */
function stepOf(message = "") {
  if (/^Condition/i.test(message)) return 2;
  if (/who is told/i.test(message)) return 3;
  if (/title|message/i.test(message)) return 4;
  if (/name|watches/i.test(message)) return 1;
  return 0;
}

export default function AlertBuilder({ open, onOpenChange, initial, editingId, meta, onSave, saving }) {
  useRoles(); // role names
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [test, setTest] = useState(null); // { loading } | result | { error }

  useEffect(() => {
    if (open) {
      setForm(initial);
      setError(null);
      setTest(null);
    }
  }, [open, initial]);

  const models = useMemo(() => meta?.models || [], [meta]);
  const model = models.find((m) => m.model === form?.model_name) || null;
  const fields = useMemo(() => [...(model?.fields || [])].filter((f) => !f.list).sort((a, b) => fieldLabel(a.name).localeCompare(fieldLabel(b.name))), [model]);

  if (!form) return null;

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setTest(null);
  };
  const setRecipients = (patch) => set({ recipients: { ...form.recipients, ...patch } });

  const chooseModel = (name) => {
    const m = models.find((x) => x.model === name);
    const names = new Set((m?.fields || []).map((f) => f.name));
    set({
      model_name: name,
      conditions: form.conditions.filter((c) => names.has(c.field)),
      recipients: {
        ...form.recipients,
        userFields: form.recipients.userFields.filter((f) => names.has(f)),
        employeeFields: form.recipients.employeeFields.filter((f) => names.has(f)),
      },
    });
  };

  const save = async () => {
    setError(null);
    try {
      await onSave(toBody(form));
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Could not save the alert.");
    }
  };

  const runTest = async () => {
    setError(null);
    setTest({ loading: true });
    try {
      const { data } = await axios.post("/api/notifications/alerts", { ...toBody(form), preview: true });
      setTest(data);
    } catch (e) {
      const msg = e.response?.data?.error || "The test could not run.";
      setTest(null);
      setError(msg);
    }
  };

  const errStep = error ? stepOf(error) : null;
  const sentence = describeAlert(form, meta);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-primary/15 bg-primary/5 px-4 py-4 pr-12 text-left sm:px-6">
          <SheetTitle className="flex items-center gap-2 text-lg font-bold text-primary">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <Zap className="h-4 w-4" />
            </span>
            {editingId ? "Edit alert" : "New alert"}
          </SheetTitle>
          <SheetDescription className="line-clamp-2 text-xs">
            {form.model_name ? `${sentence.when} → ${sentence.who}.` : "Choose what to watch, when it fires, who is told and what it says."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          {error && errStep === 0 && <ErrorNote>{error}</ErrorNote>}

          {/* Name */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Alert name" htmlFor="alert-name" hint={`${form.name.length}/150`}>
              <Input id="alert-name" className="h-10" value={form.name} maxLength={150} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Big payment made" />
            </Field>
            <Field label="Note for admins (optional)" htmlFor="alert-desc">
              <Input id="alert-desc" className="h-10" value={form.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} placeholder="Why this alert exists" />
            </Field>
          </div>

          {/* 1 — What to watch */}
          <Step n={1} title="What to watch" error={errStep === 1 ? error : null}>
            <TablePicker models={models} modules={meta?.modules || []} value={form.model_name} onChange={chooseModel} />
            <div>
              <div className={`mb-1.5 ${LABEL}`}>When a record is…</div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Actions">
                {ACTIONS.map((a) => {
                  const on = form.actions.includes(a.key);
                  return (
                    <label
                      key={a.key}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                        on ? "border-primary/40 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-primary/[0.03]",
                      )}
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) => set({ actions: v ? [...form.actions, a.key] : form.actions.filter((x) => x !== a.key) })}
                      />
                      {a.label}
                    </label>
                  );
                })}
              </div>
              {!form.actions.length && <p className="mt-1.5 text-xs text-muted-foreground">None ticked = any of the three.</p>}
            </div>
          </Step>

          {/* 2 — Conditions */}
          <Step n={2} title="Conditions" error={errStep === 2 ? error : null}>
            {!model ? (
              <p className="text-sm text-muted-foreground">Choose a table first.</p>
            ) : (
              <>
                {form.conditions.length > 1 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    Fire when
                    <Segmented
                      value={form.match}
                      onChange={(v) => set({ match: v })}
                      options={[
                        { value: "all", label: "All match" },
                        { value: "any", label: "Any matches" },
                      ]}
                      label="Match"
                    />
                  </div>
                )}
                <ul className="space-y-2">
                  {form.conditions.map((c, i) => (
                    <ConditionRow
                      key={i}
                      index={i}
                      cond={c}
                      fields={fields}
                      first={i === 0}
                      joiner={form.match === "any" ? "or" : "and"}
                      onChange={(patch) => set({ conditions: form.conditions.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
                      onRemove={() => set({ conditions: form.conditions.filter((_, j) => j !== i) })}
                    />
                  ))}
                </ul>
                {!form.conditions.length && (
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    No conditions — every {form.actions.length ? form.actions.map((k) => ACTIONS.find((a) => a.key === k)?.word).join(" / ") : "change"} of {model.label} raises the alert.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 bg-background"
                  onClick={() => {
                    const f = fields.find((x) => x.name === "status") || fields[0];
                    const ops = opsFor(f?.type);
                    set({ conditions: [...form.conditions, { field: f?.name || "", op: ops.includes("eq") ? "eq" : ops[0], value: "" }] });
                  }}
                >
                  <Plus className="h-4 w-4" /> Add condition
                </Button>
              </>
            )}
          </Step>

          {/* 3 — Who is told */}
          <Step n={3} title="Who is told" error={errStep === 3 ? error : null}>
            <div>
              <div className={`mb-1.5 ${LABEL}`}>Roles</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Roles">
                {(meta?.roles || []).map((r) => {
                  const on = form.recipients.roles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRecipients({ roles: on ? form.recipients.roles.filter((x) => x !== r) : [...form.recipients.roles, r] })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />} {roleLabel(r)}
                    </button>
                  );
                })}
              </div>
            </div>

            <MultiPick
              label="Users"
              placeholder="Search users…"
              options={(meta?.users || []).map((u) => ({ value: String(u.id), label: u.name, sub: roleLabel(u.role) }))}
              value={form.recipients.users.map(String)}
              onChange={(users) => setRecipients({ users })}
            />
            <MultiPick
              label="Departments (everyone with a login in them)"
              placeholder="Search departments…"
              options={(meta?.departments || []).map((d) => ({ value: String(d.id), label: d.name }))}
              value={form.recipients.departments.map(String)}
              onChange={(ids) => setRecipients({ departments: ids.map(Number) })}
            />

            {model && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MultiPick
                  label="People named on the record"
                  help="A field holding a login (user id) — e.g. who created or requested it."
                  placeholder="Search fields…"
                  options={rankFields(fields, looksLikeUserField)}
                  value={form.recipients.userFields}
                  onChange={(userFields) => setRecipients({ userFields })}
                  compact
                />
                <MultiPick
                  label="The employee on the record"
                  help="A field holding an employee id — their login is told."
                  placeholder="Search fields…"
                  options={rankFields(fields, looksLikeEmployeeField)}
                  value={form.recipients.employeeFields}
                  onChange={(employeeFields) => setRecipients({ employeeFields })}
                  compact
                />
              </div>
            )}

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium text-foreground/80">Also tell the person who made the change</span>
                <span className="block text-xs text-muted-foreground">Off: they are left out even if a role or field above includes them.</span>
              </span>
              <Switch checked={form.notify_actor} onCheckedChange={(v) => set({ notify_actor: v })} aria-label="Also tell the person who made the change" />
            </label>
          </Step>

          {/* 4 — Message */}
          <Step n={4} title="Message" error={errStep === 4 ? error : null}>
            <MessageEditor form={form} set={set} model={model} />
          </Step>

          {/* Test */}
          <section className="rounded-xl border-2 border-dashed border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-foreground">Test against recent changes</div>
                <div className="text-xs text-muted-foreground">Checks the last 300 changes of this table. Nothing is sent.</div>
              </div>
              <Button type="button" variant="outline" className="gap-1.5 bg-background" onClick={runTest} disabled={!form.model_name || test?.loading}>
                {test?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Run test
              </Button>
            </div>
            {test && !test.loading && <TestResult result={test} type={form.type} />}
          </section>
        </div>

        <SheetFooter className="flex-row flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-3 sm:space-x-0 sm:px-6">
          <label className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={form.is_active} onCheckedChange={(v) => set({ is_active: v })} aria-label="Alert switched on" />
            {form.is_active ? "On" : "Off"}
          </label>
          <Button variant="outline" className="bg-background" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button className="gap-1.5" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save alert
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────
const rankFields = (fields, likely) =>
  [...fields.filter(likely), ...fields.filter((f) => !likely(f))].map((f) => ({
    value: f.name,
    label: fieldLabel(f.name),
    sub: f.name,
    suggested: likely(f),
  }));

function Field({ label, htmlFor, hint, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className={LABEL}>{label}</label>
        {hint && <span className="text-xs tabular-nums text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Step({ n, title, error, children }) {
  return (
    <section aria-labelledby={`alert-step-${n}`} className={cn("overflow-hidden rounded-xl border bg-background", error ? "border-destructive/50" : "border-border")}>
      <h3 id={`alert-step-${n}`} className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3 text-[15px] font-semibold text-primary">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>
        {title}
      </h3>
      <div className="space-y-4 p-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        {children}
      </div>
    </section>
  );
}

function ErrorNote({ children }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{children}</span>
    </div>
  );
}

function Segmented({ value, onChange, options, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Table picker — grouped by module, with search. Inline (no popover) so it scrolls inside the sheet. */
function TablePicker({ models, modules, value, onChange }) {
  const [open, setOpen] = useState(!value);
  const [q, setQ] = useState("");
  const chosen = models.find((m) => m.model === value);
  const moduleLabel = Object.fromEntries(modules.map((m) => [m.key, m.label]));

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = models.filter((m) => !s || m.label.toLowerCase().includes(s) || m.model.toLowerCase().includes(s));
    const order = [...modules.map((m) => m.key)];
    const map = new Map(order.map((k) => [k, []]));
    for (const m of hit) {
      if (!map.has(m.module)) map.set(m.module, []);
      map.get(m.module).push(m);
    }
    return [...map.entries()].filter(([, list]) => list.length);
  }, [models, modules, q]);

  return (
    <div className="space-y-2">
      <div className={LABEL}>Table</div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {chosen ? (
          <span className="min-w-0">
            <span className="font-medium text-foreground">{chosen.label}</span>
            <span className="ml-2 text-xs text-muted-foreground">{moduleLabel[chosen.module] || "Other"}{chosen.parent ? ` · lines of ${models.find((m) => m.model === chosen.parent)?.label || chosen.parent}` : ""}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Choose what to watch…</span>
        )}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="relative border-b border-border/60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tables…"
              aria-label="Search tables"
              className="h-9 w-full bg-background pl-9 pr-3 text-sm focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto overscroll-contain" role="listbox" aria-label="Tables">
            {groups.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">No table matches.</p>}
            {groups.map(([key, list]) => (
              <div key={key}>
                <div className="sticky top-0 bg-muted px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">{moduleLabel[key] || "Other"}</div>
                {list.map((m) => (
                  <button
                    key={m.model}
                    type="button"
                    role="option"
                    aria-selected={m.model === value}
                    onClick={() => {
                      onChange(m.model);
                      setOpen(false);
                      setQ("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-primary/[0.03]",
                      m.model === value && "bg-primary/10 font-medium text-primary",
                    )}
                  >
                    <span className="truncate">{m.label}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{m.model}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionRow({ index, cond, fields, first, joiner, onChange, onRemove }) {
  const field = fields.find((f) => f.name === cond.field);
  const kind = fieldKind(field?.type);
  const ops = opsFor(field?.type);
  const op = ALERT_OPS[cond.op];
  const hints = VALUE_HINTS[cond.field];
  const listId = `alert-hints-${index}`;
  const fieldOptions = fields.map((f) => ({ value: f.name, label: `${fieldLabel(f.name)} (${f.name})` }));
  const opOptions = ops.map((k) => ({ value: k, label: ALERT_OPS[k].label }));

  return (
    <li className="rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">{first ? "Only if" : joiner}</div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
        <ReactSelect
          {...CONDITION_MENU}
          aria-label={`Condition ${index + 1} field`}
          options={fieldOptions}
          value={fieldOptions.find((o) => o.value === cond.field) || null}
          placeholder="Choose a field…"
          noOptionsMessage={() => "Nothing found"}
          menuPlacement="auto"
          styles={CONDITION_SELECT}
          onChange={(opt) => {
            const name = opt ? opt.value : "";
            const f = fields.find((x) => x.name === name);
            const nextOps = opsFor(f?.type);
            onChange({ field: name, op: nextOps.includes(cond.op) ? cond.op : nextOps.includes("eq") ? "eq" : nextOps[0], value: "" });
          }}
        />
        <ReactSelect
          {...CONDITION_MENU}
          aria-label={`Condition ${index + 1} comparison`}
          options={opOptions}
          value={opOptions.find((o) => o.value === cond.op) || null}
          isSearchable={false}
          menuPlacement="auto"
          styles={CONDITION_SELECT}
          onChange={(opt) => opt && onChange({ op: opt.value })}
        />
        {op?.needsValue ? (
          kind === "boolean" ? (
            <ReactSelect
              {...CONDITION_MENU}
              aria-label={`Condition ${index + 1} value`}
              options={BOOL_OPTIONS}
              value={BOOL_OPTIONS.find((o) => o.value === String(cond.value)) || null}
              placeholder="Choose…"
              isSearchable={false}
              isClearable
              menuPlacement="auto"
              styles={CONDITION_SELECT}
              onChange={(opt) => onChange({ value: opt ? opt.value : "" })}
            />
          ) : (
            <>
              <Input
                className="h-10 bg-background"
                value={cond.value}
                list={hints ? listId : undefined}
                inputMode={kind === "number" && cond.op !== "in" ? "decimal" : undefined}
                aria-label={`Condition ${index + 1} value`}
                placeholder={cond.op === "in" ? "a, b, c" : kind === "date" ? (cond.op === "contains" ? "e.g. 2026-11" : "YYYY-MM-DD") : kind === "number" ? "number" : "value"}
                onChange={(e) => onChange({ value: e.target.value })}
              />
              {hints && (
                <datalist id={listId}>
                  {hints.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </datalist>
              )}
            </>
          )
        ) : (
          <span className="hidden text-xs text-muted-foreground/70 sm:block">no value needed</span>
        )}
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 justify-self-end text-primary/70 hover:bg-destructive/10 hover:text-destructive" onClick={onRemove} aria-label={`Remove condition ${index + 1}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {hints && op?.needsValue && cond.value && hints.find(([v]) => v === String(cond.value).trim()) && (
        <div className="mt-1 text-xs text-muted-foreground">= {hints.find(([v]) => v === String(cond.value).trim())[1]}</div>
      )}
    </li>
  );
}

/** Chips of what is chosen + a searchable list to tick more. */
function MultiPick({ label, help, placeholder, options, value, onChange, compact }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const chosen = new Set(value);
  const byValue = new Map(options.map((o) => [o.value, o]));
  const s = q.trim().toLowerCase();
  const list = options.filter((o) => !s || o.label.toLowerCase().includes(s) || (o.sub || "").toLowerCase().includes(s));
  const toggle = (v) => onChange(chosen.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={LABEL}>{label}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-semibold text-primary hover:underline" aria-expanded={open}>
          {open ? "Done" : value.length ? "Change" : "Choose"}
        </button>
      </div>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
              <span className="truncate">{byValue.get(v)?.label || v}</span>
              <button type="button" onClick={() => toggle(v)} className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary/20" aria-label={`Remove ${byValue.get(v)?.label || v}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        !open && <p className="text-xs text-muted-foreground/70">Nobody chosen.</p>
      )}
      {open && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="relative border-b border-border/60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 w-full bg-background pl-9 pr-3 text-sm focus:outline-none" />
          </div>
          <ul className={cn("overflow-y-auto overscroll-contain", compact ? "max-h-40" : "max-h-48")}>
            {list.length === 0 && <li className="px-3 py-3 text-center text-sm text-muted-foreground">No match.</li>}
            {list.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-primary/[0.03]">
                  <Checkbox checked={chosen.has(o.value)} onCheckedChange={() => toggle(o.value)} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.suggested && <span className="rounded bg-[#edf2ee] px-1.5 text-[10px] font-medium text-[#2f5139]">likely</span>}
                  {o.sub && <span className="shrink-0 truncate font-mono text-[11px] text-muted-foreground/70">{o.sub}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MessageEditor({ form, set, model }) {
  const [target, setTarget] = useState("message");
  const [useOld, setUseOld] = useState(false);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const titleRef = useRef(null);
  const messageRef = useRef(null);

  const fieldNames = useMemo(() => (model?.fields || []).filter((f) => !f.list).map((f) => f.name), [model]);
  const known = useMemo(() => new Set([...COMMON_VARS.map((v) => v.name), ...fieldNames, ...fieldNames.map((n) => `old_${n}`)]), [fieldNames]);
  const unknown = [...new Set([...templateVarNames(form.title_template), ...templateVarNames(form.message_template)])].filter((n) => !known.has(n));
  const s = q.trim().toLowerCase();
  const fieldChips = fieldNames.filter((n) => !s || n.toLowerCase().includes(s) || fieldLabel(n).toLowerCase().includes(s));
  const shownChips = showAll || s ? fieldChips : fieldChips.slice(0, 18);

  const vars = sampleVars(model, form);
  const previewTitle = renderTemplate(form.title_template, vars, TEMPLATE_LIMITS.title) || `${vars.table} ${vars.action}`;
  const previewMessage = renderTemplate(form.message_template, vars, TEMPLATE_LIMITS.message) || `${vars.table} #${vars.record} ${vars.action} by ${vars.actor}.`;

  const insert = (name) => {
    const token = `{${name}}`;
    const isTitle = target === "title";
    const el = isTitle ? titleRef.current : messageRef.current;
    const key = isTitle ? "title_template" : "message_template";
    const value = form[key];
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const max = isTitle ? TEMPLATE_LIMITS.title : TEMPLATE_LIMITS.message;
    const next = (value.slice(0, start) + token + value.slice(end)).slice(0, max);
    set({ [key]: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className={`mb-1.5 ${LABEL}`}>Type</div>
        <Segmented
          label="Notification type"
          value={form.type}
          onChange={(v) => set({ type: v })}
          options={Object.entries(TYPE_META).map(([k, m]) => ({ value: k, label: m.label, icon: <m.icon className="h-3.5 w-3.5" /> }))}
        />
      </div>

      <Field label="Title" htmlFor="alert-title" hint={`${form.title_template.length}/${TEMPLATE_LIMITS.title}`}>
        <Input
          id="alert-title"
          ref={titleRef}
          value={form.title_template}
          maxLength={TEMPLATE_LIMITS.title}
          onFocus={() => setTarget("title")}
          onChange={(e) => set({ title_template: e.target.value })}
          placeholder="e.g. Big payment: {tr_amount}"
          className="h-10"
        />
      </Field>
      <Field label="Message" htmlFor="alert-message" hint={`${form.message_template.length}/${TEMPLATE_LIMITS.message}`}>
        <Textarea
          id="alert-message"
          ref={messageRef}
          rows={3}
          value={form.message_template}
          maxLength={TEMPLATE_LIMITS.message}
          onFocus={() => setTarget("message")}
          onChange={(e) => set({ message_template: e.target.value })}
          placeholder="e.g. {actor} made payment voucher #{vr_no} for {tr_amount}."
        />
      </Field>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Placeholders · insert into {target}</span>
          {model && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={useOld} onCheckedChange={setUseOld} aria-label="Insert the old value" /> Old value
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_VARS.map((v) => (
            <Chip key={v.name} name={v.name} title={v.description} onClick={() => insert(v.name)} />
          ))}
        </div>
        {model && (
          <>
            {fieldNames.length > 18 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${fieldNames.length} fields…`} aria-label="Search fields" className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {shownChips.map((n) => (
                <Chip key={n} name={useOld ? `old_${n}` : n} title={`${useOld ? "Old value of " : ""}${fieldLabel(n)}`} onClick={() => insert(useOld ? `old_${n}` : n)} subtle />
              ))}
              {!showAll && !s && fieldChips.length > shownChips.length && (
                <button type="button" onClick={() => setShowAll(true)} className="rounded-md px-2 py-1 text-xs font-semibold text-primary hover:underline">
                  +{fieldChips.length - shownChips.length} more
                </button>
              )}
            </div>
          </>
        )}
        {unknown.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-md bg-[#f5f0e6] px-2 py-1.5 text-xs text-[#5f4b1f]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {unknown.map((n) => `{${n}}`).join(", ")} {unknown.length === 1 ? "is" : "are"} not a field of this table and will be left empty.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
          <Eye className="h-3.5 w-3.5" /> Preview with sample values
        </div>
        <NotificationPreview type={form.type} title={previewTitle} message={previewMessage} />
        {!form.title_template && !form.message_template && <p className="text-xs text-muted-foreground">Empty boxes show the system&apos;s wording — but the alert needs both to be saved.</p>}
      </div>
    </div>
  );
}

function Chip({ name, title, onClick, subtle }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the cursor in the text box
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs transition hover:border-primary/50 hover:bg-primary/5",
        subtle ? "border-border bg-background text-muted-foreground" : "border-primary/20 bg-primary/5 text-primary",
      )}
    >
      {`{${name}}`}
    </button>
  );
}

function NotificationPreview({ type, title, message, footer }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-background p-3">
      <TypeIcon type={type} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm font-semibold text-foreground">{title}</div>
        <div className="break-words text-sm text-muted-foreground">{message}</div>
        {footer && <div className="mt-1 text-[11px] text-muted-foreground/70">{footer}</div>}
      </div>
    </div>
  );
}

function TestResult({ result, type }) {
  const { checked = 0, matched = 0, samples = [], recipients = { count: 0, names: [] }, note } = result;
  return (
    <div className="mt-4 space-y-3" aria-live="polite">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className={cn("rounded-full px-3 py-1 font-medium", matched ? "bg-[#edf2ee] text-[#2f5139]" : "bg-muted text-muted-foreground")}>
          {matched} of {checked} recent changes match
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {recipients.count} would be told
        </span>
      </div>
      {recipients.names?.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {recipients.names.join(", ")}
          {recipients.count > recipients.names.length ? ` and ${recipients.count - recipients.names.length} more` : ""}
        </p>
      )}
      {matched > 0 && recipients.count === 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-[#f5f0e6] px-2 py-1.5 text-xs text-[#5f4b1f]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> It matches, but nobody active would receive it — check step 3.
        </p>
      )}
      {samples.length > 0 && (
        <ul className="space-y-2">
          {samples.map((s, i) => (
            <li key={i}>
              <NotificationPreview
                type={type}
                title={s.title}
                message={s.message}
                footer={`${s.by || "System"} · ${s.when ? new Date(s.when).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}`}
              />
            </li>
          ))}
        </ul>
      )}
      {checked === 0 && <p className="text-xs text-muted-foreground">No recorded changes of this table yet — the test has nothing to check.</p>}
      {note && <p className="text-xs text-muted-foreground/70">{note}</p>}
    </div>
  );
}
