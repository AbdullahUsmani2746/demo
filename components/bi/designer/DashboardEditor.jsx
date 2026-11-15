"use client";
import { roleLabel } from "@/lib/auth/roleNames";
// components/bi/designer/DashboardEditor.jsx — lay out a dashboard (sections →
// widgets with a width of 1–4 columns; drag to reorder, also between
// sections), add dashboard-wide filters, preview with live data, and assign
// it to departments / roles / people.
//
// Two modes behind one sticky action bar: Edit (layout, details, filters and
// assignments) and Preview (the dashboard drawn with live data, as viewers
// see it). Save works from either, also with Ctrl+S.
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Loader2, ArrowUp, ArrowDown, Eye, Users, GripVertical, Filter, ArrowLeft, PencilRuler, RefreshCw, LayoutGrid } from "lucide-react";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import DashboardCanvas from "@/components/bi/DashboardCanvas";
import SearchSelect from "@/components/bi/SearchSelect";
import { Field, Panel, SmallBtn, SEL, INP } from "./ui";

let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
// One column on a phone; the widget's own width (of 4) from sm up.
const SPAN = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4" };

/** One draggable widget tile (drag by its grip). */
function SortableTile({ id, width, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`col-span-1 flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-2.5 ${SPAN[width] || SPAN[1]} ${
        isDragging ? "border-primary shadow-lg" : "border-border hover:border-primary/40"
      }`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <button type="button" className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Drag to move" aria-label="Drag to move" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </button>
        {children[0]}
      </div>
      {children[1]}
    </div>
  );
}

/** A section's tile area — also a drop target, so tiles can move into empty sections. */
function SectionDrop({ id, empty, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`rounded-lg transition-shadow ${isOver ? "ring-2 ring-primary/40" : ""}`} style={{ minHeight: empty ? 44 : undefined }}>
      {children}
    </div>
  );
}

const move = (arr, i, d) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

