"use client";
import { roleLabel } from "@/lib/auth/roleNames";
import { useRoles } from "@/hooks/useRoles";
// components/permissions/ApprovalsTab.jsx — Admin → Permissions → Approvals.
// One card per approval (lib/approvals/catalog.js). For each right: pick the
// people and / or roles who hold it, Save. That grant alone decides who opens
// the approval page, who can approve / reject, who sees the menu item and who
// is notified.
import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, Loader2, Save, ShieldCheck, Users, AlertTriangle, ExternalLink, Bell, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import SearchSelect from "@/components/bi/SearchSelect";
import ApprovalRulesSection from "@/components/permissions/ApprovalRulesSection";
import HrChainsSection from "@/components/permissions/HrChainsSection";

const LABEL = "text-[11px] font-bold uppercase tracking-wider text-primary";

function RightEditor({ right, users, roles, onSaved }) {
  const [userIds, setUserIds] = useState(right.userIds);
  const [pickedRoles, setPickedRoles] = useState(right.roles);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const dirty =
    JSON.stringify([...userIds].sort()) !== JSON.stringify([...right.userIds].sort()) ||
    JSON.stringify([...pickedRoles].sort()) !== JSON.stringify([...right.roles].sort());
  const nameOf = (id) => users.find((u) => u.id === id)?.name ?? id;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await axios.put("/api/permissions/approvals", { code: right.code, userIds, roles: pickedRoles });
      setMsg({ ok: true, text: "Saved" });
      onSaved?.();
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${right.main ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
            {right.main ? <ShieldCheck className="h-4 w-4" /> : <Users className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{right.label}</div>
            <code className="block truncate font-mono text-[11px] text-muted-foreground">{right.code}</code>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${userIds.length || pickedRoles.length ? "bg-[#edf2ee] text-[#2f5139]" : "bg-muted text-muted-foreground"}`}>
          {userIds.length} person(s){pickedRoles.length ? ` · ${pickedRoles.length} role(s)` : ""}
        </span>
      </div>

      {!right.exists && (
        <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Not in the database yet — run the SQL file / <code className="font-mono">node scripts/seed-permissions.mjs --apply</code>.</span>
        </p>
      )}

      <div className="space-y-1.5">
        <span className={LABEL}>People</span>
        <SearchSelect
          multi
          width="100%"
          placeholder="Search and add people…"
          value={userIds}
          options={users.map((u) => ({ value: u.id, label: `${u.name} · ${roleLabel(u.role)}` }))}
          onChange={setUserIds}
        />
      </div>

      <div className="space-y-1.5">
        <span className={LABEL}>Whole role (everyone in it)</span>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => {
            const on = pickedRoles.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() => setPickedRoles((x) => (on ? x.filter((y) => y !== r) : [...x, r]))}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/50 hover:text-primary"
                }`}
              >
                {roleLabel(r)}
              </button>
            );
          })}
        </div>
        {pickedRoles.length > 0 && (
          <p className="text-[11px] text-destructive">
            Everyone with that role can open and act on this approval — usually pick named people instead.
          </p>
        )}
      </div>

      {right.deniedUserIds?.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <span className="mr-1 rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">Blocked personally</span>
          {right.deniedUserIds.map(nameOf).join(", ")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <Button type="button" size="sm" onClick={save} disabled={!dirty || saving || !right.exists} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </Button>
        {msg && (
          <span className={`flex items-center gap-1 text-xs ${msg.ok ? "font-semibold text-[#2f5139]" : "text-destructive"}`}>
            {msg.ok && <CheckCircle2 className="h-3.5 w-3.5" />} {msg.text}
          </span>
        )}
        {dirty && !msg && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Unsaved changes</span>}
      </div>
    </div>
  );
}

export default function ApprovalsTab() {
  useRoles(); // role names
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    axios
      .get("/api/permissions/approvals")
      .then(({ data: d }) => setData(d))
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, [rev]);

  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>;
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-semibold text-primary">One setting per approval controls everything about it</p>
          <ul className="grid gap-1 text-muted-foreground sm:grid-cols-3">
            <li className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Only these people open the page</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Only they approve / reject</li>
            <li className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" /> Only they are notified</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            A Super Admin can always open approvals, but is notified only if added here.
          </p>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        {data.approvals.map((a) => (
          <section key={a.key} className="overflow-hidden rounded-xl border border-border bg-background">
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-primary">{a.label}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
              </div>
              <Button asChild variant="outline" size="sm" className="h-8 gap-1 bg-background text-xs">
                <a href={a.page}>
                  <ExternalLink className="h-3.5 w-3.5" /> Open page
                </a>
              </Button>
            </header>
            <div className="space-y-3 p-3 sm:p-4">
              {a.rights.map((r) => (
                <RightEditor key={`${r.code}:${rev}`} right={r} users={data.users} roles={data.roles} onSaved={() => setRev((x) => x + 1)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="border-t border-border pt-6">
        <HrChainsSection />
      </div>

      <div className="border-t border-border pt-6">
        <ApprovalRulesSection />
      </div>
    </div>
  );
}
