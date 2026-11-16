"use client";

import { useCallback, useRef, useState } from "react";
import axios from "axios";
import useScanDetection from "@/hooks/useBarcodeScan";
import {
  FACTORY_MODULES,
  getWorkflowForModule,
  normalizeFactoryModule,
} from "@/lib/factory-scan/config";
import { parseFactoryScan } from "@/lib/factory-scan/parser";

const DEFAULT_DUPLICATE_WINDOW = 1200;

async function runDefaultWorkflow(parsedScan) {
  const currentModule = normalizeFactoryModule(parsedScan.currentModule);

  if (currentModule === FACTORY_MODULES.PURCHASE) {
    if (!parsedScan.orderNo || !parsedScan.itcd) {
      throw new Error("Purchase scans require orderNo and itcd.");
    }

    const response = await axios.post("/api/store/qa-entry", {
      order_no: parsedScan.orderNo,
      itcd: parsedScan.itcd,
      received_qty: parsedScan.receivedQty ?? 1,
      remarks: parsedScan.remarks ?? null,
      ...(parsedScan.batchNo ? { batch_no: String(parsedScan.batchNo) } : {}),
    });

    return {
      type: "api",
      endpoint: "/api/store/qa-entry",
      payload: response.data,
    };
  }

  if (currentModule === FACTORY_MODULES.PRODUCTION) {
    if (!parsedScan.productionPlanId) {
      throw new Error("Production scans require productionPlanId.");
    }

    return {
      type: "route",
      endpoint: `/accounting/forms/qualitycontrol/${parsedScan.productionPlanId}`,
      payload: {
        proc_ord_no: parsedScan.productionPlanId,
        nextModule: "qa",
      },
    };
  }

  if (currentModule === FACTORY_MODULES.LAB) {
    return {
      type: "route",
      endpoint: "/accounting/material",
      payload: {
        productionPlanId: parsedScan.productionPlanId ?? null,
        nextModule: FACTORY_MODULES.PRODUCTION,
      },
    };
  }

  if (currentModule === FACTORY_MODULES.STORE) {
    return {
      type: "state",
      endpoint: parsedScan.route,
      payload: {
        nextModule: null,
      },
    };
  }

  return {
    type: "state",
    endpoint: null,
    payload: null,
  };
}

export function useFactoryScan({
  module: initialModule = FACTORY_MODULES.PURCHASE,
  onWorkflowUpdate,
  onScanSuccess,
  onScanError,
  workflowHandlers = {},
  duplicateWindowMs = DEFAULT_DUPLICATE_WINDOW,
  scannerOptions = {},
} = {}) {
  const [currentModule, setCurrentModule] = useState(
    normalizeFactoryModule(initialModule),
  );
  const [scannedData, setScannedData] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const duplicateRef = useRef({ value: null, timestamp: 0 });

  const handleScan = useCallback(
    async (rawValue) => {
      const now = Date.now();
      const normalizedRaw = String(rawValue || "").trim();

      if (!normalizedRaw) {
        return null;
      }

      if (
        duplicateRef.current.value === normalizedRaw &&
        now - duplicateRef.current.timestamp < duplicateWindowMs
      ) {
        return {
          ignored: true,
          reason: "duplicate-scan",
        };
      }

      duplicateRef.current = {
        value: normalizedRaw,
        timestamp: now,
      };

      setIsProcessing(true);
      setLastError(null);

      try {
        const parsedScan = parseFactoryScan(normalizedRaw, currentModule);
        const workflowHandler =
          workflowHandlers[parsedScan.currentModule] || runDefaultWorkflow;
        const workflowResult = await workflowHandler(parsedScan);

        const nextState = {
          ...parsedScan,
          ...getWorkflowForModule(parsedScan.currentModule),
          workflowResult,
          scannedAt: new Date().toISOString(),
        };

        setCurrentModule(parsedScan.currentModule);
        setScannedData(nextState);

        await onWorkflowUpdate?.(nextState);
        await onScanSuccess?.(nextState);

        return nextState;
      } catch (error) {
        const scanError = {
          message: error?.message || "Failed to process scan.",
          rawValue: normalizedRaw,
          currentModule,
        };

        console.error("[useFactoryScan] scan processing failed", scanError);
        setLastError(scanError);
        await onScanError?.(scanError);
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    [
      currentModule,
      duplicateWindowMs,
      onScanError,
      onScanSuccess,
      onWorkflowUpdate,
      workflowHandlers,
    ],
  );

  useScanDetection({
    onComplete: handleScan,
    onError: (rawValue) => {
      const scanError = {
        message: "Incomplete scan detected.",
        rawValue,
        currentModule,
      };

      console.warn("[useFactoryScan] incomplete scan detected", scanError);
      setLastError(scanError);
      onScanError?.(scanError);
    },
    minLength: scannerOptions.minLength ?? 3,
    averageWaitTime: scannerOptions.averageWaitTime ?? 30,
    timeToEvaluate: scannerOptions.timeToEvaluate ?? 40,
    endCharacter: scannerOptions.endCharacter ?? [9, 13],
    preventDefault: scannerOptions.preventDefault ?? false,
    stopPropagation: scannerOptions.stopPropagation ?? false,
    ignoreIfFocusOn: scannerOptions.ignoreIfFocusOn,
    container: scannerOptions.container,
  });

  return {
    scannedData,
    currentModule,
    handleScan,
    lastError,
    isProcessing,
    setCurrentModule,
  };
}

export default useFactoryScan;
