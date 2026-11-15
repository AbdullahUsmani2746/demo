"use client";
// Services panel of the GRN / Dispatch form (voucherConfig.documentServices).
// Freight, off-loading, weighing … keyed in on the document itself; the
// document's save sends them as body.services and the server books them as
// Service Invoices linked to it — one per vendor + vendor invoice no
// (lib/service/documentServices.js). Data: GET /api/service-invoice/document.
//
// Keyboard: Alt+V (Form.jsx) lands here · Enter = next cell (and a new row
// after the last) · Ctrl+Enter = add row · Ctrl+Delete = remove row.
// Picking a service fills the vendor / rate / ST % last billed for it.
// A new Dispatch starts with one row already filled (`auto`): the service and
// vendor it is usually billed with (defaultServiceRow) — the user types the
// amount; left without a rate, the row is not saved (Form.jsx).
//
// `rows` stays null until the saved services are loaded (and while the panel
// is hidden) — Form.jsx then sends nothing, so a save cannot wipe them.
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import axios from "axios";
import Select from "react-select";
import { Plus, RefreshCw, Trash2, Truck, Lock } from "lucide-react";
import { KeyCombo } from "@/components/ui/KeyboardHint";
import { SERVICE_VENDOR_GROUP_PARAM } from "@/lib/accounts/groupParams";
import { serviceLineAmounts } from "./constants";

const COLS = 6; // service · vendor · invoice no · qty · rate · ST %
const fmt = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let keySeq = 0;
const newKey = () => `svc-${Date.now().toString(36)}-${keySeq++}`;
const blankRow = () => ({ key: newKey(), tran_id: null, service_id: null, pycd: null, invoice_no: "", qty: 1, rate: "", st_rate: "" });
// Rate 0 is a real value (the party arranged the service itself — kept for
// reference, nothing to pay); only a rate never typed counts as empty.
const rateTyped = (v) => v !== "" && v !== null && v !== undefined;
const isBlank = (r) => !r.service_id && !r.pycd && !rateTyped(r.rate) && !String(r.invoice_no || "").trim();

