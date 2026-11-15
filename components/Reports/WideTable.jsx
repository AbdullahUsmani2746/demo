"use client";
// The wide report table (CLAUDE.md rule 15, design: artifact "Wide Report
// Layout"). Identity columns stay pinned on the left; related columns sit
// under a header band that folds to one column; views pick ready-made column
// sets; empty columns hide themselves; row groups get subtotals; the grand
// total stays pinned at the bottom. A row click (or Enter) opens the row
// panel. Phones get cards. Over 300 rows only the rows in sight are drawn.
//
// Everything here is presentation of rows the report already returned — no
// fetching, no writes. The layout comes from components/Reports/layout.js.
//
// Report Table Redesign (artifact "Report Table Redesign", screen 2):
//   · no filler column — the widest text column takes the spare width; the
//     action column is as wide as its icons and pinned to the right
//   · numbers in tabular digits; amounts / rates / quantities / totals bold as
//     the user chose under "Display" (DisplayMenu.jsx, saved on the account:
//     size, weight, lakh or international grouping, thousand / lakh / crore,
//     negatives, decimals, dates, striped rows, highlight rules)
//   · tick rows → a bar with their count and sums, Copy for WhatsApp / Excel
//   · search highlights the match; a value in a cell can filter the report
//     (only / except, as chips); each header has a ▾ menu (sort, hide, pin)
//   · amount in words on hover; arrows move between rows, Enter opens, Space
//     ticks; "Compare with previous period" adds prev + change % columns
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Layers,
  Pin,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useReportDisplay } from "@/hooks/useReportDisplay";
import { amountInWords } from "@/lib/reports/displayPrefs";
import DisplayMenu from "./DisplayMenu";
import HighlightMenu, { RULE_TONES } from "./HighlightMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import RowDetailPanel from "./RowDetailPanel";
import ReportCards from "./ReportCards";
import {
  buildGroupTree,
  buildGroupedItems,
  buildItems,
  cardFigures,
  computeTotals,
  dateSortValue,
  emptyColumnKeys,
  estimateWidth,
  formatValue,
  groupTreeIds,
  hasTotals,
  cellText,
  isAmountCol,
  isNumericCol,
  numberKind,
  numValue,
  rawValue,
  rowMatches,
} from "./layout";

const WINDOW_AFTER = 300; // rows before only the visible ones are drawn
const OVERSCAN = 12;
const ROW_H = { compact: 28, comfortable: 36 };
const SIZE_ROW_DELTA = { S: -2, M: 0, L: 4 };
const FONT_PX = { S: 12, M: 13, L: 14.5 };
const WEIGHT = { regular: 400, medium: 600, bold: 700 };
const BAND_H = 28;
const HEAD_H = 30;
const ICON_W = 28; // one row-action icon
const SEL_W = 30; // the tick column

// Tints that stay opaque on sticky cells: a layer over the row background,
// applied as an inline style (a class built at run time would never reach
// Tailwind's CSS).
const layer = (color) => (color ? { backgroundImage: `linear-gradient(${color},${color})` } : undefined);
const TINT_ZEBRA = "hsl(var(--muted)/0.55)";
const TINT_HIGH = "rgba(245,158,11,0.16)";
const TINT_NEG = "rgba(220,38,38,0.10)";
const TINT_SEL = "hsl(var(--primary)/0.12)";

function Highlight({ text, term }) {
  if (!term || !text) return text;
  const at = String(text).toLowerCase().indexOf(term);
  if (at < 0) return text;
  const s = String(text);
  return (
    <>
      {s.slice(0, at)}
      <mark className="rounded-[2px] bg-amber-200 px-px text-inherit dark:bg-amber-400/40">{s.slice(at, at + term.length)}</mark>
      {s.slice(at + term.length)}
    </>
  );
}

