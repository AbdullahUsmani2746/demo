"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { usePermissions } from "@/hooks/usePermissions";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Target,
  PlayCircle,
  Loader2,
  Users2,
  User as UserIcon,
  Globe2,
  Keyboard,
  CheckCircle2,
  AlertCircle,
  Save,
  Lock,
  X,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════
   WHO CAN SEE EVERY CUSTOMER

   By default a person only sees the customers assigned to them, i.e. the
   ones whose acno.salesArea holds their own User id.

   Anyone listed below — or holding one of the roles below — also gets the
   "All customers" toggle in the toolbar.

   To let someone see everything, paste their User.id (the cuid, not the
   employee number) into SEES_ALL_CUSTOMERS with a comment saying who it is.
   ══════════════════════════════════════════════════════════════════════ */
let SEES_ALL_CUSTOMERS = [
  // "clx9z8y7x6w5v4u3t2s1r0q",   // Shoaib — covers for the team
];

// Who is never scoped down: holders of salesTeam.viewAll (Admin → Roles:
// management, Sales / Accounts Manager) and Super Admin. The API enforces it.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Only digits and a single decimal point, or empty. Commas never reach this:
// they are stripped first, so state always holds a plain number string.
const NUMERIC = /^\d*\.?\d*$/;

const stripCommas = (v) => String(v ?? "").replace(/,/g, "");

/* "1000" -> "1,000". Groups the integer part only and leaves everything after
   the decimal point exactly as typed — including a lone trailing "." — so a
   number can still be typed straight through. */
const withCommas = (v) => {
  const s = stripCommas(v);
  if (s === "") return "";
  const dot = s.indexOf(".");
  const int = dot === -1 ? s : s.slice(0, dot);
  const rest = dot === -1 ? "" : s.slice(dot);
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
};

/* Caret bookkeeping. A comma appearing (or vanishing) shifts every position to
   its right, so the caret is tracked by how many REAL characters — digits and
   the decimal point — sit before it, never by raw index. */
const countReal = (s) => (s.match(/[\d.]/g) || []).length;
const caretAfter = (s, n) => {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== ",") seen += 1;
    if (seen === n) return i + 1;
  }
  return s.length;
};

// How long the grid waits after the last keystroke before saving on its own.
// The timer restarts on every edit, so typing across a run of cells produces
// one write at the end rather than one per cell.
const AUTOSAVE_MS = 5000;

// The editable grid is one column wide: Target Qty. Target Recovery is set by
// the system (the customer's minimum — lib/salesTargets/autoTarget.js) and is
// shown read-only beside it.
const FIELDS = ["targetQty"];

/* This project's Table primitives ship with NO padding of their own
   (components/ui/table.jsx strips the stock px-2/p-2), so every cell has to
   state its own. Keeping it in one constant keeps the columns aligned.

   Deliberately heavy, too: this grid is read and typed into for long
   stretches, so the headings are dark and bold rather than the usual
   light-grey caps, and the rows are tall enough to land in without aiming. */
const TH =
  "h-12 whitespace-nowrap border-b-2 border-slate-300 bg-slate-100 px-4 text-sm font-bold uppercase tracking-wide text-slate-700";
const TD = "border-b border-slate-200 px-4 py-3";

const fmt = (n, dp = 0) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

