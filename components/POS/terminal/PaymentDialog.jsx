"use client";
// Take payment: cash (with change), card / bank (with a reference), credit to
// the customer's account (feature pos.creditSales + pos.credit) — any mix.
// The typed amount counts as a payment: Enter (or Complete) saves once the bill is covered; otherwise it is added and the rest is still due.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, CreditCard, Landmark, Loader2, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { round2, settlePayments } from "@/lib/pos/calc";
import { Kbd, fmt } from "@/components/POS/shared";

const METHODS = [
  { value: "CASH", label: "Cash", icon: Banknote, key: "F1" },
  { value: "CARD", label: "Card / Bank", icon: CreditCard, key: "F2" },
  { value: "CREDIT", label: "On account", icon: Landmark, key: "F3" },
];

export default function PaymentDialog({ open, onOpenChange, total, symbol, allowCredit, creditHint, initialMethod = "CASH", saving, error, onComplete }) {
  const [payments, setPayments] = useState([]);
  const [method, setMethod] = useState(initialMethod);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const amountRef = useRef(null);

  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  const due = round2(Math.max(total - paid, 0));
  const settled = useMemo(() => settlePayments(total, payments), [total, payments]);
  // The amount typed but not yet added counts too: "Complete" adds it and saves.
  const typed = round2(Number(amount));
  const pendingOk = typed > 0 && due > 0 && (method === "CASH" || typed <= due + 0.001);
  const preview = useMemo(
    () => (pendingOk ? [...payments, { method, amount: typed, reference: method === "CARD" && reference ? reference : null }] : payments),
    [pendingOk, payments, method, typed, reference],
  );
  const previewSettled = useMemo(() => settlePayments(total, preview), [total, preview]);
  const ready = !previewSettled.error;
  const previewPaid = round2(preview.reduce((s, p) => s + p.amount, 0));

  useEffect(() => {
    if (!open) return;
    setPayments([]);
    setMethod(initialMethod === "CREDIT" && !allowCredit ? "CASH" : initialMethod);
    setAmount(String(round2(total)));
    setReference("");
    setTimeout(() => amountRef.current?.select(), 60);
  }, [open, total, initialMethod, allowCredit]);

  useEffect(() => {
    if (open) setAmount(due > 0 ? String(due) : "");
  }, [payments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (m) => {
    if (m === "CREDIT" && !allowCredit) return;
    setMethod(m);
    setTimeout(() => amountRef.current?.select(), 30);
  };

  const add = (value = amount) => {
    const n = round2(Number(value));
    if (!(n > 0)) return payments;
    if (method !== "CASH" && n > due + 0.001) return payments; // only cash gives change
    const next = [...payments, { method, amount: n, reference: method === "CARD" && reference ? reference : null }];
    setPayments(next);
    setReference("");
    return next;
  };

  const complete = (list = payments) => {
    const s = settlePayments(total, list);
    if (s.error || saving) return;
    onComplete(list);
  };

  const onKey = (e) => {
    if (e.key === "F1" || e.key === "F2" || e.key === "F3") {
      e.preventDefault();
      choose(METHODS[Number(e.key.slice(1)) - 1].value);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (ready) return complete(preview);
      add();
    }
  };

  const quick = useMemo(() => {
    if (method !== "CASH" || due <= 0) return [];
    const set = new Set([due]);
    for (const step of [10, 50, 100, 500, 1000, 5000]) {
      const v = Math.ceil(due / step) * step;
      if (v > due) set.add(v);
    }
    return [...set].sort((a, b) => a - b).slice(0, 5);
  }, [method, due]);

  const overAmount = method !== "CASH" && Number(amount) > due + 0.001;

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-h-[95vh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto p-0" onKeyDown={onKey}>
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="text-lg">Take payment</DialogTitle>
          <DialogDescription className="sr-only">Payment methods and amounts for this bill.</DialogDescription>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted px-2 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="text-lg font-bold tabular-nums">{fmt(total)}</p>
            </div>
            <div className="rounded-lg bg-muted px-2 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid</p>
              <p className="text-lg font-bold tabular-nums">{fmt(previewPaid)}</p>
            </div>
            <div className={`rounded-lg px-2 py-2 ${!ready ? "bg-primary text-primary-foreground" : "bg-emerald-600 text-white"}`}>
              <p className="text-[11px] uppercase tracking-wide opacity-80">{!ready ? "Due" : "Change"}</p>
              <p className="text-lg font-bold tabular-nums">{fmt(!ready ? Math.max(total - previewPaid, 0) : previewSettled.change || 0)}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const off = m.value === "CREDIT" && !allowCredit;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={method === m.value}
                  disabled={off}
                  title={off ? creditHint : undefined}
                  onClick={() => choose(m.value)}
                  className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-[13px] font-semibold transition-colors ${
                    method === m.value ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{m.label}</span>
                  <Kbd>{m.key}</Kbd>
                </button>
              );
            })}
          </div>
          {!allowCredit && creditHint && <p className="-mt-2 text-[11.5px] text-muted-foreground">{creditHint}</p>}

          <div className="space-y-2">
            <label className="text-[12px] font-semibold text-muted-foreground" htmlFor="pos-pay-amount">
              {method === "CASH" ? "Cash received" : method === "CARD" ? "Card / bank amount" : "Amount on account"}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                {symbol && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>}
                <input
                  id="pos-pay-amount"
                  ref={amountRef}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`h-12 w-full rounded-lg border bg-background pr-3 text-right text-xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 ${symbol ? "pl-14" : "pl-3"} ${overAmount ? "border-destructive" : "border-input"}`}
                />
              </div>
              <Button type="button" variant="outline" className="h-12 px-4" onClick={() => add()} disabled={!(Number(amount) > 0) || overAmount || due <= 0}>
                Add
              </Button>
            </div>
            {overAmount && <p className="text-[12px] text-destructive">Only cash can be more than what is due ({fmt(due)}).</p>}
            {method === "CARD" && (
              <input
                type="text"
                value={reference}
                maxLength={80}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Reference (last 4 digits, approval no.) — optional"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            )}
            {method === "CREDIT" && creditHint && <p className="text-[12px] text-muted-foreground">{creditHint}</p>}
            {quick.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {quick.map((v, i) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      const next = add(v);
                      if (!settlePayments(total, next).error) complete(next);
                    }}
                    className="min-h-[44px] flex-1 rounded-lg border border-border bg-muted/40 px-3 text-sm font-semibold tabular-nums hover:border-primary/50 hover:text-primary"
                  >
                    {i === 0 ? "Exact " : ""}
                    {fmt(v)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {payments.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {payments.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">
                    {METHODS.find((m) => m.value === p.method)?.label}
                    {p.reference ? <span className="ml-1 text-muted-foreground">· {p.reference}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">{fmt(p.amount)}</span>
                    <button type="button" aria-label="Remove payment" onClick={() => setPayments(payments.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive">{error}</p>}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-border bg-background px-5 py-3">
          <Button type="button" variant="outline" className="h-12" onClick={() => onOpenChange(false)} disabled={saving}>
            <X className="mr-1 h-4 w-4" /> Back <Kbd className="ml-2">Esc</Kbd>
          </Button>
          <Button type="button" className="h-12 flex-1 text-base font-bold" disabled={!ready || saving} onClick={() => complete(preview)}>
            {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
            {saving ? "Saving…" : ready ? `Complete sale${previewSettled.change ? ` · change ${fmt(previewSettled.change)}` : ""}` : `Due ${fmt(Math.max(total - previewPaid, 0))}`}
            {!saving && <Kbd className="ml-2 text-primary-foreground">Enter</Kbd>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
