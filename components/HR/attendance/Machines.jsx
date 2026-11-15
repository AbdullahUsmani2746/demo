"use client";

// components/HR/attendance/Machines.jsx — ZKTeco machines, unknown machine ids,
// and the raw punch log of a day.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Cpu, Plus, RefreshCw, PlugZap, Pencil, Trash2, Wifi, WifiOff, Clock3, Loader2, Link2, Fingerprint, ListOrdered, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import SearchableSelect from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { api, BRAND_BTN, CHIP, EmptyState, fmtWhen, Panel, TH, TH_ROW } from "@/components/HR/shared";

// Dialogs: near full width on phones, scroll when tall; footer buttons stack with a gap.
const DIALOG = "w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6";
const DIALOG_FOOTER = "gap-2 sm:space-x-0";

const EMPTY = { name: "", ip: "", port: 4370, location: "", auto_sync: true, is_active: true };

export default function Machines({ meta, date }) {
  const qc = useQueryClient();
  const { rights } = meta;
  const [editing, setEditing] = useState(null); // device form
  const [busy, setBusy] = useState(null); // `${id}:sync|test|delete`
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [logDate, setLogDate] = useState(date);

  const devicesQ = useQuery({ queryKey: ["hr-devices"], queryFn: () => api("/api/hr/devices") });
  const unmappedQ = useQuery({ queryKey: ["hr-unmapped"], queryFn: () => api("/api/hr/punches?unmapped=1") });
  const punchesQ = useQuery({ queryKey: ["hr-punches", logDate], queryFn: () => api(`/api/hr/punches?date=${logDate}`) });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["hr-devices"] });
    qc.invalidateQueries({ queryKey: ["hr-unmapped"] });
    qc.invalidateQueries({ queryKey: ["hr-punches"] });
    qc.invalidateQueries({ queryKey: ["hr-att-day"] });
    qc.invalidateQueries({ queryKey: ["hr-att-month"] });
  };

  const run = async (key, fn) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r?.message) toast.success(r.message);
      refreshAll();
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(null);
    }
  };

  const saveDevice = () =>
    run("form", async () => {
      const r = editing.id
        ? await api(`/api/hr/devices/${editing.id}`, { method: "PUT", body: editing })
        : await api("/api/hr/devices", { method: "POST", body: editing });
      setEditing(null);
      return r;
    });

  const devices = devicesQ.data?.devices ?? [];
  const unmapped = unmappedQ.data?.unmapped ?? [];

  return (
    <div className="space-y-5">
      <Panel
        title="Attendance machines"
        icon={Cpu}
        actions={
          rights.devices && (
            <Button size="sm" className={cn(BRAND_BTN, "h-9 w-full sm:w-auto")} onClick={() => setEditing({ ...EMPTY })}>
              <Plus className="mr-1.5 h-4 w-4" />Add machine
            </Button>
          )
        }
        bodyClassName="p-3 sm:p-4"
      >
        {devicesQ.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
        ) : !devices.length ? (
          <EmptyState
            icon={Fingerprint}
            title="No machines yet"
            hint="Add each ZKTeco machine by its IP address. The server must be able to reach it on the network (port 4370). Machines set to sync automatically are read every 15 minutes."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((d) => {
              const ok = d.last_sync_ok;
              return (
                <div key={d.id} className={cn("flex flex-col gap-3 rounded-xl border p-4 transition-colors", d.is_active ? "border-border bg-background hover:border-primary/30" : "border-dashed border-border bg-muted/40")}>
                  <div className="flex items-start gap-3">
                    <div className={cn("shrink-0 rounded-lg p-2", ok === false ? CHIP.bad : ok ? CHIP.ok : CHIP.muted)}>
                      {ok === false ? <WifiOff className="h-5 w-5" /> : <Wifi className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-foreground">{d.name}</p>
                      <p className="font-mono text-xs text-primary">{d.ip}:{d.port}</p>
                      {d.location && <p className="truncate text-xs text-muted-foreground">{d.location}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {!d.is_active && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", CHIP.muted)}>OFF</span>}
                      {d.is_active && d.auto_sync && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", CHIP.brand)}>AUTO 15 MIN</span>}
                    </div>
                  </div>
                  <div className="space-y-1 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                    <p className="flex flex-wrap items-center gap-1.5 text-foreground/70"><Clock3 className="h-3.5 w-3.5" />Last sync: <b className="text-foreground">{fmtWhen(d.last_sync_at)}</b>{d.last_sync_at && ok && ` · ${d.last_sync_count} new`}</p>
                    <p className="text-foreground/70"><span className="tabular-nums">{d.punches.toLocaleString()}</span> punch(es) stored</p>
                    {ok === false && d.last_sync_error && <p className="break-words text-red-700 dark:text-red-400">{d.last_sync_error}</p>}
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    {(rights.import || rights.devices) && (
                      <Button size="sm" className={cn(BRAND_BTN, "h-9 flex-1 sm:h-8 sm:flex-none")} disabled={Boolean(busy) || !d.is_active} onClick={() => run(`${d.id}:sync`, () => api(`/api/hr/devices/${d.id}/sync`, { method: "POST", body: {} }))}>
                        {busy === `${d.id}:sync` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Sync now
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-9 flex-1 bg-background sm:h-8 sm:flex-none" disabled={Boolean(busy)} onClick={() => run(`${d.id}:test`, () => api(`/api/hr/devices/${d.id}/sync`, { method: "POST", body: { test: true } }))}>
                      {busy === `${d.id}:test` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1.5 h-4 w-4" />}Test
                    </Button>
                    {rights.devices && (
                      <>
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-primary/70 hover:bg-primary/10 hover:text-primary sm:h-8 sm:w-8" onClick={() => setEditing({ ...d })} title="Edit" aria-label={`Edit ${d.name}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-8 sm:w-8" onClick={() => setConfirmDelete(d)} title="Remove" aria-label={`Remove ${d.name}`}><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-5">
        <UnmappedPanel className="xl:col-span-2" unmapped={unmapped} loading={unmappedQ.isLoading} canMap={rights.devices} onMapped={refreshAll} />
        <Panel
          className="xl:col-span-3"
          title="Punch log"
          icon={ListOrdered}
          actions={
            <div className="relative w-full sm:w-auto">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="date" value={logDate} onChange={(e) => e.target.value && setLogDate(e.target.value)} className="h-9 w-full pl-8 sm:w-[160px]" aria-label="Punch log day" />
            </div>
          }
        >
          <div className="max-h-[420px] overflow-auto">
            {punchesQ.isLoading && (
              <div className="space-y-2 p-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            )}
            {/* Phone: compact list */}
            <ul className="divide-y divide-border/60 md:hidden">
              {(punchesQ.data?.punches ?? []).map((p) => (
                <li key={p.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <span className="w-[4.5rem] shrink-0 font-mono font-semibold tabular-nums text-foreground">{p.time}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{p.employee ? `${p.employee} (#${p.employee_id})` : <span className="font-medium text-[#5f4b1f] dark:text-amber-300">Not mapped</span>}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{p.device_user_id}</span> · {p.source === "IMPORT" ? "File import" : p.device ?? "Machine"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <table className="hidden w-full text-sm md:table">
              <thead className="sticky top-0 z-10">
                <tr className={TH_ROW}>
                  <th className={cn(TH, "px-4")}>Time</th>
                  <th className={cn(TH, "px-4")}>Employee</th>
                  <th className={cn(TH, "px-4")}>Machine id</th>
                  <th className={cn(TH, "px-4")}>From</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {(punchesQ.data?.punches ?? []).map((p) => (
                  <tr key={p.id} className="hover:bg-primary/[0.03]">
                    <td className="px-4 py-1.5 font-mono font-semibold tabular-nums">{p.time}</td>
                    <td className="px-4 py-1.5">{p.employee ? `${p.employee} (#${p.employee_id})` : <span className="font-medium text-[#5f4b1f] dark:text-amber-300">Not mapped</span>}</td>
                    <td className="px-4 py-1.5"><span className="rounded bg-primary/10 px-1.5 font-mono text-xs font-bold text-primary">{p.device_user_id}</span></td>
                    <td className="px-4 py-1.5 text-muted-foreground">{p.source === "IMPORT" ? "File import" : p.device ?? "Machine"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!punchesQ.isLoading && !punchesQ.data?.punches?.length && <EmptyState icon={ListOrdered} title="No punches on this day" />}
          </div>
        </Panel>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-lg")}>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit machine" : "Add attendance machine"}</DialogTitle>
            <DialogDescription>ZKTeco machines on the network. The server connects to the IP on the port below (default 4370).</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="dev-name">Name</Label>
                <Input id="dev-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Factory gate" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-ip">IP address</Label>
                <Input id="dev-ip" inputMode="decimal" value={editing.ip} onChange={(e) => setEditing({ ...editing, ip: e.target.value.trim() })} placeholder="192.168.1.201" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-port">Port</Label>
                <Input id="dev-port" type="number" value={editing.port} onChange={(e) => setEditing({ ...editing, port: Number(e.target.value) })} className="font-mono" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="dev-location">Location</Label>
                <Input id="dev-location" value={editing.location ?? ""} onChange={(e) => setEditing({ ...editing, location: e.target.value })} placeholder="Optional" />
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm">Sync every 15 minutes</span>
                <Switch checked={editing.auto_sync} onCheckedChange={(v) => setEditing({ ...editing, auto_sync: v })} />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm">In use</span>
                <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              </label>
            </div>
          )}
          <DialogFooter className={DIALOG_FOOTER}>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className={BRAND_BTN} onClick={saveDevice} disabled={busy === "form"}>
              {busy === "form" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmDelete)} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{confirmDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The machine is no longer read. The {confirmDelete?.punches ?? 0} punch(es) already stored are kept — attendance stays as it is.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={DIALOG_FOOTER}>
            <AlertDialogCancel disabled={Boolean(busy)}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(busy)}
              onClick={(e) => {
                e.preventDefault();
                run(`${confirmDelete.id}:delete`, async () => { const r = await api(`/api/hr/devices/${confirmDelete.id}`, { method: "DELETE" }); setConfirmDelete(null); return r; });
              }}
            >
              {busy === `${confirmDelete?.id}:delete` && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Machine ids not linked to an employee → pick the employee. */
function UnmappedPanel({ unmapped, loading, canMap, onMapped, className }) {
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState(null);
  const empQ = useQuery({
    queryKey: ["hr-employee-options"],
    queryFn: () => api("/api/hr/shifts/assignments"),
    enabled: canMap && unmapped.length > 0,
    staleTime: 60_000,
  });
  const options = useMemo(
    () => (empQ.data?.employees ?? []).map(({ employee: e }) => ({ value: e.id, label: `${e.name} (#${e.id})${e.attendanceId ? ` · machine ${e.attendanceId}` : ""}` })),
    [empQ.data],
  );

  const map = async (code) => {
    const employee_id = choice[code];
    if (!employee_id) return toast.error("Pick the employee first.");
    setBusy(code);
    try {
      const r = await api("/api/hr/punches", { method: "POST", body: { device_user_id: code, employee_id } });
      toast.success(r.message);
      onMapped();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel className={className} title="Machine ids without an employee" icon={Link2}>
      <div className="space-y-3 p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">
          A punch is matched by the employee&apos;s machine id (Employee → attendance id), or by the employee number when that is blank. Ids below matched nobody — link each to its employee and those days are built.
        </p>
        {loading ? (
          <Skeleton className="h-24" />
        ) : !unmapped.length ? (
          <p className={cn("rounded-lg px-3 py-2 text-sm font-medium", CHIP.ok)}>Every punch is matched to an employee.</p>
        ) : (
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {unmapped.map((u) => (
              <div key={u.device_user_id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:py-2.5">
                <div className="shrink-0 sm:w-36">
                  <p><span className="rounded bg-primary/10 px-1.5 font-mono font-bold text-primary">{u.device_user_id}</span></p>
                  <p className="text-[11px] text-muted-foreground">{u.punches} punch(es) · last {fmtWhen(u.last)}</p>
                </div>
                {canMap ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <SearchableSelect
                        options={options}
                        value={choice[u.device_user_id] ?? null}
                        onChange={(v) => setChoice((c) => ({ ...c, [u.device_user_id]: v }))}
                        placeholder="Pick employee…"
                        isLoading={empQ.isLoading}
                      />
                    </div>
                    <Button size="sm" variant="outline" className="h-9 w-full bg-background sm:w-auto" onClick={() => map(u.device_user_id)} disabled={busy === u.device_user_id}>
                      {busy === u.device_user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link"}
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Ask someone with “manage machines” to link it.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
