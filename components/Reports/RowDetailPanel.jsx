"use client";
// Row detail panel of the wide report table: every field of one row, in its
// column groups, plus the ways deeper — drills to the next report, the voucher
// behind the row, the older drill-down link and the line items. Opens on a row
// click or Enter; Esc closes it.
import React from "react";
import { ArrowRight, FileText, ListTree } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cellText, fieldText, formatValue, isNumericCol, numValue, rawValue } from "./layout";

// All fields of a row in their groups. Groups with no figure for this row fold
// into one "No figures" line. Shared by the panel and the phone cards.
export function FieldGroups({ model, row, amounts = "full", compact = false }) {
  const shown = new Set(model.pinned);
  const sections = [];
  const ungrouped = model.columns.filter((c) => !model.pinnedSet.has(c.key) && !model.groupOf.has(c.key));
  if (ungrouped.length) sections.push({ id: "_details", label: "Details", cols: ungrouped });
  model.groups.forEach((g) => sections.push({ id: g.id, label: g.label, cols: g.fields.map((f) => model.byKey.get(f)).filter(Boolean) }));

  const noFigures = [];
  const blocks = sections
    .map((s) => {
      const cols = s.cols.filter((c) => !shown.has(c.key));
      const numeric = cols.filter(isNumericCol);
      if (s.id !== "_details" && numeric.length === cols.length && numeric.every((c) => numValue(c, row) === 0)) {
        noFigures.push(s.label);
        return null;
      }
      const lines = cols
        .map((c) => ({ col: c, text: cellText(c, row, { amounts }), raw: rawValue(c, row) }))
        .filter((l) => (isNumericCol(l.col) ? true : l.text !== ""));
      if (!lines.length) return null;
      return { ...s, lines };
    })
    .filter(Boolean);

  return (
    <div className={compact ? "grid gap-2" : "grid gap-3"}>
      {blocks.map((b) => (
        <section key={b.id} className="overflow-hidden rounded-lg border border-border">
          <h4 className="bg-primary/[0.06] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">{b.label}</h4>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto]">
            {b.lines.map(({ col, text, raw }) => {
              const neg = isNumericCol(col) && Number(raw) < 0;
              return (
                <React.Fragment key={col.key}>
                  <dt className="min-w-0 border-t border-border px-2.5 py-1.5 text-[12.5px] text-muted-foreground">{col.headerName}</dt>
                  <dd
                    className={`border-t border-border px-2.5 py-1.5 text-right text-[12.5px] ${isNumericCol(col) ? "font-semibold tabular-nums" : "max-w-[220px] break-words"} ${neg ? "text-destructive" : "text-foreground"}`}
                  >
                    {text === "" ? <span className="text-muted-foreground/60">–</span> : text}
                  </dd>
                </React.Fragment>
              );
            })}
          </dl>
        </section>
      ))}
      {noFigures.length > 0 && <p className="text-xs text-muted-foreground">No figures: {noFigures.join(", ")}.</p>}
    </div>
  );
}

// actions: [{ key, label, onClick, kind: "drill" | "voucher" | "lines" | "legacy", primary }]
export function ActionButtons({ actions, className = "" }) {
  if (!actions?.length) return null;
  const icon = (kind) =>
    kind === "voucher" ? <FileText className="h-4 w-4" /> : kind === "lines" ? <ListTree className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {actions.map((a, i) => (
        <button
          key={a.key || i}
          type="button"
          onClick={a.onClick}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
            a.primary || i === 0
              ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
              : "border-border bg-background text-foreground hover:border-primary hover:text-primary"
          }`}
        >
          {icon(a.kind)}
          {a.label}
        </button>
      ))}
    </div>
  );
}

export default function RowDetailPanel({ open, onClose, model, row, amounts, subtitle, figures = [], actions = [] }) {
  const title = row ? fieldText(model, model.card.title, row) : "";
  const code = row && model.card.subtitle ? fieldText(model, model.card.subtitle, row) : "";
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {row && (
          <>
            <SheetHeader className="border-b border-border bg-primary/[0.06] px-4 py-3 pr-10 text-left">
              {code && <span className="font-mono text-xs text-primary">{code}</span>}
              <SheetTitle className="text-base leading-snug">{title || "Row details"}</SheetTitle>
              {subtitle && <SheetDescription className="text-xs">{subtitle}</SheetDescription>}
            </SheetHeader>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {figures.length > 0 && (
                <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border sm:grid-cols-4">
                  {figures.map((f, i) => (
                    <div key={f.key} className={`border-border p-2 ${i < figures.length - 1 ? "border-r" : ""} ${i === figures.length - 1 ? "bg-primary/[0.06]" : ""}`}>
                      <span className="block text-[10.5px] uppercase tracking-wide text-muted-foreground">{f.label}</span>
                      <b className="text-[13.5px] font-bold tabular-nums text-foreground">{formatValue(f.col, f.get(row), { amounts }) || "–"}</b>
                    </div>
                  ))}
                </div>
              )}
              <FieldGroups model={model} row={row} amounts={amounts} />
            </div>
            {actions.length > 0 && (
              <div className="border-t border-border px-4 py-3">
                <ActionButtons actions={actions} />
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
