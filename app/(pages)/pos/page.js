"use client";
// POS home: today's and this month's figures (own till, or every till with
// pos.allShifts — /api/pos/stats) and the way into each part of the till.
import React from "react";
import Link from "next/link";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Clock, Receipt, RotateCcw, ShoppingCart } from "lucide-react";
import { usePosBoot, fmt, fmtQty } from "@/components/POS/shared";

export default function PosHome() {
  const { data: boot } = usePosBoot();
  const { data: stats } = useQuery({ queryKey: ["pos", "stats"], queryFn: async () => (await axios.get("/api/pos/stats")).data, refetchInterval: 60_000 });
  const t = stats?.today;
  const m = stats?.month;
  const rights = boot?.rights || {};

  const cards = [
    { href: "/pos/cart", title: "Sell", text: "Ring up a sale — search, scan, take payment.", icon: ShoppingCart, show: rights.sell, primary: true },
    { href: "/pos/posReturn", title: "Refund", text: "Take items back against a receipt.", icon: RotateCcw, show: rights.refund },
    { href: "/pos/orders", title: "Receipts", text: "Find, reprint or refund a receipt.", icon: Receipt, show: true },
    { href: "/pos/shift", title: "Shift & day close", text: boot?.shift ? `Shift #${boot.shift.id} is open.` : "Open a shift or print the Z report.", icon: Clock, show: true },
    { href: "/pos/reports", title: "Reports", text: "Daily sales, items, payments, cashiers, refunds.", icon: BarChart3, show: true },
  ].filter((c) => c.show);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3 sm:p-5">
      <div>
        <h1 className="text-2xl font-bold">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}{boot?.user?.name ? `, ${boot.user.name.split(" ")[0]}` : ""}</h1>
        <p className="text-[13.5px] text-muted-foreground">{stats?.scope === "all" ? "Every till" : "Your till"} · {boot?.godown ? `selling from ${boot.godown.godown}` : ""}</p>
      </div>

      {(boot?.problems || []).length > 0 && (
        <ul className="space-y-1">
          {boot.problems.map((p) => <li key={p} className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive">{p}</li>)}
        </ul>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Net sales today" value={fmt(t?.netSales)} sub={`${t?.receipts ?? 0} sales · ${t?.returns ?? 0} refunds`} strong />
        <Figure label="Cash today" value={fmt((t?.salesByMethod?.CASH || 0) - (t?.refundsByMethod?.CASH || 0))} sub={`card ${fmt((t?.salesByMethod?.CARD || 0) - (t?.refundsByMethod?.CARD || 0))}`} />
        <Figure label="Average bill" value={fmt(t?.receipts ? t.salesTotal / t.receipts : 0)} sub={`${fmtQty(t?.itemsSold || 0)} items sold`} />
        <Figure label="This month" value={fmt(m?.netSales)} sub={`${m?.receipts ?? 0} sales · refunds ${fmt(m?.returnsTotal)}`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.href} href={c.href}
              className={`group flex min-h-[112px] items-start gap-4 rounded-2xl border p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${c.primary ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/40"}`}>
              <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${c.primary ? "bg-white/15" : "bg-primary/10 text-primary"}`}><Icon className="h-6 w-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between text-lg font-bold">{c.title}<ArrowRight className="h-5 w-5 opacity-60 transition-transform group-hover:translate-x-1" /></span>
                <span className={`mt-1 block text-[13px] ${c.primary ? "text-white/85" : "text-muted-foreground"}`}>{c.text}</span>
              </span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

function Figure({ label, value, sub, strong }) {
  return (
    <div className={`rounded-2xl border p-4 ${strong ? "border-primary/30 bg-primary/5" : "border-border bg-background"}`}>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${strong ? "text-primary" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
