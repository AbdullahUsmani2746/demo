"use client";

// components/Audit/AuditTimeline.jsx — the Audit Trail results: days, then entries;
// adjacent entries from one save are boxed together ("One save · N changes").
import { Bot, ChevronRight, Info, Layers, Package, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTION_META, fmtDayHeading, fmtShort, fmtTime, fmtValue, groupTimeline, humanize, initialsOf, isDiff, itemText, recordNo } from "./format";

export function ActionChip({ action, className }) {
  const m = ACTION_META[action] ?? ACTION_META.update;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", m.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

export function UserAvatar({ row, size = "md" }) {
  const system = row.source === "system" || !row.user_id;
  const dims = size === "sm" ? "h-7 w-7 text-[10px]" : "h-8 w-8 text-[11px]";
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full font-bold", dims, system ? "bg-slate-100 text-slate-500" : "bg-[#800000]/10 text-[#800000]")}
      aria-hidden="true"
    >
      {system ? <Bot className="h-4 w-4" /> : initialsOf(row.user_name)}
    </div>
  );
}

export const whoOf = (row) => (row.source === "system" || !row.user_id ? row.user_name || "System" : row.user_name || row.user_id);
export const isChild = (row) => row.doc_model && row.doc_id != null && (row.doc_model !== row.model_name || String(row.doc_id) !== String(row.record_id));

/** What the row is about: its item (code + name), account and Sale Order. */
export function RowSubject({ row, className }) {
  const { item, account, iso } = row;
  if (!item && !account && !iso) return null;
  return (
    <p className={cn("mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}>
      {item && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-[#800000]/[0.06] px-1.5 py-0.5 text-slate-800">
          <Package className="h-3 w-3 shrink-0 text-[#800000]/70" aria-hidden="true" />
          {item.code && <span className="shrink-0 font-semibold tabular-nums">{item.code}</span>}
          <span className="min-w-0 truncate">{item.name ?? `Item ${item.itcd}`}</span>
        </span>
      )}
      {account && (
        <span className="min-w-0 max-w-full truncate text-slate-600">
          <span className="font-medium">A/c</span> {account.name ?? account.acno}
        </span>
      )}
      {iso && row.doc_model !== "OrderMaster" && (
        <span className="shrink-0 text-slate-600">
          <span className="font-medium">SO</span> <span className="tabular-nums">{iso}</span>
        </span>
      )}
    </p>
  );
}

/** The row in words (lib/audit/explain.js): what happened, why, and a re-save tag. */
export function RowStory({ row, full = false }) {
  if (!row.story) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {row.resave && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
            row.resave.same ? "bg-slate-100 text-slate-600 ring-slate-300" : "bg-amber-50 text-amber-800 ring-amber-600/20",
          )}
        >
          <Repeat className="h-3 w-3" aria-hidden="true" />
          {row.resave.same ? "Re-saved · no change" : "Re-saved · changed"}
        </span>
      )}
      <p className={cn("text-sm text-slate-800 [overflow-wrap:anywhere]", !full && "line-clamp-3", row.resave?.same && "text-slate-500")}>{row.story}</p>
      {row.why && (
        <p className="flex items-start gap-1 text-xs text-slate-500">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {/* clamp the text, not the flex row (line-clamp sets its own display) */}
          <span className={cn("min-w-0", !full && "line-clamp-2")}>
            <span className="font-medium text-slate-600">Why: </span>
            {row.why}
          </span>
        </p>
      )}
    </div>
  );
}

