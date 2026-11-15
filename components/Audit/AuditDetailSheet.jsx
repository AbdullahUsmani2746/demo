"use client";

// components/Audit/AuditDetailSheet.jsx — one audit entry in full: the field
// diff (Field | Before | After) for a change, or the whole record for a create
// / delete, plus jumps to the record's history, its whole document and the save.
import { useMemo, useState } from "react";
import { FileStack, History, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ActionChip, RowStory, UserAvatar, isChild, whoOf } from "./AuditTimeline";
import { fmtDateTime, fmtNamed, fmtValue, humanize, isDiff, isEmpty, recordNo } from "./format";

/** A value; an id shows its name (item code — name, account, godown, user …) with the id beneath. */
function Value({ v, tone, label }) {
  const text = fmtNamed(v, label);
  const empty = isEmpty(v);
  const block = typeof v === "object" && v !== null;
  return block ? (
    <pre className={cn("max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-1.5 font-mono text-[11px]", tone)}>{text}</pre>
  ) : (
    <span className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", empty ? "text-slate-400" : tone, typeof v === "number" && !label && "tabular-nums")}>
      {text}
      {label && !empty && <span className="block text-[11px] font-normal tabular-nums text-slate-400">ID {fmtValue(v)}</span>}
    </span>
  );
}

