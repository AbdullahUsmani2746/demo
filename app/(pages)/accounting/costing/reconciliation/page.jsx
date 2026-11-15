"use client";

// Stock ↔ GL reconciliation (ported from Accounting) — why the Stock Activity
// With Rate closing value and the stock accounts on the Balance Sheet differ,
// line by line. Data: GET /api/costing/stock-reconciliation (lib/reconciliation/stockGl.js).
// Settings → Features "costing.reconciliation" switches the screen off.

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  ArrowLeft, RefreshCw, Scale, CheckCircle2, AlertTriangle, ChevronDown,
  FileCheck2, FileX2, HelpCircle, Wrench, Search, ListChecks, Layers,
  ShieldAlert, Info, Stethoscope, ArrowDownUp, BookOpen, Download, PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFeatures } from "@/hooks/useFeatures";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import { downloadXlsx, r2 } from "@/lib/reconciliation/exportXlsx";
import { LabHeader, Chip, CHIP, TH, CODE_CHIP } from "@/components/Material/shared/LabUI";
import {
  CostingFrame, PeriodPicker, Note, SkeletonRows, IconBtn, Segmented, SearchBox, MONTHS, TONE_TEXT,
} from "@/components/Costing/CostingUI";

// ─────────────────────────────────────────────────────────────
// Constants & formatters
// ─────────────────────────────────────────────────────────────
const CY = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CY - i);
const TRACE_PATH = "/accounting/costing/item-reconciliation";

