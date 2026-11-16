"use client";

// HR → Leaving & settlement (feature hr.leavingProcess): resignations,
// terminations and retirements — approval (Approvals inbox), clearance,
// completion — and the full & final settlement of each. An employee holding
// only hr.leaving.apply sees their own and may resign.
import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserMinus, Plus, Inbox, Loader2, ListChecks, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN, EmptyState, NoAccess, PageHeader, useHrMeta } from "@/components/HR/shared";
import { Card, Chip, MAIN, PAGE, PageSkeleton, UnderlineTab, UnderlineTabsList } from "@/components/HR/payroll/ui";
import LeavingDetail, { SEP_TONE } from "@/components/HR/leaving/LeavingDetail";
import NewLeaving from "@/components/HR/leaving/NewLeaving";
import { useFeatures } from "@/hooks/useFeatures";

function ChecklistTab({ canEdit }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["hr-leaving-checklist"], queryFn: () => api("/api/hr/leaving/settings") });
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = items ?? data?.items ?? [];
  const save = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/leaving/settings", { method: "PUT", body: { items: list } });
      toast.success(r.message);
      setItems(null);
      qc.invalidateQueries({ queryKey: ["hr-leaving-checklist"] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  return (
    <Card title="Clearance checklist" icon={ListChecks} description="Copied onto every new leaving; open ones keep the list they started with." bodyClassName="p-4 space-y-2">
      {list.map((x, i) => (
        <div key={x.key || i} className="flex items-center gap-2">
          <Input value={x.label} disabled={!canEdit} onChange={(e) => setItems(list.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
          {canEdit && <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 hover:text-destructive" onClick={() => setItems(list.filter((_, j) => j !== i))} aria-label="Remove item"><Trash2 className="h-4 w-4" /></Button>}
        </div>
      ))}
      {canEdit && (
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
          <Button variant="outline" size="sm" className="h-9" onClick={() => setItems([...list, { key: "", label: "" }])}><Plus className="h-4 w-4 mr-1.5" />Add item</Button>
          <Button size="sm" className={`${BRAND_BTN} h-9`} onClick={save} disabled={busy || !items}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save checklist</Button>
        </div>
      )}
    </Card>
  );
}

function LeavingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const meta = useHrMeta();
  const features = useFeatures();
  const [status, setStatus] = useState("open");
  const [adding, setAdding] = useState(false);
  const on = features.on("hr.leavingProcess");
  const { data, isLoading } = useQuery({ queryKey: ["hr-leavings", status], queryFn: () => api(`/api/hr/leaving?status=${status}`), enabled: on && Boolean(meta.data) });
  if (meta.isLoading || features.isLoading) return <PageSkeleton />;
  const r = meta.data?.rights ?? {};
  if (!on) return <NoAccess title="Leaving & settlement is switched off." hint="Turn on “Leaving process & final settlement” in Settings → Features to use it." />;
  if (!(r.leavingView || r.leavingApply)) return <NoAccess />;
  const openId = Number(sp.get("separation")) || null;
  const setParam = (k, v) => {
    const p = new URLSearchParams(sp);
    if (v) p.set(k, String(v));
    else p.delete(k);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const tab = sp.get("tab") === "checklist" && r.leavingView ? "checklist" : "list";
  const canAdd = r.leavingManage || (r.leavingApply && meta.data.self);
  return (
    <div className={PAGE}>
      <PageHeader
        icon={UserMinus}
        title="Leaving & settlement"
        subtitle="Resignations and terminations — approval, notice, clearance — and the full & final settlement"
        actions={
          <>
            {r.leavingView && <Button variant="outline" size="sm" className="h-9 bg-background" asChild><Link href="/dashboard/approvals"><Inbox className="h-4 w-4 mr-1.5" />Approvals</Link></Button>}
            {canAdd && <Button size="sm" className={`${BRAND_BTN} h-9`} onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1.5" />{r.leavingManage ? "Record leaving" : "Resign"}</Button>}
          </>
        }
      />
      <main className={MAIN}>
        <Tabs value={tab} onValueChange={(t) => setParam("tab", t === "list" ? null : t)} className="space-y-4">
          {r.leavingView && (
            <UnderlineTabsList aria-label="Leaving sections">
              <UnderlineTab value="list"><UserMinus className="h-4 w-4" />Leavings</UnderlineTab>
              <UnderlineTab value="checklist"><ListChecks className="h-4 w-4" />Clearance checklist</UnderlineTab>
            </UnderlineTabsList>
          )}
          <TabsContent value="list" className="mt-0 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {[["open", "Open"], ["completed", "Completed"], ["all", "All"]].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={`h-9 rounded-lg border px-3 text-sm ${status === k ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border bg-background text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
            <Card bodyClassName="p-0">
              {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
              {data && !data.rows.length && <EmptyState icon={UserMinus} title="Nothing here" hint={status === "open" ? "No leaving is open." : "None yet."} />}
              <ul className="divide-y divide-border/60">
                {(data?.rows ?? []).map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setParam("separation", s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary/[0.03]">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold">
                          <span className="truncate">{s.employee?.name ?? s.employee_id}</span>
                          <span className="text-xs font-normal text-muted-foreground">#{s.employee_id}{s.employee?.department ? ` · ${s.employee.department}` : ""}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{s.kind_label} · last day {s.last_working_day} · notice {s.served}/{s.notice_days} · cleared {s.clearance.filter((c) => c.done).length}/{s.clearance.length}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Chip tone={SEP_TONE[s.status]}>{s.status}</Chip>
                        {s.settlement && <span className="text-xs tabular-nums text-muted-foreground">S-{s.settlement.id} {s.settlement.status.toLowerCase()}{s.settlement.paid ? " · paid" : ""} · {fmtMoney(s.settlement.net)}</span>}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </TabsContent>
          {r.leavingView && <TabsContent value="checklist" className="mt-0"><ChecklistTab canEdit={Boolean(r.leavingManage)} /></TabsContent>}
        </Tabs>
      </main>
      {adding && <NewLeaving open={adding} manage={Boolean(r.leavingManage)} meta={meta.data} onClose={(id) => { setAdding(false); if (id) setParam("separation", id); }} />}
      <LeavingDetail id={openId} onClose={() => setParam("separation", null)} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LeavingPage />
    </Suspense>
  );
}
