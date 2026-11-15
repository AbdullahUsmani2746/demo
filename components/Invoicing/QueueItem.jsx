"use client";

// components/Invoicing/QueueItem.jsx — one entry of the left-rail queue.

import { memo } from "react";
import { AlertTriangle } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { REF_LABELS } from "./kinds";
import { fmtDate, fmtMoney } from "./format";
import { IdChip, PartyAvatar, ResultPill, StatusDot } from "./parts";

function QueueItem({ row, cfg, status, total, issueCount, isActive, selected, result, onSelect, onToggleSelect }) {
  const selectable = status === "ready";
  const refs = REF_LABELS.filter(([k]) => k !== cfg.ownRef && row.ref?.[k] != null && row.ref[k] !== "");

  return (
    <div
      data-row-id={row.tran_id}
      onClick={() => onSelect(row.tran_id)}
      className={cn(
        "cursor-pointer border-b border-border px-3 py-2.5 transition-colors",
        isActive
          ? "bg-primary/5 shadow-[inset_4px_0_0_0_hsl(var(--primary))]"
          : selected
            ? "bg-primary/[0.03] hover:bg-muted/60"
            : "hover:bg-muted/60",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div onClick={(e) => e.stopPropagation()} className="pt-1.5">
          <Checkbox
            checked={selected}
            disabled={!selectable}
            onCheckedChange={() => onToggleSelect(row.tran_id)}
            aria-label={`Select ${row.doc_label}`}
          />
        </div>

        <PartyAvatar name={row.party?.acname} />

        <div className="min-w-0 flex-1">
          {/* party line */}
          <div className="flex items-center gap-1.5">
            <StatusDot status={status} />
            <span className="truncate text-sm font-semibold text-foreground">
              {row.party?.acname || `No ${cfg.partyLabel.toLowerCase()}`}
            </span>
          </div>

          {/* reference numbers */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <IdChip tone="doc" label={cfg.docChip} value={row.doc_no ?? row.tran_id} />
            {refs.map(([k, label, , tone]) => (
              <IdChip key={k} tone={tone} label={label} value={row.ref[k]} />
            ))}
            {row.invoiced ? (
              <IdChip
                tone={row.legacy ? "legacy" : "invoice"}
                label={row.legacy ? "LEGACY" : cfg.invoiceChip}
                value={row.invoice_no || "—"}
              />
            ) : null}
          </div>

          {/* date + amount */}
          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
              {fmtDate(row.dated)}
              {status === "blocked" && (
                <span className="inline-flex items-center gap-0.5 font-semibold text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  {issueCount}
                </span>
              )}
              {result && result.status !== "invoiced" ? (
                <ResultPill result={result} invoiceChip={cfg.invoiceChip} />
              ) : null}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMoney(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(QueueItem);
