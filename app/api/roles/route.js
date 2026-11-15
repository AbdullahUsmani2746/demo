// /api/roles — the role catalogue (Admin → Roles). lib/auth/roleCatalog.js
//
//   GET                    every signed-in user: code, name, level, sidebar
//                          (pickers and labels). With permissions.manage also
//                          how many people hold each role and how many
//                          permissions it has.
//   POST { name, description, level, nav_mode, copy_from? }
//                          permissions.manage — a new role (code from the
//                          name); copy_from copies that role's permissions
//                          and menu blocks.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { SUPER_ADMIN } from "@/lib/auth/roles";
import {
  invalidateRoles,
  listRoles,
  NAV_MODES,
  ROLE_LEVELS,
} from "@/lib/auth/roleCatalog";

const LEVEL_IDS = ROLE_LEVELS.map((l) => l.id);

export const GET = guard(null, async (_req, { session }) => {
  const roles = await listRoles();
  const manage = await can(session, "permissions.manage");
  let counts = null;
  if (manage) {
    const [primary, extra, grants] = await Promise.all([
      prisma.user.groupBy({
        by: ["role"],
        where: { isActive: true },
        _count: { _all: true },
      }),
      prisma.userRole.groupBy({
        by: ["role_code"],
        where: { user: { isActive: true } },
        _count: { _all: true },
      }),
      prisma.permissionGrant.groupBy({
        by: ["role"],
        where: { role: { not: null }, allow: true },
        _count: { _all: true },
      }),
    ]);
    counts = new Map(roles.map((r) => [r.code, { users: 0, permissions: 0 }]));
    for (const g of primary)
      if (counts.has(g.role)) counts.get(g.role).users += g._count._all;
    for (const g of extra)
      if (counts.has(g.role_code))
        counts.get(g.role_code).users += g._count._all;
    for (const g of grants)
      if (counts.has(g.role)) counts.get(g.role).permissions = g._count._all;
  }
  return NextResponse.json({
    roles: roles.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      level: r.level,
      nav_mode: r.nav_mode,
      is_system: r.is_system,
      is_active: r.is_active,
      sort: r.sort,
      super_admin: r.code === SUPER_ADMIN,
      ...(counts ? counts.get(r.code) : {}),
    })),
    levels: ROLE_LEVELS,
    canManage: manage,
  });
});

const codeFromName = (name) =>
  String(name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);

export const POST = guard("permissions.manage", async (req, { session }) => {
  const b = await req.json();
  const name = String(b.name || "")
    .trim()
    .slice(0, 80);
  if (!name)
    return NextResponse.json(
      { error: "Give the role a name." },
      { status: 400 },
    );
  const code = codeFromName(b.code || name);
  if (!code)
    return NextResponse.json(
      { error: "The name needs letters or numbers." },
      { status: 400 },
    );
  if (await prisma.appRole.findUnique({ where: { code } })) {
    return NextResponse.json(
      { error: `A role with the code ${code} exists already.` },
      { status: 409 },
    );
  }
  const level =
    LEVEL_IDS.includes(b.level) && b.level !== "system" ? b.level : "staff";
  const nav_mode = NAV_MODES.includes(b.nav_mode) ? b.nav_mode : "assigned";
  const from = b.copy_from
    ? await prisma.appRole.findUnique({ where: { code: String(b.copy_from) } })
    : null;
  if (b.copy_from && (!from || from.code === SUPER_ADMIN)) {
    return NextResponse.json(
      { error: "Copy from: pick an ordinary role." },
      { status: 400 },
    );
  }
  const last = await prisma.appRole.aggregate({
    _max: { sort: true },
    where: { level },
  });

  await prisma.appRole.create({
    data: {
      code,
      name,
      description: b.description
        ? String(b.description).trim().slice(0, 300) || null
        : null,
      level,
      nav_mode,
      sort: (last._max.sort ?? 0) + 1,
      created_by: session.user.id,
    },
  });
  if (from) {
    const [grants, blocks] = await Promise.all([
      prisma.permissionGrant.findMany({
        where: { role: from.code },
        select: { permissionId: true, allow: true, constraints: true },
      }),
      prisma.menuBlock.findMany({
        where: { role: from.code },
        select: { menu_id: true },
      }),
    ]);
    if (grants.length) {
      await prisma.permissionGrant.createMany({
        data: grants.map((g) => ({
          ...g,
          constraints: g.constraints ?? undefined,
          role: code,
          grantedById: session.user.id,
        })),
        skipDuplicates: true,
      });
    }
    if (blocks.length) {
      await prisma.menuBlock.createMany({
        data: blocks.map((m) => ({
          menu_id: m.menu_id,
          role: code,
          created_by: session.user.id,
        })),
        skipDuplicates: true,
      });
    }
  }
  invalidateRoles();
  return NextResponse.json(
    {
      code,
      message: from
        ? `Role "${name}" created with ${from.name}'s permissions.`
        : `Role "${name}" created.`,
    },
    { status: 201 },
  );
});
