// lib/menu/blocks.js — menus taken away from a person or a role (MenuBlock).
//
// A block wins over everything: employee_menu (a parent giving its children),
// a role that shows the whole menu. Blocking a menu blocks every menu under
// it. Super Admin is never blocked — nobody can lock the system out. A block
// on any of the person's roles applies. Managed on Admin → Permissions → Menu access.
//
// Used by: /api/menu/check-permission (page access, via middleware),
// /api/buildMenu (database sidebar), /api/menu/blocks?mine=1 (built-in sidebar).
import prisma from "@/lib/prisma";
import { SUPER_ADMIN } from "@/lib/auth/roles";
import { userRoleCodes } from "@/lib/auth/roleCatalog";

export const NEVER_BLOCKED_ROLES = [SUPER_ADMIN];

export const normalizeUrl = (url) => {
  if (!url || url === "#") return "";
  return String(url).split("?")[0].replace(/\/$/, "").toLowerCase();
};

/** Menu ids blocked for this user (their own blocks + their role's), with every descendant. */
export async function blockedMenuIdsFor(user) {
  if (!user?.id) return new Set();
  const roles = Array.isArray(user.roles) ? user.roles : await userRoleCodes(user.id, user.role);
  if (roles.some((r) => NEVER_BLOCKED_ROLES.includes(r))) return new Set();
  const blocks = await prisma.menuBlock.findMany({
    where: { OR: [{ user_id: String(user.id) }, ...(roles.length ? [{ role: { in: roles } }] : [])] },
    select: { menu_id: true },
  });
  if (!blocks.length) return new Set();

  const all = await prisma.menus.findMany({ select: { id: true, parent_id: true } });
  const children = new Map();
  for (const m of all) {
    if (m.parent_id == null) continue;
    if (!children.has(m.parent_id)) children.set(m.parent_id, []);
    children.get(m.parent_id).push(m.id);
  }
  const out = new Set();
  const stack = blocks.map((b) => b.menu_id);
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) || []) stack.push(c);
  }
  return out;
}

/** Normalised page URLs blocked for this user. */
export async function blockedUrlsFor(user) {
  const ids = await blockedMenuIdsFor(user);
  if (!ids.size) return [];
  const rows = await prisma.menus.findMany({ where: { id: { in: [...ids] } }, select: { url: true } });
  return [...new Set(rows.map((r) => normalizeUrl(r.url)).filter(Boolean))];
}

/** True when this page (or a page above it) is blocked for the user. */
export async function isPathBlocked(user, path) {
  const urls = await blockedUrlsFor(user);
  if (!urls.length) return false;
  const p = normalizeUrl(path);
  return urls.some((u) => p === u || p.startsWith(`${u}/`));
}
