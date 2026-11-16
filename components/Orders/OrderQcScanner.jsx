"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useScanDetection from "@/hooks/useBarcodeScan";
import { ScanLine, ClipboardCheck, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const AUTO_SUBMIT_DELAY = 500;

export default function OrderQcScanner() {
  const router = useRouter();
  const [scanValue, setScanValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [lastError, setLastError] = useState("");
  const submitTimeoutRef = useRef(null);

  const submitScan = async (rawValue) => {
    const value = String(rawValue ?? "").trim();
    if (!value || isSubmitting) return;

    setIsSubmitting(true);
    setLastError("");

    try {
      // QA barcode -> QC form, QC barcode -> dashboard/GRN state.
      const response = await fetch("/api/forms/orderqualitycontrol/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: value }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to process QA scan.");
      }

      setLastResult(payload.data);
      toast.success(payload.message);
    } catch (error) {
      const message = error.message || "Failed to process QA scan.";
      setLastError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const queueSubmit = (value) => {
    if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
    submitTimeoutRef.current = setTimeout(() => submitScan(value), AUTO_SUBMIT_DELAY);
  };

  useEffect(() => {
    return () => {
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
    };
  }, []);

  useScanDetection({
    onComplete: (code) => {
      setScanValue(code);
      queueSubmit(code);
    },
    onError: (code) => setLastError(`Incomplete scan detected: ${code}`),
    minLength: 1,
    averageWaitTime: 30,
    timeToEvaluate: 40,
    endCharacter: [9, 13],
  });

  return (
    <Card className="mb-6 border border-border shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl text-primary">
          <ClipboardCheck className="h-5 w-5" />
          Scan QA / QC Barcode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={scanValue}
          onChange={(event) => {
            setScanValue(event.target.value);
            if (event.target.value.trim()) queueSubmit(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitScan(scanValue);
            }
          }}
          placeholder="Scan QA-... or QCO-... barcode"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => submitScan(scanValue)} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ScanLine className="mr-2 h-4 w-4" />
            )}
            {isSubmitting ? "Processing..." : "Process Scan"}
          </Button>

          {lastResult ? (
            <Badge variant="outline">
              {lastResult.direction === "qc_to_grn"
                ? `QC ready for GRN on order #${lastResult.order_no}`
                : `QA ready for QC on order #${lastResult.order_no}`}
            </Badge>
          ) : null}
        </div>

        {lastError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {lastError}
          </div>
        ) : null}

        {lastResult ? (
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-muted-foreground">QA Barcode</p>
                <p className="font-semibold">{lastResult.qa_barcode || "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">QC Barcode</p>
                <p className="font-semibold">{lastResult.qc_barcode || "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Order</p>
                <p className="font-semibold">#{lastResult.order_no}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">GRN Status</p>
                <p className="font-semibold">
                  {lastResult.grn_status}
                  {lastResult.grn_no ? ` (#${lastResult.grn_no})` : ""}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => router.push(lastResult.route)}>
                {lastResult.direction === "qc_to_grn" ? "Open QA Dashboard" : "Open QC Form"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
