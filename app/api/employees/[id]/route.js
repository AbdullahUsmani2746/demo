import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { setAuditActor } from "@/lib/audit/context";
import { validateEmployee, validateEmployeeAccess } from "@/validators/employee.validator";
import {
    EMPLOYEE_INCLUDE,
    attachLinkedUser,
    findLinkedUser,
    canManageEmployees,
    canAdministerEmployeeAccess,
    buildEmployeeData,
    loginConflict,
    prismaErrorResponse,
    validationErrorBody,
} from "@/lib/employees";
import { guard } from "@/lib/auth/route";
import { assignableLevels, checkRoleChange, roleAssignErrorResponse, saveExtraRoles } from "@/lib/auth/roleAssign";
import { userRoleCodes } from "@/lib/auth/roleCatalog";

export async function GET(req, { params }) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !(await canManageEmployees(session))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const employee = await prisma.employee.findUnique({
            where: { id: Number(id) },
            include: EMPLOYEE_INCLUDE,
        });

        if (!employee) {
            return NextResponse.json({ error: "Employee not found" }, { status: 404 });
        }

        await attachLinkedUser(prisma, employee);
        return NextResponse.json(employee);
    } catch (error) {
        console.error("Error fetching employee:", error);
        return NextResponse.json({ error: "Failed to fetch employee", message: error.message }, { status: 500 });
    }
}

export const PUT = guard("employee.manage", async (req, { params }) => {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !(await canManageEmployees(session))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const employeeId = Number(id);

        const existing = await prisma.employee.findUnique({ where: { id: employeeId } });
        if (!existing) {
            return NextResponse.json({ error: "Employee not found" }, { status: 404 });
        }

        const body = await req.json();

        const parsedEmployee = validateEmployee(body);
        if (!parsedEmployee.success) {
            return NextResponse.json(validationErrorBody(parsedEmployee.error), { status: 400 });
        }

        const parsedAccess = validateEmployeeAccess(body);
        if (!parsedAccess.success) {
            return NextResponse.json(validationErrorBody(parsedAccess.error), { status: 400 });
        }
        const access = parsedAccess.data;

        // The employee's current login, found by employeeId -> id -> email.
        // Never by the (possibly edited) login email in the request, which
        // is how a second user used to get created for the same employee.
        const linkedUser = await findLinkedUser(prisma, existing);

        let userUpdate = null;
        let userCreate = null;
        let extraRoles = null; // null = leave the login's extra roles alone
        if (access.grantAccess) {
            if (!(await canAdministerEmployeeAccess(session))) {
                return NextResponse.json(
                    { error: "You may not give or change employees' system logins (employee.manage)." },
                    { status: 403 }
                );
            }

            // The login's role: same rules as Admin → Users (lib/auth/roleAssign.js).
            if (access.role || linkedUser) {
                const current = linkedUser ? await userRoleCodes(linkedUser.id, linkedUser.role) : [];
                try {
                    ({ primary: access.role, extra: extraRoles } = await checkRoleChange({
                        session,
                        userId: linkedUser?.id ?? null,
                        primary: access.role || linkedUser?.role,
                        extra: Array.isArray(access.roles) ? access.roles : current.slice(1),
                        active: access.isActive !== false,
                        limitLevels: await assignableLevels(session),
                    }));
                } catch (e) {
                    const r = roleAssignErrorResponse(e);
                    if (r) return NextResponse.json(r.body, { status: r.status });
                    throw e;
                }
            }

            if (linkedUser) {
                const username = access.username || linkedUser.username || null;
                const email = access.email || linkedUser.email;
                const conflict = await loginConflict(prisma, {
                    username: username !== linkedUser.username ? username : null,
                    email: email.toLowerCase() !== (linkedUser.email || "").toLowerCase() ? email : null,
                    exceptUserId: linkedUser.id,
                });
                if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

                userUpdate = {
                    where: { id: linkedUser.id },
                    data: {
                        username,
                        email,
                        role: access.role || linkedUser.role,
                        isActive: access.isActive,
                        employeeId,
                        ...(access.password ? { password: await bcrypt.hash(access.password, 12) } : {}),
                    },
                };
            } else {
                if (!access.password || !access.role) {
                    return NextResponse.json(
                        { error: "Password (min 6 characters) and role are required to grant system access" },
                        { status: 400 }
                    );
                }
                const username = access.username || String(employeeId);
                const email = access.email || parsedEmployee.data.emailAddress;
                const conflict = await loginConflict(prisma, { username, email });
                if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

                // Convention: login id = employee id (as text); fall back to a
                // generated cuid if an unrelated user already holds that id.
                const idTaken = await prisma.user.findUnique({ where: { id: String(employeeId) }, select: { id: true } });
                userCreate = {
                    data: {
                        ...(idTaken ? {} : { id: String(employeeId) }),
                        name: `${parsedEmployee.data.firstName} ${parsedEmployee.data.surname}`,
                        username,
                        email,
                        password: await bcrypt.hash(access.password, 12),
                        role: access.role,
                        isActive: access.isActive,
                        departmentId: parsedEmployee.data.departmentId,
                        employeeId,
                    },
                };
            }
        }

        setAuditActor(session);

        const employee = await prisma.$transaction(async (tx) => {
            const updated = await tx.employee.update({
                where: { id: employeeId },
                data: buildEmployeeData(parsedEmployee.data),
                include: EMPLOYEE_INCLUDE,
            });

            let loginId = null;
            if (userUpdate) loginId = (await tx.user.update({ ...userUpdate, select: { id: true } })).id;
            if (userCreate) loginId = (await tx.user.create({ ...userCreate, select: { id: true } })).id;
            if (loginId && extraRoles) await saveExtraRoles(loginId, extraRoles, session.user.id, tx);
            return updated;
        }, { timeout: 15000 });
        // Read back the login after the commit — only writes in the transaction.
        await attachLinkedUser(prisma, employee);

        return NextResponse.json(employee);
    } catch (error) {
        const known = prismaErrorResponse(error);
        if (known) return NextResponse.json({ error: known.error }, { status: known.status });
        console.error("Error updating employee:", error);
        return NextResponse.json({ error: "Failed to update employee", message: error.message }, { status: 500 });
    }
});

