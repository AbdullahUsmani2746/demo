"use client";

// ============================================================
// INVOICING — one screen for Sale, Sale Return, Purchase and Purchase Return
// ============================================================
// GRN, GRN Return, Dispatch and Dispatch Return carry quantities only. This
// is where they are priced and posted: each pending document gets a rate and
// ST % per line (prefilled with the server's suggestion — order, price list,
// last purchase, the original document), an invoice number (automatic unless
// typed) and, for purchases, the vendor's own bill no / date.
//
// API (lib/invoicing/core.js):
//   GET  /api/invoicing/[kind]?status=&from=&to=&party=&search=&page=&limit=
//   POST /api/invoicing/[kind]/generate { invoices: [...] }
//   POST /api/invoicing/[kind]/unlock   { tran_id, reason }
// Amounts shown here are a preview using the server's formula; the server
// re-prices every line when it posts.
//
// LAYOUT — Lab / voucher-list family (components/Material/shared/LabUI.jsx):
// header, stat tiles that filter, a toolbar card, then master/detail. The left
// rail is the queue, the right panel is the full record with its editable
// rates; ticked documents gather in a selection bar at the bottom. Arrow keys
// move between records, Enter invoices the active one, so a queue can be
// cleared from the keyboard. Pieces live beside this file:
//   parts.jsx (chips, avatars, stat chips) · QueueItem.jsx · DetailPanel.jsx
//   dialogs.jsx · format.js (formatting + the pricing preview) · kinds.js
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coins,
  CornerDownLeft,
  FileCheck2,
  FileText,
  Hash,
  MousePointerClick,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldOff,
  ShoppingCart,
  Sparkles,
  Undo2,
  X,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DateField } from "@/components/ui/date-field";
import KeyboardHint from "@/components/ui/KeyboardHint";
import { useDebounce } from "@/hooks/useDebounce";
import { CHIP, LabHeader } from "@/components/Material/shared/LabUI";
import { cn } from "@/lib/utils";

import { INVOICING_KINDS } from "./kinds";
import { ackForRequest, effectiveLine, errorMessage, fmtCompact, fmtMoney, liveIssues, rowStatus, rowTotals } from "./format";
import { Kbd, PartyPicker, Segmented, StatChip, UI } from "./parts";
import QueueItem from "./QueueItem";
import DetailPanel from "./DetailPanel";
import { ConfirmGenerateDialog, ResultsDialog, UnlockDialog } from "./dialogs";
import ApprovedTrialItems from "./ApprovedTrialItems";
import { useFeatures } from "@/hooks/useFeatures";

const PAGE_LIMIT = 50;

const KIND_ICONS = {
  sale: Receipt,
  "sale-return": Undo2,
  purchase: ShoppingCart,
  "purchase-return": RotateCcw,
};

// Empty / error / done state (LabEmpty's look, with a tone).
const STATE_TONES = {
  ok: CHIP.ok,
  error: CHIP.bad,
  muted: CHIP.brand,
};

