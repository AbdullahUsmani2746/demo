// lib/auth/permissions.js
// ============================================================
// The authorisation engine.
//
// Four layers, in the order a request meets them:
//   1. menus / employee_menu   — may they open the screen?      (pre-existing)
//   2. Permission              — may they perform the action?   (this file)
//   3. FieldPolicy             — may they see / edit the field? (this file)
//   4. DataScope               — which rows may they touch?     (this file)
//
// Super Admin (role ADMIN, lib/auth/roles.js) bypasses all of it,
// unconditionally: the tables are never consulted for them. Everyone else is
// DEFAULT DENY — nothing is permitted until it is granted.
//
// A person holds a primary role (User.role) and maybe more (user_roles);
// every active one counts. Precedence for a permission:
//   user DENY  >  user ALLOW  >  any role DENY  >  any role ALLOW
//     >  their Employee menus (lib/auth/menuPermissions.js)  >  deny
// An explicit deny on the user is the strongest statement available, so a
// single person can be excluded from something their whole role may do.
// ============================================================
import prisma from "@/lib/prisma";
import { isSuperAdmin, rolesOf, SUPER_ADMIN } from "@/lib/auth/roles";
import { activeRoleCodes } from "@/lib/auth/roleCatalog";
import { menuPermissionCodes } from "@/lib/auth/menuPermissions";

/** Roles that bypass every check — Super Admin only. */
export const FULL_ACCESS_ROLES = [SUPER_ADMIN];

export const hasFullAccess = (session) => isSuperAdmin(session);

/** The session's roles that are switched on (Admin → Roles). */
export async function effectiveRoles(session) {
  const mine = rolesOf(session);
  if (!mine.length) return [];
  const active = new Set(await activeRoleCodes());
  return mine.filter((r) => active.has(r));
}

export class ForbiddenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ForbiddenError";
    this.status = 403;
    this.code = code;
  }
}

// ── Permissions ─────────────────────────────────────────────────────────────

/**
 * Resolve one permission for the session.
 * @returns {Promise<{allowed: boolean, constraints: object|null, source?: string}>}
 */
export async function resolve(session, code) {
  if (!session?.user?.id) return { allowed: false, constraints: null };
  if (hasFullAccess(session)) return { allowed: true, constraints: null, source: "superAdmin" };

  const roles = await effectiveRoles(session);
  const permission = await prisma.permission.findUnique({
    where: { code },
    select: {
      id: true,
      grants: {
        where: {
          OR: [{ userId: session.user.id }, ...(roles.length ? [{ role: { in: roles } }] : [])],
        },
        select: { userId: true, role: true, allow: true, constraints: true },
      },
    },
  });

  // A code that is not in the catalogue is denied rather than ignored: an
  // unknown permission means a typo or a missing seed, and silently allowing
  // it would open exactly the action someone meant to protect.
  if (!permission) return { allowed: false, constraints: null };

  const userGrant = permission.grants.find((g) => g.userId === session.user.id);
  if (userGrant) {
    return { allowed: userGrant.allow, constraints: userGrant.constraints ?? null, source: "user" };
  }

  const roleGrants = permission.grants.filter((g) => g.role);
  if (roleGrants.some((g) => !g.allow)) return { allowed: false, constraints: null, source: "role" };
  if (roleGrants.length) {
    // The primary role's limits first, then the others in role order.
    const pick = roles.map((r) => roleGrants.find((g) => g.role === r)).find(Boolean) ?? roleGrants[0];
    return { allowed: true, constraints: pick.constraints ?? null, source: `role:${pick.role}` };
  }

  if ((await menuPermissionCodes(session)).has(code)) return { allowed: true, constraints: null, source: "menu" };

  return { allowed: false, constraints: null };
}

/** Boolean check — use in UI-facing endpoints and conditionals. */
export async function can(session, code) {
  const { allowed } = await resolve(session, code);
  return allowed;
}

/**
 * Whose customers a person may see on the Sales Team MIS and the Sales
 * Targets screen.
 *
 * The default is "only mine": a sales person sees the accounts assigned to
 * them (ACNO.salesArea) and nobody else's. Supervisors who need the whole
 * team hold `salesTeam.viewAll` (management, Sales / Accounts Manager roles,
 * or one person) — a Sales Officer does not, so the sales team cannot read
 * each other's books.
 *
 * Super Admin bypasses, as everywhere else.
 */
export const SALES_TEAM_VIEW_ALL = "salesTeam.viewAll";

export async function canViewAllSalesTeam(session) {
  if (hasFullAccess(session)) return true;
  return can(session, SALES_TEAM_VIEW_ALL);
}

/** Throwing check — use at the top of a mutating route. */
export async function requirePermission(session, code) {
  const { allowed, constraints } = await resolve(session, code);
  if (!allowed) {
    throw new ForbiddenError(
      `You do not have permission to perform this action (${code}).`,
      code,
    );
  }
  return constraints;
}

