"use client";

// components/HR/leave/RequestsTab.jsx — every leave application in the
// person's departments, filterable; approve / reject / cancel in place.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LEAVE_REQUEST_STATUS } from "@/lib/hr/leave/policy";
import { api, BRAND_BTN, NativeSelect } from "@/components/HR/shared";
import { Card } from "@/components/HR/payroll/ui";
import ApplyLeaveDialog from "@/components/HR/leave/ApplyLeaveDialog";
import LeaveRequestList from "@/components/HR/leave/LeaveRequestList";

export default function RequestsTab({ meta }) {
  const [status, setStatus] = useState("pending");
  const [department, setDepartment] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ ...(department && { department }), ...(q && { q }), ...(from && { from }), ...(to && { to }) });
  const { data, isLoading } = useQuery({ queryKey: ["hr-leave-requests", "all", department, q, from, to], queryFn: () => api(`/api/hr/leave/requests?${params}`) });
  const all = data?.requests ?? [];
  const counts = useMemo(() => Object.fromEntries(Object.keys(LEAVE_REQUEST_STATUS).map((s) => [s, all.filter((r) => r.status === s).length])), [all]);
  const rows = status === "all" ? all : all.filter((r) => r.status === status);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 xl:flex-row xl:items-center">
        <div className="-mx-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0" role="group" aria-label="Status">
          {[["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Rejected"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k}
              className={cn("flex h-9 shrink-0 items-center rounded-lg px-3 text-sm whitespace-nowrap transition-colors", status === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {label}
              <span className={cn("ml-1.5 rounded px-1 text-xs tabular-nums", status === k ? "bg-white/20" : "bg-muted")}>{k === "all" ? all.length : counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:flex-nowrap xl:justify-end">
          <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="col-span-2 w-full sm:w-48" aria-label="Department">
            <option value="">All departments</option>
            {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </NativeSelect>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 min-w-0 sm:w-[150px]" title="Leave on or after" aria-label="Leave on or after" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 min-w-0 sm:w-[150px]" title="Leave on or before" aria-label="Leave on or before" />
          <div className="relative col-span-2 sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee no." className="h-9 pl-8" aria-label="Search employees" />
          </div>
          {meta.rights.leaveManage && (
            <Button className={cn(BRAND_BTN, "col-span-2 h-10 sm:h-9")} onClick={() => setApplying(true)}><Plus className="h-4 w-4 mr-1.5" />Leave for employee</Button>
          )}
        </div>
      </div>
      <Card
        title="Leave applications"
        icon={Inbox}
        description={isLoading ? "Loading…" : `${rows.length} shown${status !== "all" ? ` · ${all.length} in these filters` : ""}`}
      >
        <LeaveRequestList rows={rows} loading={isLoading} emptyHint={status === "pending" ? "Nothing is waiting for a decision." : undefined} />
      </Card>
      <ApplyLeaveDialog open={applying} onClose={() => setApplying(false)} meta={meta} forOthers />
    </div>
  );
}
