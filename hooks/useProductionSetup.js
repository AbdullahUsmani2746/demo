// hooks/useProductionSetup.js
// Settings → Production setup for screens (lib/production/setupConfig.js).
//
//   const { setup } = useProductionSetup();
//   isFinishedCategory(setup, item.ic_id)
//   godownForCategory(setup, item.ic_id)
//
// While loading (or if the setting cannot be read) the setup is the defaults
// — the values the code always had — so a form never starts somewhere else.
"use client";
import { useMemo } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { resolveProductionSetup } from "@/lib/production/setupConfig";

export const PRODUCTION_SETUP_QUERY_KEY = ["productionSetup"];

export function useProductionSetup() {
  const query = useQuery({
    queryKey: PRODUCTION_SETUP_QUERY_KEY,
    queryFn: async () => (await axios.get("/api/settings/production-setup")).data,
    staleTime: 60_000,
  });
  const setup = useMemo(() => query.data?.values ?? resolveProductionSetup(null), [query.data]);
  return { ...query, setup, canEdit: Boolean(query.data?.canEdit) };
}
