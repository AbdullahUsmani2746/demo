// lib/auth/roleCatalog.js — the role catalogue (app_roles) and a user's roles.
// Server only. Admin → Roles writes it through /api/roles.
import prisma from "@/lib/prisma";
import { SUPER_ADMIN } from "@/lib/auth/roles";

export const ROLE_LEVELS = [
  { id: "system", label: "System" },
  { id: "management", label: "Management" },
  { id: "head", label: "Department heads" },
  { id: "staff", label: "Staff" },
  { id: "self", label: "Self-service" },
];

/** all = the whole menu (Setup → Menu); assigned = the person's Employee menus. */
export const NAV_MODES = ["all", "assigned"];

const TTL_MS = 30 * 1000;
let cache = { at: 0, rows: null };

/** Every role (active and not), sorted. Cached briefly — call invalidateRoles() after a write. */
export async function listRoles() {
  if (cache.rows && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await prisma.appRole.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] });
  cache = { at: Date.now(), rows };
  return rows;
}

export function invalidateRoles() {
  cache = { at: 0, rows: null };
}

export async function activeRoleCodes() {
  return (await listRoles()).filter((r) => r.is_active).map((r) => r.code);
}

export async function roleNameMap() {
  return new Map((await listRoles()).map((r) => [r.code, r.name]));
}

/** "Super Admin", "Sales Officer" … — the code itself when unknown. */
export async function roleName(code) {
  return (await roleNameMap()).get(code) ?? code;
}

/** Role codes of a user: primary first, then the extra ones. */
export async function userRoleCodes(userId, primary) {
  if (!userId) return primary ? [primary] : [];
  let role = primary;
  if (role === undefined) {
    const u = await prisma.user.findUnique({ where: { id: String(userId) }, select: { role: true } });
    role = u?.role;
  }
  const extra = await prisma.userRole.findMany({ where: { user_id: String(userId) }, select: { role_code: true } });
  return [...new Set([role, ...extra.map((e) => e.role_code)].filter(Boolean))];
}

/** Roles of many users at once: Map userId → [codes]. */
export async function roleCodesByUser(users) {
  const ids = users.map((u) => String(u.id));
  const extra = ids.length
    ? await prisma.userRole.findMany({ where: { user_id: { in: ids } }, select: { user_id: true, role_code: true } })
    : [];
  const out = new Map(users.map((u) => [String(u.id), u.role ? [u.role] : []]));
  for (const e of extra) {
    const list = out.get(e.user_id);
    if (list && !list.includes(e.role_code)) list.push(e.role_code);
  }
  return out;
}

/**
 * Which sidebar these roles get: "all" when any active role shows the whole
 * menu (Super Admin always), else "assigned".
 */
export async function navModeFor(codes) {
  if (codes.includes(SUPER_ADMIN)) return "all";
  const roles = await listRoles();
  return roles.some((r) => r.is_active && r.nav_mode === "all" && codes.includes(r.code)) ? "all" : "assigned";
}

/** A session-like subject for a user row — for checks made on someone's behalf. */
export async function subjectForUser(user) {
  const roles = await userRoleCodes(user.id, user.role);
  return { user: { id: String(user.id), role: user.role, roles, email: user.email ?? null } };
}
