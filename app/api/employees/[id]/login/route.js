// /api/employees/[id]/login — the employee's login and roles (Employee screen →
// Login & Roles). Logins belong to employees; Admin → Logins & Roles keeps the
// few without one (Super Admin, auditors).
//
// Who: users.manage (any role), or employee.manage (staff / self-service roles
// only — lib/auth/roleAssign.js assignableLevels). Role rules (catalogue only,
// Super Admin only by a Super Admin, the last Super Admin keeps it) are
// checkRoleChange's. Every write goes through lib/prisma.js (audited).
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { can } from "@/lib/auth/permissions";
import { setAuditActor } from "@/lib/audit/context";
import { findLinkedUser, loginConflict, prismaErrorResponse } from "@/lib/employees";
import { userRoleCodes } from "@/lib/auth/roleCatalog";
import { assignableLevels, checkRoleChange, roleAssignErrorResponse, saveExtraRoles } from "@/lib/auth/roleAssign";

async function access(session) {
  if (!session?.user?.id) return null;
  const all = await can(session, "users.manage");
  if (all) return { all: true };
  return (await can(session, "employee.manage")) ? { all: false } : null;
}

async function loadLogin(employee) {
  const u = await findLinkedUser(prisma, employee);
  if (!u) return null;
  const roles = await userRoleCodes(u.id, u.role);
  return { id: u.id, username: u.username, email: u.email, role: u.role, roles, isActive: u.isActive, linked: u.employeeId === employee.id, createdAt: u.createdAt };
}

export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  const who = await access(session);
  if (!who) return NextResponse.json({ error: "You may not see employees' logins (users.manage or employee.manage)." }, { status: 403 });
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id: Number(id) }, select: { id: true, emailAddress: true, firstName: true, surname: true } });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const login = await loadLogin(employee);
  // Logins without an employee that could be linked (users.manage only).
  const linkable = !login && who.all
    ? await prisma.user.findMany({ where: { employeeId: null }, select: { id: true, name: true, username: true, email: true }, orderBy: { name: "asc" }, take: 500 })
    : [];
  return NextResponse.json({
    login,
    linkable,
    meta: { manageAll: who.all, levels: who.all ? null : await assignableLevels(session), superAdmin: !!session.user.superAdmin },
  });
}

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    const who = await access(session);
    if (!who) return NextResponse.json({ error: "You may not change employees' logins (users.manage or employee.manage)." }, { status: 403 });
    setAuditActor(session);

    const { id } = await params;
    const employeeId = Number(id);
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

    const body = await req.json();
    const current = await findLinkedUser(prisma, employee);

    // Link an existing login that has no employee yet.
    if (body.linkUserId && !current) {
      if (!who.all) return NextResponse.json({ error: "Only someone who manages users may link an existing login." }, { status: 403 });
      const u = await prisma.user.findUnique({ where: { id: String(body.linkUserId) }, select: { id: true, employeeId: true } });
      if (!u) return NextResponse.json({ error: "Login not found" }, { status: 404 });
      if (u.employeeId != null) return NextResponse.json({ error: "That login already belongs to another employee" }, { status: 409 });
      await prisma.user.update({ where: { id: u.id }, data: { employeeId } });
      return NextResponse.json({ login: await loadLogin(employee), message: "Login linked to this employee" });
    }

    const username = body.username === undefined ? undefined : body.username ? String(body.username).trim() : null;
    const email = body.email ? String(body.email).trim() : undefined;
    const password = body.password ? String(body.password) : null;
    const isActive = typeof body.isActive === "boolean" ? body.isActive : undefined;

    if (username && (username.includes("@") || username.length > 25)) {
      return NextResponse.json({ error: "Username: up to 25 characters, no @ sign" }, { status: 400 });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid login email" }, { status: 400 });
    if (password && password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    if (current && isActive === false && current.id === session.user.id) {
      return NextResponse.json({ error: "You cannot switch off your own login" }, { status: 400 });
    }

    const before = current ? await userRoleCodes(current.id, current.role) : [];
    let roles;
    try {
      roles = await checkRoleChange({
        session,
        userId: current?.id ?? null,
        primary: body.role || current?.role,
        extra: Array.isArray(body.roles) ? body.roles : before.slice(1),
        active: (isActive ?? current?.isActive ?? true) !== false,
        limitLevels: who.all ? null : await assignableLevels(session),
      });
    } catch (e) {
      const r = roleAssignErrorResponse(e);
      if (r) return NextResponse.json(r.body, { status: r.status });
      throw e;
    }

    if (current) {
      const conflict = await loginConflict(prisma, {
        username: username && username.toLowerCase() !== (current.username || "").toLowerCase() ? username : null,
        email: email && email.toLowerCase() !== (current.email || "").toLowerCase() ? email : null,
        exceptUserId: current.id,
      });
      if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: current.id },
          data: {
            username,
            email,
            role: roles.primary,
            isActive,
            employeeId,
            ...(password ? { password: await bcrypt.hash(password, 12) } : {}),
          },
          select: { id: true },
        });
        await saveExtraRoles(current.id, roles.extra, session.user.id, tx);
      }, { timeout: 15000 });
      return NextResponse.json({ login: await loadLogin(employee), message: password ? "Login saved, password changed" : "Login saved" });
    }

    // A new login for this employee.
    if (!password) return NextResponse.json({ error: "Set a password (min 6 characters) for the new login" }, { status: 400 });
    const newUsername = username || String(employeeId);
    const newEmail = email || employee.emailAddress;
    if (!newEmail) return NextResponse.json({ error: "Enter a login email (the employee has no email address)" }, { status: 400 });
    const conflict = await loginConflict(prisma, { username: newUsername, email: newEmail });
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });
    // Convention: login id = employee id (as text) when free.
    const idTaken = await prisma.user.findUnique({ where: { id: String(employeeId) }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          ...(idTaken ? {} : { id: String(employeeId) }),
          name: [employee.firstName, employee.surname].filter(Boolean).join(" "),
          username: newUsername,
          email: newEmail,
          password: await bcrypt.hash(password, 12),
          role: roles.primary,
          isActive: isActive ?? true,
          departmentId: employee.departmentId,
          employeeId,
        },
        select: { id: true },
      });
      await saveExtraRoles(u.id, roles.extra, session.user.id, tx);
    }, { timeout: 15000 });
    return NextResponse.json({ login: await loadLogin(employee), message: `Login "${newUsername}" created` }, { status: 201 });
  } catch (error) {
    const known = prismaErrorResponse(error);
    if (known) return NextResponse.json({ error: known.error }, { status: known.status });
    console.error("Employee login:", error);
    return NextResponse.json({ error: "Could not save the login" }, { status: 500 });
  }
}
