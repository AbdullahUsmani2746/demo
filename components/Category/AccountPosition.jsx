"use client";
// One line under an account picker on a voucher form — where that account
// stands today (GET /api/accounts/position, lib/accounts/position.js):
//
//   cash / bank   Balance 2,450,000.00 Dr
//   customer      Balance 1,148,500 · Overdue 420,000 · Credit left 851,500 · 3 open invoices, oldest 62 days
//   vendor        Payable 640,000 · 4 open bills
//   other         Balance 12,000.00 Cr
//
// Display only. Cached per account for a minute, so ten lines on the same
// account make one request.
import React from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";

const fmt = (n) =>
  Math.abs(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const drCr = (n) => (Number(n) >= 0 ? "Dr" : "Cr");

function Item({ label, value, tone = "" }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label} </span>
      <span className={`font-semibold tabular-nums ${tone}`}>{value}</span>
    </span>
  );
}

export default function AccountPosition({ acno, className = "" }) {
  const id = Number(acno?.value ?? acno);
  const valid = Number.isInteger(id) && id > 0;
  const { data, isLoading } = useQuery({
    queryKey: ["accountPosition", id],
    queryFn: () => axios.get("/api/accounts/position", { params: { acno: id } }).then((r) => r.data?.position ?? null),
    enabled: valid,
    staleTime: 60_000,
  });

  if (!valid) return null;
  if (isLoading) return <div className={`mt-1 text-[11px] text-muted-foreground ${className}`}>Checking balance…</div>;
  if (!data) return null;

  const p = data;
  const items = [];
  if (p.kind === "customer") {
    items.push(<Item key="b" label="Balance" value={fmt(p.balance)} />);
    items.push(
      <Item
        key="o"
        label="Overdue"
        value={fmt(p.overdue)}
        tone={p.overdue > 0.5 ? "text-[#8a4b0f] dark:text-amber-400" : "text-[#2f5139] dark:text-emerald-400"}
      />,
    );
    if (p.creditLeft != null) {
      items.push(
        <Item
          key="c"
          label="Credit left"
          value={`${p.creditLeft < 0 ? "−" : ""}${fmt(p.creditLeft)}`}
          tone={p.creditLeft < 0 ? "text-destructive" : ""}
        />,
      );
    }
    if (p.open?.count) {
      items.push(
        <span key="i" className="whitespace-nowrap text-muted-foreground">
          {p.open.count} open invoice{p.open.count === 1 ? "" : "s"}
          {p.open.oldestDays ? `, oldest ${p.open.oldestDays} days` : ""}
        </span>,
      );
    }
  } else if (p.kind === "vendor") {
    // A vendor's credit balance is what we owe.
    items.push(
      <Item key="b" label={p.balance <= 0 ? "Payable" : "Advance"} value={fmt(p.balance)} />,
    );
    if (p.open?.count) {
      items.push(
        <span key="i" className="whitespace-nowrap text-muted-foreground">
          {p.open.count} open bill{p.open.count === 1 ? "" : "s"}
          {p.open.oldestDays ? `, oldest ${p.open.oldestDays} days` : ""}
        </span>,
      );
    }
  } else {
    items.push(<Item key="b" label="Balance" value={`${fmt(p.balance)} ${drCr(p.balance)}`} />);
  }

  return (
    <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-4 ${className}`} aria-live="polite">
      {items}
    </div>
  );
}
