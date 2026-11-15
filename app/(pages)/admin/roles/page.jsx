"use client";
// /admin/roles — the role catalogue (permissions.manage).
//
// Roles are data (app_roles): name them, group them (System / Management /
// Department heads / Staff / Self-service), choose their sidebar (the whole
// menu, or each person's own Employee menus), switch them off, copy one into
// a new role. A person holds one main role and may hold more; access is
// everything their roles allow (lib/auth/permissions.js). What each role may
// do is set on Admin → Permissions; this screen shows it read-only.
//
// Two panes on lg+ (list left, the chosen role right); stacked on a phone.
// API: /api/roles, /api/roles/[code].
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpRight, Check, Copy, KeyRound, Loader2, Lock, Plus, Search, ShieldCheck, Star, Trash2, UserMinus, UserPlus, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SearchableSelect from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { api, BRAND_BTN, CHIP, CODE_CHIP, EmptyState, HR_MAIN, HR_PAGE, ListSkeleton, NativeSelect, PageHeader, Panel } from "@/components/HR/shared";

const NAV_LABEL = { all: "Whole menu", assigned: "Their own menus" };
const NAV_HINT = {
  all: "Sees every screen in the menu (Setup → Menu). Actions still need permissions.",
  assigned: "Sees only the screens given to them on Employee menus. Those screens let them view, add, edit and print there.",
};

function useRoleList() {
  return useQuery({ queryKey: ["roles"], queryFn: () => api("/api/roles"), staleTime: 30 * 1000 });
}

/* ── left: the catalogue ──────────────────────────────────────────── */

