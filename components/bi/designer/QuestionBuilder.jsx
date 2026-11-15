"use client";
import { TOPN_VISUALS } from "@/lib/bi/visuals";
import { roleLabel } from "@/lib/auth/roleNames";
// components/bi/designer/QuestionBuilder.jsx — build a question by clicking:
// dataset → visual → measures → group by → filters → period / sort / limit,
// with a live preview drawn exactly as it will appear on a dashboard.
//
// Layout: a sticky action bar (name, status, Cancel / Save, Ctrl+S); a left
// rail (data source, "show as", the dataset's fields — searchable, click to
// add); the live preview; and the settings. Wide screens show the three side
// by side, laptops put the settings under the preview, phones stack them all.
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Plus, Trash2, Save, X, Loader2, Flag, ClipboardCheck, Lock, Search, ChevronDown, Filter, Calendar, Hash, Type, Sigma, ArrowLeft, AlertTriangle, CheckCircle2,
} from "lucide-react";
import Widget from "@/components/bi/Widget";
import DrillModal from "@/components/bi/DrillModal";
import { describePoint, ROW_RULE_OPS } from "@/components/bi/drill";
import SearchSelect from "@/components/bi/SearchSelect";
import { Field, Panel, SmallBtn, SEL, INP, useDebounced } from "./ui";

// Visuals that can show a target, and ones that colour by rules.
const TARGET_VISUALS = ["kpi", "number", "gauge", "bar", "barH", "line", "area", "stacked", "combo"];
const RULE_VISUALS = ["kpi", "number", "table", "pivot"];
const RULE_COLORS = [
  { key: "moss", label: "Green" },
  { key: "brass", label: "Amber" },
  { key: "rust", label: "Red" },
  { key: "steel", label: "Blue" },
];

const blank = (dataset) => ({
  dataset,
  measures: [],
  dimensions: [],
  filters: [],
  period: "mtd",
  sort: { by: "", dir: "desc" },
  limit: "",
  visual: { type: "kpi", options: {} },
});

const FIELD_ICON = { date: Calendar, number: Hash };

