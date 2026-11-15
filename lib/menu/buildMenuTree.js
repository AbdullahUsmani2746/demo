// Shared by /api/buildMenu. Lives here rather than in the route file so the
// ordering rules can be exercised directly.

import { ORDER_SOURCE } from "@/lib/menu/appMenuSettings";

// Preferred order for top-level modules. Titles not listed fall back to
// order_no, then alphabetical.
export const MENU_ORDER = [
  "SALES",
  "LAB",
  "STORES",
  "PRODUCTION",
  "DESPATCH",
  "FINANCE",
  "ACCOUNTS DESK",
  // The module row is titled IMPORT, not IMPORTS — a title that does not match
  // sorts to the bottom instead of into position, so this has to stay in sync
  // with the menus table.
  "IMPORT",
  "HR OPERATIONS",
  "FIXED ASSETS",
  "MANAGEMENT",
  "OPERATIONAL MANAGER",
  "QUALITY ASSURANCE",
  "SUPPLY CHAIN",
];

// How top-level modules are ordered is a setting, not a guess: ORDER_SOURCE.LIST
// (default) uses the MENU_ORDER list below, ORDER_SOURCE.ORDER_NO uses
// menus.order_no as edited in Setup → Menu. Deliberately explicit — inferring it
// from "does any menu have a non-zero order_no" would reorder the live menu the
// moment one row is touched.
export function buildMenuTree(
  allMenus,
  parentId = null,
  availableIds = null,
  orderSource = ORDER_SOURCE.LIST
) {
  const orderNoWins = orderSource === ORDER_SOURCE.ORDER_NO;

  return allMenus
    .filter((menu) => {
      const menuParentId = menu.parent_id === null ? null : Number(menu.parent_id);
      const currentParentId = parentId === null ? null : Number(parentId);

      // An employee can be assigned a child menu without its parent. That menu
      // has a parent_id nobody in the visible set matches, so it used to match
      // nothing and vanish. Treat it as a root instead, so every assigned menu
      // stays reachable.
      if (currentParentId === null && menuParentId !== null && availableIds) {
        return !availableIds.has(menuParentId);
      }

      return menuParentId === currentParentId;
    })
    .sort((a, b) => {
      // Custom order applies to top-level menus only, and only while nobody
      // has set an explicit order_no on them.
      if (parentId === null && !orderNoWins) {
        const indexA = MENU_ORDER.indexOf(a.title);
        const indexB = MENU_ORDER.indexOf(b.title);

        const orderA = indexA === -1 ? 9999 : indexA;
        const orderB = indexB === -1 ? 9999 : indexB;

        if (orderA !== orderB) return orderA - orderB;
      }

      // order_no for children, and the tie-break for top-level menus MENU_ORDER
      // does not name — without it their order is whatever the database
      // happened to return, which varies between requests.
      const byOrderNo = (a.order_no ?? 0) - (b.order_no ?? 0);
      if (byOrderNo !== 0) return byOrderNo;

      // Final tie-break so equal order_no values stay stable.
      return (a.title || "").localeCompare(b.title || "");
    })
    .map((menu) => ({
      id: menu.id,
      title: menu.title,
      url: menu.url || "#",
      icon: menu.icon,
      isActive: menu.is_active,
      items: buildMenuTree(allMenus, menu.id, availableIds, orderSource),
    }));
}
