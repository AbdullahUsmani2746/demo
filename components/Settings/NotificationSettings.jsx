"use client";
import { roleLabel } from "@/lib/auth/roleNames";
import { useRoles } from "@/hooks/useRoles";
// Admin → Notifications (also the Notifications tab of Settings)
// Three views over the same data:
//   Events & texts → one card per event: on/off, notify the doer, who receives
//              it and the text sent; click the text to write your own wording
//              (NotificationTexts.jsx — ADMIN only)
//   Role grid → matrix of events × roles, plus global on/off and "notify creator"
//   By User  → pick a user, see every event with its effective state and set
//              a per-user override (Inherit from role / Always / Never)
//   Alerts   → notifications the admin defines without code: any table,
//              conditions, recipients, text (NotificationAlerts.jsx)
// Every toggle saves immediately; the cache is patched optimistically and
// rolled back on failure.

import React, { useMemo, useState } from "react";
import axios from "axios";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ReactSelect from "react-select";
import {
  Bell,
  BellOff,
  Search,
  Users,
  LayoutGrid,
  RotateCcw,
  UserCog,
  ShieldCheck,
  Loader2,
  Info,
  AlertTriangle,
  MessageSquareText,
  Zap,
} from "lucide-react";
import { EventOverview, TemplateSheet } from "@/components/Settings/NotificationTexts";
import NotificationAlerts from "@/components/Settings/NotificationAlerts";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const QUERY_KEY = ["notification-settings"];

// Role names: the catalogue (Admin → Roles), lib/auth/roleNames.js.

const userLabel = (u) => u.name || u.username || u.email;

/** Effective delivery state for one user on one event. */
function effectiveState(event, user) {
  if (!event.is_active) return { state: "off", reason: "Event switched off" };
  const override = event.users.find((x) => x.user_id === user.id);
  if (override?.state === "never") return { state: "never", reason: "Muted for this user" };
  if (override?.state === "always") return { state: "always", reason: "Always sent to this user" };
  if (event.roles.includes(user.role))
    return { state: "role", reason: `Via ${roleLabel(user.role)} role` };
  return { state: "none", reason: "Not subscribed" };
}

const STATE_STYLE = {
  role: "bg-[#edf2ee] text-[#2f5139]",
  always: "bg-primary/10 text-primary",
  never: "bg-destructive/10 text-destructive",
  none: "bg-muted text-muted-foreground",
  off: "bg-muted text-muted-foreground/70",
};
const STATE_TEXT = {
  role: "Receives (role)",
  always: "Receives (always)",
  never: "Muted",
  none: "Not receiving",
  off: "Event off",
};

const VIEWS = [
  { key: "overview", label: "Events & texts", icon: MessageSquareText },
  { key: "events", label: "Role grid", icon: LayoutGrid },
  { key: "users", label: "By User", icon: Users },
  { key: "alerts", label: "Alerts", icon: Zap },
];

// Category card header shared by the role grid and the user view.
const CardHead = ({ children, right }) => (
  <div className="flex items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
    <h3 className="text-[15px] font-semibold text-primary">{children}</h3>
    {right}
  </div>
);

