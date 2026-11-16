"use client";
// Shift & day close. Open a shift with the float in the drawer; close it with
// the cash counted — the Z report (sales by payment method, refunds, cash
// expected vs counted) is frozen on the shift and printed on the till roll.
// Also today's figures (own till, or every till with pos.allShifts) and the
// recent shifts with their Z reports.
import React, { useState } from "react";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Clock, Loader2, Lock, Play, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { zReportHtml, printHtml } from "@/lib/pos/receiptHtml";
import { usePosBoot, POS_BOOT_KEY, useMoney, fmt, fmtQty, apiError } from "@/components/POS/shared";

const when = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function ShiftScreen() {
  const queryClient = useQueryClient();
  const { data: boot } = usePosBoot();
  const { symbol } = useMoney();
  const [all, setAll] = useState(false);
  const [float, setFloat] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["pos", "shifts", all],
    queryFn: async () => (await axios.get("/api/pos/shifts", { params: { all: all ? 1 : undefined } })).data,
    refetchInterval: 30_000,
  });
  const open = data?.open;
  const live = open?.live;
  const canClose = !!data?.rights?.dayClose;
  const ctx = { company: boot?.company, settings: boot?.settings, currency: symbol };
  const refresh = () => { refetch(); queryClient.invalidateQueries({ queryKey: POS_BOOT_KEY }); };

  const openShift = async () => {
    setBusy(true);
    try {
      await axios.post("/api/pos/shifts", { openingFloat: Number(float) || 0 });
      toast.success("Shift opened.");
      setFloat("");
      refresh();
    } catch (err) {
      toast.error(apiError(err, "Could not open the shift."));
    } finally {
      setBusy(false);
    }
  };
  const closeShift = async () => {
    if (counted === "") { toast.error("Type the cash counted in the drawer."); return; }
    if (!window.confirm(`Close shift #${open.id} with ${fmt(counted)} counted?`)) return;
    setBusy(true);
    try {
      const { data: res } = await axios.post(`/api/pos/shifts/${open.id}`, { countedCash: Number(counted), notes: notes || undefined });
      toast.success(`Shift #${open.id} closed.`);
      printHtml(zReportHtml(res.report, { ...ctx, shift: { ...res.shift, cashier: boot?.user?.name } }));
      setCounted("");
      setNotes("");
      refresh();
    } catch (err) {
      toast.error(apiError(err, "Could not close the shift."));
    } finally {
      setBusy(false);
    }
  };
  const printShift = async (s) => {
    try {
      const { data: res } = await axios.get(`/api/pos/shifts/${s.id}`);
      printHtml(zReportHtml(res.report, { ...ctx, shift: res.shift, title: res.shift.status === "CLOSED" ? "Z REPORT" : "X REPORT (shift open)" }));
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const diff = live && counted !== "" ? Number(counted) - live.expectedCash : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Shift &amp; day close</h1>
          <p className="text-[13px] text-muted-foreground">
            {boot?.features?.requireShift ? "A shift must be open to sell." : "Shifts are optional here — open one to count the drawer at the end."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching}><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /></Button>
      </div>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{apiError(error)}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* current shift */}
        <section className="min-w-0 rounded-2xl border border-border bg-background">
          <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${open ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}><Clock className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold">{open ? `Shift #${open.id} — open` : "No shift open"}</h2>
              <p className="text-[12.5px] text-muted-foreground">{open ? `Since ${when(open.opened_at)} · float ${fmt(open.opening_float)}` : "Count the float in the drawer and open a shift."}</p>
            </div>
            {open && <Button variant="outline" size="sm" onClick={() => printShift(open)}><Printer className="mr-1.5 h-4 w-4" /> X report</Button>}
          </header>

          {!open && (
            <div className="space-y-3 p-4">
              <label className="block text-[12.5px] font-semibold text-muted-foreground" htmlFor="pos-float">Opening float (cash in the drawer)</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id="pos-float" type="number" inputMode="decimal" min="0" step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0.00"
                  onKeyDown={(e) => e.key === "Enter" && canClose && openShift()}
                  className="h-12 flex-1 rounded-xl border border-input bg-background px-3 text-right text-xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <Button className="h-12 px-6 text-base font-bold" onClick={openShift} disabled={busy || !canClose}>
                  {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Play className="mr-2 h-5 w-5" />} Open shift
                </Button>
              </div>
              {!canClose && <p className="text-[12px] text-muted-foreground">Opening and closing shifts needs the pos.dayClose right.</p>}
            </div>
          )}

          {open && live && (
            <div className="space-y-4 p-4">
              <ZFigures z={live} />
              <div className="rounded-xl border-2 border-primary/20 bg-primary/[0.03] p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Banknote className="h-4 w-4 text-primary" /> Close the shift</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cash expected</p>
                    <p className="text-2xl font-extrabold tabular-nums">{fmt(live.expectedCash)}</p>
                    <p className="text-[11.5px] text-muted-foreground">float {fmt(live.openingFloat)} + cash {fmt(live.salesByMethod.CASH)} − refunds {fmt(live.refundsByMethod.CASH)}</p>
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="pos-counted">Cash counted</label>
                    <input id="pos-counted" type="number" inputMode="decimal" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0.00"
                      className="h-12 w-full rounded-xl border border-input bg-background px-3 text-right text-xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    {diff !== null && (
                      <p className={`mt-1 text-right text-[13px] font-bold ${Math.abs(diff) < 0.005 ? "text-emerald-700" : diff < 0 ? "text-destructive" : "text-amber-700"}`}>
                        {Math.abs(diff) < 0.005 ? "Drawer balances" : diff < 0 ? `Short ${fmt(-diff)}` : `Over ${fmt(diff)}`}
                      </p>
                    )}
                  </div>
                </div>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Notes (optional)" className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                <Button className="mt-3 h-12 w-full text-base font-bold" onClick={closeShift} disabled={busy || !canClose}>
                  {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Lock className="mr-2 h-5 w-5" />} Close shift &amp; print Z report
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* today */}
        <section className="min-w-0 rounded-2xl border border-border bg-background">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="font-bold">Today</h2>
              <p className="text-[12.5px] text-muted-foreground">{all ? "Every till" : "Your till"} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
            </div>
            <div className="flex items-center gap-2">
              {data?.rights?.allShifts && (
                <div className="flex rounded-lg border border-border p-0.5">
                  {[[false, "Mine"], [true, "All tills"]].map(([v, l]) => (
                    <button key={l} onClick={() => setAll(v)} className={`h-8 rounded-md px-3 text-[12.5px] font-semibold ${all === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
                  ))}
                </div>
              )}
              {data?.today && (
                <Button variant="outline" size="sm" onClick={() => printHtml(zReportHtml(data.today, { ...ctx, title: "DAY SUMMARY" }))}><Printer className="h-4 w-4" /></Button>
              )}
            </div>
          </header>
          <div className="p-4">{data?.today ? <ZFigures z={data.today} /> : <p className="text-sm text-muted-foreground">Loading…</p>}</div>
        </section>
      </div>

      {/* recent shifts */}
      <section className="min-w-0 rounded-2xl border border-border bg-background">
        <header className="border-b border-border px-4 py-3"><h2 className="font-bold">Recent shifts</h2></header>
        <ul className="divide-y divide-border">
          {(data?.shifts || []).map((s) => {
            const z = s.summary;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${s.status === "OPEN" ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>{s.status}</span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-semibold">#{s.id} · {s.cashier || "—"}</p>
                  <p className="text-[12px] text-muted-foreground">{when(s.opened_at)} → {s.closed_at ? when(s.closed_at) : "open"}</p>
                </div>
                {z && (
                  <div className="grid w-full grid-cols-4 gap-2 text-right text-[12.5px] sm:w-auto sm:gap-4">
                    <span><span className="block text-muted-foreground">Net sales</span><b className="tabular-nums">{fmt(z.netSales)}</b></span>
                    <span><span className="block text-muted-foreground">Expected</span><b className="tabular-nums">{fmt(s.expected_cash)}</b></span>
                    <span><span className="block text-muted-foreground">Counted</span><b className="tabular-nums">{fmt(s.counted_cash)}</b></span>
                    <span><span className="block text-muted-foreground">Diff.</span><b className={`tabular-nums ${s.difference < 0 ? "text-destructive" : s.difference > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmt(s.difference)}</b></span>
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => printShift(s)}><Printer className="mr-1.5 h-4 w-4" /> {s.status === "OPEN" ? "X" : "Z"}</Button>
              </li>
            );
          })}
          {!(data?.shifts || []).length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No shifts yet.</li>}
        </ul>
      </section>
    </div>
  );
}

