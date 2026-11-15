"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Calendar, Search, Package } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import axios from "axios";

/**
 * SelectOriginalModal
 *
 * Shows a list of original vouchers (GRN for purchase return, Dispatch for sale return)
 * so the user can select which one they are returning against.
 *
 * Props:
 *   type          — "purchaseReturn" | "saleReturn"
 *   isOpen        — boolean
 *   onClose       — () => void
 *   onSelect      — (transaction) => void  — called with the full transaction object
 *   sourceTranCode — number — which tran_code to search (4=GRN, 6=Dispatch)
 *   sourceLabel    — string — "GRN" | "Dispatch" (used in UI text)
 */
export default function SelectOriginalModal({
  type,
  isOpen,
  onClose,
  onSelect,
  sourceTranCode,  // 4 for GRN (purchaseReturn), 6 for Dispatch (saleReturn)
  sourceLabel,     // "GRN" | "Dispatch"
}) {
  const today = new Date().toISOString().split("T")[0];
  // Default: last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo]     = useState(today);
  const [loading, setLoading]   = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [selectedId, setSelectedId]     = useState(null);
  const [error, setError]               = useState(null);
  const [vrNoSearch, setVrNoSearch]     = useState("");

  const fetchTransactions = async () => {
    if (!sourceTranCode) return;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      const response = await axios.get(`/api/voucher/original-for-return`, {
        params: {
          date_from:  dateFrom,
          date_to:    dateTo,
          tran_code:  sourceTranCode,
          ...(( type === "purchaseReturn" || type === "grnReturn")
            ? { grn_no: vrNoSearch || undefined }
            : { dispatch_no: vrNoSearch || undefined }),
        },
      });
      setTransactions(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to fetch transactions");
    } finally {
      setLoading(false);
    }
  };

  // Fetch when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchTransactions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSelect = () => {
    if (!selectedId) return;
    const selected = transactions.find((t) => t.tran_id === selectedId);
    if (selected) {
      onSelect(selected);
    }
  };

  const heading =( type === "purchaseReturn" || type === "grnReturn")
    ? `Select Original ${sourceLabel || "GRN"} for Purchase Return`
    : `Select Original ${sourceLabel || "Dispatch"} for Sale Return`;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 pb-2 border-b">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-slate-500">From Date</Label>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="pl-8 h-8 text-sm w-36"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-slate-500">To Date</Label>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="pl-8 h-8 text-sm w-36"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-slate-500">
              {(type === "purchaseReturn" || type === "grnReturn") ? "GRN No" : "Dispatch No"}
            </Label>
            <Input
              type="text"
              value={vrNoSearch}
              onChange={(e) => setVrNoSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchTransactions()}
              placeholder={`Search ${(type === "purchaseReturn" || type === "grnReturn") ? "GRN" : "Dispatch"} no…`}
              className="h-8 text-sm w-32"
            />
          </div>
          <Button
            size="sm"
            onClick={fetchTransactions}
            disabled={loading}
            className="h-8 flex items-center gap-1.5"
          >
            <Search className="h-3.5 w-3.5" />
            {loading ? "Searching…" : "Search"}
          </Button>
        </div>

        {error && (
          <div className="text-red-500 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto border rounded-lg min-h-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead className="w-24">{(type === "purchaseReturn" || type === "grnReturn") ? "GRN No" : "Dispatch No"}</TableHead>
                <TableHead>Invoice No</TableHead>
                <TableHead>Vendor / Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="w-20 text-center">Select</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-slate-400">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-slate-400">
                    No {sourceLabel || "documents"} found in this date range
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((txn) => {
                  const isSelected = selectedId === txn.tran_id;
                  const totalQty = txn.transactions?.reduce(
                    (sum, t) => sum + (Number(t.qty) || 0),
                    0
                  );
                  const itemNames = txn.transactions
                    ?.slice(0, 2)
                    .map((t) => t.itemDetails?.item || t.itemDetails?.code || `#${t.itcd}`)
                    .filter(Boolean)
                    .join(", ");
                  const moreItems = (txn.transactions?.length || 0) - 2;

                  return (
                    <TableRow
                      key={txn.tran_id}
                      className={`cursor-pointer text-sm transition-colors ${
                        isSelected
                          ? "bg-blue-50 border-blue-200"
                          : "hover:bg-slate-50"
                      }`}
                      onClick={() => setSelectedId(txn.tran_id)}
                    >
                      <TableCell className="font-mono font-semibold">
                        {txn.grn_no || txn.dispatch_no || "—"}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {txn.invoice_no || "—"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {txn.acno?.acname || txn.pycd || "—"}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {txn.dated
                          ? new Date(txn.dated).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-slate-500 text-xs max-w-[180px] truncate">
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3 flex-shrink-0" />
                          {itemNames || "—"}
                          {moreItems > 0 && (
                            <span className="text-slate-400">+{moreItems} more</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {totalQty?.toFixed(2) ?? "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <div
                          className={`w-4 h-4 rounded-full border-2 mx-auto transition-colors ${
                            isSelected
                              ? "bg-blue-600 border-blue-600"
                              : "border-slate-300"
                          }`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="flex items-center gap-2 pt-2 border-t">
          <span className="text-xs text-slate-400 mr-auto">
            {transactions.length} record(s) found
            {selectedId ? " · 1 selected" : ""}
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedId}>
            Use Selected {sourceLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
