// app/api/permissions/approvals/route.js — Admin → Permissions → Approvals.
//
//   GET → every approval (lib/approvals/catalog.js) with, for each of its
//         rights, who holds it: people and roles (allow), and people denied
//   PUT { code, userIds: [...], roles: [...] }
//       → exactly these people / roles hold the right (allow grants added or
//         removed to match). Personal DENY grants are left alone.
//
// The same grant then controls the approval page, its API, the menu item and
// who is notified (lib/approvals/access.js, lib/approvals/holders.js).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { APPROVALS, approvalCodes } from "@/lib/approvals/catalog";
import { FULL_ACCESS_ROLES } from "@/lib/auth/permissions";
import { activeRoleCodes } from "@/lib/auth/roleCatalog";

// Every active role but Super Admin (who holds every right) — Admin → Roles.
const grantableRoles = async () => (await activeRoleCodes()).filter((r) => !FULL_ACCESS_ROLES.includes(r));

export const GET = guard("permissions.manage", async () => {
  const codes = APPROVALS.flatMap(approvalCodes);
  const [permissions, users] = await Promise.all([
    prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, label: true, grants: { select: { userId: true, role: true, allow: true } } },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const byCode = new Map(permissions.map((p) => [p.code, p]));

  const holders = (code) => {
    const p = byCode.get(code);
    const g = p?.grants ?? [];
    return {
      exists: Boolean(p),
      userIds: g.filter((x) => x.userId && x.allow).map((x) => x.userId),
      roles: g.filter((x) => x.role && x.allow).map((x) => x.role),
      deniedUserIds: g.filter((x) => x.userId && !x.allow).map((x) => x.userId),
    };
  };

  return NextResponse.json({
    approvals: APPROVALS.map((a) => ({
      ...a,
      rights: [{ code: a.permission, label: "Approves / reviews", main: true }, ...(a.rights || [])].map((r) => ({
        ...r,
        ...holders(r.code),
      })),
    })),
    users: users.map((u) => ({ id: u.id, name: u.name || u.email, role: u.role })),
    roles: await grantableRoles(),
    fullAccessRoles: FULL_ACCESS_ROLES,
  });
});

export const PUT = guard("permissions.manage", async (request, { session }) => {
  const { code, userIds = [], roles = [] } = await request.json();
  const known = new Set(APPROVALS.flatMap(approvalCodes));
  if (!known.has(code)) return NextResponse.json({ error: "Not an approval right" }, { status: 400 });

  const permission = await prisma.permission.findUnique({ where: { code }, select: { id: true } });
  if (!permission) {
    return NextResponse.json(
      { error: `Permission ${code} is not in the database yet — run prisma/sql/2026-10-25_phase3_approvals.sql (or node scripts/seed-permissions.mjs --apply).` },
      { status: 409 },
    );
  }
  const wantUsers = new Set(userIds.map(String));
  const grantable = await grantableRoles();
  const wantRoles = new Set(roles.filter((r) => grantable.includes(r)));

  const current = await prisma.permissionGrant.findMany({
    where: { permissionId: permission.id, allow: true },
    select: { id: true, userId: true, role: true },
  });
  const remove = current.filter((g) => (g.userId ? !wantUsers.has(g.userId) : !wantRoles.has(g.role))).map((g) => g.id);
  const haveUsers = new Set(current.filter((g) => g.userId).map((g) => g.userId));
  const haveRoles = new Set(current.filter((g) => g.role).map((g) => g.role));

  await prisma.$transaction([
    prisma.permissionGrant.deleteMany({ where: { id: { in: remove } } }),
    // A person being added who had a personal DENY: the allow replaces it.
    ...[...wantUsers].filter((u) => !haveUsers.has(u)).map((userId) =>
      prisma.permissionGrant.upsert({
        where: { permissionId_userId: { permissionId: permission.id, userId } },
        update: { allow: true, grantedById: session.user.id },
        create: { permissionId: permission.id, userId, allow: true, grantedById: session.user.id },
      }),
    ),
    ...[...wantRoles].filter((r) => !haveRoles.has(r)).map((role) =>
      prisma.permissionGrant.upsert({
        where: { permissionId_role: { permissionId: permission.id, role } },
        update: { allow: true, grantedById: session.user.id },
        create: { permissionId: permission.id, role, allow: true, grantedById: session.user.id },
      }),
    ),
  ]);

  return NextResponse.json({ success: true, message: "Approvers saved" });
});
