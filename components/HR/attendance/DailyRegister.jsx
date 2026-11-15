"use client";

// components/HR/attendance/DailyRegister.jsx — one day, every employee.
//
// In / out are typed straight into the table ("830" → 08:30). Each row shows
// what the day comes to under the employee's shift (same rules the server
// saves with — lib/hr/attendance/rules.js) before it is saved. Days older than
// the rule allows, or recorded by the machine, go to Approvals with a reason.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Search, Save, Undo2, Lock, Hourglass, Cpu, FileSpreadsheet, PenLine,
  AlertTriangle, CalendarDays, Wand2, UserCheck, UserX, Plane, Coffee, Eraser, Loader2, PartyPopper, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { computeDay, entryInstants, MANUAL_STATUSES, STATUS_META } from "@/lib/hr/attendance/rules";
import { addDays, fmtMinutes, normalizeHm } from "@/lib/hr/time";
import { api, BRAND_BTN, CHIP, EmployeeCell, EmptyState, fmtDayLong, NativeSelect, ShiftChip, StatusChip, TH } from "@/components/HR/shared";

const FILTERS = [
  { key: "ALL", label: "All" },
  { key: "PRESENT", label: "Present" },
  { key: "LATE", label: "Late" },
  { key: "HALF_DAY", label: "Half day" },
  { key: "ABSENT", label: "Absent" },
  { key: "LEAVE", label: "Leave" },
  { key: "OFFDAY", label: "Off / holiday" },
  { key: "PENDING", label: "Not marked" },
  { key: "REVIEW", label: "Needs review" },
];

const SOURCE_ICON = {
  DEVICE: { icon: Cpu, label: "From the attendance machine" },
  IMPORT: { icon: FileSpreadsheet, label: "Imported from a file" },
  MANUAL: { icon: PenLine, label: "Entered by hand" },
};

// Dialogs: near full width on phones, scroll when tall; footer buttons stack with a gap.
const DIALOG = "w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6";
const DIALOG_FOOTER = "gap-2 sm:space-x-0";

// A row's status as one key: AUTO, PRESENT, … or LEAVE:<type id>[:H] (half day).
const savedKey = (row) =>
  !row.status_override
    ? "AUTO"
    : row.status === "LEAVE" && row.leave_type_id
      ? `LEAVE:${row.leave_type_id}${row.leave_half ? ":H" : ""}`
      : row.status;
const parseKey = (key) => {
  const [status, type, half] = String(key).split(":");
  return status === "LEAVE" ? { status, leave_type_id: Number(type) || null, leave_half: half === "H" } : { status, leave_type_id: null, leave_half: false };
};

const matches = (filter, row) => {
  if (filter === "ALL") return true;
  if (filter === "REVIEW") return row.view.needs_review;
  if (filter === "OFFDAY") return row.view.status === "OFF" || row.view.status === "HOLIDAY";
  return row.view.status === filter;
};