const selectStyles = {
  control: (base, { isFocused, isDisabled }) => ({
    ...base,
    minHeight: 34,
    fontSize: "0.8125rem",
    backgroundColor: isDisabled ? "#f9fafb" : "white",
    borderColor: isFocused ? "#800000" : base.borderColor,
    boxShadow: isFocused ? "0 0 0 2px rgba(128,0,0,0.18)" : "none",
    "&:hover": { borderColor: isFocused ? "#800000" : "#9ca3af" },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 8px" }),
  dropdownIndicator: (base) => ({ ...base, padding: "4px 6px" }),
  indicatorSeparator: () => ({ display: "none" }),
  menu: (base) => ({ ...base, fontSize: "0.8125rem", border: "1px solid #e5e7eb", boxShadow: "0 6px 16px rgba(0,0,0,0.12)" }),
  option: (base, { isFocused, isSelected }) => ({
    ...base,
    padding: "6px 10px",
    backgroundColor: isSelected ? "#ececef" : isFocused ? "#f4f4f6" : "white",
    color: "#1b1c20", fontWeight: isSelected ? 600 : 400,
  }),
  menuPortal: (base) => ({ ...base, zIndex: 100000000 }),
};

const inputCls =
  "h-[34px] w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 outline-none transition-shadow " +
  "focus:border-[#800000] focus:ring-2 focus:ring-[#800000]/20 disabled:bg-gray-50 disabled:text-gray-500";
const numCls = `${inputCls} text-right tabular-nums`;

// One column template for the header and every row (md and up). Under md
// each row is a card: service and vendor full width, the rest two per line.
const GRID =
  "md:grid-cols-[1.75rem_minmax(9rem,1.3fr)_minmax(10rem,1.5fr)_minmax(6.5rem,0.8fr)_4.5rem_6.5rem_4.25rem_7.5rem_2rem]";

function MobileLabel({ children }) {
  return <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400 md:hidden">{children}</span>;
}

const DocumentServicesPanel = forwardRef(function DocumentServicesPanel(
  { sourceType, tranId = null, rows, onRowsChange, disabled = false, docLabel = "" },
  ref,
) {
  const [meta, setMeta] = useState({ loading: true, error: "", visible: false, can: {}, services: [], readOnly: [] });
  const [vendors, setVendors] = useState([]);
  const panelRef = useRef(null);
  const pendingFocus = useRef(null); // [row, col] to focus after the next render
  const idPrefix = useMemo(() => `svc${Math.random().toString(36).slice(2, 7)}`, []);
  const cellId = (r, c) => `${idPrefix}-${r}-${c}`;

  // ── Load ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    onRowsChange(null);
    setMeta((m) => ({ ...m, loading: true, error: "" }));
    axios
      .get("/api/service-invoice/document", { params: { type: sourceType, ...(tranId && { tran_id: tranId }) } })
      .then((res) => {
        if (cancelled) return;
        const d = res.data || {};
        setMeta({
          loading: false,
          error: "",
          visible: !!d.visible,
          can: d.can || {},
          services: Array.isArray(d.services) ? d.services : [],
          readOnly: Array.isArray(d.readOnly) ? d.readOnly : [],
        });
        if (!d.visible) return;
        const saved = (Array.isArray(d.rows) ? d.rows : []).map((r) => ({ ...r, key: newKey() }));
        if (!saved.length && !tranId && d.defaultRow && d.can?.create) {
          saved.push({ ...blankRow(), ...d.defaultRow, auto: true });
        }
        onRowsChange(saved);
      })
      .catch(() => {
        if (!cancelled) setMeta((m) => ({ ...m, loading: false, error: "Could not load this document's services. Close and reopen it before saving services." }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceType, tranId]);

  useEffect(() => {
    if (!meta.visible) return;
    axios
      .get(`/api/accounts/acno?${SERVICE_VENDOR_GROUP_PARAM}`)
      .then((res) => {
        const list = Array.isArray(res.data?.data) ? res.data.data : [];
        setVendors(list.map((a) => ({ value: Number(a.acno), label: `${a.acno} - ${a.acname || ""}` })));
      })
      .catch(() => setVendors([]));
  }, [meta.visible]);

  // ── Options (saved rows may carry a service / vendor not in the lists) ──
  const serviceOptions = useMemo(() => {
    const opts = meta.services.map((s) => ({ value: Number(s.value), label: s.label, last: s.last }));
    const known = new Set(opts.map((o) => o.value));
    for (const r of rows || []) {
      if (r.service_id && !known.has(Number(r.service_id))) {
        known.add(Number(r.service_id));
        opts.push({ value: Number(r.service_id), label: r.service_name || `Service ${r.service_id}`, last: null });
      }
    }
    return opts;
  }, [meta.services, rows]);
  const vendorOptions = useMemo(() => {
    const known = new Set(vendors.map((v) => v.value));
    const extra = (rows || [])
      .filter((r) => r.pycd && !known.has(Number(r.pycd)) && (known.add(Number(r.pycd)) || true))
      .map((r) => ({ value: Number(r.pycd), label: r.vendor ? `${r.pycd} - ${r.vendor}` : String(r.pycd) }));
    return [...vendors, ...extra];
  }, [vendors, rows]);
  const serviceOf = (id) => serviceOptions.find((o) => o.value === Number(id)) || null;
  const vendorOf = (id) => vendorOptions.find((o) => o.value === Number(id)) || null;

  // ── Rights ──────────────────────────────────────────────────
  const list = rows || [];
  const canEditRow = (r) => !disabled && (r.tran_id ? !!meta.can.update : !!meta.can.create);
  const canRemoveRow = (r) => !disabled && (r.tran_id ? !!meta.can.delete : true);
  const canAdd = !disabled && !!meta.can.create && Array.isArray(rows);

  // ── Focus ───────────────────────────────────────────────────
  const focusCell = (r, c) => {
    const el = document.getElementById(cellId(r, c));
    if (!el) return false;
    el.focus();
    if (typeof el.select === "function" && el.tagName === "INPUT" && el.type !== "hidden") el.select();
    return true;
  };
  useEffect(() => {
    if (!pendingFocus.current) return;
    const [r, c] = pendingFocus.current;
    pendingFocus.current = null;
    focusCell(r, c);
  });

  const addRow = (focus = true) => {
    if (!canAdd) return;
    onRowsChange((prev) => [...(prev || []), blankRow()]);
    if (focus) pendingFocus.current = [list.length, 0];
  };
  const removeRow = (index) => {
    const r = list[index];
    if (!r || !canRemoveRow(r)) return;
    onRowsChange((prev) => (prev || []).filter((_, i) => i !== index));
    pendingFocus.current = [Math.max(0, Math.min(index, list.length - 2)), 0];
  };
  const patchRow = (index, patch) =>
    onRowsChange((prev) => (prev || []).map((r, i) => (i === index ? { ...r, ...patch } : r)));

  // Enter → next editable cell; past the last one, a new row (if this one has
  // something in it) — so a whole row is typed without touching the mouse.
  const next = (r, c) => {
    for (let col = c + 1; col < COLS; col += 1) if (focusCell(r, col)) return;
    if (r + 1 < list.length) {
      focusCell(r + 1, 0);
    } else if (canAdd && !isBlank(list[r] || {})) {
      addRow();
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (!Array.isArray(rows) || !meta.visible) return false;
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const firstEditable = list.findIndex((r) => canEditRow(r));
      if (firstEditable >= 0) return focusCell(firstEditable, list[firstEditable].auto && !rateTyped(list[firstEditable].rate) ? 4 : 0);
      if (canAdd) {
        addRow();
        return true;
      }
      return false;
    },
  }));

  const onCellKeyDown = (e, r, c, { isSelect = false } = {}) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      addRow();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Delete") {
      e.preventDefault();
      e.stopPropagation();
      removeRow(r);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // An open select menu takes Enter to pick; its onChange moves on.
      if (isSelect && e.target?.getAttribute?.("aria-expanded") === "true") return;
      e.preventDefault();
      e.stopPropagation();
      next(r, c);
    }
  };

  const pickService = (index, opt) => {
    const row = list[index];
    const last = opt?.last;
    const patch = { service_id: opt?.value ?? null, service_name: opt?.label ?? "" };
    // Fill only what is still empty — never overwrite what was typed.
    if (last && !row.pycd && last.pycd) Object.assign(patch, { pycd: last.pycd, vendor: last.vendor });
    if (last && !rateTyped(row.rate) && last.rate) patch.rate = last.rate;
    if (last && (row.st_rate === "" || row.st_rate == null) && last.st_rate) patch.st_rate = last.st_rate;
    patchRow(index, patch);
    // Vendor already known → straight to the rate.
    pendingFocus.current = [index, patch.pycd || row.pycd ? 4 : 1];
  };

  // ── Totals ──────────────────────────────────────────────────
  const totals = useMemo(() => {
    let gross = 0;
    let tax = 0;
    const invoices = new Set();
    for (const r of list) {
      if (isBlank(r)) continue;
      const a = serviceLineAmounts(r);
      gross += a.gross;
      tax += a.tax;
      if (r.pycd) invoices.add(`${r.pycd}|${String(r.invoice_no || "").trim().toUpperCase()}`);
    }
    return { gross, tax, total: gross + tax, invoices: invoices.size };
  }, [list]);

  if (meta.loading) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-md border bg-white px-4 py-3 text-sm text-gray-500 shadow-sm">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading services…
      </div>
    );
  }
  if (meta.error) {
    return <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{meta.error}</div>;
  }
  if (!meta.visible) return null;

  const selectCommon = {
    menuPortalTarget: typeof window !== "undefined" ? document.body : null,
    menuPlacement: "auto",
    openMenuOnFocus: true,
    tabSelectsValue: false,
    styles: selectStyles,
    classNamePrefix: "react-select",
  };

  return (
    <div ref={panelRef} className="mt-4 overflow-hidden rounded-xl border border-border bg-white">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-[15px] font-semibold text-primary">Services</span>
          <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-bold tabular-nums text-primary">
            {list.filter((r) => !isBlank(r)).length}
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            freight, off-loading, weighing … billed as Service Invoices{docLabel ? ` for ${docLabel}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden md:inline">Jump here</span>
          <KeyCombo combo="Alt+V" />
        </div>
      </div>

      {/* Column headings (md and up) */}
      {list.length > 0 && (
        <div className={`hidden gap-2 bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground md:grid ${GRID}`}>
          <span>#</span>
          <span>Service</span>
          <span>Vendor (bill to)</span>
          <span>Vendor Inv #</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Rate</span>
          <span className="text-right">ST %</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
      )}

      {/* Rows */}
      <div className="divide-y">
        {list.map((r, i) => {
          const editable = canEditRow(r);
          const amounts = serviceLineAmounts(r);
          return (
            <div
              key={r.key}
              className={`grid grid-cols-2 items-start gap-2 px-3 py-2 transition-colors focus-within:bg-primary/[0.04] md:items-center ${GRID}`}
            >
              <div className="col-span-2 flex items-center justify-between md:col-span-1 md:block">
                <span className="text-xs font-semibold tabular-nums text-gray-400">{i + 1}</span>
                {r.vr_no != null && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 md:hidden">SI {r.vr_no}</span>
                )}
              </div>

              <div className="col-span-2 min-w-0 md:col-span-1">
                <MobileLabel>Service</MobileLabel>
                <Select
                  {...selectCommon}
                  inputId={cellId(i, 0)}
                  isDisabled={!editable}
                  options={serviceOptions}
                  value={serviceOf(r.service_id)}
                  placeholder="Type a service…"
                  onChange={(opt) => pickService(i, opt)}
                  onKeyDown={(e) => onCellKeyDown(e, i, 0, { isSelect: true })}
                />
                {r.vr_no != null && (
                  <span className="mt-0.5 hidden text-[10px] text-gray-400 md:block">on Service Invoice {r.vr_no}</span>
                )}
              </div>

              <div className="col-span-2 min-w-0 md:col-span-1">
                <MobileLabel>Vendor (bill to)</MobileLabel>
                <Select
                  {...selectCommon}
                  inputId={cellId(i, 1)}
                  isDisabled={!editable}
                  options={vendorOptions}
                  value={vendorOf(r.pycd)}
                  placeholder="Vendor / transporter…"
                  onChange={(opt) => {
                    patchRow(i, { pycd: opt?.value ?? null, vendor: opt?.label?.replace(/^\d+\s-\s/, "") ?? "" });
                    pendingFocus.current = [i, 2];
                  }}
                  onKeyDown={(e) => onCellKeyDown(e, i, 1, { isSelect: true })}
                />
              </div>

              <div className="min-w-0">
                <MobileLabel>Vendor Inv #</MobileLabel>
                <input
                  id={cellId(i, 2)}
                  className={inputCls}
                  disabled={!editable}
                  value={r.invoice_no ?? ""}
                  placeholder="later"
                  maxLength={150}
                  onChange={(e) => patchRow(i, { invoice_no: e.target.value })}
                  onKeyDown={(e) => onCellKeyDown(e, i, 2)}
                />
              </div>

              <div className="min-w-0">
                <MobileLabel>Qty</MobileLabel>
                <input
                  id={cellId(i, 3)}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className={numCls}
                  disabled={!editable}
                  value={r.qty ?? ""}
                  onChange={(e) => patchRow(i, { qty: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => onCellKeyDown(e, i, 3)}
                />
              </div>

              <div className="min-w-0">
                <MobileLabel>Rate</MobileLabel>
                <input
                  id={cellId(i, 4)}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className={numCls}
                  disabled={!editable}
                  value={r.rate ?? ""}
                  placeholder="0.00"
                  onChange={(e) => patchRow(i, { rate: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => onCellKeyDown(e, i, 4)}
                />
              </div>

              <div className="min-w-0">
                <MobileLabel>ST %</MobileLabel>
                <input
                  id={cellId(i, 5)}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className={numCls}
                  disabled={!editable}
                  value={r.st_rate ?? ""}
                  placeholder="0"
                  onChange={(e) => patchRow(i, { st_rate: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => onCellKeyDown(e, i, 5)}
                />
              </div>

              <div className="min-w-0 text-right">
                <MobileLabel>Amount</MobileLabel>
                <div className="flex h-[34px] flex-col items-end justify-center">
                  <span className="text-sm font-semibold tabular-nums text-gray-900">{fmt(amounts.total)}</span>
                  {amounts.tax > 0 && (
                    <span className="text-[10px] tabular-nums text-gray-400">incl. ST {fmt(amounts.tax)}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end md:justify-center">
                {canRemoveRow(r) ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => removeRow(i)}
                    className="rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    title="Remove (Ctrl+Delete)"
                    aria-label={`Remove service row ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <Lock className="h-3.5 w-3.5 text-gray-300" aria-label="Locked" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {list.length === 0 && (
        <div className="px-4 py-5 text-center text-sm text-gray-500">
          No services on this {docLabel ? docLabel.split(" ")[0] : "document"}.
          {canAdd && (
            <>
              {" "}Press <KeyCombo combo="Alt+V" /> or{" "}
              <button type="button" onClick={() => addRow()} className="font-medium text-primary underline-offset-2 hover:underline">
                add a service
              </button>
              .
            </>
          )}
        </div>
      )}

      {list.some((r) => r.auto && !rateTyped(r.rate)) && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Service and vendor are filled in from your usual dispatches — just enter the amount (Rate). Leave it blank if
          there is no freight; change the vendor if another one carried it.
        </div>
      )}

      {/* Footer: add + totals */}
      <div className="flex flex-col gap-2 border-t bg-gray-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {canAdd && (
            <button
              type="button"
              onClick={() => addRow()}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-gray-500 hover:text-gray-900"
            >
              <Plus className="h-3.5 w-3.5" /> Add service
              <span className="hidden sm:inline"><KeyCombo combo="Ctrl+Enter" /></span>
            </button>
          )}
          <span className="hidden text-[11px] text-gray-400 lg:inline">
            Enter = next cell · Ctrl+Delete = remove row · vendor &amp; rate fill from the last bill · rate 0 = party&apos;s own service (reference only)
          </span>
        </div>
        {totals.total > 0 && (
          <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>
              → {totals.invoices} service invoice{totals.invoices === 1 ? "" : "s"}
            </span>
            {totals.tax > 0 && (
              <span>
                ST <span className="font-medium tabular-nums text-gray-700">{fmt(totals.tax)}</span>
              </span>
            )}
            <span>
              Total <span className="text-sm font-bold tabular-nums text-gray-900">{fmt(totals.total)}</span>
            </span>
          </div>
        )}
      </div>

      {/* Invoices this panel does not edit */}
      {meta.readOnly.length > 0 && (
        <div className="border-t px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Also billed for this document — change on the Service Invoice screen
          </p>
          <div className="flex flex-wrap gap-1.5">
            {meta.readOnly.map((inv) => (
              <span
                key={inv.tran_id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-gray-50 py-0.5 pl-2 pr-1 text-xs text-gray-700"
              >
                <span className="truncate">
                  SI {inv.vr_no ?? inv.tran_id} · {inv.vendor}
                  {inv.services ? ` · ${inv.services}` : ""} · <span className="tabular-nums">{fmt(inv.total)}</span>
                </span>
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
                    inv.reason === "Paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {inv.reason === "Paid" ? "Paid" : "Shared"}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default DocumentServicesPanel;
