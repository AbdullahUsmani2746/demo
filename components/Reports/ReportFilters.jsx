"use client";

// Report filters — the side panel, the chip bar and the summary-type tabs of
// the universal report viewer. UI only: every value set here is the value the
// old filter dialog set (same names, same "DD-MM-YYYY" dates, "" for "All",
// multi-selects as "a,b,c"), so the report API sees the same requests.
//
// Panel sections are worked out from the filter config; a filter may name its
// own with the optional key `section`: "period" | "who" | "display".
//   period  — date filters (a dateFrom / dateTo pair is one range row + presets)
//   who     — selects of parties, items, godowns, orders… (anything with options)
//   display — sort / order / view selects, checkboxes (switch rows), text filters
//
// Edits in the panel are pending until Apply (Ctrl+Enter); closing discards them.

import React, { useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import { CalendarIcon, FilterIcon, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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
import { selectStyles } from "@/components/shared/EntityFormPanel";

// ── helpers (shared with ReportViewer) ──────────────────────────────────────

// A filter "has a value" the way the old Active Filters bar counted it.
export const isEmptyFilterValue = (v) =>
  v === undefined || v === null || v === "" || v === "all" || v === false;
const norm = (v) => (isEmptyFilterValue(v) ? "" : Array.isArray(v) ? v.join(",") : String(v));

export const filterLabelOf = (filter, values) =>
  typeof filter.label === "function" ? filter.label(values) : filter.label;

// Same label the old FilterSelect built for an option.
export function optionLabel(filter, opt) {
  const sep = filter.separator || " - ";
  if (Array.isArray(filter.nameKeys)) {
    const parts = filter.nameKeys.map((k) => opt[k]).filter((v) => v != null && v !== "").map(String);
    if (!parts.length) {
      const fb = opt[filter.valueKey] || opt.id || opt.value || "";
      if (fb !== "") parts.push(String(fb));
    }
    return parts.join(sep);
  }
  if (filter.nameKey2 && filter.nameKey3 && opt[filter.nameKey2] && opt[filter.nameKey3]) {
    return `${opt[filter.nameKey2]}${sep}${opt[filter.nameKey3]}${sep}${opt[filter.nameKey] || ""}`;
  }
  if (filter.nameKey2 && opt[filter.nameKey2]) {
    return `${opt[filter.nameKey2]}${sep}${opt[filter.nameKey] || opt.name || ""}`;
  }
  return String(opt.label ?? opt.name ?? opt[filter.nameKey || "label"] ?? "");
}
export const optionValue = (filter, opt) => String(opt[filter.valueKey || "value"] || opt.value || opt.id);

const pad2 = (n) => String(n).padStart(2, "0");
export const toDmy = (d) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
export function parseDmy(s) {
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const chipDate = (d, withYear = true) => `${pad2(d.getDate())} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;

// "01 Oct – 31 Oct 2026" · "From 01 Oct 2026" · "Until 31 Oct 2026"
export function formatRange(fromVal, toVal) {
  const a = parseDmy(fromVal);
  const b = parseDmy(toVal);
  if (a && b) return `${chipDate(a, a.getFullYear() !== b.getFullYear())} – ${chipDate(b)}`;
  if (a) return `From ${chipDate(a)}`;
  if (b) return `Until ${chipDate(b)}`;
  return [fromVal, toVal].filter(Boolean).join(" – ");
}
export const formatOneDate = (v) => {
  const d = parseDmy(v);
  return d ? chipDate(d) : String(v);
};

// What the filter starts at when nothing is in the address — same rules as
// ReportViewer's initial filters.
export function defaultFilterValue(filter) {
  if (filter.default === undefined) return "";
  if (filter.type === "select" && filter.default && typeof filter.default === "object" && "value" in filter.default) {
    return filter.default.value;
  }
  if (filter.type === "date" && filter.default) {
    const d = new Date(filter.default);
    return Number.isNaN(d.getTime()) ? filter.default : toDmy(d);
  }
  return filter.default;
}

// One change the way handleFilterChange makes it: "All" → "", and filters
// that depend on this one are cleared.
export function withDependents(filterDefs, values, name, value) {
  const v = value === "All" || value === "all" ? "" : value;
  const next = { ...values, [name]: v };
  (filterDefs || []).forEach((f) => {
    if (f.dependsOn === name && f.clearOnDependencyChange !== false) next[f.name] = "";
  });
  return next;
}

// The summary type shown as tabs: a static select named `type` with ≤ 7 options.
export function summaryTypeFilter(config) {
  const f = config?.filters?.find((x) => x.name === "type");
  if (!f || f.type !== "select" || f.apiEndpoint || f.multiple || f.isMulti || f.locked) return null;
  if (!Array.isArray(f.options) || f.options.length < 2 || f.options.length > 7) return null;
  return f;
}

const DISPLAY_SELECT = /sort|direction|^order(by|_by)?$|^type$|view|mode|group_?by|basis|display|format/i;
const SECTION_ALIASES = { period: "period", date: "period", dates: "period", who: "who", what: "who", "who & what": "who", display: "display", options: "display" };
export function filterSection(filter) {
  const own = SECTION_ALIASES[String(filter.section || "").toLowerCase()];
  if (own) return own;
  if (filter.type === "date") return "period";
  if (filter.type === "select") {
    if (filter.apiEndpoint || typeof filter.options === "string") return "who";
    return DISPLAY_SELECT.test(filter.name) ? "display" : "who";
  }
  return "display";
}

// dateFrom → dateTo, fromDate → toDate, startDate → endDate …
export function datePairs(filterDefs) {
  const dates = (filterDefs || []).filter((f) => f.type === "date");
  const byName = new Map(dates.map((f) => [f.name, f]));
  const pairs = [];
  const used = new Set();
  dates.forEach((f) => {
    if (used.has(f.name)) return;
    const candidates = [
      f.name.replace("From", "To"),
      f.name.replace("from", "to"),
      f.name.replace("Start", "End"),
      f.name.replace("start", "end"),
    ].filter((n) => n !== f.name);
    const to = candidates.map((n) => byName.get(n)).find((x) => x && !used.has(x.name));
    if (to) {
      pairs.push({ from: f, to });
      used.add(f.name);
      used.add(to.name);
    }
  });
  return { pairs, paired: used };
}

function presetRanges() {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  const q = Math.floor(m / 3) * 3;
  const r = (a, b) => [toDmy(a), toDmy(b)];
  return [
    { id: "today", label: "Today", range: r(t, t) },
    { id: "thisMonth", label: "This month", range: r(new Date(y, m, 1), new Date(y, m + 1, 0)) },
    { id: "lastMonth", label: "Last month", range: r(new Date(y, m - 1, 1), new Date(y, m, 0)) },
    { id: "thisQuarter", label: "This quarter", range: r(new Date(y, q, 1), new Date(y, q + 3, 0)) },
    { id: "thisYear", label: "This year", range: r(new Date(y, 0, 1), new Date(y, 11, 31)) },
    { id: "lastYear", label: "Last year", range: r(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)) },
  ];
}

// react-select in theme tokens (dark mode) on top of the app's selectStyles.
const base = selectStyles(false);
const reportSelectStyles = (locked) => ({
  ...base,
  control: (b, s) => ({
    ...base.control(b, s),
    minHeight: 38,
    backgroundColor: locked ? "hsl(var(--muted))" : "hsl(var(--background))",
    cursor: locked ? "not-allowed" : "default",
  }),
  singleValue: (b) => ({ ...b, color: "hsl(var(--foreground))" }),
  input: (b) => ({ ...b, color: "hsl(var(--foreground))" }),
  multiValue: (b) => ({ ...b, backgroundColor: "hsl(var(--primary) / 0.1)", borderRadius: 6 }),
  multiValueLabel: (b) => ({ ...b, color: "hsl(var(--foreground))", fontSize: 12.5 }),
  multiValueRemove: (b) => ({ ...b, color: "hsl(var(--primary))", ":hover": { backgroundColor: "hsl(var(--primary) / 0.15)" } }),
  menu: (b) => ({ ...base.menu(b), zIndex: 9999, border: "1px solid hsl(var(--border))" }),
  menuPortal: (b) => ({ ...b, zIndex: 9999 }),
  indicatorSeparator: (b) => ({ ...b, backgroundColor: "hsl(var(--border))" }),
  noOptionsMessage: (b) => ({ ...b, color: "hsl(var(--muted-foreground))", fontSize: 13 }),
});

// ── controls ────────────────────────────────────────────────────────────────

// Enter walks the panel's fields in order, Shift+Enter walks back; past the
// last field Enter lands on Apply. One control per field carries data-rf-nav
// (react-select inputs are found by their rf-<name> id).
function moveFocus(from, dir = 1) {
  const panel = from?.closest?.("[data-rf-panel]");
  if (!panel) return;
  const list = [...panel.querySelectorAll('[data-rf-nav], input[id^="rf-"]')].filter(
    (el) => !el.disabled && el.offsetParent !== null,
  );
  const i = list.findIndex((el) => el === from || el.contains(from));
  const next = list[i + dir];
  if (next) next.focus();
  else if (dir > 0) panel.querySelector("[data-rf-apply]")?.focus();
}
const isPlainEnter = (e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey;

function FieldShell({ name, label, required, locked, canClear, onClear, flash, children }) {
  return (
    <div
      data-filter-field={name}
      className={`min-w-0 space-y-1.5 rounded-lg transition-shadow duration-500 ${flash ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""}`}
    >
      <div className="flex min-h-[18px] items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
          <span className="truncate">{label}</span>
          {required && <span className="text-primary" aria-label="required">*</span>}
          {locked && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Locked</span>
          )}
        </span>
        {canClear && (
          <button
            type="button"
            onClick={onClear}
            title={`Clear ${label}`}
            aria-label={`Clear ${label}`}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// DD-MM-YYYY typed with auto dashes (as before) + a calendar. Commits on
// blur / Enter / a calendar pick, so a half-typed date never reaches the filters.
function DateInput({ value, onCommit, disabled, ariaLabel }) {
  const [local, setLocal] = useState(value || "");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => setLocal(value || ""), [value]);

  const commit = () => {
    if (local && !/^\d{2}-\d{2}-\d{4}$/.test(local)) console.warn(`Invalid date format: ${local}. Expected DD-MM-YYYY`);
    if (local !== (value || "")) onCommit(local);
  };

  const onChange = (e) => {
    const el = e.target;
    const raw = el.value;
    const deleting = raw.length < local.length;
    const digitsBefore = raw.slice(0, el.selectionStart).replace(/\D/g, "").length;
    const c = raw.replace(/\D/g, "").slice(0, 8);
    let out = "";
    if (c.length) {
      if (c.length <= 2) out = c + (!deleting && c.length === 2 ? "-" : "");
      else if (c.length <= 4) out = `${c.slice(0, 2)}-${c.slice(2)}${!deleting && c.length === 4 ? "-" : ""}`;
      else out = `${c.slice(0, 2)}-${c.slice(2, 4)}-${c.slice(4)}`;
    }
    setLocal(out);
    requestAnimationFrame(() => {
      const input = ref.current;
      if (!input) return;
      let seen = 0;
      let pos = out.length;
      for (let i = 0; i < out.length; i++) {
        if (/\d/.test(out[i])) seen++;
        if (seen === digitsBefore) {
          pos = i + 1;
          if (!deleting && out[pos] === "-") pos++;
          break;
        }
      }
      input.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="flex h-[38px] min-w-0 items-center rounded-lg border border-input bg-background focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/10">
      <input
        ref={ref}
        value={local}
        placeholder="DD-MM-YYYY"
        inputMode="numeric"
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={onChange}
        onBlur={commit}
        data-rf-nav=""
        onKeyDown={(e) => {
          if (isPlainEnter(e)) {
            e.preventDefault();
            commit();
            moveFocus(e.currentTarget, e.shiftKey ? -1 : 1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm tabular-nums text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-50"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={parseDmy(value) || undefined}
            defaultMonth={parseDmy(value) || undefined}
            onSelect={(d) => {
              if (d && !Number.isNaN(d.getTime())) {
                onCommit(toDmy(d));
                setOpen(false);
              }
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SelectInput({ filter, label, placeholder, value, rawOptions, loading, onChange }) {
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const pickedByEnter = useRef(false);
  const multi = !!(filter.multiple || filter.isMulti);
  const allLabel = `All ${typeof label === "string" ? label.toLowerCase() : "items"}`;

  const options = useMemo(
    () => [
      ...(filter.clearable ? [{ value: "all", label: allLabel }] : []),
      ...(rawOptions || []).map((opt) => ({ value: optionValue(filter, opt), label: String(optionLabel(filter, opt)), rawOpt: opt })),
    ],
    [filter, rawOptions, allLabel],
  );

  // Exact, then starts-with, then contains matches first while searching.
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const score = (o) => {
      if (o.value === "all") return 999;
      const l = String(o.label || "").toLowerCase();
      const r = o.rawOpt || {};
      const code = String(r.code || "").toLowerCase();
      const item = String(r.item || "").toLowerCase();
      const itcd = String(r.itcd || "");
      const v = String(o.value || "").toLowerCase();
      if (q === code || q === item || q === itcd || q === v || q === l) return 0;
      if (code.startsWith(q) || item.startsWith(q) || itcd.startsWith(q) || l.startsWith(q) || l.includes(" - " + q) || l.includes(" " + q)) return 1;
      if (l.includes(q) || code.includes(q) || item.includes(q)) return 2;
      return 3;
    };
    return [...options].sort((a, b) => score(a) - score(b));
  }, [options, query]);

  const selected = useMemo(() => {
    const find = (v) => options.find((o) => o.value !== "all" && o.value === String(v)) || null;
    if (multi) {
      if (isEmptyFilterValue(value)) return [];
      const vals = Array.isArray(value) ? value : String(value).split(",");
      return vals.map(find).filter(Boolean);
    }
    if (isEmptyFilterValue(value)) return filter.clearable ? { value: "all", label: allLabel } : null;
    return find(value);
  }, [options, value, multi, filter.clearable, allLabel]);

  return (
    <Select
      inputId={`rf-${filter.name}`}
      value={selected}
      onChange={(opt) => {
        if (multi) onChange(opt ? opt.map((o) => o.value).join(",") : "");
        else onChange(opt ? opt.value : "all");
        // Picked with Enter: go on to the next field (a multi-select stays,
        // so more can be added; Enter on its closed list moves on).
        if (pickedByEnter.current && !multi) {
          const input = document.getElementById(`rf-${filter.name}`);
          requestAnimationFrame(() => moveFocus(input, 1));
        }
        pickedByEnter.current = false;
      }}
      onKeyDown={(e) => {
        if (!isPlainEnter(e)) return;
        if (e.shiftKey) {
          e.preventDefault();
          moveFocus(e.target, -1);
        } else if (!menuOpen) {
          e.preventDefault(); // react-select skips its own Enter handling
          moveFocus(e.target, 1);
        } else {
          // react-select picks the highlighted option in this same key press;
          // clear the flag after it so a later mouse pick doesn't jump fields.
          pickedByEnter.current = true;
          setTimeout(() => (pickedByEnter.current = false), 0);
        }
      }}
      onMenuOpen={() => setMenuOpen(true)}
      onMenuClose={() => setMenuOpen(false)}
      onInputChange={setQuery}
      options={sorted}
      placeholder={placeholder || `Select ${typeof label === "string" ? label.toLowerCase() : "option"}`}
      isSearchable={!filter.locked}
      isClearable={filter.locked ? false : !!filter.clearable}
      isDisabled={!!filter.locked}
      isMulti={multi}
      isLoading={!!loading}
      menuPosition="fixed"
      menuPlacement="auto"
      closeMenuOnScroll={(e) => !e.target?.closest?.(".rf-select__menu-list")}
      classNamePrefix="rf-select"
      styles={reportSelectStyles(!!filter.locked)}
      aria-label={typeof label === "string" ? label : filter.name}
      className="min-w-0 text-sm"
    />
  );
}

function TextInput({ filter, label, value, onChange }) {
  return (
    <Input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      inputMode={filter.type === "number" ? "decimal" : undefined}
      data-rf-nav=""
      onKeyDown={(e) => {
        if (isPlainEnter(e)) {
          e.preventDefault();
          moveFocus(e.currentTarget, e.shiftKey ? -1 : 1);
        }
      }}
      placeholder={filter.placeholder || `Enter ${String(label || "").toLowerCase()}`}
      aria-label={typeof label === "string" ? label : filter.name}
      className="h-[38px]"
    />
  );
}

// ── the panel ───────────────────────────────────────────────────────────────

const SECTION_TITLES = { period: "Period", who: "Who & what", display: "Display" };

/**
 * open / onOpenChange   panel visibility (onOpenChange(false) only after pending
 *                       edits are applied or the user agreed to discard them)
 * filters               the applied filters
 * filterOptions         option lists by filter name (ReportViewer's filterOptions)
 * loadingNames          Set of filter names whose options are still loading
 * hiddenNames           filters shown elsewhere (the summary-type tabs)
 * focusField            filter to scroll to + focus when the panel opens
 * onApply(next)         apply the pending values (only called when they differ)
 * onRefresh()           Apply with nothing changed = refresh, as before
 * onDraftChange(draft)  pending values, so dependent option lists can load
 */
export function ReportFilterPanel({
  open,
  onOpenChange,
  isMobile,
  config,
  filters,
  filterOptions,
  loadingNames,
  hiddenNames,
  focusField,
  isFetching,
  onApply,
  onRefresh,
  onDraftChange,
}) {
  const [draft, setDraft] = useState(filters);
  const draftRef = useRef(filters);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const bodyRef = useRef(null);

  const update = (fn) => {
    const next = fn(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    onDraftChange?.(next);
  };

  // Each opening starts from the applied filters.
  useEffect(() => {
    if (!open) {
      onDraftChange?.(null);
      return;
    }
    draftRef.current = { ...filters };
    setDraft({ ...filters });
    onDraftChange?.({ ...filters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const defs = useMemo(
    () => (config?.filters || []).filter((f) => !hiddenNames?.has(f.name)),
    [config, hiddenNames],
  );
  const { pairs, paired } = useMemo(() => datePairs(defs), [defs]);

  const pendingNames = (d) => defs.filter((f) => norm(d[f.name]) !== norm(filters[f.name])).map((f) => f.name);
  const pending = open ? pendingNames(draft).length : 0;
  const activeCount = defs.filter((f) => !isEmptyFilterValue(draft[f.name])).length;

  // A focused text/date box commits on blur — take it first.
  const settleFocus = () => {
    const el = typeof document !== "undefined" ? document.activeElement : null;
    if (el && bodyRef.current?.contains(el) && el.tagName === "INPUT") el.blur();
  };

  const apply = () => {
    settleFocus();
    const next = draftRef.current;
    if (pendingNames(next).length) onApply(next);
    else onRefresh();
    onOpenChange(false);
  };

  const requestClose = () => {
    settleFocus();
    if (pendingNames(draftRef.current).length) setConfirmOpen(true);
    else onOpenChange(false);
  };

  const resetToDefaults = () => {
    update((d) => {
      const next = { ...d };
      defs.forEach((f) => {
        next[f.name] = f.locked && f.default !== undefined ? f.default : defaultFilterValue(f);
      });
      return next;
    });
  };

  // Open on the chip's field (or the first one) and show where it is.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const root = bodyRef.current;
      if (!root) return;
      const box = focusField ? root.querySelector(`[data-filter-field="${CSS.escape(focusField)}"]`) : null;
      const target = box || root;
      if (box) {
        box.scrollIntoView({ block: "center" });
        setFlash(focusField);
        setTimeout(() => setFlash(null), 1200);
      }
      const input = target.querySelector('input:not([type="hidden"]):not([disabled]), button[role="switch"]');
      if (input && !isMobile) input.focus();
    }, 120);
    return () => clearTimeout(t);
  }, [open, focusField, isMobile]);

  const setValue = (name, value) => update((d) => withDependents(config.filters, d, name, value));
  const labelOf = (f) => filterLabelOf(f, draft);
  const canClear = (f) => !f.locked && !f.required && !isEmptyFilterValue(draft[f.name]);

  const renderControl = (f) => {
    const label = labelOf(f);
    const value = draft[f.name];
    if (f.type === "date") {
      return (
        <DateInput value={typeof value === "string" ? value : value instanceof Date ? toDmy(value) : ""} disabled={!!f.locked} ariaLabel={label} onCommit={(v) => setValue(f.name, v)} />
      );
    }
    if (f.type === "select") {
      const placeholder = typeof f.placeholder === "function" ? f.placeholder(draft) : f.placeholder;
      return (
        <SelectInput
          filter={f}
          label={label}
          placeholder={placeholder}
          value={value}
          rawOptions={filterOptions?.[f.name]}
          loading={loadingNames?.has(f.name)}
          onChange={(v) => setValue(f.name, v)}
        />
      );
    }
    return <TextInput filter={f} label={label} value={value} onChange={(v) => setValue(f.name, v)} />;
  };

  const renderField = (f) => {
    if (f.type === "checkbox") {
      const label = labelOf(f);
      return (
        <label
          key={f.name}
          data-filter-field={f.name}
          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted/50 ${flash === f.name ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""}`}
        >
          <span className="text-sm text-foreground">
            {label}
            {f.required && <span className="ml-1 text-primary">*</span>}
          </span>
          <Switch
            checked={!!draft[f.name] && draft[f.name] !== "false"}
            disabled={!!f.locked}
            onCheckedChange={(c) => setValue(f.name, c)}
            aria-label={label}
            data-rf-nav=""
            onKeyDown={(e) => {
              // Space toggles; Enter moves on like every other field.
              if (isPlainEnter(e)) {
                e.preventDefault();
                moveFocus(e.currentTarget, e.shiftKey ? -1 : 1);
              }
            }}
          />
        </label>
      );
    }
    return (
      <FieldShell
        key={f.name}
        name={f.name}
        label={labelOf(f)}
        required={!!f.required}
        locked={!!f.locked}
        flash={flash === f.name}
        canClear={canClear(f)}
        onClear={() => setValue(f.name, "")}
      >
        {renderControl(f)}
      </FieldShell>
    );
  };

  const presets = useMemo(() => (open ? presetRanges() : []), [open]);
  const renderRange = ({ from, to }, i) => {
    const locked = from.locked || to.locked;
    const clearable = !locked && !from.required && !to.required && (!isEmptyFilterValue(draft[from.name]) || !isEmptyFilterValue(draft[to.name]));
    const fv = draft[from.name] instanceof Date ? toDmy(draft[from.name]) : draft[from.name] || "";
    const tv = draft[to.name] instanceof Date ? toDmy(draft[to.name]) : draft[to.name] || "";
    const fromLabel = labelOf(from);
    const toLabel = labelOf(to);
    return (
      <div key={`${from.name}-${to.name}`} className="space-y-2">
        <FieldShell
          name={from.name}
          label={pairs.length === 1 ? "Date range" : `${fromLabel} – ${toLabel}`}
          required={!!(from.required || to.required)}
          locked={!!locked}
          flash={flash === from.name || flash === to.name}
          canClear={clearable}
          onClear={() => update((d) => ({ ...d, [from.name]: "", [to.name]: "" }))}
        >
          <div data-filter-field={to.name} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
            <DateInput value={fv} disabled={!!from.locked} ariaLabel={fromLabel} onCommit={(v) => setValue(from.name, v)} />
            <span className="text-xs text-muted-foreground">–</span>
            <DateInput value={tv} disabled={!!to.locked} ariaLabel={toLabel} onCommit={(v) => setValue(to.name, v)} />
          </div>
        </FieldShell>
        {i === 0 && !locked && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick periods">
            {presets.map((p) => {
              const on = fv === p.range[0] && tv === p.range[1];
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update((d) => ({ ...d, [from.name]: p.range[0], [to.name]: p.range[1] }))}
                  className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const sections = ["period", "who", "display"]
    .map((id) => {
      const fields = defs.filter((f) => filterSection(f) === id);
      if (!fields.length) return null;
      const items = [];
      if (id === "period") {
        // Keep config order; a pair renders where its "from" filter is.
        fields.forEach((f) => {
          const pIdx = pairs.findIndex((p) => p.from.name === f.name);
          if (pIdx >= 0) items.push(renderRange(pairs[pIdx], pIdx));
          else if (!paired.has(f.name)) items.push(renderField(f));
        });
      } else {
        fields.forEach((f) => items.push(renderField(f)));
      }
      return (
        <section key={id} className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary">{SECTION_TITLES[id]}</h3>
          {items}
        </section>
      );
    })
    .filter(Boolean);

  const header = (
    <SheetHeader className="shrink-0 space-y-0 border-b border-border bg-primary/5 px-5 py-3 pr-12 text-left">
      <SheetTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FilterIcon className="h-4 w-4 text-primary" />
        Filters
        {activeCount > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{activeCount} active</span>
        )}
      </SheetTitle>
      <SheetDescription className="sr-only">Choose the report filters, then Apply.</SheetDescription>
    </SheetHeader>
  );

  const footer = (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-3">
      <Button type="button" variant="ghost" size="sm" onClick={resetToDefaults} className="h-8 px-2.5 text-xs text-muted-foreground hover:text-primary">
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to defaults
      </Button>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {pending > 0 && (
          <span className="text-xs font-medium text-primary" aria-live="polite">
            {pending} change{pending === 1 ? "" : "s"} not applied
          </span>
        )}
        <Button type="button" variant="outline" size="sm" onClick={requestClose} className="h-8 px-4 text-xs">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={apply}
          disabled={isFetching && pending === 0}
          data-rf-apply=""
          title="Apply (Ctrl+Enter)"
          className="h-8 bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Apply
          {!isMobile && <kbd className="ml-2 rounded border border-primary-foreground/30 px-1 font-mono text-[10px] opacity-80">Ctrl+↵</kbd>}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}>
        <SheetContent
          data-rf-panel=""
          side={isMobile ? "bottom" : "right"}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={
            isMobile
              ? "flex max-h-[88dvh] flex-col gap-0 rounded-t-2xl p-0"
              : "flex h-full w-[440px] max-w-full flex-col gap-0 p-0 sm:max-w-[440px]"
          }
        >
          {header}
          <div ref={bodyRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
            {sections.length ? sections : <p className="text-sm text-muted-foreground">This report has no filters.</p>}
          </div>
          {footer}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard filter changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending} change{pending === 1 ? " has" : "s have"} not been applied. Closing the panel keeps the report as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── chip bar ────────────────────────────────────────────────────────────────

const plural = (s) => {
  const w = String(s || "item").toLowerCase();
  if (/(s|x|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
};

/**
 * One chip per applied filter; a date range is one chip. Clicking a chip opens
 * the panel on that field; × removes it at once (as the old bar did).
 * getFilterLabel(name, value) → display label (ReportViewer's).
 */
export function ReportFilterChips({ config, filters, hiddenNames, getFilterLabel, onOpen, onRemove }) {
  const defs = (config?.filters || []).filter((f) => !hiddenNames?.has(f.name));
  if (!defs.length) return null;
  const { pairs, paired } = datePairs(defs);
  const chips = [];

  pairs.forEach(({ from, to }) => {
    const a = filters[from.name];
    const b = filters[to.name];
    if (isEmptyFilterValue(a) && isEmptyFilterValue(b)) return;
    const removable = !from.locked && !to.locked && !from.required && !to.required;
    const text = formatRange(a, b);
    chips.push({ key: from.name, focus: from.name, names: [from.name, to.name], text, title: text, removable });
  });

  defs.forEach((f) => {
    if (paired.has(f.name)) return;
    const raw = filters[f.name];
    if (isEmptyFilterValue(raw)) return;
    const label = filterLabelOf(f, filters);
    const removable = !f.locked && !f.required;
    let value;
    let title;
    if (f.type === "checkbox") {
      value = null;
    } else if (f.type === "date") {
      value = formatOneDate(raw);
    } else if (f.type === "select") {
      const vals = f.multiple || f.isMulti || String(raw).includes(",") ? String(raw).split(",").map((v) => v.trim()).filter(Boolean) : [String(raw)];
      const labels = vals.map((v) => String(getFilterLabel(f.name, v) || v));
      if (labels.length > 2) {
        value = `${labels.length} ${plural(label)}`;
        title = `${label}: ${labels.join(", ")}`;
      } else {
        value = labels.join(", ");
      }
    } else {
      value = String(raw);
    }
    chips.push({
      key: f.name,
      focus: f.name,
      names: [f.name],
      label: value === null ? null : label,
      text: value === null ? label : value,
      title: title || (value === null ? label : `${label}: ${value}`),
      removable,
      locked: !!f.locked,
    });
  });

  const removable = chips.filter((c) => c.removable);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border bg-muted/40 px-2 py-2 sm:px-4">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex h-8 min-w-0 max-w-full items-center rounded-full border border-border bg-background text-xs text-foreground sm:h-[26px]"
        >
          <button
            type="button"
            onClick={() => onOpen(c.focus)}
            title={c.title}
            className="inline-flex h-full min-w-0 items-center gap-1 rounded-full pl-2.5 pr-2 hover:text-primary"
          >
            {c.label && <b className="shrink-0 font-semibold">{c.label}:</b>}
            <span className="max-w-[min(180px,55vw)] truncate sm:max-w-[280px]">{c.text}</span>
          </button>
          {c.removable && (
            <button
              type="button"
              onClick={() => onRemove(c.names)}
              aria-label={`Remove ${c.title}`}
              title="Remove filter"
              className="-ml-1 mr-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary sm:mr-1 sm:h-5 sm:w-5"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      <button
        type="button"
        onClick={() => onOpen(null)}
        title="Filters (Alt+F)"
        className="inline-flex h-8 items-center rounded-full border border-dashed border-primary/50 px-2.5 text-xs font-medium text-primary hover:bg-primary/5 sm:h-[26px]"
      >
        + Filter
      </button>
      {removable.length >= 2 && (
        <button
          type="button"
          onClick={() => onRemove(removable.flatMap((c) => c.names))}
          className="ml-auto h-8 px-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-primary hover:underline sm:h-auto"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ── summary-type tabs ───────────────────────────────────────────────────────

// Underline tabs for the `type` filter; a click applies at once.
export function SummaryTypeTabs({ filter, value, onChange }) {
  if (!filter) return null;
  const opts = filter.options.map((o) => ({ value: String(o?.value ?? o), label: String(o?.label ?? o) }));
  return (
    <div role="tablist" aria-label={typeof filter.label === "string" ? filter.label : "Summary type"} className="flex overflow-x-auto border-b border-border bg-background px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {opts.map((o) => {
        const on = String(value ?? "") === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => !on && onChange(o.value)}
            className={`-mb-px min-h-10 shrink-0 whitespace-nowrap border-b-2 px-3 pb-2 pt-2.5 text-[13px] transition-colors ${
              on ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
