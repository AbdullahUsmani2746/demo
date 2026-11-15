"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import Link from "next/link";
import {
  Search, RefreshCw, ArrowLeft, Loader2, Package, BarChart3,
  Factory, ClipboardList, TrendingUp, TrendingDown, ChevronDown,
  ChevronRight, Calculator, Layers, Scale, Wrench,
  Minus, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LabHeader, LabStat, Chip, CODE_CHIP, CHIP, TH } from "@/components/Material/shared/LabUI";
import { CostingFrame, PeriodPicker, IconBtn, MONTHS } from "@/components/Costing/CostingUI";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductionSetup } from "@/hooks/useProductionSetup";
import { isFinishedCategory, isSemiFinishedCategory, isRawMaterialCategory } from "@/lib/production/setupConfig";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const CY = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CY - i);

// ─────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────
const N  = (v) => Number(v) || 0;
const fmt    = (v) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(N(v));
const fmtQ   = (v) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(N(v));
const fmtPct = (v) => `${N(v).toFixed(1)}%`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

// ─────────────────────────────────────────────────────────────
// Item category labels + icon
// ─────────────────────────────────────────────────────────────
// The kind of an item category = Settings → Production setup
const IC_KINDS = {
  finished: { label: "Finished Good", icon: Factory, tone: "brand" },
  semi:     { label: "Semi-Finished", icon: Layers,  tone: "warn" },
  raw:      { label: "Raw Material",  icon: Package, tone: "muted" },
};
const icKind = (setup, icId) =>
  isFinishedCategory(setup, icId) ? IC_KINDS.finished
    : isSemiFinishedCategory(setup, icId) ? IC_KINDS.semi
      : isRawMaterialCategory(setup, icId) ? IC_KINDS.raw
        : null;

// Table cell paddings (first / middle / last column).
const C0 = "py-1.5 pl-4 pr-2";
const CM = "px-2 py-1.5 text-right tabular-nums";
const CL = "py-1.5 pl-2 pr-4 text-right tabular-nums";

