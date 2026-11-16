"use client";

// Admin → POS shifts (/admin/shift): cashier shifts used by the Point of Sale;
// a login's shift is set on Logins & Roles. Rights: users.manage (the API checks).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRoles } from "@/hooks/useRoles";
import { api, CHIP, EmptyState, HR_MAIN, HR_PAGE, ListSkeleton, PageHeader, Panel, TH, TH_ROW } from "@/components/HR/shared";
import { RoleChips } from "@/components/Admin/loginParts";
import { cn } from "@/lib/utils";

function hhmm(t) {
  if (!t) return "";
  const [h, m] = String(t).split(":");
  const n = parseInt(h, 10);
  if (Number.isNaN(n)) return t;
  return `${n % 12 || 12}:${String(parseInt(m, 10) || 0).padStart(2, "0")} ${n >= 12 ? "PM" : "AM"}`;
}

export default function ShiftPage() {
  const qc = useQueryClient();
  const { roleName } = useRoles();
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ["shifts-all"], queryFn: () => api("/api/shifts?limit=1000"), retry: false });
  const shifts = useMemo(() => data?.shifts || [], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? shifts.filter((s) => s.name.toLowerCase().includes(q)) : shifts;
  }, [shifts, search]);

  const [editing, setEditing] = useState(null); // null | "new" | shift
  const [form, setForm] = useState({ name: "", startTime: "08:00", endTime: "17:00" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [peopleOf, setPeopleOf] = useState(null);

  const openNew = () => {
    setForm({ name: "", startTime: "08:00", endTime: "17:00" });
    setEditing("new");
  };

  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refresh = () => qc.invalidateQueries({ queryKey: ["shifts-all"] });

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Give the shift a name");
    if (!form.startTime || !form.endTime) return toast.error("Start and end times are required");
    if (form.startTime >= form.endTime) return toast.error("End time must be after start time");
    setSaving(true);
    try {
      const body = { name: form.name.trim(), startTime: form.startTime, endTime: form.endTime };
      if (editing === "new") await api("/api/shifts", { method: "POST", body });
      else await api(`/api/shifts/${editing.id}`, { method: "PUT", body });
      toast.success(editing === "new" ? `Shift ${body.name} added` : `Shift ${body.name} saved`);
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error(err.message, { duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api(`/api/shifts/${deleting.id}`, { method: "DELETE" });
      toast.success(`Shift ${deleting.name} deleted`);
      setDeleting(null);
      refresh();
    } catch (err) {
      toast.error(err.message, { duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  if (error?.status === 401 || error?.status === 403) {
    return (
      <div className={HR_PAGE}>
        <PageHeader icon={Clock} title="POS shifts" />
        <main className={HR_MAIN}>
          <div className="mt-4 rounded-xl border border-[#e6dcc6] bg-[#f5f0e6] px-5 py-4 text-[#5f4b1f] dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-semibold">You do not manage shifts.</p>
            <p className="mt-1 text-sm opacity-90">Shifts are managed by holders of users.manage.</p>
          </div>
        </main>
      </div>
    );
  }

  const Actions = ({ s }) => (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${s.name}`} title="Edit" onClick={() => { setForm({ name: s.name, startTime: s.startTime, endTime: s.endTime }); setEditing(s); }}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700 hover:text-red-800" aria-label={`Delete ${s.name}`} title="Delete" onClick={() => setDeleting(s)}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
  const People = ({ s }) => (
    <button
      type="button"
      onClick={() => setPeopleOf(s)}
      disabled={!s.users?.length}
      className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", s.users?.length ? CHIP.brand + " hover:bg-primary/20" : CHIP.muted)}
    >
      {s.users?.length || 0} login{s.users?.length === 1 ? "" : "s"}
    </button>
  );

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={Clock}
        title="POS shifts"
        subtitle="Cashier shifts for the Point of Sale. A login's shift is set on Logins & Roles."
        badge={data ? shifts.length : null}
        actions={
          <Button onClick={openNew} title="Alt+N">
            <Plus className="mr-1.5 h-4 w-4" /> New shift
          </Button>
        }
      />
      <main className={HR_MAIN}>
        <Panel
          title="Shifts"
          icon={Clock}
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          }
        >
          <div className="flex items-center gap-2 border-b border-border p-3 sm:px-5">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shifts…  ( / )" className="h-9 pl-8" aria-label="Search shifts" />
            </div>
          </div>
          {isLoading ? (
            <div className="p-4">
              <ListSkeleton rows={4} />
            </div>
          ) : error ? (
            <EmptyState icon={Clock} title="Could not load shifts" hint={error.message} action={<Button onClick={() => refetch()}>Try again</Button>} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={Clock} title={shifts.length ? "No shift matches" : "No shifts yet"} hint={shifts.length ? "Change the search." : "Add the cashier shifts your POS works in."} action={!shifts.length ? <Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />New shift</Button> : null} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      <th className={TH}>Shift</th>
                      <th className={TH}>Starts</th>
                      <th className={TH}>Ends</th>
                      <th className={TH}>Logins</th>
                      <th className={cn(TH, "text-right")}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((s) => (
                      <tr key={s.id} className="hover:bg-primary/[0.03]">
                        <td className="px-3 py-2.5 font-semibold">{s.name}</td>
                        <td className="px-3 py-2.5 tabular-nums">{hhmm(s.startTime)}</td>
                        <td className="px-3 py-2.5 tabular-nums">{hhmm(s.endTime)}</td>
                        <td className="px-3 py-2.5"><People s={s} /></td>
                        <td className="px-2 py-1.5"><Actions s={s} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border md:hidden">
                {filtered.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.name}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">{hhmm(s.startTime)} – {hhmm(s.endTime)}</p>
                      <div className="mt-1"><People s={s} /></div>
                    </div>
                    <Actions s={s} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        <p className="mt-3 px-1 text-xs text-muted-foreground">
          Give a login its shift on{" "}
          <Link href="/admin/user" className="font-semibold text-primary hover:underline">Logins & Roles</Link>.
        </p>
      </main>

      <Dialog open={!!editing} onOpenChange={(v) => !v && !saving && setEditing(null)}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
          <form onSubmit={save} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing === "new" ? "New shift" : `Edit ${editing?.name || ""}`}</DialogTitle>
              <DialogDescription>Start and end on the same day.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label htmlFor="sh-name" className="mb-1.5 block text-sm font-medium">Name <span className="text-red-600">*</span></label>
                <Input id="sh-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Morning" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sh-start" className="mb-1.5 block text-sm font-medium">Starts</label>
                  <Input id="sh-start" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="sh-end" className="mb-1.5 block text-sm font-medium">Ends</label>
                  <Input id="sh-end" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {editing === "new" ? "Add shift" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!peopleOf} onOpenChange={(v) => !v && setPeopleOf(null)}>
        <DialogContent className="max-h-[85vh] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> {peopleOf?.name}</DialogTitle>
            <DialogDescription>Logins on this shift.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border rounded-lg border">
            {(peopleOf?.users || []).map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate font-medium">{u.name || u.id}</span>
                <span className="flex items-center gap-2">
                  <RoleChips roles={[u.role]} roleName={roleName} />
                  {!u.isActive && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", CHIP.bad)}>Off</span>}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && !saving && setDeleting(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shift {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.users?.length ? `${deleting.users.length} login(s) are on this shift and will have no shift.` : "No login is on this shift."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); remove(); }} disabled={saving} className="bg-red-700 hover:bg-red-800">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