const viewsKey = (reportType) => `ebizz.reportViews.v1.${reportType}`;
const readSaved = (reportType) => {
  try {
    const raw = window.localStorage.getItem(viewsKey(reportType));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const writeSaved = (reportType, list) => {
  try {
    window.localStorage.setItem(viewsKey(reportType), JSON.stringify(list));
  } catch {
    // private window / blocked storage — the view simply is not kept
  }
};

function Seg({ label, options, value, onChange }) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {label && <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>}
      <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-muted/50 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
            className={`h-8 shrink-0 whitespace-nowrap rounded-md px-2.5 text-[12.5px] transition-colors sm:h-7 ${
              value === o.id ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-[15px] w-[15px] accent-primary" />
      {children}
    </label>
  );
}

const WideTable = forwardRef(function WideTable(
  {
    reportType,
    model,
    rows,
    hiddenColumns = {},
    blinkCells,
    initialView,
    onViewChange,
    actionsFor = () => [],
    customRowActions = [],
    onCustomAction,
    panelSubtitle,
    initialScroll,
    onAmountsChange, // ("full" | "k" | "lakh" | "crore") — the viewer's KPI strip follows "Show amounts as"
    // The report's own warnings (components/Reports/config.js), always shown:
    //   highlightRow(row)      whole row shaded red (e.g. below re-order level)
    //   blinkCellsPurple(row)  whole row yellow (e.g. stock below re-order level)
    //   rowTextClass(row)      text colour of the row (e.g. ACTUAL blue / VARIANCE red)
    highlightRow,
    blinkCellsPurple,
    rowTextClass,
    // Previous period for "Compare with previous period" (ReportViewer):
    // { available, on, rows, loading, onToggle(bool) }
    compare,
  },
  ref,
) {
  const isMobile = useIsMobile();

  // ── state ────────────────────────────────────────────────────────────────
  const [display, updateDisplay] = useReportDisplay();
  const density = display.density;
  const amounts = display.scale;
  const [view, setView] = useState(() => model.views.find((v) => v.id === initialView)?.id ?? model.defaultView);
  const [folded, setFolded] = useState(() => new Set());
  const [off, setOff] = useState(() => new Set());
  const [hideEmpty, setHideEmpty] = useState(true);
  const [groupRows, setGroupRows] = useState(true);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sort, setSort] = useState(null); // { key, dir: -1 | 1 }
  const [hiddenCols, setHiddenCols] = useState(() => new Set()); // header ▾ → Hide
  const [extraPin, setExtraPin] = useState(0); // header ▾ → Pin up to here
  const [valueFilters, setValueFilters] = useState([]); // [{ key, label, text, mode: "only" | "except" }]
  const [ticked, setTicked] = useState(() => new Set()); // ticked rows (objects)
  const lastTickRef = useRef(-1);
  const [unit, setUnit] = useState(model.unitSwitch?.default ?? null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [saved, setSaved] = useState([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [scrolledX, setScrolledX] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(640);

  const scrollRef = useRef(null);
  const searchRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => setSaved(readSaved(reportType)), [reportType]);

  useEffect(() => {
    onAmountsChange?.(amounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amounts]);

  // A layout that is a function of the filters can drop the current view.
  const activeView = model.views.find((v) => v.id === view) || model.views.find((v) => v.id === model.defaultView) || null;
  useEffect(() => {
    if (activeView) onViewChange?.(activeView.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView?.id]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  // "/" focuses the report search (Ctrl+K stays the header's menu search).
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── compare with the previous period ─────────────────────────────────────
  // A row of the previous period is matched by the identity (pinned) columns
  // — code / name — and rides along as row.__prev. Not for grouped documents.
  const identityCols = useMemo(() => model.pinned.map((k) => model.byKey.get(k)).filter(Boolean), [model]);
  const compareOn = !!(compare?.on && Array.isArray(compare.rows) && !model.groupRows && identityCols.length);
  const baseRows = useMemo(() => {
    if (!compareOn) return rows;
    const keyOf = (r) => identityCols.map((c) => String(rawValue(c, r) ?? "")).join("\u0001");
    const prev = new Map();
    compare.rows.forEach((r) => {
      const k = keyOf(r);
      if (!prev.has(k)) prev.set(k, r);
    });
    return rows.map((r) => ({ ...r, __prev: prev.get(keyOf(r)) || null }));
  }, [compareOn, rows, compare?.rows, identityCols]);
  useEffect(() => setTicked(new Set()), [baseRows]);

  // ── grouped documents (layout.groupRows) ─────────────────────────────────
  // The row_type stream becomes a tree once per data change; header rows,
  // lines and build-up lines are what the columns measure.
  const tree = useMemo(() => (model.groupRows ? buildGroupTree(model.groupRows, baseRows) : null), [model, baseRows]);
  const measureRows = tree ? tree.all : baseRows;
  const hasRowGroups = !!tree || model.rowGroupBy.length > 0;

  // ── columns ──────────────────────────────────────────────────────────────
  const levels = useMemo(() => (groupRows ? model.rowGroupBy : []), [groupRows, model.rowGroupBy]);
  const empty = useMemo(() => emptyColumnKeys(model, measureRows), [model, measureRows]);
  const groupEmpty = useCallback(
    (g) => g.fields.every((f) => empty.has(f) || !isNumericCol(model.byKey.get(f))) && g.fields.some((f) => empty.has(f)),
    [empty, model],
  );

  const { visibleCols, hiddenEmptyCount } = useMemo(() => {
    const groupFields = new Set(levels.filter((l) => !l.keepColumn).map((l) => l.field));
    const unitHidden = new Set();
    model.unitSwitch?.options.forEach((o) => {
      if (o.id !== unit) o.fields.forEach((f) => unitHidden.add(f));
    });
    const viewFields = activeView?.fields || null;
    const isHidden = (c) => !!hiddenColumns?.[c.field ?? c.key] || hiddenCols.has(c.key);
    let hiddenEmpty = 0;

    const pinned = model.pinned.map((k) => model.byKey.get(k)).filter((c) => c && !isHidden(c));
    const candidates = [];
    model.columns.forEach((c) => {
      if (model.pinnedSet.has(c.key) || isHidden(c)) return;
      if (groupFields.has(c.key) || unitHidden.has(c.key)) return;
      if (viewFields && !viewFields.has(c.key)) return;
      const g = model.groupOf.get(c.key);
      if (g && off.has(g.id)) return;
      if (hideEmpty && empty.has(c.key)) {
        hiddenEmpty++;
        return;
      }
      candidates.push(c);
    });
    const out = [];
    const foldedSeen = new Set();
    candidates.forEach((c) => {
      const g = model.groupOf.get(c.key);
      if (!g || !folded.has(g.id)) return out.push(c);
      if (foldedSeen.has(g.id)) return;
      foldedSeen.add(g.id);
      const inGroup = candidates.filter((x) => model.groupOf.get(x.key) === g);
      out.push(inGroup.find((x) => x.key === g.foldTo) || inGroup[0]);
    });
    // Compare: each amount column gets "· prev" and "Change %" beside it.
    const withCompare = (c) => {
      if (!compareOn || !isAmountCol(c) || model.pinnedSet.has(c.key)) return [c];
      return [
        c,
        {
          key: `${c.key}__prev`,
          headerName: `${c.headerName} · prev`,
          type: c.type,
          synthetic: true,
          base: c,
          showTotal: c.showTotal,
          valueGetter: ({ row }) => (row.__prev ? rawValue(c, row.__prev) : null),
        },
        {
          key: `${c.key}__chg`,
          headerName: "Change %",
          type: "percent",
          synthetic: true,
          base: c,
          valueGetter: ({ row }) => {
            const p = row.__prev ? numValue(c, row.__prev) : 0;
            return p ? ((numValue(c, row) - p) / Math.abs(p)) * 100 : null;
          },
        },
      ];
    };
    return { visibleCols: [...pinned, ...out].flatMap(withCompare), hiddenEmptyCount: hiddenEmpty };
  }, [model, levels, unit, activeView, hiddenColumns, hiddenCols, off, hideEmpty, empty, folded, compareOn]);

  // Columns by key, the compare columns too.
  const colByKey = useCallback((key) => model.byKey.get(key) || visibleCols.find((c) => c.key === key), [model, visibleCols]);

  const basePinned = visibleCols.filter((c) => model.pinnedSet.has(c.key)).length;
  const pinnedCount = Math.max(0, Math.min(visibleCols.length - 1, basePinned + extraPin));
  const scrollCols = visibleCols.slice(pinnedCount);

  const widths = useMemo(() => {
    const m = new Map();
    model.columns.forEach((c) => m.set(c.key, estimateWidth(c, measureRows, { amounts })));
    return m;
  }, [model, measureRows, amounts]);
  const colWidth = useCallback(
    (c) => widths.get(c?.key) || (c?.synthetic ? (c.type === "percent" ? 92 : widths.get(c.base?.key) || 110) : 100),
    [widths],
  );
  // The column that takes the spare width: the widest text column that
  // scrolls (a narration / name), else the last column. No filler column.
  const flexKey = useMemo(() => {
    const scroll = visibleCols.slice(pinnedCount);
    const text = scroll.filter((c) => !isNumericCol(c) && c.type !== "date");
    if (text.length) return text.reduce((a, c) => (colWidth(c) > colWidth(a) ? c : a)).key;
    return visibleCols[visibleCols.length - 1]?.key ?? null;
  }, [visibleCols, pinnedCount, colWidth]);
  const selCol = !isMobile; // the tick column (desktop)
  const lefts = useMemo(() => {
    const out = [];
    let x = selCol ? SEL_W : 0;
    visibleCols.slice(0, pinnedCount).forEach((c) => {
      out.push(x);
      x += colWidth(c);
    });
    return out;
  }, [visibleCols, pinnedCount, colWidth, selCol]);

  // Header band: runs of the same column group over the scrolling columns.
  const bands = useMemo(() => {
    const out = [];
    scrollCols.forEach((c) => {
      const g = model.groupOf.get(c.key) || null;
      const last = out[out.length - 1];
      if (last && last.group === g) last.span++;
      else out.push({ group: g, span: 1, first: c.key });
    });
    return out;
  }, [scrollCols, model]);
  const hasBands = bands.some((b) => b.group);
  const bandStart = useMemo(() => new Set(bands.map((b) => b.first)), [bands]);

  // ── rows ─────────────────────────────────────────────────────────────────
  // Search + the "only / except this value" chips (flat reports).
  const flatFiltered = useMemo(() => {
    if (tree) return null;
    let list = search ? baseRows.filter((r) => rowMatches(model, r, search)) : baseRows;
    valueFilters.forEach((f) => {
      const col = model.byKey.get(f.key);
      if (!col) return;
      list = list.filter((r) => (cellText(col, r) === f.text) === (f.mode === "only"));
    });
    return list;
  }, [tree, baseRows, model, search, valueFilters]);

  const sortRows = useCallback(
    (list) => {
      if (!sort) return list;
      const col = colByKey(sort.key);
      if (!col) return list;
      const val = isNumericCol(col)
        ? (r) => numValue(col, r)
        : col.type === "date"
          ? (r) => dateSortValue(rawValue(col, r))
          : (r) => String(rawValue(col, r) ?? "").toLowerCase();
      const keyed = list.map((r) => [val(r), r]);
      keyed.sort((a, b) => {
        const x = a[0];
        const y = b[0];
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return c * sort.dir;
      });
      return keyed.map((k) => k[1]);
    },
    [sort, colByKey],
  );

  const totalsOn = hasTotals(model);
  const grouped = useMemo(
    () => (tree ? buildGroupedItems(model, tree, { search, collapsed, sortRows, withTotals: totalsOn, grouped: groupRows }) : null),
    [tree, model, search, collapsed, sortRows, totalsOn, groupRows],
  );
  const filtered = grouped ? grouped.leaves : flatFiltered;
  const allRowsCount = tree ? tree.leaves.length : baseRows.length;
  const items = useMemo(
    () => grouped?.items ?? buildItems(model, filtered, { levels, collapsed, sortRows, withTotals: totalsOn }),
    [grouped, model, filtered, levels, collapsed, sortRows, totalsOn],
  );
  // Totals once per data change (rows, search), not per render. A grouped
  // report may have no grand total (grandTotal: false → null).
  const totals = useMemo(() => {
    const t = grouped ? grouped.totals : totalsOn ? computeTotals(model, filtered) : {};
    if (!compareOn || !t) return t;
    // The compare columns: previous-period sums and their change %.
    const out = { ...t };
    visibleCols.forEach((c) => {
      if (!c.synthetic || !c.base?.showTotal) return;
      const prevSum = filtered.reduce((a, r) => a + (r.__prev ? numValue(c.base, r.__prev) : 0), 0);
      if (c.key.endsWith("__prev")) out[c.key] = prevSum;
      else if (prevSum && t[c.base.key] !== undefined) out[c.key] = ((t[c.base.key] - prevSum) / Math.abs(prevSum)) * 100;
    });
    return out;
  }, [grouped, model, filtered, totalsOn, compareOn, visibleCols]);
  const showGrand = totalsOn && !!totals;
  // Every group id, for Expand all / Collapse all.
  const allGroupIds = useMemo(() => {
    if (tree) return groupRows ? groupTreeIds(tree) : [];
    if (!levels.length) return [];
    return buildItems(model, filtered, { levels, collapsed: new Set(), withTotals: false })
      .filter((i) => i.type === "group")
      .map((i) => i.id);
  }, [tree, groupRows, levels, model, filtered]);

  const figures = useMemo(() => cardFigures(model, visibleCols), [model, visibleCols]);
  const figTotals = useMemo(() => {
    const t = { ...(totals || {}) };
    figures.forEach((f) => {
      if (t[f.key] === undefined && !model.byKey.has(f.key)) t[f.key] = filtered.reduce((a, r) => a + (Number(f.get(r)) || 0), 0);
    });
    return t;
  }, [totals, figures, filtered, model]);

  // ── windowing ────────────────────────────────────────────────────────────
  const rowH = ROW_H[density] + (SIZE_ROW_DELTA[display.size] || 0);
  const headH = hasBands ? BAND_H + HEAD_H : HEAD_H;
  const virtual = !isMobile && items.length > WINDOW_AFTER;
  let start = 0;
  let end = items.length;
  if (virtual) {
    start = Math.max(0, Math.floor((scrollTop - headH) / rowH) - OVERSCAN);
    end = Math.min(items.length, start + Math.ceil(viewportH / rowH) + OVERSCAN * 2);
  }

  const onScroll = useCallback((e) => {
    const el = e.currentTarget;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setScrollTop(el.scrollTop);
      setScrolledX(el.scrollLeft > 4);
      setViewportH(el.clientHeight || 640);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  useEffect(() => {
    if (scrollRef.current) setViewportH(scrollRef.current.clientHeight || 640);
  }, [items.length, isMobile]);

  // Back from a drill lands on the same place.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !initialScroll || !rows.length) return;
    restoredRef.current = true;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = initialScroll.top || 0;
        el.scrollLeft = initialScroll.left || 0;
      }
      if (initialScroll.win) window.scrollTo(0, initialScroll.win);
    });
  }, [initialScroll, rows.length]);

  // ── actions ──────────────────────────────────────────────────────────────
  const openRow = useCallback((row) => setSelected(row), []);
  const toggleGroupRow = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const toggleFold = (id) =>
    setFolded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleGroupChip = (g) => {
    if (hideEmpty && groupEmpty(g)) {
      setHideEmpty(false);
      setOff((prev) => {
        const next = new Set(prev);
        next.delete(g.id);
        return next;
      });
      return;
    }
    setOff((prev) => {
      const next = new Set(prev);
      next.has(g.id) ? next.delete(g.id) : next.add(g.id);
      return next;
    });
  };
  // Click a column: largest first, then smallest first, then off.
  const cycleSort = (key) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));

  // Rows / amounts / grouping are the user's Display settings (every report),
  // so a saved view keeps only what belongs to this report.
  const snapshot = () => ({
    view: activeView?.id ?? null,
    folded: [...folded],
    off: [...off],
    hidden: [...hiddenCols],
    pin: extraPin,
    hideEmpty,
    groupRows,
    unit,
    sort,
  });
  const applySnapshot = (s) => {
    if (!s) return;
    if (s.view !== undefined) setView(s.view);
    setFolded(new Set(s.folded || []));
    setOff(new Set(s.off || []));
    setHiddenCols(new Set(s.hidden || []));
    setExtraPin(Number(s.pin) || 0);
    setHideEmpty(s.hideEmpty !== false);
    setGroupRows(s.groupRows !== false);
    if (s.unit) setUnit(s.unit);
    setSort(s.sort || null);
  };
  const saveView = () => {
    const name = saveName.trim();
    if (!name) return;
    const list = [...saved.filter((v) => v.name !== name), { id: String(Date.now()), name, state: snapshot() }];
    setSaved(list);
    writeSaved(reportType, list);
    setSaveOpen(false);
    setSaveName("");
  };
  const deleteSaved = (id) => {
    const list = saved.filter((v) => v.id !== id);
    setSaved(list);
    writeSaved(reportType, list);
  };

  // ── exports read the same model ──────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      getExportModel(mode = "view") {
        const cols =
          mode === "all"
            ? [
                ...model.pinned.map((k) => model.byKey.get(k)).filter(Boolean),
                ...model.columns.filter((c) => !model.pinnedSet.has(c.key)),
              ]
            : visibleCols;
        const pinnedN = cols.filter((c) => model.pinnedSet.has(c.key)).length;
        return {
          columns: cols,
          pinnedCount: pinnedN,
          groupOf: (key) => model.groupOf.get(key) || null,
          // As on screen: a folded group prints as its heading and subtotal only
          items: tree
            ? buildGroupedItems(model, tree, { search, collapsed, sortRows, withTotals: totalsOn, grouped: groupRows }).items
            : buildItems(model, filtered, { levels, collapsed, sortRows, withTotals: totalsOn }),
          totals: totals || {},
          hasTotals: showGrand,
          // Grouped documents write plain values: header rows carry figures
          // and some subtotals are the server's, so SUBTOTAL formulas would lie.
          formulas: !tree,
          amounts: mode === "all" ? "full" : amounts,
          viewLabel: mode === "all" ? "Everything" : activeView?.label || "Current view",
        };
      },
      getScroll() {
        const el = scrollRef.current;
        return { top: el?.scrollTop || 0, left: el?.scrollLeft || 0, win: typeof window !== "undefined" ? window.scrollY : 0 };
      },
      getView: () => activeView?.id ?? null,
    }),
    [model, tree, search, groupRows, visibleCols, filtered, levels, collapsed, sortRows, totalsOn, showGrand, totals, amounts, activeView],
  );

  // ── render helpers ───────────────────────────────────────────────────────
  // The action column is as wide as the most icons a row has (≤ 3) plus any
  // text buttons — never a fixed three-icon block.
  const actionIcons = useMemo(() => {
    let most = 0;
    for (let i = 0; i < measureRows.length && i < 80; i++) most = Math.max(most, Math.min(3, actionsFor(measureRows[i]).length));
    return most;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureRows]);
  const hasActionCol = customRowActions.length > 0 || actionIcons > 0;
  const actionW = hasActionCol ? Math.max(40, actionIcons * ICON_W + 12 + customRowActions.length * 74) : 0;
  const pinnedWidth = lefts.length ? lefts[lefts.length - 1] + colWidth(visibleCols[pinnedCount - 1]) : 0;
  const tableMinWidth = visibleCols.reduce((a, c) => a + colWidth(c), 0) + actionW + (selCol ? SEL_W : 0);
  const amountCols = visibleCols.filter((c) => isAmountCol(c) && !c.synthetic);

  const pinStyle = (i, extra = {}) => ({ position: "sticky", left: lefts[i], ...extra });
  const edge = (i) => (i === pinnedCount - 1 && scrolledX ? "shadow-[6px_0_8px_-6px_rgba(0,0,0,0.25)]" : "");
  const actionStyle = (extra = {}) => ({ position: "sticky", right: 0, zIndex: 1, ...extra });
  const actionEdge = "shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.18)]";

  // Weight of a number: the user's "Make bold" choices.
  const weightOf = (col, total = false) => {
    if (total) return display.bold.totals ? Math.max(WEIGHT[display.weight], 700) : 600;
    const kind = numberKind(col);
    return kind && display.bold[kind] ? WEIGHT[display.weight] : 400;
  };

  const numCell = (col, v, key, extraCls = "", { total = false, style } = {}) => {
    const text = formatValue(col, v, { amounts });
    const n = Number(v);
    return (
      <td
        key={key}
        title={text && isAmountCol(col) ? amountInWords(n) : undefined}
        style={{ fontWeight: weightOf(col, total), ...style }}
        className={`overflow-hidden whitespace-nowrap border-b border-border px-2.5 text-right tabular-nums ${
          bandStart.has(col.key) && hasBands ? "border-l" : ""
        } ${text === "" ? "text-muted-foreground/50" : n < 0 ? "text-destructive" : ""} ${col.synthetic ? "text-muted-foreground" : ""} ${extraCls}`}
      >
        {text === "" ? "–" : text}
      </td>
    );
  };

  const actionButton = (a) => (
    <button
      key={a.key}
      type="button"
      title={a.label}
      aria-label={a.label}
      onClick={(e) => {
        e.stopPropagation();
        a.onClick();
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary group-hover:text-primary"
    >
      {a.kind === "voucher" ? <FileText className="h-[15px] w-[15px]" /> : a.kind === "lines" ? <Eye className="h-[15px] w-[15px]" /> : <ArrowRight className="h-[15px] w-[15px]" />}
    </button>
  );

  // ── ticking rows ─────────────────────────────────────────────────────────
  const leafRows = useMemo(() => items.filter((it) => it.type !== "group" && it.type !== "sub" && it.row).map((it) => it.row), [items]);
  const toggleTick = (row, shiftKey) => {
    const idx = leafRows.indexOf(row);
    setTicked((prev) => {
      const next = new Set(prev);
      const on = !next.has(row);
      if (shiftKey && lastTickRef.current >= 0 && idx >= 0) {
        const [a, b] = [Math.min(lastTickRef.current, idx), Math.max(lastTickRef.current, idx)];
        leafRows.slice(a, b + 1).forEach((r) => (on ? next.add(r) : next.delete(r)));
      } else if (on) next.add(row);
      else next.delete(row);
      return next;
    });
    lastTickRef.current = idx;
  };
  const tickedInView = leafRows.filter((r) => ticked.has(r));
  const allTicked = leafRows.length > 0 && tickedInView.length === leafRows.length;
  const toggleAll = () => setTicked(allTicked ? new Set() : new Set(leafRows));

  // Copy rows as a table (tabs) — pastes into Excel, and reads fine in WhatsApp / email.
  const copyRows = async (list) => {
    const cols = visibleCols;
    const lines = [
      cols.map((c) => c.headerName).join("\t"),
      ...list.map((r) => cols.map((c) => (isNumericCol(c) ? formatValue(c, rawValue(c, r), { amounts }) : cellText(c, r))).join("\t")),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success(`Copied ${list.length} row${list.length === 1 ? "" : "s"}`, { description: "Paste into Excel, WhatsApp or an email." });
    } catch {
      toast.error("The browser did not allow copying.");
    }
  };

  // ── the user's own highlight rules (HighlightMenu.jsx), this report ─────
  const myRules = useMemo(
    () => (display.rules?.[reportType] || []).filter((r) => model.byKey.has(r.field)),
    [display.rules, reportType, model],
  );
  const ruleHit = useCallback(
    (r, row) => {
      const col = model.byKey.get(r.field);
      if (isNumericCol(col)) {
        const n = numValue(col, row);
        const v = Number(String(r.value).replace(/,/g, ""));
        switch (r.op) {
          case "lt": return n < v;
          case "lte": return n <= v;
          case "eq": return n === v;
          case "neq": return n !== v;
          case "gte": return n >= v;
          case "gt": return n > v;
          case "contains": return cellText(col, row).includes(r.value);
          case "empty": return n === 0;
          case "notEmpty": return n !== 0;
          case "negative": return n < 0;
          default: return false;
        }
      }
      const t = cellText(col, row).trim().toLowerCase();
      const v = String(r.value).trim().toLowerCase();
      const both = t !== "" && v !== "" && Number.isFinite(Number(t)) && Number.isFinite(Number(v));
      const cmp = both ? Number(t) - Number(v) : t.localeCompare(v, undefined, { numeric: true });
      switch (r.op) {
        case "lt": return t !== "" && cmp < 0;
        case "lte": return t !== "" && cmp <= 0;
        case "eq": return t === v;
        case "neq": return t !== v;
        case "gte": return t !== "" && cmp >= 0;
        case "gt": return t !== "" && cmp > 0;
        case "contains": return t.includes(v);
        case "empty": return t === "";
        case "notEmpty": return t !== "";
        case "negative": return both && Number(t) < 0;
        default: return false;
      }
    },
    [model],
  );
  const rowRuleTone = (row) => {
    const r = myRules.find((x) => x.scope === "row" && ruleHit(x, row));
    return r ? RULE_TONES[r.color] : null;
  };
  // A "just that cell" rule → its text colour (class) and tint (inline style,
  // so it wins over the row's tint layer).
  const cellRule = (col, row) => {
    if (!myRules.length) return null;
    const r = myRules.find((x) => x.scope === "cell" && x.field === col.key && ruleHit(x, row));
    if (!r) return null;
    const t = RULE_TONES[r.color];
    return { cls: `${t.text} font-semibold`, style: { backgroundImage: `linear-gradient(${t.cell},${t.cell})` } };
  };
  const safe = (fn, row) => {
    if (!fn) return false;
    try {
      return fn(row);
    } catch {
      return false;
    }
  };

  // Ticked > the user's row rules > amount ≥ X / negatives > stripes: the
  // colour of the layer over the row (null = none). The report's own warnings
  // come first (bg in renderRow).
  const rowTint = (row, idx) => {
    if (ticked.has(row)) return TINT_SEL;
    const tone = rowRuleTone(row);
    if (tone) return tone.row;
    if (display.hlNegative && amountCols.some((c) => numValue(c, row) < 0)) return TINT_NEG;
    if (display.hlMin && amountCols.some((c) => numValue(c, row) >= display.hlMin)) return TINT_HIGH;
    return display.zebra && idx % 2 === 1 ? TINT_ZEBRA : null;
  };

  // Phone cards: the same colours as a card tint.
  const cardTone = (row) => {
    if (safe(highlightRow, row) || safe(blinkCells, row)) return { className: "border-red-300 bg-red-50 dark:bg-red-950/40" };
    if (safe(blinkCellsPurple, row)) return { className: "border-yellow-400 bg-yellow-100 dark:bg-yellow-900/30" };
    const tone = rowRuleTone(row);
    if (tone) return { style: layer(tone.row) };
    if (display.hlNegative && amountCols.some((c) => numValue(c, row) < 0)) return { style: layer(TINT_NEG) };
    if (display.hlMin && amountCols.some((c) => numValue(c, row) >= display.hlMin)) return { style: layer(TINT_HIGH) };
    return null;
  };

  // A value in a cell → "only this" filter chip (flat reports).
  const addValueFilter = (col, text) => {
    if (!text) return;
    setValueFilters((prev) => [...prev.filter((f) => f.key !== col.key), { key: col.key, label: col.headerName, text, mode: "only" }]);
  };

  // Arrow keys between rows; Enter opens; Space ticks.
  const rowKeyDown = (e, row, open) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      let el = e.currentTarget;
      do el = e.key === "ArrowDown" ? el.nextElementSibling : el.previousElementSibling;
      while (el && el.tabIndex < 0);
      el?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      open();
    } else if (e.key === " " && row) {
      e.preventDefault();
      toggleTick(row, e.shiftKey);
    }
  };

  // Header ▾ menu: sort, hide, pin.
  const headerMenu = (c, i) => {
    const numeric = isNumericCol(c);
    const pinnedHere = i < pinnedCount;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            aria-label={`${c.headerName} column menu`}
            className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-60 hover:bg-white/20 hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52 text-[13px]" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">{c.headerName}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setSort({ key: c.key, dir: -1 })}>{numeric ? "Largest first" : "Z → A"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSort({ key: c.key, dir: 1 })}>{numeric ? "Smallest first" : "A → Z"}</DropdownMenuItem>
          {sort?.key === c.key && <DropdownMenuItem onSelect={() => setSort(null)}>Clear sort</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {!c.synthetic && (
            <DropdownMenuItem
              onSelect={() =>
                setHiddenCols((prev) => {
                  const next = new Set(prev);
                  next.add(c.key);
                  return next;
                })
              }
            >
              <EyeOff className="mr-2 h-3.5 w-3.5" /> Hide column
            </DropdownMenuItem>
          )}
          {!pinnedHere && (
            <DropdownMenuItem onSelect={() => setExtraPin(Math.max(0, i + 1 - basePinned))}>
              <Pin className="mr-2 h-3.5 w-3.5" /> Pin up to here
            </DropdownMenuItem>
          )}
          {extraPin > 0 && <DropdownMenuItem onSelect={() => setExtraPin(0)}>Unpin extra columns</DropdownMenuItem>}
          {hiddenCols.size > 0 && (
            <DropdownMenuItem onSelect={() => setHiddenCols(new Set())}>Show {hiddenCols.size} hidden column{hiddenCols.size === 1 ? "" : "s"}</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // The tick cell at the start of every row (desktop).
  const firstLeft = selCol ? SEL_W : 0;
  const selCell = (cls, content = null, style = undefined) =>
    selCol ? (
      <td style={{ position: "sticky", left: 0, zIndex: 2, width: SEL_W, ...style }} className={`border-b border-border text-center ${cls}`} onClick={(e) => content && e.stopPropagation()}>
        {content}
      </td>
    ) : null;

  const renderRow = (it, idx) => {
    // Group row of a grouped document: the header's own values sit in their
    // columns (layout.groupRows headerFields), the voucher opens from it.
    if (it.type === "group" && it.fields) {
      const head = it.row;
      const acts = hasActionCol ? actionsFor(head) : [];
      const tint = "bg-background [background-image:linear-gradient(hsl(var(--primary)/0.07),hsl(var(--primary)/0.07))]";
      return (
        <tr
          key={it.id}
          onClick={() => toggleGroupRow(it.id)}
          onKeyDown={(e) => rowKeyDown(e, null, () => toggleGroupRow(it.id))}
          tabIndex={0}
          aria-expanded={!it.collapsed}
          className="group cursor-pointer font-semibold outline-none focus-visible:[&>td]:bg-primary/10"
          style={{ height: rowH }}
        >
          {selCell(tint)}
          {visibleCols.map((c, i) => {
            const pinnedCell = i < pinnedCount;
            const shown = it.fields.has(c.key);
            const v = shown ? rawValue(c, head) : undefined;
            if (i === 0) {
              const text = shown ? formatValue(c, v, { amounts }) : it.label;
              return (
                <td
                  key={c.key}
                  title={`${it.label} · ${it.count} line(s)`}
                  style={pinnedCell ? pinStyle(0, { zIndex: 2 }) : { position: "sticky", left: firstLeft, zIndex: 2 }}
                  className={`overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-2.5 text-left text-primary ${tint} ${pinnedCell ? edge(0) : ""}`}
                >
                  <span className="inline-flex items-center gap-1" style={{ paddingLeft: it.depth * 12 }}>
                    {it.collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                    {text || it.label} <span className="font-normal text-muted-foreground">· {it.count}</span>
                  </span>
                </td>
              );
            }
            if (isNumericCol(c) && !pinnedCell) return shown ? numCell(c, v, c.key, tint) : <td key={c.key} className={`border-b border-border ${tint}`} />;
            const text = shown ? formatValue(c, v, { amounts }) : "";
            return (
              <td
                key={c.key}
                title={text}
                style={pinnedCell ? pinStyle(i, { zIndex: 2 }) : undefined}
                className={`overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-2.5 text-left text-primary ${tint} ${pinnedCell ? edge(i) : ""}`}
              >
                {text}
              </td>
            );
          })}
          {hasActionCol && (
            <td style={actionStyle()} className={`whitespace-nowrap border-b border-border px-1 text-right ${tint} ${actionEdge}`} onClick={(e) => e.stopPropagation()}>
              {acts.slice(0, 3).map(actionButton)}
            </td>
          )}
        </tr>
      );
    }
    if (it.type === "group") {
      const head = it.row;
      const acts = head && hasActionCol ? actionsFor(head) : [];
      return (
        <tr
          key={it.id}
          onClick={() => toggleGroupRow(it.id)}
          aria-expanded={!it.collapsed}
          className="group cursor-pointer"
          style={{ height: rowH }}
        >
          {selCell("bg-background [background-image:linear-gradient(hsl(var(--primary)/0.07),hsl(var(--primary)/0.07))]")}
          <td
            colSpan={Math.max(1, pinnedCount)}
            style={pinnedCount ? pinStyle(0, { zIndex: 2 }) : { position: "sticky", left: firstLeft, zIndex: 2 }}
            className="overflow-hidden whitespace-nowrap border-b border-border bg-background px-2.5 text-left font-semibold text-primary [background-image:linear-gradient(hsl(var(--primary)/0.07),hsl(var(--primary)/0.07))]"
          >
            <span className="inline-flex items-center gap-1" style={{ paddingLeft: it.depth * 12 }}>
              {it.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {it.label} <span className="font-normal text-muted-foreground">· {it.count}</span>
            </span>
          </td>
          {visibleCols.length - Math.max(1, pinnedCount) > 0 && (
            <td colSpan={visibleCols.length - Math.max(1, pinnedCount)} className="border-b border-border bg-primary/[0.07]" />
          )}
          {hasActionCol && (
            <td
              style={actionStyle()}
              className={`whitespace-nowrap border-b border-border bg-background px-1 text-right [background-image:linear-gradient(hsl(var(--primary)/0.07),hsl(var(--primary)/0.07))] ${actionEdge}`}
              onClick={(e) => e.stopPropagation()}
            >
              {acts.slice(0, 3).map(actionButton)}
            </td>
          )}
        </tr>
      );
    }
    if (it.type === "sub") {
      return (
        <tr key={it.id} style={{ height: rowH }} className="font-semibold">
          {selCell("bg-muted")}
          {pinnedCount > 0 && (
            <td
              colSpan={pinnedCount}
              style={pinStyle(0, { zIndex: 2 })}
              className={`overflow-hidden whitespace-nowrap border-b border-border bg-muted px-2.5 text-left font-medium text-muted-foreground ${edge(pinnedCount - 1)}`}
            >
              <span style={{ paddingLeft: it.depth * 12 }}>{it.label}</span>
            </td>
          )}
          {scrollCols.map((c, i) =>
            pinnedCount === 0 && i === 0 ? (
              <td key={c.key} className="overflow-hidden whitespace-nowrap border-b border-border bg-muted px-2.5 text-muted-foreground">
                {it.label}
              </td>
            ) : it.totals[c.key] !== undefined ? (
              numCell(c, it.totals[c.key], c.key, "bg-muted", { total: true })
            ) : (
              <td key={c.key} className={`border-b border-border bg-muted ${bandStart.has(c.key) && hasBands ? "border-l" : ""}`} />
            ),
          )}
          {hasActionCol && <td style={actionStyle()} className={`border-b border-border bg-muted ${actionEdge}`} />}
        </tr>
      );
    }
    const row = it.row;
    const isSel = selected === row;
    const isTicked = ticked.has(row);
    const blinkRow = blinkCells ? (() => { try { return !!blinkCells(row); } catch { return false; } })() : false;
    const redRow = !!safe(highlightRow, row);
    // Yellow (e.g. below re-order level) — only when the red one does not apply.
    const yellowRow = !blinkRow && !redRow && !!safe(blinkCellsPurple, row);
    const rowText = rowTextClass ? safe(rowTextClass, row) || "" : "";
    // The report's own warnings first, then build-up totals (groupRows.extra),
    // then the user's highlight rules / stripes / ticked tint.
    const bg = `${isSel
      ? "bg-[hsl(var(--primary)/0.12)]"
      : redRow
        ? "bg-red-50 text-red-900 group-hover:bg-red-100 dark:bg-red-950/40 dark:text-red-200"
        : yellowRow
          ? "bg-yellow-200 font-semibold text-yellow-950 group-hover:bg-yellow-300 dark:bg-yellow-900/50 dark:text-yellow-100"
          : it.extra === "total"
            ? "bg-muted font-semibold group-hover:bg-muted/70"
            : "bg-background group-hover:bg-muted"} ${rowText}`;
    // The tint layer (ticked / the user's rules / amount ≥ X / stripes) on every cell.
    const tint = !isSel && !redRow && !yellowRow && it.extra !== "total" ? layer(rowTint(row, idx)) : undefined;
    const acts = hasActionCol ? actionsFor(row) : [];
    const canFilter = !tree && !isMobile;
    return (
      <tr
        key={idx}
        tabIndex={0}
        onClick={() => openRow(row)}
        onKeyDown={(e) => rowKeyDown(e, row, () => openRow(row))}
        aria-selected={isTicked}
        style={{ height: rowH }}
        className={`group cursor-pointer outline-none focus-visible:[&>td]:bg-primary/10 ${blinkRow ? "animate-pulse" : ""}`}
      >
        {selCell(
          bg,
          <input
            type="checkbox"
            checked={isTicked}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              toggleTick(row, e.shiftKey);
            }}
            aria-label="Tick this row"
            className="h-[15px] w-[15px] cursor-pointer accent-primary"
          />,
          tint,
        )}
        {visibleCols.map((c, i) => {
          const pinnedCell = i < pinnedCount;
          const v = rawValue(c, row);
          if (isNumericCol(c) && !pinnedCell) {
            const cr = cellRule(c, row);
            return numCell(c, v, c.key, `${bg} ${blinkRow ? "text-destructive" : ""} ${cr?.cls || ""}`, { style: cr?.style || tint });
          }
          const text = formatValue(c, v, { amounts });
          const cr = cellRule(c, row);
          return (
            <td
              key={c.key}
              title={text}
              style={{ ...(pinnedCell ? pinStyle(i, { zIndex: 1 }) : {}), ...(cr?.style || tint) }}
              className={`group/cell overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-2.5 text-left ${pinnedCell ? "" : "relative"} ${bg} ${
                pinnedCell && i === 0 && pinnedCount > 1 ? "text-[12px] font-semibold text-primary" : ""
              } ${pinnedCell ? edge(i) : ""} ${!pinnedCell && bandStart.has(c.key) && hasBands ? "border-l" : ""} ${blinkRow ? "font-semibold text-destructive" : ""} ${cr?.cls || ""}`}
            >
              <Highlight text={text} term={search} />
              {canFilter && text && !c.synthetic && (
                <button
                  type="button"
                  title={`Show only rows where ${c.headerName} is “${text}”`}
                  aria-label={`Filter ${c.headerName}: ${text}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    addValueFilter(c, text);
                  }}
                  className="absolute right-1 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-background/90 text-primary shadow-sm ring-1 ring-border hover:bg-primary hover:text-primary-foreground group-hover/cell:inline-flex"
                >
                  <Filter className="h-3 w-3" />
                </button>
              )}
            </td>
          );
        })}
        {hasActionCol && (
          <td style={actionStyle(tint)} className={`whitespace-nowrap border-b border-border px-1 text-right ${bg} ${actionEdge}`} onClick={(e) => e.stopPropagation()}>
            {acts.slice(0, 3).map(actionButton)}
            {customRowActions.map((action, ai) =>
              !action.show || action.show(row) ? (
                <button
                  key={`c${ai}`}
                  type="button"
                  onClick={() => onCustomAction?.(action, row)}
                  className={`ml-1 h-6 rounded px-2 text-[10px] font-semibold ${action.className || "bg-destructive text-destructive-foreground"}`}
                >
                  {action.label}
                </button>
              ) : null,
            )}
          </td>
        )}
      </tr>
    );
  };

  const headCellBase = "bg-primary text-primary-foreground font-semibold whitespace-nowrap select-none";
  const sortMark = (key) => (sort?.key === key ? (sort.dir === -1 ? " ▼" : " ▲") : "");

  // ── toolbar ──────────────────────────────────────────────────────────────
  const rowGroupTitle = (tree ? model.groupRows.levels : model.rowGroupBy).map((l) => l.title).join(" › ");
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allGroupIds));
  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
      <label className="flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-muted-foreground focus-within:border-primary sm:max-w-xs">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input
          ref={searchRef}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setSearchInput("")}
          placeholder="Search rows…"
          aria-label="Search rows"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
        />
        {searchInput ? (
          <>
            {search && (
              <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums">
                {filtered.length.toLocaleString()} of {allRowsCount.toLocaleString()}
              </span>
            )}
            <button type="button" onClick={() => setSearchInput("")} aria-label="Clear search" className="hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
        )}
      </label>

      {model.views.length > 0 && (
        <Seg label="View" options={model.views} value={activeView?.id} onChange={setView} />
      )}
      {model.unitSwitch && (
        <Seg label={model.unitSwitch.label} options={model.unitSwitch.options} value={unit} onChange={setUnit} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={hideEmpty} onChange={setHideEmpty}>
          Hide {model.groups.length ? "groups / columns" : "columns"} with no figures
        </Toggle>
        {hasRowGroups && (
          <Toggle checked={groupRows} onChange={setGroupRows}>
            Group rows by {rowGroupTitle}
          </Toggle>
        )}
        {groupRows && allGroupIds.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[12.5px]">
            <button type="button" onClick={expandAll} className="rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10">
              Expand all
            </button>
            <span className="text-muted-foreground">·</span>
            <button type="button" onClick={collapseAll} className="rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10">
              Collapse all
            </button>
          </span>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => copyRows(tickedInView.length ? tickedInView : filtered)}
          title={tickedInView.length ? "Copy the ticked rows" : "Copy the rows in view"}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[12.5px] font-medium hover:border-primary hover:text-primary"
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
        <HighlightMenu
          reportType={reportType}
          columns={model.columns.map((c) => ({ key: c.key, headerName: c.headerName, numeric: isNumericCol(c) }))}
          display={display}
          onChange={updateDisplay}
        />
        <DisplayMenu
          display={display}
          onChange={updateDisplay}
          compareAvailable={!!compare?.available && !model.groupRows && identityCols.length > 0}
          compareOn={!!compare?.on}
          onCompare={compare?.onToggle}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[12.5px] font-medium hover:border-primary hover:text-primary"
            >
              <Layers className="h-3.5 w-3.5" /> Views <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {model.views.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Built in</DropdownMenuLabel>
                {model.views.map((v) => (
                  <DropdownMenuItem key={v.id} onSelect={() => setView(v.id)}>
                    <span className="flex-1">{v.label}</span>
                    {activeView?.id === v.id && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">My views</DropdownMenuLabel>
            {saved.length === 0 && <p className="px-2 pb-1.5 text-xs text-muted-foreground">None saved yet.</p>}
            {saved.map((v) => (
              <DropdownMenuItem key={v.id} onSelect={() => applySnapshot(v.state)} className="gap-2">
                <span className="flex-1 truncate">{v.name}</span>
                <button
                  type="button"
                  aria-label={`Delete view ${v.name}`}
                  title="Delete this view"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteSaved(v.id);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                applySnapshot({ view: model.defaultView });
                setSearchInput("");
              }}
            >
              Reset to default
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={() => {
            setSaveName(activeView ? `${activeView.label} · ${new Date().toLocaleDateString("en-GB", { month: "short" })}` : "");
            setSaveOpen(true);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[12.5px] font-medium hover:border-primary hover:text-primary"
        >
          <Bookmark className="h-3.5 w-3.5" /> Save view
        </button>
      </div>
    </div>
  );

  const groupChips = model.groups.length > 0 && (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2" aria-label="Column groups">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Columns</span>
      {model.groups.map((g) => {
        const isEmpty = groupEmpty(g);
        const on = !off.has(g.id) && !(hideEmpty && isEmpty);
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggleGroupChip(g)}
            title={hideEmpty && isEmpty ? "No figures in this period" : on ? `Hide ${g.label}` : `Show ${g.label}`}
            className={`inline-flex h-[26px] items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
              on ? "border-transparent bg-primary/[0.12] font-semibold text-primary" : "border-border bg-background text-muted-foreground line-through"
            } ${isEmpty ? "opacity-60" : ""}`}
          >
            {g.label}
            {isEmpty && <small className="text-[10.5px] font-normal no-underline">(empty)</small>}
          </button>
        );
      })}
    </div>
  );

  // "Only / except this value" chips — click the chip text to switch.
  const filterChips = (valueFilters.length > 0 || (compare?.on && compare?.loading)) && (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2" aria-label="Value filters">
      {valueFilters.map((f) => (
        <span key={f.key} className="inline-flex h-7 items-center overflow-hidden rounded-full bg-primary/10 text-[12.5px] font-semibold text-primary">
          <button
            type="button"
            onClick={() => setValueFilters((prev) => prev.map((x) => (x.key === f.key ? { ...x, mode: x.mode === "only" ? "except" : "only" } : x)))}
            title="Switch between only / all except"
            className="h-full pl-2.5 pr-1 hover:underline"
          >
            {f.label} {f.mode === "only" ? "=" : "≠"} “{f.text}”
          </button>
          <button
            type="button"
            onClick={() => setValueFilters((prev) => prev.filter((x) => x.key !== f.key))}
            aria-label={`Remove filter ${f.label}`}
            className="flex h-full w-7 items-center justify-center hover:bg-primary/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {valueFilters.length > 1 && (
        <button type="button" onClick={() => setValueFilters([])} className="h-7 px-1.5 text-[12.5px] font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Clear all
        </button>
      )}
      {compare?.on && compare?.loading && <span className="text-[12.5px] text-muted-foreground">Loading the previous period…</span>}
    </div>
  );

  // Count and sums of the ticked rows (amount columns in view).
  const selectionBar = tickedInView.length > 0 && (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-primary/15 bg-primary/[0.06] px-3 py-2 text-[13px]">
      <span className="font-bold text-primary">{tickedInView.length.toLocaleString()} ticked</span>
      {amountCols.slice(0, 5).map((c) => {
        const sum = tickedInView.reduce((a, r) => a + numValue(c, r), 0);
        return (
          <span key={c.key} title={amountInWords(sum)}>
            {c.headerName} <b className="tabular-nums">{formatValue(c, sum, { amounts }) || "0"}</b>
          </span>
        );
      })}
      <span className="ml-auto flex items-center gap-1">
        <button type="button" onClick={() => copyRows(tickedInView)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 font-semibold text-primary hover:bg-primary/10">
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
        <button type="button" onClick={() => setTicked(new Set())} className="h-7 rounded-md px-2 font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
          Clear
        </button>
      </span>
    </div>
  );

  const allColsCount = model.columns.length;
  const footInfo = (
    <div className="flex flex-wrap justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <span>
        Showing <b className="text-foreground">{visibleCols.length}</b> of {allColsCount} columns
        {hiddenEmptyCount > 0 && ` · ${hiddenEmptyCount} empty hidden`}
        {" · "}
        <b className="text-foreground">{filtered.length.toLocaleString()}</b>
        {filtered.length !== allRowsCount ? ` of ${allRowsCount.toLocaleString()}` : ""} {tree ? "lines" : "rows"}
      </span>
      {!isMobile && (
        <span>
          {hasBands ? "Click a group header to fold it · " : ""}click a column to sort, ▾ for more · tick rows to add them up · click a row for all its figures
        </span>
      )}
    </div>
  );

  // ── panel ────────────────────────────────────────────────────────────────
  const panel = (
    <RowDetailPanel
      open={!!selected}
      onClose={() => setSelected(null)}
      model={model}
      row={selected}
      amounts={amounts}
      subtitle={panelSubtitle}
      figures={figures}
      actions={
        selected
          ? actionsFor(selected).map((a) => ({
              ...a,
              // close the panel first — the next step may be a modal or another page
              onClick: () => {
                setSelected(null);
                a.onClick();
              },
            }))
          : []
      }
    />
  );

  const saveDialog = (
    <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Save this view</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Keeps the view, folded groups, hidden groups, row grouping, sort, density and amount format — for you, on this browser.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveView();
          }}
          className="flex flex-col gap-3"
        >
          <input
            autoFocus
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Name of the view"
            aria-label="Name of the view"
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSaveOpen(false)} className="h-9 rounded-lg border border-border px-3 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={!saveName.trim()} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              Save
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );


  // ── phone ────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-muted/30">
        {toolbar}
        {groupChips}
        {filterChips}
        <ReportCards
          model={model}
          items={items}
          figures={figures}
          totals={figTotals}
          amounts={amounts}
          actionsFor={actionsFor}
          onOpen={openRow}
          onToggleGroup={toggleGroupRow}
          showTotals={showGrand}
          toneFor={cardTone}
        />
        {footInfo}
        {panel}
        {saveDialog}
      </div>
    );
  }

  // ── desktop table ────────────────────────────────────────────────────────
  const slice = items.slice(start, end);
  const colSpanAll = visibleCols.length + (selCol ? 1 : 0) + (hasActionCol ? 1 : 0);
  const thSel = (rowSpan) =>
    selCol ? (
      <th rowSpan={rowSpan} style={{ position: "sticky", left: 0, top: 0, zIndex: 6, width: SEL_W }} className={`${headCellBase} border-b border-white/20 text-center`}>
        <input
          type="checkbox"
          checked={allTicked}
          ref={(el) => {
            if (el) el.indeterminate = tickedInView.length > 0 && !allTicked;
          }}
          onChange={toggleAll}
          aria-label={allTicked ? "Untick all rows" : "Tick all rows"}
          className="h-[15px] w-[15px] cursor-pointer accent-white"
        />
      </th>
    ) : null;
  const thAction = (rowSpan) =>
    hasActionCol ? (
      <th rowSpan={rowSpan} style={{ position: "sticky", top: 0, right: 0, zIndex: 6 }} className={`${headCellBase} border-b border-white/20 ${actionEdge}`}>
        <span className="sr-only">Open</span>
      </th>
    ) : null;
  // The full column name: one line where it fits (estimateWidth sizes the
  // column for it), otherwise up to two lines — never cut to "Acco…".
  const headInner = (c, i) => (
    <span className={`flex min-w-0 items-center ${isNumericCol(c) ? "justify-end text-right" : ""}`} title={c.headerName}>
      <span className="line-clamp-2 min-w-0 whitespace-normal break-words leading-tight">
        {c.headerName}
        {sortMark(c.key)}
      </span>
      {headerMenu(c, i)}
    </span>
  );
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background">
      {toolbar}
      {groupChips}
      {filterChips}
      {selectionBar}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative overflow-auto"
        style={{ maxHeight: "calc(100dvh - 230px)", minHeight: Math.min(420, headH + rowH * (items.length + 2)) }}
      >
        <table className="border-separate border-spacing-0" style={{ tableLayout: "fixed", width: "100%", minWidth: tableMinWidth, fontSize: FONT_PX[display.size] }}>
          <colgroup>
            {selCol && <col style={{ width: SEL_W }} />}
            {visibleCols.map((c) => (
              // The flex column takes the spare width (no filler column).
              <col key={c.key} style={c.key === flexKey ? undefined : { width: colWidth(c) }} />
            ))}
            {hasActionCol && <col style={{ width: actionW }} />}
          </colgroup>
          <thead>
            {hasBands && (
              <tr>
                {thSel(2)}
                {visibleCols.slice(0, pinnedCount).map((c, i) => (
                  <th
                    key={c.key}
                    rowSpan={2}
                    onClick={() => cycleSort(c.key)}
                    style={{ ...pinStyle(i), top: 0, zIndex: 5 }}
                    className={`${headCellBase} cursor-pointer border-b border-white/20 px-2.5 text-left text-[11.5px] hover:brightness-110 ${edge(i)}`}
                  >
                    {headInner(c, i)}
                  </th>
                ))}
                {bands.map((b, bi) => {
                  const isFolded = b.group && folded.has(b.group.id);
                  return (
                    <th
                      key={`b${bi}`}
                      colSpan={b.span}
                      onClick={b.group ? () => toggleFold(b.group.id) : undefined}
                      aria-expanded={b.group ? !isFolded : undefined}
                      title={b.group ? `${isFolded ? "Show" : "Fold"} ${b.group.label}` : undefined}
                      style={{ position: "sticky", top: 0, zIndex: 3, height: BAND_H }}
                      className={`${headCellBase} border-b border-l border-white/20 px-2 text-center text-[11px] uppercase tracking-wider ${
                        b.group ? "cursor-pointer hover:brightness-110" : ""
                      }`}
                    >
                      {b.group && (
                        <span className={`mr-1 inline-block transition-transform motion-reduce:transition-none ${isFolded ? "-rotate-90" : ""}`}>▾</span>
                      )}
                      {b.group?.label || ""}
                    </th>
                  );
                })}
                {thAction(2)}
              </tr>
            )}
            <tr>
              {!hasBands && thSel(1)}
              {!hasBands &&
                visibleCols.slice(0, pinnedCount).map((c, i) => (
                  <th
                    key={c.key}
                    onClick={() => cycleSort(c.key)}
                    style={{ ...pinStyle(i), top: 0, zIndex: 5, height: HEAD_H }}
                    className={`${headCellBase} cursor-pointer border-b border-white/20 px-2.5 text-left text-[11.5px] hover:brightness-110 ${edge(i)}`}
                  >
                    {headInner(c, i)}
                  </th>
                ))}
              {scrollCols.map((c, si) => (
                <th
                  key={c.key}
                  onClick={() => cycleSort(c.key)}
                  title={c.headerName}
                  style={{ position: "sticky", top: hasBands ? BAND_H : 0, zIndex: 3, height: HEAD_H }}
                  className={`${headCellBase} cursor-pointer overflow-hidden border-b border-white/20 px-2.5 text-[11.5px] hover:brightness-110 ${
                    isNumericCol(c) ? "text-right" : "text-left"
                  } ${bandStart.has(c.key) && hasBands ? "border-l border-l-white/30" : "border-l border-l-white/10"}`}
                >
                  {headInner(c, pinnedCount + si)}
                </th>
              ))}
              {!hasBands && thAction(1)}
            </tr>
          </thead>
          <tbody>
            {virtual && start > 0 && (
              <tr aria-hidden="true" style={{ height: start * rowH }}>
                <td colSpan={colSpanAll} />
              </tr>
            )}
            {slice.map((it, i) => renderRow(it, start + i))}
            {virtual && end < items.length && (
              <tr aria-hidden="true" style={{ height: (items.length - end) * rowH }}>
                <td colSpan={colSpanAll} />
              </tr>
            )}
            {items.length === 0 && (
              <tr>
                <td colSpan={colSpanAll} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {searchInput ? `Nothing matches “${searchInput}”.` : "No rows match these filters."}
                </td>
              </tr>
            )}
          </tbody>
          {showGrand && filtered.length > 0 && (
            <tfoot>
              <tr style={{ height: rowH + 4 }}>
                {selCol && <td style={{ position: "sticky", left: 0, bottom: 0, zIndex: 4 }} className="border-t-2 border-t-primary bg-muted" />}
                {visibleCols.map((c, i) => {
                  const pinnedCell = i < pinnedCount;
                  const label = i === 0 ? "Total" : pinnedCell && i === 1 ? `${filtered.length.toLocaleString()} ${tree ? "lines" : "rows"}` : "";
                  if (pinnedCell || (pinnedCount === 0 && i === 0)) {
                    return (
                      <td
                        key={c.key}
                        style={{ ...(pinnedCell ? pinStyle(i) : {}), position: "sticky", bottom: 0, zIndex: pinnedCell ? 4 : 2 }}
                        className={`overflow-hidden whitespace-nowrap border-t-2 border-t-primary bg-muted px-2.5 text-left font-bold ${pinnedCell ? edge(i) : ""}`}
                      >
                        {label}
                      </td>
                    );
                  }
                  const v = totals[c.key];
                  const text = v === undefined ? "" : formatValue(c, v, { amounts });
                  return (
                    <td
                      key={c.key}
                      title={v !== undefined && isAmountCol(c) ? amountInWords(v) : undefined}
                      style={{ position: "sticky", bottom: 0, zIndex: 2, fontWeight: weightOf(c, true) }}
                      className={`overflow-hidden whitespace-nowrap border-t-2 border-t-primary bg-muted px-2.5 text-right tabular-nums ${
                        bandStart.has(c.key) && hasBands ? "border-l border-l-border" : ""
                      } ${v !== undefined && v < 0 ? "text-destructive" : ""}`}
                    >
                      {v === undefined ? "" : text === "" ? "–" : text}
                    </td>
                  );
                })}
                {hasActionCol && <td style={{ position: "sticky", bottom: 0, right: 0, zIndex: 4 }} className={`border-t-2 border-t-primary bg-muted ${actionEdge}`} />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {footInfo}
      {panel}
      {saveDialog}
    </div>
  );
});

export default WideTable;