export const DELETE = guard("employee.manage", async (req, { params }) => {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !(await canAdministerEmployeeAccess(session))) {
            return NextResponse.json(
                { error: "You may not delete employees (employee.manage)." },
                { status: 403 }
            );
        }

        const { id } = await params;
        const employeeId = Number(id);
        const existing = await prisma.employee.findUnique({ where: { id: employeeId } });
        if (!existing) {
            return NextResponse.json({ error: "Employee not found" }, { status: 404 });
        }

        setAuditActor(session);

        // A deleted employee must not keep a working login: the FK would just
        // be nulled, leaving an active, unlinked account behind.
        const linkedUser = await findLinkedUser(prisma, existing);
        await prisma.$transaction(async (tx) => {
            await tx.employee.delete({ where: { id: employeeId } });
            if (linkedUser) {
                await tx.user.update({ where: { id: linkedUser.id }, data: { isActive: false, employeeId: null } });
            }
        });

        return NextResponse.json({
            success: true,
            message: linkedUser
                ? `Employee deleted; login "${linkedUser.username || linkedUser.email}" was deactivated`
                : "Employee deleted",
        });
    } catch (error) {
        console.error("Error deleting employee:", error);
        if (error.code === "P2003" || error.code === "P2014") {
            return NextResponse.json(
                {
                    error:
                        "This employee is referenced by other records (manager profile, menus, payroll, ...) and cannot be deleted. Set the status to Inactive instead.",
                },
                { status: 409 }
            );
        }
        return NextResponse.json({ error: "Failed to delete employee", message: error.message }, { status: 500 });
    }
});