export default function DailyRegister({ meta, date, setDate, focus }) {
  const qc = useQueryClient();
  const rights = meta.rights;
  const canEdit = rights.mark || rights.approve;
  const shiftById = useMemo(() => new Map(meta.shifts.map((s) => [s.id, s])), [meta.shifts]);
  const leaveTypes = useMemo(() => (meta.leaveTypes ?? []).filter((t) => t.is_active), [meta.leaveTypes]);
  const leaveTypeById = useMemo(() => new Map((meta.leaveTypes ?? []).map((t) => [t.id, t])), [meta.leaveTypes]);

  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [edits, setEdits] = useState({}); // employee_id → { check_in, check_out, status, remarks }
  const [invalid, setInvalid] = useState({}); // `${id}|in` → true
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [reasonAsk, setReasonAsk] = useState(null); // { heldCount }
  const [reason, setReason] = useState("");
  const [pendingDate, setPendingDate] = useState(null); // asked to leave a day with unsaved edits

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Opened from a monthly-sheet cell: show that employee.
  useEffect(() => {
    if (!focus) return;
    setSearch(String(focus.id));
    setFilter("ALL");
  }, [focus]);

  const params = new URLSearchParams({ date, ...(department && { department }), ...(location && { location }), ...(q && { q }) });
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["hr-att-day", date, department, location, q],
    queryFn: () => api(`/api/hr/attendance?${params}`),
  });

  const dirtyCount = Object.keys(edits).length;
  const today = data?.today ?? meta.today;

  // Leaving the day with unsaved changes asks first.
  const goTo = (d) => {
    if (d === date) return;
    if (dirtyCount) setPendingDate(d);
    else setDate(d);
  };
  useEffect(() => {
    setEdits({});
    setInvalid({});
    setSelected(new Set());
  }, [date]);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.map((r) => {
      const e = edits[r.employee.id];
      const cur = {
        check_in: e ? e.check_in : r.check_in,
        check_out: e ? e.check_out : r.check_out,
        status: e ? e.status : savedKey(r),
        remarks: e ? e.remarks : r.remarks ?? "",
      };
      let view = r;
      if (e) {
        const shift = r.shift ? shiftById.get(r.shift.id) : null;
        const { checkIn, checkOut } = entryInstants(shift, date, cur.check_in, cur.check_out);
        const k = parseKey(cur.status);
        const c = computeDay({ shift, dayKey: date, dayType: r.day_type, checkIn, checkOut, manualStatus: cur.status === "AUTO" ? null : k.status, today });
        view = { ...r, ...c, status_override: cur.status !== "AUTO", leave_type_id: k.leave_type_id, leave_half: k.leave_half };
      }
      // Days of an approved leave request are changed on HR → Leave.
      const blocked = r.locked || Boolean(r.waiting_request) || Boolean(r.leave_request_id) || !canEdit;
      return { ...r, cur, view, dirty: Boolean(e), blocked };
    });
  }, [data, edits, shiftById, date, today, canEdit]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map((f) => [f.key, 0]));
    for (const r of rows) for (const f of FILTERS) if (matches(f.key, r)) c[f.key] += 1;
    return c;
  }, [rows]);
  const visible = useMemo(() => rows.filter((r) => matches(filter, r)), [rows, filter]);
  const editable = visible.filter((r) => !r.blocked);

  const setField = (row, field, value) => {
    setEdits((prev) => {
      const base = prev[row.employee.id] ?? {
        check_in: row.check_in,
        check_out: row.check_out,
        status: savedKey(row),
        remarks: row.remarks ?? "",
      };
      const next = { ...base, [field]: value };
      const same =
        (next.check_in || null) === (row.check_in || null) &&
        (next.check_out || null) === (row.check_out || null) &&
        next.status === savedKey(row) &&
        (next.remarks || "") === (row.remarks || "");
      const out = { ...prev };
      if (same) delete out[row.employee.id];
      else out[row.employee.id] = next;
      return out;
    });
  };

  const setTime = (row, field, raw) => {
    const key = `${row.employee.id}|${field}`;
    const text = String(raw ?? "").trim();
    const hm = text ? normalizeHm(text) : null;
    setInvalid((p) => {
      const n = { ...p };
      if (text && !hm) n[key] = true;
      else delete n[key];
      return n;
    });
    if (!text || hm) setField(row, field, hm);
  };

  const applyBulk = (targets, patch) => {
    if (!targets.length) return;
    setEdits((prev) => {
      const out = { ...prev };
      for (const row of targets) {
        const base = out[row.employee.id] ?? { check_in: row.check_in, check_out: row.check_out, status: savedKey(row), remarks: row.remarks ?? "" };
        out[row.employee.id] = { ...base, ...patch(row) };
      }
      return out;
    });
  };

  const selectedRows = editable.filter((r) => selected.has(r.employee.id));
  const bulk = {
    present: () => applyBulk(selectedRows.filter((r) => r.shift), (r) => ({ check_in: r.shift.start_time, check_out: date < today ? r.shift.end_time : null, status: "AUTO" })),
    absent: () => applyBulk(selectedRows, () => ({ check_in: null, check_out: null, status: "ABSENT" })),
    leave: (key) => applyBulk(selectedRows, () => ({ check_in: null, check_out: null, status: key })),
    off: () => applyBulk(selectedRows, () => ({ check_in: null, check_out: null, status: "OFF" })),
    clear: () => applyBulk(selectedRows, () => ({ check_in: null, check_out: null, status: "AUTO", remarks: "" })),
  };
  const fillShiftTimes = () => {
    const targets = editable.filter((r) => r.shift && !r.cur.check_in && r.cur.status === "AUTO" && r.day_type === "WORK");
    if (!targets.length) return toast.info("Every working row already has an in time.");
    applyBulk(targets, (r) => ({ check_in: r.shift.start_time, check_out: date < today ? r.shift.end_time : null }));
    toast.success(`Shift times filled for ${targets.length} employee(s) — review and save.`);
  };

  const save = useCallback(
    async (withReason) => {
      if (!dirtyCount || saving) return;
      if (Object.keys(invalid).length) return toast.error("Fix the times marked in red first.");
      const entries = Object.entries(edits).map(([id, e]) => ({
        employee_id: Number(id),
        date,
        check_in: e.check_in || null,
        check_out: e.check_out || null,
        ...parseKey(e.status),
        remarks: e.remarks || null,
      }));
      setSaving(true);
      try {
        const r = await api("/api/hr/attendance", { method: "POST", body: { entries, reason: withReason || undefined } });
        toast.success(r.message);
        setEdits({});
        setSelected(new Set());
        setReasonAsk(null);
        setReason("");
        await refetch();
        qc.invalidateQueries({ queryKey: ["hr-att-month"] });
      } catch (e) {
        if (e.data?.needsReason) setReasonAsk({ heldCount: e.data.heldCount });
        else toast.error(e.message);
      } finally {
        setSaving(false);
      }
    },
    [dirtyCount, saving, invalid, edits, date, refetch, qc],
  );

  // Ctrl+S saves.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Enter / ↓ / ↑ move between rows in the same column.
  const onCellKey = (ev) => {
    if (!["Enter", "ArrowDown", "ArrowUp"].includes(ev.key)) return;
    const el = ev.currentTarget;
    const col = el.dataset.col;
    const idx = Number(el.dataset.idx);
    const next = document.querySelector(`[data-col="${col}"][data-idx="${idx + (ev.key === "ArrowUp" ? -1 : 1)}"]`);
    if (next) {
      ev.preventDefault();
      el.blur();
      next.focus();
      next.select?.();
    }
  };

  const allSelected = editable.length > 0 && editable.every((r) => selected.has(r.employee.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(editable.map((r) => r.employee.id)));
  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Status editor / chip and the row's flags — shared by the phone card and the table row.
  const statusCell = (r, compact) =>
    r.blocked ? (
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip status={r.view.status} manual={r.view.status_override && !r.leave_request_id} />
        <LeaveTag row={r.view} types={leaveTypeById} request={r.leave_request_id} />
      </div>
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          value={r.cur.status}
          onChange={(e) => setField(r, "status", e.target.value)}
          className={compact ? "h-9 min-w-0 flex-1 text-sm" : "h-8 w-[118px] text-xs"}
          aria-label={`Status of ${r.employee.name}`}
        >
          <option value="AUTO">Auto</option>
          {MANUAL_STATUSES.filter((s) => s !== "LEAVE").map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
          <optgroup label="Leave">
            {leaveTypes.map((t) => [
              <option key={t.id} value={`LEAVE:${t.id}`}>{t.name}</option>,
              t.allow_half_day && <option key={`${t.id}h`} value={`LEAVE:${t.id}:H`}>{t.name} — ½ day</option>,
            ])}
          </optgroup>
        </NativeSelect>
        {r.cur.status === "AUTO" && <StatusChip status={r.view.status} />}
        {r.cur.status.startsWith("LEAVE") && <LeaveTag row={r.view} types={leaveTypeById} balanceOnly />}
      </div>
    );

  const minuteTags = (r) =>
    r.view.late_minutes > 0 || r.view.early_minutes > 0 || r.view.overtime_minutes > 0 ? (
      <>
        {r.view.late_minutes > 0 && <MinuteTag tone="amber" label="Late" min={r.view.late_minutes} />}
        {r.view.early_minutes > 0 && <MinuteTag tone="orange" label="Early" min={r.view.early_minutes} />}
        {r.view.overtime_minutes > 0 && <MinuteTag tone="emerald" label="OT" min={r.view.overtime_minutes} />}
      </>
    ) : null;

  const flags = (r) => {
    const SourceIcon = r.view.source ? SOURCE_ICON[r.view.source]?.icon : null;
    return (
      <div className="flex items-center justify-end gap-1.5 text-muted-foreground">
        {r.view.needs_review && <span title="Only one punch, or out before in — check this day"><AlertTriangle className="h-4 w-4 text-amber-500" aria-label="Needs review" /></span>}
        {r.locked && <span title="Payroll posted — locked"><Lock className="h-4 w-4" aria-label="Locked" /></span>}
        {r.waiting_request && (
          <Link href="/dashboard/approvals" title={`A correction is waiting for approval (#R-${r.waiting_request})`} aria-label="Correction waiting for approval">
            <Hourglass className="h-4 w-4 text-primary" />
          </Link>
        )}
        {SourceIcon && <span title={SOURCE_ICON[r.view.source].label}><SourceIcon className="h-4 w-4" aria-label={SOURCE_ICON[r.view.source].label} /></span>}
      </div>
    );
  };

  const rowTone = (r) =>
    cn(
      r.dirty ? "bg-[#f5f0e6]/70 shadow-[inset_3px_0_0_#b8862b] dark:bg-amber-950/20" : "hover:bg-primary/[0.03]",
      r.blocked && canEdit && !r.dirty && "bg-muted/40",
    );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => goTo(addDays(date, -1))} title="Previous day" aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              max={addDays(today, 60)}
              onChange={(e) => e.target.value && goTo(e.target.value)}
              className="h-9 w-full pl-8 sm:w-[165px]"
              aria-label="Day"
            />
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => goTo(addDays(date, 1))} title="Next day" aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-9 shrink-0 text-primary hover:bg-primary/5 hover:text-primary" onClick={() => goTo(today)} disabled={date === today}>
            Today
          </Button>
        </div>
        <div className="hidden h-6 w-px bg-border lg:block" />
        <p className="flex items-center gap-2 whitespace-nowrap text-sm font-bold text-foreground">
          {fmtDayLong(date)}
          {date === today && <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide", CHIP.brand)}>Today</span>}
        </p>
        <div className="grid flex-1 grid-cols-1 gap-2 sm:flex sm:flex-wrap lg:flex-nowrap lg:justify-end">
          <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full sm:w-56" aria-label="Department">
            <option value="">All departments</option>
            {meta.departments.map((d) => (
              <option key={d.id} value={d.id}>{d.dept_name}</option>
            ))}
          </NativeSelect>
          {meta.locations?.length > 1 && (
            <NativeSelect value={location} onChange={(e) => setLocation(e.target.value)} className="w-full sm:w-44" aria-label="Location">
              <option value="">All locations</option>
              {meta.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </NativeSelect>
          )}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee no." className="h-9 pl-8" aria-label="Search employees" />
          </div>
        </div>
      </div>

      {data?.holiday && (
        <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-200">
          <PartyPopper className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <b>{data.holiday.name}</b> — {data.holiday.is_paid ? "paid" : "unpaid"} holiday. Anyone who works today gets the hours as overtime.
          </p>
        </div>
      )}

      {/* Status filters with counts */}
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map((f) => {
          const sm = STATUS_META[f.key];
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={on}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground/85 hover:border-primary/40 hover:text-primary",
              )}
            >
              {sm && <span className={cn("h-2 w-2 rounded-full", sm.dot, on && "ring-2 ring-white/70")} />}
              {f.key === "REVIEW" && <AlertTriangle className={cn("h-3.5 w-3.5", on ? "text-primary-foreground" : "text-amber-500")} />}
              {f.label}
              <span className={cn("rounded-full px-1.5 text-xs font-bold tabular-nums", on ? "bg-white/20" : "bg-primary/[0.07] text-primary")}>
                {isLoading ? "…" : counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bulk bar — sticks to the top while rows are ticked */}
      {canEdit && (
        <div
          className={cn(
            "rounded-xl border px-3 py-2.5",
            selectedRows.length
              ? "sticky top-2 z-20 border-primary/25 bg-background/95 shadow-md shadow-red-900/5 backdrop-blur"
              : "border-dashed border-border bg-background/60",
          )}
        >
          {selectedRows.length ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  <span className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">{selectedRows.length}</span>
                  selected
                </span>
                <Button size="sm" variant="ghost" className="h-9 sm:hidden" onClick={() => setSelected(new Set())}>Unselect</Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <Button size="sm" variant="outline" className="h-9 bg-background sm:h-8" onClick={bulk.present}><UserCheck className="mr-1.5 h-4 w-4 text-emerald-600 dark:text-emerald-400" />Present<span className="hidden sm:inline">&nbsp;(shift times)</span></Button>
                <Button size="sm" variant="outline" className="h-9 bg-background sm:h-8" onClick={bulk.absent}><UserX className="mr-1.5 h-4 w-4 text-red-600 dark:text-red-400" />Absent</Button>
                <div className="relative">
                  <Plane className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-600" />
                  <NativeSelect value="" onChange={(e) => e.target.value && bulk.leave(e.target.value)} className="h-9 w-full pl-8 text-sm sm:h-8 sm:w-auto" aria-label="Mark leave">
                    <option value="">Leave…</option>
                    {leaveTypes.map((t) => (
                      <option key={t.id} value={`LEAVE:${t.id}`}>{t.name}</option>
                    ))}
                  </NativeSelect>
                </div>
                <Button size="sm" variant="outline" className="h-9 bg-background sm:h-8" onClick={bulk.off}><Coffee className="mr-1.5 h-4 w-4 text-muted-foreground" />Week off</Button>
                <Button size="sm" variant="ghost" className="col-span-2 h-9 sm:col-span-1 sm:h-8" onClick={bulk.clear}><Eraser className="mr-1.5 h-4 w-4" />Clear</Button>
              </div>
              <Button size="sm" variant="ghost" className="hidden h-8 sm:ml-auto sm:inline-flex" onClick={() => setSelected(new Set())}>Unselect</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground/85 md:hidden">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} disabled={!editable.length} aria-label="Select all" />
                  Select all
                </label>
                <span className="hidden text-sm text-muted-foreground md:inline">Tick employees for bulk marking, or</span>
              </div>
              <Button size="sm" variant="outline" className="h-9 w-full bg-background sm:h-8 sm:w-auto" onClick={fillShiftTimes} disabled={!editable.length}>
                <Wand2 className="mr-1.5 h-4 w-4 text-primary" />Fill shift times<span className="hidden sm:inline">&nbsp;for everyone not marked</span>
              </Button>
              <span className="hidden text-xs text-muted-foreground md:ml-auto md:inline">Type times like 830 or 17:05 · Enter moves down · Ctrl+S saves</span>
            </div>
          )}
        </div>
      )}

      {/* Register */}
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {isLoading && (
          <div className="space-y-2 p-3 sm:p-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full md:h-8" />
            ))}
          </div>
        )}

        {/* Phone: one card per employee */}
        {!isLoading && visible.length > 0 && (
          <ul className="divide-y divide-border/60 md:hidden">
            {visible.map((r, idx) => (
              <li key={r.employee.id} className={cn("space-y-3 px-3 py-3", rowTone(r))}>
                <div className="flex items-start gap-3">
                  {canEdit && (
                    <Checkbox
                      className="mt-2.5"
                      checked={selected.has(r.employee.id)}
                      onCheckedChange={() => toggle(r.employee.id)}
                      disabled={r.blocked}
                      aria-label={`Select ${r.employee.name}`}
                    />
                  )}
                  <div className="min-w-0 flex-1"><EmployeeCell employee={r.employee} /></div>
                  <div className="pt-2">{flags(r)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ShiftChip shift={r.shift} />
                  {minuteTags(r)}
                </div>
                <div className="flex items-end gap-3">
                  {["check_in", "check_out"].map((field) => (
                    <label key={field} className="space-y-1">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{field === "check_in" ? "In" : "Out"}</span>
                      <TimeInput
                        value={r.cur[field]}
                        disabled={r.blocked}
                        invalid={invalid[`${r.employee.id}|${field}`]}
                        onCommit={(v) => setTime(r, field, v)}
                        onKeyDown={onCellKey}
                        col={`m-${field}`}
                        idx={idx}
                        suffix={field === "check_out" && r.view.check_out && r.out_next_day && !r.dirty ? "+1" : null}
                        className="h-9 w-[84px]"
                      />
                    </label>
                  ))}
                  <div className="ml-auto text-right">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Worked</span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{fmtMinutes(r.view.worked_minutes) || "—"}</span>
                  </div>
                </div>
                {statusCell(r, true)}
                {!(r.blocked && !r.cur.remarks) && (
                  <Input
                    value={r.cur.remarks ?? ""}
                    disabled={r.blocked}
                    onChange={(e) => setField(r, "remarks", e.target.value.slice(0, 300))}
                    placeholder={r.blocked ? "" : "Note…"}
                    className="h-9 text-sm"
                    aria-label={`Remarks for ${r.employee.name}`}
                    data-col="m-remarks"
                    data-idx={idx}
                    onKeyDown={onCellKey}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Tablet & up: the register table */}
        {!isLoading && visible.length > 0 && (
          // Long registers scroll inside the card so the maroon header stays in view.
          <div className="hidden max-h-[calc(100vh-15rem)] min-h-[320px] overflow-auto md:block">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
                <tr>
                  {canEdit && (
                    <th className={cn(TH, "w-10")}>
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                        className="border-white/80 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-primary"
                      />
                    </th>
                  )}
                  <th className={cn(TH, "text-left")}>Employee</th>
                  <th className={cn(TH, "text-left")}>Shift</th>
                  <th className={cn(TH, "px-2 text-center")}>In</th>
                  <th className={cn(TH, "px-2 text-center")}>Out</th>
                  <th className={cn(TH, "text-right")}>Worked</th>
                  <th className={cn(TH, "text-left")}>Late · Early · OT</th>
                  <th className={cn(TH, "text-left")}>Status</th>
                  <th className={cn(TH, "min-w-[180px] text-left")}>Remarks</th>
                  <th className={cn(TH, "w-16")}><span className="sr-only">Flags</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visible.map((r, idx) => (
                  <tr key={r.employee.id} className={cn("group transition-colors", rowTone(r))}>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <Checkbox checked={selected.has(r.employee.id)} onCheckedChange={() => toggle(r.employee.id)} disabled={r.blocked} aria-label={`Select ${r.employee.name}`} />
                      </td>
                    )}
                    <td className="max-w-[260px] px-3 py-2"><EmployeeCell employee={r.employee} /></td>
                    <td className="px-3 py-2"><ShiftChip shift={r.shift} /></td>
                    {["check_in", "check_out"].map((field) => (
                      <td key={field} className="px-2 py-2 text-center">
                        <TimeInput
                          value={r.cur[field]}
                          disabled={r.blocked}
                          invalid={invalid[`${r.employee.id}|${field}`]}
                          onCommit={(v) => setTime(r, field, v)}
                          onKeyDown={onCellKey}
                          col={field}
                          idx={idx}
                          suffix={field === "check_out" && r.view.check_out && r.out_next_day && !r.dirty ? "+1" : null}
                          ariaLabel={`${field === "check_in" ? "In" : "Out"} time of ${r.employee.name}`}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{fmtMinutes(r.view.worked_minutes) || <span className="font-normal text-muted-foreground/60">—</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">{minuteTags(r) ?? <span className="text-muted-foreground/60">—</span>}</div>
                    </td>
                    <td className="px-3 py-2">{statusCell(r, false)}</td>
                    <td className="px-3 py-2">
                      <Input
                        value={r.cur.remarks ?? ""}
                        disabled={r.blocked}
                        onChange={(e) => setField(r, "remarks", e.target.value.slice(0, 300))}
                        placeholder={r.blocked ? "" : "Note…"}
                        className="h-8 text-xs"
                        aria-label={`Remarks for ${r.employee.name}`}
                        data-col="remarks"
                        data-idx={idx}
                        onKeyDown={onCellKey}
                      />
                    </td>
                    <td className="px-3 py-2">{flags(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !visible.length && (
          <EmptyState
            icon={Users}
            title={rows.length ? "Nobody matches this filter" : "No employees"}
            hint={rows.length ? "Pick another status above." : "No active employees you work with, on this day."}
          />
        )}
      </div>

      {/* Save bar */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-3 z-20 mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-primary/25 bg-background/95 px-4 py-3 shadow-xl shadow-red-900/10 backdrop-blur sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
            <p className="text-sm text-foreground/85">
              <b className="tabular-nums">{dirtyCount}</b> unsaved change{dirtyCount === 1 ? "" : "s"}<span className="hidden sm:inline"> on {fmtDayLong(date)}</span>
            </p>
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" className="h-9 flex-1 bg-background sm:flex-none" onClick={() => { setEdits({}); setInvalid({}); }} disabled={saving}>
              <Undo2 className="mr-1.5 h-4 w-4" />Discard
            </Button>
            <Button className={cn(BRAND_BTN, "h-9 flex-1 sm:flex-none")} onClick={() => save()} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Save
              <kbd className="ml-1.5 hidden rounded border border-white/40 px-1 font-mono text-[10.5px] sm:inline">Ctrl S</kbd>
            </Button>
          </div>
        </div>
      )}
      {isFetching && !isLoading && <p className="text-right text-xs text-muted-foreground">Refreshing…</p>}

      {/* Reason for days going to approval */}
      <Dialog open={Boolean(reasonAsk)} onOpenChange={(o) => !o && setReasonAsk(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-lg")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Hourglass className="h-5 w-5 text-primary" />Some days need approval</DialogTitle>
            <DialogDescription>
              {reasonAsk?.heldCount} day(s) are older than {meta.settings.directEditDays} day(s) or were recorded by the attendance machine.
              Give a reason — they go to Approvals, and the rest are saved now.
            </DialogDescription>
          </DialogHeader>
          <Textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Machine was down; employee was on site visit" maxLength={300} aria-label="Reason" />
          <DialogFooter className={DIALOG_FOOTER}>
            <Button variant="ghost" onClick={() => setReasonAsk(null)}>Back</Button>
            <Button className={BRAND_BTN} disabled={!reason.trim() || saving} onClick={() => save(reason.trim())}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Send for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leaving a day with unsaved changes */}
      <Dialog open={Boolean(pendingDate)} onOpenChange={(o) => !o && setPendingDate(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>{dirtyCount} change(s) on {fmtDayLong(date)} have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter className={DIALOG_FOOTER}>
            <Button variant="ghost" onClick={() => setPendingDate(null)}>Stay</Button>
            <Button variant="destructive" onClick={() => { setDate(pendingDate); setPendingDate(null); }}>Discard and go</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Which leave a LEAVE day is (and the request it came from). */
function LeaveTag({ row, types, request, balanceOnly }) {
  if (row.status !== "LEAVE" || !row.leave_type_id) return null;
  const t = types.get(row.leave_type_id);
  if (!t) return null;
  if (balanceOnly) return <span className="text-[11px] text-muted-foreground">{row.leave_half ? "½ day · " : ""}{t.is_paid ? "paid" : "unpaid"}</span>;
  return (
    <span className="rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap" style={{ background: `${t.color}14`, color: t.color }}>
      {t.code}{row.leave_half ? " ½" : ""}{request ? ` · #L-${request}` : ""}
    </span>
  );
}

function MinuteTag({ tone, label, min }) {
  const tones = {
    amber: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300",
    orange: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/40 dark:text-orange-300",
    emerald: "bg-[#edf2ee] text-[#2f5139] ring-emerald-700/20 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset tabular-nums whitespace-nowrap", tones[tone])}>
      {label} {fmtMinutes(min)}
    </span>
  );
}

/** Free-typed time; committed (normalized) on blur. */
function TimeInput({ value, onCommit, disabled, invalid, onKeyDown, col, idx, suffix, className, ariaLabel }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  return (
    <div className="relative inline-block">
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value.slice(0, 5))}
        onBlur={() => {
          const hm = normalizeHm(text);
          if (hm) setText(hm);
          if ((hm ?? (text.trim() ? text : null)) !== (value ?? null)) onCommit(text);
        }}
        onFocus={(e) => e.target.select()}
        onKeyDown={onKeyDown}
        data-col={col}
        data-idx={idx}
        inputMode="numeric"
        placeholder="--:--"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-8 w-[72px] rounded-md border bg-background text-center text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-foreground/85",
          invalid ? "border-destructive text-destructive focus:ring-destructive/25" : "border-input focus:ring-primary/15",
          className,
        )}
      />
      {suffix && <span className="absolute -right-3 -top-1 text-[10px] font-bold text-primary" title="Next day">{suffix}</span>}
    </div>
  );
}
