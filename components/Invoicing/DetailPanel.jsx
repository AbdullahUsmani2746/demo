"use client";

// components/Invoicing/DetailPanel.jsx — right-hand panel: the full record of
// the active document. Header with the party and the primary action, the
// invoice fields, attachments, blocking issues, the priced line grid and a
// totals footer. Files are saved onto the document / line the moment they are
// added — pending or invoiced alike.

import {
  AlertTriangle,
  CalendarDays,
  ExternalLink,
  FileCheck2,
  Hash,
  Inbox,
  ListOrdered,
  Loader2,
  Lock,
  LockOpen,
  Paperclip,
  Printer,
  Receipt,
  Sparkles,
  Warehouse,
  XCircle,
} from "lucide-react";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { CHIP, CODE_CHIP, NUM, TH, TOTAL_ROW } from "@/components/Material/shared/LabUI";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import { cn } from "@/lib/utils";

import { REF_LABELS } from "./kinds";
import { effectiveLine, fmtDate, fmtMoney, fmtQty, isLitre, lineMoney, num, overBy, shortBy } from "./format";
import { DetailField, IdChip, Kbd, PartyAvatar, SourceBadge, UI } from "./parts";
import { printInvoicingDocument, printOptionsFor } from "./print";
import { PRINT_CANCELLED } from "@/lib/officialPrint";
import { useCurrency } from "@/context/CurrencyContext";
import { useCompany } from "@/context/CompanyContext";
import AttachmentDropzone from "@/components/Attachments/AttachmentDropzone";
import LineAttachmentButton from "@/components/Attachments/LineAttachmentButton";
import { urlsOf } from "@/components/Attachments/attachmentUtils";

