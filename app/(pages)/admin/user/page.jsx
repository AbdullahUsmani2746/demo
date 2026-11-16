"use client";

// Admin → Logins & Roles (/admin/user). Every login: name, username, the
// employee it belongs to (or "No employee"), roles, active. Employees' logins
// are normally given on the Employee screen (Login & Roles); this page makes
// the few without one (Super Admin, auditors) and edits any login's roles,
// password and on/off. Rights: users.manage (the API checks it); role rules —
// catalogue only, Super Admin only by a Super Admin, the last Super Admin
// keeps it — are lib/auth/roleAssign.js's.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpRight, KeyRound, Loader2, Pencil, Power, RefreshCw, Search, ShieldCheck, UserCheck, UserCog, UserPlus, UserX, Users, Wand2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRoles } from "@/hooks/useRoles";
import { api, CHIP, EmptyState, HR_MAIN, HR_PAGE, ListSkeleton, NativeSelect, PageHeader, Panel, StatTile, TH, TH_ROW } from "@/components/HR/shared";
import { cn } from "@/lib/utils";
import { generatePassword, offerableRoles, PasswordOnceDialog, RoleChips, RolePicker } from "@/components/Admin/loginParts";

const EMPTY = { name: "", username: "", email: "", password: "", role: "", roles: [], isActive: true, shiftId: "" };

function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}
function hhmm(t) {
  if (!t) return "";
  const [h, m] = String(t).split(":");
  const n = parseInt(h, 10);
  if (Number.isNaN(n)) return t;
  return `${n % 12 || 12}:${String(parseInt(m, 10) || 0).padStart(2, "0")} ${n >= 12 ? "PM" : "AM"}`;
}
const employeeName = (u) => (u.employee ? [u.employee.firstName, u.employee.surname].filter(Boolean).join(" ") : null);

export default function LoginsAndRolesPage() {
  // useSearchParams needs a Suspense boundary (Next 15).
  return (
    <Suspense fallback={null}>
      <LoginsAndRoles />
    </Suspense>
  );
}