export default function DashboardEditor({ meta, questions, dashboard, onSaved, onCancel, onAssigned }) {
  const [name, setName] = useState(dashboard?.name ?? "");
  const [description, setDescription] = useState(dashboard?.description ?? "");
  const [period, setPeriod] = useState(dashboard?.default_period ?? "mtd");
  const [active, setActive] = useState(dashboard?.is_active ?? true);
  const [sections, setSections] = useState(
    dashboard?.layout?.sections?.length ? dashboard.layout.sections : [{ id: uid("s"), title: "Overview", items: [] }],
  );
  const [filters, setFilters] = useState(dashboard?.layout?.filters ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState("edit"); // edit | preview
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Drop a tile: reorder within its section, or move it to another section.
  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setSections((ss) => {
      const from = ss.findIndex((x) => x.items.some((it) => it.id === active.id));
      let to = ss.findIndex((x) => x.items.some((it) => it.id === over.id));
      if (to < 0) to = ss.findIndex((x) => `sec:${x.id}` === over.id);
      if (from < 0 || to < 0) return ss;
      if (from === to) {
        const items = ss[from].items;
        const a = items.findIndex((it) => it.id === active.id);
        const b = items.findIndex((it) => it.id === over.id);
        return ss.map((x, j) => (j === from ? { ...x, items: arrayMove(items, a, b < 0 ? items.length - 1 : b) } : x));
      }
      const moving = ss[from].items.find((it) => it.id === active.id);
      return ss.map((x, j) => {
        if (j === from) return { ...x, items: x.items.filter((it) => it.id !== active.id) };
        if (j === to) {
          const at = x.items.findIndex((it) => it.id === over.id);
          const items = [...x.items];
          items.splice(at < 0 ? items.length : at, 0, moving);
          return { ...x, items };
        }
        return x;
      });
    });
  }
  const [previewing, setPreviewing] = useState(false);

  const qById = new Map(questions.map((q) => [q.id, q]));
  const visLabel = (key) => meta.visuals.find((v) => v.key === key)?.label ?? key;
  const updSection = (i, patch) => setSections((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updItems = (i, fn) => setSections((ss) => ss.map((s, j) => (j === i ? { ...s, items: fn(s.items) } : s)));
  const widgetCount = sections.reduce((n, s) => n + s.items.length, 0);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = { name, description, default_period: period, is_active: active, layout: { sections, filters } };
      const { data } = dashboard?.id
        ? await axios.put(`/api/bi/dashboards/${dashboard.id}`, body)
        : await axios.post("/api/bi/dashboards", body);
      onSaved(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      toast.error(`Could not save: ${e.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    setPreviewing(true);
    const ids = [...new Set(sections.flatMap((s) => s.items.map((it) => it.questionId)))];
    const results = {};
    await Promise.all(
      ids.map(async (id) => {
        const q = qById.get(id);
        if (!q) return;
        const dsLabel = meta.datasets.find((d) => d.key === q.dataset)?.label;
        try {
          const { data } = await axios.post("/api/bi/run", { config: q.config, period });
          results[id] = { name: q.name, datasetLabel: dsLabel, config: q.config, result: data };
        } catch (e) {
          results[id] = { name: q.name, datasetLabel: dsLabel, config: q.config, error: e.response?.data?.error || e.message };
        }
      }),
    );
    setPreview(results);
    setPreviewing(false);
  }

  function showPreview() {
    setMode("preview");
    runPreview();
  }

  // Ctrl+S / ⌘S saves.
  const canSave = !saving && Boolean(name.trim());
  const saveRef = useRef(null);
  saveRef.current = () => (canSave ? save() : !name.trim() && toast.error("Give the dashboard a name first."));
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
              placeholder="Dashboard name, e.g. Dispatch Desk"
              aria-label="Dashboard name"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
            <div className="inline-flex rounded-md border border-border bg-muted/50 p-0.5" role="tablist" aria-label="Mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "edit"}
                onClick={() => setMode("edit")}
                className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors ${mode === "edit" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <PencilRuler size={13} /> Edit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "preview"}
                onClick={showPreview}
                className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors ${mode === "preview" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Eye size={13} /> Preview
              </button>
            </div>
            <span className="flex-1 sm:hidden" />
            <SmallBtn onClick={onCancel} className="h-9"><X size={14} /> Close</SmallBtn>
            <SmallBtn tone="primary" onClick={save} disabled={!canSave} className="h-9 px-3" title="Save (Ctrl+S)">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              <kbd className="ml-1 hidden rounded border border-white/40 px-1 font-mono text-[10px] sm:inline">Ctrl S</kbd>
            </SmallBtn>
          </div>
        </div>
        {error && <p className="mt-1.5 truncate text-xs text-destructive" title={error}>{error}</p>}
      </div>

      {mode === "preview" ? (
        <section className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2">
            <h3 className="text-sm font-semibold text-primary">
              Preview{name ? ` — ${name}` : ""} <span className="font-normal text-muted-foreground">· {meta.periods.find((p) => p.key === period)?.label ?? period} · your own data access</span>
            </h3>
            <SmallBtn onClick={runPreview} disabled={previewing}>
              {previewing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
            </SmallBtn>
          </div>
          <div className="bi min-w-0 p-3 sm:p-5">
            {widgetCount === 0 ? (
              <div className="bi-card bi-empty-state">
                <div style={{ fontWeight: 600, fontSize: 14 }}>Nothing to preview yet</div>
                <div className="bi-sub" style={{ marginTop: 4 }}>Switch to Edit and add a question to a section.</div>
              </div>
            ) : (
              <DashboardCanvas layout={previewing && !preview ? null : { sections, filters }} results={preview || {}} period={period} loading={previewing} />
            )}
          </div>
        </section>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <div className="min-w-0 space-y-4">
            <Panel title="Details">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Opens on period">
                  <select className={SEL} value={period} onChange={(e) => setPeriod(e.target.value)}>
                    {meta.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" className="accent-[#800000]" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (shown to assigned people)
                </label>
                <Field label="Description (optional)" className="sm:col-span-2">
                  <input className={INP} value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>
              </div>
            </Panel>

            <Panel
              title={<span className="flex items-center gap-1.5"><LayoutGrid size={14} /> Layout <span className="font-normal text-muted-foreground">· {widgetCount} widget(s)</span></span>}
              action={
                <SmallBtn onClick={() => setSections((ss) => [...ss, { id: uid("s"), title: "", items: [] }])}>
                  <Plus size={13} /> Section
                </SmallBtn>
              }
            >
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <div className="space-y-3">
                  {sections.map((s, i) => (
                    <div key={s.id} className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="mb-2.5 flex flex-wrap items-center gap-2">
                        <input
                          className={`${INP} min-w-0 flex-1 basis-40 font-semibold sm:max-w-xs`}
                          value={s.title}
                          placeholder="Section title (optional)"
                          aria-label="Section title"
                          onChange={(e) => updSection(i, { title: e.target.value })}
                        />
                        <select
                          className={`${SEL} w-auto`}
                          value={s.kind || ""}
                          aria-label="Shown as"
                          title="How this section's widgets show"
                          onChange={(e) => updSection(i, { kind: e.target.value || undefined })}
                        >
                          <option value="">Grid of widgets</option>
                          <option value="hero">Headline cards (KPI)</option>
                          <option value="compact">Compact row (KPI)</option>
                          <option value="attention">Needs attention (numbers)</option>
                        </select>
                        <div className="flex items-center gap-1">
                          <SmallBtn title="Move section up" disabled={i === 0} onClick={() => setSections((ss) => move(ss, i, -1))}><ArrowUp size={13} /></SmallBtn>
                          <SmallBtn title="Move section down" disabled={i === sections.length - 1} onClick={() => setSections((ss) => move(ss, i, 1))}><ArrowDown size={13} /></SmallBtn>
                          <SmallBtn tone="danger" title="Delete section" onClick={() => setSections((ss) => ss.filter((_, j) => j !== i))}><Trash2 size={13} /></SmallBtn>
                        </div>
                        <div className="w-full min-w-0 md:ml-auto md:w-[300px]">
                          <SearchSelect
                            width="100%"
                            placeholder="+ Add a question (type to search)…"
                            value=""
                            options={questions.map((q) => ({ value: q.id, label: q.name }))}
                            onChange={(v) => {
                              const qid = Number(v);
                              if (!qid) return;
                              const q = qById.get(qid);
                              const w = q?.config?.visual?.type === "kpi" ? 1 : 2;
                              updItems(i, (items) => [...items, { id: uid("i"), questionId: qid, width: w }]);
                            }}
                          />
                        </div>
                      </div>
                      <SectionDrop id={`sec:${s.id}`} empty={s.items.length === 0}>
                        {s.items.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                            No widgets yet — add a question, or drag one here.
                          </p>
                        ) : (
                          <SortableContext items={s.items.map((it) => it.id)} strategy={rectSortingStrategy}>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                              {s.items.map((it, k) => {
                                const q = qById.get(it.questionId);
                                return (
                                  <SortableTile key={it.id} id={it.id} width={it.width}>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-xs font-semibold text-foreground" title={q?.name}>{q?.name ?? "(deleted question)"}</div>
                                      {q && <div className="truncate text-[11px] text-muted-foreground">{visLabel(q.config?.visual?.type)}</div>}
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-1">
                                      <div className="inline-flex rounded border border-border bg-muted/40 p-0.5" role="group" aria-label="Width (of 4 columns)">
                                        {[1, 2, 3, 4].map((w) => (
                                          <button
                                            key={w}
                                            type="button"
                                            title={`${w}/4 wide`}
                                            aria-pressed={it.width === w}
                                            onClick={() => updItems(i, (items) => items.map((x, j) => (j === k ? { ...x, width: w } : x)))}
                                            className={`h-6 w-6 rounded text-[11px] font-semibold tabular-nums transition-colors ${
                                              it.width === w ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                                            }`}
                                          >
                                            {w}
                                          </button>
                                        ))}
                                      </div>
                                      <SmallBtn tone="danger" title="Remove" className="h-7 px-2" onClick={() => updItems(i, (items) => items.filter((_, j) => j !== k))}><Trash2 size={12} /></SmallBtn>
                                    </div>
                                  </SortableTile>
                                );
                              })}
                            </div>
                          </SortableContext>
                        )}
                      </SectionDrop>
                    </div>
                  ))}
                  {sections.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">No sections — add one to start placing widgets.</p>
                  )}
                </div>
              </DndContext>
              <p className="text-[11px] text-muted-foreground">Drag a widget by its grip to reorder it or move it to another section. Width is out of 4 columns; phones show one column.</p>
            </Panel>

            {/* Dashboard-wide filters */}
            <Panel
              title={<span className="flex items-center gap-1.5"><Filter size={14} /> Dashboard filters</span>}
              action={
                <select
                  className={`${SEL} h-8 max-w-[200px] text-xs`}
                  value=""
                  disabled={filters.length >= 6}
                  aria-label="Add a filter"
                  onChange={(e) => {
                    const fld = meta.dashboardFilterFields.find((x) => x.key === e.target.value);
                    if (fld && !filters.some((x) => x.field === fld.key)) setFilters((fs) => [...fs, { field: fld.key, label: fld.label }]);
                  }}
                >
                  <option value="">+ Add a filter…</option>
                  {meta.dashboardFilterFields.filter((x) => !filters.some((y) => y.field === x.key)).map((x) => (
                    <option key={x.key} value={x.key}>{x.label}</option>
                  ))}
                </select>
              }
            >
              <p className="text-xs text-muted-foreground">
                Shown at the top of the dashboard. A filter narrows every widget whose data has that field (e.g. Godown narrows
                Sales and Stock, not Receipts).
              </p>
              {filters.map((fl, i) => (
                <div key={fl.field} className="flex flex-wrap items-center gap-2">
                  <span className="w-full text-xs font-medium text-muted-foreground sm:w-40">{meta.dashboardFilterFields.find((x) => x.key === fl.field)?.label ?? fl.field}</span>
                  <input className={`${INP} min-w-0 flex-1`} value={fl.label} placeholder="Label" aria-label="Filter label" onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <SmallBtn tone="danger" title="Remove" className="h-9 w-9 justify-center px-0" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}><Trash2 size={13} /></SmallBtn>
                </div>
              ))}
            </Panel>
          </div>

          <div className="min-w-0 xl:sticky xl:top-[calc(var(--header-height,0px)+72px)]">
            {dashboard?.id ? (
              <AssignPanel meta={meta} dashboard={dashboard} onAssigned={onAssigned} />
            ) : (
              <Panel title={<span className="flex items-center gap-1.5"><Users size={14} /> Assign to</span>}>
                <p className="text-xs text-muted-foreground">Save the dashboard first, then choose who sees it.</p>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignPanel({ meta, dashboard, onAssigned }) {
  const [rows, setRows] = useState(
    (dashboard.assignments ?? []).map((a) => ({
      type: a.department_id ? "department" : a.role ? "role" : "user",
      value: String(a.department_id ?? a.role ?? a.user_id ?? ""),
      is_landing: a.is_landing,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const options = {
    department: meta.departments.map((d) => ({ value: String(d.id), label: d.dept_name })),
    role: meta.roles.map((r) => ({ value: r, label: roleLabel(r) })),
    user: meta.users.map((u) => ({ value: u.id, label: `${u.name || u.email} · ${roleLabel(u.role)}` })),
  };

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const assignments = rows
        .filter((r) => r.value)
        .map((r) => ({
          ...(r.type === "department" ? { department_id: Number(r.value) } : r.type === "role" ? { role: r.value } : { user_id: r.value }),
          is_landing: r.is_landing,
        }));
      const { data } = await axios.put(`/api/bi/dashboards/${dashboard.id}/assignments`, { assignments });
      toast.success(`Assignments saved — ${data.count} assignment(s).`);
      onAssigned?.();
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title={<span className="flex items-center gap-1.5"><Users size={14} /> Assign to</span>}
      action={<SmallBtn onClick={() => setRows((r) => [...r, { type: "department", value: "", is_landing: false }])}><Plus size={13} /> Add</SmallBtn>}
    >
      <p className="text-xs text-muted-foreground">
        Everyone matching a row sees this dashboard. &quot;Opens first&quot; makes it their landing tab. What each person sees inside is
        still limited by their data scope (godowns, customers…).
      </p>
      {rows.length === 0 && <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Not assigned to anyone yet.</p>}
      {rows.map((r, i) => {
        const upd = (patch) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="space-y-1.5 rounded-lg border border-border/70 bg-muted/30 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${SEL} w-[120px]`} value={r.type} aria-label="Assign by" onChange={(e) => upd({ type: e.target.value, value: "" })}>
                <option value="department">Department</option>
                <option value="role">Role</option>
                <option value="user">Person</option>
              </select>
              <div className="min-w-[140px] flex-1">
                <SearchSelect width="100%" placeholder={r.type === "user" ? "Search people…" : "Choose…"} value={r.value}
                  options={options[r.type]} onChange={(v) => upd({ value: v ? String(v) : "" })} />
              </div>
              <SmallBtn tone="danger" title="Remove" className="h-9 w-9 justify-center px-0" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 size={13} /></SmallBtn>
            </div>
            <label className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
              <input type="checkbox" className="accent-[#800000]" checked={r.is_landing} onChange={(e) => upd({ is_landing: e.target.checked })} /> Opens first
            </label>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <SmallBtn tone="primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save assignments
        </SmallBtn>
        {msg && <span className="text-xs text-destructive">{msg}</span>}
      </div>
    </Panel>
  );
}