function DiffPreview({ row }) {
  if (row.action === "update" && Array.isArray(row.changes) && row.changes.length) {
    const diffs = row.changes.filter(isDiff);
    // { field, value } entries say which line it is (SO, Product) — not a change
    const notes = row.changes.filter((c) => !isDiff(c) && c?.field !== "SO");
    const shown = diffs.slice(0, 3);
    const more = diffs.length - shown.length;
    return (
      <ul className="mt-1.5 flex flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:gap-x-3">
        {notes.map((c) => (
          <li key={`n-${c.field}`} className="flex min-w-0 max-w-full items-baseline gap-1">
            <span className="shrink-0 font-medium text-slate-600">{humanize(c.field)}:</span>
            <span className="min-w-0 truncate text-slate-800">{fmtValue(c.value)}</span>
          </li>
        ))}
        {shown.map((c) => (
          <li key={c.field} className="flex min-w-0 max-w-full items-baseline gap-1">
            <span className="shrink-0 font-medium text-slate-600">{humanize(c.field)}:</span>
            <span className="min-w-0 truncate text-red-700/80 line-through decoration-red-300">{fmtShort(c.old, 28, c.old_label)}</span>
            <span className="shrink-0 text-slate-400" aria-label="changed to">→</span>
            <span className="min-w-0 truncate font-medium text-emerald-700">{fmtShort(c.new, 28, c.new_label)}</span>
          </li>
        ))}
        {more > 0 && <li className="font-medium text-slate-500">+{more} more</li>}
      </ul>
    );
  }
  if (Array.isArray(row.changes) && row.changes.length && !row.snapshot) {
    // An added / removed order line, listed as { field, value }
    const notes = row.changes.filter((c) => !isDiff(c) && c?.field !== "SO").slice(0, 4);
    return (
      <ul className="mt-1.5 flex flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:gap-x-3">
        {notes.map((c) => (
          <li key={c.field} className="flex min-w-0 max-w-full items-baseline gap-1">
            <span className="shrink-0 font-medium text-slate-600">{humanize(c.field)}:</span>
            <span className="min-w-0 truncate text-slate-800">{fmtValue(c.value)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if ((row.action === "create" || row.action === "delete") && row.snapshot && typeof row.snapshot === "object") {
    const n = Object.values(row.snapshot).filter((v) => v !== null && v !== undefined && v !== "").length;
    return <p className="mt-1 text-xs text-slate-500">{row.action === "create" ? "New record" : "Removed record"} · {n} filled fields</p>;
  }
  return null;
}

function Entry({ row, onOpen, inBatch }) {
  const child = isChild(row);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={cn(
          "group flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#800000]/30 sm:px-4",
          inBatch && "sm:pl-5",
        )}
        aria-label={`${ACTION_META[row.action]?.label ?? row.action} ${row.model_label} ${recordNo(row)} ${itemText(row.item)} by ${whoOf(row)} at ${fmtTime(row.dated)} — open details`}
      >
        <span className="hidden w-11 shrink-0 pt-1.5 text-xs font-medium tabular-nums text-slate-500 sm:block">{fmtTime(row.dated)}</span>
        <UserAvatar row={row} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="max-w-full truncate text-sm font-semibold text-slate-900">{whoOf(row)}</span>
            <ActionChip action={row.action} />
            <span className="ml-auto text-xs tabular-nums text-slate-500 sm:hidden">{fmtTime(row.dated)}</span>
          </div>
          <p className="mt-0.5 min-w-0 text-sm text-slate-700">
            <span className="font-medium">{row.model_label}</span> <span className="tabular-nums text-slate-500">{recordNo(row)}</span>
            {child && (
              <span className="text-slate-500">
                {" "}
                in {row.doc_label} <span className="tabular-nums">#{row.doc_id}</span>
              </span>
            )}
          </p>
          <RowSubject row={row} />
          {row.story ? <RowStory row={row} /> : <DiffPreview row={row} />}
        </div>
        <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" aria-hidden="true" />
      </button>
    </li>
  );
}

export default function AuditTimeline({ rows, onOpen, onBatch, showDays = true }) {
  const days = groupTimeline(rows);
  return (
    <div className="space-y-5">
      {days.map((d) => (
        <section key={d.day} aria-label={fmtDayHeading(d.day)}>
          {showDays && (
            <h3 className="sticky top-16 z-[1] -mx-1 mb-2 flex items-center gap-2 bg-slate-50/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">
              {fmtDayHeading(d.day)}
              <span className="h-px flex-1 bg-slate-200" />
              <span className="font-medium normal-case tracking-normal tabular-nums text-slate-400">
                {d.items.reduce((s, i) => s + i.rows.length, 0)} change{d.items.reduce((s, i) => s + i.rows.length, 0) === 1 ? "" : "s"}
              </span>
            </h3>
          )}
          <ol className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
            {d.items.map((item, idx) =>
              item.rows.length > 1 ? (
                <li key={`${item.batch}-${idx}`} className="bg-slate-50/60">
                  <div className="flex items-center gap-2 border-l-2 border-[#800000]/40 px-3 pt-2.5 pb-1 text-xs text-slate-500 sm:px-4">
                    <Layers className="h-3.5 w-3.5 shrink-0 text-[#800000]/60" aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      <span className="font-semibold text-slate-700">One save</span> · {item.rows.length} changes · {whoOf(item.rows[0])}
                    </span>
                    {onBatch && (
                      <button
                        type="button"
                        onClick={() => onBatch(item.batch)}
                        className="ml-auto shrink-0 rounded font-medium text-[#800000] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]/30"
                      >
                        Open save
                      </button>
                    )}
                  </div>
                  <ol className="divide-y divide-slate-100 border-l-2 border-[#800000]/40 bg-white">
                    {item.rows.map((r) => (
                      <Entry key={r.id} row={r} onOpen={onOpen} inBatch />
                    ))}
                  </ol>
                </li>
              ) : (
                <Entry key={item.rows[0].id} row={item.rows[0]} onOpen={onOpen} />
              ),
            )}
          </ol>
        </section>
      ))}
    </div>
  );
}
