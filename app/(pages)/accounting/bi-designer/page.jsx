"use client";
import { roleLabel } from "@/lib/auth/roleNames";
// /accounting/bi-designer — the BI Designer (needs bi.design; ADMIN has it).
//   Questions   — build any KPI / table / chart from a dataset, no code
//   Dashboards  — lay questions out, preview, assign to dept / role / person
//   Data Access — which datasets each department may use
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { ChartPie, LayoutDashboard, ShieldCheck, Flag, Plus, Pencil, Trash2, Copy, ExternalLink, AlertCircle, Search, PencilRuler } from "lucide-react";
import QuestionBuilder from "@/components/bi/designer/QuestionBuilder";
import DashboardEditor from "@/components/bi/designer/DashboardEditor";
import DataAccess from "@/components/bi/designer/DataAccess";
import Events from "@/components/bi/designer/Events";
import { SmallBtn } from "@/components/bi/designer/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TABS = [
  { key: "questions", label: "Questions", Icon: ChartPie },
  { key: "dashboards", label: "Dashboards", Icon: LayoutDashboard },
  { key: "access", label: "Data Access", Icon: ShieldCheck },
  { key: "events", label: "Events", Icon: Flag },
];

const errText = (e) => e.response?.data?.error || e.message;

export default function BiDesignerPage() {
  const [tab, setTab] = useState("questions");
  const [meta, setMeta] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [editingQ, setEditingQ] = useState(null); // null | {} (new) | question
  const [editingD, setEditingD] = useState(null);
  const [error, setError] = useState(null);
  const [find, setFind] = useState("");
  const [deleting, setDeleting] = useState(null); // { kind: "question" | "dashboard", item }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, q, d] = await Promise.all([
        axios.get("/api/bi/meta"),
        axios.get("/api/bi/questions"),
        axios.get("/api/bi/dashboards"),
      ]);
      setMeta(m.data);
      setQuestions(q.data.data);
      setDashboards(d.data.data);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function removeQuestion(q) {
    try {
      await axios.delete(`/api/bi/questions/${q.id}`);
      toast.success(`Question "${q.name}" deleted`);
      load();
    } catch (e) {
      toast.error(`Could not delete: ${errText(e)}`);
    }
  }
  async function removeDashboard(d) {
    try {
      await axios.delete(`/api/bi/dashboards/${d.id}`);
      toast.success(`Dashboard "${d.name}" deleted`);
      load();
    } catch (e) {
      toast.error(`Could not delete: ${errText(e)}`);
    }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      if (deleting.kind === "question") await removeQuestion(deleting.item);
      else await removeDashboard(deleting.item);
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const dsLabel = (key) => meta?.datasets.find((d) => d.key === key)?.label ?? key;
  const visLabel = (key) => meta?.visuals.find((v) => v.key === key)?.label ?? key;
  const assignedText = (d) => {
    const a = d.assignments ?? [];
    if (!a.length) return "Not assigned";
    return a
      .map((x) =>
        x.department_id
          ? meta?.departments.find((p) => p.id === x.department_id)?.dept_name ?? `Dept ${x.department_id}`
          : x.role
            ? roleLabel(x.role)
            : meta?.users.find((u) => u.id === x.user_id)?.name ?? "Person",
      )
      .join(", ");
  };
  const term = find.trim().toLowerCase();
  const shownQuestions = questions.filter((q) => !term || q.name.toLowerCase().includes(term));
  const shownDashboards = dashboards.filter((d) => !term || d.name.toLowerCase().includes(term));
  const counts = { questions: questions.length, dashboards: dashboards.length };

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto w-full min-w-0 max-w-[1600px] px-3 py-5 sm:px-6">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <PencilRuler className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">Accounting · BI</p>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">BI Designer</h1>
              <p className="text-sm text-muted-foreground">
                Build figures, tables and charts from the ERP&apos;s data, place them on dashboards and assign them — no code.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="h-10 gap-2 bg-background max-sm:w-full">
            <Link href="/dashboard/insights">
              <ExternalLink className="h-4 w-4" /> Open My Dashboards
            </Link>
          </Button>
        </div>

        {error && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span className="flex items-start gap-2 font-medium text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </span>
            <Button variant="outline" size="sm" onClick={load}>Try again</Button>
          </div>
        )}

        {/* Tabs */}
        <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTab(key); setEditingQ(null); setEditingD(null); }}
              aria-current={tab === key ? "page" : undefined}
              className={`-mb-px inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={15} /> {label}
              {meta && counts[key] !== undefined && (
                <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${tab === key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {!meta ? (
          !error && (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-10 w-full max-w-md" />
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="h-10 bg-primary" />
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex gap-4 border-b border-border/60 px-3 py-3">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </div>
          )
        ) : tab === "questions" && editingQ ? (
          <QuestionBuilder
            key={editingQ.id ?? "new"}
            meta={meta}
            question={editingQ.id || editingQ.config ? editingQ : null}
            onSaved={() => { toast.success("Question saved"); setEditingQ(null); load(); }}
            onCancel={() => setEditingQ(null)}
          />
        ) : tab === "dashboards" && editingD ? (
          <DashboardEditor
            key={editingD.id ?? "new"}
            meta={meta}
            questions={questions}
            dashboard={editingD.id ? editingD : null}
            onSaved={(saved) => { toast.success("Dashboard saved"); load(); setEditingD({ ...saved, assignments: dashboards.find((d) => d.id === saved.id)?.assignments ?? [] }); }}
            onAssigned={load}
            onCancel={() => setEditingD(null)}
          />
        ) : tab === "access" ? (
          <DataAccess />
        ) : tab === "events" ? (
          <Events />
        ) : (
          <div className="space-y-3">
            {/* List toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                  placeholder={tab === "questions" ? "Find a question…" : "Find a dashboard…"}
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  aria-label="Find"
                />
              </div>
              <Button className="h-10 gap-2 max-sm:flex-1" onClick={() => (tab === "questions" ? setEditingQ({}) : setEditingD({}))}>
                <Plus className="h-4 w-4" /> {tab === "questions" ? "New question" : "New dashboard"}
              </Button>
            </div>

            {tab === "questions" ? (
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="overflow-x-auto">
                  <table className="vl-grid w-full text-sm">
                    <thead>
                      <tr className="bg-primary text-left">
                        {["Name", "Dataset", "Shown as", "Updated"].map((h) => (
                          <th key={h} className="whitespace-nowrap px-3 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">{h}</th>
                        ))}
                        <th className="px-3 py-2.5 text-right text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownQuestions.map((q) => (
                        <tr key={q.id} className="border-b border-border/60 last:border-0 hover:bg-primary/[0.03]">
                          <td data-label="Name" className="px-3 py-2.5 font-medium max-md:col-span-2">
                            <button type="button" className="text-left text-foreground hover:text-primary" onClick={() => setEditingQ(q)}>{q.name}</button>
                            {q.description && <div className="text-xs font-normal text-muted-foreground">{q.description}</div>}
                          </td>
                          <td data-label="Dataset" className="px-3 py-2.5">{dsLabel(q.dataset)}</td>
                          <td data-label="Shown as" className="px-3 py-2.5">
                            <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{visLabel(q.config?.visual?.type)}</span>
                          </td>
                          <td data-label="Updated" className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{new Date(q.updated_at).toLocaleString()}</td>
                          <td className="vl-actions px-3 py-2">
                            <div className="flex justify-end gap-1 max-md:justify-start">
                              <SmallBtn title="Edit" onClick={() => setEditingQ(q)}><Pencil size={13} /></SmallBtn>
                              <SmallBtn title="Duplicate" onClick={() => setEditingQ({ ...q, id: undefined, name: `${q.name} (copy)` })}><Copy size={13} /></SmallBtn>
                              <SmallBtn tone="danger" title="Delete" onClick={() => setDeleting({ kind: "question", item: q })}><Trash2 size={13} /></SmallBtn>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {shownQuestions.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-14 text-center">
                            <p className="font-semibold text-foreground">{questions.length ? "Nothing matches your search" : "No questions yet"}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {questions.length ? "Try another word." : "Click “New question” to build your first figure."}
                            </p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {shownDashboards.map((d) => {
                  const widgets = (d.layout?.sections ?? []).reduce((n, s) => n + (s.items?.length ?? 0), 0);
                  return (
                    <div key={d.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
                      <div className="flex items-start justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2.5">
                        <button type="button" className="min-w-0 text-left" onClick={() => setEditingD(d)}>
                          <div className="truncate font-semibold text-primary">{d.name}</div>
                          <div className="text-xs text-muted-foreground">
                            <span className="tabular-nums">{widgets}</span> widget(s) ·{" "}
                            <span className={d.is_active ? "text-[#2f5139] dark:text-green-400" : ""}>{d.is_active ? "Active" : "Inactive"}</span>
                          </div>
                        </button>
                        <div className="flex gap-1">
                          <SmallBtn title="Edit / assign" onClick={() => setEditingD(d)}><Pencil size={13} /></SmallBtn>
                          <SmallBtn title="Open" onClick={() => window.open(`/dashboard/insights?id=${d.id}`, "_blank")}><ExternalLink size={13} /></SmallBtn>
                          <SmallBtn tone="danger" title="Delete" onClick={() => setDeleting({ kind: "dashboard", item: d })}><Trash2 size={13} /></SmallBtn>
                        </div>
                      </div>
                      <div className="flex-1 space-y-2 px-4 py-3">
                        {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
                        <p className="text-xs"><span className="text-muted-foreground">Assigned to:</span> {assignedText(d)}</p>
                      </div>
                    </div>
                  );
                })}
                {shownDashboards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border bg-background px-6 py-12 text-center md:col-span-2 xl:col-span-3">
                    <p className="font-semibold text-foreground">{dashboards.length ? "Nothing matches your search" : "No dashboards yet"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {dashboards.length ? "Try another word." : "Build some questions first, then create a dashboard."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.kind} “{deleting?.item?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.kind === "dashboard"
                ? "It is removed for good. People assigned to it will no longer see it."
                : "It is removed for good. Dashboards that show it will say it no longer exists."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
