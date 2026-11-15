import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { can } from "@/lib/auth/permissions";
import { userRoleCodes } from "@/lib/auth/roleCatalog";
import { checkRoleChange, roleAssignErrorResponse, saveExtraRoles } from "@/lib/auth/roleAssign";
import { setAuditActor } from "@/lib/audit/context";

const mayManage = async (session) => !!session?.user?.id && (await can(session, "users.manage"));

export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions);

    if (!(await mayManage(session))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    setAuditActor(session);

    const { id } = await params;
    const { name, email, role: rawRole, roles: rawRoles, isActive, password, shiftId } =
      await request.json();

    // Roles: `role` = primary; `roles` (optional) = every role. Omitted roles
    // keep the extra ones the person already has.
    const current = await userRoleCodes(id);
    let role;
    let extra;
    try {
      ({ primary: role, extra } = await checkRoleChange({
        session,
        userId: id,
        primary: rawRole || current[0],
        extra: Array.isArray(rawRoles) ? rawRoles : current.slice(1),
        active: isActive !== false,
      }));
    } catch (e) {
      const r = roleAssignErrorResponse(e);
      if (r) return NextResponse.json(r.body, { status: r.status });
      throw e;
    }

    // Parse shiftId to integer if it exists
    const parsedShiftId =
      shiftId !== undefined && shiftId !== null && shiftId !== ""
        ? parseInt(shiftId, 10)
        : undefined;

    const updateData = {
      name,
      email,
      role,
      isActive,
    };

    // Only update password if provided
    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    // Handle shift assignment or disconnection
    if (shiftId !== undefined) {
      if (parsedShiftId) {
        updateData.shift = {
          connect: { id: parsedShiftId },
        };
      } else {
        updateData.shift = {
          disconnect: true,
        };
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        updatedAt: true,
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

    await saveExtraRoles(id, extra, session.user.id);

    return NextResponse.json({ ...user, roles: [role, ...extra] });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions);

    if (!(await mayManage(session))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    setAuditActor(session);

    const { id } = await params;

    // Don't allow deleting yourself
    if (id === session.user.id) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    try {
      await checkRoleChange({ session, userId: id, primary: (await userRoleCodes(id))[0] || "EMPLOYEE", active: false });
    } catch (e) {
      const r = roleAssignErrorResponse(e);
      if (r) return NextResponse.json(r.body, { status: r.status });
      throw e;
    }

    await prisma.user.delete({
      where: { id },
    });

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