// ─────────────────────────────────────────────────────────────
// Panel shell — tinted header + scrollable body
// ─────────────────────────────────────────────────────────────
function Panel({ icon: Icon, title, badge, children }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-[15px] font-semibold text-primary">{title}</span>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      <div className="max-h-[70vh] min-h-0 flex-1 overflow-auto">
        {children}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Table primitives
// ─────────────────────────────────────────────────────────────
function THead({ cols }) {
  return (
    <thead>
      <tr>
        {cols.map((c, i) => (
          <th key={i}
              className={cn(TH, "py-2 text-[11px]",
                            c.right && "text-right",
                            i === 0 ? "pl-4 pr-2" : i === cols.length - 1 ? "pl-2 pr-4" : "px-2")}>
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

// ─────────────────────────────────────────────────────────────
// Section divider row inside a table
// ─────────────────────────────────────────────────────────────
function SectionDivider({ label, colSpan = 4 }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-widest text-primary">{label}</span>
          <div className="h-px flex-1 bg-primary/15" />
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
// Generic ledger row
// ─────────────────────────────────────────────────────────────
function LRow({ label, sub, date, qty, rate, amount, indent = false, variant = "normal", colSpan4 }) {
  const base  = "text-[12px] transition-colors";
  const vars  = {
    normal:   "hover:bg-muted/40 text-foreground",
    opening:  "bg-muted/60 font-semibold text-foreground",
    total:    "bg-muted/50 font-semibold text-foreground border-t border-border",
    subtotal: "bg-muted/30 font-semibold text-foreground",
    deduct:   "hover:bg-muted/40 text-red-700 dark:text-red-300",
    cc:       CHIP.warn,
  };

  if (colSpan4) {
    return (
      <tr className={cn(base, vars[variant] || vars.normal)}>
        <td colSpan={4} className="px-4 py-1.5">{colSpan4}</td>
      </tr>
    );
  }

  return (
    <tr className={cn(base, vars[variant] || vars.normal)}>
      <td className={cn("py-1.5 pr-2 text-left align-top", indent ? "pl-8" : "pl-4")}>
        <div className="flex flex-col leading-snug">
          <span>{label}</span>
          {sub  && <span className="mt-0.5 text-[10.5px] font-normal text-muted-foreground">{sub}</span>}
          {date && <span className="text-[10.5px] font-normal text-muted-foreground">{date}</span>}
        </div>
      </td>
      <td className={CM}>{qty  != null ? fmtQ(qty)  : "—"}</td>
      <td className={CM}>{rate != null ? fmt(rate) : "—"}</td>
      <td className={CL}>{amount != null ? fmt(amount) : "—"}</td>
    </tr>
  );
}

function EmptyTRow({ colSpan = 4, msg = "None this period" }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-2 pl-8 text-[11px] italic text-muted-foreground">{msg}</td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
// Blended / Closing special rows (full-width accent)
// ─────────────────────────────────────────────────────────────
function BlendedRow({ qty, rate, value }) {
  return (
    <tr className="border-y-2 border-primary/40 bg-primary/10 text-[12px] font-bold text-primary">
      <td className="py-2 pl-4 pr-2 tracking-wide">BLENDED RATE</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtQ(qty)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmt(rate)}</td>
      <td className="py-2 pl-2 pr-4 text-right tabular-nums">{fmt(value)}</td>
    </tr>
  );
}

function ClosingRow({ qty, rate, value }) {
  return (
    <tr className={cn("border-t-2 border-primary text-[12px] font-bold", CHIP.ok)}>
      <td className="py-2 pl-4 pr-2 tracking-wide">CLOSING BALANCE</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtQ(qty)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmt(rate)}</td>
      <td className="py-2 pl-2 pr-4 text-right tabular-nums">{fmt(value)}</td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
// Production receipt row — main row + CC sub-row
// ─────────────────────────────────────────────────────────────
function ProdReceiptRow({ r }) {
  const hasCC = N(r.cc_amt) > 0;
  return (
    <>
      {/* Main row: Qty | RM Rate | RM Amount */}
      <tr className="text-[12px] text-foreground transition-colors hover:bg-muted/40">
        <td className="py-1.5 pl-8 pr-2 align-top">
          <div className="flex flex-col leading-snug">
            <span className="font-semibold">PO# {r.proc_ord_no || r.ref || "—"}</span>
            <span className="text-[10.5px] text-muted-foreground">{fmtDate(r.date)}</span>
          </div>
        </td>
        <td className={CM}>{fmtQ(r.qty)}</td>
        <td className={CM}>{N(r.rm_rate) > 0 ? fmt(r.rm_rate) : "—"}</td>
        <td className={cn(CL, "font-semibold")}>{fmt(r.rm_amt)}</td>
      </tr>
      {hasCC && (
        <tr className={cn("text-[11px]", CHIP.warn)}>
          <td className="py-1 pl-11 pr-2 italic">↳ CC Overhead</td>
          <td className="px-2 py-1 text-right tabular-nums">{fmtQ(r.qty)}</td>
          <td className="px-2 py-1 text-right tabular-nums">{fmt(r.cc_rate)}</td>
          <td className="py-1 pl-2 pr-4 text-right font-semibold tabular-nums">{fmt(r.cc_amt)}</td>
        </tr>
      )}
      {hasCC && (
        <tr className="border-b border-border bg-muted/50 text-[11px] font-semibold text-foreground">
          <td className="py-1 pl-11 pr-2">↳ Total (RM + CC)</td>
          <td className="px-2 py-1 text-right tabular-nums">{fmtQ(r.qty)}</td>
          <td className="px-2 py-1 text-right tabular-nums">{fmt(r.rate)}</td>
          <td className="py-1 pl-2 pr-4 text-right font-bold tabular-nums">{fmt(r.amount)}</td>
        </tr>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Dispatch row — sale rate + blended cost rate sub-row
// ─────────────────────────────────────────────────────────────
function DispatchRow({ r }) {
  return (
    <>
      <tr className="text-[12px] text-foreground transition-colors hover:bg-muted/40">
        <td className="py-1.5 pl-8 pr-2 align-top">
          <div className="flex flex-col leading-snug">
            <span className="font-semibold">{r.ref || "Dispatch"}</span>
            <span className="text-[10.5px] text-muted-foreground">{fmtDate(r.date)}</span>
          </div>
        </td>
        <td className={CM}>{fmtQ(r.qty)}</td>
        <td className={CM}>{fmt(r.sale_rate)}</td>
        <td className={cn(CL, "font-semibold")}>{fmt(r.sale_amt)}</td>
      </tr>
      <tr className="border-b border-border bg-primary/5 text-[11px] text-primary">
        <td className="py-1 pl-11 pr-2 italic">↳ Cost @ blended rate</td>
        <td className="px-2 py-1 text-right tabular-nums">{fmtQ(r.qty)}</td>
        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.cost_rate)}</td>
        <td className="py-1 pl-2 pr-4 text-right font-semibold tabular-nums">{fmt(r.cost_amt)}</td>
      </tr>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Costing Details Panel
// ─────────────────────────────────────────────────────────────
function CostingPanel({ data }) {
  if (!data) return null;
  const { opening, purchases, purchase_total, purchase_returns, purchase_return_total,
          productions, production_total, blended, issuances, issuance_total,
          dispatches, dispatch_total, closing } = data;

  const cols = [
    { label: "Description" },
    { label: "Qty",    right: true },
    { label: "Rate",   right: true },
    { label: "Amount", right: true },
  ];

  const dispCostTotal = dispatches.reduce((s, r) => s + N(r.cost_amt), 0);

  return (
    <Panel icon={BarChart3} title="Costing Details" badge={<Chip tone="muted">Period flow</Chip>}>
      <table className="w-full min-w-[440px] border-collapse">
        <THead cols={cols} />
        <tbody>

          {/* Opening */}
          <LRow label="Opening Balance" qty={opening.qty} rate={opening.rate} amount={opening.value} variant="opening" />
          {N(opening.cc_cost) > 0 && (
            <LRow label="↳ CC Overhead (opening)" qty={opening.qty} rate={opening.cc_rate} amount={opening.cc_cost} indent variant="cc" />
          )}

          {/* Purchases */}
          <SectionDivider label="Purchases" />
          {purchases.length === 0 ? <EmptyTRow msg="No purchases" /> :
            purchases.map((r, i) => (
              <LRow key={i} label={r.ref || "Purchase"} date={fmtDate(r.date)}
                    qty={r.qty} rate={r.rate} amount={r.amount} indent />
            ))}
          <LRow label="Purchase Total" qty={purchase_total.qty} amount={purchase_total.amount} variant="total" />

          {/* Purchase Returns */}
          <SectionDivider label="Purchase Returns (−)" />
          {purchase_returns.length === 0 ? <EmptyTRow msg="No returns" /> :
            purchase_returns.map((r, i) => (
              <LRow key={i} label={r.ref || "Return"} date={fmtDate(r.date)}
                    qty={r.qty} rate={r.rate} amount={r.amount} indent variant="deduct" />
            ))}
          <tr className="border-t border-border bg-muted/50 text-[12px] font-semibold text-red-700 dark:text-red-300">
            <td className={C0}>Return Total (deducted)</td>
            <td className={CM}>({fmtQ(purchase_return_total.qty)})</td>
            <td className={CM}>—</td>
            <td className={CL}>({fmt(purchase_return_total.amount)})</td>
          </tr>

          {/* Production Receipts */}
          <SectionDivider label="Production Receipts" />
          {productions.length === 0 ? <EmptyTRow msg="No production receipts" /> :
            productions.map((r, i) => <ProdReceiptRow key={i} r={r} />)}
          <tr className="border-t border-border bg-muted/50 text-[12px] font-semibold text-foreground">
            <td className={C0}>Production Total</td>
            <td className={CM}>{fmtQ(production_total.qty)}</td>
            <td className={CM}>—</td>
            <td className={CL}>{fmt(production_total.amount)}</td>
          </tr>
          {N(production_total.cc_cost) > 0 && (
            <tr className={cn("text-[11px]", CHIP.warn)}>
              <td className="py-1 pl-4 pr-2 italic" colSpan={3}>↳ incl. CC Overhead (period)</td>
              <td className="py-1 pl-2 pr-4 text-right font-semibold tabular-nums">{fmt(production_total.cc_cost)}</td>
            </tr>
          )}

          {/* Blended */}
          <BlendedRow qty={blended.qty} rate={blended.rate} value={blended.value} />

          {/* Issuances */}
          <SectionDivider label="Issuances (T7)" />
          {issuances.length === 0 ? <EmptyTRow msg="No issuances" /> :
            issuances.map((r, i) => (
              <LRow key={i}
                    label={r.item_name || "Issuance"}
                    sub={[r.item_itcd ? `ITCD ${r.item_itcd}` : "", r.proc_ord_no ? `PO# ${r.proc_ord_no}` : ""].filter(Boolean).join(" · ")}
                    date={fmtDate(r.date)}
                    qty={r.qty} rate={r.rate} amount={r.amount} indent />
            ))}
          <LRow label="Issuance Total" qty={issuance_total.qty} amount={issuance_total.amount} variant="total" />

          {/* Dispatches */}
          <SectionDivider label="Dispatches / Sales" />
          {dispatches.length === 0 ? <EmptyTRow msg="No dispatches" /> :
            dispatches.map((r, i) => <DispatchRow key={i} r={r} />)}
          {/* Dispatch total: sale total + cost total */}
          <tr className="border-t border-border bg-muted/50 text-[12px] font-semibold text-foreground">
            <td className="py-2 pl-4 pr-2">Dispatch Total (Sale)</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmtQ(dispatch_total.qty)}</td>
            <td className="px-2 py-2 text-right">—</td>
            <td className="py-2 pl-2 pr-4 text-right tabular-nums">{fmt(dispatch_total.amount)}</td>
          </tr>
          <tr className="border-b-2 border-primary/30 bg-primary/5 text-[11px] font-semibold text-primary">
            <td className="py-1.5 pl-4 pr-2 italic" colSpan={3}>Dispatch Total (Cost @ blended)</td>
            <td className="py-1.5 pl-2 pr-4 text-right tabular-nums">{fmt(dispCostTotal)}</td>
          </tr>

          {/* Closing */}
          <ClosingRow qty={closing.qty} rate={closing.rate} value={closing.value} />
        </tbody>
      </table>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Production Details Panel
// ─────────────────────────────────────────────────────────────
function ProdDetailRow({ group }) {
  const [open, setOpen] = useState(false);
  const hasMat = group.materials.length > 0;
  const ccCost = N(group.cc_cost);

  return (
    <>
      <tr
        className={cn("border-b border-border text-[12px] transition-colors",
                      hasMat && "cursor-pointer",
                      open ? "bg-primary/[0.04]" : hasMat && "hover:bg-muted/40")}
        onClick={() => hasMat && setOpen(p => !p)}
      >
        <td className="py-2.5 pl-4 pr-2">
          <div className="flex items-center gap-2">
            <div className={cn("flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md",
                               hasMat ? (open ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground") : "text-muted-foreground/40")}>
              {hasMat
                ? open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                : <Minus className="h-3 w-3" />}
            </div>
            <div>
              <div className="font-semibold text-foreground">PO# {group.proc_ord_no}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
                {fmtDate(group.date)}
                {hasMat && <span>· {group.materials.length} mat.</span>}
                {group.item_type && <Chip tone="brand" className="px-1.5 py-0 text-[10px]">{group.item_type}</Chip>}
              </div>
            </div>
          </div>
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{fmtQ(group.total.qty)}</td>
        <td className="py-2.5 pl-2 pr-4 text-right font-semibold tabular-nums text-foreground">{fmt(group.total.amount)}</td>
      </tr>

      {open && hasMat && (
        <tr>
          <td colSpan={3} className="border-b border-border bg-muted/30 p-0">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pl-10 pr-2 text-left font-semibold">Material</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2 text-right font-semibold">Rate</th>
                  <th className="py-2 pl-2 pr-4 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {group.materials.map((m, i) => (
                  <tr key={i} className="border-b border-border/60 transition-colors hover:bg-background">
                    <td className="py-1.5 pl-10 pr-2">
                      <div className="font-medium leading-tight text-foreground">{m.material_name}</div>
                      {m.material_code && <span className={cn(CODE_CHIP, "text-[10px]")}>{m.material_code}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtQ(m.qty)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(m.rate)}</td>
                    <td className="py-1.5 pl-2 pr-4 text-right font-semibold tabular-nums">{fmt(m.amount)}</td>
                  </tr>
                ))}
                {/* CC row inside expanded materials */}
                {ccCost > 0 && (
                  <tr className={CHIP.warn}>
                    <td className="py-1.5 pl-10 pr-2 font-semibold italic">
                      CC Overhead
                      {N(group.cc_rate) > 0 && (
                        <span className="ml-1.5 text-[10px] font-normal">@ {fmt(group.cc_rate)}/unit</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtQ(group.total.qty)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(group.cc_rate)}</td>
                    <td className="py-1.5 pl-2 pr-4 text-right font-bold tabular-nums">{fmt(ccCost)}</td>
                  </tr>
                )}
                <tr className="border-t-2 border-primary bg-muted/50 text-[11px] font-semibold">
                  <td className="py-1.5 pl-10 pr-2" colSpan={3}>Total (incl. CC)</td>
                  <td className="py-1.5 pl-2 pr-4 text-right tabular-nums">{fmt(group.total.amount)}</td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function ProductionPanel({ data, grandTotal }) {
  if (!data) return null;
  return (
    <Panel icon={Factory} title="Production Details"
      badge={<Chip tone="brand">{data.length} order{data.length !== 1 ? "s" : ""}</Chip>}>
      <table className="w-full min-w-[360px] border-collapse">
        <THead cols={[
          { label: "Process Order" },
          { label: "Fin. Qty", right: true },
          { label: "Total Cost", right: true },
        ]} />
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={3} className="py-16 text-center">
              <Factory className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No production records</p>
            </td></tr>
          ) : data.map((g, i) => <ProdDetailRow key={i} group={g} />)}
        </tbody>
        {data.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-primary bg-muted/50 text-[12px] font-bold text-foreground">
              <td className="py-2.5 pl-4 pr-2">Grand Total</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{fmtQ(grandTotal.qty)}</td>
              <td className="py-2.5 pl-2 pr-4 text-right tabular-nums">{fmt(grandTotal.amount)}</td>
            </tr>
            {N(grandTotal.rate) > 0 && (
              <tr className="bg-muted/30 text-[11px] text-muted-foreground">
                <td className="py-1.5 pl-4 pr-2" colSpan={3}>
                  Weighted avg rate: <span className="font-semibold tabular-nums text-foreground">{fmt(grandTotal.rate)}</span>
                </td>
              </tr>
            )}
          </tfoot>
        )}
      </table>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// BOM Panel
// ─────────────────────────────────────────────────────────────
function BomPanel({ data }) {
  if (!data) return null;
  const totalCost = data.reduce((s, b) => s + N(b.cost), 0);
  return (
    <Panel icon={ClipboardList} title="Bill of Material"
      badge={<Chip tone="muted">{data.length} line{data.length !== 1 ? "s" : ""}</Chip>}>
      <table className="w-full min-w-[400px] border-collapse">
        <THead cols={[
          { label: "Material" },
          { label: "%",         right: true },
          { label: "Rate",      right: true },
          { label: "Cost/Unit", right: true },
        ]} />
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={4} className="py-16 text-center">
              <ClipboardList className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No active BOM (instructions = A)</p>
            </td></tr>
          ) : data.map((b, i) => (
            <tr key={i} className="border-b border-border text-[12px] transition-colors hover:bg-muted/40">
              <td className="py-2 pl-4 pr-2">
                <div className="font-semibold leading-tight text-foreground">{b.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  {b.code && <span className={cn(CODE_CHIP, "text-[10px]")}>{b.code}</span>}
                  <span>ITCD {b.itcd}{b.unit ? ` · ${b.unit}` : ""}</span>
                </div>
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{fmtPct(b.percentage)}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {N(b.rate) > 0 ? fmt(b.rate) : <span className="text-muted-foreground/60">—</span>}
              </td>
              <td className="py-2 pl-2 pr-4 text-right">
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums text-foreground">
                    {N(b.cost) > 0 ? fmt(b.cost) : <span className="font-normal text-muted-foreground/60">—</span>}
                  </span>
                  {N(b.share_pct) > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 w-14 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary"
                             style={{ width: `${Math.min(N(b.share_pct), 100)}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{fmtPct(b.share_pct)}</span>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        {data.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-primary bg-muted/50 text-[12px] font-bold text-foreground">
              <td className="py-2.5 pl-4 pr-2" colSpan={3}>Theoretical Cost / Unit</td>
              <td className="py-2.5 pl-2 pr-4 text-right tabular-nums">{fmt(totalCost)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// KPI Strip — 5 tiles
// ─────────────────────────────────────────────────────────────
function KpiStrip({ data, grandTotal }) {
  const cd = data.costing_details;
  const cc = data.cc_summary || {};
  const two = (a, b) => (b ? <>{a}<br />{b}</> : a);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <LabStat label="Opening Stock" icon={TrendingDown} tone="muted"
        value={fmt(cd.opening.value)}
        hint={`${fmtQ(cd.opening.qty)} × ${fmt(cd.opening.rate)}`} />

      <LabStat label="Blended Rate" icon={Scale}
        value={fmt(cd.blended.rate)}
        hint={two(`Pool: ${fmtQ(cd.blended.qty)} units`, `Value: ${fmt(cd.blended.value)}`)} />

      <LabStat label="Closing Stock" icon={TrendingUp} tone="ok"
        value={fmt(cd.closing.value)}
        hint={`${fmtQ(cd.closing.qty)} × ${fmt(cd.closing.rate)}`} />

      <LabStat label="Production Cost" icon={Factory}
        value={fmt(grandTotal.amount)}
        hint={two(`${data.production_details.length} process order(s)`,
                  N(grandTotal.rate) > 0 ? `Avg rate: ${fmt(grandTotal.rate)}` : undefined)} />

      <LabStat label="CC Overhead" icon={Wrench} tone="warn"
        value={fmt(N(cc.total_cc_cost))}
        hint={two(
          N(cc.opening_cc_cost) > 0 ? `Opening: ${fmt(cc.opening_cc_cost)} (${fmt(cc.opening_cc_rate)}/u)` : "Opening: —",
          N(cc.period_cc_cost) > 0 ? `Period: ${fmt(cc.period_cc_cost)} (${fmt(cc.period_cc_rate)}/u)` : "Period: —",
        )} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Empty / Loading
// ─────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-background px-6 py-14 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Calculator className="h-7 w-7 text-primary" />
      </span>
      <h3 className="text-base font-semibold text-foreground">Nothing loaded yet</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Search by <strong className="text-foreground">ITCD, code or item name</strong>, choose a month & year, then pick an item or press{" "}
        <kbd className="rounded border border-b-2 border-border px-1.5 font-mono text-[11px]">Enter</kbd>
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)}
      </div>
      <Skeleton className="h-9 rounded-lg" />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
      </div>
      <p className="text-center text-xs text-muted-foreground">Fetching period transactions…</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Item search (ITCD / code / name autocomplete)
// ─────────────────────────────────────────────────────────────
function ItemSearch({ inputRef, onSelect, onDirectItcd, disabled }) {
  const { setup } = useProductionSetup();
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [hi,      setHi]      = useState(-1);
  const [busy,    setBusy]    = useState(false);
  const wrapRef  = useRef(null);
  const timerRef = useRef(null);
  const reqRef   = useRef(0);
  const skipRef  = useRef(false);   // suppress lookup right after a pick

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // "/" focuses the item search (Ctrl+K is the header's menu search).
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputRef]);

  // Debounced lookup — /api/forms/items matches item name, code and itcd
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (skipRef.current) { skipRef.current = false; return; }
    const q = query.trim();
    if (!q) { setResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      const id = ++reqRef.current;
      setBusy(true);
      try {
        const res  = await fetch(`/api/forms/items?limit=20&search=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (id !== reqRef.current) return;             // stale response
        const items = (json.items || []).map(i => ({ itcd: i.itcd, item: i.item, code: i.code, unit: i.unit, ic_id: i.ic_id }));
        setResults(items); setHi(items.length ? 0 : -1); setOpen(true);
      } catch { if (id === reqRef.current) { setResults([]); setOpen(true); } }
      finally { if (id === reqRef.current) setBusy(false); }
    }, 250);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  const pick = (it) => {
    skipRef.current = true;
    setQuery(`${it.itcd} · ${it.code ? it.code + " · " : ""}${it.item || ""}`);
    setOpen(false); setResults([]);
    onSelect(it);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Escape") { setOpen(false); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (open && hi >= 0 && results[hi]) { pick(results[hi]); return; }
      const q = query.trim();
      if (/^\d+$/.test(q)) { setOpen(false); onDirectItcd(parseInt(q, 10)); }   // plain number → fetch by ITCD
      else if (results.length === 1) pick(results[0]);
      else toast.error("Pick an item from the list");
    }
  };

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 sm:max-w-md">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
        <Search className="h-4 w-4 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="ITCD, code or item name…"
          aria-label="Item"
          value={query}
          disabled={disabled}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : query ? (
          <button type="button" aria-label="Clear" onClick={() => { setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus(); }}
            className="hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
        )}
      </label>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg sm:right-auto sm:w-[28rem]">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">No items match “{query}”</div>
          ) : results.map((it, i) => (
            <button type="button" key={it.itcd}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(it)}
              className={cn("flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left transition-colors last:border-0",
                            i === hi ? "bg-primary/[0.07]" : "hover:bg-muted/50")}>
              <span className="w-14 flex-shrink-0 font-mono text-[11px] text-muted-foreground">{it.itcd}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{it.item || "—"}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {it.code ? <span className="font-mono">{it.code}</span> : null}
                  {it.code && it.unit ? " · " : ""}{it.unit || ""}
                </span>
              </span>
              <Chip tone={icKind(setup, it.ic_id)?.tone || "muted"} className="flex-shrink-0 px-1.5 text-[10px]">
                {icKind(setup, it.ic_id)?.label || `ic ${it.ic_id}`}
              </Chip>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function CostingCheckingPage() {
  const { setup } = useProductionSetup();
  const now = new Date();
  const [itcd,    setItcd]    = useState("");
  const [month,   setMonth]   = useState(String(now.getMonth() + 1));
  const [year,    setYear]    = useState(String(now.getFullYear()));
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState(null);
  const itcdRef = useRef(null);

  useEffect(() => { itcdRef.current?.focus(); }, []);

  const fetchData = useCallback(async (forcedId) => {
    const id = parseInt(typeof forcedId === "number" ? forcedId : itcd, 10);
    if (!id || id <= 0) { toast.error("Select an item first"); return; }
    setLoading(true); setData(null);
    try {
      const res  = await fetch(`/api/costing/checking?itcd=${id}&month=${parseInt(month)}&year=${parseInt(year)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      setData(json);
      toast.success(`Loaded: ${json.item?.item || `Item ${id}`}`);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [itcd, month, year]);

  const ic_id  = data?.item?.ic_id;
  const ItemIcon = icKind(setup, ic_id)?.icon || Factory;

  return (
    <CostingFrame>
      <LabHeader
        icon={BarChart3}
        breadcrumb="Costing"
        title="Costing Checker"
        subtitle="Period cost verification — opening, purchases, production, issuances, dispatches and closing for one item"
        actions={
          <Link href="/accounting/costing" className="max-sm:!flex-none">
            <IconBtn icon={ArrowLeft} label="Back to Costing" />
          </Link>
        }
      />

      {/* ── Item + period toolbar ── */}
      <section className="rounded-xl border border-border bg-background">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <ItemSearch
            inputRef={itcdRef}
            disabled={loading}
            onSelect={(it) => { setItcd(String(it.itcd)); fetchData(it.itcd); }}
            onDirectItcd={(id) => { setItcd(String(id)); fetchData(id); }}
          />
          <PeriodPicker month={month} year={year} years={YEARS} onMonth={setMonth} onYear={setYear} asString />
          <Button size="sm" className="h-9" onClick={() => fetchData()} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            {loading ? "Loading…" : "Fetch"}
          </Button>
          {data && !loading && (
            <IconBtn icon={RefreshCw} label="Refresh" onClick={() => fetchData()} />
          )}
        </div>

        {/* Loaded item + period line */}
        {data && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ItemIcon className="h-4 w-4 text-primary" />
              {data.item.item}
            </span>
            <Chip tone={icKind(setup, ic_id)?.tone || "muted"}>{icKind(setup, ic_id)?.label || `ic_id=${ic_id}`}</Chip>
            {data.item.unit && <Chip tone="muted">{data.item.unit}</Chip>}
            <span className="font-semibold text-foreground">{MONTHS[parseInt(month)-1]} {year}</span>
            <span>ITCD <strong className="tabular-nums text-foreground">{data.item.itcd}</strong></span>
            {data.item.code && <span className={CODE_CHIP}>{data.item.code}</span>}
            <span>Opening <strong className="tabular-nums text-foreground">{fmtQ(data.costing_details.opening.qty)}</strong></span>
            <span>→ Closing <strong className="tabular-nums text-foreground">{fmtQ(data.costing_details.closing.qty)}</strong></span>
            {data.bom_master_id && <Chip tone="brand">BOM #{data.bom_master_id}</Chip>}
          </div>
        )}
      </section>

      {!data && !loading && <EmptyState />}
      {loading && <LoadingState />}

      {data && (
        <>
          <KpiStrip data={data} grandTotal={data.grand_total} />

          {/* 3 panels — each scrolls inside itself */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <CostingPanel    data={data.costing_details} />
            <ProductionPanel data={data.production_details} grandTotal={data.grand_total} />
            <BomPanel        data={data.original_bom} />
          </div>
        </>
      )}
    </CostingFrame>
  );
}
