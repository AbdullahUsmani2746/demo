"use client";

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadXlsx, r2, r4 } from "@/lib/reconciliation/exportXlsx";
import {
  ArrowLeft, RefreshCw, Search, CheckCircle2, AlertTriangle, ChevronDown, HelpCircle, Wrench,
  Stethoscope, Calculator, Factory, Package, Landmark, ListChecks, History, Loader2, X,
  ArrowRight, Info, Lock, Unlock, FileCheck2, FileX2, LayoutList, ShieldCheck, Download,
} from "lucide-react";
import { LabHeader } from "@/components/Material/shared/LabUI";
import { CostingFrame, PeriodPicker, IconBtn, Note, MONTHS } from "@/components/Costing/CostingUI";
import { useFeatures } from "@/hooks/useFeatures";
import { voucherHref } from "@/lib/vouchers/voucherLink";

// Item cost trace (ported from Accounting's item reconciliation). Read-only:
// GET /api/costing/item-reconciliation. Voucher numbers open the voucher
// read-only through voucherHref() (the drill trail).

// ─────────────────────────────────────────────────────────────
// Constants & formatters
// ─────────────────────────────────────────────────────────────
const CY = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CY - i);

const N = (v) => Number(v) || 0;
const fmt = (v) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(N(v));
const fmtR = (v) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(N(v));
const fmtQ = (v) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 }).format(N(v));
const fmtS = (v) => `${N(v) > 0 ? "+" : N(v) < 0 ? "−" : ""}${fmt(Math.abs(N(v)))}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const off = (a, b) => Math.abs(N(a) - N(b)) > Math.max(0.01, Math.abs(N(b)) * 0.0005);

const SEVERITY = {
  high: { dot: "bg-rose-500", ring: "ring-rose-100", label: "High", text: "text-rose-700", chip: "bg-rose-50 text-rose-700" },
  medium: { dot: "bg-amber-500", ring: "ring-amber-100", label: "Medium", text: "text-amber-700", chip: "bg-amber-50 text-amber-700" },
  low: { dot: "bg-slate-400", ring: "ring-border", label: "Low", text: "text-muted-foreground", chip: "bg-muted text-muted-foreground" },
  info: { dot: "bg-sky-400", ring: "ring-sky-100", label: "Note", text: "text-sky-700", chip: "bg-sky-50 text-sky-700" },
};

// Areas: label + what "passed" means when there is no finding
const AREAS = {
  opening: { label: "Opening stock", ok: "Opening matches last month's closing (quantity, rate and RM/CC split)." },
  purchases: { label: "Purchases", ok: "Every purchase line has an amount, no rate outliers, no charge lines with quantity." },
  production: { label: "Production (RM)", ok: "Every receipt is costed, quantities match, costing is up to date." },
  cc: { label: "Conversion cost (CC)", ok: "CC rate matches today's overhead pool and the item's category." },
  issues: { label: "Issues & consumption", ok: "Every issue is credited by a JV at a matching rate." },
  sales: { label: "Sales & COGS", ok: "Sales are costed and included in COGS." },
  closing: { label: "Closing stock", ok: "Closing stock is positive in every godown, valued, and next month's opening matches." },
  recipe: { label: "Recipe & BOM", ok: "One active recipe, using this item's active BOM, with the same materials (machine instructions ignored)." },
  gl: { label: "GL & JVs", ok: "JVs are posted, up to date, and move this item by the same amounts as the stock report." },
  data: { label: "Engine check", ok: "Rates rebuilt here match the stock report exactly." },
};

const CLS = {
  plan: { label: "Plan-linked", cls: "bg-emerald-50 text-emerald-700" },
  direct: { label: "Direct use", cls: "bg-sky-50 text-sky-700" },
  orphan: { label: "No plan link", cls: "bg-rose-50 text-rose-700" },
};

const FLAG_LABEL = {
  zero_value: ["No amount", "bg-rose-50 text-rose-700"],
  outlier: ["Rate outlier", "bg-amber-50 text-amber-700"],
  rate_field_differs: ["Rate × qty ≠ amount", "bg-muted text-muted-foreground"],
  other_account: ["Other GL account", "bg-rose-50 text-rose-700"],
  after_AUTO_COGM: ["After COGM JV", "bg-amber-50 text-amber-700"],
  after_AUTO_COGS: ["After COGS JV", "bg-amber-50 text-amber-700"],
  after_AUTO_MATISS: ["After MATISS JV", "bg-amber-50 text-amber-700"],
};

// ─────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────
function Card({ title, icon: Icon, right, children, className = "" }) {
  return (
    <section className={`rounded-2xl border border-border bg-background shadow-sm ${className}`}>
      {title && (
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {right && <div className="ml-auto">{right}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

function Chip({ children, className = "bg-muted text-muted-foreground" }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${className}`}>{children}</span>;
}

function Formula({ children }) {
  return <div className="rounded-xl bg-muted/50 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">{children}</div>;
}

// Stored vs now — shows the new value only when it moved
function Delta({ was, now, rate = true }) {
  const f = rate ? fmtR : fmtQ;
  if (was == null) return <span className="tabular-nums">{f(now)}</span>;
  if (!off(now, was)) return <span className="tabular-nums">{f(was)}</span>;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tabular-nums text-muted-foreground line-through">{f(was)}</span>
      <span className="font-semibold tabular-nums text-rose-600">{f(now)}</span>
    </span>
  );
}

