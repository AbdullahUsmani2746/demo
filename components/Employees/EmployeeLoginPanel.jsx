"use client";

// Employee screen → "Login & Roles": the employee's login, saved on its own
// (/api/employees/[id]/login) — create or link a login, username / email,
// active on/off, main role + extra roles, password reset (typed or generated,
// shown once). Rules are the server's (lib/auth/roleAssign.js).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, KeyRound, Link2, Loader2, RefreshCw, Save, ShieldCheck, ShieldOff, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useRoles } from "@/hooks/useRoles";
import { api, CHIP } from "@/components/HR/shared";
import { cn } from "@/lib/utils";
import { generatePassword, offerableRoles, PasswordOnceDialog, RoleChips, RolePicker } from "@/components/Admin/loginParts";

const blank = (emp) => ({ username: emp ? String(emp.id) : "", email: emp?.emailAddress || "", role: "EMPLOYEE", roles: [], isActive: true, password: "" });

export default function EmployeeLoginPanel({ employee }) {
  const qc = useQueryClient();
  const { activeRoles: catalogue, roleName } = useRoles();
  const key = ["employee-login", employee.id];
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => api(`/api/employees/${employee.id}/login`) });
  const login = data?.login || null;
  const meta = data?.meta || {};

  const [form, setForm] = useState(blank(employee));
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shownPassword, setShownPassword] = useState(null);
  const [linkId, setLinkId] = useState("");

  useEffect(() => {
    if (login) {
      setForm({ username: login.username || "", email: login.email || "", role: login.role, roles: login.roles.filter((c) => c !== login.role), isActive: login.isActive, password: "" });
    } else setForm(blank(employee));
  }, [login, employee]);

  const options = useMemo(
    () => offerableRoles(catalogue, { manageAll: meta.manageAll, levels: meta.levels, superAdmin: meta.superAdmin, keep: login?.roles || [] }),
    [catalogue, meta.manageAll, meta.levels, meta.superAdmin, login],
  );
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async (extra = {}) => {
    setSaving(true);
    try {
      const body = { ...form, ...extra };
      if (!body.password) delete body.password;
      const res = await api(`/api/employees/${employee.id}/login`, { method: "PUT", body });
      toast.success(res.message || "Saved");
      if (body.password && body.generated) setShownPassword(body.password);
      setCreating(false);
      qc.setQueryData(key, (old) => ({ ...(old || {}), login: res.login }));
      qc.invalidateQueries({ queryKey: ["employees"] });
      set({ password: "" });
    } catch (e) {
      toast.error(e.message, { duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  const link = async () => {
    if (!linkId) return;
    setSaving(true);
    try {
      const res = await api(`/api/employees/${employee.id}/login`, { method: "PUT", body: { linkUserId: linkId } });
      toast.success(res.message);
      refetch();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading)
    return (
      <div className="flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading login…
      </div>
    );
  if (error) {
    return (
      <div className="rounded-xl border bg-muted/40 p-5 text-sm">
        <p className="font-semibold">{error.status === 403 ? "You may not manage logins." : "Could not load the login."}</p>
        <p className="mt-1 text-muted-foreground">{error.status === 403 ? "Logins and roles are given by holders of users.manage or employee.manage (Admin → Permissions)." : error.message}</p>
      </div>
    );
  }

  if (!login && !creating) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center">
          <div className="rounded-full bg-muted p-3">
            <ShieldOff className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-base font-bold">No login</p>
            <p className="text-sm text-muted-foreground">This employee cannot sign in to the system.</p>
          </div>
          <Button type="button" onClick={() => setCreating(true)} className="gap-2">
            <KeyRound className="h-4 w-4" /> Create login
          </Button>
        </div>
        {data?.linkable?.length > 0 && (
          <div className="rounded-xl border p-4">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Link2 className="h-4 w-4 text-primary" /> Or link an existing login
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Logins that belong to no employee yet.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="Login to link"
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
              >
                <option value="">Pick a login…</option>
                {data.linkable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.username || u.email} — {u.username || u.email}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={link} disabled={!linkId || saving}>
                Link
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const isNew = !login;
  return (
    <div className="space-y-5">
      {login ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-full bg-primary/15 p-2.5">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current login</p>
              <p className="truncate font-mono text-base font-bold">{login.username || login.email}</p>
              <div className="mt-1">
                <RoleChips roles={login.roles} roleName={roleName} max={6} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-bold", login.isActive ? CHIP.ok : CHIP.muted)}>
              {login.isActive ? "Active" : "Switched off"}
            </span>
            {meta.manageAll && (
              <Link href={`/admin/user?search=${encodeURIComponent(login.username || login.email)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Logins & Roles <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-[#f5f0e6] p-4 text-sm text-[#5f4b1f] dark:bg-amber-950/30 dark:text-amber-200">
          A new login for this employee. Set the username, roles and a password, then <span className="font-semibold">Create login</span>.
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
        <div>
          <label htmlFor="el-username" className="mb-1.5 block text-sm font-medium">Username</label>
          <Input id="el-username" value={form.username} autoComplete="off" maxLength={25} onChange={(e) => set({ username: e.target.value })} />
          <p className="mt-1 text-xs text-muted-foreground">Used to sign in; unique, no @ sign.</p>
        </div>
        <div>
          <label htmlFor="el-email" className="mb-1.5 block text-sm font-medium">Login email</label>
          <Input id="el-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          <p className="mt-1 text-xs text-muted-foreground">Can also be used to sign in.</p>
        </div>
        <div className="sm:col-span-2">
          <RolePicker idPrefix="el" options={options} role={form.role} roles={form.roles} onChange={(v) => set(v)} disabled={saving} />
        </div>
        <label className="flex h-10 cursor-pointer items-center gap-3 rounded-md border px-3 sm:col-span-2">
          <Switch checked={!!form.isActive} onCheckedChange={(v) => set({ isActive: v })} />
          <span className="text-sm font-medium">{form.isActive ? "Active — can sign in" : "Switched off — cannot sign in"}</span>
        </label>
      </div>

      <div className="rounded-xl border p-4">
        <p className="flex items-center gap-2 text-sm font-bold">
          <KeyRound className="h-4 w-4 text-primary" /> {isNew ? "Password" : "Reset password"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isNew ? "Type one (min 6 characters) or generate one — a generated password is shown once after saving." : "Leave blank to keep the current password, or generate a new one (shown once)."}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="New password"
            type="text"
            autoComplete="new-password"
            value={form.password}
            placeholder={isNew ? "Password" : "New password (optional)"}
            onChange={(e) => set({ password: e.target.value })}
            className="font-mono sm:max-w-xs"
          />
          {!isNew && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => save({ password: generatePassword(), generated: true })} className="gap-1.5">
              <RefreshCw className="h-4 w-4" /> Reset & generate
            </Button>
          )}
          {isNew && (
            <Button type="button" variant="outline" onClick={() => set({ password: generatePassword() })} className="gap-1.5">
              <Wand2 className="h-4 w-4" /> Generate
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        {isNew && (
          <Button type="button" variant="ghost" onClick={() => setCreating(false)} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="button" onClick={() => save({ generated: isNew && !!form.password })} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isNew ? "Create login" : "Save login"}
        </Button>
      </div>

      <PasswordOnceDialog password={shownPassword} who={`${employee.firstName || ""} ${employee.surname || ""}`.trim()} onClose={() => setShownPassword(null)} />
    </div>
  );
}
