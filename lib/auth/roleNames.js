// lib/auth/roleNames.js — role code → its name ("SALES" → "Sales Officer")
// for plain helpers that format text. Filled by hooks/useRoles.js from the
// catalogue (Admin → Roles); until then a code is shown humanised.
const names = new Map();

export function rememberRoleNames(roles) {
  for (const r of roles || []) if (r?.code) names.set(r.code, r.name);
}

const humanize = (code) =>
  String(code || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const roleLabel = (code) => (code ? names.get(code) ?? humanize(code) : "");
