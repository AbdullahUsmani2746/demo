"use client";
// The role catalogue for pickers and labels (Admin → Roles, /api/roles).
// One cached request for the whole app; never hard-code a role list in a screen.
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { rememberRoleNames, roleLabel } from "@/lib/auth/roleNames";

export function useRoles() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await axios.get("/api/roles")).data,
    staleTime: 60 * 1000,
    retry: false,
  });
  const roles = data?.roles ?? [];
  rememberRoleNames(roles);
  return {
    roles,
    activeRoles: roles.filter((r) => r.is_active),
    levels: data?.levels ?? [],
    canManage: !!data?.canManage,
    /** "Sales Officer" for SALES — the code itself until loaded / when unknown. */
    roleName: roleLabel,
    loading: isLoading,
    refetch,
  };
}
