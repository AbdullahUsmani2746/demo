// lib/client-helpers.js
// Where a person lands after sign-in — from what their roles open (the
// session's navMode / areas, Admin → Roles), never a role name.
export function homeFor(user) {
  if (!user) return "/accounting/dashboard"
  if (user.navMode === "all") return "/accounting"
  if ((user.areas || []).includes("pos")) return "/pos"
  return "/accounting/dashboard"
}

/** @deprecated use homeFor(session.user) */
export function redirectByRole(_role, user) {
  return homeFor(user)
}