/**
 * Every permission the session holds, as a Set of codes. One query; used by
 * the UI so a screen can hide what the user cannot do without asking per button.
 */
export async function permissionCodesFor(session) {
  if (!session?.user?.id) return new Set();
  if (hasFullAccess(session)) {
    const all = await prisma.permission.findMany({ select: { code: true } });
    return new Set(all.map((p) => p.code));
  }

  const roles = await effectiveRoles(session);
  const [grants, fromMenus] = await Promise.all([
    prisma.permissionGrant.findMany({
      where: { OR: [{ userId: session.user.id }, ...(roles.length ? [{ role: { in: roles } }] : [])] },
      select: { allow: true, userId: true, permission: { select: { code: true } } },
    }),
    menuPermissionCodes(session),
  ]);

  // Same precedence as resolve(): user grant, then any role deny, then any
  // role allow, then the Employee menus.
  const user = new Map();
  const roleAllow = new Set();
  const roleDeny = new Set();
  for (const g of grants) {
    const code = g.permission.code;
    if (g.userId === session.user.id) user.set(code, g.allow);
    else (g.allow ? roleAllow : roleDeny).add(code);
  }
  const out = new Set();
  for (const code of new Set([...user.keys(), ...roleAllow, ...fromMenus])) {
    if (user.has(code)) {
      if (user.get(code)) out.add(code);
    } else if (!roleDeny.has(code)) out.add(code);
  }
  // Menu codes that are not in the catalogue mean nothing.
  if (fromMenus.size) {
    const known = new Set(
      (await prisma.permission.findMany({ where: { code: { in: [...out] } }, select: { code: true } })).map((p) => p.code),
    );
    return new Set([...out].filter((c) => known.has(c)));
  }
  return out;
}

// ── Constraints ─────────────────────────────────────────────────────────────

/** Refuse an amount above the grant's ceiling. No ceiling = no limit. */
export function assertWithinAmount(constraints, amount, label = "amount") {
  const max = Number(constraints?.maxAmount);
  if (!Number.isFinite(max)) return;
  if (Number(amount) > max) {
    throw new ForbiddenError(
      `This ${label} (${Number(amount).toLocaleString()}) exceeds your approval limit of ${max.toLocaleString()}.`,
    );
  }
}

/** Refuse a document dated further back than the grant allows. */
export function assertWithinBackdate(constraints, dated) {
  const days = Number(constraints?.backdateDays);
  if (!Number.isFinite(days)) return;
  const d = new Date(dated);
  if (isNaN(d.getTime())) return;
  const oldest = new Date();
  oldest.setHours(0, 0, 0, 0);
  oldest.setDate(oldest.getDate() - days);
  if (d < oldest) {
    throw new ForbiddenError(
      `You may not post a document dated more than ${days} day(s) back.`,
    );
  }
}

// ── Field policy ────────────────────────────────────────────────────────────

const ACCESS = { HIDDEN: "HIDDEN", READONLY: "READONLY", EDIT: "EDIT" };

/**
 * Field access map for one entity: { fieldName: "HIDDEN"|"READONLY" }.
 * Fields with no policy are editable, so only the exceptions are stored.
 */
export async function fieldPolicyFor(session, entity) {
  if (!session?.user?.id || hasFullAccess(session)) return {};

  const roles = await effectiveRoles(session);
  const rows = await prisma.fieldPolicy.findMany({
    where: {
      entity,
      OR: [{ userId: session.user.id }, ...(roles.length ? [{ role: { in: roles } }] : [])],
    },
    select: { field: true, access: true, userId: true },
  });

  // User-level policy wins; among roles the most open one does (a person
  // holding two roles gets what either role may see / edit).
  const OPEN = { HIDDEN: 0, READONLY: 1, EDIT: 2 };
  const map = {};
  const mine = {};
  for (const r of rows) {
    if (r.userId === session.user.id) mine[r.field] = r.access;
    else if (map[r.field] === undefined || OPEN[r.access] > OPEN[map[r.field]]) map[r.field] = r.access;
  }
  return Object.fromEntries(
    Object.entries({ ...map, ...mine }).filter(([, a]) => a !== ACCESS.EDIT),
  );
}

/**
 * Strip fields the session may not write, and refuse outright when it tried.
 * Returns the cleaned object. `throwOnAttempt` false silently drops instead.
 */
export async function applyFieldPolicy(session, entity, data, { throwOnAttempt = true } = {}) {
  const policy = await fieldPolicyFor(session, entity);
  const blocked = Object.keys(data || {}).filter(
    (k) => policy[k] === ACCESS.HIDDEN || policy[k] === ACCESS.READONLY,
  );
  if (blocked.length === 0) return data;
  if (throwOnAttempt) {
    throw new ForbiddenError(
      `You may not change: ${blocked.join(", ")}.`,
    );
  }
  const clean = { ...data };
  for (const k of blocked) delete clean[k];
  return clean;
}

export { ACCESS };
