"use client";
// components/Invoicing/ApprovedTrialItems.jsx — Sale Invoicing → "Approved trial items"
// (feature "orders.trialLineBilling", ported from Eastland; API
// /api/invoicing/sale/trial-items, lib/dispatch/trialBilling.js).
//
// Items dispatched on Trial / Rate Negotiation, not billed yet. Once the client
// approves (the Sale Order line is changed to Normal with its rate) "Bill" moves
// those items into a part of that dispatch (1234-2), same date as the dispatch;
// it then appears in the queue below and is invoiced like any dispatch.
// Rendered only while the feature is on and something is on trial.
import { useMemo, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FlaskConical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const kg = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const daysSince = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)) : null);

export default function ApprovedTrialItems({ canBill = true, onBilled }) {
  const [open, setOpen] = useState(false);
  const [billing, setBilling] = useState(null);
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["invoicing", "sale", "trial-items"],
    queryFn: async () => (await axios.get("/api/invoicing/sale/trial-items")).data?.data ?? [],
    staleTime: 30_000,
    retry: false,
  });
  const rows = data ?? [];

  // one block per trial dispatch, approved first, then oldest
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.tran_id)) m.set(r.tran_id, { ...r, items: [] });
      m.get(r.tran_id).items.push(r);
    }
    return [...m.values()].sort((a, b) => {
      const ra = a.items.some((i) => i.approved) ? 0 : 1;
      const rb = b.items.some((i) => i.approved) ? 0 : 1;
      return ra - rb || new Date(a.dated) - new Date(b.dated);
    });
  }, [rows]);
  const approvedCount = rows.filter((r) => r.approved).length;

  if (isLoading || rows.length === 0) return null;

  const bill = async (g) => {
    setBilling(g.tran_id);
    try {
      const { data: res } = await axios.post("/api/invoicing/sale/trial-items", { tran_id: g.tran_id });
      toast.success(res.message || "Billing part made.", { duration: 9000 });
      await refetch();
      onBilled?.();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setBilling(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-background shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <FlaskConical className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-semibold text-foreground">Approved trial items</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold",
            approvedCount ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {approvedCount} to bill
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length - approvedCount} still on trial</span>
      </button>

      {open ? (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto border-t border-border p-2">
          <p className="px-1 text-xs text-muted-foreground">
            Trial goods are billed once the client approves: change the item on the Sale Order to <b>Normal</b> with its
            rate. <b>Bill</b> then moves them into a part of that dispatch (1234-2, same date — stock does not change);
            invoice it in the queue below.
          </p>
          {groups.map((g) => {
            const ready = g.items.filter((i) => i.approved);
            return (
              <div key={g.tran_id} className="rounded-lg border border-border p-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words font-semibold text-foreground">{g.customer}</span>
                  <span className="text-xs text-muted-foreground">
                    Dispatch {g.dispatch} · {day(g.dated)} · SO {g.so_no} · {daysSince(g.dated)} days on trial
                  </span>
                  {canBill ? (
                    <button
                      type="button"
                      disabled={!ready.length || billing === g.tran_id}
                      onClick={() => bill(g)}
                      className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                      title={ready.length ? `Bill ${ready.length} approved item(s)` : "Nothing approved yet"}
                    >
                      {billing === g.tran_id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Bill {ready.length ? `(${ready.length})` : ""}
                    </button>
                  ) : null}
                </div>
                <ul className="mt-1.5 divide-y divide-border">
                  {g.items.map((i) => (
                    <li key={i.itcd} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{i.code || i.itcd}</span>
                      <span className="min-w-0 flex-1 break-words text-foreground">{i.item}</span>
                      <span className="tabular-nums">{kg(i.left_kg)} KG</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-semibold",
                          i.approved
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {i.approved
                          ? `Approved · rate ${i.so_rate}`
                          : i.so_held
                            ? "Sale Order waiting for approval"
                            : i.line_type === "RATE_NEG"
                              ? "Rate not agreed yet"
                              : "On trial"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
