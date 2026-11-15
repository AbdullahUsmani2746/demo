"use client";
// "Arrange accounts" — the side panel where a user sets their own order of
// accounts on Funds Flow / Funds Position (config `accountOrder`).
//
// The accounts come from the report itself (all rows, current filters), grouped
// under their control account. Accounts move only inside their group: drag the
// row, the ↑ / ↓ buttons, or Alt+↑ / Alt+↓ on a focused row (↑ / ↓ alone moves
// the focus). Ctrl+S saves, Esc closes. The order is saved per user
// (/api/reports/account-order, lib/reports/accountOrder.js) and applied on the
// server, so screen, Excel and PDF all follow it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, GripVertical, Loader2, RotateCcw, Search, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";

const errText = (error) =>
  error?.response?.data?.error || error?.response?.data?.message || error?.message || "Something went wrong";

// Report rows → [{ key, label, code, accounts: [{ acno, name }] }], each account once.
function groupsFromRows(rows, spec) {
  const groups = [];
  const byKey = new Map();
  const seen = new Set();
  let current = null;
  for (const row of rows || []) {
    if (row?.row_type === spec.groupRow) {
      const key = String(row[spec.groupKeyField] ?? row.label ?? "");
      current = byKey.get(key);
      if (!current) {
        current = { key, label: row.label ?? key, code: row.code ?? null, accounts: [] };
        byKey.set(key, current);
        groups.push(current);
      }
    } else if (row?.row_type === spec.accountRow) {
      const acno = Number(row[spec.acnoField]);
      if (!Number.isInteger(acno) || seen.has(acno)) continue;
      seen.add(acno);
      if (!current) {
        current = { key: "", label: "Accounts", code: null, accounts: [] };
        byKey.set("", current);
        groups.push(current);
      }
      current.accounts.push({ acno, name: String(row[spec.nameField] ?? "") });
    }
  }
  return groups;
}

const pad = (n) => String(n).padStart(4, "0");