// Print menu of an invoiced document (components/Invoicing/print.js).
function PrintMenu({ kind, row }) {
  const { data: session } = useSession();
  const { currency } = useCurrency();
  const { company } = useCompany();
  const [printing, setPrinting] = useState(false);
  const options = printOptionsFor(kind);

  const print = async (type, label) => {
    setPrinting(true);
    try {
      await printInvoicingDocument(kind, row.tran_id, type, { session, currency, company });
    } catch (error) {
      if (error?.message === PRINT_CANCELLED) return;
      console.error("Print failed:", error);
      toast.error(error?.response?.data?.message || error?.message || `Could not print the ${label}`);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 gap-1.5" disabled={printing}>
          {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
          Print
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {options.map(([type, label]) => (
          <DropdownMenuItem key={type} onSelect={() => print(type, label)}>
            <Printer className="h-4 w-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Small section card inside the panel (LabCard's tinted header, compact).
function Section({ icon: Icon, title, hint, actions, children, className, bodyClassName = "p-3 sm:p-4" }) {
  return (
    <section className={cn("overflow-clip rounded-xl border border-border bg-background", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-3 py-2 sm:px-4">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        {hint && <span className="min-w-0 text-xs text-muted-foreground">{hint}</span>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// ── line grid ───────────────────────────────────────────────────────────
// Qty = the physical qty in the billing unit (litres on a LTR line). Ack Qty =
// what the invoice bills: prefilled with Qty, editable while pending; a line
// acknowledged short is shown in amber. Unit: a line may be billed per LTR
// (line.unit_switch) — Qty LTR = KG ÷ Density, amount = LTR × rate; Qty (KG)
// is the stock and never changes. Changing unit / density clears the Ack Qty. Under md every line is a card
// (table.vl-grid, app/globals.css); the item column is pinned on wide screens.
const TD = "px-3 py-2 align-middle";
const PIN = "md:sticky md:left-0 md:z-[1] md:bg-background md:shadow-[1px_0_0_0_hsl(var(--border))]";

function UnitSwitch({ line, value, onChange }) {
  return (
    <div role="group" aria-label={`Billing unit for ${line.item}`} className="inline-flex rounded-md border border-border p-0.5">
      {["KG", "LTR"].map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={value === u}
          onClick={() => value !== u && onChange(u)}
          className={cn(
            "h-7 rounded px-2 text-xs font-semibold transition-colors",
            value === u ? "bg-[#800000] text-white" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

function LineGrid({ row, editable, draft, issues, totals, onLineChange, filesOf, onFilesChange }) {
  const lines = row.lines || [];
  // Unit / density change the qty the invoice bills: the typed ack goes.
  const setBilling = (lineId, field, value) => {
    onLineChange(lineId, field, value);
    onLineChange(lineId, "ack_qty", undefined);
  };
  const issuesByLine = new Map();
  for (const i of issues) {
    if (i.line_id == null) continue;
    issuesByLine.set(i.line_id, [...(issuesByLine.get(i.line_id) || []), i]);
  }

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="vl-grid w-full border-collapse text-sm md:min-w-[1150px]">
        <thead>
          <tr>
            <th className={cn(TH, "left-0 z-20 min-w-[220px]")}>Item</th>
            <th className={TH}>Unit</th>
            <th className={cn(TH, "text-right")} title="KG per LTR — Qty LTR = Qty KG ÷ Density">
              Density
            </th>
            <th className={cn(TH, "text-right")}>Qty (KG)</th>
            <th className={cn(TH, "text-right")}>Qty</th>
            <th className={cn(TH, "text-right")} title="Acknowledged qty — what the invoice bills">
              Ack Qty
            </th>
            <th className={cn(TH, "text-right")}>Rate</th>
            <th className={cn(TH, "text-right")}>ST %</th>
            <th className={cn(TH, "text-right")}>Gross Amt</th>
            <th className={cn(TH, "text-right")}>ST Amt</th>
            <th className={cn(TH, "text-right")}>Amount w/ ST</th>
            <th className={cn(TH, "w-14 text-center")} title="Files attached to the line">
              Files
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((line) => {
            const e = effectiveLine(line, draft);
            const bl = editable ? e.line : line; // the line in its billing unit
            const rate = editable ? e.rate : line.rate;
            const stRate = editable ? e.st_rate : line.st_rate;
            const ack = editable ? e.ack : line.ack_qty;
            const money = editable
              ? lineMoney(bl, rate, stRate, ack)
              : { gross: num(line.gross_amount), tax: num(line.st_amount), total: num(line.total) };
            const litre = isLitre(bl);
            const unitLabel = litre ? "LTR" : "KG";
            const billable = bl.billable_qty ?? bl.priced_qty;
            const canSwitch = editable && line.unit_switch;
            const lineIssues = issuesByLine.get(line.line_id) || [];
            const ackIssue = lineIssues.some((i) => i.type === "ACK_INVALID");
            const rateIssue = lineIssues.some((i) => i.type === "NO_RATE");
            const densityIssue = lineIssues.some((i) => i.type === "NO_DENSITY");
            const short = ackIssue ? 0 : shortBy(bl, ack);
            const over = ackIssue ? 0 : overBy(bl, ack);
            const code = line.item_code || line.itcd;
            return (
              <tr
                key={line.line_id}
                className={cn(
                  "transition-colors hover:bg-muted/40",
                  short > 0 && "bg-[#f5f0e6]/60 dark:bg-amber-950/20",
                  lineIssues.length > 0 && "bg-destructive/5",
                )}
              >
                <td
                  data-label="Item"
                  className={cn(
                    TD,
                    PIN,
                    "max-md:col-span-2",
                    lineIssues.length > 0 && "md:shadow-[inset_3px_0_0_0_hsl(var(--destructive)),1px_0_0_0_hsl(var(--border))]",
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {code ? <span className={cn(CODE_CHIP, "w-fit")}>{code}</span> : null}
                    <span className="font-medium text-foreground">{line.item}</span>
                  </div>
                  {lineIssues.map((issue, i) => (
                    <div key={i} className="mt-0.5 flex items-center gap-1 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {issue.message}
                    </div>
                  ))}
                </td>
                <td data-label="Unit" className={cn(TD, "text-muted-foreground")}>
                  {canSwitch ? (
                    <UnitSwitch line={line} value={unitLabel} onChange={(u) => setBilling(line.line_id, "unit", u)} />
                  ) : (
                    bl.unit || "—"
                  )}
                </td>
                <td data-label="Density" className={cn(TD, "text-right")}>
                  {litre && canSwitch ? (
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      aria-label={`Density (KG per LTR) for ${line.item}`}
                      title="KG per LTR — from the item's LTR Rate; change it for this invoice only"
                      placeholder="KG/LTR"
                      value={bl.density ?? ""}
                      onChange={(ev) => setBilling(line.line_id, "density", ev.target.value)}
                      className={cn(
                        "h-9 w-24 text-right font-medium tabular-nums md:ml-auto",
                        densityIssue && "border-destructive focus-visible:ring-destructive/30",
                      )}
                    />
                  ) : litre && num(bl.density) > 0 ? (
                    <span className="tabular-nums text-muted-foreground">{fmtQty(bl.density)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td data-label="Qty (KG)" className={cn(TD, NUM)}>
                  {fmtQty(line.qty)}
                </td>
                <td data-label="Qty" className={cn(TD, NUM, "font-medium")}>
                  {fmtQty(billable)}
                  <span className="ml-1 text-[11px] text-muted-foreground">{unitLabel}</span>
                </td>
                <td data-label="Ack Qty" className={cn(TD, "text-right")}>
                  {editable ? (
                    <div className="flex items-center justify-end gap-1.5 max-md:justify-start">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        aria-label={`Acknowledged qty for ${line.item}`}
                        title="Acknowledged qty — the invoice bills this; stock keeps the physical qty"
                        placeholder={fmtQty(billable)}
                        value={ack ?? ""}
                        onChange={(ev) => onLineChange(line.line_id, "ack_qty", ev.target.value)}
                        className={cn(
                          "h-9 w-28 text-right font-semibold tabular-nums",
                          short > 0 && cn("border-[#c9a65a] dark:border-amber-700", CHIP.warn),
                          ackIssue && "border-destructive focus-visible:ring-destructive/30",
                        )}
                      />
                      <span className="w-7 text-left text-[11px] text-muted-foreground">{unitLabel}</span>
                    </div>
                  ) : (
                    <span className={cn("font-semibold tabular-nums", short > 0 && "text-[#5f4b1f] dark:text-amber-300")}>
                      {fmtQty(line.billed_qty ?? billable)}
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">{unitLabel}</span>
                    </span>
                  )}
                  {short > 0 ? (
                    <div className="mt-0.5 text-[11px] font-semibold text-[#5f4b1f] dark:text-amber-300">
                      short by {fmtQty(short)} {unitLabel}
                    </div>
                  ) : over > 0 ? (
                    <div className="mt-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300" title="Billed on more than the dispatched qty — stock stays on Qty (KG)">
                      over by {fmtQty(over)} {unitLabel} · stock unchanged
                    </div>
                  ) : null}
                </td>
                <td data-label="Rate" className={cn(TD, "text-right")}>
                  {line.trial && editable ? (
                    // Sent on Trial / Rate Negotiation: priced 0 here, billed later from its own part
                    <SourceBadge source="trial" />
                  ) : editable ? (
                    <div className="flex items-center justify-end gap-1.5 max-md:justify-start">
                      <SourceBadge source={e.edited ? "edited" : line.rate_source} />
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        aria-label={`Rate for ${line.item}`}
                        value={rate}
                        onChange={(ev) => onLineChange(line.line_id, "rate", ev.target.value)}
                        className={cn(
                          "h-9 w-28 text-right font-medium tabular-nums",
                          rateIssue && "border-destructive focus-visible:ring-destructive/30",
                        )}
                      />
                      {litre && <span className="text-[11px] text-muted-foreground">/LTR</span>}
                    </div>
                  ) : (
                    <span className="tabular-nums">
                      {num(line.rate) ? `${fmtMoney(line.rate)}${litre ? " /LTR" : ""}` : "—"}
                    </span>
                  )}
                </td>
                <td data-label="ST %" className={cn(TD, "text-right")}>
                  {editable ? (
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      aria-label={`ST % for ${line.item}`}
                      value={stRate}
                      onChange={(ev) => onLineChange(line.line_id, "st_rate", ev.target.value)}
                      className="h-9 w-20 text-right font-medium tabular-nums md:ml-auto"
                    />
                  ) : (
                    <span className="tabular-nums text-muted-foreground">
                      {num(line.st_rate) ? `${fmtQty(line.st_rate)}%` : "—"}
                    </span>
                  )}
                  {num(line.additional_tax) > 0 && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">+{fmtQty(line.additional_tax)}% add.</div>
                  )}
                </td>
                <td data-label="Gross Amt" className={cn(TD, NUM)}>
                  {fmtMoney(money.gross)}
                </td>
                <td data-label="ST Amt" className={cn(TD, NUM)}>
                  {fmtMoney(money.tax)}
                </td>
                <td data-label="Amount w/ ST" className={cn(TD, NUM, "font-semibold text-foreground")}>
                  {fmtMoney(money.total)}
                </td>
                <td className={cn(TD, "vl-actions text-center")}>
                  <LineAttachmentButton
                    value={filesOf(`line-${line.line_id}`, line.attachments)}
                    onChange={(urls) => onFilesChange(`line-${line.line_id}`, urls)}
                    target={{ lineId: line.line_id }}
                    lineLabel={[line.item_code, line.item].filter(Boolean).join(" - ")}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        {lines.length > 0 ? (
          // Phones read the totals from the panel footer.
          <tfoot className="max-md:hidden">
            <tr className={TOTAL_ROW}>
              <td className={cn(TD, PIN, "md:bg-muted")}>Total · {lines.length} line{lines.length === 1 ? "" : "s"}</td>
              <td className={TD} colSpan={2} />
              <td className={cn(TD, NUM)}>{fmtQty(totals.qty)}</td>
              <td className={TD} colSpan={4} />
              <td className={cn(TD, NUM)}>{fmtMoney(totals.gross)}</td>
              <td className={cn(TD, NUM)}>{fmtMoney(totals.tax)}</td>
              <td className={cn(TD, NUM, "text-primary")}>{fmtMoney(totals.total)}</td>
              <td className={TD} />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function FooterStat({ label, value, tone }) {
  return (
    <div className="min-w-0 text-right">
      <div className={cn(UI.label, tone === "warn" && "text-[#5f4b1f] dark:text-amber-300")}>{label}</div>
      <div
        className={cn(
          "text-[15px] font-semibold tabular-nums text-foreground",
          tone === "warn" && "text-[#5f4b1f] dark:text-amber-300",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ── panel ───────────────────────────────────────────────────────────────
export default function DetailPanel({
  kind,
  row,
  cfg,
  draft,
  totals,
  status,
  issues,
  nextNo,
  result,
  busy,
  onDraftChange,
  onLineChange,
  onGenerate,
  onUnlock,
}) {
  // Files added / removed here, by key (doc-<tran_id> / line-<line_id>): they
  // are already saved, this only keeps the panel current until the next load.
  const [fileEdits, setFileEdits] = useState({});
  const filesOf = (key, loaded) => urlsOf(fileEdits[key] ?? loaded);
  const onFilesChange = (key, urls) => setFileEdits((prev) => ({ ...prev, [key]: urls }));

  if (!row) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Inbox className="h-6 w-6 text-primary" />
        </span>
        <p className="font-semibold text-foreground">Select a {cfg.docNoun}</p>
        <p className={cn("max-w-xs text-sm", UI.muted)}>
          Pick one from the list, or use <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move through the queue.
        </p>
      </div>
    );
  }

  const pending = !row.invoiced;
  const refs = REF_LABELS.filter(([k]) => k !== cfg.ownRef && row.ref?.[k] != null && row.ref[k] !== "");
  const typedNo = String(draft?.invoice_no ?? "").trim();
  const billing = (row.lines || []).map((l) => (pending ? effectiveLine(l, draft).line : l));
  const litreQty = billing.filter(isLitre).reduce((s, l) => s + num(l.priced_qty), 0);
  // Lines billed on less than their qty (acknowledged short).
  const shortLines = (row.lines || []).filter(
    (l, i) => shortBy(billing[i], pending ? effectiveLine(l, draft).ack : l.ack_qty) > 0,
  ).length;
  const failed = result && result.status !== "invoiced" && result.message;
  // The source document (dispatch / GRN / return), read-only on its own list page.
  const docHref = voucherHref({ tran_code: cfg.tranCode, tran_id: row.tran_id });

  return (
    <div className="flex h-full flex-col">
      {/* ── header ── */}
      <div className="shrink-0 border-b border-border p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PartyAvatar name={row.party?.acname} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {row.party?.acname || `No ${cfg.partyLabel.toLowerCase()}`}
              </h2>
              <div className={cn("mt-0.5 flex flex-wrap items-center gap-x-2 text-sm", UI.muted)}>
                <span>
                  {cfg.partyLabel} <span className="font-mono tabular-nums">{row.party?.acno ?? "—"}</span>
                </span>
                {row.godown?.name ? (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Warehouse className="h-3.5 w-3.5" />
                      {row.godown.name}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* actions */}
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {docHref ? (
              <Button asChild variant="outline" className="h-9 gap-1.5" title={`Open this ${cfg.docNoun} (read-only)`}>
                <Link href={docHref}>
                  <ExternalLink className="h-4 w-4" />
                  Open {cfg.docNoun}
                </Link>
              </Button>
            ) : null}
            {row.invoiced ? (
              <>
                <PrintMenu kind={kind} row={row} />
                <Button
                  variant="outline"
                  className="h-9 gap-1.5 hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => onUnlock(row)}
                  disabled={busy}
                  title={`Reverse this ${cfg.invoiceNoun.toLowerCase()} and send the ${cfg.docNoun} back to Pending`}
                >
                  <LockOpen className="h-4 w-4" />
                  Unlock
                </Button>
              </>
            ) : status === "ready" ? (
              <Button className="h-9 px-4 max-sm:flex-1" disabled={busy} onClick={() => onGenerate(row)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate {cfg.invoiceNoun}
                <Kbd className="ml-1 hidden sm:inline">↵</Kbd>
              </Button>
            ) : (
              <span className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", CHIP.bad)}>
                <AlertTriangle className="h-4 w-4" />
                Cannot invoice yet
              </span>
            )}
          </div>
        </div>

        {/* identity chips */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <IdChip tone="doc" label={cfg.docChipLong} value={row.doc_no ?? row.tran_id} />
          {refs.map(([k, , long, tone]) => (
            <IdChip key={k} tone={tone} label={long} value={row.ref[k]} />
          ))}
          {row.invoiced ? (
            <IdChip
              tone={row.legacy ? "legacy" : "invoice"}
              label={row.legacy ? "LEGACY" : cfg.invoiceNoun}
              value={row.invoice_no || "—"}
              title={row.legacy ? "Invoiced before the Invoicing screens (imported / old series)" : undefined}
            />
          ) : null}
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {fmtDate(row.dated)}
          </span>
          {row.without_godown ? (
            <span
              className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-semibold", CHIP.warn)}
              title="No production — dispatched from the Despatch Without Godown godown; the sale goes to the item category's No Godown Sale account."
            >
              Despatch Without Godown
            </span>
          ) : null}
          {pending ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 px-2 py-0.5 text-xs text-muted-foreground">
              {typedNo ? "will be posted as" : "will become"}
              <span className="font-mono text-[13px] font-semibold text-primary">
                {typedNo || nextNo || "next number"}
              </span>
              {!typedNo && nextNo ? <span>(automatic)</span> : null}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── scrollable body ── */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-3 sm:p-4">
        <div className="space-y-3">
          {/* blocking issues */}
          {pending && issues.length > 0 ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Cannot invoice yet — fix these first
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
                {issues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* last generate attempt failed */}
          {failed ? (
            <div className={cn("flex items-start gap-2 rounded-xl border border-[#c9a65a]/50 p-3 text-sm font-medium dark:border-amber-800", CHIP.warn)}>
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {result.status === "blocked" ? "Blocked" : "Failed"}: {result.message}
              </span>
            </div>
          ) : null}

          {/* invoice fields */}
          {pending ? (
            <Section icon={Receipt} title={cfg.invoiceNoun}>
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                <label className="space-y-1.5">
                  <span className={UI.label}>{cfg.invoiceNoun} No</span>
                  <Input
                    value={draft?.invoice_no ?? ""}
                    onChange={(e) => onDraftChange(row.tran_id, { invoice_no: e.target.value })}
                    placeholder={nextNo ? `Auto: ${nextNo}` : "Automatic"}
                    className="h-10 font-mono font-semibold tabular-nums"
                  />
                  <span className={cn("block text-xs", UI.muted)}>Leave blank to take the next number.</span>
                </label>
                {cfg.vendorBill && (
                  <>
                    <label className="space-y-1.5">
                      <span className={UI.label}>Vendor Bill No</span>
                      <Input
                        value={draft?.vendor_bill_no ?? ""}
                        onChange={(e) => onDraftChange(row.tran_id, { vendor_bill_no: e.target.value })}
                        placeholder="Optional"
                        className="h-10"
                      />
                    </label>
                    <div className="space-y-1.5">
                      <span className={UI.label}>Bill Date</span>
                      <DateField
                        value={draft?.bill_date ?? ""}
                        onChange={(iso) => onDraftChange(row.tran_id, { bill_date: iso })}
                        clearable
                        inputClassName="h-10"
                      />
                    </div>
                  </>
                )}
                <div className="flex items-start sm:pt-1">
                  <DetailField icon={Warehouse} label="Godown">
                    {row.godown?.name}
                  </DetailField>
                </div>
              </div>
            </Section>
          ) : (
            <Section icon={Lock} title={`${cfg.invoiceNoun} · posted`}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 2xl:grid-cols-5">
                <DetailField icon={Receipt} label={`${cfg.invoiceNoun} No`}>
                  <span className="font-mono">{row.invoice_no}</span>
                </DetailField>
                {cfg.vendorBill && (
                  <>
                    <DetailField icon={Hash} label="Vendor Bill No">
                      {row.vendor_bill_no}
                    </DetailField>
                    <DetailField icon={CalendarDays} label="Bill Date">
                      {row.bill_date ? fmtDate(row.bill_date) : null}
                    </DetailField>
                  </>
                )}
                <DetailField icon={Warehouse} label="Godown">
                  {row.godown?.name}
                </DetailField>
                <DetailField icon={Lock} label="Status">
                  {row.legacy ? "Legacy — imported history" : "Posted · unlock to change"}
                </DetailField>
              </div>
            </Section>
          )}

          {/* priced lines */}
          <Section
            icon={ListOrdered}
            title="Lines"
            hint={pending ? "Rate, ST % and Ack Qty are editable" : undefined}
            bodyClassName=""
          >
            <LineGrid
              row={row}
              editable={pending}
              draft={draft}
              issues={issues}
              totals={totals}
              onLineChange={(lineId, field, value) => onLineChange(row.tran_id, lineId, field, value)}
              filesOf={filesOf}
              onFilesChange={onFilesChange}
            />
          </Section>

          {pending ? (
            <p className={cn("flex items-start gap-1.5 text-xs", UI.muted)}>
              <FileCheck2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Amounts are a preview on the Ack Qty — the server re-prices every line with the same formula when it
              posts. Stock keeps the physical qty.
            </p>
          ) : null}

          {/* attachments of the document */}
          <Section
            icon={Paperclip}
            title="Attachments"
            hint={`bills, delivery proofs… saved to this ${cfg.docNoun} straight away; per-line files: the paperclip on each line`}
          >
            <AttachmentDropzone
              compact
              value={filesOf(`doc-${row.tran_id}`, row.attachments)}
              onChange={(urls) => onFilesChange(`doc-${row.tran_id}`, urls)}
              target={{ voucherId: row.tran_id }}
              label={`${cfg.docNoun} attachments`}
              hint="PDF, images, Word, Excel · saved immediately"
            />
          </Section>
        </div>
      </div>

      {/* ── totals footer ── */}
      <div className="shrink-0 border-t border-border bg-muted/40 px-3 py-2.5 sm:px-4">
        <div className="grid grid-cols-2 items-center gap-x-6 gap-y-2 sm:flex sm:flex-wrap sm:justify-end">
          <FooterStat label="Lines" value={(row.lines || []).length} />
          <FooterStat label="Total Qty (KG)" value={fmtQty(totals.qty)} />
          {litreQty > 0 ? <FooterStat label="Total Qty (LTR)" value={fmtQty(litreQty)} /> : null}
          {shortLines > 0 ? (
            <FooterStat tone="warn" label="Ack Short" value={`${shortLines} line${shortLines === 1 ? "" : "s"}`} />
          ) : null}
          <FooterStat label="Gross" value={fmtMoney(totals.gross)} />
          <FooterStat label="Sales Tax" value={fmtMoney(totals.tax)} />
          <div className="col-span-2 rounded-lg bg-primary px-4 py-1.5 text-right text-primary-foreground">
            <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
              Amount incl. ST{pending ? " · preview" : ""}
            </div>
            <div className="text-xl font-semibold tabular-nums sm:text-2xl">{fmtMoney(totals.total)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
