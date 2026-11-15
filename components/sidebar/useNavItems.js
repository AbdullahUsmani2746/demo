"use client";
// The menu tree a person sees — ONE source for the sidebar (app-sidebar.jsx)
// and the search palette (search-form.jsx), so the two can never disagree.
//
// Comes from their roles (Admin → Roles → "Sidebar"), carried on the session
// as session.user.navMode:
//   "all"       the whole menus table (Setup → Menu) — Super Admin, management
//   "assigned"  their own Employee menus (employee_menu) — everyone else
// Menus blocked for them (Permissions → Menu access) drop out on the server
// (/api/buildMenu). Someone with no menus sees nothing — never the full
// navigation by accident. The Admin area (/admin/*, role="admin" from its
// layout) has its own short list (nav-data.js navAdmin).
import { useSession } from "next-auth/react";
import { data } from "@/components/sidebar/nav-data";
import { useMenuTree } from "@/hooks/useMenuTree";

const normUrl = (u) => (!u || u === "#" ? "" : String(u).split("?")[0].replace(/\/$/, "").toLowerCase());
export function pruneBlocked(items, blocked) {
  if (!blocked.length) return items;
  return (items || []).reduce((out, it) => {
    const u = normUrl(it.url);
    if (u && blocked.some((b) => u === b || u.startsWith(`${b}/`))) return out;
    if (Array.isArray(it.items) && it.items.length) {
      const kids = pruneBlocked(it.items, blocked);
      if (!kids.length && !u) return out;
      out.push({ ...it, items: kids });
    } else out.push(it);
    return out;
  }, []);
}

export function useNavItems(role, employeeId) {
  const { data: session } = useSession();
  const admin = role === "admin";
  const all = session?.user?.navMode === "all";
  const { menus, loading } = useMenuTree(admin || all ? null : employeeId, { all: !admin && all });
  if (admin) return { items: data.navAdmin || [], loading: false };
  return { items: menus || [], loading };
}
