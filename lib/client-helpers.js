// lib/client-helpers.js
// Where a person lands after sign-in — from what their roles open (the
// session's navMode / areas, Admin → Roles), never a role name.
export function homeFor(user) {
  if (!user) return "/accounting/dashboard"
  if (user.navMode === "all") return "/accounting"
  if (user.till) return "/pos" // works the till (role grants pos.sell) — lib/auth/sessionGuard.js
  // Everyone else works from their own screens (Employee menus): the
  // Applications launcher lists exactly those. /accounting/dashboard is a
  // MANAGEMENT screen — sending staff there landed them on "no access".
  return "/accounting/apps"
}

/** @deprecated use homeFor(session.user) */
export function redirectByRole(_role, user) {
  return homeFor(user)
}
