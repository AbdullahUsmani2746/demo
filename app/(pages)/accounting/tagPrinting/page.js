"use client";
// Printing → Tag Printing (Process Monitor Form). Left: pick a process order,
// Load it, then tare weight and the status boxes to tick. Right: the PMF as it
// prints. Print sends the page to the browser printer; only #print-area prints.
import React, { useState } from "react";
import { Printer, Search, FileText, X, Loader2, RefreshCw, ClipboardCheck, Tag } from "lucide-react";
import axios from "axios";
import Select from "react-select";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { CODE_CHIP, LabCard, LabEmpty, LabHeader } from "@/components/Material/shared/LabUI";
import { cn } from "@/lib/utils";

// react-select on theme tokens (works in dark mode too).
const pickerStyles = (hasError) => {
  const s = selectStyles(hasError);
  return {
    ...s,
    control: (base, state) => ({ ...s.control(base, state), backgroundColor: "hsl(var(--background))" }),
    singleValue: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
    input: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
    menuList: (base) => ({ ...base, maxHeight: "240px" }),
  };
};

const STATUS_OPTIONS = [
  { key: "weighing", label: "Weighing" },
  { key: "preMixing", label: "Pre Mixing" },
  { key: "grinding", label: "Grinding" },
  { key: "refinePass", label: "Refine Pass" },
  { key: "qcPass", label: "QC Pass" },
  { key: "packing", label: "Packing" },
];

// The Process Monitor Form exactly as it prints — used for the print area and
// for the on-screen preview.
function PmfSheet({ productionData, tareWeight, selectedStatuses, formatDate }) {
  return (
    <div className="bg-white">
      <div className="border-b-2 border-black p-4">
        <h2 className="text-2xl font-bold text-center text-black">
          PROCESS MONITOR FORM (PMF)
        </h2>
      </div>

      <div className="p-6">
        <div className="space-y-3 mb-5">
          <div className="grid grid-cols-2 gap-x-6">
            <div className="flex border-b border-black pb-1.5">
              <span className="font-bold text-black w-40 text-sm">
                MATERIAL CODE
              </span>
              <span className="text-black flex-1 text-sm">
                {productionData.finished_id}
              </span>
            </div>
            <div className="flex border-b border-black pb-1.5">
              <span className="font-bold text-black w-24 text-sm">
                DATE
              </span>
              <span className="text-black flex-1 text-sm">
                {formatDate(productionData.dated)}
              </span>
            </div>
          </div>

          <div className="flex border-b border-black pb-1.5">
            <span className="font-bold text-black w-40 text-sm">
              MATERIAL DESCRIPTION
            </span>
            <span className="text-black flex-1 text-sm">
              {productionData.productName}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-6">
            <div className="flex border-b border-black pb-1.5">
              <span className="font-bold text-black w-40 text-sm">
                PROCESS ORDER#
              </span>
              <span className="text-black flex-1 text-sm">
                {productionData.id}
              </span>
            </div>
            <div className="flex border-b border-black pb-1.5">
              <span className="font-bold text-black w-24 text-sm">
                TARE WEIGHT
              </span>
              <span className="text-black flex-1 text-sm">
                {tareWeight}
              </span>
            </div>
          </div>

          <div className="flex border-b border-black pb-1.5">
            <span className="font-bold text-black w-40 text-sm">
              QUANTITY
            </span>
            <span className="text-black flex-1 text-sm">
              {productionData.qty}
            </span>
          </div>
        </div>

        <div className="pt-3 border-t-2 border-black">
          <div className="font-bold text-black mb-2 text-sm">
            STATUS:{" "}
            <span className="font-normal">
              Pls tick appropriate boxes
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 border-2 border-black flex items-center justify-center ${selectedStatuses.weighing ? "bg-black" : ""}`}
              >
                {selectedStatuses.weighing && (
                  <span className="text-white text-xs">✓</span>
                )}
              </div>
              <span className="text-black font-medium text-sm">
                WEIGHING
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 border-2 border-black flex items-center justify-center ${selectedStatuses.refinePass ? "bg-black" : ""}`}
              >
                {selectedStatuses.refinePass && (
                  <span className="text-white text-xs">✓</span>
                )}
              </div>
              <span className="text-black font-medium text-sm">
                REFINE PASS
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 border-2 border-black flex items-center justify-center ${selectedStatuses.preMixing ? "bg-black" : ""}`}
              >
                {selectedStatuses.preMixing && (
                  <span className="text-white text-xs">✓</span>
                )}
              </div>
              <span className="text-black font-medium text-sm">
                PRE MIXING
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 border-2 border-black flex items-center justify-center ${selectedStatuses.qcPass ? "bg-black" : ""}`}
              >
                {selectedStatuses.qcPass && (
                  <span className="text-white text-xs">✓</span>
                )}
              </div>
              <span className="text-black font-medium text-sm">
                QC PASS
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 border-2 border-black flex items-center justify-center ${selectedStatuses.grinding ? "bg-black" : ""}`}
              >
                {selectedStatuses.grinding && (
                  <span className="text-white text-xs">✓</span>
                )}
              </div>
              <span className="text-black font-medium text-sm">
                GRINDING
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 border-2 border-black flex items-center justify-center ${selectedStatuses.packing ? "bg-black" : ""}`}
              >
                {selectedStatuses.packing && (
                  <span className="text-white text-xs">✓</span>
                )}
              </div>
              <span className="text-black font-medium text-sm">
                PACKING
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value, code, className }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-muted/30 px-3 py-2", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {code ? (
        <span className={cn(CODE_CHIP, "mt-0.5 inline-block")}>{value}</span>
      ) : (
        <p className="break-words text-sm font-semibold text-foreground">{value}</p>
      )}
    </div>
  );
}

