// /api/roles/[code] — one role (Admin → Roles). permissions.manage.
//
//   GET     the role, the people holding it (primary or extra) and the
//           permission codes it grants
//   PUT     { name, description, level, nav_mode, is_active, sort }
//           Super Admin and Employee cannot be switched off; Super Admin's
//           level / sidebar never change.
//   DELETE  only a role nobody holds and not built-in — its permissions and
//           menu blocks go with it. Otherwise switch it off.
//   POST    { action: "addMember" | "removeMember" | "makePrimary", user_id }
//           extra roles of a person (user_roles); the primary role is
//           changed with makePrimary or on Admin → Users. Same rules as
//           everywhere (lib/auth/roleAssign.js).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { SUPER_ADMIN, usersWithRoles } from "@/lib/auth/roles";
import { invalidateRoles, NAV_MODES, ROLE_LEVELS, roleCodesByUser, userRoleCodes } from "@/lib/auth/roleCatalog";
import { checkRoleChange, roleAssignErrorResponse, saveExtraRoles } from "@/lib/auth/roleAssign";

const LEVEL_IDS = ROLE_LEVELS.map((l) => l.id);

async function loadRole(params) {
  const code = String((await params).code || "").toUpperCase();
  return prisma.appRole.findUnique({ where: { code } });
}

export const GET = guard("permissions.manage", async (_req, { params }) => {
  const role = await loadRole(params);
  if (!role) return NextResponse.json({ error: "Role not found." }, { status: 404 });
  const [users, grants] = await Promise.all([
    prisma.user.findMany({
      where: usersWithRoles([role.code]),
      select: { id: true, name: true, email: true, role: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.permissionGrant.findMany({
      where: { role: role.code },
      select: { allow: true, permission: { select: { code: true, label: true, module: true } } },
    }),
  ]);
  const rolesBy = await roleCodesByUser(users);
  return NextResponse.json({
    role,
    members: users.map((u) => ({
      id: u.id,
      name: u.name || u.email,
      email: u.email,
      active: u.isActive,
      primary: u.role === role.code,
      roles: rolesBy.get(String(u.id)),
    })),
    permissions: grants
      .map((g) => ({ ...g.permission, allow: g.allow }))
      .sort((a, b) => a.module.localeCompare(b.module) || a.code.localeCompare(b.code)),
  });
});

export const PUT = guard("permissions.manage", async (req, { params }) => {
  const role = await loadRole(params);
  if (!role) return NextResponse.json({ error: "Role not found." }, { status: 404 });
  const b = await req.json();
  const data = {};
  if (b.name !== undefined) {
    const name = String(b.name).trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "Give the role a name." }, { status: 400 });
    data.name = name;
  }
  if (b.description !== undefined) data.description = String(b.description || "").trim().slice(0, 300) || null;
  if (b.sort !== undefined && Number.isInteger(Number(b.sort))) data.sort = Number(b.sort);
  if (role.code !== SUPER_ADMIN) {
    if (b.level !== undefined) {
      if (!LEVEL_IDS.includes(b.level)) return NextResponse.json({ error: "Unknown level." }, { status: 400 });
      data.level = b.level;
    }
    if (b.nav_mode !== undefined) {
      if (!NAV_MODES.includes(b.nav_mode)) return NextResponse.json({ error: "Unknown sidebar." }, { status: 400 });
      data.nav_mode = b.nav_mode;
    }
  }
  if (b.is_active !== undefined) {
    if (role.is_system && !b.is_active) {
      return NextResponse.json({ error: `${role.name} is built in and cannot be switched off.` }, { status: 400 });
    }
    data.is_active = !!b.is_active;
  }
  await prisma.appRole.update({ where: { code: role.code }, data });
  invalidateRoles();
  return NextResponse.json({ message: `Role "${data.name ?? role.name}" saved.` });
});

export const DELETE = guard("permissions.manage", async (_req, { params }) => {
  const role = await loadRole(params);
  if (!role) return NextResponse.json({ error: "Role not found." }, { status: 404 });
  if (role.is_system) return NextResponse.json({ error: `${role.name} is built in and cannot be deleted.` }, { status: 400 });
  const holders = await prisma.user.count({ where: usersWithRoles([role.code]) });
  if (holders) {
    return NextResponse.json(
      { error: `${holders} person(s) hold "${role.name}" — move them to another role first, or switch the role off.` },
      { status: 409 },
    );
  }
  await prisma.permissionGrant.deleteMany({ where: { role: role.code } });
  await prisma.menuBlock.deleteMany({ where: { role: role.code } });
  await prisma.appRole.delete({ where: { code: role.code } });
  invalidateRoles();
  return NextResponse.json({ message: `Role "${role.name}" deleted.` });
});

export const POST = guard("permissions.manage", async (req, { params, session }) => {
  const role = await loadRole(params);
  if (!role) return NextResponse.json({ error: "Role not found." }, { status: 404 });
  const { action, user_id } = await req.json();
  const user = user_id ? await prisma.user.findUnique({ where: { id: String(user_id) }, select: { id: true, role: true, isActive: true, name: true, email: true } }) : null;
  if (!user) return NextResponse.json({ error: "Pick the person." }, { status: 400 });
  const current = await userRoleCodes(user.id, user.role);
  let primary = user.role;
  let extra = current.slice(1);
  if (action === "addMember") {
    if (current.includes(role.code)) return NextResponse.json({ error: "They hold this role already." }, { status: 409 });
    extra = [...extra, role.code];
  } else if (action === "removeMember") {
    if (user.role === role.code) {
      return NextResponse.json({ error: "This is their main role — give them another main role first (Make main on another role, or Admin → Users)." }, { status: 400 });
    }
    extra = extra.filter((c) => c !== role.code);
  } else if (action === "makePrimary") {
    extra = [...extra.filter((c) => c !== role.code), ...(primary && primary !== role.code ? [primary] : [])];
    primary = role.code;
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  try {
    ({ primary, extra } = await checkRoleChange({ session, userId: user.id, primary, extra, active: user.isActive }));
  } catch (e) {
    const r = roleAssignErrorResponse(e);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw e;
  }
  if (primary !== user.role) await prisma.user.update({ where: { id: user.id }, data: { role: primary } });
  await saveExtraRoles(user.id, extra, session.user.id);
  const who = user.name || user.email;
  const msg = {
    addMember: `${who} now also holds ${role.name}.`,
    removeMember: `${role.name} taken away from ${who}.`,
    makePrimary: `${role.name} is now ${who}'s main role.`,
  }[action];
  return NextResponse.json({ message: `${msg} It applies within a minute.` });
});