// hideTitle: the page around it already shows the title (Admin → Notifications).
export default function NotificationSettings({ hideTitle = false } = {}) {
  useRoles(); // role names
  const queryClient = useQueryClient();
  const [view, setView] = useState("overview");
  const [textEventCode, setTextEventCode] = useState(null);
  const [search, setSearch] = useState("");
  const [userDialogEvent, setUserDialogEvent] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await axios.get("/api/notifications/settings")).data,
    staleTime: 60 * 1000,
  });

  // One mutation for every change. `patch(events)` applies the optimistic
  // update to the cached event list; the server is the source of truth after.
  const mutation = useMutation({
    mutationFn: async ({ body }) => (await axios.put("/api/notifications/settings", body)).data,
    onMutate: async ({ patch }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData(QUERY_KEY);
      if (previous && patch) {
        queryClient.setQueryData(QUERY_KEY, { ...previous, events: patch(previous.events) });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(QUERY_KEY, ctx.previous);
      toast.error(err.response?.data?.error || "Could not save notification setting");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const save = (body, patch) => mutation.mutate({ body, patch });

  // ── change helpers ────────────────────────────────────────────────────────
  const updateEvent = (code, fields) =>
    save({ action: "event", code, ...fields }, (events) =>
      events.map((e) => (e.code === code ? { ...e, ...fields } : e)),
    );

  const toggleRole = (code, role, enabled) =>
    save({ action: "roleRule", event_code: code, role, enabled }, (events) =>
      events.map((e) =>
        e.code !== code
          ? e
          : { ...e, roles: enabled ? [...new Set([...e.roles, role])] : e.roles.filter((r) => r !== role) },
      ),
    );

  const setUserState = (code, user_id, state) =>
    save({ action: "userRule", event_code: code, user_id, state }, (events) =>
      events.map((e) => {
        if (e.code !== code) return e;
        const users = e.users.filter((u) => u.user_id !== user_id);
        if (state !== "inherit") users.push({ user_id, state });
        return { ...e, users };
      }),
    );

  const resetEvent = (code) => save({ action: "reset", code }, null);

  // Texts are saved from the side sheet, not optimistically: the server
  // validates them and may refuse (not ADMIN, SQL not run yet).
  const templateMutation = useMutation({
    mutationFn: async ({ code, title, message }) =>
      (await axios.put("/api/notifications/settings", {
        action: "template",
        code,
        title_template: title,
        message_template: message,
      })).data,
    onSuccess: (_d, { reset }) => {
      toast.success(reset ? "Back to the system's own text" : "Notification text saved");
      setTextEventCode(null);
    },
    onError: (err) => toast.error(err.response?.data?.error || "Could not save the notification text"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const saveTemplate = (code, title, message, opts = {}) =>
    templateMutation.mutate({ code, title, message, reset: !!opts.reset });

  // ── derived ───────────────────────────────────────────────────────────────
  const events = data?.events || [];
  const roles = data?.roles || [];
  const users = data?.users || [];

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q),
    );
  }, [events, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const e of filteredEvents) {
      if (!map.has(e.category)) map.set(e.category, []);
      map.get(e.category).push(e);
    }
    return [...map.entries()];
  }, [filteredEvents]);

  const selectedUser = users.find((u) => u.id === selectedUserId) || null;
  const textEvent = events.find((e) => e.code === textEventCode) || null;
  const customCount = events.filter((e) => e.title_template || e.message_template).length;
  const activeCount = events.filter((e) => e.is_active).length;
  const overrideCount = events.reduce((n, e) => n + e.users.length, 0);

  // User picker: same id value the old dropdown handed to setSelectedUserId.
  const userOptions = users.map((u) => ({
    value: u.id,
    label: `${userLabel(u)} · ${roleLabel(u.role)}`,
  }));

  // ── render ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading notification settings…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-6 text-center text-sm font-medium text-destructive">
        {error.response?.status === 403
          ? "Only administrators can manage notification settings."
          : "Failed to load notification settings."}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className={hideTitle ? "hidden" : "flex min-w-0 items-start gap-3"}>
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <Bell className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Notifications</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
              What raises a notification, who receives it and what it says. A user receives a
              notification when their role is ticked, or when they are set to <b>Always</b>.{" "}
              <b>Never</b> mutes a user even if their role is ticked. Click a text to write your own wording.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#edf2ee] px-2.5 py-1 font-semibold text-[#2f5139]">
            <ShieldCheck className="h-3.5 w-3.5" /> {activeCount}/{events.length} events on
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
            <UserCog className="h-3.5 w-3.5" /> {overrideCount} user overrides
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5" /> {customCount} custom texts
          </span>
        </div>
      </div>

      {data?.canEditTemplates && data?.templatesReady === false && (
        <div className="flex gap-2 rounded-lg bg-[#f5f0e6] px-4 py-3 text-sm text-[#5f4b1f]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Custom notification texts need two new database columns. Run{" "}
            <code className="rounded bg-background/70 px-1 text-xs">{data.templateSqlFile}</code>{" "}
            once; until then every notification keeps the system&apos;s own wording and the rest of this page
            works as usual.
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-muted/40 p-1">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
                view === key
                  ? "bg-primary font-medium text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {view !== "alerts" && (
        <div className="relative min-w-0 flex-1 basis-[200px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events…"
            className="h-10 pl-9"
          />
        </div>
        )}

        {view === "users" && (
          <div className="w-full sm:w-72">
            <ReactSelect
              inputId="notif-user"
              aria-label="Choose a user"
              options={userOptions}
              value={userOptions.find((o) => o.value === selectedUserId) || null}
              onChange={(opt) => setSelectedUserId(opt ? opt.value : "")}
              placeholder="Choose a user…"
              noOptionsMessage={() => "Nothing found"}
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              menuPlacement="auto"
              styles={selectStyles(false)}
            />
          </div>
        )}

        {mutation.isPending && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </span>
        )}
      </div>

      {view === "alerts" ? (
        <NotificationAlerts />
      ) : view === "overview" ? (
        <EventOverview
          grouped={grouped}
          roleLabel={roleLabel}
          onToggleActive={(e, v) => updateEvent(e.code, { is_active: v })}
          onToggleActor={(e, v) => updateEvent(e.code, { notify_actor: v })}
          onOpenUsers={setUserDialogEvent}
          onEditText={(e) => setTextEventCode(e.code)}
        />
      ) : view === "events" ? (
        <EventMatrix
          grouped={grouped}
          roles={roles}
          users={users}
          onToggleActive={(e, v) => updateEvent(e.code, { is_active: v })}
          onToggleActor={(e, v) => updateEvent(e.code, { notify_actor: v })}
          onToggleRole={toggleRole}
          onOpenUsers={setUserDialogEvent}
          onReset={resetEvent}
        />
      ) : (
        <UserView
          grouped={grouped}
          user={selectedUser}
          onSetState={setUserState}
        />
      )}

      <TemplateSheet
        event={textEvent}
        open={!!textEvent}
        onOpenChange={(o) => !o && setTextEventCode(null)}
        meta={data || {}}
        onSave={saveTemplate}
        saving={templateMutation.isPending}
      />

      {/* Per-event user override dialog */}
      <Dialog open={!!userDialogEvent} onOpenChange={(o) => !o && setUserDialogEvent(null)}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-4 sm:max-w-2xl sm:p-6">
          {userDialogEvent && (
            <UserOverrideDialog
              event={events.find((e) => e.code === userDialogEvent.code) || userDialogEvent}
              users={users}
              onSetState={setUserState}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── By Event ────────────────────────────────────────────────────────────────
function EventMatrix({ grouped, roles, users, onToggleActive, onToggleActor, onToggleRole, onOpenUsers, onReset }) {
  if (grouped.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No events match your search.</p>;
  }
  const TH = "px-2 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground whitespace-nowrap";
  return (
    <div className="space-y-5">
      {grouped.map(([category, events]) => (
        <div key={category} className="overflow-hidden rounded-xl border border-border bg-background">
          <CardHead>{category}</CardHead>
          {/* Phone: one card per event */}
          <ul className="divide-y divide-border/60 md:hidden">
            {events.map((e) => (
              <li key={e.code} className={`space-y-3 px-4 py-3 ${e.is_active ? "" : "opacity-50"}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{e.label}</div>
                    {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-primary/70 hover:bg-primary/10 hover:text-primary"
                    title="Restore defaults for this event"
                    aria-label="Restore defaults for this event"
                    onClick={() => onReset(e.code)}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <span>On</span>
                    <Switch checked={e.is_active} onCheckedChange={(v) => onToggleActive(e, v)} />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2" title="Also notify the user who performed the action">
                    <span>Creator</span>
                    <Switch checked={e.notify_actor} disabled={!e.is_active} onCheckedChange={(v) => onToggleActor(e, v)} />
                  </label>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">Roles that receive it</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {roles.map((r) => (
                      <label key={r} className="flex min-w-0 items-center gap-2 text-sm">
                        <Checkbox
                          checked={e.roles.includes(r)}
                          disabled={!e.is_active}
                          onCheckedChange={(v) => onToggleRole(e.code, r, v === true)}
                        />
                        <span className="truncate">{roleLabel(r)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-full gap-1.5 bg-background text-xs"
                  disabled={!e.is_active}
                  onClick={() => onOpenUsers(e)}
                >
                  <UserCog className="h-3.5 w-3.5" />
                  {e.users.length > 0 ? `${e.users.length} user override${e.users.length === 1 ? "" : "s"}` : "Per-user overrides"}
                </Button>
              </li>
            ))}
          </ul>

          {/* Wider screens: the role grid */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary">
                  <th className={`${TH} min-w-[260px] px-4 text-left`}>Event</th>
                  <th className={TH}>On</th>
                  <th className={TH} title="Also notify the user who performed the action">
                    Creator
                  </th>
                  {roles.map((r) => (
                    <th key={r} className={TH}>
                      {roleLabel(r)}
                    </th>
                  ))}
                  <th className={TH}>Users</th>
                  <th className={TH}>
                    <span className="sr-only">Reset</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.code}
                    className={`border-b border-border/60 last:border-0 hover:bg-primary/[0.03] ${e.is_active ? "" : "opacity-50"}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{e.label}</div>
                      {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
                    </td>
                    <td className="px-2 text-center">
                      <Switch checked={e.is_active} onCheckedChange={(v) => onToggleActive(e, v)} />
                    </td>
                    <td className="px-2 text-center">
                      <Switch
                        checked={e.notify_actor}
                        disabled={!e.is_active}
                        onCheckedChange={(v) => onToggleActor(e, v)}
                      />
                    </td>
                    {roles.map((r) => (
                      <td key={r} className="px-2 text-center">
                        <Checkbox
                          checked={e.roles.includes(r)}
                          disabled={!e.is_active}
                          onCheckedChange={(v) => onToggleRole(e.code, r, v === true)}
                          aria-label={`${roleLabel(r)} receives ${e.label}`}
                        />
                      </td>
                    ))}
                    <td className="px-2 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 bg-background px-2 text-xs"
                        disabled={!e.is_active}
                        onClick={() => onOpenUsers(e)}
                      >
                        <UserCog className="h-3.5 w-3.5" />
                        {e.users.length > 0 ? e.users.length : "—"}
                      </Button>
                    </td>
                    <td className="px-2 text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-primary/70 hover:bg-primary/10 hover:text-primary"
                        title="Restore defaults for this event"
                        aria-label="Restore defaults for this event"
                        onClick={() => onReset(e.code)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Per-user tri-state control ──────────────────────────────────────────────
function StateControl({ value, onChange, disabled }) {
  const options = [
    { v: "inherit", label: "Role default" },
    { v: "always", label: "Always" },
    { v: "never", label: "Never" },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`px-2.5 py-1 transition disabled:opacity-40 ${
            value === o.v
              ? o.v === "never"
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-primary/10 hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Effective-state chip (By User view and the per-event dialog).
function StateChip({ eff, withIcon }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_STYLE[eff.state]}`}
      title={eff.reason}
    >
      {withIcon &&
        (eff.state === "never" || eff.state === "none" || eff.state === "off" ? (
          <BellOff className="h-3 w-3" />
        ) : (
          <Bell className="h-3 w-3" />
        ))}
      {STATE_TEXT[eff.state]}
    </span>
  );
}

// ─── By User ─────────────────────────────────────────────────────────────────
function UserView({ grouped, user, onSetState }) {
  if (!user) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border py-16 text-center text-sm text-muted-foreground">
        <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        Choose a user above to see and change what they receive.
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm">
        <Info className="h-4 w-4 shrink-0 text-primary" />
        <span>
          <b>{userLabel(user)}</b> is a <b>{roleLabel(user.role)}</b>. "Role default"
          follows the role ticks on the By Event tab; "Always" / "Never" override them for this user only.
        </span>
      </div>

      {grouped.map(([category, events]) => (
        <div key={category} className="overflow-hidden rounded-xl border border-border bg-background">
          <CardHead>{category}</CardHead>
          <ul className="divide-y divide-border/60 text-sm">
            {events.map((e) => {
              const eff = effectiveState(e, user);
              const override = e.users.find((x) => x.user_id === user.id)?.state || "inherit";
              return (
                <li
                  key={e.code}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 hover:bg-primary/[0.03]"
                >
                  <div className="min-w-0 flex-1 basis-[200px]">
                    <div className="font-medium text-foreground">{e.label}</div>
                    {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
                  </div>
                  <StateChip eff={eff} withIcon />
                  <StateControl
                    value={override}
                    disabled={!e.is_active}
                    onChange={(s) => onSetState(e.code, user.id, s)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── Per-event user dialog ───────────────────────────────────────────────────
function UserOverrideDialog({ event, users, onSetState }) {
  const [q, setQ] = useState("");
  const list = users.filter((u) => {
    const s = q.trim().toLowerCase();
    return !s || userLabel(u).toLowerCase().includes(s) || (u.email || "").toLowerCase().includes(s);
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-primary">
          <UserCog className="h-5 w-5" /> {event.label}
        </DialogTitle>
        <DialogDescription>
          Per-user overrides for this event. Roles currently subscribed:{" "}
          {event.roles.length ? event.roles.map((r) => roleLabel(r)).join(", ") : "none"}.
        </DialogDescription>
      </DialogHeader>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users…" className="h-10 pl-9" />
      </div>

      <ul className="-mx-4 flex-1 divide-y divide-border/60 overflow-y-auto px-4 text-sm sm:-mx-6 sm:px-6">
        {list.map((u) => {
          const eff = effectiveState(event, u);
          const override = event.users.find((x) => x.user_id === u.id)?.state || "inherit";
          return (
            <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1 basis-[160px]">
                <div className="font-medium text-foreground">{userLabel(u)}</div>
                <div className="break-all text-xs text-muted-foreground">
                  {roleLabel(u.role)} · {u.email}
                </div>
              </div>
              <StateChip eff={eff} />
              <StateControl value={override} onChange={(s) => onSetState(event.code, u.id, s)} />
            </li>
          );
        })}
        {list.length === 0 && <li className="py-8 text-center text-muted-foreground">No users match.</li>}
      </ul>
    </>
  );
}
