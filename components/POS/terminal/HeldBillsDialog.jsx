"use client";
// Bills on hold (the cashier's own, any till). Recall loads one into the till;
// the bill on screen is put on hold first so nothing is lost.
import React from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PauseCircle, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmt } from "@/components/POS/shared";

export const HELD_KEY = ["pos", "held"];

export function useHeldBills(enabled = true) {
  return useQuery({ queryKey: HELD_KEY, queryFn: async () => (await axios.get("/api/pos/held")).data?.bills || [], enabled, staleTime: 15_000 });
}

export default function HeldBillsDialog({ open, onOpenChange, onRecall, onDiscard, busyId }) {
  const { data: bills = [], isLoading } = useHeldBills(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bills on hold</DialogTitle>
          <DialogDescription>Recall a bill to carry on ringing it up. The bill on screen goes on hold.</DialogDescription>
        </DialogHeader>
        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !bills.length && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <PauseCircle className="h-8 w-8 opacity-40" /> No bills on hold.
          </div>
        )}
        <ul className="space-y-2">
          {bills.map((b, i) => {
            const lines = b.data?.lines || [];
            const total = b.data?.total ?? lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
            return (
              <li key={b.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{b.label || b.data?.customer?.name || `Bill ${b.id}`}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {lines.length} line{lines.length === 1 ? "" : "s"} · {fmt(total)} · {new Date(b.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <Button size="sm" onClick={() => onRecall(b)} disabled={!!busyId}>
                  {busyId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Recall"}
                </Button>
                <Button size="sm" variant="ghost" aria-label="Discard held bill" onClick={() => onDiscard(b)} disabled={!!busyId}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