function Table({ cols, rows, empty = "Nothing here.", rowClass, minWidth = 640 }) {
  if (!rows?.length) {
    return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <>
    {/* Phones: one card per row (rule 9) */}
    <div className="space-y-2 md:hidden">
      {rows.map((r, i) => (
        <div key={r.__key ?? i} className={`rounded-xl border border-border p-3 text-sm ${rowClass?.(r) || ""}`}>
          <div className="mb-1.5 font-medium text-foreground">{cols[0].render ? cols[0].render(r) : r[cols[0].key]}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            {cols.slice(1).map((c) => (
              <div key={c.key} className="min-w-0">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</dt>
                <dd className={`min-w-0 break-words ${c.num ? "tabular-nums" : ""}`}>{c.render ? c.render(r) : r[c.key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
    <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="bg-muted/50">
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {cols.map((c) => <th key={c.key} className={`px-3 py-2 font-medium ${c.num ? "text-right" : "text-left"}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={r.__key ?? i} className={rowClass?.(r) || "hover:bg-muted/50"}>
              {cols.map((c) => (
                <td key={c.key} className={`px-3 py-2 align-top ${c.num ? "text-right tabular-nums" : ""} ${c.className || "text-foreground"}`}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

// Voucher number that opens the voucher read-only (drill trail, rule 15)
function VoucherNo({ v, className = "" }) {
  const label = `#${v.vr_no ?? v.tran_id}`;
  const href = voucherHref(v);
  if (!href) return <span className={className}>{label}</span>;
  return <Link href={href} className={`${className} text-primary hover:underline`} title="Open voucher">{label}</Link>;
}

// ─────────────────────────────────────────────────────────────
// Item picker
// ─────────────────────────────────────────────────────────────
function ItemPicker({ value, onPick }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        // Same lookup as Costing Checker — matches item name, code and itcd
        const res = await fetch(`/api/forms/items?limit=12&search=${encodeURIComponent(term)}`);
        const json = await res.json();
        setResults(json.items || []);
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (it) => {
    onPick({ itcd: Number(it.itcd), name: it.item });
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (results[0]) pick(results[0]);
            else if (/^\d+$/.test(q.trim())) { onPick({ itcd: Number(q.trim()) }); setQ(""); setOpen(false); }
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={value ? `${value.itcd}${value.name ? ` · ${value.name}` : ""}` : "Search item by name, code or ITCD"}
        className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-8 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
      />
      {busy && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {open && q.trim() && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-background py-1 shadow-lg">
          {results.length === 0 && !busy && <div className="px-3 py-2 text-sm text-muted-foreground">No items found.</div>}
          {results.map((it) => (
            <button key={it.itcd} type="button" onClick={() => pick(it)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
              <span className="font-mono text-xs text-muted-foreground">{it.itcd}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{it.item}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{[it.code, it.unit].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Diagnosis
// ─────────────────────────────────────────────────────────────
function FindingCard({ f, defaultOpen, onJump }) {
  const [open, setOpen] = useState(defaultOpen);
  const sev = SEVERITY[f.severity] || SEVERITY.low;
  return (
    <div className={`rounded-2xl border bg-background shadow-sm transition ${open ? "border-border" : "border-border hover:border-border"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${sev.dot} ${sev.ring}`} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug text-foreground">{f.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Chip className={sev.chip}>{sev.label}</Chip>
            <span>{AREAS[f.area]?.label || f.area}</span>
          </div>
        </div>
        {f.impact ? (
          <div className="text-right">
            <div className="font-bold tabular-nums text-foreground">{fmt(f.impact)}</div>
            <div className="text-[11px] text-muted-foreground">at stake</div>
          </div>
        ) : null}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3 text-sm">
          <p className="text-foreground">{f.what}</p>
          <div className="rounded-xl bg-muted/50 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <HelpCircle className="h-3.5 w-3.5" />Why this happens
            </div>
            <p className="text-muted-foreground">{f.why}</p>
          </div>
          <div className="rounded-xl bg-emerald-50/60 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              <Wrench className="h-3.5 w-3.5" />How to fix
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-foreground">
              {f.fix.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
          {f.ref?.tab && (
            <Button variant="outline" size="sm" onClick={() => onJump(f.ref)} className="gap-1.5">
              <ArrowRight className="h-3.5 w-3.5" />Show the source
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DiagnosisTab({ data, onJump }) {
  const problems = data.findings.filter((f) => f.severity !== "info");
  const notes = data.findings.filter((f) => f.severity === "info");
  const failedAreas = new Set(problems.map((f) => f.area));
  const relevant = Object.keys(AREAS).filter((a) => {
    if (a === "cc") return data.item.carries_cc && data.production.qty > 0;
    if (a === "production") return data.production.groups.length > 0;
    if (a === "issues") return data.report.issue_qty !== 0 || data.consumption.length > 0;
    if (a === "sales") return data.sales.sold_qty !== 0 || data.sales.returned_qty !== 0;
    if (a === "purchases") return data.report.purchase_qty !== 0 || data.report.purchase_ret_qty !== 0;
    if (a === "recipe") return (data.recipes || []).length > 0;
    return true;
  });
  const passed = relevant.filter((a) => !failedAreas.has(a));

  return (
    <div className="space-y-4">
      {problems.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/50 py-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          <div className="font-semibold text-emerald-900">Nothing to fix for this item</div>
          <div className="max-w-md text-sm text-emerald-800/80">Every rate was rebuilt from its source and matches the stock report, production costing and the JVs.</div>
        </div>
      )}

      {problems.map((f, i) => <FindingCard key={f.id} f={f} defaultOpen={i === 0} onJump={onJump} />)}

      {notes.length > 0 && (
        <div className="space-y-2">
          <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Worth knowing — not errors</h3>
          {notes.map((f) => <FindingCard key={f.id} f={f} defaultOpen={false} onJump={onJump} />)}
        </div>
      )}

      {passed.length > 0 && (
        <Card title="Checks passed" icon={CheckCircle2}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {passed.map((a) => (
              <li key={a} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span><b className="font-medium text-foreground">{AREAS[a].label}.</b> <span className="text-muted-foreground">{AREAS[a].ok}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Rate build-up
// ─────────────────────────────────────────────────────────────
function RateTab({ data }) {
  const { report: rep, blended, flow, opening, cc, production, rate_now: rn, item } = data;
  const semiOn = !!data.period?.semi_cc_on; // semi-finished CC switch for this month
  const ccUnits = semiOn ? "FG+SFG" : "FG";
  const snap = opening.snapshot;
  const prevC = opening.prev_closing;
  const maxShare = Math.max(1, ...blended.parts.map((p) => Math.abs(p.share)));

  return (
    <div className="space-y-4">
      {/* Value flow */}
      <Card title="How the closing value is built" icon={Calculator}
        right={Math.abs(flow.gap) < 1
          ? <Chip className="bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-3 w-3" />Foots to closing</Chip>
          : <Chip className="bg-rose-50 text-rose-700">Gap {fmtS(flow.gap)}</Chip>}>
        <Table
          minWidth={520}
          cols={[
            { key: "label", label: "Movement" },
            { key: "qty", label: "Qty", num: true, render: (r) => fmtQ(r.qty) },
            { key: "rate", label: "Rate", num: true, render: (r) => (r.qty ? fmtR(r.rate) : "—") },
            { key: "value", label: "Value", num: true, render: (r) => <span className={N(r.value) < 0 ? "text-muted-foreground" : ""}>{fmt(r.value)}</span> },
          ]}
          rows={[
            ...flow.rows.filter((r) => Math.abs(r.qty) > 0.0005 || r.key === "opening"),
            { __key: "closing", label: <b>Closing</b>, qty: flow.closing_qty, rate: rep.closing_rate, value: flow.closing_value },
          ]}
          rowClass={(r) => (r.__key === "closing" ? "bg-muted/50 font-semibold" : "hover:bg-muted/50")}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Opening, purchases and production set the rate. Everything that leaves (issues, sales) or returns is valued at that one blended rate, so closing = closing qty × blended rate.
          Transfers between godowns cancel out and are not shown.
        </p>
      </Card>

      {/* Blended rate */}
      <Card title={`Blended rate ${fmtR(blended.report_rate)}`} icon={Calculator}>
        <div className="space-y-2">
          {blended.parts.filter((p) => Math.abs(p.qty) > 0.0005).map((p) => (
            <div key={p.key} className="grid grid-cols-12 items-center gap-2 text-sm">
              <div className="col-span-4 text-muted-foreground sm:col-span-3">{p.label}</div>
              <div className="col-span-8 sm:col-span-5">
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-[#800000]/70" style={{ width: `${Math.min(100, (Math.abs(p.share) / maxShare) * 100)}%` }} />
                </div>
              </div>
              <div className="col-span-6 text-right tabular-nums text-muted-foreground sm:col-span-2">{fmtQ(p.qty)} @ {fmtR(p.rate)}</div>
              <div className="col-span-6 text-right font-medium tabular-nums sm:col-span-2">{fmt(p.value)}</div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Formula>
            ({blended.parts.filter((p) => Math.abs(p.qty) > 0.0005).map((p) => fmt(p.value)).join(" + ").replace(/\+ -/g, "− ")})
            {" ÷ "}({blended.parts.filter((p) => Math.abs(p.qty) > 0.0005).map((p) => fmtQ(p.qty)).join(" + ").replace(/\+ -/g, "− ")})
            <br />= {fmt(blended.pool_value)} ÷ {fmtQ(blended.pool_qty)} = <b>{fmtR(blended.rate)}</b>
          </Formula>
        </div>
        {item.carries_cc && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl bg-muted/50 p-2"><div className="text-[11px] uppercase text-muted-foreground">RM part</div><div className="font-semibold tabular-nums">{fmtR(blended.rm_rate)}</div></div>
            <div className="rounded-xl bg-muted/50 p-2"><div className="text-[11px] uppercase text-muted-foreground">CC part</div><div className="font-semibold tabular-nums">{fmtR(blended.cc_rate)}</div></div>
            <div className="rounded-xl bg-muted/50 p-2"><div className="text-[11px] uppercase text-muted-foreground">Total</div><div className="font-semibold tabular-nums">{fmtR(blended.report_rate)}</div></div>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Used for every issue, sale, return and the closing stock this month. COGS shows it split into RM and CC with the CC rate below.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Opening */}
        <Card title={`Opening rate ${fmtR(rep.opening_rate)}`} icon={Package}>
          <Table
            minWidth={360}
            cols={[
              { key: "k", label: "" },
              { key: "qty", label: "Qty", num: true, render: (r) => (r.qty == null ? "—" : fmtQ(r.qty)) },
              { key: "rate", label: "Rate", num: true, render: (r) => (r.rate == null ? "—" : fmtR(r.rate)) },
            ]}
            rows={[
              { __key: "s", k: "Saved opening (snapshot)", qty: snap?.qty, rate: snap?.rate },
              { __key: "p", k: `Last month's closing now`, qty: prevC?.qty, rate: prevC?.rate },
            ]}
          />
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>The stock report uses the saved snapshot: qty × rate = <b>{fmt(rep.opening_value)}</b>. It is written when last month is locked (or opening stock is calculated).</p>
            <p className="flex items-center gap-1">
              {opening.prev_locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              {data.period.prev.label} is {opening.prev_locked ? `locked${opening.prev_locked_at ? ` (${fmtDate(opening.prev_locked_at)}${opening.prev_locked_by ? `, ${opening.prev_locked_by}` : ""})` : ""}` : "not locked"}.
              {snap?.updated_at && ` Snapshot saved ${fmtDate(snap.updated_at)}.`}
            </p>
            {item.carries_cc && snap && <p>Split: RM {fmtR(snap.rm_rate)} + CC {fmtR(snap.cc_rate)}.</p>}
          </div>
        </Card>

        {/* Production rate */}
        <Card title={`Production rate ${fmtR(production.report_rate)}`} icon={Factory}>
          {production.qty > 0 || production.groups.length ? (
            <>
              <Table
                minWidth={360}
                cols={[
                  { key: "k", label: "Batch" },
                  { key: "q", label: "Costed qty", num: true, render: (r) => fmtQ(r.q) },
                  { key: "rm", label: "RM", num: true, render: (r) => fmtR(r.rm) },
                  { key: "cc", label: "CC", num: true, render: (r) => fmtR(r.cc) },
                  { key: "cpu", label: "Cost/unit", num: true, render: (r) => <b>{fmtR(r.cpu)}</b> },
                ]}
                rows={production.groups.filter((g) => g.pce?.this_month).map((g) => ({
                  __key: g.key, k: g.plan_id ? `Plan ${g.plan_id}` : "Unplanned", q: g.pce.qty_costed, rm: g.pce.rm_rate - (g.cc_breakdown?.inputs_rate || 0), cc: g.pce.cc_rate + (g.cc_breakdown?.inputs_rate || 0), cpu: g.pce.cost_per_unit,
                }))}
                empty="No production costing entry this month."
              />
              <div className="mt-2">
                <Formula>Σ(cost/unit × costed qty) ÷ Σ costed qty = {fmtR(production.recalc_rate)}<br />× received {fmtQ(production.qty)} = {fmt(production.qty * production.report_rate)}</Formula>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Cost/unit = RM (materials issued to the plan ÷ qty received) + CC (overhead pool ÷ {ccUnits} received). All received quantity is valued at the weighted average of the costed batches.</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not produced this month.</p>
          )}
        </Card>

        {/* CC carried by this month's production: own stage + semi-finished inputs */}
        {semiOn && item.carries_cc && (cc.own_value > 0 || cc.inputs_value > 0) && (
          <Card title="Conversion cost inside this month's production" icon={Factory}>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-muted/50 p-2"><div className="text-[11px] uppercase text-muted-foreground">Own stage</div><div className="font-semibold tabular-nums">{fmtR(cc.own_per_unit)}</div></div>
              <div className="rounded-xl bg-muted/50 p-2"><div className="text-[11px] uppercase text-muted-foreground">From semi-finished inputs</div><div className="font-semibold tabular-nums">{fmtR(cc.inputs_per_unit)}</div></div>
              <div className="rounded-xl bg-violet-50 p-2"><div className="text-[11px] uppercase text-violet-500">Total CC per unit</div><div className="font-semibold tabular-nums text-violet-800">{fmtR(cc.own_per_unit + cc.inputs_per_unit)}</div></div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Each semi-finished input is valued at its own cost per unit, which already includes the CC of its stage. This item then adds its own CC
              ({fmt(cc.own_value)} this month) on top, so both stages are in the cost — and both are shown as CC in COGS and the opening split.
            </p>
          </Card>
        )}

        {/* CC */}
        {item.carries_cc && (
          <Card title={`CC rate ${fmtR(cc.report_rate)}`} icon={Factory}>
            <Formula>
              (opening {fmtQ(cc.opening_qty)} × {fmtR(cc.opening_cc_rate)} + own-stage CC {fmt(cc.pce_cc_cost)}
              {cc.pce_input_cc_cost > 0 && <> + CC from inputs {fmt(cc.pce_input_cc_cost)}</>})
              <br />÷ ({fmtQ(cc.opening_qty)} + {fmtQ(cc.pce_qty)}) = <b>{fmtR(cc.blended_rate)}</b>
            </Formula>
            <p className="mt-2 text-xs text-muted-foreground">This is the CC part of the blended rate. COGS splits each sale into RM = blended rate − this, and CC = this. The month lock saves the same split into next month&apos;s opening.</p>
            <div className="mt-3 rounded-xl border border-border p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overhead pool today</div>
              <div className="mt-1 tabular-nums text-foreground">
                {fmt(cc.pool_now)} ÷ {fmtQ(cc.pool_qty_now)} {ccUnits} received = <b>{fmtR(cc.rate_now)}</b> per unit
              </div>
              <p className="mt-1 text-xs text-muted-foreground">The main accounts of Account Settings → Conversion overheads (less the Conversion cost account) for the month, shared over every {semiOn ? "finished and semi-finished" : "finished"} unit received (M2M excluded). Each batch is costed with the pool rate at the time costing ran.</p>
            </div>
          </Card>
        )}

        {/* Costing rate as a material */}
        {rn && (
          <Card title={`Rate when used as a material ${fmtR(rn.rate)}`} icon={Package}>
            <Formula>
              {rn.source === "production" ? (
                <>(opening {fmtQ(rn.opening_qty)} × {fmtR(rn.opening_rate)} + production {fmt(rn.prod_value)}) ÷ ({fmtQ(rn.opening_qty)} + {fmtQ(rn.prod_qty)})</>
              ) : (
                <>(opening {fmtQ(rn.opening_qty)} × {fmtR(rn.opening_rate)} + purchases {fmt(rn.purch_amt)}) ÷ ({fmtQ(rn.opening_qty)} + {fmtQ(rn.purch_qty)})</>
              )}
              <br />= <b>{fmtR(rn.rate)}</b>
            </Formula>
            <p className="mt-2 text-xs text-muted-foreground">
              This is the rate production costing gives this item when another plan consumes it.
              {rn.source === "production"
                ? " Because it was produced this month, costing uses opening + this month's production only — purchases are left out."
                : " Costing reads every purchase line with a quantity; the stock report reads main lines only."}
              {off(rn.rate, rep.blended_rate) && <b className="text-amber-700"> It differs from the stock report rate ({fmtR(rep.blended_rate)}), so COGM and the stock report value the same issue differently.</b>}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Production
// ─────────────────────────────────────────────────────────────
function ProductionTab({ data, focus, onTrace }) {
  const groups = data.production.groups;
  const semiOn = !!data.period?.semi_cc_on; // semi-finished CC switch for this month
  if (!groups.length) return <Card><p className="text-sm text-muted-foreground">This item was not produced in {data.period.label}.</p></Card>;
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const p = g.pce;
        const stale = p && g.now && off(g.now.cost_per_unit, p.cost_per_unit);
        // CC carried in by semi-finished inputs: shown under CC, taken out of RM (same split as COGM / COGS)
        const ib = g.cc_breakdown?.inputs_rate || 0;
        return (
          <section key={g.key} id={`prod-${g.key}`}
            className={`rounded-2xl border bg-background shadow-sm ${focus === g.key ? "border-[#800000] ring-2 ring-[#800000]/10" : "border-border"}`}>
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <Factory className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{g.plan_id ? `Plan ${g.plan_id}` : "Unplanned production"}</h3>
              {g.plan_status && <Chip className={g.plan_status === "Posted" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}>{g.plan_status}</Chip>}
              {g.m2m && <Chip>M2M — no CC</Chip>}
              {!p && <Chip className="bg-rose-50 text-rose-700">Not costed</Chip>}
              {p && !p.this_month && <Chip className="bg-amber-50 text-amber-700">Costed in {MONTHS[p.month - 1]} {p.year}</Chip>}
              {stale && <Chip className="bg-rose-50 text-rose-700">Out of date</Chip>}
              {p?.calculated_at && <span className="ml-auto text-[11px] text-muted-foreground">Costed {fmtDate(p.calculated_at)}{p.calculated_by ? ` · ${p.calculated_by}` : ""}</span>}
            </header>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-5">
                {[
                  ["Received", <Delta key="r" was={p?.qty_costed} now={g.t8_qty} rate={false} />],
                  ["RM rate", p ? <Delta key="rm" was={p.rm_rate - ib} now={(g.now?.rm_rate ?? p.rm_rate) - ib} /> : "—"],
                  [semiOn ? "CC rate (all stages)" : "CC rate", p ? <Delta key="cc" was={p.cc_rate + ib} now={(g.now?.cc_rate ?? p.cc_rate) + ib} /> : "—"],
                  ["Cost / unit", p ? <Delta key="c" was={p.cost_per_unit} now={g.now?.cost_per_unit ?? p.cost_per_unit} /> : "—"],
                  ["Value", fmt(g.t8_qty * (p?.cost_per_unit || 0))],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-muted/50 p-2">
                    <div className="text-[11px] uppercase text-muted-foreground">{k}</div>
                    <div className="font-semibold">{v}</div>
                  </div>
                ))}
              </div>
              {p && (
                <p className="text-xs text-muted-foreground">
                  RM = {p.actual_issued_cost != null ? `materials issued to the plan ${fmt(p.actual_issued_cost)}` : `plan material list (theoretical) ${fmt(p.theoretical_cost)} — nothing was issued against this plan`} ÷ {fmtQ(p.qty_costed)} received.
                  {" "}Plan expected {fmt(p.theoretical_cost)}{p.cost_variance != null ? `, variance ${fmtS(p.cost_variance)}` : ""}{p.wastage_cost ? `, wastage ${fmt(p.wastage_cost)}` : ""}.
                  {g.now && off(g.now.cost_per_unit, p.cost_per_unit) && " Struck-through figures are what was stored; red figures are what costing would produce if re-run today."}
                </p>
              )}
              {g.cc_breakdown && (g.cc_breakdown.own_rate > 0 || g.cc_breakdown.inputs_rate > 0) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-violet-50/60 px-3 py-2 text-xs text-violet-900">
                  <b>CC per unit:</b>
                  <span>own stage {fmtR(g.cc_breakdown.own_rate)}</span>
                  {g.cc_breakdown.inputs_rate > 0 && <span>+ from {semiOn ? "semi-finished" : "finished"} inputs {fmtR(g.cc_breakdown.inputs_rate)}</span>}
                  <span>= <b>{fmtR(g.cc_breakdown.total_rate)}</b></span>
                  {g.m2m && <span className="text-violet-700">(M2M — no own-stage CC)</span>}
                </div>
              )}
              {g.materials.length > 0 && (
                <Table
                  minWidth={820}
                  cols={[
                    { key: "name", label: "Material", render: (m) => (
                      <button type="button" onClick={() => onTrace(m.itcd, m.name)} className="group text-left">
                        <span className="text-foreground group-hover:text-[#800000] group-hover:underline">{m.name}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground">{m.itcd}{m.code ? ` · ${m.code}` : ""}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {m.carries_cc && <Chip className={m.cc_per_unit > 0 ? "bg-violet-50 text-violet-700" : "bg-amber-50 text-amber-700"}>CC {fmtR(m.cc_per_unit)}/unit</Chip>}
                          {m.recosted_after && <Chip className="bg-rose-50 text-rose-700">Re-costed after this product</Chip>}
                        </span>
                      </button>
                    ) },
                    { key: "bom", label: "Plan qty", num: true, render: (m) => fmtQ(m.bom_qty) },
                    { key: "qty", label: "Issued", num: true, render: (m) => <Delta was={m.stored_qty} now={m.now_qty} rate={false} /> },
                    { key: "rate", label: "Rate", num: true, render: (m) => <Delta was={m.stored_rate} now={m.now_rate} /> },
                    { key: "src", label: "Rate from", render: (m) => <span className="text-xs text-muted-foreground">{m.now_rate_source}</span> },
                    { key: "cost", label: "Cost", num: true, render: (m) => <Delta was={m.stored_cost} now={m.now_cost} rate={false} /> },
                  ]}
                  rows={g.materials.map((m) => ({ ...m, __key: m.itcd }))}
                />
              )}
              {g.refs?.length > 0 && <p className="text-[11px] text-muted-foreground">Receipt reference(s): {g.refs.join(", ")}</p>}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">Click a material to trace it the same way.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Consumption
// ─────────────────────────────────────────────────────────────
function ConsumptionTab({ data, focus, onTrace }) {
  const rows = data.consumption;
  if (!rows.length) return <Card><p className="text-sm text-muted-foreground">This item was not issued in {data.period.label}.</p></Card>;
  return (
    <div className="space-y-3">
      <Table
        minWidth={900}
        rowClass={(r) => (focus === r.key ? "bg-[#800000]/5" : "hover:bg-muted/50")}
        cols={[
          { key: "where", label: "Issued to", render: (r) => (
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-foreground">{r.plan_id ? `Plan ${r.plan_id}` : r.refs.join(", ")}</span>
                <Chip className={CLS[r.cls].cls}>{CLS[r.cls].label}</Chip>
              </div>
              {r.product && <div className="text-[11px] text-muted-foreground">{r.product}</div>}
            </div>
          ) },
          { key: "qty", label: "Qty", num: true, render: (r) => fmtQ(r.qty) },
          { key: "rr", label: "Stock report", num: true, render: (r) => <div><div>{fmt(r.report_value)}</div><div className="text-[11px] text-muted-foreground">@ {fmtR(r.report_rate)}</div></div> },
          { key: "cr", label: "Costing", num: true, render: (r) => r.costing ? <div><div>{fmt(r.costing.value)}</div><div className="text-[11px] text-muted-foreground">{fmtQ(r.costing.qty)} @ {fmtR(r.costing.rate)}</div></div> : "—" },
          { key: "jv", label: "Credited by", render: (r) => r.jv === "none" ? <Chip className="bg-rose-50 text-rose-700">No JV</Chip> : <span className="text-xs text-muted-foreground">{r.jv}</span> },
          { key: "diff", label: "JV − report", num: true, render: (r) => {
            const d = N(r.jv_value) - N(r.report_value);
            return Math.abs(d) < 1 ? <span className="text-muted-foreground/60">—</span> : <span className="font-semibold text-rose-600">{fmtS(d)}</span>;
          } },
        ]}
        rows={rows.map((r) => ({ ...r, __key: r.key }))}
      />
      <p className="text-xs text-muted-foreground">
        Stock report = qty × this month&apos;s blended rate. Costing = what production costing stored for this material in the plan.
        COGM credits the costing value, MATISS credits the stock-report value, and issues with no plan link are credited by nothing unless unplanned production absorbed them.
      </p>
      {rows.some((r) => r.product) && (
        <p className="text-xs text-muted-foreground">
          Trace a product:{" "}
          {[...new Map(rows.filter((r) => r.product_itcd).map((r) => [r.product_itcd, r])).values()].slice(0, 8).map((r) => (
            <button key={r.key} type="button" className="mr-3 text-[#800000] hover:underline" onClick={() => onTrace(r.product_itcd, r.product)}>{r.product}</button>
          ))}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GL & JVs
// ─────────────────────────────────────────────────────────────
function GlTab({ data }) {
  const { gl, period } = data;
  return (
    <div className="space-y-4">
      <Card title={gl.acno ? `Stock account ${gl.acno} · ${gl.acname || ""}` : "No stock account"} icon={Landmark}>
        <Table
          minWidth={720}
          cols={[
            { key: "label", label: "Movement", render: (r) => (
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{r.label}</span>
                  {r.jv && <Chip className={r.posted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}>{r.posted ? "JV posted" : "JV missing"}</Chip>}
                </div>
                {r.note && <div className="text-[11px] text-muted-foreground">{r.note}</div>}
              </div>
            ) },
            { key: "report", label: "Stock report", num: true, render: (r) => fmt(r.report) },
            { key: "gl", label: "GL / JV today", num: true, render: (r) => fmt(r.gl) },
            { key: "diff", label: "Difference", num: true, render: (r) => Math.abs(r.diff) < 1 ? <span className="text-muted-foreground/60">—</span> : <span className="font-semibold text-rose-600">{fmtS(r.diff)}</span> },
          ]}
          rows={[
            ...gl.rows.map((r) => ({ ...r, __key: r.key })),
            { __key: "total", label: <b>Net movement this month</b>, report: gl.total_report, gl: gl.total_gl, diff: gl.total_gl - gl.total_report },
          ]}
          rowClass={(r) => (r.__key === "total" ? "bg-muted/50 font-semibold" : Math.abs(N(r.diff)) >= 1 ? "bg-rose-50/40" : "hover:bg-muted/50")}
          empty="This item had no movement that reaches the GL this month."
        />
        <p className="mt-2 text-xs text-muted-foreground">
          JVs post per account, not per item, so this item&apos;s share is rebuilt the way each JV builds it: COGM debits the product at costed qty × (RM + CC) and credits each material its share of RM;
          COGS credits net sold qty × blended rate; MATISS credits direct issues × blended rate. Purchases come from this item&apos;s own voucher lines on its purchase / purchase-return account.
          The stock account is the item category&apos;s, or the &quot;Stock&quot; default in Finance → Account Settings.
        </p>
      </Card>

      <Card title={`Auto JVs for ${period.label}`} icon={FileCheck2}>
        <div className="grid gap-2 sm:grid-cols-3">
          {gl.jvs.map((j) => {
            const v = j.vouchers[j.vouchers.length - 1];
            return (
              <div key={j.tag} className={`rounded-xl border p-3 text-sm ${v ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  {v ? <FileCheck2 className="h-4 w-4 text-emerald-600" /> : <FileX2 className="h-4 w-4 text-amber-600" />}
                  {j.label}
                  {j.vouchers.length > 1 && <Chip className="bg-rose-50 text-rose-700">×{j.vouchers.length}</Chip>}
                </div>
                {v ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Voucher <VoucherNo v={v} /> · {fmtDate(v.dated)}
                    <div>Posted to this account: <b className="tabular-nums">{fmtS(v.acno_net)}</b> <span className="text-muted-foreground">(all items)</span></div>
                  </div>
                ) : <div className="mt-1 text-xs text-amber-700">Not posted</div>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Movements
// ─────────────────────────────────────────────────────────────
function MovementsTab({ data, focusLine }) {
  const [type, setType] = useState("all");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const types = useMemo(() => {
    const m = new Map();
    for (const l of data.movements) m.set(l.type, (m.get(l.type) || 0) + 1);
    return [...m];
  }, [data.movements]);
  const rows = data.movements.filter((l) =>
    (type === "all" || l.type === type) &&
    (!onlyFlagged || l.flags.length > 0 || !l.counted));

  useEffect(() => {
    if (!focusLine) return;
    const el = [`line-${focusLine}`, `mline-${focusLine}`].map((id) => document.getElementById(id)).find((x) => x?.offsetParent);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusLine]);

  const gd = data.godowns;

  return (
    <div className="space-y-3">
      {gd && gd.rows.length > 0 && (
        <Card title="Stock by godown" icon={Package}
          right={gd.reliable
            ? <Chip className="bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-3 w-3" />Adds up to {fmtQ(gd.report_closing_qty)}</Chip>
            : <Chip className="bg-amber-50 text-amber-700">Total {fmtQ(gd.total)} ≠ report {fmtQ(gd.report_closing_qty)}</Chip>}>
          <Table
            minWidth={480}
            cols={[
              { key: "name", label: "Godown" },
              { key: "opening", label: "Opening", num: true, render: (g) => fmtQ(g.opening) },
              { key: "movement", label: "This month", num: true, render: (g) => `${g.movement > 0 ? "+" : ""}${fmtQ(g.movement)}` },
              { key: "closing", label: "Closing qty", num: true, render: (g) => <b className={g.closing < -0.0005 ? "text-rose-600" : ""}>{fmtQ(g.closing)}</b> },
            ]}
            rows={gd.rows.map((g) => ({ ...g, __key: g.godown ?? "none" }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {gd.reliable
              ? "This month's opening stock per godown plus this month's vouchers; transfers move stock from one godown to the other. A negative godown means stock left it before it arrived."
              : "The godown totals don't add up to the stock report's closing quantity — the opening per godown and the stock report disagree, so godown balances are indicative only."}
          </p>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {[["all", data.movements.length], ...types].map(([t, c]) => (
          <button key={t} type="button" onClick={() => setType(t)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${type === t ? "bg-[#800000] text-white" : "bg-background text-muted-foreground ring-1 ring-border hover:ring-primary/40"}`}>
            {t === "all" ? "All" : t}<span className={`rounded-full px-1.5 text-[10px] ${type === t ? "bg-background/20" : "bg-muted text-muted-foreground"}`}>{c}</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="accent-[#800000]" />
          Only flagged or excluded
        </label>
      </div>
      {/* Phones: one card per line */}
      <div className="space-y-2 md:hidden">
        {rows.map((l) => (
          <div key={l.line_id} id={`mline-${l.line_id}`}
            className={`rounded-xl border border-border p-3 text-sm ${focusLine === l.line_id ? "bg-primary/5" : !l.counted ? "bg-muted/50 text-muted-foreground" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{l.type} <VoucherNo v={l} className="font-mono text-xs" /></div>
                <div className="text-[11px] text-muted-foreground">{fmtDate(l.dated)}{l.ref ? ` · ${l.ref}` : ""}{l.party ? ` · ${l.party}` : ""}</div>
              </div>
              <div className="text-right tabular-nums">
                <div>{l.qty == null ? "—" : fmtQ(l.qty)}</div>
                <div className="text-[11px] text-muted-foreground">{fmt(l.amount)}</div>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {l.cls && <Chip className={CLS[l.cls].cls}>{CLS[l.cls].label}</Chip>}
              {l.counted ? <Chip>Stock report {fmtS(l.report_value)}</Chip> : <Chip>{l.excluded_reason}</Chip>}
              {l.flags.map((f) => <Chip key={f} className={FLAG_LABEL[f]?.[1]}>{FLAG_LABEL[f]?.[0] || f}</Chip>)}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No lines.</div>}
      </div>
      <div className="hidden max-h-[65vh] overflow-auto rounded-xl border border-border md:block">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="sticky top-0 z-10 bg-muted/50">
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {["Date", "Type", "Voucher", "Reference", "Sub", "Qty", "Line amount", "Unit value", "In stock report", "Flags"].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-medium ${i >= 5 && i <= 8 ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((l) => (
              <tr key={l.line_id} id={`line-${l.line_id}`}
                className={`${focusLine === l.line_id ? "bg-[#800000]/5" : !l.counted ? "bg-muted/50 text-muted-foreground" : "hover:bg-muted/50"}`}>
                <td className="whitespace-nowrap px-3 py-2">{fmtDate(l.dated)}</td>
                <td className="px-3 py-2">
                  {l.type}
                  {l.cls && <div><Chip className={CLS[l.cls].cls}>{CLS[l.cls].label}</Chip></div>}
                </td>
                <td className="px-3 py-2 font-mono text-xs"><VoucherNo v={l} /></td>
                <td className="max-w-[220px] px-3 py-2">
                  <div className="truncate">{l.ref || "—"}</div>
                  {l.party && <div className="truncate text-[11px] text-muted-foreground">{l.party}</div>}
                </td>
                <td className="px-3 py-2 text-xs">{l.sub_tran_id ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.qty == null ? "—" : fmtQ(l.qty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(l.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.qty ? fmtR(l.unit_value) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.counted ? fmtS(l.report_value) : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {!l.counted && <Chip>{l.excluded_reason}</Chip>}
                    {l.flags.map((f) => <Chip key={f} className={FLAG_LABEL[f]?.[1]}>{FLAG_LABEL[f]?.[0] || f}</Chip>)}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No lines.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        &quot;In stock report&quot; is the value the stock report gives the line: purchases at their amount, production at the production rate, everything else at the blended rate.
        Grey lines are not counted by the stock report.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────
function HistoryTab({ data }) {
  const h = data.history;
  const max = Math.max(1, ...h.filter((x) => !x.missing).map((x) => x.rate));
  return (
    <Card title="Opening rate, month by month" icon={History}>
      <div className="space-y-1.5">
        {h.map((x) => (
          <div key={`${x.year}-${x.month}`} className={`grid grid-cols-12 items-center gap-2 rounded-lg px-2 py-1 text-sm ${x.current ? "bg-[#800000]/5" : ""}`}>
            <div className="col-span-3 text-muted-foreground sm:col-span-2">{MONTHS[x.month - 1].slice(0, 3)} {x.year}</div>
            {x.missing ? (
              <div className="col-span-9 text-xs text-muted-foreground sm:col-span-10">No opening snapshot</div>
            ) : (
              <>
                <div className="col-span-4 sm:col-span-5">
                  <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-[#800000]/60" style={{ width: `${(x.rate / max) * 100}%` }} /></div>
                </div>
                <div className="col-span-3 text-right tabular-nums sm:col-span-2">{fmtR(x.rate)}</div>
                <div className={`col-span-2 text-right text-xs tabular-nums sm:col-span-1 ${x.change_pct == null ? "text-muted-foreground/60" : Math.abs(x.change_pct) >= 25 ? "font-semibold text-rose-600" : "text-muted-foreground"}`}>
                  {x.change_pct == null ? "—" : `${x.change_pct > 0 ? "+" : ""}${x.change_pct.toFixed(1)}%`}
                </div>
                <div className="col-span-12 text-right text-[11px] tabular-nums text-muted-foreground sm:col-span-2">
                  {fmtQ(x.qty)}{data.item.carries_cc && x.cc_rate != null ? ` · CC ${fmtR(x.cc_rate)}` : ""}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Each row is the opening snapshot saved when the previous month was locked. Jumps of 25% or more are highlighted — open that month here to see why.</p>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Excel export
// ─────────────────────────────────────────────────────────────
const SEV_LABEL = { high: "High", medium: "Medium", low: "Low", info: "Note" };

function exportScan(scan) {
  const p = scan.period;
  return downloadXlsx(`Item reconciliation ${p.year}-${String(p.month).padStart(2, "0")}.xlsx`, [
    ["Items", scan.items.map((i) => ({
      ITCD: i.itcd, Item: i.name, Code: i.code, Category: i.category, Status: STATUS[i.status].label,
      Problems: i.problems, Notes: i.notes, "Largest issue": r2(i.largest), Rate: r4(i.rate), "Closing value": r2(i.closing_value),
      "Main problem": i.top || "",
    }))],
    ["Problems", scan.items.flatMap((i) => i.findings.map((f) => ({
      ITCD: i.itcd, Item: i.name, Severity: SEV_LABEL[f.severity], Area: AREAS[f.area]?.label || f.area,
      Problem: f.title, Details: f.what, "At stake": f.impact ? r2(f.impact) : "",
    })))],
    ["By cause", scan.causes.map((c) => ({
      Cause: c.label, Severity: SEV_LABEL[c.severity], Area: AREAS[c.area]?.label || c.area, Items: c.item_count, Cases: c.count,
      "At stake": r2(c.impact), Why: c.why, "How to fix": c.fix.join(" "),
    }))],
    ["Month checks", scan.month_checks.map((c) => ({ Check: c.title, OK: c.ok ? "Yes" : "No", Detail: c.detail, Why: c.why, Amount: c.amount ?? "" }))],
  ]);
}

function exportTrace(d) {
  const p = d.period;
  return downloadXlsx(`Item ${d.item.itcd} reconciliation ${p.year}-${String(p.month).padStart(2, "0")}.xlsx`, [
    ["Diagnosis", d.findings.map((f) => ({
      Severity: SEV_LABEL[f.severity], Area: AREAS[f.area]?.label || f.area, Problem: f.title, Details: f.what,
      Why: f.why, "How to fix": f.fix.join(" "), "At stake": f.impact ? r2(f.impact) : "",
    }))],
    ["Rate build-up", [
      ...d.flow.rows.map((f) => ({ Movement: f.label, Qty: r4(f.qty), Rate: r4(f.rate), Value: r2(f.value) })),
      { Movement: "Closing", Qty: r4(d.flow.closing_qty), Rate: r4(d.report.closing_rate), Value: r2(d.flow.closing_value) },
      {},
      { Movement: "Blended rate", Rate: r4(d.blended.report_rate) },
      { Movement: "  RM part", Rate: r4(d.blended.rm_rate) },
      { Movement: "  CC part", Rate: r4(d.blended.cc_rate) },
    ]],
    ["Production", d.production.groups.flatMap((g) => (g.materials.length ? g.materials : [null]).map((m) => ({
      Plan: g.plan_id ?? "Unplanned", Received: r4(g.t8_qty), "Costed qty": g.pce ? r4(g.pce.qty_costed) : "",
      "RM rate": g.pce ? r4(g.pce.rm_rate) : "", "CC own stage": g.pce ? r4(g.pce.cc_rate) : "",
      "CC from inputs": g.cc_breakdown ? r4(g.cc_breakdown.inputs_rate) : "", "Cost/unit stored": g.pce ? r4(g.pce.cost_per_unit) : "",
      "Cost/unit today": g.now ? r4(g.now.cost_per_unit) : "",
      Material: m?.name || "", "Material ITCD": m?.itcd || "", "Issued qty stored": m?.stored_qty ?? "", "Issued qty today": m ? r4(m.now_qty) : "",
      "Rate stored": m?.stored_rate != null ? r4(m.stored_rate) : "", "Rate today": m ? r4(m.now_rate) : "", "Rate from": m?.now_rate_source || "",
      "Re-costed after product": m?.recosted_after ? "Yes" : "",
    })))],
    ["Consumption", d.consumption.map((c) => ({
      "Issued to": c.plan_id ? `Plan ${c.plan_id}` : c.refs.join(", "), Product: c.product || "", Type: c.cls, Qty: r4(c.qty),
      "Report rate": r4(c.report_rate), "Report value": r2(c.report_value),
      "Costing rate": c.costing ? r4(c.costing.rate) : "", "Costing value": c.costing ? r2(c.costing.value) : "",
      "Credited by": c.jv, "JV value": r2(c.jv_value), "JV − report": r2(c.jv_value - c.report_value),
    }))],
    ["GL & JVs", d.gl.rows.map((r) => ({ Movement: r.label, "Stock report": r.report, "GL / JV today": r.gl, Difference: r.diff, "JV posted": r.jv ? (r.posted ? "Yes" : "No") : "", Note: r.note || "" }))],
    ["Movements", d.movements.map((l) => ({
      Date: l.dated ? new Date(l.dated).toLocaleDateString("en-GB") : "", Type: l.type, Voucher: l.vr_no ?? l.tran_id, Reference: l.ref, Party: l.party,
      "Sub line": l.sub_tran_id ?? "", Qty: l.qty ?? "", "Line amount": r2(l.amount), "Unit value": l.qty ? r4(l.unit_value) : "",
      "In stock report": l.counted ? r2(l.report_value) : "", Excluded: l.excluded_reason || "", Flags: l.flags.map((f) => FLAG_LABEL[f]?.[0] || f).join(", "),
    }))],
    ["Godowns", (d.godowns?.rows || []).map((g) => ({ Godown: g.name, "Before this month": r4(g.opening), "This month": r4(g.movement), "Closing qty": r4(g.closing) }))],
    ["History", d.history.map((h) => ({ Month: `${MONTHS[h.month - 1]} ${h.year}`, "Opening qty": h.missing ? "" : r4(h.qty), "Opening rate": h.missing ? "No snapshot" : r4(h.rate), "CC rate": h.cc_rate ?? "", "Change %": h.change_pct != null ? r2(h.change_pct) : "" }))],
  ]);
}

// ─────────────────────────────────────────────────────────────
// All items — the system checks every item and groups the reasons
// ─────────────────────────────────────────────────────────────
const STATUS = {
  error: { label: "Needs action", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700" },
  warn: { label: "Check", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700" },
  ok: { label: "Fine", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
};

function CauseCard({ c, names, onFilter, onOpen, active }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[c.severity] || SEVERITY.low;
  return (
    <div className={`rounded-2xl border bg-background shadow-sm ${active ? "border-[#800000] ring-2 ring-[#800000]/10" : "border-border"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${sev.dot} ${sev.ring}`} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug text-foreground">{c.label}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Chip className={sev.chip}>{sev.label}</Chip>
            <span>{c.item_count} item{c.item_count === 1 ? "" : "s"}</span>
            {c.count > c.item_count && <span>· {c.count} cases</span>}
            <span>· {AREAS[c.area]?.label || c.area}</span>
          </div>
        </div>
        {c.impact ? (
          <div className="text-right">
            <div className="font-bold tabular-nums text-foreground">{fmt(c.impact)}</div>
            <div className="text-[11px] text-muted-foreground">at stake</div>
          </div>
        ) : null}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3 text-sm">
          <div className="rounded-xl bg-muted/50 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><HelpCircle className="h-3.5 w-3.5" />Why this happens</div>
            <p className="text-muted-foreground">{c.why}</p>
          </div>
          <div className="rounded-xl bg-emerald-50/60 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700"><Wrench className="h-3.5 w-3.5" />How to fix</div>
            <ol className="list-decimal space-y-0.5 pl-5 text-foreground">{c.fix.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {c.items.slice(0, 12).map((id) => (
              <button key={id} type="button" onClick={() => onOpen(id, names.get(id))}
                className="rounded-full bg-background px-2.5 py-1 text-xs text-foreground ring-1 ring-border hover:text-[#800000] hover:ring-[#800000]/40">
                <span className="font-mono text-muted-foreground">{id}</span> {names.get(id)}
              </button>
            ))}
            {c.items.length > 12 && <span className="px-1 py-1 text-xs text-muted-foreground">+{c.items.length - 12} more</span>}
          </div>
          <Button variant="outline" size="sm" onClick={() => onFilter(active ? null : c.code)} className="gap-1.5">
            <LayoutList className="h-3.5 w-3.5" />{active ? "Show all items again" : "Show only these items in the list below"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ScanView({ scan, onOpen }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("problems");
  const [cause, setCause] = useState(null);
  const [showNotes, setShowNotes] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const names = useMemo(() => new Map(scan.items.map((i) => [i.itcd, i.name])), [scan]);
  const problemCauses = scan.causes.filter((c) => c.severity !== "info");
  const noteCauses = scan.causes.filter((c) => c.severity === "info");
  const t = scan.totals;
  const needAction = t.items_error + t.items_warn;

  const rows = scan.items.filter((i) => {
    if (status === "problems" && i.status === "ok") return false;
    if (status === "ok" && i.status !== "ok") return false;
    if (cause && !i.findings.some((f) => f.code === cause)) return false;
    const s = q.trim().toLowerCase();
    return !s || String(i.itcd).includes(s) || i.name.toLowerCase().includes(s) || (i.code || "").toLowerCase().includes(s);
  });

  return (
    <div className="space-y-5">
      {/* Month verdict */}
      <section className={`overflow-hidden rounded-3xl border bg-gradient-to-br via-background to-background shadow-sm ${t.items_error ? "border-rose-200 from-rose-50" : t.items_warn ? "border-amber-200 from-amber-50" : "border-emerald-200 from-emerald-50"}`}>
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className={`rounded-2xl p-3 ${needAction ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
              {needAction ? <AlertTriangle className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {scan.period.label} · every item checked
                <button type="button" onClick={() => exportScan(scan).catch((e) => toast.error(e.message))}
                  className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 normal-case tracking-normal text-[#800000] ring-1 ring-border hover:ring-[#800000]/40">
                  <Download className="h-3 w-3" />Excel
                </button>
              </div>
              <div className="text-xl font-bold text-foreground sm:text-2xl">
                {needAction ? `${needAction} item${needAction === 1 ? "" : "s"} need attention` : "All items reconcile"}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {needAction
                  ? `${problemCauses.length} kind${problemCauses.length === 1 ? "" : "s"} of problem — fix them by cause below, biggest first. Click any item for its full trace.`
                  : "Every rate matches its source, production costing and the JVs."}
              </p>
              {scan.calculated_at && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Calculated {new Date(scan.calculated_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
                  {scan.cached ? ` (saved result — refreshes after ${scan.cache_minutes} min, or press ↻ to recalculate now)` : ""}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
            {[["Checked", t.items_checked, "text-foreground"], ["Need attention", needAction, needAction ? "text-rose-600" : "text-foreground"], ["Fine", t.items_ok, "text-emerald-600"]].map(([k, v, cls]) => (
              <div key={k} className="rounded-2xl bg-background/80 px-3 py-2.5 ring-1 ring-border sm:px-5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">{k}</div>
                <div className={`text-lg font-bold tabular-nums ${cls}`}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Month-level checks */}
      <Card title="Month checks" icon={ShieldCheck}>
        <ul className="divide-y divide-border">
          {scan.month_checks.map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-2.5 text-sm">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{c.title}</div>
                <div className="text-muted-foreground">{c.detail}</div>
                {c.why && <div className={`text-xs ${c.ok ? "text-muted-foreground" : "text-amber-700"}`}>{c.why}</div>}
              </div>
              {c.amount ? <span className="tabular-nums text-sm font-semibold text-rose-600">{fmtS(c.amount)}</span> : null}
            </li>
          ))}
        </ul>
      </Card>

      {/* Problems grouped by cause */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What is wrong — grouped by cause</h3>
        {problemCauses.length === 0 && (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 text-sm text-emerald-900">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />No problems found for any item.
          </div>
        )}
        {problemCauses.map((c) => (
          <CauseCard key={c.code} c={c} names={names} active={cause === c.code} onOpen={onOpen}
            onFilter={(code) => { setCause(code); setStatus("all"); }} />
        ))}
        {noteCauses.length > 0 && (
          <div className="rounded-2xl border border-border bg-background">
            <button type="button" onClick={() => setShowNotes((s) => !s)} className="flex w-full items-center gap-2 p-4 text-left text-sm">
              <Info className="h-4 w-4 text-sky-500" />
              <span className="flex-1 text-foreground"><b>{noteCauses.length}</b> thing{noteCauses.length === 1 ? "" : "s"} worth knowing — not errors</span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showNotes ? "rotate-180" : ""}`} />
            </button>
            {showNotes && (
              <div className="space-y-2 border-t border-border p-3">
                {noteCauses.map((c) => (
                  <CauseCard key={c.code} c={c} names={names} active={cause === c.code} onOpen={onOpen}
                    onFilter={(code) => { setCause(code); setStatus("all"); }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Item list */}
      <Card title="Items" icon={LayoutList}
        right={cause && (
          <button type="button" onClick={() => setCause(null)} className="inline-flex items-center gap-1 rounded-full bg-[#800000]/10 px-2.5 py-1 text-xs font-medium text-[#800000]">
            {scan.causes.find((c) => c.code === cause)?.label}<X className="h-3 w-3" />
          </button>
        )}>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, code or ITCD"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none" />
          </div>
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {[["problems", `Need attention (${needAction})`], ["all", `All (${t.items_checked})`], ["ok", `Fine (${t.items_ok})`]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setStatus(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${status === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
            ))}
          </div>
        </div>
        {/* Phones: one card per item */}
        <div className="space-y-2 md:hidden">
          {rows.slice(0, 400).map((i) => {
            const st = STATUS[i.status];
            const list = i.findings.filter((f) => !cause || f.code === cause);
            return (
              <button key={i.itcd} type="button" onClick={() => onOpen(i.itcd, i.name)}
                className="block w-full rounded-xl border border-border p-3 text-left text-sm hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{i.name}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{i.itcd}{i.code ? ` · ${i.code}` : ""} · {i.category}</div>
                  </div>
                  <Chip className={st.chip}><span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}</Chip>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{(cause ? list[0]?.title : i.top) || (i.notes ? `${i.notes} note(s)` : "—")}</div>
                <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                  <div><div className="text-muted-foreground">Largest</div><div className="tabular-nums">{i.largest ? fmt(i.largest) : "—"}</div></div>
                  <div><div className="text-muted-foreground">Rate</div><div className="tabular-nums">{fmtR(i.rate)}</div></div>
                  <div><div className="text-muted-foreground">Closing</div><div className="tabular-nums">{fmt(i.closing_value)}</div></div>
                </div>
              </button>
            );
          })}
          {rows.length === 0 && <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No items match.</div>}
        </div>
        <div className="hidden max-h-[70vh] overflow-auto rounded-xl border border-border md:block">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 z-10 bg-muted/50">
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Main problem</th>
                <th className="px-3 py-2 text-right font-medium">Largest issue</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Closing value</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, 400).map((i) => {
                const st = STATUS[i.status];
                const isOpen = expanded === i.itcd;
                const list = i.findings.filter((f) => !cause || f.code === cause);
                return (
                  <FragmentRow key={i.itcd}>
                    <tr className="cursor-pointer hover:bg-muted/50" onClick={() => setExpanded(isOpen ? null : i.itcd)}>
                      <td className="px-3 py-2">
                        <div className="text-foreground">{i.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{i.itcd}{i.code ? ` · ${i.code}` : ""} · {i.category}</div>
                      </td>
                      <td className="px-3 py-2"><Chip className={st.chip}><span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}</Chip></td>
                      <td className="max-w-[300px] px-3 py-2 text-muted-foreground">
                        <div className="truncate">{(cause ? list[0]?.title : i.top) || (i.notes ? `${i.notes} note(s)` : "—")}</div>
                        {i.problems > 1 && <div className="text-[11px] text-muted-foreground">+{i.problems - 1} more</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{i.largest ? fmt(i.largest) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtR(i.rate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(i.closing_value)}</td>
                      <td className="px-2 py-2"><ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} /></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/50">
                        <td colSpan={7} className="px-3 pb-3 pt-1">
                          {list.length === 0 ? (
                            <p className="py-2 text-sm text-emerald-700">Every check passed for this item.</p>
                          ) : (
                            <ul className="space-y-1.5 py-1">
                              {list.map((f) => (
                                <li key={f.id} className="flex items-start gap-2 text-sm">
                                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${(SEVERITY[f.severity] || SEVERITY.low).dot}`} />
                                  <div className="min-w-0 flex-1">
                                    <span className="font-medium text-foreground">{f.title}</span>
                                    <span className="text-muted-foreground"> — {f.what}</span>
                                  </div>
                                  {f.impact ? <span className="tabular-nums text-muted-foreground">{fmt(f.impact)}</span> : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          <Button size="sm" onClick={() => onOpen(i.itcd, i.name)} className="mt-1 gap-1.5 bg-[#800000] hover:bg-[#660000]">
                            <Stethoscope className="h-3.5 w-3.5" />Open full trace — rates, production, JVs
                          </Button>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No items match.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 400 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 400 of {rows.length}. Use the filter to narrow down.</p>}
        <p className="mt-2 text-xs text-muted-foreground">Sorted by status, then by the size of each item&apos;s largest issue. Click a row for its problems; open the full trace to see how every rate was built.</p>
      </Card>
    </div>
  );
}

function FragmentRow({ children }) {
  return <>{children}</>;
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
function ItemReconciliation() {
  const router = useRouter();
  const params = useSearchParams();
  const now = new Date();
  const [item, setItem] = useState(() => {
    const id = parseInt(params.get("itcd"));
    return id ? { itcd: id } : null;
  });
  const [month, setMonth] = useState(() => parseInt(params.get("month")) || (now.getMonth() === 0 ? 12 : now.getMonth()));
  const [year, setYear] = useState(() => parseInt(params.get("year")) || (now.getMonth() === 0 ? CY - 1 : CY));
  const [data, setData] = useState(null);   // one item's trace
  const [scan, setScan] = useState(null);   // every item, grouped by cause
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("diagnosis");
  const [focus, setFocus] = useState(null);
  const reqId = useRef(0);

  // No item picked → check every item. Item picked → its full trace.
  const load = useCallback(async (fresh = false) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    router.replace(item?.itcd ? `?itcd=${item.itcd}&month=${month}&year=${year}` : `?month=${month}&year=${year}`, { scroll: false });
    const qs = item?.itcd ? `itcd=${item.itcd}` : "scope=all";
    try {
      const res = await fetch(`/api/costing/item-reconciliation?${qs}&month=${month}&year=${year}${fresh ? "&fresh=1" : ""}`);
      const isJson = (res.headers.get("content-type") || "").includes("application/json");
      if (!isJson) {
        throw new Error(res.status === 504
          ? "The server took too long to respond. Please try again."
          : `The server returned an unexpected response (HTTP ${res.status}).`);
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (id !== reqId.current) return;
      if (item?.itcd) { setData(json); setFocus(null); } else setScan(json);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e.message);
      toast.error(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [item, month, year, router]);

  useEffect(() => { load(); }, [load]);
  // A scan belongs to one month — drop it when the month changes
  useEffect(() => { setScan(null); }, [month, year]);

  const traceOther = (itcd, name) => {
    if (!itcd) return;
    setData(null);
    setItem({ itcd, name });
    setTab("diagnosis");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const backToAll = () => {
    reqId.current++;
    setItem(null);
    setData(null);
    setError(null);
    setLoading(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const jump = (ref) => {
    setTab(ref.tab);
    setFocus(ref.line_id ?? ref.key ?? null);
    if (ref.key) setTimeout(() => document.getElementById(`prod-${ref.key}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };

  const v = data?.verdict;
  const tone = !v ? null : v.status === "ok"
    ? { box: "border-emerald-200 from-emerald-50", icon: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 }
    : v.status === "warn"
      ? { box: "border-amber-200 from-amber-50", icon: "bg-amber-100 text-amber-700", Icon: AlertTriangle }
      : { box: "border-rose-200 from-rose-50", icon: "bg-rose-100 text-rose-700", Icon: AlertTriangle };

  const tabs = data ? [
    ["diagnosis", "Diagnosis", Stethoscope, v.problems || null],
    ["rate", "Rate build-up", Calculator, null],
    ["production", "Production", Factory, data.production.groups.length || null, true],
    ["consumption", "Consumption", Package, data.consumption.length || null, true],
    ["gl", "GL & JVs", Landmark, null],
    ["movements", "Movements", ListChecks, data.movements.length || null, true],
    ["history", "History", History, null],
  ] : [];

  return (
    <CostingFrame>
        <LabHeader
          icon={Stethoscope}
          breadcrumb="Costing"
          title="Item Cost Trace"
          subtitle="Every item checked automatically — what is wrong, why, and how to fix it"
          actions={
            <Link href="/accounting/costing" className="max-sm:!flex-none">
              <IconBtn icon={ArrowLeft} label="Back to Costing" />
            </Link>
          }
        />

        {/* Item + period toolbar */}
        <section className="rounded-xl border border-border bg-background">
          <div className="flex flex-wrap items-center gap-2 p-3">
            {item && (
              <Button variant="outline" size="sm" onClick={backToAll} className="h-9 gap-1.5">
                <LayoutList className="h-4 w-4" />All items
              </Button>
            )}
            <ItemPicker value={item} onPick={(it) => traceOther(it.itcd, it.name)} />
            <PeriodPicker month={month} year={year} years={YEARS} onMonth={setMonth} onYear={setYear} />
            <IconBtn icon={RefreshCw} label="Recalculate from the latest data" onClick={() => load(true)} disabled={loading} spin={loading} />
          </div>
        </section>

        {loading && (item ? !data : !scan) && (
          <div className="space-y-4">
            <div className="h-40 animate-pulse rounded-3xl bg-muted" />
            <div className="h-10 animate-pulse rounded-2xl bg-muted" />
            <p className="text-center text-sm text-muted-foreground">
              {item
                ? `Tracing item ${item.itcd} for ${MONTHS[month - 1]} ${year}: stock report, last month, production costing and JVs…`
                : `Checking every item for ${MONTHS[month - 1]} ${year}: stock report, last month, production costing, CC and JVs… (about 20–40 s, then cached for 10 minutes)`}
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1"><div className="font-semibold">{item ? "Couldn't trace this item" : "Couldn't check the items"}</div><div>{error}</div></div>
            <Button size="sm" variant="outline" onClick={() => load()}>Try again</Button>
          </div>
        )}

        {!item && scan && (
          <div className={`transition-opacity ${loading ? "pointer-events-none opacity-50" : ""}`}>
            <ScanView scan={scan} onOpen={traceOther} />
          </div>
        )}

        {item && data && (
          <div className={`space-y-5 transition-opacity ${loading ? "pointer-events-none opacity-50" : ""}`}>
            {/* Verdict */}
            <section className={`overflow-hidden rounded-3xl border bg-gradient-to-br via-background to-background shadow-sm ${tone.box}`}>
              <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <div className={`rounded-2xl p-3 ${tone.icon}`}><tone.Icon className="h-7 w-7" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {data.period.label} · ITCD {data.item.itcd}{data.item.code ? ` · ${data.item.code}` : ""}
                      <button type="button" onClick={() => exportTrace(data).catch((e) => toast.error(e.message))}
                        className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 normal-case tracking-normal text-[#800000] ring-1 ring-border hover:ring-[#800000]/40">
                        <Download className="h-3 w-3" />Excel
                      </button>
                    </div>
                    <div className="text-lg font-bold leading-snug text-foreground sm:text-xl">{data.item.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Chip>{data.item.category || "No category"}</Chip>
                      {data.item.carries_cc && <Chip className="bg-violet-50 text-violet-700">Carries CC</Chip>}
                      <Chip className={data.item.acno ? "bg-muted text-muted-foreground" : "bg-rose-50 text-rose-700"}>{data.item.acno ? `GL ${data.item.acno} · ${data.item.acname || ""}` : "No stock account"}</Chip>
                      <Chip className={data.period.locked ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}>{data.period.locked ? <><Lock className="h-3 w-3" />Locked</> : <><Unlock className="h-3 w-3" />Open</>}</Chip>
                    </div>
                    <p className="mt-2 text-sm text-foreground">
                      {v.status === "ok"
                        ? "Every rate rebuilt from source matches the stock report, production costing and the JVs."
                        : `${v.problems} problem${v.problems === 1 ? "" : "s"} found${v.largest ? ` — the largest is ${fmt(v.largest)}` : ""}. Start with the first one in Diagnosis.`}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
                  {[
                    ["Opening rate", fmtR(data.report.opening_rate), `${fmtQ(data.report.opening_qty)} qty`],
                    ["Blended rate", fmtR(data.report.blended_rate), data.item.carries_cc ? `RM ${fmtR(data.blended.rm_rate)} + CC ${fmtR(data.blended.cc_rate)}` : "issues · sales · closing"],
                    ["Closing value", fmt(data.report.closing_value), `${fmtQ(data.report.closing_qty)} qty`],
                  ].map(([k, val, sub]) => (
                    <div key={k} className="rounded-2xl bg-background/80 px-2 py-2.5 ring-1 ring-border sm:px-4">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">{k}</div>
                      <div className="text-sm font-bold tabular-nums text-foreground sm:text-base">{val}</div>
                      <div className="text-[10px] text-muted-foreground sm:text-[11px]">{sub}</div>
                    </div>
                  ))}
                </div>
              </div>
              {!data.found_in_report && (
                <div className="flex items-center gap-2 border-t border-border bg-background/60 px-5 py-2.5 text-xs text-muted-foreground sm:px-6">
                  <Info className="h-3.5 w-3.5" />This item has no opening stock and no movement in {data.period.label}.
                </div>
              )}
            </section>

            {/* Tabs */}
            <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
              {tabs.map(([key, labelText, Icon, count, neutral]) => (
                <button key={key} type="button" onClick={() => { setTab(key); setFocus(null); }}
                  className={`flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition sm:flex-1 ${tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="h-4 w-4" />{labelText}
                  {count ? <span className={`rounded-full px-1.5 text-[11px] font-semibold ${neutral ? "bg-muted text-muted-foreground" : "bg-rose-100 text-rose-700"}`}>{count}</span> : null}
                </button>
              ))}
            </nav>

            {tab === "diagnosis" && <DiagnosisTab data={data} onJump={jump} />}
            {tab === "rate" && <RateTab data={data} />}
            {tab === "production" && <ProductionTab data={data} focus={focus} onTrace={traceOther} />}
            {tab === "consumption" && <ConsumptionTab data={data} focus={focus} onTrace={traceOther} />}
            {tab === "gl" && <GlTab data={data} />}
            {tab === "movements" && <MovementsTab data={data} focusLine={typeof focus === "number" ? focus : null} />}
            {tab === "history" && <HistoryTab data={data} />}

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
              <button type="button" onClick={backToAll} className="inline-flex items-center gap-1 hover:text-foreground">
                <LayoutList className="h-3.5 w-3.5" />Back to all items
              </button>
            </div>
          </div>
        )}
    </CostingFrame>
  );
}

// Settings → Features "costing.reconciliation" — the API refuses too (404).
export default function ItemReconciliationPage() {
  const features = useFeatures();
  if (features.isLoading) return null;
  if (!features.on("costing.reconciliation")) {
    return (
      <CostingFrame>
        <Note tone="muted" icon={Info} title="Item cost trace is off.">
          Costing reconciliation is switched off on Settings → Features.
        </Note>
      </CostingFrame>
    );
  }
  return (
    <Suspense fallback={null}>
      <ItemReconciliation />
    </Suspense>
  );
}
