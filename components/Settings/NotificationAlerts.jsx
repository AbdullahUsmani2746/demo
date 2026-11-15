"use client";
// components/Settings/NotificationAlerts.jsx — the "Alerts" tab of Admin →
// Notifications: notifications the admin defines without code ("when Vouchers
// are created and Amount is more than 500000 → tell Accountant").
// The engine is lib/notifications/alerts.js; every audited write is checked.
//
//   GET    /api/notifications/alerts          list (+ ready=false before the SQL is run)
//   POST   /api/notifications/alerts          create  ·  { preview:true } = test
//   PUT    /api/notifications/alerts/[id]     full body, or { is_active }
//   DELETE /api/notifications/alerts/[id]
//   GET    /api/audit/meta                    tables, fields, users, departments, roles
import React, { useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Copy, Loader2, PencilLine, Plus, Search, Sparkles, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { TypeIcon, fullTime, relativeTime, typeMeta } from "@/components/Notifications/notificationUi";
import AlertBuilder from "./AlertBuilder";
import { ALERT_TEMPLATES, describeAlert, emptyAlert, toForm } from "./alertShared";

const ALERTS_KEY = ["notification-alerts"];

export default function NotificationAlerts() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [builder, setBuilder] = useState(null); // { id?, form }
  const [toDelete, setToDelete] = useState(null);

  const alertsQ = useQuery({
    queryKey: ALERTS_KEY,
    queryFn: async () => (await axios.get("/api/notifications/alerts")).data,
    staleTime: 30_000,
  });
  const metaQ = useQuery({
    queryKey: ["audit-meta"],
    queryFn: async () => (await axios.get("/api/audit/meta")).data,
    staleTime: 5 * 60_000,
  });
  const meta = metaQ.data;
  const alerts = useMemo(() => alertsQ.data?.alerts || [], [alertsQ.data]);
  const ready = alertsQ.data?.ready !== false;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return alerts;
    return alerts.filter((a) => {
      const d = describeAlert(a, meta);
      return `${a.name} ${a.description || ""} ${d.when} ${d.who}`.toLowerCase().includes(s);
    });
  }, [alerts, q, meta]);

  // ── writes ────────────────────────────────────────────────────────────────
  const toggle = useMutation({
    mutationFn: async ({ id, is_active }) => (await axios.put(`/api/notifications/alerts/${id}`, { is_active })).data,
    onMutate: async ({ id, is_active }) => {
      await queryClient.cancelQueries({ queryKey: ALERTS_KEY });
      const previous = queryClient.getQueryData(ALERTS_KEY);
      queryClient.setQueryData(ALERTS_KEY, (old) => old && { ...old, alerts: old.alerts.map((a) => (a.id === id ? { ...a, is_active } : a)) });
      return { previous };
    },
    onSuccess: (d) => toast.success(d?.message || "Saved"),
    onError: (e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ALERTS_KEY, ctx.previous);
      toast.error(e.response?.data?.error || "Could not change the alert");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  });

  const save = useMutation({
    mutationFn: async ({ id, body }) =>
      (id ? await axios.put(`/api/notifications/alerts/${id}`, body) : await axios.post("/api/notifications/alerts", body)).data,
    onSuccess: (d) => {
      toast.success(d?.message || "Alert saved");
      setBuilder(null);
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
  });

  const remove = useMutation({
    mutationFn: async (id) => (await axios.delete(`/api/notifications/alerts/${id}`)).data,
    onSuccess: (d) => {
      toast.success(d?.message || "Alert deleted");
      setToDelete(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || "Could not delete the alert"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  });

  const openNew = (template) => setBuilder({ form: toForm(template ? { ...emptyAlert(), ...template.alert } : emptyAlert()) });
  const openEdit = (a) => setBuilder({ id: a.id, form: toForm(a) });
  const openCopy = (a) => {
    const { id: _id, created_at: _c, last_fired_at: _l, fire_count: _f, ...rest } = a;
    setBuilder({ form: toForm({ ...rest, name: `Copy of ${a.name}`.slice(0, 150), is_active: false }) });
  };

  // ── render ────────────────────────────────────────────────────────────────
  if (alertsQ.isLoading || metaQ.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-busy="true" aria-label="Loading alerts">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
    );
  }
  if (alertsQ.error || metaQ.error) {
    const e = alertsQ.error || metaQ.error;
    return (
      <div className="rounded-xl bg-destructive/10 px-4 py-6 text-center text-sm font-medium text-destructive">
        {e.response?.status === 403 ? "You need the right to manage notifications to see alerts." : e.response?.data?.error || "Could not load the alerts."}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!ready && (
        <div className="flex gap-2 rounded-xl bg-[#f5f0e6] px-4 py-3 text-sm text-[#5f4b1f]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Alerts need their database table. Run{" "}
            <code className="rounded bg-background/70 px-1 text-xs">prisma/sql/2026-11-07_audit_trail.sql</code> once (with the owner&apos;s approval);
            until then no alert can be saved or sent.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">
            Your own notifications, no code needed: pick a table, the conditions, who is told and the text. Every change saved
            anywhere in the system is checked against the alerts that are on.
          </p>
        </div>
        <Button className="h-10 gap-1.5 sm:shrink-0" onClick={() => openNew()} disabled={!ready}>
          <Plus className="h-4 w-4" /> New alert
        </Button>
      </div>

      {/* Ready-made templates */}
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex items-center gap-1.5 border-b border-primary/15 bg-primary/5 px-4 py-3 text-[15px] font-semibold text-primary">
          <Sparkles className="h-4 w-4" /> Start from a template
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALERT_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={!ready}
              onClick={() => openNew(t)}
              className="group flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-primary/[0.03] disabled:opacity-50"
            >
              <TypeIcon type={t.alert.type} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{t.label}</span>
                <span className="block text-xs text-muted-foreground">{t.hint}</span>
              </span>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:text-primary" />
            </button>
          ))}
        </div>
      </div>

      {alerts.length > 3 && (
        <div className="relative sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search alerts…" aria-label="Search alerts" className="h-10 pl-9" />
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border-2 border-dashed border-border px-6 py-12 text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-lg bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <Zap className="h-5 w-5" />
          </span>
          <p className="font-semibold text-foreground">No alerts yet</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Create one, or start from a template above — they only fill in the form; nothing is saved until you press Save.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No alert matches “{q}”.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              meta={meta}
              onToggle={(v) => toggle.mutate({ id: a.id, is_active: v })}
              onEdit={() => openEdit(a)}
              onCopy={() => openCopy(a)}
              onDelete={() => setToDelete(a)}
            />
          ))}
        </ul>
      )}

      <AlertBuilder
        open={!!builder}
        onOpenChange={(o) => !o && !save.isPending && setBuilder(null)}
        initial={builder?.form || null}
        editingId={builder?.id || null}
        meta={meta}
        saving={save.isPending}
        onSave={(body) => save.mutateAsync({ id: builder?.id, body })}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !remove.isPending && setToDelete(null)}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              No more notifications will be sent for it. Notifications already sent stay in people&apos;s inboxes. To pause it instead,
              switch it off.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-background" disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate(toDelete.id);
              }}
            >
              {remove.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AlertCard({ alert: a, meta, onToggle, onEdit, onCopy, onDelete }) {
  const t = typeMeta(a.type);
  const { when, who } = describeAlert(a, meta);
  return (
    <li className={cn("relative flex flex-col overflow-hidden rounded-xl border border-border bg-background", !a.is_active && "bg-muted/40")}>
      <span className={cn("absolute inset-y-0 left-0 w-1", a.is_active ? "bg-primary" : "bg-border")} aria-hidden="true" />
      <div className="flex items-start gap-3 p-4 pl-5">
        <TypeIcon type={a.type} size="sm" className={cn(!a.is_active && "opacity-50")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn("break-words font-semibold", a.is_active ? "text-foreground" : "text-muted-foreground")}>{a.name}</h3>
            {!a.is_active && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Off</span>}
          </div>
          {a.description && <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>}
          <p className={cn("mt-2 text-sm leading-relaxed", a.is_active ? "text-foreground/80" : "text-muted-foreground")}>
            {when} <span className="font-semibold text-primary">→</span> {who}.
          </p>
        </div>
        <Switch checked={a.is_active} onCheckedChange={onToggle} aria-label={`${a.is_active ? "Switch off" : "Switch on"} ${a.name}`} />
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-4 py-2 pl-5">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{t.label}</span>
        <span className="text-xs text-muted-foreground" title={a.last_fired_at ? fullTime(a.last_fired_at) : undefined}>
          {a.fire_count ? `Fired ${a.fire_count} time${a.fire_count === 1 ? "" : "s"} · last ${relativeTime(a.last_fired_at)}` : "Not fired yet"}
        </span>
        <div className="ml-auto flex gap-0.5">
          <IconBtn label={`Edit ${a.name}`} onClick={onEdit} icon={PencilLine} />
          <IconBtn label={`Duplicate ${a.name}`} onClick={onCopy} icon={Copy} />
          <IconBtn label={`Delete ${a.name}`} onClick={onDelete} icon={Trash2} danger />
        </div>
      </div>
    </li>
  );
}

function IconBtn({ label, onClick, icon: Icon, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label.split(" ")[0]}
      className={cn("grid h-8 w-8 place-items-center rounded-lg transition-colors", danger ? "text-destructive/70 hover:bg-destructive/10 hover:text-destructive" : "text-primary/70 hover:bg-primary/10 hover:text-primary")}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
