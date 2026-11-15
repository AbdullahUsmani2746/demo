// lib/auth/sessionGuard.js
// ============================================================
// Is this user still allowed to be signed in?
//
// The reason this exists: isActive used to be checked only inside
// authorize(), i.e. at sign-in. With a 30-day JWT that meant deactivating
// someone left them with full access for up to a month, and changing their
// role left the old role in the token for just as long.
//
// evaluateAccess() is therefore called BOTH at sign-in and again from the
// jwt callback every REVALIDATE_AFTER_MS, so a change in the database takes
// effect within a minute without a database hit on every single request.
// ============================================================
import prisma from "@/lib/prisma";
import { navModeFor, userRoleCodes } from "@/lib/auth/roleCatalog";
import { isSuperAdmin } from "@/lib/auth/roles";

/**
 * Areas the edge middleware gates (it cannot read the database): a path
 * prefix → the permission codes, any one of which opens it.
 */
export const AREA_PERMISSIONS = {
  admin: ["users.manage", "permissions.manage", "menus.manage", "settings.manage", "notification.manage"],
  pos: ["pos.manage"],
};

async function areasFor(subject) {
  if (isSuperAdmin(subject)) return Object.keys(AREA_PERMISSIONS);
  // Imported here: permissions.js → roleCatalog → prisma; keeps this module light.
  const { can } = await import("@/lib/auth/permissions");
  const out = [];
  for (const [area, codes] of Object.entries(AREA_PERMISSIONS)) {
    for (const code of codes) {
      if (await can(subject, code)) {
        out.push(area);
        break;
      }
    }
  }
  return out;
}

/** How stale a token's copy of the user may get. */
export const REVALIDATE_AFTER_MS = 60 * 1000; // 60 seconds

/** Sliding session length — the clock resets on activity. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

/**
 * Users with no menus are blocked only when this setting is "true".
 * It ships OFF because users who are not linked to an Employee record have
 * no menus by definition and would be locked out the moment it is enabled.
 * Link them (or grant menus) first, then switch it on.
 */
export const BLOCK_WITHOUT_MENUS_KEY = "block_users_without_menus";

async function blockWithoutMenusEnabled() {
  try {
    const row = await prisma.settings.findUnique({
      where: { key: BLOCK_WITHOUT_MENUS_KEY },
      select: { value: true },
    });
    return row?.value === "true";
  } catch {
    return false; // never lock people out because a setting could not be read
  }
}

/**
 * Decide whether a user may hold a session, and return the fields the token
 * must carry. One query plus (optionally) a menu count.
 *
 * @returns {Promise<{ok: true, user: {...}} | {ok: false, reason: string}>}
 */
export async function evaluateAccess(userId) {
  if (!userId) return { ok: false, reason: "No user" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      role: true,
      isActive: true,
      image: true,
      employeeId: true,
      employee: { select: { status: true } },
    },
  });

  if (!user) return { ok: false, reason: "Account no longer exists" };
  if (!user.isActive) return { ok: false, reason: "Account is deactivated" };

  // An employee marked INACTIVE by HR (resigned / terminated) loses access
  // even if nobody remembered to switch off the user account.
  if (user.employee && user.employee.status !== "ACTIVE") {
    return { ok: false, reason: "Employee record is inactive" };
  }

  if (await blockWithoutMenusEnabled()) {
    const menuCount = user.employeeId
      ? await prisma.employee_menu.count({ where: { employee_id: user.employeeId } })
      : 0;
    if (menuCount === 0) {
      return { ok: false, reason: "No screens are assigned to this account" };
    }
  }

  // Every role (primary first), the sidebar they get and the areas they may
  // open — so a role change reaches the token within REVALIDATE_AFTER_MS.
  const roles = await userRoleCodes(user.id, user.role);
  const subject = { user: { id: user.id, role: user.role, roles, employeeId: user.employeeId, email: user.email } };
  const [navMode, areas] = await Promise.all([navModeFor(roles), areasFor(subject)]);

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      roles,
      navMode,
      areas,
      image: user.image,
      employeeId: user.employeeId,
    },
  };
}