export default function AccountOrderPanel({ open, onOpenChange, reportType, config, params, onSaved }) {
  const spec = config?.accountOrder;
  const isMobile = useIsMobile();

  const [groups, setGroups] = useState([]);
  const [saved, setSaved] = useState([]); // the order saved before this edit
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [query, setQuery] = useState("");
  const [drag, setDrag] = useState(null); // { acno, groupKey }
  const [drop, setDrop] = useState(null); // { acno, pos: "before" | "after" }
  const [focusAcno, setFocusAcno] = useState(null);
  const rowRefs = useRef(new Map());

  // Load the report's accounts (every row, current filters) and the saved order.
  useEffect(() => {
    if (!open || !spec) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setQuery("");
    setDirty(false);
    setResetPending(false);
    Promise.all([
      axios.get(config.apiEndpoint, {
        params: {
          ...(params || {}),
          ...(spec.params || {}),
          page: 1,
          limit: 100000,
          search: undefined,
          searchColumn: undefined,
          sortBy: undefined,
          sortOrder: undefined,
        },
      }),
      axios.get("/api/reports/account-order", { params: { report: reportType } }),
    ])
      .then(([report, order]) => {
        if (cancelled) return;
        setGroups(groupsFromRows(report.data?.data, spec));
        setSaved(order.data?.accounts || []);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errText(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, spec, config?.apiEndpoint, params, reportType]);

  // Keep the keyboard focus on a row after it moved.
  useEffect(() => {
    if (focusAcno == null) return;
    rowRefs.current.get(focusAcno)?.focus();
  }, [focusAcno, groups]);

  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const matches = useCallback(
    (a) => !filtering || a.name.toLowerCase().includes(q) || String(a.acno).includes(q) || pad(a.acno).includes(q),
    [filtering, q],
  );
  const visible = useMemo(
    () => groups.map((g) => ({ ...g, shown: g.accounts.filter(matches) })).filter((g) => g.shown.length > 0),
    [groups, matches],
  );
  const total = useMemo(() => groups.reduce((n, g) => n + g.accounts.length, 0), [groups]);

  const changed = () => {
    setDirty(true);
    setResetPending(false);
  };

  // Move `acno` by one place (dir -1 / +1) inside its group.
  const step = (acno, dir) => {
    setGroups((prev) =>
      prev.map((g) => {
        const i = g.accounts.findIndex((a) => a.acno === acno);
        if (i < 0) return g;
        const j = i + dir;
        if (j < 0 || j >= g.accounts.length) return g;
        const accounts = [...g.accounts];
        [accounts[i], accounts[j]] = [accounts[j], accounts[i]];
        return { ...g, accounts };
      }),
    );
    setFocusAcno(acno);
    changed();
  };

  // Put `src` before / after `target` (same group only).
  const moveTo = (src, target, pos) => {
    if (src === target) return;
    setGroups((prev) =>
      prev.map((g) => {
        const from = g.accounts.findIndex((a) => a.acno === src);
        if (from < 0 || !g.accounts.some((a) => a.acno === target)) return g;
        const accounts = [...g.accounts];
        const [moved] = accounts.splice(from, 1);
        let to = accounts.findIndex((a) => a.acno === target);
        if (pos === "after") to += 1;
        accounts.splice(to, 0, moved);
        return { ...g, accounts };
      }),
    );
    changed();
  };

  const resetToDefault = () => {
    setGroups((prev) => prev.map((g) => ({ ...g, accounts: [...g.accounts].sort((a, b) => a.acno - b.acno) })));
    setDirty(true);
    setResetPending(true);
  };

  const save = async () => {
    if (saving || loading || loadError) return;
    setSaving(true);
    try {
      if (resetPending) {
        await axios.delete("/api/reports/account-order", { params: { report: reportType } });
        toast.success("Default order restored");
      } else {
        // Accounts this view does not list (e.g. no activity in this period)
        // keep their place after the listed ones.
        const listed = groups.flatMap((g) => g.accounts.map((a) => a.acno));
        const inList = new Set(listed);
        const accounts = [...listed, ...saved.filter((a) => !inList.has(a))].slice(0, 2000);
        await axios.put("/api/reports/account-order", { report: reportType, accounts });
        toast.success("Order saved");
      }
      setDirty(false);
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S anywhere in the panel
  const onPanelKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  const flatShown = useMemo(() => visible.flatMap((g) => g.shown.map((a) => a.acno)), [visible]);

  const onRowKey = (e, acno) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      step(acno, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (!e.altKey && !e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const i = flatShown.indexOf(acno);
      const next = flatShown[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (next != null) rowRefs.current.get(next)?.focus();
    }
  };

  // ── Drag and drop (inside a group) ──────────────────────────────────
  const dropPos = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY - r.top < r.height / 2 ? "before" : "after";
  };
  const onDragStart = (e, acno, groupKey) => {
    if (filtering) {
      e.preventDefault();
      toast.info("Clear the search to drag accounts");
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(acno)); // Firefox needs data to start a drag
    setDrag({ acno, groupKey });
  };
  const onDragOver = (e, acno, groupKey) => {
    if (!drag || drag.groupKey !== groupKey || drag.acno === acno) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const pos = dropPos(e);
    if (drop?.acno !== acno || drop?.pos !== pos) setDrop({ acno, pos });
  };
  const onDrop = (e, acno) => {
    e.preventDefault();
    const src = drag?.acno;
    const pos = drop?.acno === acno ? drop.pos : dropPos(e);
    setDrag(null);
    setDrop(null);
    if (src != null) moveTo(src, acno, pos);
  };
  const onDragEnd = () => {
    setDrag(null);
    setDrop(null);
  };

  const close = () => {
    if (!saving) onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        onKeyDown={onPanelKey}
        className={`flex flex-col gap-0 p-0 [&>button.absolute]:hidden ${
          isMobile ? "max-h-[90vh] rounded-t-2xl" : "w-full sm:max-w-md"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-bold leading-tight">Arrange accounts</SheetTitle>
            <SheetDescription className="mt-0.5 text-xs text-muted-foreground">
              {config?.title} — set which account comes in which row. Saved for you; the report, Excel and PDF follow it until you change it.
            </SheetDescription>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search account code or name"
              className="h-10 pl-9"
              aria-label="Search accounts"
            />
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
            Drag a row, use the arrows, or focus a row and press <kbd className="rounded border border-b-2 border-border px-1 font-mono text-[10.5px]">Alt+↑</kbd>{" "}
            <kbd className="rounded border border-b-2 border-border px-1 font-mono text-[10.5px]">Alt+↓</kbd>. Accounts move within their group.
          </p>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Accounts">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
            </div>
          ) : loadError ? (
            <p className="m-5 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{loadError}</p>
          ) : total === 0 ? (
            <p className="px-5 py-16 text-center text-sm text-muted-foreground">No accounts on this report for the current filters.</p>
          ) : visible.length === 0 ? (
            <p className="px-5 py-16 text-center text-sm text-muted-foreground">No account matches “{query}”.</p>
          ) : (
            visible.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/80 px-5 py-1.5 backdrop-blur">
                  {g.code != null && g.code !== "" && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">{g.code}</span>
                  )}
                  <span className="truncate text-[12px] font-semibold uppercase tracking-wide text-foreground/80">{g.label}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{g.accounts.length}</span>
                </div>
                {g.shown.map((a) => {
                  const index = g.accounts.findIndex((x) => x.acno === a.acno);
                  const first = index === 0;
                  const last = index === g.accounts.length - 1;
                  const target = drop?.acno === a.acno ? drop.pos : null;
                  const dragged = drag?.acno === a.acno;
                  return (
                    <div
                      key={a.acno}
                      ref={(el) => (el ? rowRefs.current.set(a.acno, el) : rowRefs.current.delete(a.acno))}
                      role="listitem"
                      tabIndex={0}
                      draggable={!filtering}
                      onDragStart={(e) => onDragStart(e, a.acno, g.key)}
                      onDragOver={(e) => onDragOver(e, a.acno, g.key)}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget) && drop?.acno === a.acno) setDrop(null);
                      }}
                      onDrop={(e) => onDrop(e, a.acno)}
                      onDragEnd={onDragEnd}
                      onKeyDown={(e) => onRowKey(e, a.acno)}
                      className={`group relative flex min-h-[46px] items-center gap-2 border-b border-border/60 px-3 py-1.5 outline-none transition-colors hover:bg-primary/[0.03] focus-visible:bg-primary/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${
                        dragged ? "opacity-40" : ""
                      }`}
                    >
                      {target === "before" && <span className="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded bg-primary" />}
                      {target === "after" && <span className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded bg-primary" />}
                      <span
                        className={`flex h-7 w-5 flex-shrink-0 items-center justify-center text-muted-foreground/60 ${
                          filtering ? "invisible" : "cursor-grab group-hover:text-muted-foreground active:cursor-grabbing"
                        }`}
                        title="Drag to move"
                        aria-hidden="true"
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <span className="w-6 flex-shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground/80">{pad(a.acno)}</span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px]" title={a.name}>
                        {a.name}
                      </span>
                      <span className="flex flex-shrink-0 items-center">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => step(a.acno, -1)}
                          disabled={first}
                          aria-label={`Move ${a.name} up`}
                          title="Move up (Alt+↑)"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-25 disabled:hover:bg-transparent"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => step(a.acno, 1)}
                          disabled={last}
                          aria-label={`Move ${a.name} down`}
                          title="Move down (Alt+↓)"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-25 disabled:hover:bg-transparent"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            className="h-10 gap-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
            onClick={resetToDefault}
            disabled={saving || loading || !!loadError || total === 0}
            title="Back to account-number order (applied when you save)"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to default
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-10 bg-background" onClick={close} disabled={saving}>
              Cancel
              <kbd className="ml-1.5 hidden rounded border border-b-2 border-border px-1 font-mono text-[10.5px] text-muted-foreground sm:inline">Esc</kbd>
            </Button>
            <Button type="button" className="h-10 gap-2" onClick={save} disabled={saving || loading || !!loadError || (!dirty && saved.length > 0)}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
              <kbd className="hidden rounded border border-white/40 px-1 font-mono text-[10.5px] text-white/90 sm:inline">Ctrl+S</kbd>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
