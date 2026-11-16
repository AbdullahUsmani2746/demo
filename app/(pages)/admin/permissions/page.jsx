"use client";
// /admin/permissions — grant and withdraw rights.
//
// Three kinds of subject:
//   Role       — Rights (every permission: allow / deny / inherit)
//   Department — Data scope for everyone in it (e.g. Despatch → godowns 3, 9)
//   Person     — Rights + Data scope; a person's scope overrides their
//                department's, or "Same as department" to follow it
// Data-scope cards come from lib/auth/scopeDimensions.js — a new kind of
// limit appears here with no change to this page.
//
// Precedence is shown rather than explained: a user-level rule wins over the
// role rule, so when a row is left on "inherit" the role's own value stays
// visible beside it and the person can see what the fallback actually is.
//
// The catalogue runs to ~400 rows, so modules collapse by default and the
// search box filters across every module at once. Colours come from the app's
// tokens (bg-background, text-muted-foreground, primary, destructive …) so the
// page follows the theme, light or dark, instead of hard-coding greys.
//
// Layout: page header + underline tabs. Rights tab is two panes on lg+ —
// the subject picker (roles / departments / people, with search) on the left,
// the chosen subject's rights and data scope on the right; stacked on phone.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ShieldCheck, Users, Loader2, Check, X, Minus, AlertCircle, Search,
  ShoppingCart, Truck, Factory, Wallet, Settings2, FileText, Boxes,
  Building2, BarChart3, ChevronRight, UserCog, MapPin, Warehouse,
  CircleSlash, RotateCcw, Info, KeyRound, Network, UserRound, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import ApprovalsTab from "@/components/permissions/ApprovalsTab";
import SalesVisibilityTab from "@/components/permissions/SalesVisibilityTab";
import MenuAccessTab from "@/components/permissions/MenuAccessTab";
import { useRoles } from "@/hooks/useRoles";
import { roleLabel } from "@/lib/auth/roleNames";

// Roles come from the catalogue (Admin → Roles, hooks/useRoles.js); Super
// Admin is left out — it holds every permission.

const STATES = [
  { key: "allow", label: "Allow", Icon: Check },
  { key: "inherit", label: "Inherit", Icon: Minus },
  { key: "deny", label: "Deny", Icon: X },
];

// One icon per module, so a long list can be scanned by shape not just text.
const MODULE_ICON = (module) => {
  if (module.startsWith("Reports")) return BarChart3;
  return {
    Sales: ShoppingCart,
    Purchasing: Truck,
    Manufacturing: Factory,
    Finance: Wallet,
    Setup: Settings2,
    Administration: ShieldCheck,
    Documents: FileText,
    "Stock & Costing": Boxes,
    "Fixed Assets": Building2,
  }[module] ?? FileText;
};

// Icon names used by lib/auth/scopeDimensions.js
const DIMENSION_ICONS = { UserCog, MapPin, Warehouse, Boxes, Building2, Building: Building2, Landmark: Wallet, Factory, Users, Truck, Layers };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "allow", label: "Allowed" },
  { key: "deny", label: "Denied" },
  { key: "inherit", label: "Inherited" },
];

// Four tabs: the original per-role / per-person screen, Approvals (who
// approves what — lib/approvals/catalog.js), Sales visibility (whose
// customers each person sees — lib/auth/salesScope.js) and Menu access.
const VIEWS = [
  { key: "rights", label: "Rights & data scope", Icon: KeyRound },
  { key: "approvals", label: "Approvals", Icon: ShieldCheck },
  { key: "sales", label: "Sales visibility", Icon: Users },
  { key: "menus", label: "Menu access", Icon: Network },
];

// Shared look for this page's cards and section labels.
const CARD = "rounded-xl border border-border bg-background";
const CARD_HEAD = "border-b border-primary/15 bg-primary/5 px-4 py-3";
const LABEL = "text-[11px] font-bold uppercase tracking-wider text-primary";

