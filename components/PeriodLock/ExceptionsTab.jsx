"use client";
import { roleLabel } from "@/lib/auth/roleNames";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SearchableSelect from "@/components/ui/searchable-select";
import {
  KeyRound, Loader2, UserCheck, Ban, Clock, FileText, AlertTriangle, CalendarRange, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { documentsSummary, LOCK_ACTIONS } from "@/lib/periodLockCatalog";
import { CHIP } from "@/components/Material/shared/LabUI";
import {
  BRAND, WARN_BTN, Chip, Pill, Panel, FormCard, Segmented, EmptyState, ListSkeleton, DocumentPicker,
  datePresets, fmtSpan, fmtStamp, fmtRelative, who, plural, sendJson,
} from "./shared";

const EXPIRY = [
  { key: "2h", label: "2 hours" },
  { key: "eod", label: "End of today" },
  { key: "24h", label: "24 hours" },
  { key: "3d", label: "3 days" },
  { key: "7d", label: "7 days" },
  { key: "custom", label: "Custom" },
  { key: "none", label: "Until revoked" },
];

function expiryFor(key, custom) {
  const now = new Date();
  const h = (n) => new Date(now.getTime() + n * 3600e3);
  switch (key) {
    case "2h": return h(2);
    case "24h": return h(24);
    case "3d": return h(72);
    case "7d": return h(168);
    case "eod": { const d = new Date(now); d.setHours(23, 59, 59, 0); return d; }
    case "custom": return custom ? new Date(custom) : null;
    default: return null;
  }
}

const actionsText = (e) => LOCK_ACTIONS.filter((a) => e[a.field]).map((a) => a.label).join(" · ");

export default function ExceptionsTab({ busyKey, setBusyKey, ask, onChanged }) {
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");

  const [userId, setUserId] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [codes, setCodes] = useState([]);
  const [actions, setActions] = useState({ can_create: true, can_update: true, can_delete: false });
  const [expiry, setExpiry] = useState("eod");
  const [customExpiry, setCustomExpiry] = useState("");
  const [overrideMonth, setOverrideMonth] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ex, us] = await Promise.all([
        fetch("/api/period-lock/exceptions").then((r) => r.json()),
        fetch("/api/period-lock/users").then((r) => r.json()),
      ]);
      if (Array.isArray(ex)) setRows(ex); else toast.error(ex.error || "Failed to load exceptions");
      if (Array.isArray(us)) setUsers(us);
    } catch { toast.error("Server error"); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: `${u.name || u.email} · ${roleLabel(u.role)}` })),
    [users],
  );
  const counts = useMemo(() => ({
    active: rows.filter((r) => r.status === "active").length,
    expired: rows.filter((r) => r.status === "expired").length,
    revoked: rows.filter((r) => r.status === "revoked").length,
  }), [rows]);
  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const anyAction = actions.can_create || actions.can_update || actions.can_delete;
  const expiresAt = expiryFor(expiry, customExpiry);
  const expiryValid = expiry === "none" || (expiresAt && expiresAt > new Date());
  const valid = userId && dateFrom && dateTo && dateFrom <= dateTo && anyAction && reason.trim() && expiryValid;
  const busy = busyKey !== null;
  const selectedUser = users.find((u) => u.id === userId);

  const submit = (e) => {
    e.preventDefault();
    if (!valid) { toast.error("Fill in user, dates, at least one action, expiry and reason"); return; }
    const name = selectedUser?.name || selectedUser?.email || "this user";
    ask({
      title: `Grant ${name} access?`,
      body: [
        `${actionsText(actions)} on ${documentsSummary(codes)}.`,
        `Dated ${fmtSpan(dateFrom, dateTo)}${overrideMonth ? ", including closed months" : " (date-range locks only)"}.`,
        expiry === "none" ? "Stays open until you revoke it." : `Expires ${fmtStamp(expiresAt)} (${fmtRelative(expiresAt)}).`,
        "Every entry they make under it is recorded in Activity.",
      ],
      action: "Grant access",
      run: async () => {
        setBusyKey("new-exception");
        try {
          await sendJson("/api/period-lock/exceptions", "POST", {
            user_id: userId, date_from: dateFrom, date_to: dateTo, tran_codes: codes,
            ...actions, override_month_lock: overrideMonth,
            expires_at: expiry === "none" ? null : expiryFor(expiry, customExpiry).toISOString(),
            reason,
          });
          toast.success(`Access granted to ${name}`);
          setUserId(null); setDateFrom(""); setDateTo(""); setCodes([]); setReason("");
          setOverrideMonth(false); setExpiry("eod"); setFilter("active");
          load(); onChanged?.();
        } catch (err) { toast.error(err.message); } finally { setBusyKey(null); }
      },
    });
  };

  const revoke = (r) => ask({
    title: `Revoke ${r.user_name}'s access?`,
    body: [
      `${fmtSpan(r.date_from, r.date_to)} · ${documentsSummary(r.tran_codes)}.`,
      `They used it ${plural(r.use_count, "time")}. The record stays in history.`,
    ],
    action: "Revoke",
    tone: "warn",
    run: async () => {
      setBusyKey(`x-${r.id}`);
      try {
        await sendJson(`/api/period-lock/exceptions/${r.id}`, "PATCH", { action: "revoke" });
        toast.success(`Revoked ${r.user_name}'s access`);
        load(); onChanged?.();
      } catch (err) { toast.error(err.message); } finally { setBusyKey(null); }
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5 items-start">
      <FormCard onSubmit={submit} icon={KeyRound} title="Grant temporary access" subtitle="Let one person work inside locked dates without unlocking them for everyone." footer={(
        <Button type="submit" className={`w-full h-10 ${BRAND}`} disabled={busy || !valid}>
          {busyKey === "new-exception" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserCheck className="h-4 w-4 mr-1.5" />}
          Grant access
        </Button>
      )}>
        <div className="space-y-1.5">
          <Label className="text-xs">User</Label>
          <SearchableSelect value={userId} onChange={(v) => setUserId(v)} options={userOptions}
            placeholder={loading && !users.length ? "Loading users…" : "Search a user…"} ariaLabel="User" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Dates they may work in</Label>
          <div className="flex flex-wrap gap-1.5">
            {datePresets().map((p) => (
              <Chip key={p.label} on={dateFrom === p.from && dateTo === p.to}
                onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}>{p.label}</Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Input type="date" aria-label="From" value={dateFrom} className="h-10"
              onChange={(e) => { setDateFrom(e.target.value); if (dateTo && e.target.value > dateTo) setDateTo(e.target.value); }} />
            <Input type="date" aria-label="To" value={dateTo} min={dateFrom || undefined} className="h-10"
              onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Allowed actions</Label>
          <div className="grid grid-cols-3 gap-2">
            {LOCK_ACTIONS.map((a) => (
              <button key={a.key} type="button" aria-pressed={actions[a.field]}
                onClick={() => setActions((s) => ({ ...s, [a.field]: !s[a.field] }))}
                className={`h-10 rounded-lg text-sm font-medium ring-1 ring-inset transition-colors ${
                  actions[a.field] ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border hover:bg-muted/50"
                }`}>
                {a.label}
              </button>
            ))}
          </div>
          {!anyAction && <p className="text-xs text-destructive">Choose at least one action.</p>}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Documents</Label>
          <DocumentPicker value={codes} onChange={setCodes} />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Access expires</Label>
          <div className="flex flex-wrap gap-1.5">
            {EXPIRY.map((x) => <Chip key={x.key} on={expiry === x.key} onClick={() => setExpiry(x.key)}>{x.label}</Chip>)}
          </div>
          {expiry === "custom" && (
            <Input type="datetime-local" value={customExpiry} className="h-10 mt-1" onChange={(e) => setCustomExpiry(e.target.value)} />
          )}
          {expiry !== "none" && expiresAt && (
            <p className={`text-xs ${expiryValid ? "text-muted-foreground" : "text-destructive"}`}>
              {expiryValid ? `Until ${fmtStamp(expiresAt)} (${fmtRelative(expiresAt)})` : "Expiry must be in the future"}
            </p>
          )}
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={overrideMonth} onChange={(e) => setOverrideMonth(e.target.checked)} />
          <span className="text-sm">
            <span className="font-medium text-foreground">Also allow inside closed months</span>
            <span className="block text-xs text-muted-foreground">Without this, only date-range locks are opened.</span>
            {overrideMonth && (
              <span className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400 mt-1">
                <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                Stock changes in a closed month make next month&apos;s opening stock stale — lock that month again afterwards to rebuild it.
              </span>
            )}
          </span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="ex-reason" className="text-xs">Reason <span className="text-destructive">*</span></Label>
          <Textarea id="ex-reason" rows={2} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Correct GRN #1234 rate approved by CFO" />
        </div>
      </FormCard>

      <Panel
        title="Exceptions" icon={KeyRound}
        actions={<Segmented value={filter} onChange={setFilter} options={[
          ["active", `Active (${counts.active})`], ["expired", `Expired (${counts.expired})`],
          ["revoked", `Revoked (${counts.revoked})`], ["all", "All"],
        ]} />}
      >
        {loading && !rows.length ? <ListSkeleton /> : visible.length === 0 ? (
          <EmptyState icon={KeyRound}
            title={filter === "active" ? "No active exceptions" : "Nothing here"}
            hint="Locked dates apply to everyone until you grant someone access." />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id} className={`px-4 py-3.5 flex flex-col sm:flex-row sm:items-start gap-3 ${r.status === "active" ? "" : "bg-muted/30"}`}>
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`mt-0.5 h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold ${
                    r.status === "active" ? CHIP.brand : CHIP.muted}`}>
                    {(r.user_name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-semibold ${r.status === "active" ? "text-foreground" : "text-muted-foreground"}`}>{r.user_name}</span>
                      <Pill kind={r.status} />
                      {r.override_month_lock && <Pill kind="locked">Closed months</Pill>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {LOCK_ACTIONS.filter((a) => r[a.field]).map((a) => (
                        <span key={a.key} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">{a.label}</span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <CalendarRange className="h-3.5 w-3.5 mt-px shrink-0 text-muted-foreground/80" />{fmtSpan(r.date_from, r.date_to)}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <FileText className="h-3.5 w-3.5 mt-px shrink-0 text-muted-foreground/80" /><span className="break-words">{documentsSummary(r.tran_codes)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground break-words">{r.reason}</p>
                    <p className="text-xs text-muted-foreground/80 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />
                        {r.status === "revoked" ? `Revoked by ${who(r.revoked_by)} · ${fmtStamp(r.revoked_at)}`
                          : r.expires_at ? `${r.status === "expired" ? "Expired" : "Expires"} ${fmtRelative(r.expires_at)}`
                            : "Until revoked"}
                      </span>
                      <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" />
                        Used {plural(r.use_count, "time")}{r.last_used_at ? ` · last ${fmtRelative(r.last_used_at)}` : ""}
                      </span>
                      <span>Granted by {who(r.granted_by)} · {fmtStamp(r.granted_at)}</span>
                    </p>
                  </div>
                </div>
                {r.status === "active" && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => revoke(r)}
                    className={`h-9 w-full sm:w-auto shrink-0 ${WARN_BTN}`}>
                    {busyKey === `x-${r.id}` ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Ban className="h-4 w-4 mr-1.5" />}
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
