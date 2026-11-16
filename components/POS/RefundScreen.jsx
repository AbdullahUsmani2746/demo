"use client";
// Refund against a receipt: find the receipt (number or scan), pick how many
// of each line come back, the reason and how the money goes back (drawer
// cash, card, or the customer's account). Posted as a POS return (tran_code 12)
// by lib/pos/posting.js — a line is never refunded more than was sold.
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Banknote, CreditCard, Landmark, Loader2, Minus, Plus, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ReceiptDialog from "@/components/POS/ReceiptDialog";
import { computeRefund } from "@/lib/pos/calc";
import { usePosBoot, POS_BOOT_KEY, useMoney, fmt, fmtQty, apiError, newClientRef, Kbd } from "@/components/POS/shared";

const REASONS = ["Damaged", "Wrong item", "Changed mind", "Defective", "Overcharged"];

export default function RefundScreen() {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { data: boot } = usePosBoot();
  const { symbol } = useMoney();
  const [term, setTerm] = useState("");
  const [sale, setSale] = useState(null);
  const [finding, setFinding] = useState(false);
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("CASH");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [clientRef, setClientRef] = useState(newClientRef);
  const inputRef = useRef(null);

  const load = async (id) => {
    setFinding(true);
    setError("");
    try {
      const { data } = await axios.get(`/api/pos/orders/${id}`);
      if (data.kind !== "SALE") throw Object.assign(new Error(), { response: { data: { error: `${data.invoice_no} is a refund, not a sale.` } } });
      setSale(data);
      setQty({});
      setReason("");
      setMethod("CASH");
      setClientRef(newClientRef());
    } catch (err) {
      setSale(null);
      setError(apiError(err, "Receipt not found."));
    } finally {
      setFinding(false);
    }
  };
  useEffect(() => {
    const id = Number(params?.get("receipt"));
    if (id) load(id);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const find = async (e) => {
    e?.preventDefault();
    const t = term.trim();
    if (!t) return;
    setFinding(true);
    setError("");
    try {
      const { data } = await axios.get("/api/pos/orders", { params: { search: t, kind: "SALE", limit: 5 } });
      const hit = data.receipts.find((r) => r.invoice_no?.toLowerCase() === t.toLowerCase() || String(r.vr_no) === t.replace(/^POS-/i, "")) || data.receipts[0];
      if (!hit) { setSale(null); setError(`No sale “${t}” found.`); setFinding(false); return; }
      await load(hit.tran_id);
    } catch (err) {
      setError(apiError(err));
      setFinding(false);
    }
  };

  const lines = useMemo(() => (sale?.items || []).map((i) => ({ ...i, camt: i.net, st_amount: i.tax, left: Math.max(0, i.qty - (i.returned || 0)) })), [sale]);
  const refund = useMemo(() => (sale ? computeRefund(lines, qty, Object.fromEntries(lines.map((l) => [l.id, l.returned || 0])), sale.rounding) : null), [sale, lines, qty]);
  // "To account" only for a sale made to a customer account (a walk-in's party is the till account, sent as null).
  const credit = sale?.payments?.some((p) => p.method === "CREDIT") || !!sale?.party;
  const setLineQty = (l, v) => setQty((q) => ({ ...q, [l.id]: Math.min(Math.max(0, v), l.left) }));
  const allBack = () => setQty(Object.fromEntries(lines.map((l) => [l.id, l.left])));

  const submit = async () => {
    if (!refund?.lines.length || saving) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await axios.post("/api/pos/returns", {
        clientRef,
        saleTranId: sale.tran_id,
        lines: refund.lines.map((r) => ({ id: r.line.id, qty: r.qty })),
        refundMethod: method,
        reason: reason || undefined,
      }, { timeout: 30_000 });
      setDone(data.receipt);
      setSale(null);
      setTerm("");
      queryClient.invalidateQueries({ queryKey: POS_BOOT_KEY });
      queryClient.invalidateQueries({ queryKey: ["pos", "receipts"] });
    } catch (err) {
      setError(apiError(err, "The refund could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  if (boot && !boot.rights?.refund) {
    return <p className="m-4 rounded-xl border border-border bg-muted p-6 text-center text-sm text-muted-foreground">Refunds need the pos.refund right.</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-32 sm:p-4">
      <div>
        <h1 className="text-xl font-bold">Refund</h1>
        <p className="text-[13px] text-muted-foreground">Find the sale, pick what comes back and how the money is returned.{boot?.settings?.returnDays ? ` Receipts up to ${boot.settings.returnDays} days old.` : ""}</p>
      </div>
      <form onSubmit={find} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input ref={inputRef} autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Receipt no. (POS-123) — or scan the receipt"
            aria-label="Receipt number" className="h-12 w-full rounded-xl border border-input bg-background pl-11 pr-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <Button type="submit" className="h-12 px-5" disabled={finding || !term.trim()}>{finding ? <Loader2 className="h-5 w-5 animate-spin" /> : "Find"}</Button>
      </form>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive">{error}</p>}

      {sale && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-3">
            <div>
              <p className="text-base font-bold">{sale.invoice_no}</p>
              <p className="text-[12.5px] text-muted-foreground">
                {new Date(sale.time || sale.dated).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {sale.customer_name || sale.party?.acname || "Walk-in"} · {sale.entered_by}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase text-muted-foreground">Sale total</p>
              <p className="text-lg font-bold tabular-nums">{fmt(sale.total)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Items coming back</h2>
            <Button variant="outline" size="sm" onClick={allBack}>Everything left</Button>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border bg-background">
            {lines.map((l) => {
              const q = Number(qty[l.id] || 0);
              return (
                <li key={l.id} className={`flex flex-wrap items-center gap-3 p-3 ${l.left <= 0 ? "opacity-50" : ""}`}>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-semibold">{l.name}</p>
                    <p className="text-[12px] text-muted-foreground">
                      Sold {fmtQty(l.qty)} × {fmt(l.rate)}{l.discount ? ` − ${fmt(l.discount)}` : ""}{l.returned ? ` · already back ${fmtQty(l.returned)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center rounded-lg border border-border">
                    <button type="button" aria-label="Less" disabled={l.left <= 0} onClick={() => setLineQty(l, q - 1)} className="flex h-11 w-11 items-center justify-center hover:bg-muted disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                    <input type="number" inputMode="decimal" min="0" max={l.left} step="any" value={q || ""} placeholder="0" disabled={l.left <= 0} aria-label={`Return quantity of ${l.name}`}
                      onChange={(e) => setLineQty(l, Number(e.target.value) || 0)} className="h-11 w-16 border-x border-border bg-background text-center text-sm font-semibold tabular-nums focus:outline-none" />
                    <button type="button" aria-label="More" disabled={l.left <= 0} onClick={() => setLineQty(l, q + 1)} className="flex h-11 w-11 items-center justify-center hover:bg-muted disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                  </div>
                  <span className="w-24 text-right text-sm font-bold tabular-nums">{fmt(refund?.lines.find((r) => r.line.id === l.id)?.amount || 0)}</span>
                </li>
              );
            })}
          </ul>

          <div className="rounded-xl border border-border bg-background p-3">
            <p className="mb-2 text-sm font-semibold">Reason</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className={`min-h-[36px] rounded-full border px-3 text-[12.5px] font-medium ${reason === r ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40"}`}>{r}</button>
              ))}
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} placeholder="Or type the reason" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
          </div>

          <div className="rounded-xl border border-border bg-background p-3">
            <p className="mb-2 text-sm font-semibold">Give the money back as</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Refund method">
              {[["CASH", "Cash", Banknote], ["CARD", "Card / Bank", CreditCard], ["CREDIT", "To account", Landmark]].map(([v, l, Icon]) => (
                <button key={v} type="button" role="radio" aria-checked={method === v} disabled={v === "CREDIT" && !credit} onClick={() => setMethod(v)}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl border-2 text-[13px] font-semibold ${method === v ? "border-primary bg-primary/5 text-primary" : "border-border"} disabled:opacity-40`}>
                  <Icon className="h-5 w-5" /> {l}
                </button>
              ))}
            </div>
            {!credit && <p className="mt-1.5 text-[11.5px] text-muted-foreground">“To account” needs a sale made to a customer account.</p>}
          </div>
        </div>
      )}

      {sale && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Refund{refund?.tax ? ` (incl. tax ${fmt(refund.tax)})` : ""}</p>
              <p className="text-2xl font-extrabold tabular-nums text-primary">{symbol} {fmt(refund?.total || 0)}</p>
            </div>
            <Button className="h-12 px-6 text-base font-bold" disabled={!refund?.lines.length || saving} onClick={submit}>
              {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RotateCcw className="mr-2 h-5 w-5" />} Refund
            </Button>
          </div>
        </div>
      )}

      {!sale && !error && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <RotateCcw className="h-10 w-10 opacity-30" />
          <p className="text-sm">Type or scan the receipt number. From <b>Receipts</b> you can also open a sale and press Refund.</p>
          <p className="text-[12px]">Press <Kbd>Enter</Kbd> to find.</p>
        </div>
      )}

      <ReceiptDialog receipt={done} justSaved onClose={() => { setDone(null); setTimeout(() => inputRef.current?.focus(), 50); }} company={boot?.company} settings={boot?.settings} symbol={symbol} />
    </div>
  );
}