const TagPrintingPage = () => {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [tareWeight, setTareWeight] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState({
    weighing: false,
    preMixing: false,
    grinding: false,
    refinePass: false,
    qcPass: false,
    packing: false,
  });

  // Fetch process orders with TanStack Query
  const { data: processOrdersData, isLoading: isLoadingOrders } = useQuery({
    queryKey: ["processOrders", searchTerm],
    queryFn: async () => {
      const response = await axios.get("/api/manufacturing/production", {
        params: {
          search: searchTerm,
          limit: 10,
        },
      });
      return response.data.data || [];
    },
    staleTime: 5 * 60 * 1000,
    select: (data) =>
      data.map((item) => ({
        value: item.id,
        label: `${item.id} - ${item.productName}`,
      })),
  });

  // Fetch specific production data
  const {
    data: productionData,
    isLoading: isLoadingProduction,
    error,
    refetch,
  } = useQuery({
    queryKey: ["production", selectedOrder?.value],
    queryFn: async () => {
      const response = await axios.get(
        `/api/manufacturing/production?id=${selectedOrder.value}`,
      );
      if (response.data.data && response.data.data.length > 0) {
        return response.data.data[0];
      }
      throw new Error("No data found for this process order");
    },
    enabled: false,
    retry: 1,
  });

  const handleQuery = () => {
    if (selectedOrder) {
      refetch();
    }
  };

  const handleStatusChange = (status) => {
    setSelectedStatuses((prev) => ({
      ...prev,
      [status]: !prev[status],
    }));
  };

  const handlePrint = () => {
    window.print();
  };

  const handleReset = () => {
    setSelectedOrder(null);
    setTareWeight("");
    setSelectedStatuses({
      weighing: false,
      preMixing: false,
      grinding: false,
      refinePass: false,
      qcPass: false,
      packing: false,
    });
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })
      .toUpperCase();
  };

  const tickedCount = Object.values(selectedStatuses).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-muted/40 print:min-h-0 print:bg-white">
      {/* Screen - No Print */}
      <div className="print:hidden mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        <LabHeader
          icon={Tag}
          breadcrumb="Printing"
          title="Tag Printing"
          subtitle="Process Monitor Form for a process order"
          className="mb-4"
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Left - setup */}
          <div className="space-y-4 lg:col-span-2">
            <LabCard title="Process order" subtitle="Search, then Load" icon={Search} bodyClassName="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Process Order Number</Label>
                <Select
                  value={selectedOrder}
                  onChange={setSelectedOrder}
                  options={processOrdersData || []}
                  isLoading={isLoadingOrders}
                  placeholder="Search orders..."
                  menuPortalTarget={
                    typeof window !== "undefined" ? document.body : null
                  }
                  menuPosition="fixed"
                  styles={pickerStyles(!!error)}
                  isClearable
                  onInputChange={(value) => setSearchTerm(value)}
                />
              </div>

              <Button
                onClick={handleQuery}
                disabled={isLoadingProduction || !selectedOrder}
                className="w-full"
              >
                {isLoadingProduction ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Load Order
                  </>
                )}
              </Button>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
                  <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                  <div>
                    <p className="text-xs font-semibold text-destructive">Error</p>
                    <p className="text-xs text-foreground">{error.message}</p>
                  </div>
                </div>
              )}
            </LabCard>

            {productionData && (
              <LabCard title="Tag information" icon={FileText} bodyClassName="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <InfoTile label="Order Number" value={productionData.id} code />
                  <InfoTile label="Material Code" value={productionData.finished_id} code />
                  <InfoTile label="Product" value={productionData.productName} className="col-span-2" />
                  <InfoTile label="Quantity" value={productionData.qty} />
                  <InfoTile label="Date" value={formatDate(productionData.dated)} />
                </div>

                {/* Tare Weight */}
                <div className="space-y-1.5">
                  <Label htmlFor="tag-tare" className="text-[13px]">
                    Tare Weight <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="tag-tare"
                    type="text"
                    value={tareWeight}
                    onChange={(e) => setTareWeight(e.target.value)}
                    placeholder="Enter tare weight"
                  />
                </div>

                {/* Status Checkboxes */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-[13px]">
                    <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
                    Production Status
                    <span className="ml-auto text-xs font-normal text-muted-foreground">{tickedCount} ticked</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                    {STATUS_OPTIONS.map((status) => (
                      <label
                        key={status.key}
                        htmlFor={`tag-status-${status.key}`}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 transition-colors",
                          selectedStatuses[status.key]
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        <Checkbox
                          id={`tag-status-${status.key}`}
                          checked={selectedStatuses[status.key]}
                          onCheckedChange={() => handleStatusChange(status.key)}
                        />
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            selectedStatuses[status.key] ? "text-primary" : "text-foreground",
                          )}
                        >
                          {status.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </LabCard>
            )}
          </div>

          {/* Right - preview */}
          <div className="lg:col-span-3">
            <LabCard title="Preview" subtitle="As it prints (A4 portrait)" icon={Printer} className="lg:sticky lg:top-4">
              <div className="bg-muted/50 p-3 sm:p-5">
                {productionData ? (
                  <div className="mx-auto max-w-[210mm] overflow-hidden rounded-sm text-black shadow-md ring-1 ring-border">
                    <PmfSheet
                      productionData={productionData}
                      tareWeight={tareWeight}
                      selectedStatuses={selectedStatuses}
                      formatDate={formatDate}
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-background">
                    <LabEmpty
                      icon={FileText}
                      title="No process order loaded"
                      hint="Pick a process order and press Load Order to see the tag here."
                    />
                  </div>
                )}
              </div>
            </LabCard>
          </div>
        </div>

        {/* Action bar */}
        {productionData && (
          <div className="sticky bottom-0 z-10 -mx-3 mt-4 border-t border-border bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
              <p className="mr-auto hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
                PMF for <span className="font-semibold text-foreground">{productionData.id}</span> · {productionData.productName}
              </p>
              <Button variant="outline" onClick={handleReset}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset
              </Button>
              <Button onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Print Tag
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Print Content */}
      {productionData && (
        <div id="print-area" className="print:block hidden">
          <PmfSheet
            productionData={productionData}
            tareWeight={tareWeight}
            selectedStatuses={selectedStatuses}
            formatDate={formatDate}
          />
        </div>
      )}

      <style jsx>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html,
          body {
            height: 100%;
            margin: 0;
            padding: 0;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:block {
            display: block !important;
          }
        }
      `}</style>
    </div>
  );
};

export default TagPrintingPage;