export default function PermissionsPage() {
  const [view, setView] = useState("rights");
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("tab");
    if (VIEWS.some((x) => x.key === v)) setView(v);
  }, []);
  const pick = (v) => {
    setView(v);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", v);
    window.history.replaceState(null, "", u);
  };
  return (
    <div className="min-h-full bg-muted/40">
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        {/* ── page header ─────────────────────────────────────────── */}
        <header className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] text-muted-foreground">Admin</div>
            <h1 className="text-2xl font-bold tracking-tight">Permissions</h1>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">Who may do what — rights per role and person, approvals, menu access and data scopes.</p>
          </div>
        </header>

        {/* ── tabs ────────────────────────────────────────────────── */}
        <nav
          className="mt-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border"
          aria-label="Permissions sections"
        >
          {VIEWS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => pick(key)}
              aria-current={view === key ? "page" : undefined}
              className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition ${
                view === key
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>

        <div className="pt-5">
          {view === "rights" ? (
            <RightsView />
          ) : view === "approvals" ? (
            <ApprovalsTab />
          ) : view === "menus" ? (
            <MenuAccessTab />
          ) : (
            <SalesVisibilityTab />
          )}
        </div>
      </div>
    </div>
  );
}

function RightsView() {
  const [subject, setSubject] = useState({ type: "role", id: "EMPLOYEE" });
  // ?role=CODE (from Admin → Roles → Change) or ?userId= opens that subject.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("userId")) setSubject({ type: "user", id: q.get("userId") });
    else if (q.get("role")) setSubject({ type: "role", id: q.get("role") });
  }, []);
  const [data, setData] = useState(null);
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [open, setOpen] = useState({});
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);

  const isDept = subject.type === "department";
  const query = subject.type === "user" ? `userId=${subject.id}` : `role=${subject.id}`;

  useEffect(() => {
    axios
      .get("/api/permissions/scope")
      .then(({ data: d }) => setDepartments(d.departments ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDept) {
        // A department has a data scope only; rights stay on roles / people.
        setData(null);
        const { data: s } = await axios.get(`/api/permissions/scope?departmentId=${subject.id}`);
        setScope(s);
        return;
      }
      const { data: res } = await axios.get(`/api/permissions?${query}`);
      setData(res);
      if (res?.users) setUsers(res.users);
      if (subject.type === "user") {
        const { data: s } = await axios.get(`/api/permissions/scope?userId=${subject.id}`);
        setScope(s);
      } else {
        setScope(null); // a role has rights, not a data scope
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [query, isDept, subject.type, subject.id]);

  useEffect(() => { load(); }, [load]);

  const subjectKey = subject.type === "user" ? "userId" : "role";

  async function setState(permission, state) {
    if (permission.state === state) return;
    setSaving(permission.id);
    // Optimistic, so a 400-row grid stays responsive; a failure reloads the
    // truth rather than leaving a wrong cell lit.
    setData((d) => ({
      ...d,
      permissions: d.permissions.map((p) => (p.id === permission.id ? { ...p, state } : p)),
    }));
    try {
      await axios.put("/api/permissions", {
        permissionId: permission.id, [subjectKey]: subject.id, state,
      });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      load();
    } finally {
      setSaving(null);
    }
  }

  async function setModule(module, state) {
    const rows = data.permissions.filter((p) => p.module === module);
    setSaving(module);
    try {
      await axios.post("/api/permissions", {
        grants: rows.map((p) => ({ permissionId: p.id, [subjectKey]: subject.id, state })),
      });
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(null);
    }
  }

  const matches = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.permissions.filter((p) => {
      if (stateFilter !== "all" && p.state !== stateFilter) return false;
      if (!term) return true;
      return (
        p.label.toLowerCase().includes(term) ||
        p.code.toLowerCase().includes(term) ||
        p.module.toLowerCase().includes(term)
      );
    });
  }, [data, search, stateFilter]);

  const grouped = useMemo(() => {
    const map = new Map();
    matches.forEach((p) => {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module).push(p);
    });
    return [...map.entries()];
  }, [matches]);

  const counts = useMemo(() => {
    const base = { allow: 0, deny: 0, inherit: 0 };
    if (!data) return base;
    data.permissions.forEach((p) => { base[p.state] += 1; });
    return base;
  }, [data]);

  // Searching should reveal what it found rather than leave everything shut.
  const filtering = search.trim() !== "" || stateFilter !== "all";
  const isOpen = (module) => (filtering ? true : !!open[module]);

  const deptName = (id) => departments.find((d) => String(d.id) === String(id))?.dept_name || `Department ${id}`;
  const subjectName =
    subject.type === "user"
      ? data?.subject?.name || data?.subject?.email || "this person"
      : isDept
        ? deptName(subject.id)
        : roleLabel(subject.id);
  const SubjectIcon = subject.type === "user" ? UserRound : isDept ? Network : KeyRound;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* ── left: who is being edited ────────────────────────────── */}
      <SubjectPicker
        subject={subject}
        onPick={setSubject}
        departments={departments}
        users={users}
      />

      {/* ── right: their rights and data scope ───────────────────── */}
      <div className="min-w-0 space-y-4">
        <section className={`${CARD} overflow-hidden`}>
          <div className={`${CARD_HEAD} flex flex-wrap items-center justify-between gap-3`}>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <SubjectIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className={LABEL}>
                  {subject.type === "user" ? "Person" : isDept ? "Department" : "Role"}
                </div>
                <h2 className="truncate text-[15px] font-semibold text-primary">{subjectName}</h2>
              </div>
            </div>
            {data && !data.bypass && !isDept && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Stat tone="allow" n={counts.allow} label="allowed" Icon={Check} />
                <Stat tone="deny" n={counts.deny} label="denied" Icon={X} />
                <Stat tone="inherit" n={counts.inherit} label="inherited" Icon={Minus} />
              </div>
            )}
          </div>
          <div className="flex items-start gap-2 px-4 py-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {subject.type === "user" ? (
              <span>
                Editing <strong className="text-foreground">{subjectName}</strong> only.
                A rule here overrides their role, and their department&apos;s data scope.
              </span>
            ) : isDept ? (
              <span>
                Editing the <strong className="text-foreground">{subjectName}</strong> department&apos;s
                data scope — applies to everyone in it unless a person has their own rule.
              </span>
            ) : (
              <span>
                Editing the <strong className="text-foreground">{subjectName}</strong> role — this
                affects everyone with it. A right with no rule falls back to the role; a right with
                no rule anywhere is refused.
              </span>
            )}
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : isDept ? (
          scope && (
            <ScopePanel
              subject={subject}
              scope={scope}
              onSaved={load}
              onError={setError}
            />
          )
        ) : data?.bypass ? (
          <section className={`${CARD} flex items-start gap-3 border-primary/30 bg-primary/5 p-5`}>
            <CircleSlash className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-medium text-foreground">
                {subjectName} has unconditional access.
              </p>
              <p className="mt-1 text-muted-foreground">
                A Super Admin bypasses these tables entirely, so nothing set
                here would take effect. Take Super Admin away from them first
                (Admin → Roles) if you need to limit them.
              </p>
            </div>
          </section>
        ) : (
          <>
            {subject.type === "user" && scope && (
              <ScopePanel subject={subject} scope={scope} onSaved={load} onError={setError} />
            )}

            {/* ── toolbar ────────────────────────────────────────── */}
            <div className={`${CARD} sticky top-2 z-20 flex flex-wrap items-center gap-2 bg-background/95 p-2.5 shadow-sm backdrop-blur`}>
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search a right, a code or a module…"
                  className="h-9 pl-9"
                />
              </div>

              <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setStateFilter(f.key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      stateFilter === f.key
                        ? "bg-background font-semibold text-primary shadow-sm"
                        : "text-muted-foreground hover:text-primary"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                {matches.length} shown
              </span>
            </div>

            {/* ── modules ────────────────────────────────────────── */}
            <div className="space-y-3">
              {grouped.map(([module, rows]) => {
                const Icon = MODULE_ICON(module);
                const expanded = isOpen(module);
                const tally = rows.reduce(
                  (a, r) => ({ ...a, [r.state]: a[r.state] + 1 }),
                  { allow: 0, deny: 0, inherit: 0 },
                );
                return (
                  <section key={module} className={`${CARD} overflow-hidden`}>
                    <div className={`flex flex-wrap items-center gap-2 ${expanded ? "border-b border-primary/15" : ""} bg-primary/5 px-3 py-2.5`}>
                      <button
                        onClick={() => setOpen((o) => ({ ...o, [module]: !o[module] }))}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        disabled={filtering}
                        aria-expanded={expanded}
                      >
                        <ChevronRight
                          className={`h-4 w-4 shrink-0 text-primary/70 transition-transform ${
                            expanded ? "rotate-90" : ""
                          }`}
                        />
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="truncate text-[15px] font-semibold text-primary">{module}</span>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 text-xs font-bold text-primary">
                          {rows.length}
                        </span>
                        <span className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
                          {tally.allow > 0 && <Dot tone="allow" n={tally.allow} />}
                          {tally.deny > 0 && <Dot tone="deny" n={tally.deny} />}
                          {tally.inherit > 0 && <Dot tone="inherit" n={tally.inherit} />}
                        </span>
                      </button>

                      {/* set every right in the module at once */}
                      <div className="flex shrink-0 items-center gap-1">
                        {saving === module && (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                        <span className="mr-1 hidden text-[11px] text-muted-foreground lg:inline">All:</span>
                        {STATES.map(({ key, label, Icon: SIcon }) => (
                          <Button
                            key={key}
                            size="sm"
                            variant="outline"
                            disabled={saving === module}
                            onClick={() => setModule(module, key)}
                            className="h-7 gap-1 bg-background px-2 text-xs"
                            title={`Set every right in ${module} to ${label}`}
                            aria-label={`Set every right in ${module} to ${label}`}
                          >
                            <SIcon className="h-3 w-3" />
                            <span className="hidden md:inline">{label}</span>
                          </Button>
                        ))}
                      </div>
                    </div>

                    {expanded && (
                      <ul>
                        {rows.map((p) => (
                          <li
                            key={p.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-3 py-2 transition-colors last:border-0 hover:bg-primary/[0.03] sm:grid-cols-[minmax(0,1fr)_7rem_auto]"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm">{p.label}</div>
                              <code className="block truncate font-mono text-[11px] text-muted-foreground">
                                {p.code}
                              </code>
                              {/* phone: the role fallback sits under the code */}
                              {p.state === "inherit" && p.inherited && (
                                <span className="mt-1 inline-block sm:hidden">
                                  <InheritedChip value={p.inherited} viaMenu={p.viaMenu} />
                                </span>
                              )}
                            </div>

                            <div className="hidden justify-start sm:flex">
                              {p.state === "inherit" && p.inherited && <InheritedChip value={p.inherited} viaMenu={p.viaMenu} />}
                            </div>

                            <StateToggle
                              value={p.state}
                              busy={saving === p.id}
                              onChange={(s) => setState(p, s)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}

              {grouped.length === 0 && (
                <div className="rounded-xl border border-dashed border-border bg-background py-14 text-center">
                  <Search className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Nothing matches that search or filter.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 gap-1.5 bg-background"
                    onClick={() => { setSearch(""); setStateFilter("all"); }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Clear
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Left pane: every subject in one searchable list — roles, departments,
 * people. Picking one sets the same { type, id } the old dropdowns did
 * (ids as strings, as a <select> gave them).
 */
function SubjectPicker({ subject, onPick, departments, users }) {
  const [find, setFind] = useState("");
  const { activeRoles } = useRoles();
  const term = find.trim().toLowerCase();
  const has = (...parts) => !term || parts.join(" ").toLowerCase().includes(term);

  const roles = activeRoles.filter((r) => !r.super_admin && has(r.code, r.name)).map((r) => r.code);
  const depts = departments.filter((d) => has(d.dept_name));
  const people = users.filter((u) => has(u.name, u.email, u.role, roleLabel(u.role)));
  const isActive = (type, id) => subject.type === type && String(subject.id) === String(id);

  const Row = ({ type, id, title, sub, Icon }) => {
    const active = isActive(type, id);
    return (
      <button
        type="button"
        onClick={() => onPick({ type, id })}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left transition ${
          active
            ? "border-primary bg-primary/10"
            : "border-transparent hover:bg-primary/[0.04]"
        }`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${active ? "font-semibold text-primary" : ""}`}>{title}</span>
          {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
        </span>
      </button>
    );
  };

  const Group = ({ label, children, n }) => (
    <div>
      <div className={`${LABEL} flex items-center justify-between bg-muted/40 px-3 py-1.5`}>
        {label}
        <span className="font-semibold text-muted-foreground">{n}</span>
      </div>
      {children}
    </div>
  );

  return (
    <aside className={`${CARD} overflow-hidden lg:sticky lg:top-4`}>
      <div className={CARD_HEAD}>
        <h2 className="text-[15px] font-semibold text-primary">Who are you editing?</h2>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find a role, department or person…"
            className="h-9 bg-background pl-9"
          />
        </div>
      </div>
      <div className="max-h-[22rem] overflow-y-auto lg:max-h-[calc(100vh-15rem)]">
        {roles.length > 0 && (
          <Group label="Roles" n={roles.length}>
            {roles.map((r) => (
              <Row key={r} type="role" id={r} title={roleLabel(r)} sub="Everyone with this role" Icon={KeyRound} />
            ))}
          </Group>
        )}
        {depts.length > 0 && (
          <Group label="Departments — data scope" n={depts.length}>
            {depts.map((d) => (
              <Row
                key={d.id}
                type="department"
                id={String(d.id)}
                title={d.dept_name}
                sub={d.users != null ? `${d.users} user${d.users === 1 ? "" : "s"}` : null}
                Icon={Network}
              />
            ))}
          </Group>
        )}
        {people.length > 0 && (
          <Group label="People — override one person" n={people.length}>
            {people.map((u) => (
              <Row key={u.id} type="user" id={String(u.id)} title={u.name || u.email} sub={roleLabel(u.role)} Icon={UserRound} />
            ))}
          </Group>
        )}
        {roles.length + depts.length + people.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Nothing matches.</p>
        )}
      </div>
    </aside>
  );
}

/* ── small pieces ──────────────────────────────────────────────────── */

const TONE = {
  allow: "bg-[#edf2ee] text-[#2f5139]",
  deny: "bg-destructive/10 text-destructive",
  inherit: "bg-muted text-muted-foreground",
};

function Stat({ tone, n, label, Icon }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {n} {label}
    </span>
  );
}

function InheritedChip({ value, viaMenu }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        value === "allow" ? TONE.allow : TONE.deny
      }`}
    >
      {viaMenu ? "their menus" : "role"}: {value}
    </span>
  );
}

function Dot({ tone, n }) {
  const colour = {
    allow: "bg-[#2f5139]",
    deny: "bg-destructive",
    inherit: "bg-muted-foreground/40",
  }[tone];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${colour}`} />
      {n}
    </span>
  );
}

/** Three-state segmented control, fixed width so every row lines up. */
function StateToggle({ value, busy, onChange }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <div className="flex overflow-hidden rounded-md border border-border">
        {STATES.map(({ key, label, Icon }, i) => {
          const active = value === key;
          const activeClass =
            key === "allow"
              ? "bg-[#2f5139] text-white"
              : key === "deny"
                ? "bg-destructive text-destructive-foreground"
                : "bg-muted-foreground/20 text-foreground";
          return (
            <button
              key={key}
              title={label}
              aria-label={label}
              aria-pressed={active}
              disabled={busy}
              onClick={() => onChange(key)}
              className={`grid h-7 w-8 place-items-center transition disabled:opacity-40 ${
                i > 0 ? "border-l border-border" : ""
              } ${active ? activeClass : "bg-background text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${CARD} p-3`}>
          <div className="mb-3 flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-4 w-40" />
          </div>
          {[0, 1, 2].map((j) => (
            <div key={j} className="flex items-center justify-between py-2">
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-40 sm:w-56" />
                <Skeleton className="h-2.5 w-32" />
              </div>
              <Skeleton className="h-7 w-24 rounded-md" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Data scope — which rows a person or a department may see and work with:
 * the Godown dropdown on every form, document lists, saving, and reports.
 *
 * Cards come from the API (lib/auth/scopeDimensions.js), so a new kind of
 * limit shows up here on its own. Modes:
 *   Department: All (no limit) · Chosen
 *   Person:     Same as department · All · Theirs (where it makes sense) · Chosen
 * The chosen-values list keeps its edits local until Save, because a
 * checkbox list would otherwise fire one request per click.
 */
function ScopePanel({ subject, scope, onSaved, onError }) {
  const [busy, setBusy] = useState(null);
  const [draft, setDraft] = useState(null); // { dimension, values }
  const [find, setFind] = useState("");
  const isUser = subject.type === "user";
  const idKey = isUser ? "userId" : "departmentId";
  const dims = scope.dimensions ?? [];
  const deptLabel = scope.department?.dept_name;

  async function save(dimension, mode, values) {
    setBusy(dimension);
    try {
      await axios.put("/api/permissions/scope", { [idKey]: subject.id, dimension, mode, values });
      setDraft(null);
      setFind("");
      await onSaved();
    } catch (e) {
      onError(e.response?.data?.error || e.message);
    } finally {
      setBusy(null);
    }
  }

  const summary = (rule, options) =>
    rule.mode === "ALL"
      ? "No limit"
      : rule.mode === "OWN"
        ? "Their own"
        : rule.values
            .map((v) => options.find((o) => o.value === v)?.label ?? v)
            .join(", ") || "Nothing";

  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className={`${CARD_HEAD} flex items-start gap-2.5`}>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Boxes className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-primary">Data scope</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Limits what {isUser ? "this person" : "everyone in this department"} can pick, list,
            save and report on. A godown limit covers dropdowns, stock documents (either side of a
            transfer) and godown-filtered reports.
          </p>
          {!isUser && scope.departmentTableReady === false && (
            <p className="mt-1 text-xs text-destructive">
              Department scope is not set up yet — run prisma/sql/2026-10-21_department_scope.sql and
              prisma generate.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-3">
        {dims.map(({ key, label, icon, ownable }) => {
          const Icon = DIMENSION_ICONS[icon] ?? Boxes;
          const current = scope.scopes?.[key] ?? { mode: isUser ? "INHERIT" : "ALL", values: [] };
          const inherited = scope.inherited?.[key];
          const options = scope.options?.[key] ?? [];
          const editing = draft?.dimension === key;
          const chosen = editing ? draft.values : current.values;
          const one = label.toLowerCase().replace(/s$/, "");
          const visible = find.trim()
            ? options.filter((o) => o.label.toLowerCase().includes(find.trim().toLowerCase()))
            : options;
          const modes = [
            ...(isUser ? [{ m: "INHERIT", t: "Department" }] : []),
            { m: "ALL", t: "All" },
            ...(isUser && ownable ? [{ m: "OWN", t: "Theirs" }] : []),
            { m: "LIST", t: "Chosen" },
          ];

          return (
            <div key={key} className="rounded-lg border border-border bg-background p-3">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Icon className="h-4 w-4 text-primary/70" />
                  {label}
                </span>
                {busy === key ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      current.mode === "ALL" ? TONE.allow : current.mode === "INHERIT" ? TONE.inherit : "bg-primary/10 text-primary"
                    }`}
                  >
                    {current.mode === "INHERIT"
                      ? "Department"
                      : current.mode === "ALL"
                        ? "All"
                        : current.mode === "OWN"
                          ? "Theirs"
                          : `${current.values.length} chosen`}
                  </span>
                )}
              </div>

              <div
                className="mb-2 grid gap-1 rounded-md bg-muted p-1"
                style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}
              >
                {modes.map(({ m, t }) => {
                  const active = !editing && current.mode === m;
                  return (
                    <button
                      key={m}
                      disabled={busy === key}
                      onClick={() =>
                        m === "LIST"
                          ? setDraft({ dimension: key, values: current.mode === "LIST" ? current.values : [] })
                          : save(key, m, [])
                      }
                      className={`truncate rounded px-1.5 py-1 text-xs font-medium transition disabled:opacity-30 ${
                        active || (editing && m === "LIST")
                          ? "bg-background font-semibold text-primary shadow-sm"
                          : "text-muted-foreground hover:text-primary"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              {current.mode === "INHERIT" && !editing && (
                <p className="text-xs text-muted-foreground">
                  {deptLabel ? (
                    <>
                      Follows <strong className="text-foreground">{deptLabel}</strong>:{" "}
                      {summary(inherited ?? { mode: "ALL", values: [] }, options)}
                    </>
                  ) : (
                    "Not in a department — no limit."
                  )}
                </p>
              )}

              {current.mode === "OWN" && !editing && (
                <p className="text-xs text-muted-foreground">
                  {key === "customer"
                    ? `${options.filter((o) => o.owned).length} account(s) are assigned to them`
                    : "Derived from the accounts assigned to them"}
                </p>
              )}

              {current.mode === "ALL" && !editing && (
                <p className="text-xs text-muted-foreground">
                  No limit — every {one} is visible
                  {isUser && deptLabel ? `, even if ${deptLabel} is limited` : ""}.
                </p>
              )}

              {(current.mode === "LIST" || editing) && (
                <div className="space-y-2">
                  <Input
                    value={editing ? find : ""}
                    onChange={(e) => {
                      if (!editing) setDraft({ dimension: key, values: current.values });
                      setFind(e.target.value);
                    }}
                    placeholder={`Find a ${one}…`}
                    className="h-8 text-xs"
                  />
                  <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
                    {visible.length === 0 && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nothing found.</p>
                    )}
                    {visible.map((o) => {
                      const on = chosen.includes(o.value);
                      return (
                        <label
                          key={o.value}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-primary/[0.04]"
                        >
                          <Checkbox
                            checked={on}
                            onCheckedChange={(v) =>
                              setDraft({
                                dimension: key,
                                values: v ? [...chosen, o.value] : chosen.filter((x) => x !== o.value),
                              })
                            }
                          />
                          <span className="truncate">{o.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  {editing && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 flex-1 text-xs"
                        disabled={busy === key || draft.values.length === 0}
                        onClick={() => save(key, "LIST", draft.values)}
                      >
                        Save {draft.values.length || ""}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 bg-background text-xs"
                        onClick={() => {
                          setDraft(null);
                          setFind("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