function ZFigures({ z }) {
  const items = [
    ["Sales", z.receipts, false],
    ["Refunds", z.returns, false],
    ["Items sold", fmtQty(z.itemsSold), false],
    ["Gross", fmt(z.grossSales), true],
    ["Discounts", fmt(z.discounts), true],
    ["Tax", fmt(z.tax), true],
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">
        <p className="text-[11px] uppercase tracking-wider text-white/75">Net sales</p>
        <p className="text-3xl font-extrabold tabular-nums">{fmt(z.netSales)}</p>
        <p className="text-[12px] text-white/80">sales {fmt(z.salesTotal)} − refunds {fmt(z.returnsTotal)}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {items.map(([l, v]) => (
          <div key={l} className="rounded-lg border border-border px-2.5 py-2">
            <dt className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{l}</dt>
            <dd className="text-[15px] font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="py-1">Payment</th><th className="py-1 text-right">Taken</th><th className="py-1 text-right">Refunded</th><th className="py-1 text-right">Net</th></tr></thead>
        <tbody className="divide-y divide-border">
          {[["CASH", "Cash"], ["CARD", "Card / Bank"], ["CREDIT", "On account"]].map(([m, l]) => (
            <tr key={m}>
              <td className="py-1.5 font-medium">{l}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(z.salesByMethod?.[m])}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(z.refundsByMethod?.[m])}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{fmt((z.salesByMethod?.[m] || 0) - (z.refundsByMethod?.[m] || 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
