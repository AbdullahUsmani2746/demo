// hooks/useStockPolicy.js
// The stock check policy for screens (Settings → Stock checking).
//
//   const { screenMode } = useStockPolicy();
//   screenMode("pos")   // "off" | "warn" | "block" — what the form should do
//
// While loading (or if the policy cannot be read) the defaults apply, i.e.
// the form behaves exactly as it did before the setting existed.
"use client";
import { useCallback, useMemo } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { resolveStockPolicy, modeOf } from "@/lib/stock/policyConfig";

export const STOCK_POLICY_QUERY_KEY = ["stockCheckPolicy"];

export function useStockPolicy() {
  const query = useQuery({
    queryKey: STOCK_POLICY_QUERY_KEY,
    queryFn: async () => (await axios.get("/api/settings/stock-check")).data,
    staleTime: 30_000,
  });
  const resolved = useMemo(() => resolveStockPolicy(query.data?.policy ?? null), [query.data]);
  const screenMode = useCallback((type) => modeOf(resolved, type, { screen: true }), [resolved]);
  const saveMode = useCallback((type) => modeOf(resolved, type), [resolved]);
  return { ...query, resolved, screenMode, saveMode, canEdit: Boolean(query.data?.canEdit) };
}
