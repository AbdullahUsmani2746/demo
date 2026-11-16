"use client";
// Who the bill is for: a customer account (needed for credit), or a walk-in
// with an optional name / phone for the receipt.
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Search, UserRound, UserX } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function CustomerDialog({ open, onOpenChange, value, onChange, walkInName }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setName(value && !value.acno ? value.name || "" : "");
    setPhone(value?.phone || "");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data: list = [], isFetching } = useQuery({
    queryKey: ["pos", "customers", debounced],
    queryFn: async () => {
      const r = (await axios.get("/api/accounts/acno", { params: { group: "customers", search: debounced || undefined, limit: 30 } })).data;
      return (Array.isArray(r) ? r : r?.data || []).slice(0, 30);
    },
    enabled: open,
    staleTime: 60_000,
  });

  const pick = (c) => {
    onChange({ acno: c.acno, name: c.acname, phone: phone || c.phoneFax || "" });
    onOpenChange(false);
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter" && list[active] && document.activeElement === inputRef.current) { e.preventDefault(); pick(list[active]); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto" onKeyDown={onKey}>
        <DialogHeader>
          <DialogTitle>Customer</DialogTitle>
          <DialogDescription>Pick a customer account, or keep it a walk-in.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder="Search customer name or account no."
            className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Customers">
          {list.map((c, i) => (
            <li key={c.acno}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onClick={() => pick(c)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm ${i === active ? "bg-primary/10" : ""} ${value?.acno === c.acno ? "font-semibold text-primary" : ""}`}
              >
                <UserRound className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{c.acname}</span>
                <span className="text-[11.5px] text-muted-foreground">{c.acno}</span>
              </button>
            </li>
          ))}
          {!list.length && <li className="px-3 py-4 text-center text-[13px] text-muted-foreground">{isFetching ? "Searching…" : "No customers found."}</li>}
        </ul>
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="mb-2 text-[12px] font-semibold text-muted-foreground">Walk-in (printed on the receipt)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder={walkInName || "Name"} className="h-10 rounded-lg border border-input bg-background px-3 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" placeholder="Phone" className="h-10 rounded-lg border border-input bg-background px-3 text-sm" />
          </div>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { onChange(null); onOpenChange(false); }}>
              <UserX className="mr-1.5 h-4 w-4" /> Clear
            </Button>
            <Button size="sm" onClick={() => { onChange(name || phone ? { acno: null, name, phone } : null); onOpenChange(false); }}>
              Use walk-in
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