function CenterState({ icon: Icon, tone = "muted", title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-full", STATE_TONES[tone] ?? STATE_TONES.muted)}>
        <Icon className="h-6 w-6" />
      </span>
      <p className="font-semibold text-foreground">{title}</p>
      {children && <p className={cn("max-w-sm text-sm", UI.muted)}>{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export default function InvoicingPage({ kind }) {
  const cfg = INVOICING_KINDS[kind];
  const queryClient = useQueryClient();
  // Settings → Features: Approved trial items (Sale Invoicing, orders.trialLineBilling)
  const features = useFeatures();
  const trialBilling = kind === "sale" && features.on("orders.trialLineBilling");

  const [tab, setTab] = useState("pending");
  const [readiness, setReadiness] = useState("all"); // all | ready | blocked (client-side, this page)
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [party, setParty] = useState(null);
  const [searchText, setSearchText] = useState("");
  const search = useDebounce(searchText.trim(), 350);
  const [page, setPage] = useState(1);

  const [drafts, setDrafts] = useState({}); // tran_id → { invoice_no, vendor_bill_no, bill_date, lines }
  const [selected, setSelected] = useState(() => new Set());
  const [activeId, setActiveId] = useState(null);
  const [results, setResults] = useState({}); // tran_id → last generate result
  const [resultDialog, setResultDialog] = useState(null); // { results, invoicedCount, failedCount }
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [confirmIds, setConfirmIds] = useState(null);
  const [unlockRow, setUnlockRow] = useState(null);
  const [unlockReason, setUnlockReason] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const listRef = useRef(null);
  const searchRef = useRef(null);

  // Filters changed → back to page 1, nothing selected.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [tab, from, to, party, search]);

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["invoicing", kind, tab, from, to, party?.value ?? "", search, page],
    enabled: !!cfg,
    queryFn: async () => {
      const params = { status: tab, page, limit: PAGE_LIMIT };
      if (from) params.from = from;
      if (to) params.to = to;
      if (party?.value) params.party = party.value;
      if (search) params.search = search;
      const res = await axios.get(`/api/invoicing/${kind}`, { params });
      return res.data;
    },
    placeholderData: (prev) => prev,
    retry: (count, err) => err?.response?.status !== 403 && count < 2,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => (Array.isArray(data?.data) ? data.data : []), [data]);
  const total = Number(data?.total) || 0;
  const summary = data?.summary || {};
  const nextNo = data?.next_invoice_no || "";
  const pageCount = Math.max(1, Math.ceil(total / (Number(data?.limit) || PAGE_LIMIT)));
  const forbidden = error?.response?.status === 403;

  // Live state of every loaded row: status, open issues, preview totals.
  const live = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const d = drafts[r.tran_id];
      const issues = liveIssues(r, d);
      map.set(r.tran_id, {
        issues,
        status: rowStatus(r, d),
        totals: rowTotals(r, d),
      });
    }
    return map;
  }, [rows, drafts]);
  const liveOf = useCallback((r) => live.get(r.tran_id), [live]);
  const totalOf = useCallback((r) => live.get(r.tran_id)?.totals.total ?? 0, [live]);

  const pendingRows = useMemo(() => rows.filter((r) => !r.invoiced), [rows]);
  const readyRows = useMemo(() => pendingRows.filter((r) => liveOf(r)?.status === "ready"), [pendingRows, liveOf]);
  const blockedCount = pendingRows.length - readyRows.length;
  const pendingValue = pendingRows.reduce((s, r) => s + totalOf(r), 0);

  const visibleRows = useMemo(() => {
    if (tab === "invoiced" || readiness === "all") return rows;
    return rows.filter((r) => !r.invoiced && liveOf(r)?.status === readiness);
  }, [rows, tab, readiness, liveOf]);

  // Keep a record active whenever the queue has content.
  useEffect(() => {
    if (visibleRows.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!visibleRows.some((r) => r.tran_id === activeId)) setActiveId(visibleRows[0].tran_id);
  }, [visibleRows, activeId]);

  const activeIndex = visibleRows.findIndex((r) => r.tran_id === activeId);
  const activeRow = activeIndex >= 0 ? visibleRows[activeIndex] : null;

  const selectedRows = useMemo(
    () => readyRows.filter((r) => selected.has(r.tran_id)),
    [readyRows, selected],
  );
  const selectedTotal = selectedRows.reduce((s, r) => s + totalOf(r), 0);
  const selectableVisible = useMemo(
    () => visibleRows.filter((r) => liveOf(r)?.status === "ready"),
    [visibleRows, liveOf],
  );
  const allSelected = selectableVisible.length > 0 && selectableVisible.every((r) => selected.has(r.tran_id));

  // ── draft editing ──
  const onDraftChange = useCallback(
    (tranId, patch) => setDrafts((prev) => ({ ...prev, [tranId]: { ...(prev[tranId] || {}), ...patch } })),
    [],
  );
  const onLineChange = useCallback(
    (tranId, lineId, field, value) =>
      setDrafts((prev) => {
        const d = prev[tranId] || {};
        const lines = d.lines || {};
        return {
          ...prev,
          [tranId]: { ...d, lines: { ...lines, [lineId]: { ...(lines[lineId] || {}), [field]: value } } },
        };
      }),
    [],
  );

  const toggleSelect = useCallback(
    (tranId) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(tranId)) next.delete(tranId);
        else next.add(tranId);
        return next;
      }),
    [],
  );
  const toggleSelectAll = useCallback(
    () => setSelected(allSelected ? new Set() : new Set(selectableVisible.map((r) => r.tran_id))),
    [allSelected, selectableVisible],
  );

  const moveActive = useCallback(
    (delta) => {
      if (visibleRows.length === 0) return;
      const start = activeIndex < 0 ? 0 : activeIndex;
      const next = Math.min(Math.max(start + delta, 0), visibleRows.length - 1);
      const id = visibleRows[next].tran_id;
      setActiveId(id);
      listRef.current?.querySelector(`[data-row-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [visibleRows, activeIndex],
  );

  // ── generate ──
  const buildInvoice = (row) => {
    const d = drafts[row.tran_id] || {};
    const inv = {
      tran_id: row.tran_id,
      invoice_no: String(d.invoice_no ?? "").trim(),
      lines: (row.lines || []).map((l) => {
        const dl = d.lines?.[l.line_id];
        const out = {
          line_id: l.line_id,
          rate: Number(parseFloat(dl?.rate ?? l.rate)) || 0,
          st_rate: Number(parseFloat(dl?.st_rate ?? l.st_rate)) || 0,
          ack_qty: ackForRequest(effectiveLine(l, d).line, d),
        };
        // Billing unit / density — only when changed here (lib/invoicing/core.js withBillingUnit).
        if (dl?.unit !== undefined) out.unit = dl.unit;
        if (dl?.density !== undefined) out.density = dl.density;
        return out;
      }),
    };
    if (cfg.vendorBill) {
      const bill = String(d.vendor_bill_no ?? "").trim();
      if (bill) inv.vendor_bill_no = bill;
      if (d.bill_date) inv.bill_date = d.bill_date;
    }
    return inv;
  };

  // Typed invoice numbers must not repeat within one request.
  const duplicateNumbers = (ids) => {
    const seen = new Set();
    const dups = new Set();
    for (const id of ids) {
      const no = String(drafts[id]?.invoice_no ?? "").trim();
      if (!no) continue;
      if (seen.has(no)) dups.add(no);
      seen.add(no);
    }
    return [...dups];
  };

  const askGenerate = (ids) => {
    const targets = rows.filter((r) => ids.includes(r.tran_id) && !r.invoiced);
    if (!targets.length) return;
    const dups = duplicateNumbers(targets.map((r) => r.tran_id));
    if (dups.length) {
      toast.error(`${cfg.invoiceNoun} No ${dups.join(", ")} is typed on more than one ${cfg.docNoun}.`);
      return;
    }
    setConfirmIds(targets.map((r) => r.tran_id));
  };

  const generate = async (ids) => {
    const targets = rows.filter((r) => ids.includes(r.tran_id) && !r.invoiced);
    if (!targets.length) return;
    setBusyIds((prev) => new Set([...prev, ...targets.map((r) => r.tran_id)]));
    try {
      const res = await axios.post(`/api/invoicing/${kind}/generate`, {
        invoices: targets.map(buildInvoice),
      });
      const out = res.data || {};
      const list = Array.isArray(out.results) ? out.results : [];
      setResults((prev) => {
        const next = { ...prev };
        for (const r of list) if (r?.tran_id != null) next[r.tran_id] = r;
        return next;
      });
      const done = list.filter((r) => r.status === "invoiced").map((r) => r.tran_id);
      if (done.length) {
        setDrafts((prev) => {
          const next = { ...prev };
          for (const id of done) delete next[id];
          return next;
        });
        setSelected((prev) => new Set([...prev].filter((id) => !done.includes(id))));
      }
      const invoicedCount = Number(out.invoicedCount ?? done.length) || 0;
      const failedCount = Number(out.failedCount ?? list.length - done.length) || 0;
      if (list.length === 1) {
        const r = list[0];
        if (r.status === "invoiced") {
          toast.success(
            `${cfg.invoiceNoun} ${r.invoice_no} posted${r.total != null ? ` · ${fmtMoney(r.total)}` : ""}`,
          );
        } else {
          toast.error(r.message || `Could not invoice this ${cfg.docNoun}`, { duration: 6000 });
          setActiveId(r.tran_id);
        }
      } else {
        setResultDialog({ results: list, invoicedCount, failedCount });
      }
      setConfirmIds(null);
      await queryClient.invalidateQueries({ queryKey: ["invoicing", kind] });
    } catch (err) {
      toast.error(
        err?.response?.status === 403
          ? `You do not have permission to generate ${cfg.invoiceNounPlural.toLowerCase()} here.`
          : errorMessage(err, `Could not generate the ${cfg.invoiceNounPlural.toLowerCase()}`),
        { duration: 6000 },
      );
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        for (const r of targets) next.delete(r.tran_id);
        return next;
      });
    }
  };

  // ── unlock ──
  const closeUnlock = () => {
    setUnlockRow(null);
    setUnlockReason("");
  };
  const doUnlock = async () => {
    if (!unlockRow) return;
    setUnlocking(true);
    try {
      await axios.post(`/api/invoicing/${kind}/unlock`, {
        tran_id: unlockRow.tran_id,
        reason: unlockReason.trim() || null,
      });
      toast.success(`${unlockRow.doc_label} unlocked — ${cfg.invoiceNoun} ${unlockRow.invoice_no} reversed`);
      setResults((prev) => {
        const next = { ...prev };
        delete next[unlockRow.tran_id];
        return next;
      });
      closeUnlock();
      await queryClient.invalidateQueries({ queryKey: ["invoicing", kind] });
    } catch (err) {
      toast.error(
        err?.response?.status === 403
          ? `You do not have permission to unlock ${cfg.invoiceNounPlural.toLowerCase()} here.`
          : errorMessage(err, `Could not unlock this ${cfg.invoiceNoun.toLowerCase()}`),
        { duration: 6000 },
      );
    } finally {
      setUnlocking(false);
    }
  };

  const switchTab = useCallback((t) => {
    setTab(t);
    setReadiness("all");
  }, []);

  const resetFilters = () => {
    setFrom("");
    setTo("");
    setParty(null);
    setSearchText("");
    setReadiness("all");
  };

  // ── keyboard ──
  // Ignored while a dialog is open or the caret is in a field, except "/" and
  // Escape, which are how you get in and out of the search box.
  const dialogOpen = !!(confirmIds || unlockRow || resultDialog);
  useEffect(() => {
    if (!cfg) return undefined;
    const onKeyDown = (e) => {
      const el = e.target;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (dialogOpen) return;
      // Any other dialog (e.g. the attachment viewer) keeps its keys.
      if (el instanceof HTMLElement && el.closest('[role="dialog"]')) return;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (selectedRows.length > 0) {
          e.preventDefault();
          askGenerate(selectedRows.map((r) => r.tran_id));
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Enter / Space on a focused button or checkbox belong to that control.
      if ((e.key === "Enter" || e.key === " ") && el instanceof HTMLElement && el.closest("button,a,[role]")) return;
      const activeReady = activeRow && liveOf(activeRow)?.status === "ready";
      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          moveActive(1);
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          moveActive(-1);
          break;
        case "Home":
          e.preventDefault();
          moveActive(-visibleRows.length);
          break;
        case "End":
          e.preventDefault();
          moveActive(visibleRows.length);
          break;
        case "Enter":
          if (activeReady && !busyIds.has(activeRow.tran_id)) {
            e.preventDefault();
            askGenerate([activeRow.tran_id]);
          }
          break;
        case " ":
          if (activeReady) {
            e.preventDefault();
            toggleSelect(activeRow.tran_id);
          }
          break;
        case "a":
          if (selectableVisible.length > 0) {
            e.preventDefault();
            toggleSelectAll();
          }
          break;
        case "Escape":
          if (selected.size > 0) {
            e.preventDefault();
            setSelected(new Set());
          }
          break;
        case "r":
          e.preventDefault();
          refetch();
          break;
        case "1":
          e.preventDefault();
          switchTab("pending");
          break;
        case "2":
          e.preventDefault();
          setTab("pending");
          setReadiness("ready");
          break;
        case "3":
          e.preventDefault();
          setTab("pending");
          setReadiness("blocked");
          break;
        case "4":
          e.preventDefault();
          switchTab("invoiced");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!cfg) {
    return (
      <div className="min-h-screen bg-muted/40">
        <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
          <div className={UI.panel}>
            <CenterState icon={XCircle} tone="error" title="Unknown invoicing screen">
              Use Sale, Sale Return, Purchase or Purchase Return Invoicing.
            </CenterState>
          </div>
        </div>
      </div>
    );
  }

  const KindIcon = KIND_ICONS[kind] ?? Receipt;
  const filtersActive = !!(from || to || party || searchText || readiness !== "all");
  const SHORTCUTS = [
    { combo: "↑/↓", label: "Move through the queue" },
    { combo: "J/K", label: "Move through the queue (vi keys)" },
    { combo: "Home", label: "First record" },
    { combo: "End", label: "Last record" },
    { combo: "Enter", label: `Generate the active ${cfg.docNoun}'s ${cfg.invoiceNoun}` },
    { combo: "Space", label: `Add the active ${cfg.docNoun} to the batch` },
    { combo: "A", label: `Select every ready ${cfg.docNoun} / clear` },
    { combo: "Ctrl+Enter", label: "Generate the whole batch" },
    { combo: "Esc", label: "Drop the batch / leave a field" },
    { combo: "/", label: "Jump to search" },
    { combo: "R", label: "Refresh" },
    { combo: "1", label: "Pending" },
    { combo: "2", label: "Ready only" },
    { combo: "3", label: "Blocked only" },
    { combo: "4", label: "Invoiced" },
  ];
  const confirmRows = confirmIds ? rows.filter((r) => confirmIds.includes(r.tran_id)) : null;
  const activeLive = activeRow ? liveOf(activeRow) : null;
  const firstShown = total ? (page - 1) * PAGE_LIMIT + 1 : 0;
  const lastShown = Math.min(page * PAGE_LIMIT, total);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-5 sm:px-6">
        {/* ── header ── */}
        <LabHeader
          breadcrumb="Invoicing"
          icon={KindIcon}
          title={cfg.title}
          subtitle={`${cfg.subtitle} · ${cfg.invoiceNoun} number issued automatically`}
          actions={
            <>
              <Button
                variant="outline"
                className="h-9 gap-1.5"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label="Refresh (R)"
                title="Refresh (R)"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                Refresh
              </Button>
              <KeyboardHint shortcuts={SHORTCUTS} className="h-9" />
            </>
          }
        />

        {trialBilling ? <ApprovedTrialItems onBilled={() => refetch()} /> : null}

        {/* ── stat tiles (click to filter the queue) ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatChip
            icon={FileText}
            label="Pending"
            value={summary.pending ?? "—"}
            active={tab === "pending" && readiness === "all"}
            onClick={() => switchTab("pending")}
          />
          <StatChip
            icon={Sparkles}
            label="Ready"
            tone="ready"
            value={tab === "invoiced" ? "—" : readyRows.length}
            active={tab !== "invoiced" && readiness === "ready"}
            title="Ready to invoice, on this page"
            onClick={() => {
              if (tab === "invoiced") setTab("pending");
              setReadiness("ready");
            }}
          />
          <StatChip
            icon={AlertTriangle}
            label="Blocked"
            tone="blocked"
            value={tab === "invoiced" ? "—" : blockedCount}
            active={tab !== "invoiced" && readiness === "blocked"}
            title="Need a fix before they can be invoiced, on this page"
            onClick={() => {
              if (tab === "invoiced") setTab("pending");
              setReadiness("blocked");
            }}
          />
          <StatChip
            icon={CheckCircle2}
            label="Invoiced"
            tone="invoiced"
            value={summary.invoiced ?? "—"}
            active={tab === "invoiced"}
            onClick={() => switchTab("invoiced")}
          />
          <StatChip
            icon={Coins}
            label="Pending Value"
            tone="value"
            value={tab === "invoiced" ? "—" : fmtCompact(pendingValue)}
            title={`Preview value of the pending ${cfg.docNounPlural} on this page: ${fmtMoney(pendingValue)}`}
          />
          <StatChip icon={Hash} label={`Next ${cfg.invoiceChip}`} value={nextNo || "—"} mono />
        </div>

        {/* ── filters ── */}
        <div className={cn("flex flex-wrap items-center gap-2 p-3", UI.panel)}>
          <Segmented
            value={tab}
            onChange={switchTab}
            options={[
              { value: "pending", label: "Pending", count: summary.pending },
              { value: "invoiced", label: "Invoiced", count: summary.invoiced },
              {
                value: "all",
                label: "All",
                count:
                  summary.pending != null || summary.invoiced != null
                    ? (Number(summary.pending) || 0) + (Number(summary.invoiced) || 0)
                    : undefined,
              },
            ]}
          />

          <div className="relative w-full min-w-0 sm:min-w-[220px] sm:flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={`Search ${cfg.docNoun} no, ${{ 4: "manual GRN no, ", 6: "manual DC no, ", 10: "manual DC / GRN no, " }[cfg.tranCode] ?? ""}order no, ${cfg.partyLabel.toLowerCase()}, invoice no${cfg.vendorBill ? ", vendor bill" : ""}…`}
              aria-label="Search (press /)"
              className="h-10 rounded-lg bg-background pl-9 pr-10"
            />
            {searchText ? (
              <button
                type="button"
                onClick={() => setSearchText("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-b-2 border-border bg-background px-1.5 font-mono text-[11px] font-semibold text-muted-foreground sm:inline">
                /
              </kbd>
            )}
          </div>

          <div className="w-full sm:w-[260px]">
            <PartyPicker endpoint={cfg.partyEndpoint} label={cfg.partyLabel} value={party} onChange={setParty} />
          </div>

          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <DateField value={from} onChange={setFrom} clearable className="min-w-0 flex-1 sm:w-[150px] sm:flex-none" inputClassName="h-10" />
            <span className={cn("text-sm", UI.muted)}>to</span>
            <DateField value={to} onChange={setTo} clearable className="min-w-0 flex-1 sm:w-[150px] sm:flex-none" inputClassName="h-10" />
          </div>

          <Button variant="ghost" className="h-10 gap-1.5 text-muted-foreground" onClick={resetFilters} disabled={!filtersActive}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>

        {/* ── master / detail ── */}
        {forbidden ? (
          <div className={UI.panel}>
            <CenterState icon={ShieldOff} tone="error" title="No access">
              You do not have permission to view {cfg.title}. Ask an administrator for the invoicing.{kind}.view
              permission.
            </CenterState>
          </div>
        ) : error && !data ? (
          <div className={UI.panel}>
            <CenterState
              icon={XCircle}
              tone="error"
              title={`Could not load ${cfg.docNounPlural}`}
              action={
                <Button variant="outline" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4" /> Try again
                </Button>
              }
            >
              {errorMessage(error, "The server did not respond.")}
            </CenterState>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3 xl:h-[calc(100dvh-5rem)] xl:min-h-[600px] xl:flex-row">
            {/* left rail — the queue */}
            <aside
              className={cn(
                "flex max-h-[440px] w-full shrink-0 flex-col overflow-hidden xl:max-h-none xl:w-[360px] 2xl:w-[400px]",
                UI.panel,
              )}
            >
              <div className={cn("flex shrink-0 flex-wrap items-center gap-2 px-3 py-2.5", UI.panelHead)}>
                <Checkbox
                  checked={allSelected}
                  disabled={selectableVisible.length === 0}
                  onCheckedChange={toggleSelectAll}
                  aria-label={`Select all ready ${cfg.docNounPlural}`}
                />
                <span className="text-sm font-semibold text-primary">
                  {visibleRows.length} {visibleRows.length === 1 ? cfg.docNoun : cfg.docNounPlural}
                </span>
                {selectableVisible.length > 0 ? (
                  <span className={cn("text-xs", UI.muted)}>· {selectableVisible.length} ready</span>
                ) : null}
                <span className={cn("ml-auto flex items-center gap-1.5 text-xs tabular-nums", UI.muted)} title="Last refreshed">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", isFetching ? "animate-pulse bg-primary" : "bg-[#4d7a5a] dark:bg-emerald-400")}
                  />
                  {dataUpdatedAt
                    ? new Date(dataUpdatedAt).toLocaleTimeString("en-GB", { hour12: false })
                    : "—"}
                </span>
              </div>

              <div ref={listRef} className={cn("min-h-0 flex-1 overflow-y-auto", isFetching && !isLoading && "opacity-70")}>
                {isLoading ? (
                  <div className="divide-y divide-border">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="flex items-start gap-2.5 px-3 py-3">
                        <Skeleton className="h-4 w-4 rounded" />
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-4 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : visibleRows.length === 0 ? (
                  tab === "pending" && !filtersActive ? (
                    <CenterState icon={CheckCircle2} tone="ok" title="All caught up">
                      No {cfg.docNounPlural} are waiting to be invoiced.
                    </CenterState>
                  ) : (
                    <CenterState icon={FileCheck2} title="No matches">
                      {filtersActive ? "Widen the date range, or press Reset." : "There is nothing here yet."}
                    </CenterState>
                  )
                ) : (
                  visibleRows.map((row) => {
                    const l = liveOf(row);
                    return (
                      <QueueItem
                        key={row.tran_id}
                        row={row}
                        cfg={cfg}
                        status={l.status}
                        total={l.totals.total}
                        issueCount={l.issues.length}
                        isActive={row.tran_id === activeId}
                        selected={selected.has(row.tran_id)}
                        result={results[row.tran_id]}
                        onSelect={setActiveId}
                        onToggleSelect={toggleSelect}
                      />
                    );
                  })
                )}
              </div>

              {/* pagination */}
              {total > PAGE_LIMIT ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-1.5">
                  <span className={cn("text-xs tabular-nums", UI.muted)}>
                    {firstShown.toLocaleString("en-US")}–{lastShown.toLocaleString("en-US")} of{" "}
                    {total.toLocaleString("en-US")}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-1 text-xs font-semibold tabular-nums">
                      {page} / {pageCount}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={page >= pageCount}
                      onClick={() => setPage((p) => p + 1)}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* keyboard hints */}
              <div className="hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground sm:flex">
                <span className="flex items-center gap-1">
                  <ChevronUp className="h-3 w-3" />
                  <ChevronDown className="h-3 w-3" /> move
                </span>
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="h-3 w-3" /> invoice
                </span>
                <span className="flex items-center gap-1">
                  <MousePointerClick className="h-3 w-3" /> space = select
                </span>
              </div>
            </aside>

            {/* right panel — the record */}
            <section className={cn("min-w-0 flex-1 overflow-hidden", UI.panel)}>
              {isLoading ? (
                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-11 w-11 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-1/3" />
                      <Skeleton className="h-4 w-1/4" />
                    </div>
                  </div>
                  <Skeleton className="h-24 w-full rounded-xl" />
                  <Skeleton className="h-56 w-full rounded-xl" />
                </div>
              ) : (
                <DetailPanel
                  kind={kind}
                  row={activeRow}
                  cfg={cfg}
                  draft={activeRow ? drafts[activeRow.tran_id] : null}
                  totals={activeLive?.totals ?? { qty: 0, gross: 0, tax: 0, total: 0 }}
                  status={activeLive?.status}
                  issues={activeLive?.issues ?? []}
                  nextNo={nextNo}
                  result={activeRow ? results[activeRow.tran_id] : null}
                  busy={
                    !!activeRow &&
                    (busyIds.has(activeRow.tran_id) || (unlocking && unlockRow?.tran_id === activeRow.tran_id))
                  }
                  onDraftChange={onDraftChange}
                  onLineChange={onLineChange}
                  onGenerate={(row) => askGenerate([row.tran_id])}
                  onUnlock={setUnlockRow}
                />
              )}
            </section>
          </div>
        )}

        {/* ── selection bar: the batch to generate ── */}
        <AnimatePresence>
          {selectedRows.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3"
            >
              <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary/30 bg-background/95 px-4 py-2.5 shadow-xl backdrop-blur">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground">
                    {selectedRows.length}
                  </span>
                  <span className="text-muted-foreground">
                    {selectedRows.length === 1 ? cfg.docNoun : cfg.docNounPlural} selected
                  </span>
                  <span className="ml-auto font-semibold tabular-nums text-foreground sm:ml-2">{fmtMoney(selectedTotal)}</span>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <Button size="sm" variant="ghost" className="max-sm:flex-1" onClick={() => setSelected(new Set())}>
                    Clear
                    <Kbd className="ml-1 hidden sm:inline">Esc</Kbd>
                  </Button>
                  <Button
                    size="sm"
                    className="max-sm:flex-1"
                    disabled={selectedRows.some((r) => busyIds.has(r.tran_id))}
                    onClick={() => askGenerate(selectedRows.map((r) => r.tran_id))}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate {selectedRows.length}{" "}
                    {selectedRows.length === 1 ? cfg.invoiceNoun : cfg.invoiceNounPlural}
                    <Kbd className="ml-1 hidden sm:inline">Ctrl+↵</Kbd>
                  </Button>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {/* room so the selection bar never covers the last row */}
        {selectedRows.length > 0 ? <div aria-hidden className="h-24 sm:h-16" /> : null}

        <ConfirmGenerateDialog
          cfg={cfg}
          rows={confirmRows}
          drafts={drafts}
          totalOf={totalOf}
          nextNo={nextNo}
          busy={!!confirmRows?.some((r) => busyIds.has(r.tran_id))}
          onCancel={() => setConfirmIds(null)}
          onConfirm={() => generate(confirmIds)}
        />

        <UnlockDialog
          cfg={cfg}
          row={unlockRow}
          reason={unlockReason}
          onReasonChange={setUnlockReason}
          busy={unlocking}
          onCancel={closeUnlock}
          onConfirm={doUnlock}
        />

        <ResultsDialog cfg={cfg} result={resultDialog} rows={rows} onClose={() => setResultDialog(null)} />
      </div>
    </div>
  );
}
