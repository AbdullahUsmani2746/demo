// lib/auth/roles.js — who holds which role. Pure (no Prisma), so the edge
// middleware and client components can use it too.
//
// Roles are data (app_roles, Admin → Roles). A user has a PRIMARY role
// (User.role) and may hold more (user_roles); the session carries all of
// them as session.user.roles, primary first. Only Super Admin (code ADMIN)
// skips the permission checks — never decide access by any other role name
// in code: use a permission code (lib/auth/permissions.js) instead.

/** The one role that bypasses every check. */
export const SUPER_ADMIN = "ADMIN";

/** Every role code of a session / token / user row ({ role, roles }). */
export function rolesOf(subject) {
  const u = subject?.user ?? subject;
  if (!u) return [];
  const list = Array.isArray(u.roles) && u.roles.length ? u.roles : u.role ? [u.role] : [];
  return [...new Set(list.filter(Boolean).map(String))];
}

export const hasRole = (subject, code) => rolesOf(subject).includes(code);

export const hasAnyRole = (subject, codes) => {
  const mine = rolesOf(subject);
  return (codes || []).some((c) => mine.includes(c));
};

/** Super Admin: full access, never blocked, may decide their own requests. */
export const isSuperAdmin = (subject) => hasRole(subject, SUPER_ADMIN);

/**
 * Prisma `where` on User for "holds any of these roles" — primary or extra.
 * e.g. prisma.user.findMany({ where: { isActive: true, ...usersWithRoles(codes) } })
 */
export function usersWithRoles(codes) {
  const list = [...new Set((codes || []).filter(Boolean).map(String))];
  if (!list.length) return { id: { in: [] } };
  return { OR: [{ role: { in: list } }, { extraRoles: { some: { role_code: { in: list } } } }] };
}
