// components/Material/Production/ProcessOrderForm.jsx
// ============================================================
// Create / edit / view a Process Order.
//
//   LEFT   production (finished) items of the order — item, qty, unit,
//          godown, batch, optional BOM. ↑/↓ (or Alt+↑/↓) moves between them.
//   RIGHT  the issuances (raw / packing materials + instructions) of the
//          SELECTED production item — item, issue godown, qty, unit, stock.
//
// A BOM is optional: loading one pre-fills the item's issuances scaled to its
// quantity (still editable); without one the lines are entered freely.
//
// Saving: "new" orders are stored as Completed and posted (tran_code 7 + 8)
// by Send to Production; "reprocessing" orders post immediately. Posting is
// server-side (lib/manufacturing/processOrder.js).
// ============================================================
"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncSelect from "react-select/async";
import axios from "axios";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Factory,
  FileText,
  History,
  Layers,
  Lock,
  Package,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  User,
  Warehouse,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useCompany } from "@/context/CompanyContext";
import { generateProcessOrderPDF } from "@/components/Template/ProcessOrder";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import KeyboardHint, { KeyCombo } from "@/components/ui/KeyboardHint";
import ItemSelect, {
  selectStyles,
  portalTarget,
  useDebouncedLoader,
  formatItemOption,
  toItemOption,
} from "./ItemSelect";
import { useSaleOrders } from "./useDropdownData";
import StatusBadge from "./StatusBadge";
import { useConfirm } from "./ConfirmDialog";
import {
  CHIP,
  CODE_CHIP,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";
import {
  PRODUCTION_TYPES,
  UNIT_OPTIONS,
  PACKAGING_CATEGORY_ID,
  emptyOutput,
  emptyLine,
  linesFromBom,
  loadOrder,
  validate,
  buildPayload,
  planForOutput,
  outputGodown,
  unitOfItem,
  toNum,
  round,
  fmtQty,
  godownForCategory,
} from "./processOrderModel";

const MODES = { CREATE: "create", EDIT: "edit", VIEW: "view" };
const DAY_MS = 24 * 60 * 60 * 1000;

// ── shared surface classes (compact, dense data-entry look; theme tokens so
// dark mode follows — see components/Material/shared/LabUI.jsx)
const UI = {
  panel: "rounded-xl border border-border bg-background",
  panelHead:
    "flex min-h-[40px] flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-3 py-1.5",
  title: "flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold text-primary",
  label: "mb-0.5 block truncate text-[11px] font-medium text-muted-foreground",
  input:
    "h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] font-medium text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground",
  // grid cell: borderless until hovered / focused (spreadsheet feel)
  cell:
    "h-8 w-full rounded border border-transparent bg-transparent px-1.5 text-[13px] font-medium text-foreground outline-none transition hover:border-input focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 disabled:cursor-default disabled:hover:border-transparent max-md:border-input max-md:focus:border-primary",
  inputErr: "!border-destructive",
  muted: "text-muted-foreground",
  btn: "inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
  btnGhost: "border border-border bg-background text-foreground hover:bg-muted",
  iconBtn:
    "inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive",
};

// Text tones matching the Lab chips (ok / warn / bad)
const TONE_TEXT = {
  ok: "text-[#2f5139] dark:text-emerald-300",
  warn: "text-[#8a6416] dark:text-amber-300",
  bad: "text-destructive",
};

// issuance grid columns (md+): # | item | godown | qty | unit | % | stock | ×
const LINE_COLS =
  "md:grid-cols-[1.75rem_minmax(11rem,1fr)_8.5rem_6.5rem_4.75rem_3.75rem_7.5rem_1.75rem]";

const compactSelect = {
  ...selectStyles,
  control: (base, state) => ({
    ...selectStyles.control(base, state),
    minHeight: "32px",
    fontSize: "13px",
    borderWidth: "1px",
    borderRadius: "6px",
  }),
  indicatorsContainer: (base) => ({ ...base, height: "30px" }),
};
const cellSelect = {
  ...compactSelect,
  control: (base, state) => ({
    ...compactSelect.control(base, state),
    backgroundColor: state.isFocused ? "hsl(var(--background))" : "transparent",
    borderColor: state.isFocused ? "hsl(var(--primary))" : "transparent",
    "&:hover": { borderColor: state.isFocused ? "hsl(var(--primary))" : "hsl(var(--input))" },
  }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base, state) => ({ ...base, padding: "4px", opacity: state.isFocused ? 1 : 0.35 }),
};
const withError = (styles) => ({
  ...styles,
  control: (base, state) => ({
    ...styles.control(base, state),
    borderColor: state.isFocused ? "hsl(var(--primary))" : "hsl(var(--destructive))",
  }),
});
const errSelectStyles = withError(compactSelect);
const errCellSelect = withError(cellSelect);

// The mouse wheel over a focused number input would change its value
const noWheel = (e) => e.currentTarget.blur();

// Moves focus to the next / previous enabled field inside the form.
const moveFocus = (el, dir = 1) => {
  const form = el?.form || el?.closest?.("form");
  if (!form) return;
  const list = Array.from(
    form.querySelectorAll(
      'input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]), select:not([disabled])',
    ),
  ).filter((x) => x.offsetParent !== null && (x === el || !x.dataset.skipEnter)); // e.g. Unit: Tab only
  const i = list.indexOf(el);
  const next = list[i + dir];
  if (next) {
    next.focus();
    if (typeof next.select === "function" && next.type !== "date") next.select();
  }
};

const ErrorText = ({ messages }) =>
  messages?.length ? (
    <p className="mt-1 flex items-start gap-1 text-[11.5px] font-semibold text-destructive">
      <AlertCircle className="mt-px h-3 w-3 flex-shrink-0" />
      {messages.join(" · ")}
    </p>
  ) : null;

const Stat = ({ label, value, tone = "default" }) => (
  <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
    <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    <span
      className={cn(
        "truncate text-[13px] font-bold tabular-nums text-foreground",
        tone === "bad" && TONE_TEXT.bad,
        tone === "warn" && TONE_TEXT.warn,
        tone === "good" && TONE_TEXT.ok,
      )}
    >
      {value}
    </span>
  </div>
);

// ── lifecycle: Draft → Saved (ready to send) → Posted ──────────────────────
// Saved covers Scheduled / Completed / In Progress; reprocessing orders post
// on save, so they jump straight to Posted. Cancelled shows only its chip.
const LIFECYCLE = ["Draft", "Saved", "Posted"];
const LifecycleStepper = ({ status, isCreate, isReproc }) => {
  if (status === "Cancelled") return null;
  const current = isCreate ? 0 : status === "Posted" ? 2 : 1;
  const hint = [
    isReproc ? "Not saved — saving posts it" : "Not saved yet",
    "Saved — ready to send to production",
    "Posted — stock and accounts moved",
  ];
  return (
    <ol className="flex items-center gap-1" aria-label="Process order lifecycle">
      {LIFECYCLE.map((step, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={step} className="flex items-center gap-1" aria-current={now ? "step" : undefined} title={hint[i]}>
            {i > 0 && <span className={cn("h-px w-3 sm:w-5", i <= current ? "bg-primary" : "bg-border")} aria-hidden="true" />}
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
                done && "bg-primary text-primary-foreground",
                now && "bg-primary text-primary-foreground ring-2 ring-primary/25",
                !done && !now && "border border-border text-muted-foreground",
              )}
            >
              {done ? <Check size={10} strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("text-[11.5px]", now ? "font-semibold text-primary" : "text-muted-foreground", !now && "max-sm:hidden")}>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

// ── change history ─────────────────────────────────────────────────────────
const ChangeHistory = ({ logs = [] }) => {
  const [open, setOpen] = useState(false);
  if (!logs.length) return null;
  return (
    <div className={cn(UI.panel, "flex-shrink-0 px-3 py-1.5")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <History size={14} className="text-primary" />
        Change history ({logs.length})
      </button>
      {open && (
        <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {logs.map((log, i) => (
            <li
              key={log.id || i}
              className="rounded-lg border border-border bg-muted/40 p-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{log.material_desc || log.field_name}</span>
                <span className={cn("rounded px-1.5 py-0.5 font-semibold", CHIP.brand)}>
                  {log.field_name}
                </span>
                <span className="text-muted-foreground line-through">{log.old_value ?? "—"}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold text-foreground">{log.new_value ?? "—"}</span>
              </div>
              <div className={cn("mt-1 flex flex-wrap gap-3", UI.muted)}>
                {log.changed_by && (
                  <span className="inline-flex items-center gap-1">
                    <User size={10} />
                    {log.changed_by}
                  </span>
                )}
                {log.changed_at && (
                  <span className="inline-flex items-center gap-1">
                    <Clock size={10} />
                    {new Date(log.changed_at).toLocaleString()}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── stock shortage dialog (save-time, reprocessing) ────────────────────────
const StockDialog = ({ rows, onClose }) => {
  // capture: Esc closes this dialog only, not the whole process order
  useKeyboardShortcuts({ escape: { handler: onClose, allowInInput: true } }, true, true);
  return (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3" role="alertdialog" aria-modal="true" aria-labelledby="po-short-title">
    <div className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div className={cn(DIALOG, "relative z-10 max-w-lg border border-border bg-background shadow-xl")}>
      <div className={cn(DIALOG_HEAD, "flex items-center gap-3")}>
        <span className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg", CHIP.bad)}>
          <AlertTriangle size={18} />
        </span>
        <div>
          <h2 id="po-short-title" className="text-base font-semibold text-primary">Insufficient stock</h2>
          <p className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "material" : "materials"} cannot be issued
          </p>
        </div>
      </div>
      <div className={cn(DIALOG_BODY, "space-y-2")}>
        {rows.map((r) => (
          <div key={r.key} className="rounded-xl border border-border p-3 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-semibold">
              {r.code ? <span className={CODE_CHIP}>{r.code}</span> : null}
              <span className="min-w-0 truncate">{r.name}</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-muted/60 p-1.5">
                <dt className={UI.muted}>Required</dt>
                <dd className="font-semibold tabular-nums">{fmtQty(r.required)}</dd>
              </div>
              <div className={cn("rounded-lg p-1.5", CHIP.ok)}>
                <dt className="truncate opacity-80">Available ({r.godownName})</dt>
                <dd className="font-semibold tabular-nums">{fmtQty(r.available)}</dd>
              </div>
              <div className={cn("rounded-lg p-1.5", CHIP.bad)}>
                <dt className="opacity-80">Short</dt>
                <dd className="font-semibold tabular-nums">{fmtQty(r.required - r.available)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <div className={cn(DIALOG_FOOT, "items-center justify-between")}>
        <p className={cn("text-xs", UI.muted)}>Procure or transfer the missing materials first.</p>
        <button type="button" onClick={onClose} className={cn(UI.btn, "h-8 bg-primary px-5 text-primary-foreground hover:opacity-90")} autoFocus>
          OK
        </button>
      </div>
    </div>
  </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
const ProcessOrderForm = ({
  mode,
  editingItem,
  productionType,
  setProductionType,
  onSubmit,
  onCancel,
  isSubmitting = false,
}) => {
  const { company } = useCompany();
  const isView = mode === MODES.VIEW;
  const isEdit = mode === MODES.EDIT;
  const isCreate = mode === MODES.CREATE;
  const type = isCreate ? productionType || PRODUCTION_TYPES.NEW : editingItem?.type || PRODUCTION_TYPES.NEW;
  const status = editingItem?.status || null;
  const isPosted = status === "Posted";
  // Posted orders already moved stock: only the actual yield may change (24h)
  const locked = isView || isPosted;
  const yieldEditable =
    isEdit &&
    isPosted &&
    !(Date.now() - new Date(editingItem?.sent_to_production_date || editingItem?.dated || 0).getTime() > DAY_MS);

  // ── state ────────────────────────────────────────────────────────────────
  const initial = useMemo(() => loadOrder(editingItem), [editingItem]);
  const [header, setHeader] = useState(initial.header);
  const [outputs, setOutputs] = useState(initial.outputs);
  const [lines, setLines] = useState(initial.lines);
  const [selectedKey, setSelectedKey] = useState(initial.outputs[0]?.key);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text }
  const [stockRows, setStockRows] = useState(null);
  const [bomLoading, setBomLoading] = useState(false);
  const pendingFocus = useRef(null);
  const formRef = useRef(null);
  const [confirm, confirmDialog, confirmOpen] = useConfirm();

  useEffect(() => {
    setHeader(initial.header);
    setOutputs(initial.outputs);
    setLines(initial.lines);
    setSelectedKey(initial.outputs[0]?.key);
    setSubmitted(false);
  }, [initial]);

  const selected = outputs.find((o) => o.key === selectedKey) || outputs[0];
  const selectedIndex = Math.max(0, outputs.findIndex((o) => o.key === selected?.key));
  const selectedLines = useMemo(() => lines.filter((l) => l.outputKey === selected?.key), [lines, selected]);

  const patchHeader = useCallback((patch) => setHeader((h) => ({ ...h, ...patch })), []);
  const patchOutput = useCallback((key, patch) => {
    setOutputs((list) => list.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }, []);
  const patchLine = useCallback((key, patch) => {
    setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  // ── godowns ──────────────────────────────────────────────────────────────
  const [godowns, setGodowns] = useState([]);
  useEffect(() => {
    let cancelled = false;
    axios
      .get("/api/setup/godowns", { params: { includeInactive: true, limit: 1000 } })
      .then(({ data }) => !cancelled && setGodowns(Array.isArray(data?.data) ? data.data : []))
      .catch(() => !cancelled && setGodowns([]));
    return () => {
      cancelled = true;
    };
  }, []);
  const godownName = useCallback(
    (id) => godowns.find((g) => Number(g.id) === Number(id))?.godown || (id ? `Godown ${id}` : "—"),
    [godowns],
  );
  // A render helper (not a component) so the <select> keeps focus across renders
  const godownSelect = ({ value, onChange, invalid, ariaLabel, disabled, id, cell = false }) => {
    const known = godowns.some((g) => Number(g.id) === Number(value));
    return (
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(cell ? UI.cell : UI.input, "truncate pr-6", invalid && UI.inputErr)}
      >
        <option value="">Godown…</option>
        {value && !known ? <option value={value}>{`Godown ${value}`}</option> : null}
        {godowns
          .filter((g) => g.is_active !== false || Number(g.id) === Number(value))
          .map((g) => (
            <option key={g.id} value={g.id}>
              {g.godown}
              {g.is_active === false ? " (closed)" : ""}
            </option>
          ))}
      </select>
    );
  };

  // ── live stock per (item, issue godown) ─────────────────────────────────
  const [stock, setStock] = useState({}); // "itcd:godown" → { qty, categoryId } | "loading"
  const stockKeys = useMemo(
    () =>
      [...new Set(lines.filter((l) => l.kind === "material" && l.material_id && l.godown).map((l) => `${l.material_id}:${l.godown}`))],
    [lines],
  );
  useEffect(() => {
    if (locked) return;
    const missing = stockKeys.filter((k) => stock[k] === undefined);
    if (!missing.length) return;
    const t = setTimeout(() => {
      setStock((s) => ({ ...s, ...Object.fromEntries(missing.map((k) => [k, "loading"])) }));
      missing.forEach((k) => {
        const [itcd, godown] = k.split(":");
        axios
          .get("/api/inventory/stock", { params: { itcd, godown } })
          .then(({ data }) =>
            setStock((s) => ({ ...s, [k]: { qty: toNum(data?.stock), categoryId: Number(data?.categoryId) } })),
          )
          .catch(() => setStock((s) => ({ ...s, [k]: { qty: null, categoryId: null } })));
      });
    }, 300);
    return () => clearTimeout(t);
  }, [stockKeys, stock, locked]);

  // Shortage per line: the SUM of every line issuing that item from that godown
  const { shortByLine, needByKey } = useMemo(() => {
    const need = new Map();
    for (const l of lines) {
      if (l.kind !== "material" || !l.material_id || !l.godown) continue;
      const k = `${l.material_id}:${l.godown}`;
      need.set(k, (need.get(k) || 0) + toNum(l.material_qty));
    }
    const short = new Map();
    for (const l of lines) {
      if (l.kind !== "material" || !l.material_id || !l.godown) continue;
      const k = `${l.material_id}:${l.godown}`;
      const s = stock[k];
      if (!s || s === "loading" || s.qty === null || s.categoryId === PACKAGING_CATEGORY_ID) continue;
      const gap = round(need.get(k) - s.qty, 3);
      if (gap > 0.01) short.set(l.key, gap);
    }
    return { shortByLine: short, needByKey: need };
  }, [lines, stock]);

  // ── validation ───────────────────────────────────────────────────────────
  const blockOnStock = type === PRODUCTION_TYPES.REPROCESSING && !locked;
  const v = useMemo(
    () => validate({ header, outputs, lines, type, stockShort: shortByLine, blockOnStock }),
    [header, outputs, lines, type, shortByLine, blockOnStock],
  );
  const show = submitted; // red borders only after the first save attempt

  // ── totals ───────────────────────────────────────────────────────────────
  const totalsOf = useCallback(
    (o) => {
      const mats = lines.filter((l) => l.outputKey === o.key && l.kind === "material");
      const issued = mats.reduce((s, l) => s + toNum(l.material_qty), 0);
      const produce = toNum(o.qty);
      return {
        issued,
        produce,
        count: mats.length,
        notes: lines.filter((l) => l.outputKey === o.key && l.kind === "instruction").length,
        ratio: produce > 0 ? (issued / produce) * 100 : null,
        short: mats.filter((l) => shortByLine.has(l.key)).length,
      };
    },
    [lines, shortByLine],
  );
  const summary = useMemo(() => {
    const t = outputs.map(totalsOf);
    return {
      items: outputs.length,
      produce: t.reduce((s, x) => s + x.produce, 0),
      issued: t.reduce((s, x) => s + x.issued, 0),
      lines: t.reduce((s, x) => s + x.count, 0),
      short: shortByLine.size,
    };
  }, [outputs, totalsOf, shortByLine]);

  // ── focus helpers ────────────────────────────────────────────────────────
  const refs = useRef(new Map());
  const setRef = (id) => (el) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const t = setTimeout(() => {
      const el = refs.current.get(id);
      if (el) {
        el.focus?.();
        pendingFocus.current = null;
      }
    }, 60);
    return () => clearTimeout(t);
  });

  // ── production item actions ──────────────────────────────────────────────
  const addOutput = useCallback(() => {
    if (locked) return;
    const o = emptyOutput();
    setOutputs((list) => [...list, o]);
    setSelectedKey(o.key);
    pendingFocus.current = `out-item-${o.key}`;
  }, [locked]);

  const removeOutput = useCallback(
    async (key) => {
      if (locked || outputs.length <= 1) return;
      const hasLines = lines.some((l) => l.outputKey === key);
      if (
        hasLines &&
        !(await confirm({
          title: "Remove this production item?",
          description: "Its issuance lines are removed with it.",
          confirmLabel: "Remove",
          destructive: true,
        }))
      )
        return;
      const idx = outputs.findIndex((o) => o.key === key);
      const rest = outputs.filter((o) => o.key !== key);
      setOutputs(rest);
      setLines((list) => list.filter((l) => l.outputKey !== key));
      if (selectedKey === key) setSelectedKey(rest[Math.max(0, idx - 1)]?.key);
    },
    [locked, outputs, lines, selectedKey, confirm],
  );

  const moveSelection = useCallback(
    (dir) => {
      if (!outputs.length) return;
      const next = outputs[Math.min(outputs.length - 1, Math.max(0, selectedIndex + dir))];
      if (next) {
        setSelectedKey(next.key);
        refs.current.get(`card-${next.key}`)?.scrollIntoView?.({ block: "nearest" });
      }
    },
    [outputs, selectedIndex],
  );

  const setOutputQty = useCallback(
    (key, value) => {
      patchOutput(key, { qty: value });
      if (locked) return;
      const qty = toNum(value);
      // BOM lines follow the planned quantity (until edited by hand)
      setLines((list) =>
        list.map((l) =>
          l.outputKey === key && l.kind === "material" && l.fromBom
            ? { ...l, material_qty: round((qty * toNum(l.material_percentage)) / 100) }
            : l,
        ),
      );
    },
    [patchOutput, locked],
  );

  const setOutputItem = useCallback(
    (key, opt) => {
      if (!opt) {
        patchOutput(key, { finished_id: null, item_code: "", item_name: "", ic_id: null, bom_id: null, bom_label: "" });
        return;
      }
      const ic = opt.raw?.ic_id ?? null;
      setOutputs((list) =>
        list.map((o) =>
          o.key === key
            ? {
                ...o,
                finished_id: opt.value,
                item_code: opt.code || "",
                item_name: opt.name || "",
                ic_id: ic,
                // a BOM of another item no longer applies
                ...(o.finished_id && o.finished_id !== opt.value ? { bom_id: null, bom_label: "" } : {}),
                godown: o.godown && o.finished_id === opt.value ? o.godown : godownForCategory(ic),
                unit: unitOfItem(opt.unit || opt.raw?.unit),
              }
            : o,
        ),
      );
    },
    [patchOutput],
  );

  /** Replace the item's material lines with a BOM, scaled to its quantity. */
  const applyBom = useCallback(
    async (key, bomId, label) => {
      const o = outputs.find((x) => x.key === key);
      if (!o || locked) return;
      setBomLoading(true);
      try {
        const { data: bom } = await axios.get(`/api/manufacturing/bom/${bomId}`);
        const existing = lines.filter((l) => l.outputKey === key && l.kind === "material");
        if (
          existing.length &&
          !(await confirm({
            title: `Load BOM #${bom.id}?`,
            description: `It replaces the ${existing.length} issuance line(s) of this item.`,
            confirmLabel: "Replace lines",
          }))
        ) {
          return;
        }
        const finishedChanged = bom.finishedId && bom.finishedId !== o.finished_id;
        const qty = toNum(o.qty);
        setOutputs((list) =>
          list.map((x) =>
            x.key === key
              ? {
                  ...x,
                  bom_id: bom.id,
                  bom_label: label || `${bom.code || ""} - ${bom.productName || ""} (BOM #${bom.id})`,
                  ...(finishedChanged
                    ? { finished_id: bom.finishedId, item_code: bom.code || "", item_name: bom.productName || "", godown: x.godown }
                    : {}),
                }
              : x,
          ),
        );
        setLines((list) => [
          ...list.filter((l) => !(l.outputKey === key && l.kind === "material")),
          ...linesFromBom(key, bom.materials || [], qty),
        ]);
        setNotice({
          tone: qty > 0 ? "good" : "warn",
          text:
            qty > 0
              ? `BOM #${bom.id} loaded: ${bom.materials?.length || 0} lines scaled to ${fmtQty(qty)}.`
              : `BOM #${bom.id} loaded — enter the quantity to scale its lines.`,
        });
      } catch (err) {
        setNotice({ tone: "bad", text: err?.response?.data?.error || "Could not load that BOM." });
      } finally {
        setBomLoading(false);
      }
    },
    [outputs, lines, locked, confirm],
  );

  /** Alt+B / "Load BOM": the selected item's active BOM. */
  const loadItemBom = useCallback(async () => {
    if (!selected || locked) return;
    if (selected.bom_id) return applyBom(selected.key, selected.bom_id, selected.bom_label);
    if (!selected.finished_id) {
      setNotice({ tone: "warn", text: "Select the production item first, or pick a BOM." });
      return;
    }
    try {
      const { data } = await axios.get("/api/manufacturing/bom", {
        params: { finished_id: selected.finished_id, filterStatus: "Active", limit: 1 },
      });
      const bom = data?.data?.[0];
      if (!bom) {
        setNotice({ tone: "warn", text: "This item has no active BOM — add the issuances by hand." });
        return;
      }
      await applyBom(selected.key, bom.id);
    } catch {
      setNotice({ tone: "bad", text: "Could not look up the item's BOM." });
    }
  }, [selected, locked, applyBom]);

  // ── issuance line actions ───────────────────────────────────────────────
  const addLine = useCallback(
    (kind = "material") => {
      if (locked || !selected) return;
      const l = emptyLine(selected.key, kind);
      setLines((list) => {
        // keep the item's lines together
        const lastIdx = list.map((x) => x.outputKey).lastIndexOf(selected.key);
        const next = [...list];
        next.splice(lastIdx === -1 ? next.length : lastIdx + 1, 0, l);
        return next;
      });
      pendingFocus.current = `line-${kind === "material" ? "item" : "text"}-${l.key}`;
    },
    [locked, selected],
  );

  const removeLine = useCallback((key) => {
    if (locked) return;
    setLines((list) => list.filter((l) => l.key !== key));
  }, [locked]);

  // ── header dropdown data ────────────────────────────────────────────────
  const { saleOrders, loading: saleOrdersLoading } = useSaleOrders();
  const saleOrderOptions = useMemo(
    () => saleOrders.map((o) => ({ value: o.order_no, label: `${o.order_no}` })),
    [saleOrders],
  );
  const reqSoNos = useMemo(
    () => [...new Set((header.req_items || []).map((d) => d.so_no).filter((x) => x !== null && x !== undefined && x !== ""))],
    [header.req_items],
  );
  const availableSoOptions = useMemo(() => {
    if (!reqSoNos.length) return saleOrderOptions;
    const opts = reqSoNos.map((so) => ({ value: so, label: `${so}` }));
    if (header.sale_ord_no && !opts.some((o) => o.value == header.sale_ord_no)) {
      opts.unshift({ value: header.sale_ord_no, label: `${header.sale_ord_no}` });
    }
    return opts;
  }, [reqSoNos, saleOrderOptions, header.sale_ord_no]);
  const loadSaleOrderOptions = useCallback(
    async (input) => {
      const text = String(input || "").trim();
      if (reqSoNos.length || !text) {
        const q = text.toLowerCase();
        return availableSoOptions.filter((o) => !q || o.label.toLowerCase().includes(q));
      }
      try {
        const term = text.replace(/^SO-?/i, "").trim();
        const res = await fetch(`/api/orders/saleOrder?approvedOnly=true&limit=60&search=${encodeURIComponent(term)}`);
        if (!res.ok) return [];
        const json = await res.json();
        return (json.data || []).map((o) => ({ value: o.order_no, label: `${o.order_no}` }));
      } catch {
        return [];
      }
    },
    [reqSoNos, availableSoOptions],
  );

  const fetchRequisitions = useCallback(async (input) => {
    const { data } = await axios.get("/api/material/requisition", {
      params: { search: input, limit: 20, category: "DISPATCH" },
    });
    return (data.data || []).map((req) => ({ value: req.tran_id, label: `Plan #${req.tran_id}`, reqData: req }));
  }, []);
  const loadRequisitions = useDebouncedLoader(fetchRequisitions);

  const fetchProducts = useCallback(async (input) => {
    const { data } = await axios.get("/api/forms/items", { params: { search: input, limit: 20, category: "1,2" } });
    return (data.items || []).map(toItemOption);
  }, []);
  const loadProducts = useDebouncedLoader(fetchProducts);

  const fetchBoms = useCallback(async (input) => {
    const { data } = await axios.get("/api/manufacturing/bom/select", {
      params: { search: input, filterStatus: "Active" },
    });
    return data.data || [];
  }, []);
  const loadBoms = useDebouncedLoader(fetchBoms);

  // ── PO No preview ────────────────────────────────────────────────────────
  const [nextPoNo, setNextPoNo] = useState(null);
  useEffect(() => {
    if (!isCreate) return;
    let cancelled = false;
    axios
      .get("/api/manufacturing/production/next-id")
      .then(({ data }) => !cancelled && setNextPoNo(data?.nextId ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isCreate]);
  const poNo = isCreate ? nextPoNo : editingItem?.id;

  // ── print (selected production item) ────────────────────────────────────
  const printSelected = useCallback(async () => {
    if (!selected?.finished_id) {
      setNotice({ tone: "warn", text: "Select the production item to print." });
      return;
    }
    const body = buildPayload({ header, outputs, lines, type, isEdit, locked });
    const plan = planForOutput(
      {
        ...(editingItem || {}),
        ...body,
        id: poNo ?? editingItem?.id,
        outputs: body.outputs.map((o, i) => ({ ...o, item_name: outputs[i]?.item_name })),
        productionPlanDetail: body.productionPlanDetail.map((d) => ({
          ...d,
          material_code: lines.find((l) => l.material_id === d.material_id)?.material_code || "",
        })),
      },
      selectedIndex + 1,
    );
    try {
      const [itemsRes, instructionRes] = await Promise.all([
        axios.get("/api/forms/items", { params: { search: plan.finished_id } }),
        axios.get("/api/manufacturing/machine-instruction", { params: { search: header.machine_id } }),
      ]);
      const doc = generateProcessOrderPDF(plan, itemsRes.data.items?.[0], instructionRes.data.data?.[0], "View", company);
      const url = URL.createObjectURL(doc.output("blob"));
      const win = window.open(url, "_blank");
      if (win) {
        win.onload = () => {
          win.focus();
          win.print();
        };
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error("PDF generation error:", err);
      setNotice({ tone: "bad", text: "Failed to generate the PDF." });
    }
  }, [selected, header, outputs, lines, type, isEdit, locked, editingItem, poNo, selectedIndex, company]);

  // ── save ─────────────────────────────────────────────────────────────────
  const submit = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (isView || busy || isSubmitting) return;
      if (isPosted && !yieldEditable) return;
      setSubmitted(true);
      setNotice(null);
      if (!locked && v.count > 0) {
        // jump to the first production item with a problem
        const bad = outputs.find((o) => v.outputs.has(o.key));
        if (bad) setSelectedKey(bad.key);
        // the list of problems is the summary under the header
        if (blockOnStock && shortByLine.size) {
          setStockRows(
            [...shortByLine.keys()].map((k) => {
              const l = lines.find((x) => x.key === k);
              const sk = `${l.material_id}:${l.godown}`;
              return {
                key: k,
                code: l.material_code,
                name: l.material_desc || l.material_id,
                required: needByKey.get(sk) || 0,
                available: stock[sk]?.qty ?? 0,
                godownName: godownName(l.godown),
              };
            }),
          );
        }
        return;
      }
      setBusy(true);
      try {
        await onSubmit(buildPayload({ header, outputs, lines, type, isEdit, locked }));
      } catch (err) {
        setNotice({ tone: "bad", text: err?.response?.data?.error || err?.message || "Failed to save" });
      } finally {
        setBusy(false);
      }
    },
    [isView, busy, isSubmitting, isPosted, yieldEditable, locked, v, outputs, blockOnStock, shortByLine, lines, needByKey, stock, godownName, onSubmit, header, type, isEdit],
  );

  const saveViaKeyboard = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setTimeout(() => submit(), 0);
  }, [submit]);

  // ── keyboard ─────────────────────────────────────────────────────────────
  /** Alt+1: the selected production item's picker. */
  const focusOutput = useCallback(() => {
    if (!selected) return;
    refs.current.get(`out-item-${selected.key}`)?.focus?.();
  }, [selected]);

  /** Alt+2: the first issuance line (adds one when there is none). */
  const focusLines = useCallback(() => {
    const first = selectedLines[0];
    if (!first) return addLine("material");
    refs.current.get(`line-${first.kind === "material" ? "item" : "text"}-${first.key}`)?.focus?.();
  }, [selectedLines, addLine]);

  /** Alt+Delete: removes the issuance line holding the focus. */
  const removeFocusedLine = useCallback(() => {
    const row = document.activeElement?.closest?.("[data-line-key]");
    if (!row || locked) return;
    const key = row.dataset.lineKey;
    const idx = selectedLines.findIndex((l) => l.key === key);
    const near = selectedLines[idx + 1] || selectedLines[idx - 1];
    if (near) pendingFocus.current = `line-${near.kind === "material" ? "item" : "text"}-${near.key}`;
    removeLine(key);
  }, [locked, selectedLines, removeLine]);

  const overlayOpen = !!stockRows || confirmOpen;
  useKeyboardShortcuts(
    {
      "ctrl+s": { handler: saveViaKeyboard, allowInInput: true },
      "ctrl+enter": { handler: saveViaKeyboard, allowInInput: true },
      "alt+n": { handler: addOutput, allowInInput: true },
      "alt+i": { handler: () => addLine("material"), allowInInput: true },
      "alt+m": { handler: () => addLine("material"), allowInInput: true },
      "alt+t": { handler: () => addLine("instruction"), allowInInput: true },
      "alt+b": { handler: loadItemBom, allowInInput: true },
      "alt+p": { handler: printSelected, allowInInput: true },
      "alt+1": { handler: focusOutput, allowInInput: true },
      "alt+2": { handler: focusLines, allowInInput: true },
      "alt+delete": { handler: removeFocusedLine, allowInInput: true },
      "alt+arrowup": { handler: () => moveSelection(-1), allowInInput: true },
      "alt+arrowdown": { handler: () => moveSelection(1), allowInInput: true },
      arrowup: () => moveSelection(-1),
      arrowdown: () => moveSelection(1),
    },
    !overlayOpen,
  );

  const SHORTCUTS = [
    { combo: "Ctrl+S", label: isCreate ? "Save process order" : "Update process order" },
    { combo: "Alt+N", label: "Add production item" },
    { combo: "Alt+I", label: "Add issuance line (selected item)" },
    { combo: "Alt+T", label: "Add instruction / note" },
    { combo: "Alt+B", label: "Load BOM of selected item" },
    { combo: "Alt+1", label: "Go to production item" },
    { combo: "Alt+2", label: "Go to issuance lines" },
    { combo: "Alt+Delete", label: "Remove the focused issuance line" },
    { combo: "↑ / ↓", label: "Previous / next production item" },
    { combo: "Alt+↑ / Alt+↓", label: "Same, while typing" },
    { combo: "↑ / ↓ in Qty", label: "Qty of previous / next line" },
    { combo: "Enter", label: "Next field (on the last line's Qty: new line)" },
    { combo: "Shift+Enter", label: "Previous field" },
    { combo: "Alt+P", label: "Print selected item" },
    { combo: "Esc", label: "Close dropdown / dialog" },
    { combo: "Shift+?", label: "Show this help" },
  ];

  // Enter → next field (react-select keeps Enter while its menu is open);
  // on the last complete issuance line's Qty it starts a new line.
  const onFormKeyDown = useCallback(
    (e) => {
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.tagName === "TEXTAREA" && e.shiftKey) return; // newline in a note
      if (t.tagName === "BUTTON") return;
      if (e.defaultPrevented) return;
      if (t.closest?.(".react-select__control") && document.querySelector(".react-select__menu")) return;
      e.preventDefault();
      if (!e.shiftKey && t.dataset?.addOnEnter && toNum(t.value) > 0) return addLine("material");
      moveFocus(t, e.shiftKey ? -1 : 1);
    },
    [addLine],
  );

  // ↑/↓ inside an issuance cell → same column of the previous / next line
  const onGridKeyDown = useCallback((e) => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.ctrlKey || e.shiftKey) return;
    const t = e.target;
    const col = t.dataset?.col;
    if (!col || t.tagName !== "INPUT") return;
    e.preventDefault();
    const step = (r) => (e.key === "ArrowUp" ? r?.previousElementSibling : r?.nextElementSibling);
    let row = step(t.closest("[data-line-key]"));
    while (row && !row.querySelector(`[data-col="${col}"]`)) row = step(row);
    const next = row?.querySelector(`[data-col="${col}"]`);
    if (next) {
      next.focus();
      next.select?.();
    }
  }, []);

  // ══════════════════════════════════════════════════════════════════════
  const isReproc = type === PRODUCTION_TYPES.REPROCESSING;
  const typeLabel = isReproc ? "Reprocessing" : type === PRODUCTION_TYPES.SF ? "SF to FG" : "New Production";
  const sel = selected;
  const selTotals = sel ? totalsOf(sel) : null;
  const lastMaterialKey = [...selectedLines].reverse().find((l) => l.kind === "material")?.key;

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onKeyDown={onFormKeyDown}
      className="flex min-h-full flex-col gap-2 text-foreground lg:h-full lg:min-h-0"
    >
      {/* ── header ─────────────────────────────────────────────────────── */}
      <section className={cn(UI.panel, "flex-shrink-0")}>
        <div className={UI.panelHead}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2 text-primary-foreground">
              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">PO</span>
              <span className="font-mono text-sm font-bold tabular-nums">{poNo ?? "…"}</span>
            </span>
            {isCreate ? (
              <div
                role="radiogroup"
                aria-label="Production type"
                className="inline-flex h-7 rounded-md border border-border bg-background p-0.5"
              >
                {[
                  { value: PRODUCTION_TYPES.NEW, label: "New Production", short: "New", icon: FileText },
                  { value: PRODUCTION_TYPES.REPROCESSING, label: "Reprocessing", short: "Reprocess", icon: RefreshCw },
                ].map(({ value, label, short, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={type === value}
                    onClick={() => setProductionType?.(value)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-2 text-xs font-semibold transition",
                      type === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon size={12} />
                    <span className="sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <span className="inline-flex h-6 items-center rounded-full border border-primary/25 bg-background px-2 text-[11.5px] font-medium text-primary">
                {typeLabel}
              </span>
            )}
            {status && <StatusBadge status={status} />}
            {isPosted && (
              <span className={cn("inline-flex items-center gap-1 text-[11.5px] font-semibold", TONE_TEXT.warn)}>
                <Lock size={11} />
                Posted — {yieldEditable ? "only the actual yield can change" : "read only"}
              </span>
            )}
            {isReproc && isCreate && (
              <span className="hidden text-[11.5px] font-medium text-primary md:inline">
                Posts material issue + production on save
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <LifecycleStepper status={status} isCreate={isCreate} isReproc={isReproc} />
            {!isView && <KeyboardHint shortcuts={SHORTCUTS} />}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 px-3 py-2 sm:grid-cols-4 lg:grid-cols-[repeat(2,minmax(0,8.5rem))_repeat(2,minmax(0,1fr))_repeat(3,minmax(0,6.5rem))_auto]">
          <div>
            <label className={UI.label} htmlFor="po-dated">Plan date *</label>
            <input
              id="po-dated"
              type="date"
              value={header.dated || ""}
              onChange={(e) => patchHeader({ dated: e.target.value })}
              disabled={locked}
              className={cn(UI.input, show && !header.dated && UI.inputErr)}
            />
          </div>
          <div>
            <label className={UI.label} htmlFor="po-del">Delivery date</label>
            <input
              id="po-del"
              type="date"
              value={header.req_del_date || ""}
              onChange={(e) => patchHeader({ req_del_date: e.target.value })}
              disabled={locked}
              className={UI.input}
            />
          </div>
          {!isReproc && (
            <>
              <div>
                <label className={UI.label}>Plan No</label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  loadOptions={loadRequisitions}
                  value={header.req_no ? { value: header.req_no, label: `Plan #${header.req_no}` } : null}
                  onChange={(opt) => {
                    if (!opt) return patchHeader({ req_no: "", req_items: [], sale_ord_no: null });
                    const details = opt.reqData?.details || [];
                    const sos = [...new Set(details.map((d) => d.so_no).filter((x) => x != null && x !== ""))];
                    if (opt.reqData?.so_no && !sos.includes(opt.reqData.so_no)) sos.push(opt.reqData.so_no);
                    patchHeader({ req_no: opt.value, req_items: details, sale_ord_no: sos.length === 1 ? sos[0] : null });
                  }}
                  isClearable
                  isDisabled={locked}
                  placeholder="Search plan…"
                  aria-label="Plan No (dispatch requisition)"
                  classNamePrefix="react-select"
                  menuPortalTarget={portalTarget()}
                  menuPlacement="auto"
                  styles={compactSelect}
                />
              </div>
              <div>
                <label className={UI.label}>Sale order</label>
                <AsyncSelect
                  value={
                    availableSoOptions.find((o) => o.value == header.sale_ord_no) ||
                    (header.sale_ord_no ? { value: header.sale_ord_no, label: `${header.sale_ord_no}` } : null)
                  }
                  onChange={(opt) => patchHeader({ sale_ord_no: opt ? opt.value : null })}
                  defaultOptions={availableSoOptions}
                  loadOptions={loadSaleOrderOptions}
                  cacheOptions={false}
                  isClearable
                  isDisabled={locked || saleOrdersLoading}
                  placeholder={saleOrdersLoading ? "Loading…" : "Select order"}
                  aria-label="Sale order"
                  classNamePrefix="react-select"
                  menuPortalTarget={portalTarget()}
                  menuPlacement="auto"
                  styles={compactSelect}
                />
              </div>
              <div>
                <label className={UI.label} htmlFor="po-machine">Machine ID</label>
                <input
                  id="po-machine"
                  value={header.machine_id ?? ""}
                  onChange={(e) => patchHeader({ machine_id: e.target.value })}
                  disabled={locked}
                  className={UI.input}
                />
              </div>
              <div>
                <label className={UI.label} htmlFor="po-time">Time (min)</label>
                <input
                  id="po-time"
                  type="number"
                  min="0"
                  value={header.time_min ?? ""}
                  onChange={(e) => patchHeader({ time_min: e.target.value })}
                  onWheel={noWheel}
                  disabled={locked}
                  className={cn(UI.input, "text-right tabular-nums")}
                />
              </div>
              <div>
                <label className={UI.label} htmlFor="po-visc">Viscosity</label>
                <input
                  id="po-visc"
                  value={header.viscosity || ""}
                  onChange={(e) => patchHeader({ viscosity: e.target.value })}
                  disabled={locked}
                  className={UI.input}
                />
              </div>
            </>
          )}
          <div>
            <span className={UI.label}>M2M</span>
            <div className="flex h-8 items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={!!header.m2m}
                aria-label="M2M"
                disabled={locked}
                onClick={() => patchHeader({ m2m: !header.m2m })}
                className={cn(
                  "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60",
                  header.m2m ? "bg-primary" : "bg-input",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform",
                    header.m2m ? "translate-x-[18px]" : "translate-x-[3px]",
                  )}
                />
              </button>
              <span className="text-xs font-semibold">{header.m2m ? "Yes" : "No"}</span>
            </div>
          </div>
        </div>
        {show && v.header.length > 0 && (
          <div className="px-2.5 pb-2">
            <ErrorText messages={v.header} />
          </div>
        )}
      </section>

      {show && !locked && v.count > 0 && (
        <div role="alert" className="flex-shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-destructive">
            <AlertCircle size={14} />
            Fix {v.count} issue{v.count === 1 ? "" : "s"} before saving
          </p>
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto pl-5 text-foreground">
            {v.header.map((m) => (
              <li key={`h-${m}`} className="list-disc">{m}</li>
            ))}
            {outputs.map((o, idx) => {
              const errs = v.outputs.get(o.key) || [];
              const badLines = lines.filter((l) => l.outputKey === o.key && v.lines.has(l.key)).length;
              if (!errs.length && !badLines) return null;
              return (
                <li key={o.key} className="list-disc">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(o.key)}
                    className="text-left font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Production item {idx + 1}
                    {o.item_code ? ` (${o.item_code})` : ""}
                  </button>
                  {errs.length ? `: ${errs.join(" · ")}` : ""}
                  {badLines ? `${errs.length ? " ·" : ":"} ${badLines} issuance line${badLines === 1 ? "" : "s"} to fix` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {notice && (
        <div
          role={notice.tone === "bad" ? "alert" : "status"}
          className={cn(
            "flex flex-shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold",
            notice.tone === "bad" && CHIP.bad,
            notice.tone === "warn" && CHIP.warn,
            notice.tone === "good" && CHIP.ok,
          )}
        >
          <span className="flex items-center gap-1.5">
            {notice.tone === "good" ? <Layers size={14} /> : <AlertTriangle size={14} />}
            {notice.text}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="text-base leading-none opacity-60 hover:opacity-100" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {/* ── body: production items | issuances ─────────────────────────── */}
      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)]">
        {/* LEFT — production items */}
        <section className={cn(UI.panel, "flex min-h-0 flex-col")} aria-label="Production items">
          <div className={UI.panelHead}>
            <h3 className={UI.title}>
              <Factory size={14} className="text-primary" />
              Production items
              <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-bold tabular-nums text-primary">
                {outputs.length}
              </span>
            </h3>
            {!locked && (
              <button type="button" onClick={addOutput} className={cn(UI.btn, "bg-primary text-primary-foreground hover:opacity-90")} title="Add production item (Alt+N)">
                <Plus size={13} />
                Add item
                <span className="hidden opacity-80 xl:inline">
                  <KeyCombo combo="Alt+N" />
                </span>
              </button>
            )}
          </div>

          <div
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5"
            role="listbox"
            aria-label="Production items"
            aria-activedescendant={sel ? `card-${sel.key}` : undefined}
          >
            {outputs.map((o, idx) => {
              const t = totalsOf(o);
              const errs = v.outputs.get(o.key);
              const active = o.key === sel?.key;
              const g = outputGodown(o);
              return (
                <div
                  key={o.key}
                  id={`card-${o.key}`}
                  ref={setRef(`card-${o.key}`)}
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelectedKey(o.key)}
                  className={cn(
                    "cursor-pointer overflow-hidden rounded-lg border transition-colors",
                    active
                      ? "border-primary/60 ring-1 ring-primary/30"
                      : "border-border hover:border-primary/30 hover:bg-muted/50",
                    show && errs && !active && "border-destructive/60",
                  )}
                >
                  {/* summary row */}
                  <div className={cn("flex items-center gap-2 px-2 py-1.5", active && "bg-primary/5")}>
                    <span
                      className={cn(
                        "flex h-5 min-w-[1.25rem] flex-shrink-0 items-center justify-center rounded px-1 text-[11px] font-bold tabular-nums",
                        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5">
                        {o.item_code && <span className={cn(CODE_CHIP, "flex-shrink-0 text-[11.5px]")}>{o.item_code}</span>}
                        <span className={cn("truncate font-semibold", !o.finished_id && "font-medium italic text-muted-foreground")}>
                          {o.item_name || (o.finished_id ? `Item ${o.finished_id}` : "Select production item")}
                        </span>
                      </div>
                      <div className={cn("flex min-w-0 items-center gap-x-2 text-[11px] leading-4", UI.muted)}>
                        <span className="inline-flex min-w-0 items-center gap-0.5">
                          <Warehouse size={10} className="flex-shrink-0" />
                          <span className="truncate">{godownName(g)}</span>
                        </span>
                        {o.batch_no && <span className="truncate">Batch {o.batch_no}</span>}
                        <span className={cn("whitespace-nowrap", t.count === 0 && TONE_TEXT.warn)}>
                          {t.count} line{t.count === 1 ? "" : "s"}
                          {t.ratio !== null ? ` · ${round(t.ratio, 1)}%` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end leading-4">
                      <span className="text-[13px] font-bold tabular-nums">
                        {fmtQty(o.qty)} <span className="text-[10px] font-semibold text-muted-foreground">{o.unit}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] font-bold">
                        {o.bom_id && <span className="text-primary">BOM #{o.bom_id}</span>}
                        {t.short > 0 && (
                          <span className={cn("inline-flex items-center gap-0.5", TONE_TEXT.warn)} title="Stock shortage">
                            <AlertTriangle size={10} />
                            {t.short}
                          </span>
                        )}
                        {errs && (
                          <span className="inline-flex items-center gap-0.5 text-destructive" title={errs.join("\n")}>
                            <AlertCircle size={10} />
                            {errs.length}
                          </span>
                        )}
                      </span>
                    </div>
                    {!locked && outputs.length > 1 && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeOutput(o.key);
                        }}
                        className={cn(UI.iconBtn, "h-6 w-6")}
                        title="Remove production item"
                        aria-label={`Remove production item ${idx + 1}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {/* editor of the selected item */}
                  {active && (
                    <div
                      className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-border bg-muted/40 p-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="col-span-2">
                        <label className={UI.label}>Production item *</label>
                        <AsyncSelect
                          ref={setRef(`out-item-${o.key}`)}
                          cacheOptions
                          defaultOptions
                          loadOptions={loadProducts}
                          value={
                            o.finished_id
                              ? { value: o.finished_id, code: o.item_code, name: o.item_name || `Item ${o.finished_id}`, label: `${o.item_code} ${o.item_name}` }
                              : null
                          }
                          onChange={(opt) => setOutputItem(o.key, opt)}
                          formatOptionLabel={formatItemOption}
                          isClearable
                          openMenuOnFocus
                          isDisabled={locked}
                          placeholder="Search by code, name or ID…"
                          aria-label={`Production item ${idx + 1}`}
                          classNamePrefix="react-select"
                          menuPortalTarget={portalTarget()}
                          menuPlacement="auto"
                          styles={show && !o.finished_id ? errSelectStyles : compactSelect}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className={UI.label}>BOM (optional)</label>
                        <div className="flex gap-1.5">
                          <div className="min-w-0 flex-1">
                            <AsyncSelect
                              cacheOptions
                              defaultOptions
                              loadOptions={loadBoms}
                              value={o.bom_id ? { value: o.bom_id, label: o.bom_label || `BOM #${o.bom_id}` } : null}
                              onChange={(opt) => (opt ? applyBom(o.key, opt.value, opt.label) : patchOutput(o.key, { bom_id: null, bom_label: "" }))}
                              isClearable
                              isDisabled={locked || bomLoading}
                              placeholder="No BOM — free entry"
                              aria-label="BOM"
                              classNamePrefix="react-select"
                              menuPortalTarget={portalTarget()}
                              menuPlacement="auto"
                              styles={compactSelect}
                            />
                          </div>
                          {!locked && (
                            <button
                              type="button"
                              onClick={loadItemBom}
                              disabled={bomLoading}
                              className={cn(UI.btn, UI.btnGhost, "h-8")}
                              title="Load the item's BOM into its issuances (Alt+B)"
                            >
                              {bomLoading ? <RefreshCw size={13} className="animate-spin" /> : <BookOpen size={13} />}
                              Load
                            </button>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className={UI.label} htmlFor={`qty-${o.key}`}>Quantity *</label>
                        <div className="flex">
                          <input
                            id={`qty-${o.key}`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.001"
                            value={o.qty ?? ""}
                            onChange={(e) => setOutputQty(o.key, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onWheel={noWheel}
                            disabled={locked}
                            className={cn(UI.input, "min-w-0 rounded-r-none text-right tabular-nums", show && !(toNum(o.qty) > 0) && UI.inputErr)}
                          />
                          <select
                            value={o.unit}
                            onChange={(e) => patchOutput(o.key, { unit: e.target.value })}
                            disabled={locked}
                            aria-label="Production unit"
                            data-skip-enter="1"
                            className={cn(UI.input, "w-[4.5rem] flex-shrink-0 rounded-l-none border-l-0 bg-muted px-1.5 text-xs")}
                          >
                            {[...new Set([o.unit, ...UNIT_OPTIONS])].map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className={UI.label} htmlFor={`godown-${o.key}`}>Godown *</label>
                        {godownSelect({
                          id: `godown-${o.key}`,
                          value: g,
                          onChange: (id) => patchOutput(o.key, { godown: id }),
                          invalid: show && !g,
                          disabled: locked,
                          ariaLabel: "Production godown",
                        })}
                      </div>
                      <div>
                        <label className={UI.label} htmlFor={`batch-${o.key}`}>Batch no</label>
                        <input
                          id={`batch-${o.key}`}
                          value={o.batch_no || ""}
                          onChange={(e) => patchOutput(o.key, { batch_no: e.target.value })}
                          disabled={locked}
                          maxLength={50}
                          className={UI.input}
                        />
                      </div>
                      {isPosted && (
                        <div>
                          <label className={UI.label} htmlFor={`yield-${o.key}`}>
                            Actual yield {!yieldEditable && <Lock size={9} className="inline" />}
                          </label>
                          <input
                            id={`yield-${o.key}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={o.actual_yield ?? ""}
                            onChange={(e) => patchOutput(o.key, { actual_yield: e.target.value })}
                            onWheel={noWheel}
                            disabled={!yieldEditable}
                            className={cn(UI.input, "text-right tabular-nums")}
                          />
                        </div>
                      )}
                      {isPosted && !yieldEditable && isEdit && (
                        <p className="col-span-2 text-[11.5px] font-semibold text-destructive">Editing closed (24 hours passed since posting)</p>
                      )}
                      {show && errs && (
                        <div className="col-span-2">
                          <ErrorText messages={errs} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* RIGHT — issuances of the selected production item */}
        <section className={cn(UI.panel, "flex min-h-[320px] min-w-0 flex-col lg:min-h-0")} aria-label="Issuances">
          <div className={UI.panelHead}>
            <h3 className={UI.title}>
              <Package size={14} className="flex-shrink-0 text-primary" />
              <span className="flex-shrink-0">Issuances</span>
              <span className="flex-shrink-0 rounded bg-primary/10 px-1.5 text-[11px] font-bold tabular-nums text-primary">#{selectedIndex + 1}</span>
              <span className="truncate text-xs font-medium text-muted-foreground">
                {sel?.item_code ? <span className="mr-1 font-mono font-semibold text-foreground">{sel.item_code}</span> : null}
                {sel?.item_name || ""}
              </span>
            </h3>
            {!locked && (
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" onClick={loadItemBom} disabled={bomLoading} className={cn(UI.btn, UI.btnGhost)} title="Load BOM (Alt+B)">
                  <BookOpen size={13} className="text-primary" />
                  BOM
                </button>
                <button type="button" onClick={() => addLine("instruction")} className={cn(UI.btn, UI.btnGhost)} title="Add instruction (Alt+T)">
                  <ClipboardList size={13} className="text-primary" />
                  Note
                </button>
                <button type="button" onClick={() => addLine("material")} className={cn(UI.btn, "bg-primary text-primary-foreground hover:opacity-90")} title="Add issuance line (Alt+I)">
                  <Plus size={13} />
                  Add line
                  <span className="hidden opacity-80 xl:inline"><KeyCombo combo="Alt+I" /></span>
                </button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onGridKeyDown}>
            {selectedLines.length === 0 ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Package size={24} className="text-primary" />
                </span>
                <p className="text-sm font-semibold text-foreground">No issuances for this production item</p>
                <p className={cn("max-w-sm text-xs", UI.muted)}>
                  Load the item&apos;s BOM to pre-fill them scaled to the quantity, or add the lines yourself.
                </p>
                {!locked && (
                  <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                    <button type="button" onClick={loadItemBom} className={cn(UI.btn, UI.btnGhost)}>
                      <BookOpen size={13} /> Load BOM <KeyCombo combo="Alt+B" />
                    </button>
                    <button type="button" onClick={() => addLine("material")} className={cn(UI.btn, "bg-primary text-primary-foreground")}>
                      <Plus size={13} /> Add issuance <KeyCombo combo="Alt+I" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* column heads (md+) */}
                <div
                  className={cn(
                    "sticky top-0 z-[1] hidden items-center gap-1 bg-primary px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground md:grid",
                    LINE_COLS,
                  )}
                >
                  <span className="text-center">#</span>
                  <span className="px-1.5">Item</span>
                  <span className="px-1.5">Issue godown</span>
                  <span className="px-1.5 text-right">Qty</span>
                  <span className="px-1.5">Unit</span>
                  <span className="text-right">%</span>
                  <span className="text-right">Stock</span>
                  <span />
                </div>
                <ol>
                  {selectedLines.map((l, i) => {
                    const errs = v.lines.get(l.key);
                    if (l.kind === "instruction") {
                      return (
                        <li
                          key={l.key}
                          data-line-key={l.key}
                          className="group flex items-start gap-1 border-b border-border/60 bg-muted/40 px-2 py-0.5"
                        >
                          <span className="flex h-8 w-7 flex-shrink-0 items-center justify-center gap-0.5 text-[11px] font-bold text-primary">
                            <ClipboardList size={11} />
                            {i + 1}
                          </span>
                          {locked ? (
                            <p className="flex-1 py-1.5 text-[13px] font-medium">{l.material_desc || "—"}</p>
                          ) : (
                            <textarea
                              ref={setRef(`line-text-${l.key}`)}
                              rows={1}
                              value={l.material_desc}
                              onChange={(e) => patchLine(l.key, { material_desc: e.target.value })}
                              placeholder="Instruction / note… (Shift+Enter for a new line)"
                              aria-label={`Instruction ${i + 1}`}
                              maxLength={200}
                              className={cn(UI.cell, "h-auto min-h-8 flex-1 resize-none py-1.5 leading-5 [field-sizing:content]")}
                            />
                          )}
                          {!locked && (
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => removeLine(l.key)}
                              className={cn(UI.iconBtn, "mt-0.5 md:opacity-0 md:group-hover:opacity-100")}
                              title="Remove (Alt+Delete)"
                              aria-label={`Remove instruction ${i + 1}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </li>
                      );
                    }

                    const sk = `${l.material_id}:${l.godown}`;
                    const st = stock[sk];
                    const short = shortByLine.get(l.key);
                    const isPacking = st && st !== "loading" && st.categoryId === PACKAGING_CATEGORY_ID;
                    const pct = toNum(sel?.qty) > 0 ? (toNum(l.material_qty) / toNum(sel.qty)) * 100 : null;
                    return (
                      <li
                        key={l.key}
                        data-line-key={l.key}
                        className={cn(
                          "group grid grid-cols-6 items-center gap-x-1 gap-y-1 border-b border-border/60 px-2 py-1 transition-colors focus-within:bg-primary/5 hover:bg-muted/40 md:py-0.5",
                          LINE_COLS,
                          show && errs && "bg-destructive/5",
                        )}
                      >
                        <span className="flex items-center justify-center gap-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                          {i + 1}
                          {l.edited && <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Edited" />}
                        </span>
                        <div className="col-span-5 min-w-0 md:col-span-1">
                          {locked ? (
                            <div className="flex min-w-0 items-center gap-1.5 px-1.5 text-[13px]">
                              {l.material_code && <span className={cn(CODE_CHIP, "flex-shrink-0 text-[11.5px]")}>{l.material_code}</span>}
                              <span className="truncate font-medium">{l.material_desc || l.material_id}</span>
                            </div>
                          ) : (
                            <ItemSelect
                              ref={setRef(`line-item-${l.key}`)}
                              value={
                                l.material_id
                                  ? { value: l.material_id, code: l.material_code, name: l.material_desc || `Item ${l.material_id}`, label: `${l.material_code} ${l.material_desc}` }
                                  : null
                              }
                              onChange={(opt) => {
                                patchLine(
                                  l.key,
                                  opt
                                    ? {
                                        material_id: opt.value,
                                        material_code: opt.code || "",
                                        material_desc: opt.name || "",
                                        unit: unitOfItem(opt.unit || opt.raw?.unit),
                                        fromBom: false,
                                        wastage_percentage: opt.raw?.wastage_percentage ?? null,
                                      }
                                    : { material_id: null, material_code: "", material_desc: "" },
                                );
                                // godown is pre-filled: jump straight to the quantity
                                if (opt) pendingFocus.current = `line-qty-${l.key}`;
                              }}
                              minWidth="100%"
                              ariaLabel={`Issuance ${i + 1} item`}
                              styles={show && !l.material_id ? errCellSelect : cellSelect}
                            />
                          )}
                        </div>
                        <div className="col-span-3 min-w-0 md:col-span-1">
                          {godownSelect({
                            value: l.godown,
                            onChange: (id) => patchLine(l.key, { godown: id }),
                            invalid: show && !l.godown,
                            disabled: locked,
                            ariaLabel: `Issuance ${i + 1} godown`,
                            cell: true,
                          })}
                        </div>
                        <div className="col-span-2 md:col-span-1">
                          <input
                            ref={setRef(`line-qty-${l.key}`)}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.001"
                            data-col="qty"
                            data-add-on-enter={l.key === lastMaterialKey && l.material_id ? "1" : undefined}
                            value={l.material_qty ?? ""}
                            onChange={(e) => patchLine(l.key, { material_qty: e.target.value, fromBom: false })}
                            onFocus={(e) => e.target.select()}
                            onWheel={noWheel}
                            disabled={locked}
                            placeholder="0"
                            aria-label={`Issuance ${i + 1} quantity`}
                            className={cn(
                              UI.cell,
                              "text-right font-semibold tabular-nums",
                              show && !(toNum(l.material_qty) > 0) && UI.inputErr,
                              short && "!border-[#b08a2e]",
                            )}
                          />
                        </div>
                        <div className="md:col-span-1">
                          <select
                            value={l.unit || "KG"}
                            onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                            disabled={locked}
                            aria-label={`Issuance ${i + 1} unit`}
                            data-skip-enter="1"
                            className={cn(UI.cell, "px-1 text-xs")}
                          >
                            {[...new Set([l.unit || "KG", ...UNIT_OPTIONS])].map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                        <div
                          className="col-span-2 text-right text-[11px] font-semibold tabular-nums text-muted-foreground md:col-span-1"
                          title={l.fromBom ? "Quantity from BOM — % of the production quantity" : "% of the production quantity"}
                        >
                          <span className="mr-1 text-[10px] uppercase md:hidden">%</span>
                          {l.fromBom ? (
                            <span className="text-primary">{round(l.material_percentage, 2)}</span>
                          ) : pct !== null ? (
                            round(pct, 2)
                          ) : (
                            "—"
                          )}
                        </div>
                        <div className="col-span-3 truncate text-right text-[11px] font-bold tabular-nums md:col-span-1">
                          <span className="mr-1 text-[10px] font-semibold uppercase text-muted-foreground md:hidden">Stock</span>
                          {locked || !l.material_id || !l.godown ? (
                            <span className="text-muted-foreground">—</span>
                          ) : st === undefined || st === "loading" ? (
                            <span className="text-muted-foreground">…</span>
                          ) : st.qty === null ? (
                            <span className="text-muted-foreground">n/a</span>
                          ) : isPacking ? (
                            <span className={UI.muted} title="Packing material is not stock-checked">{fmtQty(st.qty)} · pack</span>
                          ) : short ? (
                            <span className={cn("inline-flex items-center gap-0.5", TONE_TEXT.warn)} title={`Total needed from this godown: ${fmtQty(needByKey.get(sk))} · short ${fmtQty(short)}`}>
                              <AlertTriangle size={10} />
                              {fmtQty(st.qty)} <span className="font-semibold">(−{fmtQty(short)})</span>
                            </span>
                          ) : (
                            <span className={TONE_TEXT.ok}>{fmtQty(st.qty)}</span>
                          )}
                        </div>
                        <div className="flex justify-end">
                          {!locked && (
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => removeLine(l.key)}
                              className={cn(UI.iconBtn, "h-6 w-6 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100")}
                              title="Remove (Alt+Delete)"
                              aria-label={`Remove issuance ${i + 1}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        {show && errs && (
                          <div className="col-span-6 pb-1 md:col-span-8">
                            <ErrorText messages={errs} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {!locked && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => addLine("material")}
                    className="flex w-full items-center gap-1.5 border-b border-dashed border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-primary/5 hover:text-primary"
                  >
                    <Plus size={13} />
                    Add line
                    <span className="ml-1 hidden text-[11px] font-medium md:inline">— or press Enter on the last Qty</span>
                  </button>
                )}
              </>
            )}
          </div>

          {/* per-item totals */}
          {sel && selTotals && (
            <div className="flex flex-shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t-2 border-primary bg-muted/50 px-3 py-1.5">
              <Stat label="Produce" value={`${fmtQty(selTotals.produce)} ${sel.unit}`} />
              <Stat label="Issued" value={fmtQty(selTotals.issued)} />
              <Stat
                label="Issued / produce"
                value={selTotals.ratio === null ? "—" : `${round(selTotals.ratio, 1)}%`}
                tone={selTotals.ratio === null ? "default" : Math.abs(selTotals.ratio - 100) > 10 ? "warn" : "good"}
              />
              <Stat label="Lines" value={`${selTotals.count}${selTotals.notes ? ` + ${selTotals.notes} notes` : ""}`} tone={selTotals.count ? "default" : "warn"} />
            </div>
          )}
        </section>
      </div>

      {(isView || isEdit) && <ChangeHistory logs={editingItem?.changeLogs || []} />}

      {/* ── summary bar ─────────────────────────────────────────────────── */}
      <div className={cn(UI.panel, "sticky bottom-0 z-10 flex flex-shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.25)]")}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Stat label="Items" value={summary.items} />
          <Stat label="Total produce" value={fmtQty(summary.produce)} />
          <Stat label="Total issued" value={fmtQty(summary.issued)} />
          <Stat label="Short" value={summary.short} tone={summary.short ? "warn" : "good"} />
          <Stat label="Issues" value={locked ? "—" : v.count} tone={locked ? "default" : v.count ? "bad" : "good"} />
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <button type="button" onClick={printSelected} className={cn(UI.btn, UI.btnGhost, "h-8")} title="Print selected production item (Alt+P)">
            <FileText size={13} className="text-primary" />
            Print
          </button>
          <button type="button" onClick={onCancel} className={cn(UI.btn, UI.btnGhost, "h-8")} title="Close (Esc)">
            {isView ? "Close" : "Cancel"}
          </button>
          {!isView && (!isPosted || yieldEditable) && (
            <button
              type="submit"
              disabled={busy || isSubmitting}
              className={cn(UI.btn, "h-8 bg-primary px-4 text-[13px] text-primary-foreground hover:opacity-90")}
              title="Save (Ctrl+S)"
            >
              {busy || isSubmitting ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              {isPosted ? "Update yield" : isEdit ? "Update" : isReproc ? "Save & post" : "Save"}
              <span className="hidden opacity-80 md:inline"><KeyCombo combo="Ctrl+S" /></span>
            </button>
          )}
        </div>
      </div>

      {stockRows && <StockDialog rows={stockRows} onClose={() => setStockRows(null)} />}
      {confirmDialog}
    </form>
  );
};

export default ProcessOrderForm;
