"use client";
// Quality Assurance → QA Entry. The store records goods received against an
// open purchase order line; each receipt goes to Order QC for testing (its GRN
// is posted when QC passes it). A line shows what is ordered, already passed,
// waiting in QC and still open — a receipt can never exceed what is open.
// Data: /api/store/qa-entry (+ /pending).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, Loader2, PackageOpen, PackagePlus, RefreshCw, Search, ShieldAlert, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, BRAND_BTN, CODE_CHIP, EmptyState, HR_MAIN, HR_PAGE, ListSkeleton, PageHeader, Panel, StatTile, TH, TH_ROW } from "@/components/HR/shared";
import { fmtDay, fmtQty } from "@/components/Quality/qcUi";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

const empty = { received_qty: "", batch_no: "", mfg_date: "", expiry_date: "", remarks: "" };

export default function QaEntryPage() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManage = can("qualityControl.manage");
  const [search, setSearch] = useState("");
  const [line, setLine] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef(null);

  const { data, isLoading, isFetching, refetch, error } = useQuery({ queryKey: ["qa-entry-pending"], queryFn: () => api("/api/store/qa-entry/pending") });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(() => {
    const all = data?.orders || [];
    const s = search.trim().toLowerCase();
    if (!s) return all;
    return all.filter((o) => [o.order_no, o.vendor_name, o.item_name, o.itcd].some((v) => String(v ?? "").toLowerCase().includes(s)));
  }, [data, search]);

  const open = rows.filter((r) => r.pending_qty > 0);
  const totals = useMemo(
    () => ({
      lines: open.length,
      orders: new Set(open.map((r) => r.order_no)).size,
      inQc: rows.reduce((n, r) => n + (r.in_qc_qty > 0 ? 1 : 0), 0),
    }),
    [rows, open],
  );

  const start = (r) => {
    setLine(r);
    setForm({ ...empty, received_qty: String(r.pending_qty) });
  };

  const save = async () => {
    const qty = Number(form.received_qty);
    if (!(qty > 0)) return toast.error("Enter the received quantity.");
    if (qty > line.pending_qty + 1e-9) return toast.error(`Only ${fmtQty(line.pending_qty)} ${line.unit} is open on this line.`);
    if (form.mfg_date && form.expiry_date && form.expiry_date <= form.mfg_date) return toast.error("Expiry date must be after the manufacturing date.");
    setBusy(true);
    try {
      const res = await api("/api/store/qa-entry", {
        method: "POST",
        body: { order_no: line.order_no, itcd: line.itcd, received_qty: qty, batch_no: form.batch_no, mfg_date: form.mfg_date || null, expiry_date: form.expiry_date || null, remarks: form.remarks },
      });
      toast.success(`Receipt R-${res.quality_master_id} sent to QC`, {
        action: { label: "Open", onClick: () => (window.location.href = `/accounting/forms/orderqualitycontrol/${line.order_no}?qc=${res.quality_master_id}`) },
      });
      setLine(null);
      qc.invalidateQueries({ queryKey: ["qa-entry-pending"] });
      qc.invalidateQueries({ queryKey: ["order-qc"] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={PackagePlus}
        breadcrumb="Quality Assurance"
        title="QA Entry"
        subtitle="Record goods received against open purchase orders. Each receipt is tested on Order QC before its GRN is posted."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/accounting/forms/orderqualitycontrol">
                <ClipboardCheck className="h-4 w-4" /> Order QC
              </Link>
            </Button>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />
      <main className={cn(HR_MAIN, "space-y-4")}>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Open" hint="lines to receive" value={totals.lines} icon={PackageOpen} tone="brand" />
          <StatTile label="Orders" hint="purchase orders" value={totals.orders} icon={Truck} />
          <StatTile label="In QC" hint="lines being tested" value={totals.inQc} icon={ClipboardCheck} tone="amber" />
        </div>

        <Panel
          title="Open purchase order lines"
          icon={PackageOpen}
          actions={
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PO, vendor or item  ( / )" className="h-9 pl-9" aria-label="Search" />
            </div>
          }
        >
          {isLoading ? (
            <ListSkeleton rows={6} />
          ) : error ? (
            <EmptyState icon={ShieldAlert} title="Could not load open orders" hint={error.message} />
          ) : rows.length === 0 ? (
            <EmptyState icon={PackageOpen} title="No open purchase order lines" hint={search ? "Nothing matches the search." : "Approved purchase orders with items still to receive appear here."} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      <th className={TH}>Purchase order</th>
                      <th className={TH}>Item</th>
                      <th className={cn(TH, "text-right")}>Ordered</th>
                      <th className={cn(TH, "text-right")}>Passed</th>
                      <th className={cn(TH, "text-right")}>In QC</th>
                      <th className={cn(TH, "text-right")}>Open</th>
                      <th className={cn(TH, "text-right")}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {rows.map((r) => (
                      <tr key={`${r.order_no}-${r.itcd}-${r.order_detail_id}`} className="hover:bg-primary/[0.03]">
                        <td className="px-3 py-2.5">
                          <span className={CODE_CHIP}>PO {r.order_no}</span>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{r.vendor_name} · {fmtDay(r.order_date)}</p>
                        </td>
                        <td className="max-w-[300px] px-3 py-2.5">
                          <p className="truncate font-semibold">{r.item_name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{r.itcd}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.ordered_qty)} <span className="text-xs text-muted-foreground">{r.unit}</span></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.approved_qty)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.in_qc_qty ? fmtQty(r.in_qc_qty) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums">{fmtQty(r.pending_qty)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {canManage && (
                            <Button size="sm" className={cn("h-8", BRAND_BTN)} disabled={r.pending_qty <= 0} onClick={() => start(r)}>
                              Receive
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-border/70 md:hidden">
                {rows.map((r) => (
                  <div key={`${r.order_no}-${r.itcd}-${r.order_detail_id}`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{r.item_name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground"><span className={CODE_CHIP}>PO {r.order_no}</span> {r.vendor_name}</p>
                      </div>
                      {canManage && (
                        <Button size="sm" className={cn("h-8 shrink-0", BRAND_BTN)} disabled={r.pending_qty <= 0} onClick={() => start(r)}>Receive</Button>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Ordered</span><span className="text-right tabular-nums">{fmtQty(r.ordered_qty)} {r.unit}</span>
                      <span className="text-muted-foreground">Passed / In QC</span><span className="text-right tabular-nums">{fmtQty(r.approved_qty)} / {fmtQty(r.in_qc_qty)}</span>
                      <span className="text-muted-foreground">Open</span><span className="text-right font-bold tabular-nums">{fmtQty(r.pending_qty)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      </main>

      <Dialog open={Boolean(line)} onOpenChange={(o) => !o && setLine(null)}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
          {line && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>Receive · PO {line.order_no}</DialogTitle>
                <DialogDescription>
                  {line.item_name} — {fmtQty(line.pending_qty)} {line.unit} open of {fmtQty(line.ordered_qty)}.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 space-y-1 sm:col-span-1">
                  <span className="text-sm font-medium">Received qty ({line.unit || "KG"})</span>
                  <Input autoFocus type="number" step="any" min="0" max={line.pending_qty} value={form.received_qty} onChange={(e) => setForm((f) => ({ ...f, received_qty: e.target.value }))} className="font-mono" />
                </label>
                <label className="col-span-2 space-y-1 sm:col-span-1">
                  <span className="text-sm font-medium">Vendor batch no</span>
                  <Input inputMode="numeric" maxLength={9} value={form.batch_no} onChange={(e) => setForm((f) => ({ ...f, batch_no: e.target.value.replace(/\D/g, "") }))} placeholder="Optional — numbers" className="font-mono" />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium">Mfg date</span>
                  <Input type="date" value={form.mfg_date} onChange={(e) => setForm((f) => ({ ...f, mfg_date: e.target.value }))} />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium">Expiry date</span>
                  <Input type="date" value={form.expiry_date} onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))} />
                </label>
                <label className="col-span-2 space-y-1">
                  <span className="text-sm font-medium">Remarks</span>
                  <Textarea rows={2} maxLength={255} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} placeholder="Vehicle, DC no, condition…" />
                </label>
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setLine(null)}>Cancel</Button>
                <Button type="submit" className={BRAND_BTN} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send to QC
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
