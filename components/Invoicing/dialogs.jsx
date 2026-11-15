"use client";

// components/Invoicing/dialogs.jsx — confirm generate, unlock (with reason)
// and the bulk-results sheet. Lab dialog frame (LabUI DIALOG*): near full
// width on phones, body scrolls, footer stays at the bottom.

import { Loader2, LockOpen, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DIALOG, DIALOG_BODY, DIALOG_FOOT, DIALOG_HEAD, Chip } from "@/components/Material/shared/LabUI";
import { cn } from "@/lib/utils";

import { fmtMoney } from "./format";
import { IdChip, ResultPill, UI } from "./parts";

// ── confirm generate ────────────────────────────────────────────────────
export function ConfirmGenerateDialog({ cfg, rows, drafts, totalOf, nextNo, busy, onCancel, onConfirm }) {
  const list = rows ?? [];
  const autoCount = list.filter((r) => !String(drafts[r.tran_id]?.invoice_no ?? "").trim()).length;
  const sum = list.reduce((s, r) => s + totalOf(r), 0);
  const plural = list.length === 1 ? cfg.invoiceNoun : cfg.invoiceNounPlural;

  return (
    <Dialog open={list.length > 0} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-xl")}>
        <DialogHeader className={cn(DIALOG_HEAD, "text-left")}>
          <DialogTitle className="text-lg font-semibold text-primary">
            Generate {list.length > 1 ? `${list.length} ` : ""}
            {plural}?
          </DialogTitle>
          <DialogDescription className="text-sm">
            Each {cfg.docNoun} is priced at the rates shown and posted to the ledger. To change it
            afterwards the {cfg.invoiceNoun.toLowerCase()} has to be unlocked.
          </DialogDescription>
        </DialogHeader>

        <div className={cn(DIALOG_BODY, "space-y-3")}>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {list.map((row) => {
                const typed = String(drafts[row.tran_id]?.invoice_no ?? "").trim();
                return (
                  <div key={row.tran_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
                    <IdChip tone="doc" label={cfg.docChip} value={row.doc_no ?? row.tran_id} />
                    <span className="min-w-0 flex-1 truncate font-medium">{row.party?.acname || "—"}</span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-xs font-semibold",
                        typed ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {typed ? `${cfg.invoiceChip} ${typed}` : "auto"}
                    </span>
                    <span className="w-28 shrink-0 text-right font-semibold tabular-nums">{fmtMoney(totalOf(row))}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-primary bg-muted/50 px-3 py-2 text-sm">
              <span className={UI.muted}>
                {autoCount > 0 ? (
                  <>
                    {autoCount} automatic number{autoCount === 1 ? "" : "s"}
                    {nextNo ? (
                      <>
                        {" "}
                        from <span className="font-mono font-semibold text-foreground">{nextNo}</span>
                      </>
                    ) : null}
                    , in this order.
                  </>
                ) : (
                  "Every number is typed."
                )}
              </span>
              <span className="text-base font-semibold tabular-nums text-foreground">{fmtMoney(sum)}</span>
            </div>
          </div>
        </div>

        <div className={DIALOG_FOOT}>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm} autoFocus>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Confirm ({list.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── unlock ──────────────────────────────────────────────────────────────
export function UnlockDialog({ cfg, row, reason, onReasonChange, busy, onCancel, onConfirm }) {
  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-md")}>
        <DialogHeader className={cn(DIALOG_HEAD, "text-left")}>
          <DialogTitle className="text-lg font-semibold text-primary">
            Reverse {cfg.invoiceNoun} {row?.invoice_no}?
          </DialogTitle>
        </DialogHeader>

        <div className={cn(DIALOG_BODY, "space-y-3")}>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                The {cfg.partyLabel.toLowerCase()}&apos;s ledger entry and sales tax
                {row?.totals?.total != null ? (
                  <>
                    {" "}
                    (<span className="font-semibold tabular-nums text-foreground">{fmtMoney(row.totals.total)}</span>)
                  </>
                ) : null}{" "}
                are removed, the lines go back to unpriced and {row?.doc_label} returns to Pending. Stock
                movement is not affected.
              </p>
              <p>It must be invoiced again, and will take a new number unless you type this one.</p>
            </div>
          </DialogDescription>

          <label className="block space-y-1.5">
            <span className={UI.label}>
              Reason <span className="text-destructive">*</span>
            </span>
            <Textarea
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder={`Why is this ${cfg.invoiceNoun.toLowerCase()} being reversed? (recorded on the ${cfg.docNoun})`}
              rows={3}
              autoFocus
            />
          </label>
        </div>

        <div className={DIALOG_FOOT}>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={onConfirm}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
            Reverse {cfg.invoiceNoun.toLowerCase()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── bulk results ────────────────────────────────────────────────────────
export function ResultsDialog({ cfg, result, rows, onClose }) {
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "sm:max-w-2xl")}>
        <DialogHeader className={cn(DIALOG_HEAD, "text-left")}>
          <DialogTitle className="text-lg font-semibold text-primary">Invoicing results</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Chip tone="ok">{result?.invoicedCount ?? 0} invoiced</Chip>
              {result?.failedCount ? <Chip tone="bad">{result.failedCount} not invoiced</Chip> : null}
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className={DIALOG_BODY}>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {(result?.results || []).map((r, idx) => {
              const row = rows.find((x) => x.tran_id === r.tran_id);
              return (
                <div key={`${r.tran_id}-${idx}`} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <IdChip tone="doc" label={cfg.docChip} value={row?.doc_no ?? r.tran_id} />
                      <span className="truncate font-medium">{row?.party?.acname}</span>
                    </div>
                    {r.status !== "invoiced" && r.message && (
                      <div className={cn("mt-1 text-xs", UI.muted)}>{r.message}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {r.total != null && r.status === "invoiced" && (
                      <span className="font-semibold tabular-nums">{fmtMoney(r.total)}</span>
                    )}
                    <ResultPill result={r} invoiceChip={cfg.invoiceChip} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={DIALOG_FOOT}>
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
