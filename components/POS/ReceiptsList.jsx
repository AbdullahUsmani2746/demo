"use client";
// POS receipts (sales and refunds) of the till — own receipts, or every till
// with pos.allShifts. Open one to reprint (thermal / A4) or refund it. Wide
// list on desktop, cards on a phone.
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Loader2, Receipt, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReceiptDialog from "@/components/POS/ReceiptDialog";
import { usePosBoot, useMoney, fmt, apiError } from "@/components/POS/shared";
import { toast } from "sonner";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const METHOD = { CASH: "Cash", CARD: "Card", CREDIT: "Account" };

export default function ReceiptsList({ openId = null }) {
  const router = useRouter();
  const { data: boot } = usePosBoot();
  const { symbol } = useMoney();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("ALL");
  const [from, setFrom] = useState(() => iso(new Date()));
  const [to, setTo] = useState(() => iso(new Date()));
  const [receipt, setReceipt] = useState(null);
  const [opening, setOpening] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["pos", "receipts", q, kind, from, to],
    queryFn: async () => (await axios.get("/api/pos/orders", { params: { search: q || undefined, kind, from: q ? undefined : from, to: q ? undefined : to, limit: 200 } })).data.receipts,
    staleTime: 10_000,
  });
  const rows = data || [];
  const sales = rows.filter((r) => r.kind === "SALE").reduce((s, r) => s + Number(r.total || 0), 0);
  const refunds = rows.filter((r) => r.kind === "RETURN").reduce((s, r) => s + Number(r.total || 0), 0);

  const open = async (id) => {
    setOpening(id);
    try {
      setReceipt((await axios.get(`/api/pos/orders/${id}`)).data);
    } catch (err) {
      toast.error(apiError(err, "Could not open the receipt."));
    } finally {
      setOpening(null);
    }
  };
  useEffect(() => { if (openId) open(openId); }, [openId]);

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Receipts</h1>
          <p className="text-[13px] text-muted-foreground">{boot?.rights?.allShifts ? "Every till" : "Your receipts"} · open one to reprint or refund it.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /></Button>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-background p-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Receipt no. (POS-12 / RET-3) or customer" aria-label="Search receipts"
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!!q} aria-label="From" className="h-10 min-w-0 rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!!q} aria-label="To" className="h-10 min-w-0 rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50" />
        </div>
        <div className="grid w-full grid-cols-3 rounded-lg border border-border p-0.5 sm:flex sm:w-auto" role="tablist" aria-label="Kind">
          {[["ALL", "All"], ["SALE", "Sales"], ["RETURN", "Refunds"]].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={kind === v} onClick={() => setKind(v)} className={`h-9 rounded-md px-3 text-[13px] font-semibold ${kind === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Sales" value={fmt(sales)} />
        <Stat label="Refunds" value={fmt(refunds)} />
        <Stat label="Net" value={fmt(sales - refunds)} strong />
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{apiError(error)}</p>}

      {/* desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-background md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-[12px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">Receipt</th><th className="px-3 py-2">Date / time</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Paid by</th><th className="px-3 py-2">Entered by</th><th className="px-3 py-2 text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.tran_id} onClick={() => open(r.tran_id)} className="cursor-pointer hover:bg-primary/[0.03]">
                <td className="px-3 py-2.5 font-semibold">
                  <span className="inline-flex items-center gap-2">
                    {opening === r.tran_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5 text-muted-foreground" />}
                    {r.invoice_no}
                    {r.kind === "RETURN" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-800">REFUND</span>}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{new Date(r.dated).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="max-w-[220px] truncate px-3 py-2.5">{r.customer || "Walk-in"}</td>
                <td className="px-3 py-2.5">{r.methods.map((m) => METHOD[m] || m).join(" + ") || "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.entered_by || ""}</td>
                <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${r.kind === "RETURN" ? "text-amber-700" : ""}`}>{r.kind === "RETURN" ? "− " : ""}{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="px-3 py-10 text-center text-sm text-muted-foreground">{isFetching ? "Loading…" : "No receipts."}</p>}
      </div>

      {/* phone cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.tran_id}>
            <button type="button" onClick={() => open(r.tran_id)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3 text-left">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {r.invoice_no}
                  {r.kind === "RETURN" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">REFUND</span>}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {new Date(r.dated).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {r.customer || "Walk-in"} · {r.methods.map((m) => METHOD[m] || m).join(" + ") || "—"}
                </p>
              </div>
              <span className={`text-base font-bold tabular-nums ${r.kind === "RETURN" ? "text-amber-700" : ""}`}>{r.kind === "RETURN" ? "− " : ""}{fmt(r.total)}</span>
            </button>
          </li>
        ))}
        {!rows.length && <li className="py-10 text-center text-sm text-muted-foreground">{isFetching ? "Loading…" : "No receipts."}</li>}
      </ul>

      <ReceiptDialog
        receipt={receipt}
        onClose={() => setReceipt(null)}
        company={boot?.company}
        settings={boot?.settings}
        symbol={symbol}
        onRefund={boot?.rights?.refund ? (r) => router.push(`/pos/posReturn?receipt=${r.tran_id}`) : null}
      />
    </div>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${strong ? "border-primary/30 bg-primary/5" : "border-border bg-background"}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${strong ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}
