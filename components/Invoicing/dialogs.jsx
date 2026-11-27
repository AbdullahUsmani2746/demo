"use client";

// components/Invoicing/dialogs.jsx — confirm generate, unlock (with reason)
// and the bulk-results sheet. Lab dialog frame (LabUI DIALOG*): near full
// width on phones, body scrolls, footer stays at the bottom.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { ExternalLink, Link2Off, Loader2, LockOpen, Sparkles } from "lucide-react";

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
import { voucherHref } from "@/lib/vouchers/voucherLink";

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
export function UnlockDialog({ kind, cfg, row, reason, onReasonChange, busy, onCancel, onConfirm }) {
  // Receipts / payments matched to this invoice block the reversal — listed
  // here, each un-matched on its own (GET …/knockoffs, POST /api/invoice-knockoff/[id]).
  const tranId = row?.tran_id ?? null;
  const { data: ko, isLoading: koLoading } = useQuery({
    queryKey: ["invoicing-knockoffs", kind, tranId],
    queryFn: async () => (await axios.get(`/api/invoicing/${kind}/knockoffs`, { params: { tran_id: tranId } })).data,
    enabled: !!tranId && !!kind,
  });
  const matched = ko?.knockoffs ?? [];
  const blocked = koLoading || matched.length > 0;
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

          {matched.length > 0 && (
            <MatchedPayments kind={kind} tranId={tranId} matched={matched} canReverse={ko?.canReverse} />
          )}

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
          <Button variant="destructive" disabled={busy || blocked || !reason.trim()} onClick={onConfirm}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
            Reverse {cfg.invoiceNoun.toLowerCase()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Payments / receipts matched (knocked off) against the invoice. Each one is
// un-matched here; the amount goes back to the knock-off queue as unapplied
// and the matcher (Invoice Knock-Off Review → Run now, or its twice-daily run)
// places it again, oldest open invoice first — so invoice it again first.
function MatchedPayments({ kind, tranId, matched, canReverse }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);
  const unmatch = async (k) => {
    setBusyId(k.id);
    try {
      await axios.post(`/api/invoice-knockoff/${k.id}`);
      toast.success(`Match of ${fmtMoney(k.amount)} undone.`);
      await queryClient.invalidateQueries({ queryKey: ["invoicing-knockoffs", kind, tranId] });
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || "Could not undo the match");
    } finally {
      setBusyId(null);
    }
  };
  const total = matched.reduce((s, k) => s + k.amount, 0);
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">
        {matched.length === 1 ? "A payment is" : `${matched.length} payments are`} matched to this invoice ({fmtMoney(total)}) — undo the
        match{matched.length === 1 ? "" : "es"} first.
      </p>
      <ul className="divide-y divide-amber-200">
        {matched.map((k) => {
          const v = k.voucher;
          const href = v ? voucherHref({ tran_code: v.tran_code, tran_id: v.tran_id }) : null;
          return (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 text-xs text-amber-900">
                {String(k.source_type || "").toLowerCase() || "voucher"} {v?.vr_no ? `#${v.vr_no}` : `#T-${v?.tran_id ?? "?"}`}
                {v?.dated ? ` · ${String(v.dated).slice(0, 10)}` : ""} ·{" "}
                <span className="font-semibold tabular-nums">{fmtMoney(k.amount)}</span>
                {href && (
                  <a href={href} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 underline">
                    open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </span>
              {canReverse ? (
                <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busyId != null} onClick={() => unmatch(k)}>
                  {busyId === k.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />}
                  Undo match
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-amber-800">
        {canReverse
          ? "The amount goes back as unapplied. Invoice it again, then Invoice Knock-Off Review → Run now matches it again."
          : "Ask someone with the knock-off right (Finance) to undo the match."}
      </p>
    </div>
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
