"use client";
// components/EmployeeMenus/EmployeePicker.jsx — "Whose menus?": the employee
// list on the left (lg+), a searchable select on a phone.
import { useMemo, useState } from "react";
import Select from "react-select";
import { Search, UserRound, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { CODE_CHIP } from "@/components/Material/shared/LabUI";
import { CARD, CARD_HEAD, ListSkeleton } from "./shared";
import { cn } from "@/lib/utils";

export const ALL_DEPTS = "";

/** Departments present on the list, for the filter. */
export function departmentOptions(employees) {
  const m = new Map();
  for (const e of employees || []) if (e.departmentId != null) m.set(e.departmentId, e.department || `Department ${e.departmentId}`);
  return [{ value: ALL_DEPTS, label: "All departments" }, ...[...m].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
}

export function matchEmployee(e, term, dept) {
  if (dept !== ALL_DEPTS && e.departmentId !== dept) return false;
  const q = String(term || "").trim().toLowerCase();
  if (!q) return true;
  return `${e.name} ${e.code} ${e.department || ""} ${e.role || ""}`.toLowerCase().includes(q);
}

export const employeeLabel = (e) => `${e.name} (${e.code})`;

export default function EmployeePicker({ employees, loading, selectedId, onSelect, depts }) {
  const [term, setTerm] = useState("");
  const [dept, setDept] = useState(ALL_DEPTS);
  const list = useMemo(() => (employees || []).filter((e) => matchEmployee(e, term, dept)), [employees, term, dept]);
  const options = useMemo(() => (employees || []).map((e) => ({ value: e.id, label: employeeLabel(e), e })), [employees]);
  const selected = options.find((o) => o.value === selectedId) || null;

  return (
    <>
      {/* phone / tablet: one select */}
      <div className={cn(CARD, "space-y-2 p-3 lg:hidden")}>
        <label className="text-[12px] font-semibold text-muted-foreground" htmlFor="emp-pick">
          Employee
        </label>
        <Select
          inputId="emp-pick"
          options={options}
          value={selected}
          onChange={(o) => o && onSelect(o.value)}
          isLoading={loading}
          placeholder="Pick an employee…"
          styles={selectStyles(false)}
          menuPortalTarget={typeof document !== "undefined" ? document.body : null}
          formatOptionLabel={(o) => (
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{o.e.name}</span>
              <span className="flex-shrink-0 text-[11.5px] opacity-70">{o.e.menuCount} menus</span>
            </span>
          )}
        />
      </div>

      {/* lg+: the list */}
      <aside className={cn(CARD, "hidden lg:sticky lg:top-[calc(var(--header-height,0px)+16px)] lg:block")}>
        <div className={CARD_HEAD}>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-primary">
            <Users className="h-4 w-4" /> Whose menus?
          </h2>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name or employee no…" className="h-9 bg-background pl-9" aria-label="Find an employee" />
          </div>
          <div className="mt-2">
            <Select
              aria-label="Department"
              options={depts}
              value={depts.find((d) => d.value === dept) || depts[0]}
              onChange={(o) => setDept(o?.value ?? ALL_DEPTS)}
              styles={selectStyles(false)}
              isSearchable
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
            />
          </div>
        </div>
        <div className="max-h-[calc(100vh-22rem)] overflow-y-auto">
          {loading ? (
            <ListSkeleton rows={10} />
          ) : list.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">No employee matches.</p>
          ) : (
            list.map((e) => {
              const on = e.id === selectedId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e.id)}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left transition",
                    on ? "border-primary bg-primary/10" : "border-transparent hover:bg-primary/[0.04]",
                  )}
                >
                  <UserRound className={cn("h-4 w-4 flex-shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", on && "font-semibold text-primary")}>
                      {e.name}
                      {e.status && e.status !== "ACTIVE" && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">{e.status.toLowerCase()}</span>
                      )}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={CODE_CHIP}>{e.code}</span>
                      <span className="truncate">{[e.department, e.role].filter(Boolean).join(" · ")}</span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      e.menuCount ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {e.menuCount} menu{e.menuCount === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <p className="border-t border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          {list.length} of {employees?.length ?? 0} employees
        </p>
      </aside>
    </>
  );
}