function LoginsAndRoles() {
  const params = useSearchParams();
  const { data: session } = useSession();
  const superAdmin = !!session?.user?.superAdmin;
  const myId = session?.user?.id;
  const qc = useQueryClient();
  const { activeRoles: catalogue, roles: allRoles, roleName } = useRoles();

  const [search, setSearch] = useState(params.get("search") || "");
  const [role, setRole] = useState("all");
  const [link, setLink] = useState("all");
  const [status, setStatus] = useState("all");
  const searchRef = useRef(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-logins"],
    queryFn: () => api("/api/users"),
    retry: false,
  });
  const { data: shiftData } = useQuery({ queryKey: ["shifts-all"], queryFn: () => api("/api/shifts?limit=1000"), staleTime: 60_000, retry: false });
  const shifts = shiftData?.shifts || [];
  const users = useMemo(() => data?.users || [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (role !== "all" && !(u.roles || [u.role]).includes(role)) return false;
      if (link === "employee" && !u.employeeId) return false;
      if (link === "none" && u.employeeId) return false;
      if (status === "active" && !u.isActive) return false;
      if (status === "off" && u.isActive) return false;
      if (!q) return true;
      return [u.name, u.username, u.email, employeeName(u), ...(u.roles || []).map(roleName)].some((s) => s && String(s).toLowerCase().includes(q));
    });
  }, [users, search, role, link, status, roleName]);

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.isActive).length,
      off: users.filter((u) => !u.isActive).length,
      noEmp: users.filter((u) => !u.employeeId).length,
    }),
    [users],
  );

  // dialogs
  const [editing, setEditing] = useState(null); // null | "new" | user
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [resetPw, setResetPw] = useState("");
  const [togglingFor, setTogglingFor] = useState(null);
  const [shown, setShown] = useState(null); // { password, who }

  const openNew = () => {
    setForm({ ...EMPTY, role: "" });
    setEditing("new");
  };
  const openEdit = (u) => {
    const roles = u.roles || [u.role];
    setForm({ name: u.name || "", username: u.username || "", email: u.email, password: "", role: u.role, roles: roles.filter((c) => c !== u.role), isActive: u.isActive, shiftId: u.shift?.id ?? u.shiftId ?? "" });
    setEditing(u);
  };

  // Keyboard: "/" search, Alt+N new login.
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

  const options = useMemo(
    () => offerableRoles(catalogue, { manageAll: true, superAdmin, keep: editing && editing !== "new" ? editing.roles || [] : [] }),
    [catalogue, superAdmin, editing],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-logins"] });

  const save = async (e) => {
    e?.preventDefault();
    const isNew = editing === "new";
    if (!form.name.trim() || !form.email.trim() || !form.role) return toast.error("Name, email and main role are required");
    if (isNew && form.password.length < 6) return toast.error("Password: at least 6 characters");
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        username: form.username.trim() || null,
        email: form.email.trim(),
        role: form.role,
        roles: form.roles,
        isActive: form.isActive,
        shiftId: form.shiftId || null,
        ...(isNew ? { password: form.password } : {}),
      };
      if (isNew) await api("/api/users", { method: "POST", body });
      else await api(`/api/users/${editing.id}`, { method: "PUT", body });
      toast.success(isNew ? `Login for ${body.name} created` : `Saved ${body.name}`);
      if (isNew) setShown({ password: form.password, who: body.name });
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error(err.message, { duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  const doReset = async (generated) => {
    const pw = generated ? generatePassword() : resetPw;
    if (pw.length < 6) return toast.error("Password: at least 6 characters");
    setSaving(true);
    try {
      await api(`/api/users/${resetFor.id}`, { method: "PUT", body: { password: pw } });
      toast.success("Password changed");
      setShown({ password: pw, who: resetFor.name || resetFor.username });
      setResetFor(null);
      setResetPw("");
    } catch (err) {
      toast.error(err.message, { duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  const doToggle = async () => {
    const u = togglingFor;
    setSaving(true);
    try {
      await api(`/api/users/${u.id}`, { method: "PUT", body: { isActive: !u.isActive } });
      toast.success(u.isActive ? `${u.name || u.email} switched off — they can no longer sign in` : `${u.name || u.email} can sign in again`);
      setTogglingFor(null);
      refresh();
    } catch (err) {
      toast.error(err.message, { duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  const filtersOn = search || role !== "all" || link !== "all" || status !== "all";
  const clear = () => {
    setSearch("");
    setRole("all");
    setLink("all");
    setStatus("all");
  };

  if (error?.status === 401 || error?.status === 403) {
    return (
      <div className={HR_PAGE}>
        <PageHeader icon={UserCog} title="Logins & Roles" />
        <main className={HR_MAIN}>
          <div className="mt-4 rounded-xl border border-[#e6dcc6] bg-[#f5f0e6] px-5 py-4 text-[#5f4b1f] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-semibold">You do not manage logins.</p>
            <p className="mt-1 text-sm opacity-90">Logins and roles are managed by holders of users.manage (Admin → Permissions).</p>
          </div>
        </main>
      </div>
    );
  }

  const RowActions = ({ u }) => (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit login & roles" aria-label={`Edit ${u.name || u.email}`} onClick={() => openEdit(u)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" title="Reset password" aria-label={`Reset password of ${u.name || u.email}`} onClick={() => { setResetPw(""); setResetFor(u); }}>
        <KeyRound className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8", u.isActive ? "text-red-700 hover:text-red-800" : "text-[#2f5139]")}
        title={u.id === myId ? "You cannot switch off your own login" : u.isActive ? "Switch off" : "Switch on"}
        aria-label={`${u.isActive ? "Switch off" : "Switch on"} ${u.name || u.email}`}
        disabled={u.id === myId}
        onClick={() => setTogglingFor(u)}
      >
        <Power className="h-4 w-4" />
      </Button>
    </div>
  );

  const EmployeeCellLink = ({ u }) =>
    u.employeeId ? (
      <Link href={`/accounting/setup/employees?search=${encodeURIComponent(employeeName(u) || u.employeeId)}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
        {employeeName(u) || `#${u.employeeId}`} <span className="text-xs text-muted-foreground">#{u.employeeId}</span>
      </Link>
    ) : (
      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", CHIP.warn)}>No employee</span>
    );

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={UserCog}
        title="Logins & Roles"
        subtitle="Every login, its roles and the employee it belongs to. Employees get their login on the Employee screen (Login & Roles)."
        badge={data ? users.length : null}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/accounting/setup/employees">
                <Users className="mr-1.5 h-4 w-4" /> Employees
              </Link>
            </Button>
            <Button onClick={openNew} title="Alt+N">
              <UserPlus className="mr-1.5 h-4 w-4" /> New login
            </Button>
          </>
        }
      />
      <main className={cn(HR_MAIN, "space-y-4")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Logins" value={data ? stats.total : "—"} icon={Users} tone="brand" />
          <StatTile label="Active" value={data ? stats.active : "—"} icon={UserCheck} tone="emerald" />
          <StatTile label="Switched off" value={data ? stats.off : "—"} icon={UserX} tone={stats.off ? "red" : "slate"} />
          <StatTile label="Without employee" value={data ? stats.noEmp : "—"} icon={ShieldCheck} tone="amber" hint="Super Admin, auditors …" />
        </div>

        <Panel
          title="Logins"
          icon={KeyRound}
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:px-5">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search logins…  ( / )" className="h-9 pl-8" aria-label="Search logins" />
            </div>
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" className="flex-1 sm:flex-none">
              <option value="all">All roles</option>
              {allRoles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={link} onChange={(e) => setLink(e.target.value)} aria-label="Employee link" className="flex-1 sm:flex-none">
              <option value="all">With or without employee</option>
              <option value="employee">Linked to an employee</option>
              <option value="none">No employee</option>
            </NativeSelect>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="flex-1 sm:flex-none">
              <option value="all">Active and off</option>
              <option value="active">Active</option>
              <option value="off">Switched off</option>
            </NativeSelect>
            {filtersOn && (
              <Button variant="ghost" size="sm" onClick={clear}>
                <X className="mr-1 h-4 w-4" /> Clear
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} of {users.length}
            </span>
          </div>

          {isLoading ? (
            <div className="p-4">
              <ListSkeleton rows={6} />
            </div>
          ) : error ? (
            <EmptyState icon={UserX} title="Could not load logins" hint={error.message} action={<Button onClick={() => refetch()}>Try again</Button>} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title={users.length ? "No login matches" : "No logins yet"}
              hint={users.length ? "Change the search or filters." : "Give employees a login on the Employee screen, or make one here."}
              action={filtersOn ? <Button variant="outline" onClick={clear}>Clear filters</Button> : null}
            />
          ) : (
            <>
              {/* md+: table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      <th className={TH}>Name</th>
                      <th className={TH}>Username</th>
                      <th className={TH}>Employee</th>
                      <th className={TH}>Roles</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Since</th>
                      <th className={cn(TH, "text-right")}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((u) => (
                      <tr key={u.id} className={cn("hover:bg-primary/[0.03]", !u.isActive && "text-muted-foreground")}>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-foreground">
                            {u.name || "—"}
                            {u.id === myId && <span className={cn("ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold", CHIP.brand)}>You</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs">{u.username || "—"}</td>
                        <td className="px-3 py-2.5">
                          <EmployeeCellLink u={u} />
                        </td>
                        <td className="px-3 py-2.5">
                          <RoleChips roles={u.roles || [u.role]} roleName={roleName} />
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", u.isActive ? CHIP.ok : CHIP.bad)}>{u.isActive ? "Active" : "Off"}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums">{fmtDate(u.createdAt)}</td>
                        <td className="px-2 py-1.5">
                          <RowActions u={u} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* phone: cards */}
              <ul className="divide-y divide-border md:hidden">
                {filtered.map((u) => (
                  <li key={u.id} className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{u.name || u.email}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {u.username ? <span className="font-mono">{u.username}</span> : null}
                          {u.username ? " · " : ""}
                          {u.email}
                        </p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", u.isActive ? CHIP.ok : CHIP.bad)}>{u.isActive ? "Active" : "Off"}</span>
                    </div>
                    <div className="text-sm">
                      <EmployeeCellLink u={u} />
                    </div>
                    <RoleChips roles={u.roles || [u.role]} roleName={roleName} max={6} />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Since {fmtDate(u.createdAt)}</span>
                      <RowActions u={u} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>Only a Super Admin gives or takes away Super Admin; the last active Super Admin keeps it.</span>
          <Link href="/admin/roles" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            Roles <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/admin/permissions" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            Permissions <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </main>

      {/* create / edit */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && !saving && setEditing(null)}>
        <DialogContent className="max-h-[92vh] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-xl">
          <form onSubmit={save} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing === "new" ? "New login" : `Edit ${editing?.name || editing?.email || ""}`}</DialogTitle>
              <DialogDescription>
                {editing === "new"
                  ? "For someone who is not an employee (Super Admin, auditor …). Employees get their login on the Employee screen."
                  : editing?.employeeId
                    ? <>Belongs to employee {employeeName(editing) || `#${editing.employeeId}`}.</>
                    : "This login belongs to no employee."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="lg-name" className="mb-1.5 block text-sm font-medium">Name <span className="text-red-600">*</span></label>
                <Input id="lg-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </div>
              <div>
                <label htmlFor="lg-username" className="mb-1.5 block text-sm font-medium">Username</label>
                <Input id="lg-username" value={form.username} maxLength={25} autoComplete="off" onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div>
                <label htmlFor="lg-email" className="mb-1.5 block text-sm font-medium">Email <span className="text-red-600">*</span></label>
                <Input id="lg-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              {editing === "new" && (
                <div className="sm:col-span-2">
                  <label htmlFor="lg-pw" className="mb-1.5 block text-sm font-medium">Password <span className="text-red-600">*</span></label>
                  <div className="flex gap-2">
                    <Input id="lg-pw" type="text" autoComplete="new-password" className="font-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" />
                    <Button type="button" variant="outline" onClick={() => setForm({ ...form, password: generatePassword() })}>
                      <Wand2 className="mr-1.5 h-4 w-4" /> Generate
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Shown once more after saving, to hand over.</p>
                </div>
              )}
              <div className="sm:col-span-2">
                <RolePicker idPrefix="lg" options={options} role={form.role} roles={form.roles} onChange={(v) => setForm({ ...form, ...v })} disabled={saving} />
              </div>
              <div>
                <label htmlFor="lg-shift" className="mb-1.5 block text-sm font-medium">POS shift</label>
                <NativeSelect id="lg-shift" className="h-10 w-full" value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}>
                  <option value="">No shift</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({hhmm(s.startTime)} – {hhmm(s.endTime)})
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <label className="flex h-10 cursor-pointer items-center gap-3 self-end rounded-md border px-3">
                <Switch checked={form.isActive} disabled={editing !== "new" && editing?.id === myId} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
                <span className="text-sm font-medium">{form.isActive ? "Active" : "Switched off"}</span>
              </label>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {editing === "new" ? "Create login" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* reset password */}
      <Dialog open={!!resetFor} onOpenChange={(v) => !v && !saving && setResetFor(null)}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Reset password
            </DialogTitle>
            <DialogDescription>
              For <span className="font-semibold text-foreground">{resetFor?.name || resetFor?.email}</span>. The new password is shown once.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              doReset(false);
            }}
            className="space-y-3"
          >
            <Input aria-label="New password" type="text" autoComplete="new-password" className="font-mono" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="Type a new password (min 6)" autoFocus />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => doReset(true)} disabled={saving}>
                <Wand2 className="mr-1.5 h-4 w-4" /> Generate & save
              </Button>
              <Button type="submit" disabled={saving || resetPw.length < 6}>
                Save password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* switch on / off */}
      <AlertDialog open={!!togglingFor} onOpenChange={(v) => !v && !saving && setTogglingFor(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{togglingFor?.isActive ? "Switch off" : "Switch on"} {togglingFor?.name || togglingFor?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              {togglingFor?.isActive
                ? "They are signed out within a minute and cannot sign in until switched on again. Their records stay."
                : "They can sign in again with their current password."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doToggle();
              }}
              disabled={saving}
              className={togglingFor?.isActive ? "bg-red-700 hover:bg-red-800" : undefined}
            >
              {togglingFor?.isActive ? "Switch off" : "Switch on"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PasswordOnceDialog password={shown?.password} who={shown?.who} onClose={() => setShown(null)} />
    </div>
  );
}
