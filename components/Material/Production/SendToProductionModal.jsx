"use client";
import React, { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle, Loader2, PlayCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LabCard,
  CODE_CHIP,
  TH,
  TH_ROW,
  TD,
  NUM,
  TOTAL_ROW,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";

const INPUT =
  "mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-right text-sm font-medium tabular-nums text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50";

const SendToProductionModal = ({
  plan,
  isOpen,
  onClose,
  onConfirm,
  isSending,
}) => {
  const [actualYield, setActualYield] = useState("");
  const [actualYields, setActualYields] = useState({});
  const [itemsWithWastage, setItemsWithWastage] = useState([]);
  const [acceptedItems, setAcceptedItems] = useState({});

  // Calculate wastage for each material item (exclude instructions)
  useEffect(() => {
    if (isOpen && plan?.productionPlanDetail) {
      // Filter only material items (where material_id is not null)
      const materialItems = plan.productionPlanDetail.filter(
        (item) => item.material_id !== null
      );

      const items = materialItems.map((item) => {
        const wastagePercent = item.item?.wastage_percentage || 0;
        const originalQty = parseFloat(item.material_qty) || 0;
        const wasteQty = Math.round(((originalQty * wastagePercent) / 100) * 100) / 100;
        const adjustedQty = Math.round((originalQty + wasteQty) * 100) / 100;

        return {
          ...item,
          wastagePercent,
          originalQty,
          wasteQty,
          adjustedQty,
          itemCode: item.item?.code || item.material_code || item.item?.itcd || item.material_id,
          itemName: item.item?.item || item.material_desc,
          id: item.id || `${item.material_id}-${Math.random()}`,
        };
      });

      setItemsWithWastage(items);

      // Initialize all items as accepted
      const initialAccepted = {};
      items.forEach((item) => {
        initialAccepted[item.id] = true;
      });
      setAcceptedItems(initialAccepted);
      setActualYield(plan.actual_yield || plan.qty || "");
      const outputs = plan.outputs?.length ? plan.outputs : [{ line_no: 1, actual_yield: plan.actual_yield, qty: plan.qty }];
      setActualYields(Object.fromEntries(outputs.map((output, index) => [
        Number(output.line_no) || index + 1,
        output.actual_yield ?? output.qty ?? "",
      ])));
    }
  }, [isOpen, plan]);

  const handleAcceptAll = () => {
    const allAccepted = {};
    itemsWithWastage.forEach((item) => {
      allAccepted[item.id] = true;
    });
    setAcceptedItems(allAccepted);
  };

  const handleRejectAll = () => {
    const allRejected = {};
    itemsWithWastage.forEach((item) => {
      allRejected[item.id] = false;
    });
    setAcceptedItems(allRejected);
  };

  const handleToggleItem = (itemId) => {
    setAcceptedItems((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  const handleWasteQtyChange = (itemId, val) => {
    setItemsWithWastage((prev) =>
      prev.map((item) => {
        if (item.id === itemId) {
          const numericWasteQty = val === "" ? 0 : parseFloat(val) || 0;
          const originalQty = item.originalQty;
          const adjustedQty = Math.round((originalQty + numericWasteQty) * 100) / 100;
          const wastagePercent = originalQty > 0 ? (numericWasteQty / originalQty) * 100 : 0;
          return {
            ...item,
            wasteQty: val,
            adjustedQty,
            wastagePercent,
          };
        }
        return item;
      })
    );
  };

  if (!isOpen) return null;

  const totalMaterialQty =
    plan.productionPlanDetail
      ?.filter((item) => item.type === "material")
      .reduce(
        (sum, material) => sum + (parseFloat(material.material_qty) || 0),
        0,
      ) || 0;

  const totalActualYield = Object.values(actualYields).reduce((sum, value) => sum + (Number(value) || 0), 0);

  const totalAcceptedWastage = itemsWithWastage
    .filter((item) => acceptedItems[item.id])
    .reduce((sum, item) => sum + (parseFloat(item.wasteQty) || 0), 0);

  const totalAdjustedQty = itemsWithWastage
    .filter((item) => acceptedItems[item.id])
    .reduce((sum, item) => sum + (parseFloat(item.adjustedQty) || 0), 0);

  const acceptedCount = Object.values(acceptedItems).filter(Boolean).length;

  const title = plan.type === "sf" ? "Send to Warehouse" : "Send to Production";
  const outputs = plan.outputs?.length ? plan.outputs : [{ line_no: 1, finished_id: plan.finished_id, qty: plan.qty }];
  const multiOutput = plan.outputs?.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-po-title"
    >
      <div className={cn(DIALOG, "max-w-4xl border border-border bg-background shadow-xl")}>
        <div className={cn(DIALOG_HEAD, "flex items-start gap-3")}>
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <PlayCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="send-po-title" className="text-base font-semibold text-primary">
              {title}
            </h3>
            <p className="text-xs text-muted-foreground">
              Process Order <span className={CODE_CHIP}>#{plan.id}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className={cn(DIALOG_BODY, "space-y-4")}>
          {/* Planned outputs + actual yield */}
          <LabCard title="Production details" subtitle="Enter the actual yield of every production item.">
            <div className="divide-y divide-border">
              {outputs.map((output, index) => {
                const lineNo = Number(output.line_no) || index + 1;
                return (
                  <div key={lineNo} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem] sm:items-center">
                    <div className="min-w-0">
                      <div className="text-[12px] text-muted-foreground">Output {lineNo}</div>
                      <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        {output.item_code ? <span className={cn(CODE_CHIP, "flex-shrink-0")}>{output.item_code}</span> : null}
                        <span className="truncate">{output.item_name || `Item ${output.finished_id ?? plan.finished_id}`}</span>
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 sm:block">
                      <div className="text-[12px] text-muted-foreground">Planned qty</div>
                      <div className="text-sm font-semibold tabular-nums sm:text-right">
                        {output.qty ?? plan.qty} <span className="text-xs font-medium text-muted-foreground">{output.unit || "KG"}</span>
                      </div>
                    </div>
                    <label className="block text-[12px] text-muted-foreground">
                      Actual yield
                      <input
                        type="number"
                        value={actualYields[lineNo] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setActualYields((current) => ({ ...current, [lineNo]: value }));
                          if (lineNo === 1) setActualYield(value);
                        }}
                        disabled={isSending}
                        className={INPUT}
                        min="0.001"
                        step="0.01"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </LabCard>

          {/* Wastage Management Section */}
          {itemsWithWastage.length > 0 && (
            <LabCard
              title="Material wastage"
              subtitle={`${acceptedCount} of ${itemsWithWastage.length} accepted`}
              actions={
                <>
                  <button
                    type="button"
                    onClick={handleAcceptAll}
                    disabled={isSending}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    <Check size={13} /> Accept all
                  </button>
                  <button
                    type="button"
                    onClick={handleRejectAll}
                    disabled={isSending}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    <X size={13} /> Reject all
                  </button>
                </>
              }
            >
              <div className="max-h-[45vh] overflow-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      {multiOutput && <th className={TH}>For</th>}
                      <th className={TH}>Code</th>
                      <th className={TH}>Item name</th>
                      <th className={cn(TH, "text-right")}>Original qty</th>
                      <th className={cn(TH, "text-right")}>Wastage %</th>
                      <th className={cn(TH, "text-right")}>Wastage qty</th>
                      <th className={cn(TH, "text-right")}>Adjusted qty</th>
                      <th className={cn(TH, "text-center")}>Accept</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {itemsWithWastage.map((item) => {
                      const accepted = !!acceptedItems[item.id];
                      return (
                        <tr key={item.id} className={cn("transition-colors", !accepted && "bg-muted/50 text-muted-foreground")}>
                          {multiOutput && (
                            <td className={cn(TD, "text-xs font-semibold text-primary")}>#{item.output_line || 1}</td>
                          )}
                          <td className={TD}>
                            <span className={CODE_CHIP}>{item.itemCode}</span>
                          </td>
                          <td className={cn(TD, !accepted && "line-through")}>{item.itemName}</td>
                          <td className={cn(TD, NUM)}>{item.originalQty.toFixed(2)}</td>
                          <td className={cn(TD, NUM)}>{item.wastagePercent.toFixed(2)}%</td>
                          <td className={cn(TD, "text-right")}>
                            <input
                              type="number"
                              value={item.wasteQty}
                              onChange={(e) => handleWasteQtyChange(item.id, e.target.value)}
                              disabled={isSending}
                              aria-label={`Wastage qty of ${item.itemCode}`}
                              className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-sm font-medium tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td className={cn(TD, NUM, "font-semibold text-foreground")}>{item.adjustedQty.toFixed(2)}</td>
                          <td className={cn(TD, "text-center")}>
                            <button
                              type="button"
                              onClick={() => handleToggleItem(item.id)}
                              disabled={isSending}
                              aria-pressed={accepted}
                              aria-label={accepted ? `Reject wastage of ${item.itemCode}` : `Accept wastage of ${item.itemCode}`}
                              className={cn(
                                "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-50",
                                accepted
                                  ? "bg-primary text-primary-foreground hover:opacity-90"
                                  : "border border-border bg-background text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {accepted ? <Check size={14} /> : <X size={14} />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className={TOTAL_ROW}>
                      <td className={TD} colSpan={multiOutput ? 5 : 4}>
                        Accepted total
                      </td>
                      <td className={cn(TD, NUM)}>{totalAcceptedWastage.toFixed(2)}</td>
                      <td className={cn(TD, NUM)}>{totalAdjustedQty.toFixed(2)}</td>
                      <td className={TD} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </LabCard>
          )}

          <LabCard title="Accounting transactions" bodyClassName="px-4 py-3">
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle size={14} className="text-primary" />
                Debit: Material Produced Account
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle size={14} className="text-primary" />
                Credit: Material Issued for Production Account
              </li>
              {totalMaterialQty - totalActualYield > 0 && (
                <li className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-primary" />
                  Credit: Material Process Loss Account
                </li>
              )}
            </ul>
          </LabCard>
        </div>

        <div className={DIALOG_FOOT}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              // Prepare adjusted quantities for accepted items
              const adjustedItems = itemsWithWastage
                .filter((item) => acceptedItems[item.id])
                .reduce((acc, item) => {
                  acc[item.id] = item.adjustedQty;
                  return acc;
                }, {});

              onConfirm(plan.id, parseFloat(actualYield), adjustedItems, actualYields);
            }}
            disabled={isSending}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {isSending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <PlayCircle size={16} />
                {title}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SendToProductionModal;
