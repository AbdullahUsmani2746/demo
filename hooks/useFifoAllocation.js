"use client";

import { useState, useCallback, useEffect, useRef } from "react";

// ============================================================
// Shared FIFO allocation engine for "spread an amount across a
// party's outstanding invoices, oldest first" screens — used by
// both the Auto FIFO Settlement page (creating a new Receipt/
// Payment voucher) and the Knock-Off Review page (assigning an
// already-posted, untagged voucher line to invoice(s) manually).
//
// `amount` is the total to allocate; it re-runs FIFO automatically
// whenever it changes. Rows are expected to be the shape returned
// by GET /api/voucher/outstanding (id/tran_id, invoiceno, invoicedate,
// vrNo, grossamount, totalAdjusted, remainingbalance, daysOutstanding).
// ============================================================

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function useFifoAllocation(amount) {
  const [outstandingInvoices, setOutstandingInvoices] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(new Set());

  const amountRef = useRef(amount);
  useEffect(() => {
    amountRef.current = amount;
  }, [amount]);

  // Fresh full allocation: walk invoices oldest-first (the API already
  // returns them date ASC) and fill each until the amount runs out.
  const applyFifo = useCallback((invoices, totalAmount) => {
    let remaining = Number(totalAmount) || 0;
    const newSelectedIds = new Set();
    const allocated = invoices.map((inv) => {
      const due = Number(inv.amountReceivable || 0);
      const take = round2(Math.min(Math.max(remaining, 0), due));
      remaining = round2(remaining - take);
      const selected = take > 0;
      if (selected) newSelectedIds.add(inv.id);
      return {
        ...inv,
        selected,
        amountAdjusted: take,
        balanceAfter: round2(due - take),
      };
    });
    return { allocated, newSelectedIds };
  }, []);

  // Redistribute among the currently-selected rows, optionally preserving a
  // manually-edited row. Used for manual toggles / edits (keeps it editable).
  const redistribute = useCallback((invoices, totalAmount, preserveId = null) => {
    let remaining = Number(totalAmount) || 0;
    if (preserveId) {
      const kept = invoices.find((i) => i.id === preserveId && i.selected);
      if (kept) remaining = round2(remaining - Number(kept.amountAdjusted || 0));
    }
    return invoices.map((inv) => {
      const due = Number(inv.amountReceivable || 0);
      if (!inv.selected) {
        return { ...inv, amountAdjusted: 0, balanceAfter: due };
      }
      if (inv.id === preserveId) {
        return { ...inv, balanceAfter: round2(due - Number(inv.amountAdjusted || 0)) };
      }
      const take = round2(Math.min(Math.max(remaining, 0), due));
      remaining = round2(remaining - take);
      return { ...inv, amountAdjusted: take, balanceAfter: round2(due - take) };
    });
  }, []);

  // Load fresh outstanding-invoice rows (from GET /api/voucher/outstanding)
  // and FIFO-allocate the current amount across them.
  const loadInvoices = useCallback(
    (rows) => {
      const invoices = (rows || []).map((row, index) => {
        const due = round2(row.remainingbalance);
        return {
          id: row.id || row.tran_id || `inv-${index}`,
          invoiceNo: row.invoiceno || `INV-${row.vrNo || row.id}`,
          invoiceDate: row.invoicedate ? new Date(row.invoicedate) : new Date(),
          grossAmount: round2(row.grossamount),
          alreadyPaid: round2(row.totalAdjusted),
          amountReceivable: due,
          daysOutstanding: Number(row.daysOutstanding || 0),
          selected: false,
          amountAdjusted: 0,
          balanceAfter: due,
          original: row,
        };
      });

      const { allocated, newSelectedIds } = applyFifo(invoices, amountRef.current);
      setOutstandingInvoices(allocated);
      setSelectedInvoiceIds(newSelectedIds);
      setDataLoaded(true);
      return invoices.length;
    },
    [applyFifo],
  );

  // Re-run FIFO whenever the amount changes (and invoices are loaded)
  useEffect(() => {
    setOutstandingInvoices((prev) => {
      if (prev.length === 0) return prev;
      const { allocated, newSelectedIds } = applyFifo(prev, amount);
      setSelectedInvoiceIds(newSelectedIds);
      return allocated;
    });
  }, [amount, applyFifo]);

  const handleToggle = useCallback(
    (id, checked) => {
      setSelectedInvoiceIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
      setOutstandingInvoices((prev) => {
        const updated = prev.map((inv) =>
          inv.id === id
            ? { ...inv, selected: checked, amountAdjusted: 0, balanceAfter: inv.amountReceivable }
            : inv.selected
              ? { ...inv, amountAdjusted: 0, balanceAfter: inv.amountReceivable }
              : inv,
        );
        return redistribute(updated, amountRef.current);
      });
    },
    [redistribute],
  );

  const handleManualAmount = useCallback(
    (id, value) => {
      const numeric = Number(value) || 0;
      setOutstandingInvoices((prev) => {
        const updated = prev.map((inv) => {
          if (inv.id !== id) return inv;
          const due = Number(inv.amountReceivable || 0);
          const finalAmount = round2(Math.min(Math.max(numeric, 0), due));
          return {
            ...inv,
            selected: finalAmount > 0,
            amountAdjusted: finalAmount,
            balanceAfter: round2(due - finalAmount),
          };
        });
        return redistribute(updated, amountRef.current, id);
      });
      setSelectedInvoiceIds((prev) => {
        const next = new Set(prev);
        if (numeric > 0) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [redistribute],
  );

  const reset = useCallback(() => {
    setOutstandingInvoices([]);
    setSelectedInvoiceIds(new Set());
    setDataLoaded(false);
  }, []);

  const selectedInvoices = outstandingInvoices.filter((inv) => inv.selected);
  const totalAllocated = round2(
    selectedInvoices.reduce((s, inv) => s + Number(inv.amountAdjusted || 0), 0),
  );
  const totalOutstanding = round2(
    outstandingInvoices.reduce((s, inv) => s + Number(inv.amountReceivable || 0), 0),
  );
  const enteredAmount = round2(amount);
  const unallocated = round2(enteredAmount - totalAllocated);
  const exceedsOutstanding = dataLoaded && enteredAmount > totalOutstanding + 0.01;
  const utilization =
    enteredAmount > 0 ? Math.min(100, (totalAllocated / enteredAmount) * 100) : 0;

  return {
    outstandingInvoices,
    dataLoaded,
    selectedInvoiceIds,
    loadInvoices,
    handleToggle,
    handleManualAmount,
    reset,
    selectedInvoices,
    totalAllocated,
    totalOutstanding,
    enteredAmount,
    unallocated,
    exceedsOutstanding,
    utilization,
  };
}
