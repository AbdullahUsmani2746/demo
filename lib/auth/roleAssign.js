// lib/auth/roleAssign.js — giving people roles (Admin → Users, Admin → Roles,
// Employees → login). One set of rules wherever roles are assigned:
//   • only active roles from the catalogue (app_roles)
//   • only a Super Admin gives or takes away Super Admin
//   • the last active Super Admin keeps it — the system is never locked out
import prisma from "@/lib/prisma";
import { isSuperAdmin, SUPER_ADMIN } from "@/lib/auth/roles";
import { invalidateRoles, listRoles, userRoleCodes } from "@/lib/auth/roleCatalog";

export class RoleAssignError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clean = (codes) => [...new Set((codes || []).filter(Boolean).map((c) => String(c).trim().toUpperCase()))];

async function activeSuperAdminCount(exceptUserId) {
  return prisma.user.count({
    where: {
      isActive: true,
      ...(exceptUserId ? { id: { not: String(exceptUserId) } } : {}),
      OR: [{ role: SUPER_ADMIN }, { extraRoles: { some: { role_code: SUPER_ADMIN } } }],
    },
  });
}

/**
 * Check a role change. `primary` / `extra` = the user's roles after the
 * change (extra excludes primary). `userId` null = a new user.
 * @returns {{ primary: string, extra: string[] }}
 */
export async function checkRoleChange({ session, userId = null, primary, extra = [], active = true, limitLevels = null }) {
  invalidateRoles();
  const roles = await listRoles();
  const known = new Map(roles.map((r) => [r.code, r]));
  const p = String(primary || "").trim().toUpperCase();
  if (!p) throw new RoleAssignError("Pick the person's role.");
  const x = clean(extra).filter((c) => c !== p);
  for (const c of [p, ...x]) {
    const r = known.get(c);
    if (!r) throw new RoleAssignError(`Unknown role "${c}".`);
    if (!r.is_active) throw new RoleAssignError(`The role "${r.name}" is switched off (Admin → Roles).`);
  }

  const before = userId ? await userRoleCodes(userId) : [];
  // A role newly given by someone limited to some levels (e.g. HR giving an
  // employee a login: staff / self-service roles only).
  if (limitLevels) {
    const added = [p, ...x].filter((c) => !before.includes(c));
    const bad = added.map((c) => known.get(c)).find((r) => !limitLevels.includes(r.level));
    if (bad) throw new RoleAssignError(`You may not give the role "${bad.name}" — ask someone who manages users.`, 403);
  }
  const wasSuper = before.includes(SUPER_ADMIN);
  const willSuper = p === SUPER_ADMIN || x.includes(SUPER_ADMIN);
  if ((wasSuper !== willSuper || (wasSuper && !active)) && !isSuperAdmin(session)) {
    throw new RoleAssignError("Only a Super Admin can give or take away Super Admin, or switch a Super Admin off.", 403);
  }
  if (wasSuper && (!willSuper || !active) && (await activeSuperAdminCount(userId)) === 0) {
    throw new RoleAssignError("This is the last active Super Admin — make someone else Super Admin first.", 409);
  }
  return { primary: p, extra: x };
}

/**
 * Levels a person may give through an Employee's login: every level with
 * users.manage, staff / self-service roles otherwise.
 */
export async function assignableLevels(session) {
  const { can } = await import("@/lib/auth/permissions");
  return (await can(session, "users.manage")) ? null : ["staff", "self"];
}

/** Replace a user's extra roles (user_roles). `client` = a transaction when inside one. */
export async function saveExtraRoles(userId, extra, actorId, client = prisma) {
  const id = String(userId);
  const current = (await client.userRole.findMany({ where: { user_id: id }, select: { role_code: true } })).map((r) => r.role_code);
  const remove = current.filter((c) => !extra.includes(c));
  const add = extra.filter((c) => !current.includes(c));
  if (remove.length) await client.userRole.deleteMany({ where: { user_id: id, role_code: { in: remove } } });
  if (add.length) {
    await client.userRole.createMany({
      data: add.map((role_code) => ({ user_id: id, role_code, created_by: actorId ?? null })),
      skipDuplicates: true,
    });
  }
}

/** A role-assignment error as a JSON response body + status, or null. */
export function roleAssignErrorResponse(e) {
  return e instanceof RoleAssignError ? { body: { error: e.message }, status: e.status } : null;
}
