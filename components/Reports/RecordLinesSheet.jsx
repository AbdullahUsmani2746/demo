"use client";
// "Show lines" / Record Details (CLAUDE.md rule 15): the lines behind one
// report row — a voucher's lines, an order's items, a BOM's materials, a QC
// item's attempts — opened from the row panel's "Show lines (N)" button or
// from a row of a report with `detailColumns`.
//
// A right-side sheet on desktop (the report stays in view beside it and the
// lines are rarely wider than ~1100px; wider ones scroll inside the sheet with
// the first column pinned), a bottom sheet on phones, where the lines become
// cards. Header: the record's key fields as chips and "Open voucher" when the
// row names its voucher. Lines use the report's own column types (numbers
// right-aligned, tabular), a totals row for amount / quantity columns, a
// search over the lines when there are more than 10, Excel of just these lines
// (wideExport), and ‹ › / ← → to step through the report's rows without
// closing. Esc closes. It only shows what the viewer already loaded.
import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Database, FileSpreadsheet, FileText, Search, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { buildItems, computeTotals, formatValue, isNumericCol, keyColumns, rawValue, resolveLayout } from "./layout";
import { withItemColumns } from "./itemColumns";

// Which record field fills which header chip — the first one present wins.
const CHIPS = [
  { label: "VR #", fields: ["vr_no", "invoice_no", "dispatch_no", "grn_no", "order_no", "orderNo", "bom_id", "batch_no"] },
  { label: "Date", fields: ["dated", "date", "order_date", "orderDate", "invoice_date", "mfg_date"], type: "date" },
  { label: "Party", fields: ["customer", "vendor", "party", "account", "acname", "item_name", "item"] },
  { label: "Amount", fields: ["amount", "net_amount", "total_amount", "totalAmount", "damt"], type: "currency" },
  { label: "Entered by", fields: ["entered_by", "enteredBy", "user_name", "userName"] },
];
const NO_SUM = /rate|price|%|pct|percent|ratio|no\b|code|#/i;

const present = (v) => v !== null && v !== undefined && v !== "" && typeof v !== "object";

function Cell({ col, row }) {
  const v = rawValue(col, row);
  if (React.isValidElement(v)) return v;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-muted-foreground/60">–</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {v.map((x, i) => (
          <span key={i} className="rounded bg-primary/10 px-1.5 py-px text-[11px] font-medium text-primary">
            {String(x)}
          </span>
        ))}
      </span>
    );
  }
  const text = formatValue(col, v);
  if (text === "") return <span className="text-muted-foreground/60">–</span>;
  if (/code|acno|itcd|tran_id|_no$|^no$/i.test(col.field || "") && !isNumericCol(col)) {
    return <span className="rounded bg-primary/10 px-1.5 py-px font-mono text-[11.5px] text-primary">{text}</span>;
  }
  return <span className={isNumericCol(col) && Number(v) < 0 ? "text-destructive" : ""}>{text}</span>;
}