const N = (v) => Number(v) || 0;
const fmt = (v) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(N(v));
const fmtQ = (v) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 }).format(N(v));
const fmtS = (v) => `${N(v) > 0 ? "+" : N(v) < 0 ? "−" : ""}${fmt(Math.abs(N(v)))}`;
const fmtShort = (v) => {
  const a = Math.abs(N(v));
  const s = a >= 1e7 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e5 ? `${(a / 1e3).toFixed(0)}K` : fmt(a);
  return `${N(v) < 0 ? "−" : ""}${s}`;
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" }) : "—");
// + = GL higher than the stock report, − = lower
const signTone = (v) => (N(v) > 0 ? TONE_TEXT.bad : N(v) < 0 ? "text-sky-700 dark:text-sky-300" : TONE_TEXT.muted);

// What kind of line a bridge row is — tells the user whether to act
const KIND = {
  fix: { label: "Needs fixing", tone: "bad", dot: "bg-red-500" },
  method: { label: "Method difference", tone: "warn", dot: "bg-amber-500" },
  review: { label: "Review", tone: "warn", dot: "bg-amber-500" },
  earlier: { label: "From an earlier month", tone: "muted", dot: "bg-slate-400" },
  none: { label: "No action", tone: "ok", dot: "bg-emerald-500" },
};
const OFFSET = { label: "Offset — account balances", tone: "ok", dot: "bg-emerald-400" };

// Every line of the bridge from stock report closing to GL closing.
// amount(component) returns this line's share of the GL − report difference.
const JV_PARTS = [
  { key: "production", what: "goods produced", jv: "COGM" },
  { key: "consumption", what: "materials used in production", jv: "COGM" },
  { key: "direct", what: "direct (Cleaning / Lab / QC) issues", jv: "Direct Issuance" },
  { key: "sales", what: "cost of goods sold", jv: "COGS" },
];
const BRIDGE = [
  {
    cause: "carried", kind: "earlier", label: "Difference carried in from earlier months",
    means: "GL and stock report were already apart when last month ended. This month just inherits it — the cause is in an earlier month.",
    amount: (c) => (c.key === "opening" ? N(c.carried) : null),
  },
  {
    cause: "opening_drift", kind: "fix", label: "Opening stock changed after last month was locked",
    means: "This month's opening (saved when last month was locked) no longer equals last month's closing in the stock report.",
    amount: (c) => (c.key === "opening" ? -N(c.snapshotDrift) : null),
  },
  {
    cause: "purchases", kind: "fix", label: "Purchases post a different amount to stock",
    means: "Purchase vouchers moved the stock account by a different amount than the stock report counts (the category's Purchase account is not the stock account, or freight/tax lines were posted to stock).",
    amount: (c) => (c.key === "purchases" ? N(c.diff) : null),
  },
  ...JV_PARTS.flatMap((p) => [
    {
      cause: `${p.key}_missing`, kind: "fix", label: `${p.jv} JV not posted — ${p.what}`,
      means: `The stock report counts ${p.what}, but the ${p.jv} JV for this month is not posted, so the GL has not moved.`,
      amount: (c) => (c.key === p.key && !c.posted ? N(c.diff) : null),
    },
    {
      cause: `${p.key}_stale`, kind: "fix", label: `${p.jv} JV out of date — ${p.what}`,
      means: `The ${p.jv} JV was posted, then costing or vouchers changed. The posted amount no longer equals what the JV would be today.`,
      amount: (c) => (c.key === p.key && c.posted ? N(c.stale) : null),
    },
    {
      cause: `${p.key}_method`, kind: "method", label: `${p.jv} values ${p.what} differently`,
      means: `Even a fresh ${p.jv} JV would differ from the stock report, because the two use different rates or quantities for ${p.what}.`,
      amount: (c) => (c.key === p.key && c.posted ? N(c.method) : null),
    },
  ]),
  {
    cause: "uncovered", kind: "fix", label: "Material issues no JV takes out of the GL",
    means: "Issues with no plan link and no Cleaning/Lab/QC label reduce stock in the report, but no JV credits the stock account.",
    amount: (c) => (c.key === "uncovered" ? N(c.diff) : null),
  },
  {
    cause: "issue_other", kind: "review", label: "Unclassified issue value",
    means: "Part of the issue value belongs to no plan, unplanned or direct group.",
    amount: (c) => (c.key === "issueOther" ? N(c.diff) : null),
  },
  {
    cause: "manual", kind: "review", label: "Other JVs posted to stock accounts",
    means: "Journal vouchers other than the costing JVs move the GL; the stock report never sees them. Usually corrections of earlier gaps.",
    amount: (c) => (c.key === "manual" ? N(c.diff) : null),
  },
  {
    cause: "other_postings", kind: "fix", label: "Other voucher types posting to stock",
    means: "Only purchases and the costing JVs should post to stock accounts. Some other voucher type is mapped to one.",
    amount: (c) => (c.key === "other" ? N(c.diff) : null),
  },
  {
    cause: "transfers", kind: "none", label: "Godown transfers",
    means: "Transfers between godowns don't change total stock and have no GL posting.",
    amount: (c) => (c.key === "transfers" ? N(c.diff) : null),
  },
  {
    cause: "rounding", kind: "none", label: "Rounding in the stock report",
    means: "Rates are calculated per item and rounded.",
    amount: (c) => (c.key === "rounding" ? N(c.diff) : null),
  },
];

// Item lists: columns per list. Type: n = amount, q = qty, s = signed, d = date, v = voucher
const ITEM_LISTS = {
  uncoveredIssuance: {
    label: "Issues with no JV",
    hint: "Issued in the stock report, but no JV credits the stock account.",
    cols: [["itcd", "Item"], ["name", "Name"], ["qty", "Qty", "q"], ["rate", "Rate", "n"], ["value", "Value", "n"]],
    sum: "value",
  },
  openingDrift: {
    label: "Opening drift",
    hint: "This month's opening vs last month's closing in the stock report.",
    cols: [["itcd", "Item"], ["name", "Name"], ["reason", "Reason"], ["prev_qty", "Last closing qty", "q"], ["snap_qty", "Opening qty", "q"], ["diff", "Difference", "s"]],
    sum: "diff",
  },
  rateMismatch: {
    label: "Rate mismatch",
    hint: "Materials used in production: COGM rate vs stock report rate.",
    cols: [["itcd", "Item"], ["name", "Name"], ["qty", "Qty", "q"], ["cogm_rate", "COGM rate", "n"], ["report_rate", "Report rate", "n"], ["diff", "Difference", "s"]],
    sum: "diff",
  },
  manualJvs: {
    label: "Other JVs",
    hint: "Journal vouchers (other than the costing JVs) posted to stock accounts this month.",
    cols: [["vr_no", "Voucher", "v"], ["dated", "Date", "d"], ["rmk1", "Type"], ["rmk", "Remarks"], ["net", "Effect on stock", "s"]],
    sum: "net",
  },
  negativeClosing: {
    label: "Negative stock",
    hint: "Items that close the month below zero.",
    cols: [["itcd", "Item"], ["name", "Name"], ["qty", "Closing qty", "q"], ["rate", "Rate", "n"], ["value", "Value", "n"]],
    sum: "value",
  },
  noCostProduction: {
    label: "Uncosted production",
    hint: "Produced this month without a production costing entry.",
    cols: [["itcd", "Item"], ["name", "Name"], ["qty", "Produced qty", "q"]],
  },
  missingAcno: {
    label: "No stock account",
    hint: "Items with stock value and no stock account (category or 'Stock' Account Setting).",
    cols: [["itcd", "Item"], ["name", "Name"], ["category", "Category"], ["closing_value", "Closing value", "n"]],
    sum: "closing_value",
  },
};

const isNum = (type) => type && type !== "d" && type !== "v";

function VoucherNo({ row, children }) {
  const href = voucherHref(row);
  const text = children ?? row.vr_no ?? row.tran_id;
  if (!href) return <span className="tabular-nums">{text}</span>;
  return <Link href={href} className="font-medium tabular-nums text-primary hover:underline">{text}</Link>;
}

function Cell({ row, k, type }) {
  const v = row[k];
  if (k === "itcd") return <span className="font-mono">{v}</span>;
  if (type === "v") return <VoucherNo row={row}>{v ?? row.tran_id}</VoucherNo>;
  if (type === "n") return fmt(v);
  if (type === "q") return fmtQ(v);
  if (type === "s") return <span className={cn("font-semibold", signTone(v))}>{fmtS(v)}</span>;
  if (type === "d") return fmtDate(v);
  return v || "—";
}

// Build bridge rows from account components (one account or all of them)
function buildBridge(accounts, findings) {
  return BRIDGE.map((b) => {
    const perAccount = [];
    for (const a of accounts) {
      let amt = 0;
      for (const c of a.components) {
        const v = b.amount(c);
        if (v != null) amt += v;
      }
      if (Math.abs(amt) >= 1) perAccount.push({ acno: a.acno, acname: a.acname, amount: amt, balanced: a.balanced });
    }
    const amount = perAccount.reduce((s, x) => s + x.amount, 0);
    const accSet = new Set(accounts.map((a) => a.acno));
    const fs = findings.filter((f) => f.cause === b.cause && accSet.has(f.acno));
    // Offset: every account this line touches still balances (another line, usually a manual JV, cancels it)
    const resolved = perAccount.length > 0 && perAccount.every((p) => p.balanced);
    return { ...b, amount, perAccount, findings: fs, resolved, items: fs.find((f) => f.items)?.items };
  }).filter((r) => r.perAccount.length > 0);
}

// Excel: the bridge (total and per account), raw figures, item lists, data checks
function exportReconciliation(data, accounts, findings) {
  const p = data.period;
  const bridgeRows = (accs, start) => {
    let running = start;
    const out = [{ Step: "Start: stock report closing", Amount: "", "Running total": r2(start) }];
    for (const r of buildBridge(accs, findings)) {
      running += r.amount;
      const first = r.findings[0];
      out.push({
        Step: r.label, Kind: r.resolved ? OFFSET.label : KIND[r.kind].label, Amount: r2(r.amount), "Running total": r2(running),
        Accounts: r.perAccount.map((x) => `${x.acno} ${x.acname}`).join(", "), Meaning: r.means, Why: first?.why || "", "How to fix": first?.fix?.join(" ") || "",
      });
    }
    out.push({ Step: "End: GL closing", Amount: "", "Running total": r2(running) });
    return out;
  };
  const sheets = [
    ["Bridge - all accounts", bridgeRows(accounts, data.totals.report)],
    ...accounts.map((a) => [`Bridge ${a.acno}`, bridgeRows([a], a.report_closing)]),
    ["Raw figures", accounts.flatMap((a) => a.components.filter((c) => Math.abs(c.report) >= 1 || Math.abs(c.ledger) >= 1 || Math.abs(c.diff) >= 1).map((c) => ({
      Account: `${a.acno} ${a.acname}`, Movement: c.label, "Stock report": r2(c.report), "GL posted": r2(c.ledger), Difference: r2(c.diff),
      "JV posted": c.jv ? (c.posted ? "Yes" : "No") : "", "JV if generated today": c.jv && c.posted ? r2(c.now) : "",
    })))],
    ...Object.entries(ITEM_LISTS).map(([key, def]) => [def.label, (data.issues?.[key] || []).map((row) =>
      Object.fromEntries(def.cols.map(([k, labelText, type]) => [labelText, type === "d" ? fmtDate(row[k]) : isNum(type) ? r2(row[k]) : row[k] ?? ""])))]),
    ["Data checks", data.checks.map((c) => ({ Check: c.title, Count: c.count, What: c.what, Why: c.why, Fix: c.fix.join(" ") }))],
  ];
  return downloadXlsx(`Stock GL reconciliation ${p.year}-${String(p.month).padStart(2, "0")}.xlsx`, sheets);
}

// ─────────────────────────────────────────────────────────────
// The bridge: stock report closing → each cause → GL closing
// ─────────────────────────────────────────────────────────────
function Bridge({ accounts, findings, reportClosing, glClosing, tolerance, onItems, period }) {
  const rows = useMemo(() => buildBridge(accounts, findings), [accounts, findings]);
  const [open, setOpen] = useState(null);
  const sorted = [...rows].sort((a, b) => {
    const order = { fix: 0, review: 1, method: 2, earlier: 3, none: 4 };
    return Number(a.resolved) - Number(b.resolved) || order[a.kind] - order[b.kind] || Math.abs(b.amount) - Math.abs(a.amount);
  });
  let running = reportClosing;
  const diff = glClosing - reportClosing;
  const explained = rows.reduce((s, r) => s + r.amount, 0);
  const ok = Math.abs(diff) < tolerance;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="hidden grid-cols-12 gap-2 bg-primary px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-primary-foreground md:grid">
        <div className="col-span-7">Step</div>
        <div className="col-span-2 text-right">Amount</div>
        <div className="col-span-3 text-right">Running total</div>
      </div>

      <div className="grid grid-cols-12 items-center gap-2 border-b border-border bg-muted/40 px-4 py-3 text-sm">
        <div className="col-span-12 font-semibold text-foreground md:col-span-7">Start: Stock report closing value</div>
        <div className="col-span-6 md:col-span-2" />
        <div className="col-span-6 text-right font-semibold tabular-nums md:col-span-3">{fmt(reportClosing)}</div>
      </div>

      {sorted.length === 0 && (
        <div className={cn("flex items-center gap-2 px-4 py-4 text-sm", TONE_TEXT.ok)}>
          <CheckCircle2 className="h-4 w-4" />No differences — every movement matches.
        </div>
      )}

      {sorted.map((r) => {
        running += r.amount;
        const k = r.resolved ? OFFSET : KIND[r.kind];
        const isOpen = open === r.cause;
        const first = r.findings[0];
        return (
          <div key={r.cause} className="border-b border-border last:border-b-0">
            <button type="button" onClick={() => setOpen(isOpen ? null : r.cause)}
              className={cn("grid w-full grid-cols-12 items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40", isOpen && "bg-muted/40")}>
              <div className="col-span-12 flex items-start gap-2.5 md:col-span-7">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", k.dot)} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-foreground">{r.label}</span>
                    <Chip tone={k.tone}>{k.label}</Chip>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{r.means}</div>
                </div>
              </div>
              <div className={cn("col-span-6 text-right font-semibold tabular-nums md:col-span-2", signTone(r.amount))}>{fmtS(r.amount)}</div>
              <div className="col-span-6 flex items-center justify-end gap-2 text-right tabular-nums text-muted-foreground md:col-span-3">
                {fmt(running)}
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")} />
              </div>
            </button>
            {isOpen && (
              <div className="space-y-3 bg-muted/20 px-4 pb-4 pt-1 text-sm md:pl-9">
                {r.perAccount.length > 0 && (
                  <div className="divide-y divide-border rounded-lg border border-border bg-background">
                    {r.perAccount.map((p) => {
                      const f = r.findings.find((x) => x.acno === p.acno);
                      return (
                        <div key={p.acno} className="flex flex-col gap-1 px-3 py-2 md:flex-row md:items-start md:gap-3">
                          <div className="flex items-start justify-between gap-2 md:w-60 md:shrink-0">
                            <span><span className={CODE_CHIP}>{p.acno}</span> {p.acname}</span>
                            <span className={cn("font-semibold tabular-nums md:hidden", signTone(p.amount))}>{fmtS(p.amount)}</span>
                          </div>
                          <div className="min-w-0 flex-1 text-muted-foreground">{f?.what || "—"}</div>
                          <div className={cn("hidden whitespace-nowrap text-right font-semibold tabular-nums md:block", signTone(p.amount))}>{fmtS(p.amount)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {first && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><HelpCircle className="h-3.5 w-3.5" />Why this happens</div>
                      <p className="text-foreground/80">{first.why}</p>
                    </div>
                    <div className={cn("rounded-lg p-3", CHIP.ok)}>
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"><Wrench className="h-3.5 w-3.5" />How to fix</div>
                      <ol className="list-decimal space-y-0.5 pl-5">{first.fix.map((s, i) => <li key={i}>{s}</li>)}</ol>
                    </div>
                  </div>
                )}
                {r.resolved && <p className={cn("text-xs", TONE_TEXT.ok)}>On these accounts this line is offset by another line (usually a JV that already corrected it), so the account balances. Fix it at the source only if you also want to reverse that correction.</p>}
                {r.items && (
                  <Button variant="outline" size="sm" onClick={() => onItems(r.items, r.perAccount.length === 1 ? r.perAccount[0].acno : null, r.label)} className="gap-1.5">
                    <Search className="h-3.5 w-3.5" />See the items behind this
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="grid grid-cols-12 items-center gap-2 border-t-2 border-primary bg-muted/50 px-4 py-3 text-sm">
        <div className="col-span-12 font-semibold text-foreground md:col-span-7">End: GL closing balance (Balance Sheet)</div>
        <div className={cn("col-span-6 text-right font-semibold tabular-nums md:col-span-2", ok ? TONE_TEXT.ok : TONE_TEXT.bad)}>
          {ok ? "Balanced" : `${fmtS(diff)} total`}
        </div>
        <div className="col-span-6 text-right font-bold tabular-nums md:col-span-3">{fmt(glClosing)}</div>
      </div>
      {Math.abs(explained - diff) >= 1 && (
        <div className={cn("border-t border-border px-4 py-2 text-xs", CHIP.warn)}>
          {fmtS(diff - explained)} is not explained by any line above. Refresh; if it stays, report it.
        </div>
      )}
      <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className={TONE_TEXT.bad}>+</span> means the GL is higher than the stock report on that line, <span className="text-sky-700 dark:text-sky-300">−</span> means it is lower. Lines that need fixing are listed first, biggest first. Click a line for details. {period && `${MONTHS[period.month - 1]} ${period.year}.`}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Item lists — searchable, sortable, with totals and trace links.
// Table from md up, cards on a phone.
// ─────────────────────────────────────────────────────────────
function ItemTable({ listKey, rows, period }) {
  const def = ITEM_LISTS[listKey];
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: def.sum || null, dir: -1 });
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let out = (rows || []).filter((r) => !s || def.cols.some(([k]) => String(r[k] ?? "").toLowerCase().includes(s)));
    if (sort.key) {
      const type = def.cols.find(([k]) => k === sort.key)?.[2];
      out = [...out].sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        if (type === "s") return sort.dir * (Math.abs(N(av)) - Math.abs(N(bv)));
        if (isNum(type)) return sort.dir * (N(av) - N(bv));
        return sort.dir * String(av ?? "").localeCompare(String(bv ?? ""));
      });
    }
    return out;
  }, [rows, q, sort, def]);

  if (!rows?.length) {
    return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing found — this check passed.</div>;
  }
  const total = def.sum ? filtered.reduce((s, r) => s + N(r[def.sum]), 0) : null;
  const sumType = def.cols.find(([k]) => k === def.sum)?.[2];
  const linkable = period && def.cols.some(([k]) => k === "itcd");
  const traceHref = (r) => `${TRACE_PATH}?itcd=${r.itcd}&month=${period.month}&year=${period.year}`;
  const [titleCol, ...restCols] = def.cols;

  return (
    <div className="space-y-2">
      <SearchBox value={q} onChange={setQ} placeholder="Filter this list" slash={false} className="w-full" />

      {/* md+: table */}
      <div className="hidden max-h-[60vh] overflow-auto rounded-xl border border-border md:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {def.cols.map(([k, labelText, type]) => (
                <th key={k} className={cn(TH, isNum(type) && "text-right")}>
                  <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))}
                    className="inline-flex items-center gap-1 uppercase">
                    {labelText}{sort.key === k && <ArrowDownUp className="h-3 w-3" />}
                  </button>
                </th>
              ))}
              {linkable && <th className={TH} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r, i) => (
              <tr key={i} className="hover:bg-muted/40">
                {def.cols.map(([k, , type]) => (
                  <td key={k} className={cn("px-3 py-2 text-foreground/90", isNum(type) && "text-right tabular-nums")}>
                    <Cell row={r} k={k} type={type} />
                  </td>
                ))}
                {linkable && (
                  <td className="px-3 py-2 text-right">
                    <Link href={traceHref(r)} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary hover:underline">
                      <Stethoscope className="h-3.5 w-3.5" />Trace
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {total != null && (
            <tfoot className="sticky bottom-0 bg-muted">
              <tr className="border-t-2 border-primary text-sm font-semibold">
                <td colSpan={def.cols.length - 1} className="px-3 py-2 text-muted-foreground">{filtered.length} row{filtered.length === 1 ? "" : "s"} · total</td>
                <td className="px-3 py-2 text-right tabular-nums">{sumType === "s" ? fmtS(total) : fmt(total)}</td>
                {linkable && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* phone: cards */}
      <div className="space-y-2 md:hidden">
        {filtered.map((r, i) => (
          <div key={i} className="rounded-xl border border-border bg-background p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 font-semibold">
                <Cell row={r} k={titleCol[0]} type={titleCol[2]} />
                {r.name && titleCol[0] === "itcd" && <span className="ml-1.5 font-normal text-foreground/80">{r.name}</span>}
              </div>
              {linkable && (
                <Link href={traceHref(r)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                  <Stethoscope className="h-3.5 w-3.5" />Trace
                </Link>
              )}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {restCols.filter(([k]) => !(k === "name" && titleCol[0] === "itcd")).map(([k, labelText, type]) => (
                <div key={k} className={cn("min-w-0", !isNum(type) && type !== "d" && "col-span-2")}>
                  <dt className="text-[11px] text-muted-foreground">{labelText}</dt>
                  <dd className={cn("break-words", isNum(type) && "tabular-nums")}><Cell row={r} k={k} type={type} /></dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {total != null && (
          <div className="flex items-center justify-between rounded-xl border-2 border-primary/30 bg-muted/50 px-3 py-2 text-sm font-semibold">
            <span className="text-muted-foreground">{filtered.length} row{filtered.length === 1 ? "" : "s"} · total</span>
            <span className="tabular-nums">{sumType === "s" ? fmtS(total) : fmt(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckCard({ c, onItems }) {
  return (
    <Note
      tone="warn"
      icon={ShieldAlert}
      title={c.title}
      action={c.items && (
        <Button variant="outline" size="sm" onClick={() => onItems(c.items, null, c.title)} className="shrink-0 bg-background">
          View ({c.count})
        </Button>
      )}
    >
      {c.what} {c.why} <b>Fix:</b> {c.fix.join(" ")}
    </Note>
  );
}

// Raw figures per account: what the stock report says vs what the GL says
function AccountFigures({ account, tolerance }) {
  const rows = account.components.filter((c) => Math.abs(c.diff) >= 1 || Math.abs(c.report) >= 1 || Math.abs(c.ledger) >= 1);
  const closingOk = Math.abs(account.diff) < tolerance;
  const jvChip = (c) => c.jv && <Chip tone={c.posted ? "ok" : "warn"}>{c.posted ? "JV posted" : "JV missing"}</Chip>;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-background md:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={TH}>Movement</th>
              <th className={cn(TH, "text-right")}>Stock report</th>
              <th className={cn(TH, "text-right")}>GL posted</th>
              <th className={cn(TH, "text-right")}>Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c) => {
              const off = Math.abs(c.diff) >= 1;
              return (
                <tr key={c.key} className={off ? "bg-red-50/40 dark:bg-red-950/20" : ""}>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={off ? "font-medium" : "text-muted-foreground"}>{c.label}</span>{jvChip(c)}
                    </div>
                    {c.jv && c.posted && off && <div className="text-[11px] text-muted-foreground">A JV generated today would be {fmt(c.now)}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(c.report)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(c.ledger)}</td>
                  <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", off ? signTone(c.diff) : TONE_TEXT.muted)}>{off ? fmtS(c.diff) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-primary bg-muted/50 font-semibold">
              <td className="px-3 py-2">Closing</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(account.report_closing)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(account.ledger_closing)}</td>
              <td className={cn("px-3 py-2 text-right tabular-nums", closingOk ? TONE_TEXT.ok : TONE_TEXT.bad)}>{closingOk ? "Balanced" : fmtS(account.diff)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map((c) => {
          const off = Math.abs(c.diff) >= 1;
          return (
            <div key={c.key} className={cn("rounded-xl border border-border bg-background p-3 text-sm", off && "border-red-200 dark:border-red-900")}>
              <div className="flex flex-wrap items-center gap-1.5 font-medium">{c.label}{jvChip(c)}</div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-right tabular-nums">
                <div><dt className="text-[11px] text-muted-foreground">Report</dt><dd>{fmt(c.report)}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">GL</dt><dd>{fmt(c.ledger)}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Diff</dt><dd className={cn("font-semibold", off ? signTone(c.diff) : TONE_TEXT.muted)}>{off ? fmtS(c.diff) : "—"}</dd></div>
              </dl>
              {c.jv && c.posted && off && <div className="mt-1 text-[11px] text-muted-foreground">A JV generated today would be {fmt(c.now)}</div>}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-primary/30 bg-muted/50 px-3 py-2 text-sm font-semibold">
          <span>Closing</span>
          <span className={closingOk ? TONE_TEXT.ok : TONE_TEXT.bad}>{closingOk ? "Balanced" : fmtS(account.diff)}</span>
        </div>
      </div>
    </>
  );
}

function LoadingState({ month }) {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <table className="w-full"><tbody><SkeletonRows rows={6} cols={3} /></tbody></table>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Checking {MONTHS[month - 1]}: running the stock report, last month&apos;s closing and the GL ledger…
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function StockReconciliationPage() {
  const features = useFeatures();
  if (!features.on("costing.reconciliation")) {
    return (
      <CostingFrame>
        <Header />
        <Note tone="muted" icon={PowerOff} title="Stock ↔ GL reconciliation is off.">
          It is switched off on Settings → Features.
        </Note>
      </CostingFrame>
    );
  }
  return <Reconciliation />;
}

function Header({ actions }) {
  return (
    <LabHeader
      icon={Scale}
      breadcrumb="Costing"
      title="Stock ↔ GL Reconciliation"
      subtitle="Why the stock report and the Balance Sheet stock accounts differ — line by line"
      actions={
        <>
          <Link href="/accounting/costing" className="max-sm:!flex-none">
            <IconBtn icon={ArrowLeft} label="Back to Costing" />
          </Link>
          {actions}
        </>
      }
    />
  );
}

function Reconciliation() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [year, setYear] = useState(now.getMonth() === 0 ? CY - 1 : CY);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("bridge");
  const [accountSel, setAccountSel] = useState(null);
  const [itemList, setItemList] = useState("uncoveredIssuance");
  const [sheet, setSheet] = useState(null); // { listKey, acno, title }
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/costing/stock-reconciliation?month=${month}&year=${year}`);
      const isJson = (res.headers.get("content-type") || "").includes("application/json");
      if (!isJson) {
        throw new Error(res.status === 504
          ? "The server took too long to respond. Please try again."
          : `The server returned an unexpected response (HTTP ${res.status}).`);
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setAccountSel((prev) => (json.accounts.some((a) => a.acno === prev) ? prev : json.accounts[0]?.acno ?? null));
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const tolerance = data?.tolerance ?? 10;
  const accounts = useMemo(() => (data?.accounts || []).map((a) => ({ ...a, balanced: Math.abs(a.diff) < tolerance })), [data, tolerance]);
  const findings = useMemo(() => data?.findings || [], [data]);
  const balanced = data && Math.abs(data.totals.diff) < tolerance;
  const account = accounts.find((a) => a.acno === accountSel);
  const toFix = useMemo(() => buildBridge(accounts, findings).filter((r) => r.kind === "fix" && !r.resolved), [accounts, findings]);

  const itemsFor = (listKey, acno) => {
    const rows = data?.issues?.[listKey] || [];
    return acno != null ? rows.filter((r) => r.acno == null || r.acno === acno) : rows;
  };
  const openItems = (listKey, acno, title) => setSheet({ listKey, acno, title });
  const listCounts = useMemo(
    () => Object.fromEntries(Object.keys(ITEM_LISTS).map((k) => [k, data?.issues?.[k]?.length || 0])),
    [data]
  );

  return (
    <CostingFrame>
      <Header
        actions={
          <>
            <IconBtn icon={BookOpen} label="How to read this page" onClick={() => setShowHelp((s) => !s)} />
            <IconBtn icon={Download} label="Download Excel" disabled={!data}
              onClick={() => exportReconciliation(data, accounts, findings).catch((e) => toast.error(e.message))} />
          </>
        }
      />

      {/* Period toolbar */}
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background p-3">
        <PeriodPicker month={month} year={year} years={YEARS} onMonth={setMonth} onYear={setYear} disabled={loading} />
        <IconBtn icon={RefreshCw} label="Refresh" onClick={load} disabled={loading} spin={loading} />
      </section>

      {showHelp && (
        <div className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm text-foreground/80 sm:grid-cols-3">
          <div><b className="text-foreground">1. Two numbers.</b> The <i>stock report</i> values stock from costing (qty × rate). The <i>GL</i> is the stock accounts on the Balance Sheet. They should be equal.</div>
          <div><b className="text-foreground">2. The bridge.</b> Starts at the stock report, adds each difference with a running total, and ends exactly at the GL. Every gap has a line and a reason.</div>
          <div><b className="text-foreground">3. What to do.</b> Red lines need fixing, amber lines are method differences or need review, grey/green lines need no action. Click any line for why and how to fix.</div>
        </div>
      )}

      {loading && !data && <LoadingState month={month} />}

      {error && !loading && (
        <Note tone="bad" icon={AlertTriangle} title="Couldn't run the reconciliation."
          action={<Button size="sm" variant="outline" onClick={load} className="bg-background">Try again</Button>}>
          {error}
        </Note>
      )}

      {data && (
        <div className={cn("space-y-4 transition-opacity", loading && "pointer-events-none opacity-50")}>
          {/* Verdict */}
          <section className="overflow-hidden rounded-xl border border-border bg-background">
            <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <div className={cn("rounded-xl p-3", balanced ? CHIP.ok : CHIP.bad)}>
                  {balanced ? <CheckCircle2 className="h-6 w-6" /> : <Scale className="h-6 w-6" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{MONTHS[data.period.month - 1]} {data.period.year}</div>
                  <div className="text-lg font-bold text-foreground sm:text-xl">
                    {balanced ? "Stock and GL agree" : `GL is ${fmt(Math.abs(data.totals.diff))} ${data.totals.diff > 0 ? "higher" : "lower"} than the stock report`}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {toFix.length
                      ? `${toFix.length} thing${toFix.length === 1 ? "" : "s"} to fix — the bridge below shows each one, biggest first.`
                      : balanced ? "Nothing to fix for this month." : "The remaining difference is method differences or earlier months — see the bridge."}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Stock report", data.totals.report],
                  ["GL (Balance Sheet)", data.totals.ledger],
                  ["Difference", data.totals.diff],
                ].map(([labelText, v], i) => (
                  <div key={labelText} className="rounded-lg border border-border px-2 py-2.5 sm:px-4">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">{labelText}</div>
                    <div className={cn("text-sm font-bold tabular-nums sm:text-base", i === 2 ? (balanced ? TONE_TEXT.ok : TONE_TEXT.bad) : "text-foreground")}>
                      <span className="sm:hidden">{fmtShort(v)}</span>
                      <span className="hidden sm:inline">{i === 2 ? fmtS(v) : fmt(v)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* JV + account status strip */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-4 py-3 sm:px-5">
              {data.jvStatus.map((j) => {
                const ok = j.vouchers.length > 0;
                const name = j.label.replace("Cost of Goods ", "").replace("Direct Material ", "Direct ");
                return (
                  <span key={j.tag} className={cn("inline-flex flex-wrap items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", ok ? CHIP.ok : CHIP.warn)}>
                    {ok ? <FileCheck2 className="h-3.5 w-3.5" /> : <FileX2 className="h-3.5 w-3.5" />}
                    {name} JV {ok ? "posted" : "missing"}
                    {j.vouchers.map((v) => (
                      <span key={v.tran_id} title={fmtDate(v.dated)}>
                        <VoucherNo row={v}>#{v.vr_no ?? v.tran_id}</VoucherNo>
                      </span>
                    ))}
                    {j.vouchers.length > 1 && <b className={TONE_TEXT.bad}>×{j.vouchers.length}</b>}
                  </span>
                );
              })}
              <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
              {accounts.map((a) => (
                <button key={a.acno} type="button" onClick={() => { setAccountSel(a.acno); setTab("accounts"); }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-primary/40">
                  <span className={cn("h-2 w-2 rounded-full", a.balanced ? "bg-emerald-500" : "bg-red-500")} />
                  {a.acname}
                  {!a.balanced && <b className={cn("tabular-nums", TONE_TEXT.bad)}>{fmtShort(a.diff)}</b>}
                </button>
              ))}
            </div>
          </section>

          {/* Tabs */}
          <nav className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
            <div className="inline-flex w-max min-w-full gap-1 border-b border-border">
              {[
                ["bridge", "Bridge — all accounts", Scale, toFix.length],
                ["accounts", "By account", Layers, null],
                ["items", "Items to check", ListChecks, null],
                ["checks", "Data checks", ShieldAlert, data.checks.length],
              ].map(([key, labelText, Icon, count]) => (
                <button key={key} type="button" onClick={() => setTab(key)}
                  className={cn(
                    "relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-2 text-sm font-medium transition-colors",
                    tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}>
                  <Icon className="h-4 w-4" />{labelText}
                  {count ? <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", CHIP.bad)}>{count}</span> : null}
                </button>
              ))}
            </div>
          </nav>

          {tab === "bridge" && (
            <div className="space-y-3">
              <Bridge accounts={accounts} findings={findings} reportClosing={data.totals.report} glClosing={data.totals.ledger}
                tolerance={tolerance} onItems={openItems} period={data.period} />
              <Link href={`${TRACE_PATH}?month=${data.period.month}&year=${data.period.year}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 text-sm transition-colors hover:border-primary/40">
                <Stethoscope className="h-5 w-5 shrink-0 text-primary" />
                <span className="flex-1"><b className="text-foreground">Check every item for {MONTHS[data.period.month - 1]}</b><span className="block text-muted-foreground">Item cost trace checks each item&apos;s opening, purchase, production (RM + CC), issue and sale rates and tells you which items cause these lines.</span></span>
              </Link>
            </div>
          )}

          {tab === "accounts" && (
            <div className="space-y-3">
              <Segmented
                value={accountSel}
                onChange={setAccountSel}
                options={accounts.map((a) => ({ key: a.acno, label: `${a.acname} ${a.balanced ? "✓" : fmtShort(a.diff)}` }))}
              />
              {account && (
                <>
                  <Bridge accounts={[account]} findings={findings} reportClosing={account.report_closing} glClosing={account.ledger_closing}
                    tolerance={tolerance} onItems={openItems} period={data.period} />
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />Raw figures: stock report vs GL per movement
                    </summary>
                    <div className="mt-2"><AccountFigures account={account} tolerance={tolerance} /></div>
                  </details>
                </>
              )}
            </div>
          )}

          {tab === "items" && (
            <div className="space-y-3">
              <Segmented
                value={itemList}
                onChange={setItemList}
                options={Object.entries(ITEM_LISTS).map(([key, def]) => ({ key, label: def.label, count: listCounts[key] }))}
              />
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{ITEM_LISTS[itemList].hint} Click a column to sort; &quot;Trace&quot; opens the item&apos;s full costing trace.</p>
              <ItemTable key={itemList} listKey={itemList} rows={data.issues[itemList]} period={data.period} />
            </div>
          )}

          {tab === "checks" && (
            <div className="space-y-2">
              {data.checks.length === 0 ? (
                <Note tone="ok" icon={CheckCircle2}>No data problems found that would cause differences.</Note>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Not differences yet — but they cause them. Fix these before locking the month.</p>
                  {data.checks.map((c) => <CheckCard key={c.id} c={c} onItems={openItems} />)}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Affected items side panel */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {sheet && (
            <>
              <SheetHeader className="mb-4 text-left">
                <SheetTitle>{ITEM_LISTS[sheet.listKey].label}</SheetTitle>
                <SheetDescription>
                  {sheet.title}
                  {sheet.acno != null && ` · account ${sheet.acno}`}
                  <br />{ITEM_LISTS[sheet.listKey].hint}
                </SheetDescription>
              </SheetHeader>
              <ItemTable key={`${sheet.listKey}-${sheet.acno}`} listKey={sheet.listKey} rows={itemsFor(sheet.listKey, sheet.acno)} period={data?.period} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </CostingFrame>
  );
}
