// app/api/permissions/route.js
//
// The permission-management API behind /admin/permissions.
//
//   GET  ?userId=…   → catalogue + that user's effective state
//   GET  ?role=…     → catalogue + that role's grants
//   PUT              → set one grant: { permissionId, userId|role, state }
//                      state: "allow" | "deny" | "inherit" (removes the grant)
//   POST { grants }  → set many at once (module-level allow/deny)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { FULL_ACCESS_ROLES } from "@/lib/auth/permissions";
import { listRoles, subjectForUser, userRoleCodes } from "@/lib/auth/roleCatalog";
import { menuPermissionCodes } from "@/lib/auth/menuPermissions";

const STATES = ["allow", "deny", "inherit"];

export const GET = guard("permissions.manage", async (request) => {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") || null;
  const role = searchParams.get("role") || null;

  const [permissions, users] = await Promise.all([
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { sort: "asc" }] }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // The subject's own grants, plus the grants of ALL their roles (and what
  // their Employee menus give) so the screen can show what is inherited rather
  // than only what is explicitly set.
  let ownGrants = [];
  let roleGrants = [];
  let subject = null;
  let fromMenus = new Set();

  if (userId) {
    subject = users.find((u) => u.id === userId) ?? null;
    if (subject) subject = { ...subject, roles: await userRoleCodes(subject.id, subject.role) };
    [ownGrants, roleGrants, fromMenus] = await Promise.all([
      prisma.permissionGrant.findMany({ where: { userId } }),
      subject ? prisma.permissionGrant.findMany({ where: { role: { in: subject.roles } } }) : [],
      subject ? menuPermissionCodes(await subjectForUser(subject)) : new Set(),
    ]);
  } else if (role) {
    ownGrants = await prisma.permissionGrant.findMany({ where: { role } });
  }

  const ownBy = new Map(ownGrants.map((g) => [g.permissionId, g]));
  // Across roles a deny wins (lib/auth/permissions.js resolve()).
  const roleBy = new Map();
  for (const g of roleGrants) {
    const cur = roleBy.get(g.permissionId);
    if (!cur || (cur.allow && !g.allow)) roleBy.set(g.permissionId, g);
  }

  const rows = permissions.map((p) => {
    const own = ownBy.get(p.id);
    const inherited = roleBy.get(p.id);
    return {
      ...p,
      state: own ? (own.allow ? "allow" : "deny") : "inherit",
      constraints: own?.constraints ?? null,
      inherited: inherited ? (inherited.allow ? "allow" : "deny") : fromMenus.has(p.code) ? "allow" : null,
      // "allow" above came from their Employee menus, not a role
      viaMenu: !inherited && fromMenus.has(p.code),
    };
  });

  return NextResponse.json({
    permissions: rows,
    users,
    subject,
    // Full-access roles never consult these tables; the UI says so instead of
    // showing a grid that would have no effect.
    bypass: subject ? subject.roles.some((r) => FULL_ACCESS_ROLES.includes(r)) : FULL_ACCESS_ROLES.includes(role),
    fullAccessRoles: FULL_ACCESS_ROLES,
  });
});

/** Apply one grant change; returns the resulting state. */
async function setGrant({ permissionId, userId, role, state, constraints, grantedById }) {
  if (!permissionId || !STATES.includes(state)) {
    throw new Error("permissionId and a valid state are required");
  }
  if (!userId && !role) throw new Error("Either userId or role is required");
  if (role) {
    if (FULL_ACCESS_ROLES.includes(role)) throw new Error("Super Admin has every permission already.");
    if (!(await listRoles()).some((r) => r.code === role)) throw new Error(`Unknown role "${role}".`);
  }

  const where = userId
    ? { permissionId_userId: { permissionId, userId } }
    : { permissionId_role: { permissionId, role } };

  if (state === "inherit") {
    await prisma.permissionGrant.deleteMany({
      where: userId ? { permissionId, userId } : { permissionId, role },
    });
    return { permissionId, state: "inherit" };
  }

  const allow = state === "allow";
  await prisma.permissionGrant.upsert({
    where,
    create: { permissionId, userId, role, allow, constraints, grantedById },
    update: { allow, constraints, grantedById },
  });
  return { permissionId, state };
}

export const PUT = guard("permissions.manage", async (request, { session }) => {
  const body = await request.json();
  try {
    const result = await setGrant({ ...body, grantedById: session.user.id });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});

export const POST = guard("permissions.manage", async (request, { session }) => {
  const { grants } = await request.json();
  if (!Array.isArray(grants) || grants.length === 0) {
    return NextResponse.json({ error: "grants[] is required" }, { status: 400 });
  }
  try {
    for (const g of grants) {
      await setGrant({ ...g, grantedById: session.user.id });
    }
    return NextResponse.json({ updated: grants.length });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});
