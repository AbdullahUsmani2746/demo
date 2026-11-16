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
    canManageEmployees,
    canAdministerEmployeeAccess,
    buildEmployeeData,
    getNextEmployeeId,
    linkedEmployeeIds,
    loginConflict,
    prismaErrorResponse,
    validationErrorBody,
} from "@/lib/employees";
import { guard } from "@/lib/auth/route";
import { assignableLevels, checkRoleChange, roleAssignErrorResponse, saveExtraRoles } from "@/lib/auth/roleAssign";

export async function GET(req) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !(await canManageEmployees(session))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const search = (searchParams.get("search") || "").trim();
        const status = searchParams.get("status");
        const departmentId = searchParams.get("departmentId");
        const hasLogin = searchParams.get("hasLogin"); // "yes" | "no" | "all"
        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "10", 10) || 10));
        const skip = (page - 1) * limit;

        const and = [];

        // Every word must match somewhere, so "ali khan" finds Ali Khan.
        if (search) {
            const tokens = search.split(/\s+/).filter(Boolean);
            const userHits = await prisma.user.findMany({
                where: { username: { contains: search, mode: "insensitive" }, employeeId: { not: null } },
                select: { employeeId: true },
            });
            const byUsername = userHits.map((u) => u.employeeId);
            const tokenClauses = tokens.map((t) => ({
                OR: [
                    { firstName: { contains: t, mode: "insensitive" } },
                    { middleName: { contains: t, mode: "insensitive" } },
                    { surname: { contains: t, mode: "insensitive" } },
                    { emailAddress: { contains: t, mode: "insensitive" } },
                    { phoneNumber: { contains: t } },
                    { cnicNumber: { contains: t } },
                    ...(/^\d+$/.test(t) ? [{ id: Number(t) }] : []),
                ],
            }));
            and.push({
                OR: [
                    { AND: tokenClauses },
                    ...(byUsername.length ? [{ id: { in: byUsername } }] : []),
                ],
            });
        }
        if (status && status !== "all") and.push({ status });
        if (departmentId && departmentId !== "all") and.push({ departmentId: Number(departmentId) });
        if (hasLogin === "yes" || hasLogin === "no") {
            const ids = await linkedEmployeeIds(prisma);
            and.push(hasLogin === "yes" ? { id: { in: ids } } : { id: { notIn: ids } });
        }

        const where = and.length ? { AND: and } : {};

        const [data, total, activeCount, inactiveCount] = await Promise.all([
            prisma.employee.findMany({
                where,
                include: EMPLOYEE_INCLUDE,
                orderBy: [{ firstName: "asc" }, { surname: "asc" }],
                skip,
                take: limit,
            }),
            prisma.employee.count({ where }),
            prisma.employee.count({ where: { status: "ACTIVE" } }),
            prisma.employee.count({ where: { status: "INACTIVE" } }),
        ]);

        await attachLinkedUser(prisma, data);

        return NextResponse.json({
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
            summary: { total: activeCount + inactiveCount, active: activeCount, inactive: inactiveCount },
        });
    } catch (error) {
        console.error("Error fetching employees:", error);
        return NextResponse.json({ error: "Failed to fetch employees", message: error.message }, { status: 500 });
    }
}

export const POST = guard("employee.manage", async (req) => {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !(await canManageEmployees(session))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

        // If the admin typed a specific Employee ID (pre-filled with the next
        // available number, but editable), make sure it's actually free before
        // starting the transaction.
        if (parsedEmployee.data.id) {
            const existingEmployee = await prisma.employee.findUnique({ where: { id: parsedEmployee.data.id } });
            if (existingEmployee) {
                return NextResponse.json(
                    { error: `Employee ID ${parsedEmployee.data.id} already exists — use the next free number` },
                    { status: 409 }
                );
            }
        }

        let loginEmail = null;
        let requestedUsername = null;
        let extraRoles = [];
        if (access.grantAccess) {
            if (!(await canAdministerEmployeeAccess(session))) {
                return NextResponse.json(
                    { error: "You may not give employees a system login (employee.manage)." },
                    { status: 403 }
                );
            }
            if (!access.password || !access.role) {
                return NextResponse.json(
                    { error: "Password (min 6 characters) and role are required to grant system access" },
                    { status: 400 }
                );
            }
            try {
                ({ primary: access.role, extra: extraRoles } = await checkRoleChange({
                    session, primary: access.role, extra: access.roles || [], active: access.isActive !== false, limitLevels: await assignableLevels(session),
                }));
            } catch (e) {
                const r = roleAssignErrorResponse(e);
                if (r) return NextResponse.json(r.body, { status: r.status });
                throw e;
            }
            loginEmail = access.email || parsedEmployee.data.emailAddress;
            requestedUsername = access.username || null;
            const conflict = await loginConflict(prisma, {
                username: requestedUsername || (parsedEmployee.data.id ? String(parsedEmployee.data.id) : null),
                email: loginEmail,
            });
            if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });
        }

        setAuditActor(session);

        const employee = await prisma.$transaction(async (tx) => {
            const nextId = parsedEmployee.data.id || (await getNextEmployeeId(tx));

            const created = await tx.employee.create({
                data: { id: nextId, ...buildEmployeeData(parsedEmployee.data, { isCreate: true }) },
                include: EMPLOYEE_INCLUDE,
            });

            if (access.grantAccess) {
                const username = requestedUsername || String(created.id);
                // Re-check inside the transaction: the default username is the
                // id, which may only be known now.
                const conflict = await loginConflict(tx, { username });
                if (conflict) {
                    const err = new Error(conflict);
                    err.status = 409;
                    throw err;
                }
                // Convention: login id = employee id (as text). Fall back to a
                // generated cuid if some unrelated user already holds that id.
                const idTaken = await tx.user.findUnique({ where: { id: String(created.id) }, select: { id: true } });
                const login = await tx.user.create({
                    data: {
                        ...(idTaken ? {} : { id: String(created.id) }),
                        name: `${created.firstName} ${created.surname}`,
                        username,
                        email: loginEmail,
                        password: await bcrypt.hash(access.password, 12),
                        role: access.role,
                        isActive: access.isActive,
                        departmentId: created.departmentId,
                        employeeId: created.id,
                    },
                    select: { id: true },
                });
                await saveExtraRoles(login.id, extraRoles, session.user.id, tx);
            }

            return created;
        }, { timeout: 15000 });
        // Read back the login after the commit — only writes in the transaction.
        await attachLinkedUser(prisma, employee);

        return NextResponse.json(employee, { status: 201 });
    } catch (error) {
        if (error.status === 409) {
            return NextResponse.json({ error: error.message }, { status: 409 });
        }
        const known = prismaErrorResponse(error);
        if (known) return NextResponse.json({ error: known.error }, { status: known.status });
        console.error("Error creating employee:", error);
        return NextResponse.json({ error: "Failed to create employee", message: error.message }, { status: 500 });
    }
});
