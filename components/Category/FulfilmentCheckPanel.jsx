"use client";

// Fulfilment check for Dispatch and Transfer forms, shown inside the lines table:
//   • FulfilmentSummaryBar — one slim bar on top of the lines
//   • FulfilmentLineStrip  — a thin info strip under each line
// Per item: the parent document's balance (sale order or requisition), the qty
// in this voucher, and warehouse stock before / after it. Read-only.
// Settings → Features "dispatch.fulfilmentPanel" (ported from Accounting); the
// dispatch band is "dispatch.overDispatchTolerance" (config.tolerance). Stock
// comes from /api/voucher/check-stock (posted − held by pending approvals).

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  PackageCheck, ArrowRightLeft, Warehouse, ClipboardList, AlertTriangle,
  CheckCircle2, Loader2, XCircle, ArrowRight,
} from "lucide-react";

const MODES = {
  dispatch: {
    title: "Dispatch check", Icon: PackageCheck,
    parentField: "so_no", progressType: "saleOrder",
    parentName: "SO", parentLong: "sale order",
    ordered: "Ordered", moved: "Dispatched", thisLabel: "This dispatch",
    ready: "Ready to dispatch",
    tolerance: 0.10, // replaced by config.tolerance (Settings → Features "dispatch.overDispatchTolerance")
  },
  transfer: {
    title: "Transfer check", Icon: ArrowRightLeft,
    parentField: "req_no", progressType: "requisition",
    parentName: "Req", parentLong: "requisition",
    ordered: "Requested", moved: "Transferred", thisLabel: "This transfer",
    ready: "Ready to transfer",
    tolerance: null, // over-balance is a warning only
    toField: "godown2",
  },
};

const num = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v) => (v && typeof v === "object" ? v.value : v);
const fmt = (v) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 }).format(Number(v) || 0);

const TONE = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  bad: "bg-rose-50 text-rose-700 ring-rose-200",
  muted: "bg-slate-100 text-slate-500 ring-slate-200",
};

function statusInfo(status, cfg) {
  switch (status) {
    case "ok": return { label: "Ready", tone: "ok", Icon: CheckCircle2 };
    case "over": return {
      label: cfg.tolerance ? `Over ${cfg.parentName} (within ${Math.round(cfg.tolerance * 100)}%)` : `Over ${cfg.parentLong}`,
      tone: "warn", Icon: AlertTriangle,
    };
    case "exceeds": return { label: `Exceeds ${cfg.parentName} +${Math.round((cfg.tolerance || 0) * 100)}%`, tone: "bad", Icon: XCircle };
    case "short": return { label: "Stock short", tone: "bad", Icon: XCircle };
    case "notOnParent": return { label: `Not on ${cfg.parentName}`, tone: "warn", Icon: AlertTriangle };
    default: return { label: "No qty", tone: "muted", Icon: ClipboardList };
  }
}