function RoleList({ roles, levels, selected, onPick }) {
  const [find, setFind] = useState("");
  const term = find.trim().toLowerCase();
  const shown = roles.filter((r) => !term || `${r.name} ${r.code} ${r.description || ""}`.toLowerCase().includes(term));
  return (
    <Panel
      title="Roles"
      icon={KeyRound}
      className="lg:sticky lg:top-4"
      actions={<span className="text-xs font-semibold text-muted-foreground">{roles.length}</span>}
    >
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a role…" className="h-9 pl-9" />
        </div>
      </div>
      <div className="max-h-[24rem] overflow-y-auto lg:max-h-[calc(100vh-16rem)]">
        {levels.map((lvl) => {
          const list = shown.filter((r) => r.level === lvl.id);
          if (!list.length) return null;
          return (
            <div key={lvl.id}>
              <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                {lvl.label}
                <span className="text-muted-foreground">{list.length}</span>
              </div>
              {list.map((r) => {
                const active = selected === r.code;
                return (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => onPick(r.code)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 border-l-2 px-3 py-2.5 text-left transition",
                      active ? "border-primary bg-primary/10" : "border-transparent hover:bg-primary/[0.04]",
                      !r.is_active && "opacity-60",
                    )}
                  >
                    {r.super_admin ? (
                      <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <KeyRound className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", active ? "font-semibold text-primary" : "font-medium")}>{r.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {r.users ?? 0} {r.users === 1 ? "person" : "people"} ·{" "}
                        {r.super_admin ? "everything" : `${r.permissions ?? 0} permissions`}
                        {!r.is_active && " · off"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {!shown.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Nothing matches.</p>}
      </div>
    </Panel>
  );
}

/* ── right: one role ──────────────────────────────────────────────── */

function RoleEditor({ code, levels, onChanged, onDeleted }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["role", code],
    queryFn: () => api(`/api/roles/${code}`),
    enabled: !!code,
  });
  const users = useQuery({ queryKey: ["roles-users"], queryFn: () => api("/api/users?limit=5000"), staleTime: 60 * 1000 });
  const role = data?.role;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [pick, setPick] = useState(null);

  useEffect(() => {
    if (role) setForm({ name: role.name, description: role.description || "", level: role.level, nav_mode: role.nav_mode, is_active: role.is_active });
  }, [role]);

  const byModule = useMemo(() => {
    const m = new Map();
    for (const p of data?.permissions || []) {
      if (!m.has(p.module)) m.set(p.module, []);
      m.get(p.module).push(p);
    }
    return [...m.entries()];
  }, [data]);

  const refresh = async () => {
    await Promise.all([refetch(), qc.invalidateQueries({ queryKey: ["roles"] })]);
    onChanged?.();
  };

  if (!code) return <Panel><EmptyState icon={KeyRound} title="Pick a role" hint="Choose a role on the left to see who holds it and what it may do." /></Panel>;
  if (isLoading || !form || !role) return <Panel><ListSkeleton rows={6} /></Panel>;

  const superAdmin = role.code === "ADMIN";
  const dirty =
    form.name !== role.name || form.description !== (role.description || "") || form.level !== role.level || form.nav_mode !== role.nav_mode || form.is_active !== role.is_active;
  const memberIds = new Set((data.members || []).map((m) => m.id));
  const candidates = (users.data?.users || [])
    .filter((u) => !memberIds.has(u.id) && u.isActive)
    .map((u) => ({ value: u.id, label: `${u.name || u.email}${u.email ? ` · ${u.email}` : ""}` }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api(`/api/roles/${role.code}`, { method: "PUT", body: form });
      toast.success(r.message);
      await refresh();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const member = async (action, user_id) => {
    setBusy(`${action}:${user_id}`);
    try {
      const r = await api(`/api/roles/${role.code}`, { method: "POST", body: { action, user_id } });
      toast.success(r.message);
      setPick(null);
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["roles-users"] })]);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the role "${role.name}"? Its permissions and menu blocks go with it.`)) return;
    try {
      const r = await api(`/api/roles/${role.code}`, { method: "DELETE" });
      toast.success(r.message);
      await qc.invalidateQueries({ queryKey: ["roles"] });
      onDeleted?.();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{role.name}</span>
            <span className={CODE_CHIP}>{role.code}</span>
            {role.is_system && <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold", CHIP.muted)}>built in</span>}
          </span>
        }
        icon={superAdmin ? ShieldCheck : KeyRound}
        actions={
          !role.is_system && (
            <Button variant="ghost" size="sm" className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={remove}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete
            </Button>
          )
        }
        bodyClassName="p-4 sm:p-5"
      >
        {superAdmin && (
          <div className={cn("mb-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px]", CHIP.brand)}>
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Super Admin skips every permission check, is never blocked from a menu, and may approve their own requests. Only a Super Admin can
              give or take it away, and the last one always keeps it.
            </span>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Name</span>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Group</span>
            <NativeSelect className="h-10 w-full" value={form.level} disabled={superAdmin} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-semibold text-muted-foreground">What this role is for</span>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Sidebar</span>
            <NativeSelect className="h-10 w-full" value={form.nav_mode} disabled={superAdmin} onChange={(e) => setForm({ ...form, nav_mode: e.target.value })}>
              {Object.entries(NAV_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </NativeSelect>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">{NAV_HINT[form.nav_mode]}</span>
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Status</span>
            <label className="flex h-10 cursor-pointer items-center gap-3 rounded-md border px-3">
              <Switch checked={form.is_active} disabled={role.is_system} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <span className="text-sm font-medium">{form.is_active ? "On — gives its access" : "Off — gives nothing"}</span>
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {dirty && (
            <Button variant="outline" onClick={() => setForm({ name: role.name, description: role.description || "", level: role.level, nav_mode: role.nav_mode, is_active: role.is_active })}>
              Undo
            </Button>
          )}
          <Button className={BRAND_BTN} disabled={!dirty || saving} onClick={save}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Save
          </Button>
        </div>
      </Panel>

      <Panel title={`People (${data.members.length})`} icon={Users} bodyClassName="divide-y divide-border">
        <div className="flex flex-col gap-2 p-3 sm:flex-row">
          <div className="min-w-0 flex-1">
            <SearchableSelect value={pick} onChange={setPick} options={candidates} placeholder="Add a person to this role…" ariaLabel="Person to add" />
          </div>
          <Button className={BRAND_BTN} disabled={!pick || !!busy} onClick={() => member("addMember", pick)}>
            <UserPlus className="mr-1.5 h-4 w-4" /> Add
          </Button>
        </div>
        {!data.members.length && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody holds this role yet.</p>}
        {data.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{m.name}</span>
                {m.primary ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold", CHIP.brand)}>main role</span>
                ) : (
                  <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold", CHIP.muted)}>also holds</span>
                )}
                {!m.active && <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold", CHIP.bad)}>login off</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
            <div className="flex gap-1.5">
              {!m.primary && (
                <Button variant="outline" size="sm" className="h-8" disabled={!!busy} onClick={() => member("makePrimary", m.id)}>
                  <Star className="mr-1 h-3.5 w-3.5" /> Make main
                </Button>
              )}
              {!m.primary && (
                <Button variant="ghost" size="sm" className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!!busy} onClick={() => member("removeMember", m.id)}>
                  {busy === `removeMember:${m.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="mr-1 h-3.5 w-3.5" />} Remove
                </Button>
              )}
            </div>
          </div>
        ))}
      </Panel>

      <Panel
        title={superAdmin ? "Permissions — everything" : `Permissions (${data.permissions.filter((p) => p.allow).length})`}
        icon={ShieldCheck}
        actions={
          !superAdmin && (
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href={`/admin/permissions?role=${role.code}`}>
                Change <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          )
        }
        bodyClassName="p-4"
      >
        {superAdmin ? (
          <p className="text-sm text-muted-foreground">Super Admin holds every permission; nothing is stored for it.</p>
        ) : !byModule.length ? (
          <p className="text-sm text-muted-foreground">
            No permissions yet. People with this role can still work on the screens given to them on Employee menus.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {byModule.map(([mod, list]) => (
              <div key={mod} className="rounded-lg border border-border p-3">
                <p className="mb-1.5 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-primary">
                  {mod}
                  <span className="text-muted-foreground">{list.length}</span>
                </p>
                <ul className="space-y-0.5">
                  {list.map((p) => (
                    <li key={p.code} className={cn("truncate text-[12.5px]", !p.allow && "text-destructive line-through")} title={p.code}>
                      {p.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ── new role ─────────────────────────────────────────────────────── */

function NewRoleDialog({ open, onOpenChange, roles, levels, onCreated }) {
  const [form, setForm] = useState({ name: "", description: "", level: "staff", nav_mode: "assigned", copy_from: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm({ name: "", description: "", level: "staff", nav_mode: "assigned", copy_from: "" });
  }, [open]);
  const create = async () => {
    setSaving(true);
    try {
      const r = await api("/api/roles", { method: "POST", body: { ...form, copy_from: form.copy_from || null } });
      toast.success(r.message);
      onCreated(r.code);
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Start empty, or copy an existing role&apos;s permissions and menu blocks and adjust them.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Name</span>
            <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Quality Officer" maxLength={80} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">What this role is for</span>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Group</span>
              <NativeSelect className="h-10 w-full" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
                {levels.filter((l) => l.id !== "system").map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </NativeSelect>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Sidebar</span>
              <NativeSelect className="h-10 w-full" value={form.nav_mode} onChange={(e) => setForm({ ...form, nav_mode: e.target.value })}>
                {Object.entries(NAV_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </NativeSelect>
            </label>
          </div>
          <label className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Copy className="h-3.5 w-3.5" /> Copy permissions from
            </span>
            <NativeSelect className="h-10 w-full" value={form.copy_from} onChange={(e) => setForm({ ...form, copy_from: e.target.value })}>
              <option value="">— start empty —</option>
              {roles.filter((r) => !r.super_admin).map((r) => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={BRAND_BTN} disabled={!form.name.trim() || saving} onClick={create}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />} Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */

export default function RolesPage() {
  const { data, isLoading, error, refetch } = useRoleList();
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const roles = data?.roles || [];
  const levels = data?.levels || [];

  useEffect(() => {
    if (!selected && roles.length) setSelected(roles[0].code);
  }, [roles, selected]);

  if (error) {
    return (
      <div className={HR_PAGE}>
        <div className={HR_MAIN}>
          <Panel><EmptyState icon={Lock} title="Could not load roles" hint={error.message} /></Panel>
        </div>
      </div>
    );
  }

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={KeyRound}
        title="Roles"
        breadcrumb="Admin"
        badge={roles.length || undefined}
        subtitle="Who holds which role, what each role may do, and which sidebar it shows."
        actions={
          data?.canManage && (
            <Button className={BRAND_BTN} onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New role
            </Button>
          )
        }
      />
      <main className={HR_MAIN}>
        {isLoading ? (
          <Panel><ListSkeleton rows={8} /></Panel>
        ) : !data?.canManage ? (
          <Panel><EmptyState icon={Lock} title="You cannot manage roles" hint="It needs the permissions.manage right (Admin → Permissions)." /></Panel>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <RoleList roles={roles} levels={levels} selected={selected} onPick={setSelected} />
            <RoleEditor key={selected} code={selected} levels={levels} onChanged={refetch} onDeleted={() => setSelected(null)} />
          </div>
        )}
      </main>
      <NewRoleDialog open={creating} onOpenChange={setCreating} roles={roles} levels={levels} onCreated={async (code) => { await refetch(); setSelected(code); }} />
    </div>
  );
}