export default function SalesTargetsForm() {
  const now = new Date();
  const { data: session, status: sessionStatus } = useSession();

  const userId = session?.user?.id;
  const { can } = usePermissions();

  const canSeeAll =
    can("salesTeam.viewAll") || (!!userId && SEES_ALL_CUSTOMERS.includes(userId));

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("mine"); // "mine" | "all"
  const [edits, setEdits] = useState({}); // acno -> { targetQty }
  const queryClient = useQueryClient();

  // Someone allowed to see everything usually has no customers of their own —
  // an accountant would land on an empty screen — so start them on "all".
  useEffect(() => {
    if (canSeeAll) setScope("all");
  }, [canSeeAll]);

  // Anyone not on the list is pinned to their own customers, whatever the
  // toggle last said.
  const effectiveScope = canSeeAll ? scope : "mine";
  const salesPerson = effectiveScope === "mine" ? userId || "" : "";

  // "Mine" with no user id would send an empty salesPerson, and the API reads
  // that as "no filter" — i.e. everyone. Hold the request until we have one.
  const canQuery = sessionStatus !== "loading" && (effectiveScope === "all" || !!userId);

  const { data: payload, isLoading, isFetching } = useQuery({
    queryKey: ["customerMonthlyTargets", "bulk", year, month, search, effectiveScope, salesPerson],
    queryFn: async () => {
      const res = await axios.get("/api/accounts/customer-monthly-target", {
        params: { year, month, search, ...(salesPerson ? { salesPerson } : {}) },
      });
      return { rows: res.data.data || [], meta: res.data.meta || {} };
    },
    enabled: canQuery,
  });
  const rows = useMemo(() => payload?.rows ?? [], [payload]);
  // Month-end: who may run it (salesTarget.monthEnd) and when it last locked
  const canRunMonthEnd = Boolean(payload?.meta?.canRunMonthEnd);
  const monthLockedAt = payload?.meta?.lockedAt ?? null;
  // While the month runs, the Locked columns show the previous month's closing
  const prevMeta = payload?.meta?.prev ?? null;
  const showPrev = !monthLockedAt && Boolean(prevMeta?.lockedAt);
  const prevLabel = prevMeta ? MONTH_NAMES[prevMeta.month - 1].slice(0, 3) : "";
  const lockedRec = (row) => (row.lockedAt ? row.lockedTargetRecovery : showPrev ? row.prevLockedTargetRecovery : null);
  const lockedOd = (row) => (row.lockedAt ? row.lockedOverdue : showPrev ? row.prevLockedOverdue : null);

  // The edit map, mirrored into a ref so a save fired from a timer or an
  // unmount reads what is on screen now rather than what was there when the
  // callback was created.
  const editsRef = useRef(edits);
  editsRef.current = edits;

  // Which period the pending edits were typed against. A save must post to
  // THAT month — not to whatever the filters have since been switched to —
  // or a late write lands on the wrong period.
  const editsPeriodRef = useRef({ year, month });

  const getValue = (row, field) =>
    edits[row.acno]?.[field] !== undefined ? edits[row.acno][field] : row[field] ?? "";

  const setValue = (acno, field, value) => {
    editsPeriodRef.current = { year, month };
    setEdits((prev) => ({ ...prev, [acno]: { ...prev[acno], [field]: value } }));
  };

  /* Typing into a grouped cell. State keeps the plain number ("1000") while the
     input shows it grouped ("1,000"). The input's value and caret are set here,
     before React re-renders with the same string, so inserting a comma does not
     throw the caret to the end of the cell mid-number. */
  const onNumericChange = (e, acno, field, previous) => {
    const el = e.target;
    const raw = el.value;
    const clean = stripCommas(raw);

    if (clean !== "" && !NUMERIC.test(clean)) {
      // Not a number — drop the keystroke and put the cell back as it was.
      const back = withCommas(previous);
      const caret = Math.max(0, (el.selectionStart ?? back.length) - 1);
      el.value = back;
      el.setSelectionRange(caret, caret);
      return;
    }

    const before = countReal(raw.slice(0, el.selectionStart ?? raw.length));
    const shown = withCommas(clean);
    el.value = shown;
    const pos = caretAfter(shown, before);
    el.setSelectionRange(pos, pos);

    setValue(acno, field, clean);
  };

  /* Backspace with the caret sitting just after a comma. The comma is not the
     user's character — deleting it alone would only get re-inserted by the
     formatter and the key would look broken — so take out the digit in front of
     it instead. Returns true when it handled the key. */
  const onCommaBackspace = (e, acno, field) => {
    if (e.key !== "Backspace") return false;
    const el = e.currentTarget;
    const i = el.selectionStart;
    if (i !== el.selectionEnd || i < 2 || el.value[i - 1] !== ",") return false;

    e.preventDefault();
    const raw = el.value.slice(0, i - 2) + el.value.slice(i - 1);
    const clean = stripCommas(raw);
    const shown = withCommas(clean);
    el.value = shown;
    const pos = caretAfter(shown, countReal(raw.slice(0, i - 2)));
    el.setSelectionRange(pos, pos);

    setValue(acno, field, clean);
    return true;
  };

  const revertRow = (acno) =>
    setEdits((prev) => {
      const next = { ...prev };
      delete next[acno];
      return next;
    });

  const dirtyCount = Object.keys(edits).length;

  /* ─── Keyboard grid navigation ──────────────────────────────────────
     Arrow up/down walks the column, Enter goes down a row, and left/right
     hop columns but only once the caret has reached the edge of the text —
     so you can still move through the digits you are typing.            */
  const inputRefs = useRef(new Map());
  const registerRef = useCallback((r, c, el) => {
    const key = `${r}:${c}`;
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  }, []);

  const focusCell = useCallback((r, c) => {
    const el = inputRefs.current.get(`${r}:${c}`);
    if (!el) return;
    el.focus();
    requestAnimationFrame(() => {
      try { el.select(); } catch { /* not selectable, never mind */ }
    });
  }, []);

  const handleKeyDown = (e, r, c, acno, field) => {
    if (onCommaBackspace(e, acno, field)) return;

    const el = e.currentTarget;
    const lastRow = rows.length - 1;
    const lastCol = FIELDS.length - 1;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd =
      el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusCell(Math.min(r + 1, lastRow), c);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(Math.max(r - 1, 0), c);
        break;
      case "Enter":
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          if (dirtyCount) flushSave();
        } else {
          focusCell(Math.min(r + 1, lastRow), c);
        }
        break;
      case "ArrowLeft":
        if (atStart && c > 0) {
          e.preventDefault();
          focusCell(r, c - 1);
        }
        break;
      case "ArrowRight":
        if (atEnd && c < lastCol) {
          e.preventDefault();
          focusCell(r, c + 1);
        }
        break;
      case "Home":
        if (e.ctrlKey) {
          e.preventDefault();
          focusCell(0, c);
        }
        break;
      case "End":
        if (e.ctrlKey) {
          e.preventDefault();
          focusCell(lastRow, c);
        }
        break;
      case "Escape":
        e.preventDefault();
        revertRow(acno);
        break;
      default:
        break;
    }
  };

  const [savedAt, setSavedAt] = useState(null);

  // Every caller passes the exact snapshot it wants written — the edits and
  // the period they belong to — instead of the mutation reading whatever
  // state happens to be current when the request finally goes out.
  const saveAll = useMutation({
    mutationFn: ({ year: y, month: mo, edits: pending }) => {
      // Only Target Qty is typed; Target Recovery is set by the system.
      const payload = Object.entries(pending).map(([acno, fields]) => ({
        acno: Number(acno),
        targetQty: fields.targetQty,
      }));
      return axios.post("/api/accounts/customer-monthly-target", {
        year: y,
        month: mo,
        rows: payload,
      });
    },
    onSuccess: (_res, sent) => {
      // Clear only what was actually written, and only where it has not been
      // typed over since the request left. Blanking the whole map would throw
      // away anything edited while the save was in flight — a near certainty
      // once saving happens on a timer instead of on a click.
      setEdits((prev) => {
        const next = { ...prev };
        for (const [acno, wrote] of Object.entries(sent.edits)) {
          const current = next[acno];
          if (current && current.targetQty === wrote.targetQty) {
            delete next[acno];
          }
        }
        return next;
      });
      setSavedAt(Date.now());
      queryClient.invalidateQueries({
        queryKey: ["customerMonthlyTargets", "bulk", sent.year, sent.month],
      });
    },
  });

  const { mutate: runSave } = saveAll;

  // The one way anything gets saved: button, Ctrl+S, Ctrl+Enter, the timer,
  // and the flush that runs when the period changes all come through here.
  const flushSave = useCallback((snapshot) => {
    const all = snapshot ?? editsRef.current;
    if (!all) return;
    const pending = {};
    for (const [acno, fields] of Object.entries(all)) {
      if (fields.targetQty !== undefined) pending[acno] = { targetQty: fields.targetQty };
    }
    if (Object.keys(pending).length === 0) return;
    runSave({ ...editsPeriodRef.current, edits: pending });
  }, [runSave]);

  /* ─── Auto-save ──────────────────────────────────────────────────────
     Saves on its own AUTOSAVE_MS after the last keystroke, so the Save
     button is a fallback rather than something anyone has to remember.
     `edits` is in the dependencies, so each new keystroke cancels the
     pending timer and starts a fresh one — a run of typing produces a
     single write at the end, not one per cell.                          */
  useEffect(() => {
    if (dirtyCount === 0) return;
    // Hold off while a save is in flight. isPending is a dependency, so this
    // re-runs the moment it settles and anything typed meanwhile is picked up.
    if (saveAll.isPending) return;
    const timer = setTimeout(() => flushSave(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [edits, dirtyCount, saveAll.isPending, flushSave]);

  /* Changing the period or the filters drops the edit map — it is keyed by
     customer for one specific month. Anything still unsaved is flushed FIRST,
     against the period it was typed in, so switching month inside the
     auto-save window cannot quietly bin someone's work. */
  const filterKey = `${year}-${month}-${search}-${effectiveScope}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    flushSave(editsRef.current);
    setEdits({});
  }, [filterKey, flushSave]);

  // Leaving the page inside the auto-save window would lose the last few
  // seconds of typing, so ask first. Only while something is actually unsaved.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  // Ctrl/Cmd+S saves from anywhere on the page — now "save it now" rather
  // than "save it at all", since the timer would have got there anyway.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saveAll.isPending) flushSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveAll.isPending, flushSave]);

  // Manual trigger for the month-end snapshot job (Locked Target Recovery) -
  // the cron only ever runs automatically for the month that just ended
  // (1st @ 02:30). This lets a missed month be backfilled, or a locked month
  // be re-run, for whichever period is selected above. Only holders of
  // salesTarget.monthEnd (Permissions → Approvals) get the button.
  const runSnapshot = useMutation({
    mutationFn: () =>
      axios.post("/api/accounts/customer-monthly-target/run-snapshot", { year, month }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customerMonthlyTargets", "bulk", year, month] });
    },
  });

  const handleRunSnapshot = () => {
    const label = `${MONTH_NAMES[month - 1]} ${year}`;
    const again = monthLockedAt
      ? ` ${label} was already locked on ${new Date(monthLockedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} — running again replaces those locked figures.`
      : "";
    if (
      !window.confirm(
        `Run the month-end calculation for ${label}? This recomputes and locks, for every customer, the month's Recovery (receipts + sale returns + JV credits), the Overdue at month end and the final Target Recovery. Only a month that has ended can be locked.${again}`
      )
    ) {
      return;
    }
    runSnapshot.mutate();
  };

  const totals = useMemo(() => {
    let qty = 0, recovery = 0, locked = 0, lockedOverdue = 0, withTarget = 0;
    for (const row of rows) {
      const q = Number(getValue(row, "targetQty")) || 0;
      const r = Number(row.targetRecovery) || 0;
      qty += q;
      recovery += r;
      locked += Number(lockedRec(row)) || 0;
      lockedOverdue += Number(lockedOd(row)) || 0;
      if (q || r) withTarget += 1;
    }
    return { qty, recovery, locked, lockedOverdue, withTarget };
  }, [rows, edits]);

  const periodLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 space-y-6">

        {/* ═══ HEADER ═══ */}
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-sm">
              <Target className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Sales &amp; Recovery Targets
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
                Set <span className="font-medium text-foreground">Target Qty (KG)</span> for each
                customer. <span className="font-medium text-foreground">Target Recovery (Rs)</span> is
                set automatically (the customer&apos;s minimum on their overdue). Locked Recovery and
                Locked OverDue are calculated and frozen at month end.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="h-10 w-[140px] bg-background text-sm shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-10 w-[100px] bg-background text-sm shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showPrev && (
              <Badge
                variant="secondary"
                className="h-10 gap-1.5 border-amber-200 bg-amber-50 px-3 font-normal text-amber-800"
                title="This month is still running; its own figures lock at month end"
              >
                <Lock className="h-3.5 w-3.5" />
                Showing {MONTH_NAMES[prevMeta.month - 1]} closing · locked {new Date(prevMeta.lockedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </Badge>
            )}
            {monthLockedAt && (
              <Badge
                variant="secondary"
                className="h-10 gap-1.5 border-slate-200 bg-slate-100 px-3 font-normal text-slate-700"
                title="Month-end figures are frozen for this month"
              >
                <Lock className="h-3.5 w-3.5" />
                Locked {new Date(monthLockedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </Badge>
            )}
            {canRunMonthEnd && (
              <Button
                type="button"
                variant="outline"
                onClick={handleRunSnapshot}
                disabled={runSnapshot.isPending}
                className="h-10 gap-2 bg-background shadow-sm"
              >
                {runSnapshot.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{monthLockedAt ? "Run Month-End again" : "Run Month-End"}</span>
                <span className="sm:hidden">{monthLockedAt ? "Re-run" : "Month-End"}</span>
              </Button>
            )}
          </div>
        </div>

        {/* ═══ SUMMARY ═══ */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Customers"
            value={isLoading ? null : fmt(rows.length)}
            hint={effectiveScope === "mine" ? "assigned to you" : "all customers"}
            icon={Users2}
          />
          <StatCard
            label="With a target"
            value={isLoading ? null : fmt(totals.withTarget)}
            hint={rows.length ? `of ${fmt(rows.length)}` : "—"}
            icon={CheckCircle2}
          />
          <StatCard
            label="Total Target Qty"
            value={isLoading ? null : fmt(totals.qty)}
            hint="KG"
            icon={Target}
          />
          <StatCard
            label="Total Target Recovery"
            value={isLoading ? null : fmt(totals.recovery)}
            hint="Rs"
            icon={Target}
          />
        </div>

        {/* ═══ ALERTS ═══ */}
        {runSnapshot.isSuccess && (
          <Banner tone="success" icon={CheckCircle2}>
            Done — locked Recovery and OverDue for {runSnapshot.data?.data?.count ?? 0} customer(s) in{" "}
            {periodLabel}.
          </Banner>
        )}
        {runSnapshot.isError && (
          <Banner tone="error" icon={AlertCircle}>
            {runSnapshot.error?.response?.data?.error || "Failed to run the month-end calculation."}
          </Banner>
        )}
        {saveAll.isError && (
          <Banner tone="error" icon={AlertCircle}>
            {saveAll.error?.response?.data?.error || "Could not save your changes. Please try again."}
          </Banner>
        )}
        {/* ═══ GRID ═══ */}
        <Card className="overflow-hidden border-border/70 shadow-sm">
          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b bg-muted/40 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {canSeeAll ? (
                <div className="inline-flex rounded-lg border bg-background p-0.5 shadow-sm">
                  <ScopeButton
                    active={scope === "mine"}
                    onClick={() => setScope("mine")}
                    icon={UserIcon}
                  >
                    My customers
                  </ScopeButton>
                  <ScopeButton
                    active={scope === "all"}
                    onClick={() => setScope("all")}
                    icon={Globe2}
                  >
                    All customers
                  </ScopeButton>
                </div>
              ) : (
                <Badge variant="secondary" className="h-8 gap-1.5 px-3 font-normal">
                  <UserIcon className="h-3.5 w-3.5" />
                  Your customers
                </Badge>
              )}

              {isFetching && !isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-slate-600" />
              )}

              {/* Auto-save status. Something is always shown once the user has
                  touched the grid, so nobody has to wonder whether their
                  numbers are safe. */}
              {saveAll.isPending ? (
                <Badge variant="secondary" className="h-8 gap-1.5 px-3 font-normal">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </Badge>
              ) : dirtyCount > 0 ? (
                <Badge className="h-8 gap-1.5 bg-amber-500 px-3 text-white hover:bg-amber-500">
                  {dirtyCount} unsaved · saves automatically
                </Badge>
              ) : savedAt ? (
                <Badge
                  variant="secondary"
                  className="h-8 gap-1.5 border-emerald-200 bg-emerald-50 px-3 font-normal text-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  All changes saved
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-1 items-center gap-2 lg:max-w-md lg:flex-none">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <Input
                  placeholder="Search customer by name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 bg-background pl-9 shadow-sm"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-600 hover:bg-muted hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button
                type="button"
                onClick={() => flushSave()}
                disabled={dirtyCount === 0 || saveAll.isPending}
                className="h-10 gap-2 shadow-sm"
              >
                {saveAll.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save{dirtyCount ? ` (${dirtyCount})` : ""}
              </Button>
            </div>
          </div>

          {/* Keyboard hint */}
          <div className="hidden items-center gap-2 border-b bg-background px-4 py-2 text-sm text-slate-600 md:flex">
            <Keyboard className="h-3.5 w-3.5 shrink-0" />
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move row</span>
              <span><Kbd>←</Kbd><Kbd>→</Kbd> move column</span>
              <span><Kbd>Enter</Kbd> next row</span>
              <span><Kbd>Tab</Kbd> next field</span>
              <span><Kbd>Esc</Kbd> undo row</span>
              <span><Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> save now</span>
              <span><Kbd>Ctrl</Kbd>+<Kbd>↑/↓</Kbd> first / last</span>
            </span>
          </div>

          <CardContent className="p-0">
            {!canQuery ? (
              <EmptyState
                icon={UserIcon}
                title="Signing you in..."
                body="Your customer list will appear once your session loads."
              />
            ) : isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Users2}
                title={search ? `No customers match "${search}"` : "No customers to show"}
                body={
                  search
                    ? "Try a different name, or clear the search."
                    : effectiveScope === "mine"
                      ? "No customers are assigned to you yet. Ask an administrator to set you as the sales person on the accounts you own."
                      : "There are no customer accounts for this period."
                }
              />
            ) : (
              <>
                {/* ── Desktop table ── */}
                <div className="hidden max-h-[64vh] overflow-auto md:block">
                  <Table className="border-separate border-spacing-0">
                    <TableHeader className="sticky top-0 z-20">
                      <TableRow className="border-0 hover:bg-transparent">
                        <TableHead className={`${TH} w-14 text-center`}>#</TableHead>
                        <TableHead className={`${TH} w-24`}>Code</TableHead>
                        <TableHead className={`${TH} min-w-[260px]`}>Customer</TableHead>
                        <TableHead className={`${TH} min-w-[160px]`}>Sales Person</TableHead>
                        <TableHead className={`${TH} w-[165px] border-l text-right`}>
                          <span className="inline-flex items-center gap-1.5">
                            Target Qty
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
                              KG
                            </span>
                          </span>
                        </TableHead>
                        <TableHead className={`${TH} w-[185px] text-right`}>
                          <span className="inline-flex items-center gap-1.5">
                            Target Recovery
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
                              Rs
                            </span>
                          </span>
                        </TableHead>
                        <TableHead className={`${TH} w-[190px] border-l text-right`}>
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Lock className="h-3 w-3" />
                            Locked Recovery
                            {showPrev && <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold normal-case text-amber-800">{prevLabel} closing</span>}
                          </span>
                        </TableHead>
                        <TableHead className={`${TH} w-[190px] text-right`}>
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Lock className="h-3 w-3" />
                            Locked OverDue
                            {showPrev && <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold normal-case text-amber-800">{prevLabel} closing</span>}
                          </span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {rows.map((row, r) => {
                        const dirty = !!edits[row.acno];
                        return (
                          <TableRow
                            key={row.acno}
                            className={`group border-0 transition-colors ${
                              dirty
                                ? "bg-amber-50/70 hover:bg-amber-100/70 dark:bg-amber-950/25 dark:hover:bg-amber-950/40"
                                : "hover:bg-muted/50"
                            }`}
                          >
                            {/* row number, with the unsaved-row accent bar */}
                            <TableCell
                              className={`${TD} relative w-14 text-center text-sm tabular-nums text-slate-600 ${
                                dirty
                                  ? "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-amber-500"
                                  : ""
                              }`}
                            >
                              {r + 1}
                            </TableCell>

                            <TableCell className={TD}>
                              <span className="rounded-md bg-muted px-2 py-1 font-mono text-sm font-medium text-slate-600">
                                {row.acno}
                              </span>
                            </TableCell>

                            <TableCell className={`${TD} font-medium`}>
                              <span className="block max-w-[380px] truncate" title={row.acname}>
                                {row.acname}
                              </span>
                            </TableCell>

                            <TableCell className={`${TD} text-sm`}>
                              {row.salesPersonName ? (
                                <span className="inline-flex items-center gap-2 text-slate-600">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold uppercase text-primary">
                                    {row.salesPersonName.trim().charAt(0)}
                                  </span>
                                  <span className="truncate">{row.salesPersonName}</span>
                                </span>
                              ) : (
                                <span className="rounded-full border border-dashed px-2 py-0.5 text-sm text-slate-600">
                                  OPEN
                                </span>
                              )}
                            </TableCell>

                            {FIELDS.map((field, c) => (
                              <TableCell
                                key={field}
                                className={`${TD} ${c === 0 ? "border-l" : ""} bg-primary/[0.02] align-top dark:bg-primary/[0.04]`}
                              >
                                <Input
                                  ref={(el) => registerRef(r, c, el)}
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={withCommas(getValue(row, field))}
                                  onChange={(e) =>
                                    onNumericChange(e, row.acno, field, getValue(row, field))
                                  }
                                  onKeyDown={(e) => handleKeyDown(e, r, c, row.acno, field)}
                                  onFocus={(e) => e.target.select()}
                                  className="h-11 w-full border-2 border-slate-300 bg-white px-3 text-right text-base font-semibold tabular-nums text-slate-900 shadow-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                                />
                              </TableCell>
                            ))}

                            {/* Target Recovery — set by the system, read-only */}
                            <TableCell className={`${TD} bg-slate-50/60 text-right align-top`}>
                              <AutoRecovery row={row} />
                            </TableCell>

                            <TableCell className={`${TD} border-l bg-slate-50 text-right text-base tabular-nums text-slate-800`}>
                              {lockedRec(row) != null ? (
                                <span className="font-semibold">
                                  {fmt(lockedRec(row), 2)}
                                </span>
                              ) : (
                                <span className="text-slate-600/60">—</span>
                              )}
                            </TableCell>
                            <TableCell className={`${TD} bg-slate-50 text-right text-base tabular-nums text-slate-800`}>
                              {lockedOd(row) != null ? (
                                <span className="font-semibold">
                                  {fmt(lockedOd(row), 2)}
                                </span>
                              ) : (
                                <span className="text-slate-600/60">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>

                    {/* sticky totals */}
                    <tfoot className="sticky bottom-0 z-20">
                      <TableRow className="border-0 hover:bg-transparent">
                        <TableCell
                          colSpan={4}
                          className={`${TD} border-t-2 bg-muted/95 text-sm font-semibold uppercase tracking-wide text-slate-600 backdrop-blur`}
                        >
                          Total · {fmt(rows.length)} customer{rows.length === 1 ? "" : "s"}
                        </TableCell>
                        <TableCell
                          className={`${TD} border-l border-t-2 border-slate-300 bg-slate-100 text-right text-base font-extrabold tabular-nums text-slate-900`}
                        >
                          {fmt(totals.qty)}
                        </TableCell>
                        <TableCell
                          className={`${TD} border-t-2 border-slate-300 bg-slate-100 text-right text-base font-extrabold tabular-nums text-slate-900`}
                        >
                          {fmt(totals.recovery)}
                        </TableCell>
                        <TableCell
                          className={`${TD} border-l border-t-2 border-slate-300 bg-slate-100 text-right text-base font-extrabold tabular-nums text-slate-900`}
                        >
                          {fmt(totals.locked, 2)}
                        </TableCell>
                        <TableCell
                          className={`${TD} border-t-2 border-slate-300 bg-slate-100 text-right text-base font-extrabold tabular-nums text-slate-900`}
                        >
                          {fmt(totals.lockedOverdue, 2)}
                        </TableCell>
                      </TableRow>
                    </tfoot>
                  </Table>
                </div>

                {/* ── Mobile cards ── */}
                <div className="divide-y md:hidden">
                  {rows.map((row) => {
                    const dirty = !!edits[row.acno];
                    return (
                      <div
                        key={row.acno}
                        className={`space-y-3 p-4 ${dirty ? "bg-amber-50/80 dark:bg-amber-950/25" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.acname}</p>
                            <p className="mt-0.5 text-sm text-slate-600">
                              <span className="font-mono">{row.acno}</span>
                              {" · "}
                              {row.salesPersonName || "OPEN"}
                            </p>
                          </div>
                          {dirty && (
                            <Badge className="shrink-0 bg-amber-500 text-white hover:bg-amber-500">
                              edited
                            </Badge>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="space-y-1.5">
                            <span className="block text-sm font-medium text-slate-600">
                              Target Qty (KG)
                            </span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={withCommas(getValue(row, "targetQty"))}
                              onChange={(e) =>
                                onNumericChange(e, row.acno, "targetQty", getValue(row, "targetQty"))
                              }
                              onKeyDown={(e) => onCommaBackspace(e, row.acno, "targetQty")}
                              className="h-10 text-right tabular-nums"
                            />
                          </label>
                          <div className="space-y-1.5">
                            <span className="block text-sm font-medium text-slate-600">
                              Target Recovery (Rs)
                            </span>
                            <div className="flex h-10 items-center justify-end rounded-md border bg-slate-50 px-3">
                              <AutoRecovery row={row} compact />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">Locked Recovery{showPrev ? ` (${prevLabel} closing)` : ""}</span>
                          <span className="font-medium tabular-nums">
                            {lockedRec(row) != null ? fmt(lockedRec(row), 2) : "—"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">Locked OverDue{showPrev ? ` (${prevLabel} closing)` : ""}</span>
                          <span className="font-medium tabular-nums">
                            {lockedOd(row) != null ? fmt(lockedOd(row), 2) : "—"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Spacer so the sticky bar never covers the last row */}
        {dirtyCount > 0 && <div className="h-20" />}
      </div>

      {/* ═══ STICKY SAVE BAR ═══ */}
      {dirtyCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
              <span className="font-medium">
                {dirtyCount} customer{dirtyCount === 1 ? "" : "s"} edited
              </span>
              <span className="hidden text-slate-600 sm:inline">
                · {periodLabel}
              </span>
              {/* Says what is about to happen on its own, so the bar reads as
                  reassurance rather than as a demand to click something. */}
              <span className="hidden text-slate-600 md:inline">
                · {saveAll.isPending ? "saving..." : "saving automatically"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEdits({})}
                disabled={saveAll.isPending}
              >
                Discard
              </Button>
              <Button
                type="button"
                onClick={() => flushSave()}
                disabled={saveAll.isPending}
                className="gap-2"
              >
                {saveAll.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save now
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── small building blocks ───────────────────── */

function StatCard({ label, value, hint, icon: Icon }) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium uppercase tracking-wide text-slate-600">
            {label}
          </p>
          {value === null ? (
            <Skeleton className="h-7 w-20" />
          ) : (
            <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
          )}
          {hint && <p className="truncate text-sm text-slate-600">{hint}</p>}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}

function ScopeButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-slate-600 hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function Banner({ tone, icon: Icon, children }) {
  const tones = {
    success: "text-green-800 bg-green-50 border-green-200",
    error: "text-red-800 bg-red-50 border-red-200",
  };
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-6 w-6 text-slate-600" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-600">{body}</p>
    </div>
  );
}

// Target Recovery as the system set it: the amount, an "Auto" tag, and how it
// was worked out ("40% of 100,000 overdue").
function AutoRecovery({ row, compact = false }) {
  const amount = Number(row.targetRecovery) || 0;
  const how =
    row.minRecovery > 0
      ? `${row.category}: ${row.minRecoveryPct}% of overdue Rs ${fmt(row.overdueBase)}`
      : "Nothing overdue at the start of the month";
  return (
    <div className="space-y-1" title={`Set automatically — ${how}`}>
      <div className="flex items-center justify-end gap-1.5">
        <span className="inline-flex items-center gap-0.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">
          <Lock className="h-2.5 w-2.5" /> Auto
        </span>
        <span className="text-base font-semibold tabular-nums text-slate-900">{fmt(amount)}</span>
      </div>
      {!compact && row.minRecovery > 0 && (
        <p className="text-xs tabular-nums text-slate-500">
          {row.minRecoveryPct}% of {fmt(row.overdueBase)} overdue
        </p>
      )}
    </div>
  );
}

function Kbd({ children }) {
  return (
    <kbd className="mx-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-muted px-1 font-sans text-xs font-medium text-foreground">
      {children}
    </kbd>
  );
}
