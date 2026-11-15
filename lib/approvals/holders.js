// lib/approvals/holders.js — who holds a permission, by person OR by role.
//
// Used to decide who is TOLD about something (approval needed, follow-ups):
// every active user granted the code personally, plus every active user whose
// role is granted it — minus anyone personally denied it (a personal deny
// beats the role, as in lib/auth/permissions.js).
//
// A role counts whether it is the person's main role or an extra one.
// Super Admin passes every permission check without a grant, but is
// NOT notified unless granted explicitly — otherwise every admin would get
// every approval request.
//
// Takes the Prisma client as an argument and imports nothing that loads
// Prisma: the notification handlers call it, and they must not import
// lib/prisma (cycle). lib/auth/roles.js is pure.
import { usersWithRoles } from "@/lib/auth/roles";

/**
 * @param prisma  a Prisma client (the base client inside notification handlers)
 * @param code    permission code, e.g. "saleOrder.approve"
 * @returns {Promise<string[]>} User ids
 */
export async function permissionHolderIds(prisma, code) {
  const grants = await prisma.permissionGrant.findMany({
    where: { permission: { code } },
    select: { userId: true, role: true, allow: true },
  });
  const allowUsers = grants.filter((g) => g.userId && g.allow).map((g) => g.userId);
  const denyUsers = new Set(grants.filter((g) => g.userId && !g.allow).map((g) => g.userId));
  const allowRoles = grants.filter((g) => g.role && g.allow).map((g) => g.role);

  const or = [];
  if (allowUsers.length) or.push({ id: { in: allowUsers } });
  if (allowRoles.length) or.push(usersWithRoles(allowRoles));
  if (!or.length) return [];

  const users = await prisma.user.findMany({
    where: { isActive: true, OR: or },
    select: { id: true },
  });
  return users.map((u) => u.id).filter((id) => !denyUsers.has(id));
}
