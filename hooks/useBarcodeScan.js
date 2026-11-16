"use client";
// use-scan-detection defaults its `container` to `document` while rendering,
// which throws during the server render of every page that uses it
// ("document is not defined" → 500). The listener is only attached in an
// effect (browser only), so on the server a null container is never touched.
import useScanDetection from "use-scan-detection";

export default function useBarcodeScan(options) {
  const container = options?.container ?? (typeof document === "undefined" ? null : document);
  return useScanDetection({ ...options, container });
}
