// hooks/useFeatures.js
// Settings → Features for screens (lib/features/catalog.js).
//
//   const features = useFeatures();
//   features.on("dispatch.produceOnDispatch")            // true / false
//   features.value("production.processOrderSource")      // "bom" | "recipe"
//
// While loading (or if the setting cannot be read) every feature is at its
// default — the SMS behaviour — so a form never flickers into another flow.
"use client";
import { useCallback, useMemo } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { resolveFeatures, featureDef } from "@/lib/features/catalog";
import { primeClientFeatures } from "@/lib/features/client";

export const FEATURES_QUERY_KEY = ["featureFlags"];

export function useFeatures() {
  const query = useQuery({
    queryKey: FEATURES_QUERY_KEY,
    queryFn: async () => (await axios.get("/api/settings/features")).data,
    staleTime: 60_000,
  });
  const values = useMemo(() => {
    // Config callbacks outside React (lib/features/client.js) read the same values
    if (query.data?.values) primeClientFeatures(query.data.values);
    return query.data?.values ?? resolveFeatures(null);
  }, [query.data]);
  const value = useCallback((key) => {
    if (!featureDef(key)) throw new Error(`Unknown feature "${key}" — add it to lib/features/catalog.js`);
    return values[key];
  }, [values]);
  const on = useCallback((key) => value(key) === true, [value]);
  return { ...query, values, value, on, canEdit: Boolean(query.data?.canEdit) };
}
