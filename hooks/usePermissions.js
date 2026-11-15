"use client";
// Client-side view of what the signed-in user may do.
//
// This hides buttons; it does not protect anything. Every route checks the
// same permission server-side, so a user who forges the answer here gains
// nothing but a button that returns 403. Hiding it is purely so people are
// not offered actions that will be refused.
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

/**
 * @param {string[]} entities  entity names whose field policy this screen
 *                             needs (e.g. ["ACNO"]), so the form can render
 *                             a field read-only or drop it entirely
 */
export function usePermissions(entities = []) {
  const key = entities.join(",");

  const { data, isLoading, error } = useQuery({
    queryKey: ["permissions", key],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/permissions/me${key ? `?entities=${encodeURIComponent(key)}` : ""}`,
      );
      return data;
    },
    // Rights change rarely, and the server is the real gate, so a long cache
    // costs nothing but saves a request on every screen.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const codes = data?.permissions;
  const fullAccess = data?.fullAccess ?? false;

  /** True when the user holds this permission. Unknown while loading. */
  const can = (code) => fullAccess || (Array.isArray(codes) && codes.includes(code));

  /**
   * How a field should be rendered: "EDIT" | "READONLY" | "HIDDEN".
   * Defaults to EDIT — a field with no policy is a normal field.
   */
  const fieldAccess = (entity, field) =>
    fullAccess ? "EDIT" : (data?.fieldPolicy?.[entity]?.[field] ?? "EDIT");

  return {
    can,
    fieldAccess,
    fullAccess,
    scopes: data?.scopes ?? null,
    permissions: codes ?? [],
    loading: isLoading,
    error,
  };
}

/**
 * Render children only when the permission is held.
 *
 *   <Can code="salesItem.rate.update"><RateInput … /></Can>
 *
 * While the answer is still loading nothing is rendered, so a control never
 * flashes into view and then disappears. Pass `fallback` for a read-only
 * stand-in.
 */
export function Can({ code, children, fallback = null }) {
  const { can, loading } = usePermissions();
  if (loading) return null;
  return can(code) ? children : fallback;
}
