"use client";
import { roleLabel } from "@/lib/auth/roleNames";
import { useRoles } from "@/hooks/useRoles";
// components/permissions/SalesVisibilityTab.jsx — Admin → Permissions → Sales visibility.
// Per person: whose customers they see on every sales screen (reports, BI
// dashboards, Sales Team MIS, Sales Targets, Customer Aging, Sales Loans):
//   Own only · Own + team (pick sales persons) · All sales
// Rule: lib/auth/salesScope.js. Saved per row; ADMIN / ACCOUNTANT always see all.
// Table rows become cards under md (table.vl-grid in app/globals.css).
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Eye, Loader2, Lock, Search, Users, UserRound, Globe2, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import SearchSelect from "@/components/bi/SearchSelect";

const MODES = [
  { key: "own", label: "Own only", Icon: UserRound },
  { key: "team", label: "Own + team", Icon: Users },
  { key: "all", label: "All sales", Icon: Globe2 },
];
const FILTERS = [
  { key: "any", label: "Everyone" },
  { key: "sales", label: "Sales persons" },
  { key: "all", label: "Sees all" },
  { key: "team", label: "Team leads" },
];

function Row({ p, salesPersons, onSaved }) {
  const [mode, setMode] = useState(p.mode);
  const [team, setTeam] = useState(p.team);
  const [state, setState] = useState(null); // saving | saved | error text

  async function save(nextMode, nextTeam) {
    setState("saving");
    try {
      await axios.put("/api/permissions/sales-visibility", { userId: p.id, mode: nextMode, team: nextTeam });
      setState("saved");
      onSaved?.(p.id, nextMode, nextTeam);
      setTimeout(() => setState(null), 1800);
    } catch (e) {
      setState(e.response?.data?.error || e.message);
    }
  }

  const choose = (m) => {
    setMode(m);
    if (m !== "team") save(m, []);
    else if (team.length) save(m, team);
  };

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-primary/[0.03]">
      <td data-label="Person" className="px-4 py-3">
        <div className="font-semibold">{p.name}</div>
        <div className="text-xs text-muted-foreground">
          {roleLabel(p.role)}
          {p.isSalesPerson ? ` · ${p.ownCustomers} own customer(s)` : ""}
        </div>
      </td>
      <td data-label="Sees" className="px-4 py-3">
        {p.locked ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Always all ({roleLabel(p.role)})
          </span>
        ) : (
          <div className="inline-flex max-w-full flex-wrap rounded-lg border border-border bg-background p-0.5">
            {MODES.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => choose(key)}
                aria-pressed={mode === key}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  mode === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-primary"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
        {p.viaRole && mode === "all" && <div className="mt-1 text-[11px] text-muted-foreground">through the {roleLabel(p.role)} role</div>}
      </td>
      <td data-label="Team (their sales persons)" className="px-4 py-3 md:min-w-[280px]" style={{ gridColumn: "1 / -1" }}>
        {mode === "team" && !p.locked ? (
          <SearchSelect
            multi
            width="100%"
            placeholder="Choose sales persons…"
            value={team}
            options={salesPersons.filter((s) => s.id !== p.id).map((s) => ({ value: s.id, label: `${s.name} (${s.customers})` }))}
            onChange={(v) => {
              setTeam(v);
              save("team", v);
            }}
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            {p.locked || mode === "all" ? "Every sales person's customers" : "Only customers assigned to them"}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-xs md:w-28" style={state ? { gridColumn: "1 / -1" } : undefined}>
        {state === "saving" ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : state === "saved" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#edf2ee] px-2 py-0.5 font-semibold text-[#2f5139]"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span>
        ) : state ? (
          <span className="text-destructive">{state}</span>
        ) : null}
      </td>
    </tr>
  );
}

export default function SalesVisibilityTab() {
  useRoles(); // role names
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("any");

  useEffect(() => {
    axios
      .get("/api/permissions/sales-visibility")
      .then(({ data: d }) => setData(d))
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  const onSaved = (id, mode, team) =>
    setData((d) => ({ ...d, people: d.people.map((p) => (p.id === id ? { ...p, mode, team, viaRole: false } : p)) }));

  const rows = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.people.filter((p) => {
      if (term && !`${p.name} ${p.role} ${roleLabel(p.role)}`.toLowerCase().includes(term)) return false;
      if (filter === "sales") return p.isSalesPerson;
      if (filter === "all") return p.mode === "all" || p.locked;
      if (filter === "team") return p.mode === "team";
      return true;
    });
  }, [data, q, filter]);

  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>;
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const count = (fn) => data.people.filter(fn).length;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm">
        <Eye className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-primary">Whose customers each person sees</p>
          <p className="text-xs text-muted-foreground">
            Applies everywhere: reports, BI dashboards, Sales Team MIS, Sales Targets, Customer Aging, Sales Loans and Sale
            Return remarks. Changes save immediately.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="h-9 bg-background pl-9" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/50 hover:text-primary"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold sm:ml-auto">
            <span className="rounded-full bg-[#edf2ee] px-2 py-0.5 text-[#2f5139]">{count((p) => p.mode === "all" && !p.locked)} see all</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{count((p) => p.mode === "team")} team leads</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{count((p) => p.mode === "own" && p.isSalesPerson)} sales persons on own</span>
          </div>
        </div>

        <table className="vl-grid w-full text-sm">
          <thead className="bg-primary text-left">
            <tr>
              <th className="px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">Person</th>
              <th className="px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">Sees</th>
              <th className="px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">Team (their sales persons)</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <Row key={p.id} p={p} salesPersons={data.salesPersons} onSaved={onSaved} />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No one matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