function LinesTable({ cols, rows, totals, showTotals, wide }) {
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th className="sticky top-0 z-[2] w-9 bg-primary px-2 py-2 text-left text-[11px] font-semibold text-primary-foreground">#</th>
            {cols.map((c, i) => (
              <th
                key={c.key}
                style={i === 0 && wide ? { left: 36 } : undefined}
                className={`sticky top-0 whitespace-nowrap bg-primary px-2.5 py-2 text-[11px] font-semibold text-primary-foreground ${isNumericCol(c) ? "text-right" : "text-left"} ${i === 0 && wide ? "z-[3]" : "z-[2]"}`}
              >
                {c.headerName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="group">
              <td className="border-b border-border bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground group-hover:bg-muted">{ri + 1}</td>
              {cols.map((c, i) => (
                <td
                  key={c.key}
                  style={i === 0 && wide ? { position: "sticky", left: 36, zIndex: 1 } : undefined}
                  className={`border-b border-border bg-background px-2.5 py-1.5 group-hover:bg-muted ${
                    isNumericCol(c) ? "whitespace-nowrap text-right font-semibold tabular-nums" : "max-w-[320px] break-words text-left"
                  }`}
                >
                  <Cell col={c} row={row} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {showTotals && rows.length > 1 && (
          <tfoot>
            <tr>
              <td className="sticky bottom-0 border-t-2 border-t-primary bg-muted px-2 py-1.5 text-[11px] font-bold">Σ</td>
              {cols.map((c, i) => (
                <td
                  key={c.key}
                  style={i === 0 && wide ? { left: 36 } : undefined}
                  className={`sticky bottom-0 border-t-2 border-t-primary bg-muted px-2.5 py-1.5 font-bold ${isNumericCol(c) ? "whitespace-nowrap text-right tabular-nums" : "text-left"}`}
                >
                  {totals[c.key] !== undefined ? formatValue(c, totals[c.key]) || "–" : i === 0 ? `${rows.length} lines` : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function LineCards({ cols, rows, totals, showTotals }) {
  const [lead, ...rest] = cols;
  return (
    <div className="grid gap-2">
      {rows.map((row, ri) => (
        <div key={ri} className="grid gap-1.5 rounded-xl border border-border bg-background p-3">
          <div className="flex items-start justify-between gap-2">
            <b className="min-w-0 break-words text-[13px] text-foreground">
              <span className="mr-1.5 font-mono text-[11px] font-normal text-muted-foreground">{ri + 1}</span>
              {lead && <Cell col={lead} row={row} />}
            </b>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
            {rest.map((c) => (
              <div key={c.key} className="min-w-0">
                <dt className="truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">{c.headerName}</dt>
                <dd className={isNumericCol(c) ? "font-semibold tabular-nums" : "break-words"}>
                  <Cell col={c} row={row} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {showTotals && rows.length > 1 && (
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-lg bg-primary px-3 py-2 text-[12px] text-primary-foreground">
          {cols
            .filter((c) => totals[c.key] !== undefined)
            .map((c) => (
              <span key={c.key} className="flex gap-1.5">
                <span className="opacity-80">{c.headerName}</span>
                <b className="font-bold tabular-nums">{formatValue(c, totals[c.key]) || "0"}</b>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

export default function RecordLinesSheet({
  open,
  onClose,
  title = "Record details",
  record,
  lines,
  columns,
  isQC = false,
  rows = [], // the report's rows, for ‹ › stepping
  hasLines = () => true,
  onStep, // (row) => void — loads that row's lines (the viewer's own handler)
  voucher, // { href, label } | null
  onOpenVoucher,
  companyName = "",
  userName = "",
}) {
  const isMobile = useIsMobile();
  const [term, setTerm] = useState("");
  useEffect(() => setTerm(""), [record]);

  // Report columns → engine columns; amount / quantity columns total.
  const list = useMemo(() => (Array.isArray(lines) ? lines : []), [lines]);
  // + the item Code / Category / Sub Category the lines' columns lack (itemColumns.js)
  const cols = useMemo(
    () =>
      keyColumns(withItemColumns(columns || [], list)).map((c) => ({
        ...c,
        showTotal: c.showTotal ?? (isNumericCol(c) && !NO_SUM.test(`${c.field} ${c.headerName}`)),
      })),
    [columns, list],
  );
  const model = useMemo(() => resolveLayout({ config: {}, filters: {}, columns: cols }), [cols]);
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => cols.some((c) => String(formatValue(c, rawValue(c, r)) ?? "").toLowerCase().includes(q)));
  }, [list, term, cols]);
  const totals = useMemo(() => computeTotals(model, shown), [model, shown]);
  const showTotals = cols.some((c) => c.showTotal);
  const wide = cols.length > 7;

  // Prev / next among the report rows that have lines.
  const steppable = useMemo(() => rows.filter((r) => r && !r.__rowType && hasLines(r)), [rows, hasLines]);
  const pos = record ? steppable.indexOf(record) : -1;
  const prev = pos > 0 ? steppable[pos - 1] : null;
  const next = pos >= 0 && pos < steppable.length - 1 ? steppable[pos + 1] : null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        onStep?.(prev);
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        onStep?.(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prev, next, onStep]);

  const chips = useMemo(() => {
    if (!record) return [];
    const out = [];
    CHIPS.forEach((ch) => {
      const f = ch.fields.find((k) => present(record[k]));
      if (!f) return;
      const v = record[f];
      out.push({ label: ch.label, text: ch.type ? formatValue({ type: ch.type }, v) || String(v) : String(v) });
    });
    return out;
  }, [record]);

  const exportExcel = async () => {
    const { exportWideExcel } = await import("./wideExport");
    const items = buildItems(model, shown, { withTotals: false });
    const head = chips.map((c) => `${c.label} ${c.text}`).join(" · ");
    await exportWideExcel(
      { columns: cols, pinnedCount: 0, groupOf: () => null, items, totals, hasTotals: showTotals, amounts: "full", viewLabel: "Lines", formulas: true },
      {
        title: title,
        companyName,
        userName,
        generatedAt: new Date().toLocaleString("en-GB"),
        filters: head ? [{ label: "Record", value: head }] : [],
        fileBase: `${title}_lines_${new Date().toISOString().slice(0, 10)}`,
      },
    );
  };

  // QC items keep their per-attempt blocks (one table per attempt).
  const qcAttempts = useMemo(() => {
    if (!isQC || !list.length || list[0]?.attempt_no === undefined || list[0]?.attempt_no === null) return null;
    const m = new Map();
    shown.forEach((r) => {
      const k = r.attempt_no || 0;
      if (!m.has(k)) m.set(k, { attempt_no: k, attempt_date: r.attempt_date, reject_reason: r.reject_reason, rows: [] });
      m.get(k).rows.push(r);
    });
    return [...m.values()].sort((a, b) => b.attempt_no - a.attempt_no);
  }, [isQC, list, shown]);
  const approved = /^(APPROVED|approve)$/.test(String(record?.display_status || record?.status || ""));

  const body = (() => {
    if (isQC && !qcAttempts) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <Database className="h-10 w-10 text-muted-foreground/60" />
          <b className="text-foreground">No attempts found</b>
          <p className="max-w-sm text-sm text-muted-foreground">There aren't any quality control attempts recorded for this item yet.</p>
        </div>
      );
    }
    if (qcAttempts) {
      return (
        <div className="grid gap-4">
          {qcAttempts.map((a, i) => (
            <section key={a.attempt_no} className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-3 py-2">
                <b className="text-sm text-primary">
                  Attempt #{a.attempt_no}
                  {a.attempt_date && <span className="ml-2 font-normal text-muted-foreground">{formatValue({ type: "date" }, a.attempt_date)}</span>}
                </b>
                {a.reject_reason ? (
                  <span className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">Rejected: {a.reject_reason}</span>
                ) : approved && i === 0 ? (
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Approved</span>
                ) : null}
              </div>
              {isMobile ? <LineCards cols={cols} rows={a.rows} totals={{}} showTotals={false} /> : <LinesTable cols={cols} rows={a.rows} totals={{}} showTotals={false} wide={wide} />}
            </section>
          ))}
        </div>
      );
    }
    if (!shown.length) {
      return <p className="py-10 text-center text-sm text-muted-foreground">{list.length ? `Nothing matches “${term}”.` : "This record has no lines."}</p>;
    }
    return isMobile ? (
      <LineCards cols={cols} rows={shown} totals={totals} showTotals={showTotals} />
    ) : (
      <LinesTable cols={cols} rows={shown} totals={totals} showTotals={showTotals} wide={wide} />
    );
  })();

  const count = qcAttempts ? `${qcAttempts.length} attempt${qcAttempts.length === 1 ? "" : "s"}` : `${list.length} line${list.length === 1 ? "" : "s"}`;
  const stepBtn = "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose?.()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={`flex flex-col gap-0 p-0 [&>button:first-of-type]:hidden ${
          isMobile ? "max-h-[92dvh] rounded-t-2xl" : "w-[min(1100px,94vw)] max-w-none sm:max-w-none"
        }`}
      >
        <div className="border-b border-border bg-primary/5 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="truncate text-base font-semibold text-foreground">{title}</SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                {count}
                {steppable.length > 1 && pos >= 0 ? ` · record ${pos + 1} of ${steppable.length}` : ""}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {steppable.length > 1 && (
                <>
                  <button type="button" className={stepBtn} disabled={!prev} onClick={() => prev && onStep?.(prev)} title="Previous record (←)" aria-label="Previous record">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" className={stepBtn} disabled={!next} onClick={() => next && onStep?.(next)} title="Next record (→)" aria-label="Next record">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
              <button type="button" className={stepBtn} onClick={onClose} title="Close (Esc)" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {(chips.length > 0 || voucher) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <span key={c.label} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[12px]">
                  <span className="text-muted-foreground">{c.label}</span>
                  <b className="truncate font-semibold text-foreground">{c.text}</b>
                </span>
              ))}
              {voucher && (
                <button
                  type="button"
                  onClick={onOpenVoucher}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <FileText className="h-3.5 w-3.5" /> {voucher.label}
                </button>
              )}
            </div>
          )}
        </div>

        {(list.length > 10 || !qcAttempts) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            {list.length > 10 && (
              <label className="flex h-8 min-w-[160px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-muted-foreground focus-within:border-primary sm:max-w-xs">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Search lines…"
                  aria-label="Search lines"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
                />
              </label>
            )}
            {!qcAttempts && shown.length > 0 && (
              <button
                type="button"
                onClick={exportExcel}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[12.5px] font-medium hover:border-primary hover:text-primary"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3 sm:p-4">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
