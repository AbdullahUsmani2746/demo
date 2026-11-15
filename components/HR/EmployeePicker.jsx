"use client";

// components/HR/EmployeePicker.jsx — search an employee by name or number,
// inside the person's HR scope (/api/hr/employees).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/components/HR/shared";

export default function EmployeePicker({ value, onChange, includeLeft = false, placeholder = "Employee name or no." }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["hr-employee-pick", debounced, includeLeft],
    queryFn: () => api(`/api/hr/employees?q=${encodeURIComponent(debounced)}${includeLeft ? "&left=1" : ""}`),
    enabled: open,
    staleTime: 30_000,
  });
  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 text-sm">
        <span className="min-w-0 truncate font-semibold text-primary">{value.name} <span className="font-normal text-muted-foreground">#{value.id}{value.department ? ` · ${value.department}` : ""}</span></span>
        <button type="button" onClick={() => onChange(null)} aria-label="Change employee" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder} className="h-9 pl-8" aria-label="Find employee" />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg">
          {isFetching && <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Searching…</li>}
          {!isFetching && !(data?.employees?.length) && <li className="px-3 py-2 text-sm text-muted-foreground">Nobody found.</li>}
          {(data?.employees ?? []).map((e) => (
            <li key={e.id}>
              <button type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => { onChange(e); setQ(""); setOpen(false); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-primary/5">
                <span className="min-w-0 truncate">{e.name} <span className="text-muted-foreground">#{e.id}</span></span>
                <span className="shrink-0 text-xs text-muted-foreground">{e.left ? `left ${e.left}` : e.department ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
