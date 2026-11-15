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
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "1000000");
    const skip = (page - 1) * limit;

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(role && role !== "all" && { AND: [usersWithRoles([role])] }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
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

    const { name, email, password, role: rawRole, roles: rawRoles, shiftId } = await request.json();

    if (!name || !email || !password || !rawRole) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    let role;
    let extra;
    try {
      ({ primary: role, extra } = await checkRoleChange({ session, primary: rawRole, extra: rawRoles }));
    } catch (e) {
      const r = roleAssignErrorResponse(e);
      if (r) return NextResponse.json(r.body, { status: r.status });
      throw e;
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const parsedShiftId = shiftId ? parseInt(shiftId, 10) : null;

    const userData = {
      name,
      email,
      password: hashedPassword,
      role,
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