export default function QuestionBuilder({ meta, question, onSaved, onCancel }) {
  const [name, setName] = useState(question?.name ?? "");
  const [description, setDescription] = useState(question?.description ?? "");
  const [config, setConfig] = useState(question?.config ?? blank(meta.datasets[0]?.key));
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [valueLists, setValueLists] = useState({});
  const [drill, setDrill] = useState(null);
  const [fieldFind, setFieldFind] = useState("");
  const [showFields, setShowFields] = useState(false); // phone: the field list folds away

  const ds = meta.datasets.find((d) => d.key === config.dataset);
  const visual = meta.visuals.find((v) => v.key === config.visual?.type) ?? meta.visuals[0];
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const setOpt = (patch) => setConfig((c) => ({ ...c, visual: { ...c.visual, options: { ...(c.visual?.options || {}), ...patch } } }));
  const rules = config.visual?.options?.rules || [];
  const rowRules = config.visual?.options?.rowRules || [];

  async function openDrill(point) {
    const subtitle = preview ? describePoint(preview, point) : "";
    setDrill({ title: name || "Records", subtitle, loading: true });
    try {
      const { data } = await axios.post("/api/bi/run", { drill: true, config, point });
      setDrill({ title: name || "Records", subtitle, data });
    } catch (e) {
      setDrill({ title: name || "Records", subtitle, error: e.response?.data?.error || e.message });
    }
  }

  // What the chosen visual needs vs what is configured.
  const problems = useMemo(() => {
    const out = [];
    const [dMin, dMax] = visual.dims;
    const [mMin, mMax] = visual.measures;
    const nd = config.dimensions.length;
    const nm = config.measures.length;
    if (nm < mMin) out.push(`${visual.label} needs ${mMin === mMax ? mMin : `at least ${mMin}`} measure${mMin > 1 ? "s" : ""}.`);
    if (nm > mMax) out.push(`${visual.label} uses only ${mMax} measure${mMax > 1 ? "s" : ""} — remove ${nm - mMax}.`);
    if (nd < dMin) out.push(`${visual.label} needs ${dMin} group-by field${dMin > 1 ? "s" : ""}.`);
    if (nd > dMax) out.push(dMax === 0 ? `${visual.label} has no group-by — remove them.` : `${visual.label} uses at most ${dMax} group-by field${dMax > 1 ? "s" : ""}.`);
    return out;
  }, [visual, config.dimensions.length, config.measures.length]);

  // Live preview (debounced) whenever the config is valid.
  const debounced = useDebounced(config, 500);
  useEffect(() => {
    if (problems.length || !debounced.measures.length) {
      setPreview(null);
      return;
    }
    let cancel = false;
    setRunning(true);
    setPreviewError(null);
    axios
      .post("/api/bi/run", { config: debounced })
      .then(({ data }) => !cancel && setPreview(data))
      .catch((e) => !cancel && setPreviewError(e.response?.data?.error || e.message))
      .finally(() => !cancel && setRunning(false));
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, problems.length]);

  async function loadValues(field) {
    if (valueLists[field]) return;
    try {
      const { data } = await axios.post("/api/bi/run", { values: { dataset: config.dataset, field } });
      setValueLists((v) => ({ ...v, [field]: data.values || [] }));
    } catch { /* free text still works */ }
  }

  function changeDataset(key) {
    setConfig({ ...blank(key), visual: config.visual, period: config.period });
    setValueLists({});
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const body = { name, description, config };
      const { data } = question?.id
        ? await axios.put(`/api/bi/questions/${question.id}`, body)
        : await axios.post("/api/bi/questions", body);
      onSaved(data);
    } catch (e) {
      setSaveError(e.response?.data?.error || e.message);
      toast.error(`Could not save: ${e.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+S / ⌘S saves (when the question can be saved).
  const canSave = !saving && Boolean(name.trim()) && problems.length === 0;
  const saveRef = useRef(null);
  saveRef.current = () => {
    if (canSave) save();
    else if (!name.trim()) toast.error("Give the question a name first.");
    else if (problems.length) toast.error(problems[0]);
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sortOptions = [
    ...config.dimensions.map((d, i) => ({ key: `d${i}`, label: ds?.fields.find((f) => f.key === d.field)?.label ?? d.field })),
    ...config.measures.map((m, i) => ({ key: `m${i}`, label: m.label || ds?.measures.find((x) => x.key === m.key)?.label || m.key })),
  ];

  // Field browser (left rail): the same additions as the panels' Add buttons.
  const canAddMeasure = ds && config.measures.length < visual.measures[1];
  const canAddDim = ds && visual.dims[1] !== 0 && config.dimensions.length < Math.max(visual.dims[1], 0);
  const addMeasure = (m) => set({ measures: [...config.measures, { key: m.key, agg: m.aggs[0] }] });
  const addDim = (f) => set({ dimensions: [...config.dimensions, { field: f.key, grain: "month" }] });
  const addFilter = (f) => set({ filters: [...config.filters, { field: f.key, op: "eq", value: "" }] });
  const ff = fieldFind.trim().toLowerCase();
  const railMeasures = (ds?.measures ?? []).filter((m) => !ff || m.label.toLowerCase().includes(ff));
  const railFields = (ds?.fields ?? []).filter((f) => !ff || f.label.toLowerCase().includes(ff));
  const usedMeasures = new Set(config.measures.map((m) => m.key));
  const usedFields = new Set(config.dimensions.map((d) => d.field));

  const status = saving ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Saving…</span>
  ) : problems.length ? (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs text-[#5f4b1f] dark:text-amber-300" title={problems.join(" ")}>
      <AlertTriangle size={13} className="flex-shrink-0" /> <span className="truncate">{problems[0]}</span>
    </span>
  ) : running ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Running…</span>
  ) : preview ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#2f5139] dark:text-green-400"><CheckCircle2 size={13} /> Preview up to date</span>
  ) : null;

  return (
    <div className="space-y-4">
      {/* ── action bar ── */}
      <div className="sticky top-[var(--header-height,0px)] z-20 -mx-3 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <SmallBtn title="Back to the list" onClick={onCancel} className="h-9 w-9 justify-center px-0"><ArrowLeft size={15} /></SmallBtn>
          <div className="min-w-0 flex-1 basis-56">
            <input
              className={`${INP} h-9 font-semibold`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={question?.id ? "Question name" : "Name your new question, e.g. Sales this month"}
              aria-label="Question name"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
            <div className="min-w-0 max-w-[280px] flex-1">{saveError ? <span className="block truncate text-xs text-destructive" title={saveError}>{saveError}</span> : status}</div>
            <SmallBtn onClick={onCancel} className="h-9"><X size={14} /> Cancel</SmallBtn>
            <SmallBtn tone="primary" onClick={save} disabled={!canSave} className="h-9 px-3" title="Save (Ctrl+S)">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save question
              <kbd className="ml-1 hidden rounded border border-white/40 px-1 font-mono text-[10px] sm:inline">Ctrl S</kbd>
            </SmallBtn>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_420px]">
        {/* ── left rail: data source, visual, fields ── */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-[calc(var(--header-height,0px)+72px)] lg:row-span-2 lg:max-h-[calc(100svh-var(--header-height,0px)-88px)] lg:overflow-y-auto 2xl:row-span-1">
          <Panel title="Data">
            <Field label="Dataset" hint={ds?.description}>
              <SearchSelect width="100%" isClearable={false} placeholder="Search data sources…" value={config.dataset}
                options={meta.datasets.map((d) => ({ value: d.key, label: d.label }))} onChange={(v) => v && changeDataset(v)} />
            </Field>
            <Field label="Description (optional)">
              <input className={INP} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this figure shows" />
            </Field>
          </Panel>

          <Panel title="Show as">
            <div className="space-y-2.5">
              {[...new Set(meta.visuals.map((v) => v.group))].map((g) => (
                <div key={g}>
                  <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{g}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.visuals.filter((v) => v.group === g).map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        title={v.hint}
                        onClick={() => set({ visual: { ...config.visual, type: v.key } })}
                        aria-pressed={config.visual?.type === v.key}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          config.visual?.type === v.key
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:border-primary/50 hover:text-primary"
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {visual.hint && <p className="text-xs text-muted-foreground">{visual.hint}</p>}
          </Panel>

          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-background">
            <button
              type="button"
              onClick={() => setShowFields((s) => !s)}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2 text-left lg:pointer-events-none"
              aria-expanded={showFields}
            >
              <h3 className="text-sm font-semibold text-primary">Fields{ds ? ` · ${ds.label}` : ""}</h3>
              <ChevronDown size={16} className={`text-primary transition-transform lg:hidden ${showFields ? "rotate-180" : ""}`} />
            </button>
            <div className={`${showFields ? "block" : "hidden"} space-y-3 p-3 lg:block`}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input className={`${INP} pl-8`} placeholder="Search fields…" value={fieldFind} onChange={(e) => setFieldFind(e.target.value)} aria-label="Search fields" />
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5 px-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Sigma size={12} /> Measures
                </div>
                <ul className="space-y-0.5">
                  {railMeasures.map((m) => (
                    <li key={m.key}>
                      <button
                        type="button"
                        disabled={!canAddMeasure}
                        onClick={() => addMeasure(m)}
                        title={canAddMeasure ? "Add as a measure" : `${visual.label} takes no more measures`}
                        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-primary/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Sigma size={13} className="flex-shrink-0 text-primary/70" />
                        <span className={`min-w-0 flex-1 truncate ${usedMeasures.has(m.key) ? "font-semibold text-primary" : ""}`}>{m.label}</span>
                        <Plus size={13} className="flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
                  {railMeasures.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No measure matches.</li>}
                </ul>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5 px-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Type size={12} /> Fields
                </div>
                <ul className="space-y-0.5">
                  {railFields.map((f) => {
                    const Icon = FIELD_ICON[f.type] || Type;
                    return (
                      <li key={f.key} className="group flex items-center gap-1 rounded-md hover:bg-primary/[0.06]">
                        <button
                          type="button"
                          disabled={!canAddDim}
                          onClick={() => addDim(f)}
                          title={canAddDim ? "Group by this field" : `${visual.label} takes no more group-by fields`}
                          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Icon size={13} className="flex-shrink-0 text-muted-foreground" />
                          <span className={`min-w-0 flex-1 truncate ${usedFields.has(f.key) ? "font-semibold text-primary" : ""}`}>{f.label}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => addFilter(f)}
                          title="Filter on this field"
                          aria-label={`Filter on ${f.label}`}
                          className="mr-1 rounded p-1 text-muted-foreground opacity-60 hover:bg-background hover:text-primary group-hover:opacity-100"
                        >
                          <Filter size={12} />
                        </button>
                      </li>
                    );
                  })}
                  {railFields.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No field matches.</li>}
                </ul>
              </div>
              <p className="px-1 text-[11px] text-muted-foreground">Click a measure or field to add it; the funnel adds a filter.</p>
            </div>
          </section>
        </aside>

        {/* ── live preview, in the dashboard look ── */}
        <div className="min-w-0 2xl:sticky 2xl:top-[calc(var(--header-height,0px)+72px)]">
          <section className="overflow-hidden rounded-xl border border-border bg-background">
            <div className="flex min-h-[44px] items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2">
              <h3 className="text-sm font-semibold text-primary">Live preview</h3>
              <span className="text-xs text-muted-foreground">As it will look on a dashboard</span>
            </div>
            <div className="bi min-w-0 p-3 sm:p-4" style={{ minHeight: 420 }}>
              {problems.length > 0 ? (
                <div className="bi-card bi-empty-state">
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Almost there</div>
                  <div className="bi-sub" style={{ marginTop: 4 }}>{problems.join(" ")}</div>
                </div>
              ) : !config.measures.length ? (
                <div className="bi-card bi-empty-state">
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Add a measure to see a preview</div>
                  <div className="bi-sub" style={{ marginTop: 4 }}>Pick one from the field list, e.g. Sale Amount.</div>
                </div>
              ) : previewError ? (
                <div className="bi-error">{previewError}</div>
              ) : (
                <Widget
                  name={name || "Untitled question"}
                  datasetLabel={ds?.label}
                  config={config}
                  result={preview}
                  period={config.period}
                  loading={!preview}
                  height={360}
                  onDrill={preview ? openDrill : undefined}
                />
              )}
              <p className="bi-sub" style={{ marginTop: 10 }}>Tip: click a bar, slice, row or card to see the records behind it.</p>
            </div>
          </section>
          <DrillModal
            open={Boolean(drill)}
            title={drill?.title}
            subtitle={drill?.subtitle}
            data={drill?.data}
            loading={drill?.loading}
            error={drill?.error}
            onClose={() => setDrill(null)}
          />
        </div>

        {/* ── settings ── */}
        <div className="min-w-0 space-y-4 lg:col-start-2 2xl:col-start-3 2xl:row-start-1">
          <Panel
            title="Measures"
            action={
              <SmallBtn
                onClick={() => set({ measures: [...config.measures, { key: ds.measures[0].key, agg: ds.measures[0].aggs[0] }] })}
                disabled={config.measures.length >= visual.measures[1]}
              >
                <Plus size={13} /> Add
              </SmallBtn>
            }
          >
            {config.measures.length === 0 && <p className="text-xs text-muted-foreground">What to count or add up — e.g. Sale Amount.</p>}
            {config.measures.map((m, i) => {
              const def = ds.measures.find((x) => x.key === m.key) ?? ds.measures[0];
              const upd = (patch) => set({ measures: config.measures.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <Field label={`Measure ${i + 1}`} className="min-w-[160px] flex-1">
                    <SearchSelect width="100%" isClearable={false} placeholder="Search measures…" value={m.key}
                      options={ds.measures.map((x) => ({ value: x.key, label: x.label }))}
                      onChange={(v) => {
                        const nd = ds.measures.find((x) => x.key === v);
                        if (nd) upd({ key: nd.key, agg: nd.aggs[0], label: "" });
                      }} />
                  </Field>
                  <Field label="As" className="w-[110px]">
                    <select className={SEL} value={m.agg} onChange={(e) => upd({ agg: e.target.value })}>
                      {meta.aggs.filter((a) => def.aggs.includes(a.key)).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  </Field>
                  <SmallBtn tone="danger" title="Remove" className="h-9 w-9 justify-center px-0" onClick={() => set({ measures: config.measures.filter((_, j) => j !== i) })}>
                    <Trash2 size={13} />
                  </SmallBtn>
                </div>
              );
            })}
          </Panel>

          <Panel
            title="Group by"
            action={
              <SmallBtn
                onClick={() => set({ dimensions: [...config.dimensions, { field: ds.fields[0].key, grain: "month" }] })}
                disabled={config.dimensions.length >= Math.max(visual.dims[1], 0) || visual.dims[1] === 0}
              >
                <Plus size={13} /> Add
              </SmallBtn>
            }
          >
            {visual.dims[1] === 0 && <p className="text-xs text-muted-foreground">This visual shows totals — no group-by.</p>}
            {visual.dims[1] !== 0 && config.dimensions.length === 0 && <p className="text-xs text-muted-foreground">Split the figure by a field — e.g. Customer, or Date per month.</p>}
            {config.dimensions.map((d, i) => {
              const def = ds.fields.find((f) => f.key === d.field);
              const upd = (patch) => set({ dimensions: config.dimensions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <Field label={i === 0 ? "By" : "Then by"} className="min-w-[160px] flex-1">
                    <SearchSelect width="100%" isClearable={false} placeholder="Search fields…" value={d.field}
                      options={ds.fields.map((f) => ({ value: f.key, label: f.label }))} onChange={(v) => v && upd({ field: v })} />
                  </Field>
                  <Field label="Per" className="w-[110px]">
                    <select className={SEL} value={d.grain || "month"} disabled={def?.type !== "date"} onChange={(e) => upd({ grain: e.target.value })}>
                      {meta.grains.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
                  </Field>
                  <SmallBtn tone="danger" title="Remove" className="h-9 w-9 justify-center px-0" onClick={() => set({ dimensions: config.dimensions.filter((_, j) => j !== i) })}>
                    <Trash2 size={13} />
                  </SmallBtn>
                </div>
              );
            })}
          </Panel>

          <Panel
            title="Filters"
            action={
              <SmallBtn onClick={() => set({ filters: [...config.filters, { field: ds.fields.find((f) => f.type !== "date")?.key ?? ds.fields[0].key, op: "eq", value: "" }] })}>
                <Plus size={13} /> Add
              </SmallBtn>
            }
          >
            {config.filters.length === 0 && <p className="text-xs text-muted-foreground">Optional — e.g. Item Category is FINISHED GOODS.</p>}
            {config.filters.map((f, i) => {
              const def = ds.fields.find((x) => x.key === f.field);
              const upd = (patch) => set({ filters: config.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              const listId = `bi-vals-${i}`;
              const needsValue = !["empty", "notEmpty"].includes(f.op);
              return (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border/70 bg-muted/30 p-2.5">
                  <Field label="Field" className="min-w-[150px] flex-1">
                    <SearchSelect width="100%" isClearable={false} placeholder="Search fields…" value={f.field}
                      options={ds.fields.map((x) => ({ value: x.key, label: x.label }))} onChange={(v) => v && upd({ field: v, value: "" })} />
                  </Field>
                  <Field label="Is" className="w-[110px]">
                    <select className={SEL} value={f.op} onChange={(e) => upd({ op: e.target.value })}>
                      {meta.filterOps.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label={f.op === "in" ? "Values (comma separated)" : "Value"} className="min-w-[130px] flex-1">
                    <input
                      className={INP}
                      disabled={!needsValue}
                      type={def?.type === "date" ? "date" : def?.type === "number" ? "number" : "text"}
                      list={def?.type === "text" ? listId : undefined}
                      value={f.value ?? ""}
                      onFocus={() => def?.type === "text" && loadValues(f.field)}
                      onChange={(e) => upd({ value: e.target.value })}
                    />
                    <datalist id={listId}>{(valueLists[f.field] || []).map((v) => <option key={v} value={v} />)}</datalist>
                  </Field>
                  <SmallBtn tone="danger" title="Remove" className="h-9 w-9 justify-center px-0" onClick={() => set({ filters: config.filters.filter((_, j) => j !== i) })}>
                    <Trash2 size={13} />
                  </SmallBtn>
                </div>
              );
            })}
          </Panel>

          <Panel title="Period, order & options">
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <Field label="Period" hint={ds?.hasDate ? "The dashboard's period bar overrides this." : "Stock is always as of now."}>
                <select className={SEL} value={config.period} disabled={!ds?.hasDate || config.visual?.type === "kpi"} onChange={(e) => set({ period: e.target.value })}>
                  {meta.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Show top (rows)">
                <input className={INP} type="number" min={1} max={5000} value={config.limit} placeholder="all" onChange={(e) => set({ limit: e.target.value })} />
              </Field>
              <Field label="Sort by">
                <SearchSelect width="100%" placeholder="Automatic" value={config.sort?.by || ""}
                  options={sortOptions.map((o) => ({ value: o.key, label: o.label }))}
                  onChange={(v) => set({ sort: { ...config.sort, by: v || "" } })} />
              </Field>
              <Field label="Direction">
                <select className={SEL} value={config.sort?.dir || "desc"} onChange={(e) => set({ sort: { ...config.sort, dir: e.target.value } })}>
                  <option value="desc">Largest first</option>
                  <option value="asc">Smallest / oldest first</option>
                </select>
              </Field>
              {config.visual?.type === "kpi" && (
                <>
                  <Field label="Monthly target (optional)" hint="Spread over the chosen days — e.g. 650 m a month shows 21 m for one November day">
                    <input className={INP} type="number" value={config.visual.options?.monthlyTarget ?? ""} onChange={(e) => setOpt({ monthlyTarget: e.target.value, ...(e.target.value ? { target: "" } : {}) })} />
                  </Field>
                  <Field label="Good when it goes" hint="Colours the ▲ / ▼ change green or red">
                    <select className={SEL} value={config.visual.options?.goodWhen || "up"} onChange={(e) => setOpt({ goodWhen: e.target.value })}>
                      <option value="up">Up (sales, receipts …)</option>
                      <option value="down">Down (payments, overdue …)</option>
                    </select>
                  </Field>
                </>
              )}
              {TARGET_VISUALS.includes(config.visual?.type) && !(config.visual?.type === "kpi" && config.visual.options?.monthlyTarget) && (
                <Field label={config.visual?.type === "kpi" ? "Fixed target / minimum (optional)" : "Target (optional)"} className="min-[400px]:col-span-2"
                  hint={config.visual?.type === "kpi" ? "The same for any period — e.g. a minimum cash balance" : "KPI / number: progress to target · charts: a dashed target line"}>
                  <div className="flex gap-2">
                    <input className={INP} type="number" value={config.visual.options?.target ?? ""} onChange={(e) => setOpt({ target: e.target.value })} />
                    {config.visual?.type === "kpi" && (
                      <input className={INP} value={config.visual.options?.targetLabel ?? ""} placeholder="Label, e.g. Minimum" onChange={(e) => setOpt({ targetLabel: e.target.value })} />
                    )}
                  </div>
                </Field>
              )}
              {ds?.hasDate && config.visual?.type !== "kpi" && (
                <label className="flex items-start gap-2 text-sm min-[400px]:col-span-2">
                  <input type="checkbox" className="mt-0.5 accent-[#800000]" checked={Boolean(config.lockPeriod)} onChange={(e) => set({ lockPeriod: e.target.checked })} />
                  Keep this question&apos;s own period (ignore the dashboard&apos;s period bar) — e.g. balances &quot;All Time&quot;
                </label>
              )}
              {["number", "kpi"].includes(config.visual?.type) && (
                <Field label="Button on a Needs-attention tile" hint="Seen fades the tile; Review opens the approvals side panel">
                  <select className={SEL} value={config.visual.options?.opens || ""} onChange={(e) => setOpt({ opens: e.target.value || undefined })}>
                    <option value="">Seen</option>
                    <option value="approvals">Review (approvals)</option>
                  </select>
                </Field>
              )}
              {TOPN_VISUALS.includes(config.visual?.type) && (
                <Field label="Top N + Others (optional)" hint="Keep the biggest N; the rest add up into one Others row">
                  <input className={INP} type="number" min={2} max={50} value={config.visual.options?.topN ?? ""} placeholder="e.g. 5" onChange={(e) => setOpt({ topN: e.target.value })} />
                </Field>
              )}
              {["bar", "barH", "line", "area", "stacked"].includes(config.visual?.type) && (
                <label className="flex items-center gap-2 text-sm min-[400px]:col-span-2">
                  <input type="checkbox" className="accent-[#800000]" checked={Boolean(config.visual.options?.showLabels)} onChange={(e) => set({ visual: { ...config.visual, options: { ...config.visual.options, showLabels: e.target.checked } } })} />
                  Show values on the chart
                </label>
              )}
            </div>
          </Panel>

          {RULE_VISUALS.includes(config.visual?.type) && (
            <Panel
              title="Colour rules"
              action={<SmallBtn onClick={() => setOpt({ rules: [...rules, { op: "<", value: "", color: "rust" }] })}><Plus size={13} /> Add</SmallBtn>}
            >
              {rules.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Optional — colour the figure by its value, e.g. red when below 1,000,000. The first matching rule wins.
                </p>
              )}
              {rules.map((r, i) => {
                const upd = (patch) => setOpt({ rules: rules.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border/70 bg-muted/30 p-2.5">
                    <Field label="When" className="w-[90px]">
                      <select className={SEL} value={r.op} onChange={(e) => upd({ op: e.target.value })}>
                        {[">", ">=", "<", "<=", "between"].map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Value" className="min-w-[90px] flex-1"><input className={INP} type="number" value={r.value} onChange={(e) => upd({ value: e.target.value })} /></Field>
                    <Field label="And" className="min-w-[90px] flex-1">
                      <input className={INP} type="number" disabled={r.op !== "between"} value={r.value2 ?? ""} onChange={(e) => upd({ value2: e.target.value })} />
                    </Field>
                    <Field label="Colour" className="w-[96px]">
                      <select className={SEL} value={r.color} onChange={(e) => upd({ color: e.target.value })}>
                        {RULE_COLORS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </Field>
                    <SmallBtn tone="danger" title="Remove" className="h-9 w-9 justify-center px-0" onClick={() => setOpt({ rules: rules.filter((_, j) => j !== i) })}><Trash2 size={13} /></SmallBtn>
                  </div>
                );
              })}
            </Panel>
          )}

          {config.visual?.type === "table" && (() => {
            // Columns of this table a rule can test: its group-by fields and measures.
            const ruleCols = [
              ...config.dimensions.map((d) => ({ value: `d:${d.field}`, label: ds?.fields.find((x) => x.key === d.field)?.label ?? d.field })),
              ...config.measures.map((m) => ({ value: `m:${m.key}`, label: ds?.measures.find((x) => x.key === m.key)?.label ?? m.key })),
            ];
            const setRR = (list) => setOpt({ rowRules: list });
            return (
              <Panel
                title={<span className="flex items-center gap-1.5"><Flag size={14} /> Highlight rows (follow-up)</span>}
                action={
                  <SmallBtn
                    disabled={!ruleCols.length}
                    onClick={() => setRR([...rowRules, { column: ruleCols[ruleCols.length - 1]?.value || "", op: ">=", value: "7", color: "rust", label: "Follow up" }])}
                  >
                    <Plus size={13} /> Add
                  </SmallBtn>
                }
              >
                {rowRules.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Optional — flag the rows someone must act on, e.g. <b>Days Since First Dispatch ≥ 7 → red “Follow up”</b>, or
                    <b> Stage is ETA Passed → red “Late”</b>. The table then shows how many need follow-up and can list only those.
                    Tip: add the column you want to test (e.g. the days measure) to the table first.
                  </p>
                )}
                {rowRules.map((rr, i) => {
                  const upd = (patch) => setRR(rowRules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  const noValue = rr.op === "empty" || rr.op === "notEmpty";
                  return (
                    <div key={i} className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-2.5">
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="Column" className="min-w-[150px] flex-1">
                          <SearchSelect width="100%" isClearable={false} placeholder="Choose a column…" value={rr.column} options={ruleCols} onChange={(v) => upd({ column: v })} />
                        </Field>
                        <Field label="Condition" className="w-[130px]">
                          <select className={SEL} value={rr.op} onChange={(e) => upd({ op: e.target.value })}>
                            {ROW_RULE_OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="Value" className="min-w-[80px] flex-1"><input className={INP} disabled={noValue} value={rr.value ?? ""} onChange={(e) => upd({ value: e.target.value })} /></Field>
                        <Field label="And" className="min-w-[80px] flex-1"><input className={INP} disabled={rr.op !== "between"} value={rr.value2 ?? ""} onChange={(e) => upd({ value2: e.target.value })} /></Field>
                        <Field label="Colour" className="w-[96px]">
                          <select className={SEL} value={rr.color} onChange={(e) => upd({ color: e.target.value })}>
                            {RULE_COLORS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                        </Field>
                        <Field label="Label" className="min-w-[110px] flex-1"><input className={INP} value={rr.label ?? ""} placeholder="Follow up" onChange={(e) => upd({ label: e.target.value })} /></Field>
                        <SmallBtn tone="danger" title="Remove" className="h-9 w-9 justify-center px-0" onClick={() => setRR(rowRules.filter((_, j) => j !== i))}><Trash2 size={13} /></SmallBtn>
                      </div>
                    </div>
                  );
                })}
              </Panel>
            );
          })()}

          {config.visual?.type === "table" && (() => {
            // Follow-up scenario (lib/bi/followups.js): flagged rows become items
            // someone must log; reminders, escalation, optional FOC/Trial block.
            const fu = config.followup || {};
            const setFu = (patch) => set({ followup: { ...fu, ...patch } });
            const keyOptions = config.dimensions.map((d) => ({ value: `d:${d.field}`, label: ds?.fields.find((x) => x.key === d.field)?.label ?? d.field }));
            const hasOwner = Boolean(ds?.followup?.owner);
            const steps = Array.isArray(fu.escalation) ? fu.escalation : [];
            const people = (meta.users || []).map((u) => ({ value: u.id, label: `${u.name || u.email} · ${roleLabel(u.role)}` }));
            const ruleOptions = (meta.approvalRules || []).map((r) => ({
              value: r.id,
              label: `${r.name} · ${r.doc_type}${r.is_active ? "" : " (inactive)"}`,
            }));
            const hasApprovers = Array.isArray(fu.approverRules) && fu.approverRules.length > 0;
            const dateFields = (ds?.fields || []).filter((x) => x.type === "date" && !x.hidden).map((x) => ({ value: x.key, label: x.label }));
            return (
              <Panel title={<span className="flex items-center gap-1.5"><ClipboardCheck size={14} /> Follow-up (turn rows into tasks)</span>}>
                <label className="flex items-start gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[#800000]"
                    checked={Boolean(fu.enabled)}
                    onChange={(e) =>
                      setFu({
                        enabled: e.target.checked,
                        key: fu.key || keyOptions[0]?.value || "",
                        owner: fu.owner || (hasOwner ? "sales_person" : "assignees"),
                        escalation: steps.length ? steps : [{ afterDays: 0, users: [] }, { afterDays: 1, users: [] }],
                      })
                    }
                  />
                  Every highlighted row (or every row, if no highlight rule) is a follow-up to log
                </label>
                {fu.enabled && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                      <Field label="One follow-up per" hint="The column that identifies the item, e.g. SO No">
                        <SearchSelect width="100%" isClearable={false} value={fu.key} options={keyOptions} onChange={(v) => setFu({ key: v })} />
                      </Field>
                      <Field label="Who follows up">
                        <select className={SEL} value={fu.owner || "assignees"} onChange={(e) => setFu({ owner: e.target.value })}>
                          {hasOwner && <option value="sales_person">The customer&apos;s sales person</option>}
                          <option value="assignees">These people (below)</option>
                        </select>
                      </Field>
                    </div>
                    <Field label={fu.owner === "sales_person" ? "If no sales person: these people" : "People who follow up"}>
                      <SearchSelect multi width="100%" placeholder="Search people…" value={fu.assignees || []} options={people} onChange={(v) => setFu({ assignees: v })} />
                    </Field>

                    <div className="flex flex-wrap items-end gap-2">
                      <Field label="Due from" hint="No date on a row = not a follow-up yet (e.g. not dispatched)" className="min-w-[180px] flex-1">
                        <SearchSelect
                          width="100%"
                          placeholder="When it is first highlighted"
                          value={fu.dueField || null}
                          options={dateFields}
                          onChange={(v) => setFu({ dueField: v || null })}
                        />
                      </Field>
                      <Field label="+ days" className="w-[110px]">
                        <input className={INP} type="number" min={0} disabled={!fu.dueField} value={fu.dueDays ?? 0} onChange={(e) => setFu({ dueDays: Number(e.target.value) || 0 })} />
                      </Field>
                    </div>

                    <Field label="Approvers (see every item)" hint="Whoever approves these rules (Permissions → Approvals) — change the rule, the people change">
                      <SearchSelect
                        multi
                        width="100%"
                        placeholder="e.g. Free of Cost, Trial Process…"
                        value={fu.approverRules || []}
                        options={ruleOptions}
                        onChange={(v) => setFu({ approverRules: v })}
                      />
                    </Field>
                    {hasApprovers && (
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-0.5 accent-[#800000]" checked={Boolean(fu.notifyOnLog)} onChange={(e) => setFu({ notifyOnLog: e.target.checked })} />
                        Tell the approvers each time a follow-up is logged (result + remarks)
                      </label>
                    )}

                    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">Escalation (days after it is due)</span>
                        <SmallBtn onClick={() => setFu({ escalation: [...steps, { afterDays: (steps.at(-1)?.afterDays ?? 0) + 1, users: [] }] })}><Plus size={13} /> Step</SmallBtn>
                      </div>
                      {steps.map((st, i) => (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                          <Field label={`Step ${i + 1} after`} className="w-[110px]">
                            <input
                              className={INP}
                              type="number"
                              min={0}
                              value={st.afterDays}
                              onChange={(e) => setFu({ escalation: steps.map((x, j) => (j === i ? { ...x, afterDays: Number(e.target.value) || 0 } : x)) })}
                            />
                          </Field>
                          <Field label="Tell" className="min-w-[160px] flex-1">
                            <SearchSelect
                              multi
                              width="100%"
                              placeholder="e.g. Sales manager…"
                              value={st.users || []}
                              options={people}
                              onChange={(v) => setFu({ escalation: steps.map((x, j) => (j === i ? { ...x, users: v } : x)) })}
                            />
                          </Field>
                          {hasApprovers && (
                            <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-xs">
                              <input
                                type="checkbox"
                                className="accent-[#800000]"
                                checked={Boolean(st.approvers)}
                                onChange={(e) => setFu({ escalation: steps.map((x, j) => (j === i ? { ...x, approvers: e.target.checked } : x)) })}
                              />
                              + approvers
                            </label>
                          )}
                          <SmallBtn tone="danger" title="Remove" className="h-9 w-9 justify-center px-0" onClick={() => setFu({ escalation: steps.filter((_, j) => j !== i) })}><Trash2 size={13} /></SmallBtn>
                        </div>
                      ))}
                      <p className="text-[11px] text-muted-foreground">0 = the day it becomes due. The owner also gets one summary every morning (09:00).</p>
                    </div>

                    {ds?.followup?.party && (
                      <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                        <input type="checkbox" className="mt-0.5 accent-[#800000]" checked={Boolean(fu.blockFoc)} onChange={(e) => setFu({ blockFoc: e.target.checked })} />
                        <span>
                          <span className="flex items-center gap-1 font-semibold"><Lock size={13} /> Block new Free of Cost / Trial orders</span>
                          <span className="block text-xs text-muted-foreground">While a follow-up of this list is open for a customer, the Sale Order form refuses another Free of Cost / Trial order for them.</span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </Panel>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
