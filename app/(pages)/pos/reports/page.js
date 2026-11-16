"use client";
// POS reports live in the main report engine (rules 6 / 15): this page is the
// way into them. Each opens /accounting/reports/<key> — filters, views, Excel /
// PDF and the voucher drill are the engine's. (It used to be a 1,100-line
// report page of its own.)
import React from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, CreditCard, Package, Receipt, RotateCcw, Users } from "lucide-react";

const REPORTS = [
  { key: "posDailySales", title: "Daily sales", text: "Sales, refunds and net per day, by payment method.", icon: CalendarDays },
  { key: "posTransactions", title: "Receipts", text: "Every receipt with how it was paid — opens the voucher.", icon: Receipt },
  { key: "posSalesByItem", title: "Sales by item", text: "Quantity and value sold, returned and net per item.", icon: Package },
  { key: "posSalesByPayment", title: "By payment method", text: "Cash, card / bank and credit taken, less refunds.", icon: CreditCard },
  { key: "posSalesByCashier", title: "By cashier", text: "Receipts, refunds, discounts and net per cashier.", icon: Users },
  { key: "posReturns", title: "Refunds", text: "Every refund, the receipt it refunds and why.", icon: RotateCcw },
];

export default function PosReportsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-5">
      <div>
        <h1 className="text-xl font-bold">POS reports</h1>
        <p className="text-[13px] text-muted-foreground">Open in the report engine — filter by period and cashier, export to Excel / PDF, click through to the receipt.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.key}>
              <Link href={`/accounting/reports/${r.key}`} className="group flex h-full items-start gap-3 rounded-2xl border border-border bg-background p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between font-bold">{r.title}<ArrowUpRight className="h-4 w-4 opacity-50 group-hover:opacity-100" /></span>
                  <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{r.text}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
