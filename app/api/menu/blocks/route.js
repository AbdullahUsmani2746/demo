// app/api/menu/blocks/route.js — Admin → Permissions → Menu access.
//
//   GET ?mine=1          → { urls } blocked for the signed-in person (any user;
//                          the built-in sidebar hides them)
//   GET ?userId= | ?role= → { tree, blocked, viaRole, given, subject }  (permissions.manage)
//        blocked  menu ids blocked for this subject directly
//        viaRole  (person only) menu ids their role blocks
//        given    (person only) menu ids their employee_menu gives them
//   PUT { menuId, userId | role, blocked }  → add / remove one block (permissions.manage)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { blockedUrlsFor, NEVER_BLOCKED_ROLES } from "@/lib/menu/blocks";
import { listRoles, userRoleCodes } from "@/lib/auth/roleCatalog";

// Every active role but Super Admin (never blocked) — Admin → Roles.
async function blockableRoles() {
  return (await listRoles()).filter((r) => r.is_active && !NEVER_BLOCKED_ROLES.includes(r.code));
}

function tree(rows) {
  const byParent = new Map();
  for (const m of rows) {
    const k = m.parent_id ?? 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(m);
  }
  const ids = new Set(rows.map((m) => m.id));
  const build = (pid) =>
    (byParent.get(pid) || [])
      .sort((a, b) => a.order_no - b.order_no || a.title.localeCompare(b.title))
      .map((m) => ({ id: m.id, title: m.title, url: m.url, children: build(m.id) }));
  // roots: no parent, or a parent that is not active
  const roots = rows.filter((m) => m.parent_id == null || !ids.has(m.parent_id)).map((m) => m.id);
  const rootSet = new Set(roots);
  return rows
    .filter((m) => rootSet.has(m.id))
    .sort((a, b) => a.order_no - b.order_no || a.title.localeCompare(b.title))
    .map((m) => ({ id: m.id, title: m.title, url: m.url, children: build(m.id) }));
}

async function allMenuIdsForEmployee(employeeId) {
  const direct = await prisma.employee_menu.findMany({ where: { employee_id: employeeId }, select: { menu_id: true } });
  const out = new Set(direct.map((d) => d.menu_id));
  let frontier = [...out];
  while (frontier.length) {
    const kids = await prisma.menus.findMany({ where: { parent_id: { in: frontier } }, select: { id: true } });
    frontier = kids.map((k) => k.id).filter((id) => !out.has(id));
    frontier.forEach((id) => out.add(id));
  }
  return out;
}

export const GET = guard(null, async (req, { session }) => {
  const url = new URL(req.url);
  if (url.searchParams.get("mine")) {
    return NextResponse.json({ urls: await blockedUrlsFor(session.user) });
  }
  if (!(await can(session, "permissions.manage"))) {
    return NextResponse.json({ error: "permissions.manage required" }, { status: 403 });
  }

  const userId = url.searchParams.get("userId");
  const role = url.searchParams.get("role");
  const roleRows = await blockableRoles();
  const ROLES = roleRows.map((r) => r.code);
  const [menus, users] = await Promise.all([
    prisma.menus.findMany({ where: { is_active: true }, select: { id: true, title: true, url: true, parent_id: true, order_no: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
  ]);

  let subject = null;
  let blocked = [];
  let viaRole = [];
  let given = null;
  if (userId) {
    const u = users.find((x) => x.id === userId);
    if (u) {
      const roles = await userRoleCodes(u.id, u.role);
      subject = { type: "user", id: u.id, name: u.name || u.email, role: u.role, roles, locked: roles.some((r) => NEVER_BLOCKED_ROLES.includes(r)) };
      const [own, roleBlocks, emp] = await Promise.all([
        prisma.menuBlock.findMany({ where: { user_id: u.id }, select: { menu_id: true } }),
        prisma.menuBlock.findMany({ where: { role: { in: roles } }, select: { menu_id: true } }),
        prisma.employee.findUnique({ where: { emailAddress: u.email }, select: { id: true } }).catch(() => null),
      ]);
      blocked = own.map((b) => b.menu_id);
      viaRole = roleBlocks.map((b) => b.menu_id);
      given = emp ? [...(await allMenuIdsForEmployee(emp.id))] : [];
    }
  } else if (role && ROLES.includes(role)) {
    subject = { type: "role", id: role, name: roleRows.find((r) => r.code === role)?.name ?? role };
    blocked = (await prisma.menuBlock.findMany({ where: { role }, select: { menu_id: true } })).map((b) => b.menu_id);
  }

  return NextResponse.json({
    tree: tree(menus),
    subject,
    blocked,
    viaRole,
    given,
    users: users.filter((u) => !NEVER_BLOCKED_ROLES.includes(u.role)).map((u) => ({ id: u.id, name: u.name || u.email, role: u.role })),
    roles: ROLES,
    roleNames: Object.fromEntries(roleRows.map((r) => [r.code, r.name])),
  });
});

export const PUT = guard("permissions.manage", async (req, { session }) => {
  const { menuId, userId = null, role = null, blocked } = await req.json();
  const menu_id = Number(menuId);
  if (!menu_id || (!userId && !role) || (userId && role)) {
    return NextResponse.json({ error: "menuId and exactly one of userId / role are required" }, { status: 400 });
  }
  if (role && !(await blockableRoles()).some((r) => r.code === role)) return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if ((await userRoleCodes(u.id, u.role)).some((r) => NEVER_BLOCKED_ROLES.includes(r))) {
      return NextResponse.json({ error: "A Super Admin is never blocked." }, { status: 400 });
    }
  }
  const where = userId ? { menu_id, user_id: userId } : { menu_id, role };
  if (blocked) {
    const exists = await prisma.menuBlock.findFirst({ where, select: { id: true } });
    if (!exists) await prisma.menuBlock.create({ data: { ...where, created_by: session.user.id } });
  } else {
    await prisma.menuBlock.deleteMany({ where });
  }
  return NextResponse.json({ success: true });
});
