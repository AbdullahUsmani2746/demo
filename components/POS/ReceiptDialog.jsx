"use client";
// A posted receipt: preview + print on the till's thermal roll (58 / 80 mm) or
// as an A4 invoice. P prints the receipt, A prints A4, Esc (or Enter right
// after a sale) closes.
import React, { useEffect, useMemo } from "react";
import { CheckCircle2, FileText, Printer, RotateCcw, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { receiptHtml, invoiceHtml, printHtml } from "@/lib/pos/receiptHtml";
import { Kbd, fmt } from "@/components/POS/shared";

export default function ReceiptDialog({ receipt, onClose, company, settings, symbol, justSaved = false, onRefund }) {
  const open = !!receipt;
  const ctx = useMemo(() => ({ company, settings, currency: symbol }), [company, settings, symbol]);
  const html = useMemo(() => (receipt ? receiptHtml(receipt, ctx) : ""), [receipt, ctx]);
  const printReceipt = () => receipt && printHtml(receiptHtml(receipt, ctx));
  const printA4 = () => receipt && printHtml(invoiceHtml(receipt, ctx));

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "p" || e.key === "P") { e.preventDefault(); printReceipt(); }
      if (e.key === "Enter" && justSaved) { e.preventDefault(); onClose(); } // straight on to the next sale
      if (e.key === "a" || e.key === "A") { e.preventDefault(); printA4(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const w = Number(settings?.paperWidth) === 58 ? 58 : 80;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[95vh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            {justSaved && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
            {receipt?.kind === "RETURN" ? "Refund" : justSaved ? "Sale complete" : "Receipt"} · {receipt?.invoice_no}
          </DialogTitle>
          <DialogDescription>
            {receipt?.kind === "RETURN" ? "Refunded" : "Total"} <b className="text-foreground">{symbol} {fmt(receipt?.total)}</b>
            {receipt?.change_due ? <> · change <b className="text-emerald-700">{fmt(receipt.change_due)}</b></> : null}
          </DialogDescription>
        </DialogHeader>
        {receipt?.change_due > 0 && justSaved && (
          <div className="mx-5 mt-4 rounded-xl bg-emerald-600 px-4 py-3 text-center text-white">
            <p className="text-[12px] uppercase tracking-wider opacity-85">Give change</p>
            <p className="text-3xl font-extrabold tabular-nums">{fmt(receipt.change_due)}</p>
          </div>
        )}
        <div className="flex justify-center bg-muted/50 px-3 py-4">
          <iframe
            title="Receipt preview"
            srcDoc={html}
            className="rounded bg-white shadow-sm"
            style={{ width: `${w === 58 ? 240 : 310}px`, height: "420px", border: 0 }}
          />
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-border bg-background px-5 py-3">
          <Button onClick={printReceipt} className="h-11"><Printer className="mr-2 h-4 w-4" /> Receipt <Kbd className="ml-2 text-primary-foreground">P</Kbd></Button>
          <Button onClick={printA4} variant="outline" className="h-11"><FileText className="mr-2 h-4 w-4" /> A4 invoice <Kbd className="ml-2">A</Kbd></Button>
          {onRefund && receipt?.kind === "SALE" && (
            <Button onClick={() => onRefund(receipt)} variant="outline" className="h-11"><RotateCcw className="mr-2 h-4 w-4" /> Refund</Button>
          )}
          <Button onClick={onClose} variant={justSaved ? "default" : "outline"} className={`h-11 ${onRefund && receipt?.kind === "SALE" ? "" : "col-span-2"} ${justSaved ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}>
            <X className="mr-2 h-4 w-4" /> {justSaved ? "New sale" : "Close"} <Kbd className="ml-2">{justSaved ? "Enter" : "Esc"}</Kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
