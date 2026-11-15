"use client";

// components/Audit/AuditFilters.jsx — the Audit Trail filter bar: date range,
// area, tables, action, user, source and search. Inline on tablets/desktop; a
// bottom "Filters" sheet on phones. Every value lives in the URL (the parent
// passes params + setParams), so a filtered view can be shared as a link.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BRAND_BTN, NativeSelect } from "@/components/HR/shared";
import { AUDIT_MODULES, auditLabel } from "@/lib/audit/catalog";
import { PRESETS, fmtDayShort, fmtNum, presetOf, presetRange } from "./format";

const ACTIONS = [
  { key: "", label: "All" },
  { key: "create", label: "Created" },
  { key: "update", label: "Changed" },
  { key: "delete", label: "Deleted" },
];
const SOURCES = [
  { key: "", label: "All" },
  { key: "user", label: "People" },
  { key: "system", label: "System" },
];

/** A row of toggle buttons (one choice). */
export function Segmented({ options, value, onChange, label, className }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex h-9 max-w-full items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5", className)}>
      {options.map((o) => {
        const on = (value || "") === o.key;
        return (
          <button
            key={o.key || "all"}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.key)}
            className={cn(
              "h-full flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]/30 sm:text-sm",
              on ? "bg-white text-[#800000] shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Tables multi-select: tables with changes in range (with counts) first, then every other table. */
function TablePicker({ selected, onChange, facetModels, metaModels, module, className }) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const counts = new Map((facetModels ?? []).map((m) => [m.model, m.count]));
    const mod = AUDIT_MODULES.find((m) => m.key === module);
    const all = new Map();
    for (const m of facetModels ?? []) all.set(m.model, { model: m.model, label: m.label });
    for (const m of metaModels ?? []) if (!all.has(m.model)) all.set(m.model, { model: m.model, label: m.label });
    for (const s of selected) if (!all.has(s)) all.set(s, { model: s, label: auditLabel(s) });
    return [...all.values()]
      .filter((o) => !mod || mod.models.includes(o.model) || selected.includes(o.model))
      .map((o) => ({ ...o, count: counts.get(o.model) ?? null }))
      .sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.label.localeCompare(b.label));
  }, [facetModels, metaModels, selected, module]);
  const toggle = (model) => onChange(selected.includes(model) ? selected.filter((m) => m !== model) : [...selected, model]);
  const text = !selected.length ? "All tables" : selected.length === 1 ? auditLabel(selected[0]) : `${selected.length} tables`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Tables" className={cn("h-9 justify-between font-normal", className)}>
          <span className={cn("truncate", !selected.length && "text-slate-600")}>{text}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Find a table…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No table found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = selected.includes(o.model);
                return (
                  <CommandItem key={o.model} value={`${o.label} ${o.model}`} onSelect={() => toggle(o.model)}>
                    <span
                      className={cn(
                        "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        on ? "border-[#800000] bg-[#800000] text-white" : "border-slate-300",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                    {o.count != null && <span className="ml-auto pl-2 text-xs tabular-nums text-slate-500">{fmtNum(o.count)}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="border-t border-slate-100 p-1.5">
            <Button variant="ghost" size="sm" className="w-full text-slate-600" onClick={() => onChange([])}>
              Clear tables
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Search box that writes to the URL after the user pauses typing. */
export function SearchBox({ value, onChange, className }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  useEffect(() => {
    if ((text ?? "").trim() === (value ?? "")) return undefined;
    const t = setTimeout(() => onChange(text.trim()), 400);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onChange(text.trim())}
        placeholder="Record / document no. or user"
        aria-label="Search by record number, document number or user"
        className="h-9 pl-8"
      />
    </div>
  );
}

function DateRange({ params, setParams, stacked }) {
  const preset = presetOf(params.from, params.to);
  const [custom, setCustom] = useState(preset === "custom");
  useEffect(() => {
    if (preset === "custom") setCustom(true);
  }, [preset]);
  const current = params.from || params.to ? { from: params.from, to: params.to } : presetRange("7d");
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", stacked && "flex-col items-stretch")}>
      <Segmented
        label="Date range"
        className={stacked ? "w-full" : undefined}
        value={custom ? "custom" : preset}
        options={[...PRESETS.map((p) => ({ key: p.key, label: p.label })), { key: "custom", label: "Custom" }]}
        onChange={(k) => {
          if (k === "custom") {
            setCustom(true);
            setParams({ from: current.from, to: current.to });
          } else {
            setCustom(false);
            setParams(k === "7d" ? { from: "", to: "" } : presetRange(k));
          }
        }}
      />
      {custom && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="From date"
            value={current.from || ""}
            max={current.to || undefined}
            onChange={(e) => e.target.value && setParams({ from: e.target.value })}
            className="h-9 min-w-0 flex-1 tabular-nums sm:w-[9.5rem] sm:flex-none"
          />
          <span className="text-xs text-slate-400">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={current.to || ""}
            min={current.from || undefined}
            onChange={(e) => e.target.value && setParams({ to: e.target.value })}
            className="h-9 min-w-0 flex-1 tabular-nums sm:w-[9.5rem] sm:flex-none"
          />
        </div>
      )}
    </div>
  );
}

function FieldLabel({ show, children }) {
  return show ? <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</p> : null;
}

function Controls({ params, setParams, facets, meta, scoped, stacked }) {
  const selectedModels = (params.model || "").split(",").filter(Boolean);
  const users = useMemo(() => {
    const counts = new Map((facets?.users ?? []).filter((u) => u.id).map((u) => [u.id, u]));
    const list = new Map();
    for (const u of facets?.users ?? []) if (u.id) list.set(u.id, { id: u.id, name: u.name, count: u.count });
    for (const u of meta?.users ?? []) if (!list.has(u.id)) list.set(u.id, { id: u.id, name: u.name, count: null });
    if (params.user && !list.has(params.user)) list.set(params.user, { id: params.user, name: params.user, count: null });
    return [...list.values()].sort((a, b) => (counts.has(b.id) ? 1 : 0) - (counts.has(a.id) ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
  }, [facets, meta, params.user]);
  const field = stacked ? "w-full" : "";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", stacked && "flex-col items-stretch gap-4")}>
      {!scoped && (
        <div>
          <FieldLabel show={stacked}>Date</FieldLabel>
          <DateRange params={params} setParams={setParams} stacked={stacked} />
        </div>
      )}
      <div>
        <FieldLabel show={stacked}>Area</FieldLabel>
        <NativeSelect
          aria-label="Area"
          value={params.module || ""}
          onChange={(e) => setParams(scoped === "record" ? { module: e.target.value } : { module: e.target.value, model: "" })}
          className={cn("w-full sm:w-44", field)}
        >
          <option value="">All areas</option>
          {AUDIT_MODULES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {scoped !== "record" && (
      <div>
        <FieldLabel show={stacked}>Tables</FieldLabel>
        <TablePicker
          selected={selectedModels}
          onChange={(list) => setParams({ model: list.join(",") })}
          facetModels={facets?.models}
          metaModels={meta?.models}
          module={params.module}
          className={cn("w-full sm:w-48", field)}
        />
      </div>
      )}
      <div>
        <FieldLabel show={stacked}>User</FieldLabel>
        <NativeSelect aria-label="User" value={params.user || ""} onChange={(e) => setParams({ user: e.target.value })} className={cn("w-full sm:w-48", field)}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.count != null ? ` (${fmtNum(u.count)})` : ""}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <FieldLabel show={stacked}>Action</FieldLabel>
        <Segmented label="Action" options={ACTIONS} value={params.action} onChange={(k) => setParams({ action: k })} className={field} />
      </div>
      <div>
        <FieldLabel show={stacked}>Made by</FieldLabel>
        <Segmented label="Source" options={SOURCES} value={params.source} onChange={(k) => setParams({ source: k })} className={field} />
      </div>
    </div>
  );
}

/** Removable chips for each active filter. */
export function ActiveChips({ params, setParams, facets, meta, scoped, onClear }) {
  const chips = [];
  if (!scoped && (params.from || params.to)) {
    const p = presetOf(params.from, params.to);
    const label = p === "custom" ? `${fmtDayShort(params.from)} – ${fmtDayShort(params.to)}` : PRESETS.find((x) => x.key === p)?.label;
    chips.push({ key: "date", label: `Date: ${label}`, clear: { from: "", to: "" } });
  }
  if (params.module) chips.push({ key: "module", label: `Area: ${AUDIT_MODULES.find((m) => m.key === params.module)?.label ?? params.module}`, clear: { module: "" } });
  if (params.model && !(scoped === "record")) {
    for (const m of params.model.split(",").filter(Boolean)) {
      chips.push({ key: `model-${m}`, label: auditLabel(m), clear: { model: params.model.split(",").filter((x) => x && x !== m).join(",") } });
    }
  }
  if (params.action) chips.push({ key: "action", label: ACTIONS.find((a) => a.key === params.action)?.label ?? params.action, clear: { action: "" } });
  if (params.user) {
    const name = facets?.users?.find((u) => u.id === params.user)?.name ?? meta?.users?.find((u) => u.id === params.user)?.name ?? params.user;
    chips.push({ key: "user", label: `User: ${name}`, clear: { user: "" } });
  }
  if (params.source) chips.push({ key: "source", label: params.source === "system" ? "System only" : "People only", clear: { source: "" } });
  if (params.q) chips.push({ key: "q", label: `“${params.q}”`, clear: { q: "" } });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#800000]/[0.07] py-0.5 pl-2.5 pr-1 text-xs font-medium text-[#800000] ring-1 ring-inset ring-[#800000]/15">
          <span className="truncate">{c.label}</span>
          <button
            type="button"
            onClick={() => setParams(c.clear)}
            className="rounded-full p-0.5 hover:bg-[#800000]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]/30"
            aria-label={`Remove filter ${c.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="ml-1 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
        Clear all
      </button>
    </div>
  );
}

export function activeCount(params, scoped) {
  let n = 0;
  if (!scoped && (params.from || params.to)) n += 1;
  for (const k of ["module", "action", "user", "source"]) if (params[k]) n += 1;
  if (params.model && scoped !== "record") n += 1;
  return n;
}

/** Filter bar: inline from md up, a sheet on phones. `extra` = trailing buttons (Export). */
export default function AuditFilters({ params, setParams, facets, meta, scoped, extra }) {
  const [open, setOpen] = useState(false);
  const n = activeCount(params, scoped);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      {/* Phones */}
      <div className="flex items-center gap-2 md:hidden">
        <SearchBox value={params.q} onChange={(q) => setParams({ q })} className="min-w-0 flex-1" />
        <Button variant="outline" className="h-9 shrink-0 px-3" onClick={() => setOpen(true)} aria-label={`Filters${n ? `, ${n} active` : ""}`}>
          <Filter className="h-4 w-4" />
          Filters
          {n > 0 && <span className="ml-0.5 rounded-full bg-[#800000] px-1.5 text-[10px] font-bold leading-4 text-white tabular-nums">{n}</span>}
        </Button>
        {extra}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="flex max-h-[88vh] flex-col gap-0 rounded-t-2xl p-0">
          <SheetHeader className="border-b border-slate-100 px-4 py-3 text-left">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Narrow the changes shown. They apply straight away.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <Controls params={params} setParams={setParams} facets={facets} meta={meta} scoped={scoped} stacked />
          </div>
          <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setParams({ from: "", to: "", module: "", model: scoped === "record" ? params.model : "", action: "", user: "", source: "" })}
            >
              Reset
            </Button>
            <Button className={cn("flex-1", BRAND_BTN)} onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Tablet / desktop */}
      <div className="hidden space-y-2.5 md:block">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={params.q} onChange={(q) => setParams({ q })} className="min-w-[14rem] flex-1" />
          {extra}
        </div>
        <Controls params={params} setParams={setParams} facets={facets} meta={meta} scoped={scoped} />
      </div>
    </div>
  );
}
