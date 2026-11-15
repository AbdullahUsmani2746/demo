"use client";

// HR → Team structure: who reports to whom (/api/hr/team).
//   Org chart   the reporting tree of the employees this person works with
//   Assign      tick employees → "Reports to" someone (or nobody)
// The tree is also what "Theirs" means on the "Employees (HR)" data scope and
// the default for supervisors without an HR scope: they see their own team.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, Crown, GitBranch, Loader2, Search, UserCheck, UserMinus, UserX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { api, BRAND_BTN, EmployeeCell, EmptyState, ListSkeleton, NativeSelect, Panel, StatTile, TH } from "@/components/HR/shared";

/** Searchable employee picker (long lists). */
function LeaderPicker({ leaders, value, onChange, exclude = [], placeholder = "Reports to…" }) {
  const [open, setOpen] = useState(false);
  const chosen = leaders.find((l) => l.id === value);
  const skip = new Set(exclude);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="h-9 w-full justify-between bg-background font-normal sm:w-72">
          <span className={cn("truncate", !chosen && "text-muted-foreground")}>{chosen ? `${chosen.name} (#${chosen.id})` : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Name or employee no." />
          <CommandList>
            <CommandEmpty>Nobody found.</CommandEmpty>
            <CommandGroup>
              {leaders
                .filter((l) => !skip.has(l.id))
                .map((l) => (
                  <CommandItem
                    key={l.id}
                    value={`${l.name} ${l.id} ${l.designation ?? ""}`}
                    onSelect={() => {
                      onChange(l.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === l.id ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{l.name}</span>
                    <span className="ml-auto whitespace-nowrap pl-2 text-xs text-muted-foreground">#{l.id}{l.designation ? ` · ${l.designation}` : ""}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TreeNode({ node, depth, open, toggle }) {
  const isOpen = open.has(node.id);
  const kids = node.children;
  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-primary/[0.03]"
        style={{ paddingLeft: `${Math.min(depth, 8) * 1.25 + 0.25}rem` }}
      >
        {kids.length ? (
          <button type="button" onClick={() => toggle(node.id)} className="rounded p-0.5 text-primary/70 hover:bg-primary/10 hover:text-primary" aria-label={isOpen ? "Collapse" : "Expand"}>
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <div className="min-w-0 flex-1">
          <EmployeeCell employee={node} compact sub={[node.designation, node.location].filter(Boolean).map((t) => ` · ${t}`).join("")} />
        </div>
        {kids.length > 0 && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary" title={`${kids.length} direct report(s)`}>{kids.length}</span>
        )}
      </div>
      {isOpen && kids.length > 0 && (
        <ul className="border-l-2 border-primary/15" style={{ marginLeft: `${Math.min(depth, 8) * 1.25 + 0.9}rem` }}>
          {kids.map((k) => (
            <TreeNode key={k.id} node={k} depth={depth + 1} open={open} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

function OrgChart({ employees }) {
  // Roots: nobody above them among the people shown.
  const { roots, alone } = useMemo(() => {
    const byId = new Map(employees.map((e) => [e.id, { ...e, children: [] }]));
    const rootList = [];
    for (const n of byId.values()) {
      const parent = n.reports_to ? byId.get(n.reports_to.id) : null;
      if (parent && parent.id !== n.id) parent.children.push(n);
      else rootList.push(n);
    }
    const sortTree = (list) => list.sort((a, b) => b.children.length - a.children.length || a.name.localeCompare(b.name)).forEach((n) => sortTree(n.children));
    sortTree(rootList);
    return { roots: rootList.filter((n) => n.children.length || n.reports_to), alone: rootList.filter((n) => !n.children.length && !n.reports_to) };
  }, [employees]);
  const [open, setOpen] = useState(() => new Set(roots.map((r) => r.id)));
  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const expandAll = () => setOpen(new Set(employees.map((e) => e.id)));

  if (!roots.length) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No reporting line yet"
        hint={`None of the ${employees.length} employee(s) here reports to anyone. Use "Assign" to set who reports to whom.`}
      />
    );
  }
  return (
    <div className="space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-9 bg-background sm:h-8" onClick={expandAll}>Expand all</Button>
        <Button variant="outline" size="sm" className="h-9 bg-background sm:h-8" onClick={() => setOpen(new Set())}>Collapse all</Button>
        <span className="text-xs text-muted-foreground sm:ml-auto">{alone.length} employee(s) not in any team yet</span>
      </div>
      <ul className="space-y-0.5">
        {roots.map((r) => (
          <TreeNode key={r.id} node={r} depth={0} open={open} toggle={toggle} />
        ))}
      </ul>
    </div>
  );
}

export default function TeamStructure({ meta }) {
  const qc = useQueryClient();
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("chart");
  const [picked, setPicked] = useState(() => new Set());
  const [leader, setLeader] = useState(null);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const canEdit = meta.rights.team;

  const params = new URLSearchParams({ ...(department && { department }), ...(location && { location }) });
  const { data, isLoading } = useQuery({ queryKey: ["hr-team", department, location], queryFn: () => api(`/api/hr/team?${params}`) });
  const employees = useMemo(() => data?.employees ?? [], [data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(
      (e) =>
        (!onlyUnassigned || !e.reports_to) &&
        (!q || e.name.toLowerCase().includes(q) || String(e.id) === q || (e.reports_to?.name ?? "").toLowerCase().includes(q)),
    );
  }, [employees, search, onlyUnassigned]);

  const allPicked = shown.length > 0 && shown.every((e) => picked.has(e.id));
  const togglePick = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function save(reportsTo) {
    setSaving(true);
    try {
      const r = await api("/api/hr/team", { method: "POST", body: { employee_ids: [...picked], reports_to: reportsTo } });
      toast.success(r.message);
      setPicked(new Set());
      setLeader(null);
      qc.invalidateQueries({ queryKey: ["hr-team"] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const withLine = employees.filter((e) => e.reports_to).length;
  const leads = employees.filter((e) => e.direct_reports > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Users} label="Employees" value={isLoading ? "—" : employees.length} tone="brand" />
        <StatTile icon={UserCheck} label="Report to someone" value={isLoading ? "—" : withLine} tone="emerald" />
        <StatTile icon={Crown} label="Team leaders" value={isLoading ? "—" : leads} />
        <StatTile icon={UserX} label="Not in a team" value={isLoading ? "—" : employees.length - withLine} tone={!isLoading && employees.length - withLine ? "amber" : "slate"} />
      </div>

      <Panel
        title={view === "chart" ? "Org chart" : "Assign reporting line"}
        icon={view === "chart" ? GitBranch : Users}
        actions={
          <>
            <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full sm:w-48">
              <option value="">All departments</option>
              {meta.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.dept_name}</option>
              ))}
            </NativeSelect>
            {meta.locations?.length > 1 && (
              <NativeSelect value={location} onChange={(e) => setLocation(e.target.value)} className="w-full sm:w-40">
                <option value="">All locations</option>
                {meta.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </NativeSelect>
            )}
            <div className="inline-flex w-full rounded-lg border border-border bg-background p-0.5 sm:w-auto" role="group" aria-label="View">
              {[
                ["chart", "Org chart"],
                ["assign", "Assign"],
              ].map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  aria-pressed={view === k}
                  className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors sm:flex-none", view === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary")}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        }
      >
        {isLoading ? (
          <ListSkeleton rows={8} />
        ) : view === "chart" ? (
          <OrgChart key={`${department}|${location}|${employees.length}`} employees={employees} />
        ) : (
          <div>
            <div className="flex flex-col gap-3 border-b border-border/60 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
              <div className="relative sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, no. or leader" className="h-9 pl-8" />
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground/70">
                <Checkbox checked={onlyUnassigned} onCheckedChange={(v) => setOnlyUnassigned(Boolean(v))} />
                Only people not in a team
              </label>
            </div>

            {canEdit && picked.size > 0 && (
              <div className="sticky top-2 z-10 flex flex-col gap-2 border-y border-primary/25 bg-background/95 px-3 py-3 shadow-md shadow-red-900/5 backdrop-blur sm:flex-row sm:items-center sm:px-4">
                <p className="text-sm font-semibold text-foreground">
                  <span className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">{picked.size}</span>
                  selected — report to
                </p>
                <LeaderPicker leaders={data.leaders} value={leader} onChange={setLeader} exclude={[...picked]} />
                <div className="flex gap-2 sm:ml-auto">
                  <Button className={cn(BRAND_BTN, "flex-1 sm:flex-none")} disabled={!leader || saving} onClick={() => save(leader)}>
                    {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save
                  </Button>
                  <Button variant="outline" className="flex-1 bg-background sm:flex-none" disabled={saving} onClick={() => save(null)} title="They will report to nobody">
                    <UserMinus className="mr-1.5 h-4 w-4" />Remove from team
                  </Button>
                  <Button variant="ghost" disabled={saving} onClick={() => setPicked(new Set())}>Clear</Button>
                </div>
              </div>
            )}

            {shown.length === 0 ? (
              <EmptyState icon={Users} title="Nobody here" hint="No employees match these filters." />
            ) : (
              <>
                {/* Phone: cards */}
                <ul className="divide-y divide-border/60 md:hidden">
                  {shown.map((e) => (
                    <li key={e.id} className="flex items-start gap-3 px-3 py-3">
                      {canEdit && <Checkbox className="mt-2.5" checked={picked.has(e.id)} onCheckedChange={() => togglePick(e.id)} aria-label={`Select ${e.name}`} />}
                      <div className="min-w-0 flex-1 space-y-1">
                        <EmployeeCell employee={e} />
                        <p className="pl-[2.875rem] text-xs text-muted-foreground">
                          Reports to <span className="font-medium text-foreground/85">{e.reports_to?.name ?? "nobody"}</span>
                          {e.direct_reports > 0 && ` · leads ${e.direct_reports}`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                {/* Tablet & up: table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead className="bg-primary text-left text-primary-foreground">
                      <tr>
                        {canEdit && (
                          <th className={cn(TH, "w-10 px-4")}>
                            <Checkbox
                              className="border-white/80 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-primary"
                              checked={allPicked}
                              onCheckedChange={(v) => setPicked(v ? new Set([...picked, ...shown.map((e) => e.id)]) : new Set([...picked].filter((id) => !shown.some((e) => e.id === id))))}
                              aria-label="Select all shown"
                            />
                          </th>
                        )}
                        <th className={cn(TH, "px-4")}>Employee</th>
                        <th className={cn(TH, "px-4")}>Location</th>
                        <th className={cn(TH, "px-4")}>Reports to</th>
                        <th className={cn(TH, "px-4 text-right")}>Team</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {shown.map((e) => (
                        <tr key={e.id} className={cn("hover:bg-primary/[0.03]", picked.has(e.id) && "bg-primary/[0.03]")}>
                          {canEdit && (
                            <td className="px-4 py-2.5">
                              <Checkbox checked={picked.has(e.id)} onCheckedChange={() => togglePick(e.id)} aria-label={`Select ${e.name}`} />
                            </td>
                          )}
                          <td className="px-4 py-2.5"><EmployeeCell employee={e} /></td>
                          <td className="px-4 py-2.5 text-foreground/70">{e.location ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            {e.reports_to ? (
                              <span className="font-medium text-foreground">{e.reports_to.name} <span className="font-mono text-xs font-normal text-muted-foreground">#{e.reports_to.id}</span></span>
                            ) : (
                              <span className="text-muted-foreground">Nobody</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{e.direct_reports ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{e.direct_reports}</span> : <span className="text-muted-foreground/60">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
