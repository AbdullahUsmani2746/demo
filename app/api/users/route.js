import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { can } from "@/lib/auth/permissions";
import { usersWithRoles } from "@/lib/auth/roles";
import { roleCodesByUser } from "@/lib/auth/roleCatalog";
import { checkRoleChange, roleAssignErrorResponse, saveExtraRoles } from "@/lib/auth/roleAssign";
import { setAuditActor } from "@/lib/audit/context";
import { loginConflict } from "@/lib/employees";

// Logins are managed by holders of users.manage (Admin → Roles), not by a
// role name. Roles: `role` = primary, `roles` = every role (primary first).
const mayManage = async (session) => !!session?.user?.id && (await can(session, "users.manage"));

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);

    if (!(await mayManage(session))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role");
    // link = employee | none (logins without an employee: Super Admin, auditors …)
    const link = searchParams.get("link");
    const active = searchParams.get("active"); // yes | no
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "1000000");
    const skip = (page - 1) * limit;

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { username: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(role && role !== "all" && { AND: [usersWithRoles([role])] }),
      ...(link === "employee" && { employeeId: { not: null } }),
      ...(link === "none" && { employeeId: null }),
      ...(active === "yes" && { isActive: true }),
      ...(active === "no" && { isActive: false }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          username: true,
          employeeId: true,
          employee: { select: { id: true, firstName: true, surname: true } },
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          shiftId: true,
          shift: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.user.count({ where }),
    ]);

    const rolesBy = await roleCodesByUser(users);
    return NextResponse.json({ users: users.map((u) => ({ ...u, roles: rolesBy.get(String(u.id)) })), total });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);

    if (!(await mayManage(session))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    setAuditActor(session);

    const { name, email, password, role: rawRole, roles: rawRoles, shiftId, username: rawUsername, isActive } = await request.json();
    const username = rawUsername ? String(rawUsername).trim() : null;

    if (!name || !email || !password || !rawRole) {
      return NextResponse.json(
        { error: "Name, email, password and role are required" },
        { status: 400 }
      );
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    if (username && (username.includes("@") || username.length > 25)) {
      return NextResponse.json({ error: "Username: up to 25 characters, no @ sign" }, { status: 400 });
    }

    let role;
    let extra;
    try {
      ({ primary: role, extra } = await checkRoleChange({ session, primary: rawRole, extra: rawRoles, active: isActive !== false }));
    } catch (e) {
      const r = roleAssignErrorResponse(e);
      if (r) return NextResponse.json(r.body, { status: r.status });
      throw e;
    }

    const conflict = await loginConflict(prisma, { username, email });
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

    const hashedPassword = await bcrypt.hash(password, 12);

    const parsedShiftId = shiftId ? parseInt(shiftId, 10) : null;

    // A login made here has no employee (Super Admin, auditors …); an
    // employee's login is made on the Employee screen (Login & Roles).
    const userData = {
      name,
      email,
      username,
      password: hashedPassword,
      role,
      isActive: isActive !== false,
    };

    if (parsedShiftId) {
      userData.shift = {
        connect: { id: parsedShiftId },
      };
    }

    const user = await prisma.user.create({
      data: userData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        shift: {
          select: {
            id: true,
            name: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    await saveExtraRoles(user.id, extra, session.user.id);

    return NextResponse.json({ ...user, roles: [role, ...extra] }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