function Chip({ tone, Icon, children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${TONE[tone]} ${className}`}>
      {Icon && <Icon className="h-3 w-3" />}{children}
    </span>
  );
}

// Debounced stock lookup for one warehouse → { [itcd]: qty }
function useStock(godown, itemKey) {
  const [stock, setStock] = useState({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!godown || !itemKey) { setStock({}); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      axios.post("/api/voucher/check-stock", { productIds: itemKey.split(",").map(Number), godown: Number(godown) })
        .then((r) => { if (!cancelled) setStock(r.data || {}); })
        .catch(() => { if (!cancelled) setStock({}); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [godown, itemKey]);
  return [stock, loading];
}

/**
 * Data for the summary bar and line strips.
 * @param {{mode: "dispatch"|"transfer", progressType?: string} | null} config  null = disabled
 * @param {boolean} isEdit  editing a saved voucher — its own saved qty is backed out
 */
export function useFulfilmentCheck({ config, masterData, lines, isEdit }) {
  const enabled = !!config;
  const base = MODES[config?.mode || "dispatch"];
  const cfg = useMemo(
    () => (base.tolerance != null && Number.isFinite(config?.tolerance) ? { ...base, tolerance: config.tolerance } : base),
    [base, config?.tolerance],
  );

  const parentId = enabled ? idOf(masterData?.[cfg.parentField]) : null;
  const fromGodown = enabled ? idOf(masterData?.godown) : null;
  const toGodown = enabled && cfg.toField ? idOf(masterData?.[cfg.toField]) : null;

  // Qty per item in this voucher (an item can be on several lines)
  const thisVoucher = useMemo(() => {
    const map = new Map();
    if (!enabled) return map;
    for (const l of lines || []) {
      const itcd = Number(idOf(l?.itcd));
      if (!itcd) continue;
      const cur = map.get(itcd) || { itcd, qty: 0, lineCount: 0 };
      cur.qty += num(l.qty);
      cur.lineCount += 1;
      map.set(itcd, cur);
    }
    return map;
  }, [enabled, lines]);
  const itemKey = [...thisVoucher.keys()].sort((a, b) => a - b).join(",");

  // Editing: the saved voucher is already inside "moved" and the stock figures.
  // Remember its qty once (first lines loaded) to back it out.
  const originalRef = useRef(null);
  useEffect(() => {
    if (isEdit && originalRef.current == null && thisVoucher.size > 0) {
      originalRef.current = new Map([...thisVoucher].map(([k, v]) => [k, v.qty]));
    }
  }, [isEdit, thisVoucher]);

  const apiType = config?.progressType || cfg.progressType;
  const [parent, setParent] = useState(null);
  const [parentLoading, setParentLoading] = useState(false);
  useEffect(() => {
    if (!parentId) { setParent(null); return; }
    let cancelled = false;
    setParentLoading(true);
    axios.get(`/api/orders/fulfillment-progress?type=${apiType}&id=${parentId}`)
      .then((r) => { if (!cancelled) setParent(r.data); })
      .catch(() => { if (!cancelled) setParent(null); })
      .finally(() => { if (!cancelled) setParentLoading(false); });
    return () => { cancelled = true; };
  }, [parentId, apiType]);

  const [fromStock, fromLoading] = useStock(fromGodown, itemKey);
  const [toStock, toLoading] = useStock(toGodown, itemKey);

  const byItem = useMemo(() => {
    const out = new Map();
    if (!enabled) return out;
    const parentByItem = new Map();
    for (const i of parent?.items || []) {
      const cur = parentByItem.get(i.itcd) || { ordered: 0, moved: 0 };
      cur.ordered += Number(i.orderedQty) || 0;
      cur.moved += Number(i.fulfilledQty) || 0;
      parentByItem.set(i.itcd, cur);
    }
    for (const it of thisVoucher.values()) {
      const p = parentByItem.get(it.itcd);
      const o = isEdit ? originalRef.current?.get(it.itcd) || 0 : 0;
      const ordered = p?.ordered ?? 0;
      const movedBefore = p ? p.moved - o : 0;
      const balance = ordered - movedBefore;
      const balanceAfter = balance - it.qty;
      const available = fromStock[it.itcd] != null ? Number(fromStock[it.itcd]) + o : null;
      const fromAfter = available != null ? available - it.qty : null;
      const toNow = toStock[it.itcd] != null ? Number(toStock[it.itcd]) - o : null;
      const toAfter = toNow != null ? toNow + it.qty : null;

      let status = "ok";
      if (it.qty <= 0) status = "idle";
      else if (fromAfter != null && fromAfter < 0) status = "short";
      else if (parentId && parent && !p) status = "notOnParent";
      else if (p && cfg.tolerance != null && movedBefore + it.qty > ordered * (1 + cfg.tolerance)) status = "exceeds";
      else if (p && balanceAfter < 0) status = "over";

      out.set(it.itcd, {
        ...it, onParent: !!p, ordered, movedBefore, balance, balanceAfter,
        available, fromAfter, toNow, toAfter, status,
      });
    }
    return out;
  }, [enabled, thisVoucher, parent, fromStock, toStock, parentId, isEdit, cfg]);

  const rows = [...byItem.values()];
  const blocking = rows.filter((r) => r.status === "short" || r.status === "exceeds").length;
  const warnings = rows.filter((r) => r.status === "over" || r.status === "notOnParent").length;
  const totals = rows.reduce((t, r) => ({
    ordered: t.ordered + r.ordered, before: t.before + r.movedBefore, now: t.now + r.qty,
  }), { ordered: 0, before: 0, now: 0 });

  return {
    enabled: enabled && rows.length > 0,
    cfg, byItem, rows, blocking, warnings, totals, parentId,
    fromGodown, fromLabel: masterData?.godown?.label,
    toGodown, toLabel: cfg.toField ? masterData?.[cfg.toField]?.label : null,
    loading: parentLoading || fromLoading || toLoading,
  };
}

// ── Slim bar on top of the lines ───────────────────────────────────────────
export function FulfilmentSummaryBar({ check }) {
  if (!check?.enabled) return null;
  const { cfg, blocking, warnings, totals, parentId, fromGodown, fromLabel, toGodown, toLabel, loading } = check;
  const overall = blocking
    ? { tone: "bad", Icon: XCircle, text: `${blocking} item${blocking > 1 ? "s" : ""} can't go as entered` }
    : warnings
      ? { tone: "warn", Icon: AlertTriangle, text: `${warnings} item${warnings > 1 ? "s" : ""} need a look` }
      : { tone: "ok", Icon: CheckCircle2, text: cfg.ready };
  const leftAfter = Math.max(0, totals.ordered - totals.before - totals.now);

  const Stat = ({ label, value, strong }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`tabular-nums text-xs font-semibold ${strong ? "text-primary" : "text-slate-800"}`}>{fmt(value)}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <cfg.Icon className="h-4 w-4 text-primary" />{cfg.title}
        </span>
        {parentId && (
          <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
            <ClipboardList className="h-3 w-3" />{cfg.parentName} #{parentId}
          </span>
        )}
        {fromGodown && (
          <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
            <Warehouse className="h-3 w-3" />{fromLabel || `Warehouse ${fromGodown}`}
            {toGodown && <><ArrowRight className="h-3 w-3" />{toLabel || `Warehouse ${toGodown}`}</>}
          </span>
        )}
        {parentId && totals.ordered > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-slate-200 sm:border-l sm:pl-3">
            <Stat label={cfg.ordered} value={totals.ordered} />
            <Stat label={`${cfg.moved} before`} value={totals.before} />
            <Stat label={cfg.thisLabel} value={totals.now} strong />
            <Stat label="Left after" value={leftAfter} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        <Chip tone={overall.tone} Icon={overall.Icon} className="px-2.5 py-1 text-xs">{overall.text}</Chip>
      </div>
    </div>
  );
}

// ── Thin strip under one line ──────────────────────────────────────────────
export function FulfilmentLineStrip({ check, itcd }) {
  const r = check?.byItem?.get(Number(itcd));
  if (!r) return null;
  const { cfg, fromGodown, toGodown } = check;
  const s = statusInfo(r.status, cfg);
  const pBefore = r.ordered ? Math.min(100, (Math.max(r.movedBefore, 0) / r.ordered) * 100) : 0;
  const pNow = r.ordered ? Math.min(100 - pBefore, (Math.max(r.qty, 0) / r.ordered) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
      <Chip tone={s.tone} Icon={s.Icon}>{s.label}</Chip>

      {r.onParent ? (
        <span className="inline-flex items-center gap-2">
          <span className="text-slate-500">{cfg.parentName} balance</span>
          <b className="tabular-nums text-slate-800">{fmt(r.balance)}</b>
          <span className="text-slate-400">of {fmt(r.ordered)}</span>
          <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 sm:flex">
            <span className="h-full bg-slate-400" style={{ width: `${pBefore}%` }} />
            <span className="h-full bg-primary" style={{ width: `${pNow}%` }} />
          </span>
          <span className={r.balanceAfter < 0 ? "font-semibold text-amber-600" : "text-slate-500"}>
            {r.balanceAfter < 0 ? `${fmt(-r.balanceAfter)} over` : `${fmt(r.balanceAfter)} left after`}
          </span>
        </span>
      ) : check.parentId ? (
        <span className="text-slate-400">Not on this {cfg.parentLong}</span>
      ) : null}

      <span className="inline-flex items-center gap-1.5">
        <Warehouse className="h-3 w-3 text-slate-400" />
        {r.available == null ? (
          <span className="text-slate-400">{fromGodown ? "Checking stock…" : "Select warehouse for stock"}</span>
        ) : (
          <>
            <span className="text-slate-500">{toGodown ? "From" : "Stock"}</span>
            <b className="tabular-nums text-slate-800">{fmt(r.available)}</b>
            <ArrowRight className="h-3 w-3 text-slate-400" />
            <b className={`tabular-nums ${r.fromAfter < 0 ? "text-rose-600" : "text-slate-800"}`}>
              {r.fromAfter < 0 ? `Short ${fmt(-r.fromAfter)}` : fmt(r.fromAfter)}
            </b>
          </>
        )}
      </span>

      {toGodown && r.toNow != null && (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-slate-500">To</span>
          <b className="tabular-nums text-slate-800">{fmt(r.toNow)}</b>
          <ArrowRight className="h-3 w-3 text-slate-400" />
          <b className="tabular-nums text-emerald-700">{fmt(r.toAfter)}</b>
        </span>
      )}

      {r.lineCount > 1 && <span className="text-slate-400">· item total across {r.lineCount} lines</span>}
    </div>
  );
}