function DiffTable({ changes: all }) {
  // { field, value } entries say which line it is (SO, Product) — shown above the changes
  const notes = all.filter((c) => !isDiff(c));
  const changes = all.filter(isDiff);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">Fields changed</caption>
        <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="w-[30%] px-3 py-2">Field</th>
            <th scope="col" className="w-[35%] px-3 py-2">Before</th>
            <th scope="col" className="w-[35%] px-3 py-2">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top">
          {notes.map((c) => (
            <tr key={`n-${c.field}`} className="bg-slate-50/60">
              <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700 [overflow-wrap:anywhere]">
                {humanize(c.field)}
              </th>
              <td colSpan={2} className="px-3 py-2 text-slate-800">
                <Value v={c.value} />
              </td>
            </tr>
          ))}
          {changes.map((c) => (
            <tr key={c.field}>
              <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700 [overflow-wrap:anywhere]" title={c.field}>
                {humanize(c.field)}
              </th>
              <td className="bg-red-50/40 px-3 py-2">
                <Value v={c.old} label={c.old_label} tone="text-red-800" />
              </td>
              <td className="bg-emerald-50/40 px-3 py-2">
                <Value v={c.new} label={c.new_label} tone="font-medium text-emerald-800" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SnapshotTable({ snapshot, labels, highlight }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const entries = useMemo(() => Object.entries(snapshot ?? {}), [snapshot]);
  const filled = entries.filter(([, v]) => !isEmpty(v));
  const list = showEmpty ? entries : filled;
  const hidden = entries.length - filled.length;
  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Record fields</caption>
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="w-[38%] px-3 py-2">Field</th>
              <th scope="col" className="px-3 py-2">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {list.map(([k, v]) => (
              <tr key={k} className={cn(highlight?.has(k) && "bg-amber-50/60")}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700 [overflow-wrap:anywhere]" title={k}>
                  {humanize(k)}
                </th>
                <td className="px-3 py-2 text-slate-800">
                  <Value v={v} label={labels?.[k]} />
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-slate-500">
                  No fields recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <button type="button" onClick={() => setShowEmpty((s) => !s)} className="mt-2 text-xs font-medium text-[#800000] hover:underline">
          {showEmpty ? "Hide empty fields" : `Show ${hidden} empty field${hidden === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

function Meta({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-800">{children}</dd>
    </div>
  );
}

export default function AuditDetailSheet({ row, onClose, onRecord, onDocument, onBatch }) {
  const [showRecord, setShowRecord] = useState(false);
  const open = Boolean(row);
  const changes = Array.isArray(row?.changes) ? row.changes : [];
  const diffs = changes.filter(isDiff);
  const hasSnapshot = row?.snapshot && typeof row.snapshot === "object" && Object.keys(row.snapshot).length > 0;
  const changed = useMemo(() => new Set(changes.map((c) => c.field)), [changes]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setShowRecord(false);
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {row && (
          <>
            <SheetHeader className="space-y-2 border-b border-slate-100 px-4 py-4 pr-12 text-left sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <ActionChip action={row.action} />
                {row.source === "system" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">System</span>}
              </div>
              <SheetTitle className="text-lg leading-tight">
                {row.model_label} <span className="tabular-nums text-slate-500">{recordNo(row)}</span>
              </SheetTitle>
              <SheetDescription className="text-sm">
                {isChild(row) ? (
                  <>
                    Part of {row.doc_label} <span className="tabular-nums">#{row.doc_id}</span>
                  </>
                ) : (
                  <>Recorded {fmtDateTime(row.dated)}</>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
              {row.story && (
                <section className="rounded-xl border border-[#800000]/20 bg-[#800000]/[0.03] p-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#800000]">What happened</h3>
                  <RowStory row={row} full />
                  <p className="mt-1.5 text-xs text-slate-500">
                    When: <span className="tabular-nums">{fmtDateTime(row.dated)}</span> · By: {whoOf(row)}
                    {row.source === "system" ? " (system)" : ""}
                  </p>
                  {row.resave && !row.resave.same && row.resave.diffs?.length > 0 && (
                    <div className="mt-2">
                      <DiffTable changes={row.resave.diffs} />
                    </div>
                  )}
                </section>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-3">
                <Meta label="When">
                  <span className="tabular-nums">{fmtDateTime(row.dated)}</span>
                </Meta>
                <Meta label="By">
                  <span className="flex items-center gap-1.5">
                    <UserAvatar row={row} size="sm" />
                    <span className="truncate">{whoOf(row)}</span>
                  </span>
                </Meta>
                <Meta label="Table">
                  <span title={row.model_name}>{row.model_label}</span>
                </Meta>
                <Meta label="Document">
                  {row.doc_label} <span className="tabular-nums">#{row.doc_id}</span>
                </Meta>
                <Meta label="Entry">
                  <span className="tabular-nums">#{row.id}</span>
                </Meta>
                {row.item && (
                  <>
                    <Meta label="Item code">
                      <span className="font-semibold tabular-nums">{row.item.code ?? "—"}</span>
                    </Meta>
                    <Meta label="Item">
                      <span title={row.item.name ?? undefined}>{row.item.name ?? `ID ${row.item.itcd}`}</span>
                    </Meta>
                  </>
                )}
                {row.account && (
                  <Meta label="Account">
                    <span title={row.account.name ?? undefined}>{row.account.name ?? row.account.acno}</span>
                  </Meta>
                )}
                {row.iso && row.doc_model !== "OrderMaster" && (
                  <Meta label="Sale Order">
                    <span className="tabular-nums">{row.iso}</span>
                  </Meta>
                )}
                {row.batch_id && (
                  <Meta label="Save">
                    <span className="font-mono text-xs" title={row.batch_id}>
                      {String(row.batch_id).slice(0, 8)}
                    </span>
                  </Meta>
                )}
              </dl>

              {(row.action === "update" || !hasSnapshot) && changes.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {row.action === "update"
                      ? `${diffs.length} field${diffs.length === 1 ? "" : "s"} changed`
                      : row.action === "delete"
                        ? "The line as it was when removed"
                        : "The line as added"}
                  </h3>
                  <DiffTable changes={changes} />
                  {hasSnapshot && (
                    <div className="pt-2">
                      <button type="button" onClick={() => setShowRecord((s) => !s)} className="text-xs font-medium text-[#800000] hover:underline" aria-expanded={showRecord}>
                        {showRecord ? "Hide the record's details" : "Show the record's details"}
                      </button>
                      {showRecord && (
                        <div className="mt-2">
                          <SnapshotTable snapshot={row.snapshot} labels={row.snapshot_labels} highlight={changed} />
                        </div>
                      )}
                    </div>
                  )}
                </section>
              ) : hasSnapshot ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-900">{row.action === "delete" ? "The record as it was when deleted" : "The record as created"}</h3>
                  <SnapshotTable snapshot={row.snapshot} labels={row.snapshot_labels} />
                </section>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">No field details were recorded for this entry.</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 border-t border-slate-100 px-4 py-3 sm:grid-cols-3 sm:px-5">
              <Button variant="outline" size="sm" className="h-auto min-h-9 whitespace-normal py-1.5 leading-tight" onClick={() => onRecord(row)}>
                <History className="h-4 w-4" />
                History of this record
              </Button>
              <Button variant="outline" size="sm" className="h-auto min-h-9 whitespace-normal py-1.5 leading-tight" onClick={() => onDocument(row)}>
                <FileStack className="h-4 w-4" />
                Whole document
              </Button>
              <Button variant="outline" size="sm" className="h-auto min-h-9 whitespace-normal py-1.5 leading-tight" disabled={!row.batch_id} onClick={() => onBatch(row.batch_id)} title={row.batch_id ? undefined : "Not recorded for older entries"}>
                <Layers className="h-4 w-4" />
                Everything in this save
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
