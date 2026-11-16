"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useScanDetection from "@/hooks/useBarcodeScan";
import { ScanLine, FlaskConical, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LabCard, Chip, CHIP, CODE_CHIP } from "@/components/Material/shared/LabUI";

const AUTO_SUBMIT_DELAY = 500;

export default function ProductionQcScanner() {
  const router = useRouter();
  const [scanValue, setScanValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [lastError, setLastError] = useState("");
  const lastSubmittedRef = useRef("");
  const submitTimeoutRef = useRef(null);

  const submitScan = async (rawValue) => {
    const value = String(rawValue ?? "").trim();

    if (!value || value === lastSubmittedRef.current || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setLastError("");

    try {
      // This is the integration point with the existing production -> QC flow.
      // A scanned or typed process order creates/reuses the QualityMaster row
      // that the QC dashboard already reads from /api/forms/qualitycontrol.
      const response = await fetch("/api/forms/qualitycontrol/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          barcode: value,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to create quality control record.");
      }

      lastSubmittedRef.current = value;
      setLastResult(payload.data);
      toast.success(payload.message);
    } catch (error) {
      const message = error.message || "Failed to create quality control record.";
      console.error("[ProductionQcScanner] submission failed", {
        value,
        message,
      });
      setLastError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const queueSubmit = (value) => {
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current);
    }

    submitTimeoutRef.current = setTimeout(() => {
      submitScan(value);
    }, AUTO_SUBMIT_DELAY);
  };

  const handleInputChange = (event) => {
    const nextValue = event.target.value;
    setScanValue(nextValue);
    setLastError("");

    // Manual typing uses the same path as hardware scanning for initial testing.
    if (nextValue.trim()) {
      queueSubmit(nextValue);
    }
  };

  useEffect(() => {
    return () => {
      if (submitTimeoutRef.current) {
        clearTimeout(submitTimeoutRef.current);
      }
    };
  }, []);

  useScanDetection({
    onComplete: (code) => {
      setScanValue(code);
      queueSubmit(code);
    },
    onError: (code) => {
      setLastError(`Incomplete scan detected: ${code}`);
    },
    minLength: 1,
    averageWaitTime: 30,
    timeToEvaluate: 40,
    endCharacter: [9, 13],
  });

  return (
    <LabCard
      icon={FlaskConical}
      title="Scan production barcode to create QC"
      subtitle="Scan the barcode stored against the production record — typing works the same way."
      bodyClassName="space-y-3 p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="po-qc-scan" className="text-[12px] font-medium text-muted-foreground">
            Production barcode
          </label>
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="po-qc-scan"
              value={scanValue}
              onChange={handleInputChange}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitScan(scanValue);
                }
              }}
              placeholder="Scan or type e.g. PRD-20260329-NEW-000010"
              className="pl-9 font-mono"
            />
          </div>
        </div>
        <Button onClick={() => submitScan(scanValue)} disabled={isSubmitting} className="sm:w-auto">
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ScanLine className="mr-2 h-4 w-4" />
          )}
          {isSubmitting ? "Creating..." : "Create QC Record"}
        </Button>
      </div>

      {lastError ? (
        <div role="alert" className={cn("rounded-lg px-3 py-2 text-sm", CHIP.bad)}>
          {lastError}
        </div>
      ) : null}

      {lastResult ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="mb-2">
            <Chip tone="ok">
              {lastResult.direction === "qc_to_production"
                ? `Production reopened for process order #${lastResult.proc_ord_no}`
                : `QC ready for process order #${lastResult.proc_ord_no}`}
            </Chip>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">Barcode</dt>
              <dd className="break-all font-mono font-semibold">{lastResult.barcode}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">QC barcode</dt>
              <dd className="break-all font-mono font-semibold">{lastResult.qc_barcode || "-"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted-foreground">Process order</dt>
              <dd><span className={CODE_CHIP}>#{lastResult.proc_ord_no}</span></dd>
            </div>
            <div className="min-w-0 sm:col-span-3">
              <dt className="text-[12px] text-muted-foreground">Item</dt>
              <dd className="font-semibold">
                {lastResult.itcd} {lastResult.item_name ? `- ${lastResult.item_name}` : ""}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(lastResult.route)}
            >
              {lastResult.direction === "qc_to_production"
                ? "Open Production"
                : "Open QC Form"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/accounting/forms/qualitycontrol")}
            >
              Open QC Dashboard
            </Button>
          </div>
        </div>
      ) : null}
    </LabCard>
  );
}
