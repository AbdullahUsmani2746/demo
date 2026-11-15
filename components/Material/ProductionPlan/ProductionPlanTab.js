// components/ProductionPlanTab.js
"use client";
import React, { useState, useCallback, useMemo } from "react";
import {
  Printer,
  Trash2,
  Loader2,
  AlertCircle,
  Plus,
  ClipboardList,
  PackageCheck,
  Hash,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useCompany } from "@/context/CompanyContext";
import { generateProductionPlanPDF } from "@/components/Template/ProductionPlanPDF";
import { Button } from "@/components/ui/button";
import {
  LabHeader,
  LabCard,
  LabStat,
  TH,
  TD,
  NUM,
  TOTAL_ROW,
} from "@/components/Material/shared/LabUI";

// Text inputs inside the plan (SO #, MM No., qty).
const INPUT =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";

const makeRow = () => ({
  id: Date.now() + Math.random(),
  mm_input: "",
  finished_id: null,
  product_name: "",
  qty: "",
  bom_id: null,
  loading: false,
  error: "",
});

const fmtQty = (n) => (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));

const ProductionPlanTab = () => {
  const { data: session } = useSession();
  const { company } = useCompany();

  const [soNumber, setSoNumber] = useState("");
  const [rows, setRows] = useState([makeRow()]);
  const [printing, setPrinting] = useState(false);

  const totalQty = useMemo(
    () => rows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0),
    [rows],
  );

  const validRows = useMemo(
    () => rows.filter((r) => r.finished_id && parseFloat(r.qty) > 0),
    [rows],
  );

  const showToast = useCallback((msg, type = "success") => {
    if (type === "error") toast.error(msg);
    else toast.success(msg);
  }, []);

  const handleMMCommit = useCallback(
    async (rowId) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row?.mm_input.trim()) return;
      const mmVal = row.mm_input.trim();

      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                loading: true,
                error: "",
                product_name: "",
                finished_id: null,
                bom_id: null,
              }
            : r,
        ),
      );

      try {
        const res = await fetch(
          `/api/manufacturing/bom?search=${encodeURIComponent(mmVal)}&filterStatus=Active&limit=10`,
        );
        const data = res.ok ? await res.json() : {};
        const boms = data.data || [];
        const match = boms.find((b) => String(b.finished_id) === String(mmVal));

        if (!match) {
          setRows((prev) =>
            prev.map((r) =>
              r.id === rowId
                ? { ...r, loading: false, error: "Not found / No active BOM" }
                : r,
            ),
          );
          return;
        }

        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  loading: false,
                  finished_id: match.finished_id,
                  product_name: match.product_name || "",
                  bom_id: match.id,
                  error: "",
                }
              : r,
          ),
        );
      } catch {
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? { ...r, loading: false, error: "Lookup failed" }
              : r,
          ),
        );
      }
    },
    [rows],
  );

  const updateMMInput = useCallback((rowId, val) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              mm_input: val,
              product_name: "",
              finished_id: null,
              bom_id: null,
              error: "",
            }
          : r,
      ),
    );
  }, []);

  const updateQty = useCallback((rowId, val) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, qty: val } : r)),
    );
  }, []);

  const addRow = useCallback(() => setRows((prev) => [...prev, makeRow()]), []);
  const removeRow = useCallback(
    (rowId) => setRows((prev) => prev.filter((r) => r.id !== rowId)),
    [],
  );

  const handleQuit = useCallback(() => {
    setSoNumber("");
    setRows([makeRow()]);
  }, []);

  const handlePrint = useCallback(async () => {
    if (!validRows.length) {
      showToast("Add at least one product with quantity", "error");
      return;
    }

    setPrinting(true);
    try {
      const res = await fetch(
        "/api/manufacturing/production-plan/raw-material-report",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: validRows.map((r) => ({
              finished_id: r.finished_id,
              qty: parseFloat(r.qty),
              product_name: r.product_name,
            })),
          }),
        },
      );

      if (!res.ok) {
        showToast("Report API error", "error");
        return;
      }
      const report = await res.json();
      if (!report.materials?.length) {
        showToast("No BOM materials found", "error");
        return;
      }

      const doc = generateProductionPlanPDF(
        {
          plans: validRows.map((r) => ({
            finished_id: r.finished_id,
            product_name: r.product_name,
            qty: parseFloat(r.qty),
            sale_ord_no: soNumber,
          })),
          materials: report.materials,
          totalQty: report.totalQty,
        },
        session,
        company,
      );

      const url = URL.createObjectURL(doc.output("blob"));
      const win = window.open(url, "_blank");
      if (win)
        win.onload = () => {
          win.focus();
          win.print();
        };
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      console.error(e);
      showToast("Error generating PDF", "error");
    } finally {
      setPrinting(false);
    }
  }, [validRows, soNumber, session, company, showToast]);

  return (
    <div className="space-y-4">
      <LabHeader
        icon={ClipboardList}
        title="Production Plan"
        subtitle="Enter the products to make — prints the raw-material requirement from their active BOMs"
        actions={
          <>
            <Button variant="outline" onClick={handleQuit}>
              <RotateCcw /> Reset
            </Button>
            <Button onClick={handlePrint} disabled={printing}>
              {printing ? <Loader2 className="animate-spin" /> : <Printer />}
              {printing ? "Generating..." : "Print Report"}
            </Button>
          </>
        }
      />

      {/* Order no. + running figures */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col justify-center gap-1 rounded-xl border border-border bg-background px-4 py-3">
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Hash className="h-3.5 w-3.5" /> Sale order no. (SO #)
          </span>
          <input
            type="text"
            value={soNumber}
            onChange={(e) => setSoNumber(e.target.value)}
            placeholder="Enter order no."
            className={INPUT}
          />
        </label>
        <LabStat
          label="Products ready"
          value={validRows.length}
          hint={`of ${rows.length} line${rows.length === 1 ? "" : "s"} — valid MM No. and qty`}
          icon={PackageCheck}
          tone={validRows.length ? "ok" : "muted"}
        />
        <LabStat
          label="Total quantity"
          value={fmtQty(totalQty)}
          hint="Sum of all lines"
          icon={ClipboardList}
        />
      </div>

      <LabCard
        title="Products"
        subtitle="Type an MM No. and press Enter / Tab to look up its active BOM"
        icon={PackageCheck}
      >
        <div className="md:overflow-x-auto">
          <table className="vl-grid w-full text-sm">
            <thead>
              <tr>
                <th className={`${TH} w-12 text-center`}>#</th>
                <th className={`${TH} w-48`}>MM No.</th>
                <th className={TH}>Product Name</th>
                <th className={`${TH} w-36 text-right`}>Quantity</th>
                <th className={`${TH} w-14`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, index) => (
                <tr key={row.id} className="transition-colors hover:bg-muted/40">
                  <td data-label="#" className={`${TD} text-center tabular-nums text-muted-foreground`}>
                    {index + 1}
                  </td>

                  {/* MM No. Input */}
                  <td data-label="MM No." className={TD}>
                    <input
                      type="text"
                      value={row.mm_input}
                      onChange={(e) => updateMMInput(row.id, e.target.value)}
                      onBlur={() => handleMMCommit(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          handleMMCommit(row.id);
                        }
                      }}
                      placeholder="Enter MM No."
                      aria-invalid={!!row.error}
                      className={`${INPUT} font-mono ${row.error ? "border-destructive focus:border-destructive focus:ring-destructive/15" : ""}`}
                    />
                  </td>

                  {/* Product Name */}
                  <td data-label="Product" className={`${TD} max-md:col-span-2`}>
                    {row.loading ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        Looking up product...
                      </span>
                    ) : row.error ? (
                      <span className="flex items-center gap-1.5 text-destructive">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {row.error}
                      </span>
                    ) : row.product_name ? (
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                        {row.product_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Appears after a valid MM No.
                      </span>
                    )}
                  </td>

                  {/* Quantity Input */}
                  <td data-label="Quantity" className={TD}>
                    <input
                      type="number"
                      value={row.qty}
                      onChange={(e) => updateQty(row.id, e.target.value)}
                      min="0"
                      placeholder="0"
                      className={`${INPUT} ${NUM}`}
                    />
                  </td>

                  <td className={`${TD} vl-actions text-right`}>
                    {rows.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(row.id)}
                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Remove line"
                        aria-label={`Remove line ${index + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals (phones see them in the tiles above) */}
            <tfoot className="max-md:hidden">
              <tr className={TOTAL_ROW}>
                <td className={TD} colSpan={3}>
                  Total · {validRows.length}{" "}
                  {validRows.length === 1 ? "product" : "products"} ready
                </td>
                <td className={`${TD} ${NUM}`}>{fmtQty(totalQty)}</td>
                <td className={TD} />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Add line */}
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={addRow}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
          >
            <Plus className="h-4 w-4" /> Add line
          </button>
        </div>
      </LabCard>
    </div>
  );
};

export default ProductionPlanTab;
