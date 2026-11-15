// Shared helpers for app/api/employees/route.js and app/api/employees/[id]/route.js

export const EMPLOYEE_INCLUDE = {
    company: true,
    department: true,
    workLocation: true,
    manager: true,
    branch: true,
    city: true,
    bankBranch: { include: { bank: true } },
    bank: true,
    Designation: true,
    employeetype: true,
    employeecat: true,
    costCenter: true,
    allowances: true,
    deductions: true,
    leaves: true,
};

// What the Employee screen shows / edits about a linked login.
export const LINKED_USER_SELECT = {
    id: true,
    email: true,
    username: true,
    role: true,
    isActive: true,
    employeeId: true,
};

// An employee's login is resolved in this order:
//   1. User.employeeId = employee.id   (the real FK; set for every login now)
//   2. User.id = String(employee.id)   (convention used by the legacy import)
//   3. User.email = employee.emailAddress (oldest soft-link)
// 2 and 3 only count when that user isn't already tied to another employee.
// Returns Map<employeeId, user>.
export async function findLinkedUsers(client, employees) {
    const list = (Array.isArray(employees) ? employees : [employees]).filter(Boolean);
    const result = new Map();
    if (list.length === 0) return result;

    const ids = list.map((e) => e.id).filter((id) => id != null);
    const emails = list.map((e) => e.emailAddress).filter(Boolean);

    const users = await client.user.findMany({
        where: {
            OR: [
                { employeeId: { in: ids } },
                { id: { in: ids.map(String) } },
                ...(emails.length ? [{ email: { in: emails } }] : []),
            ],
        },
        select: LINKED_USER_SELECT,
    });

    const byEmpId = new Map();
    const byUserId = new Map();
    const byEmail = new Map();
    for (const u of users) {
        if (u.employeeId != null) byEmpId.set(u.employeeId, u);
        byUserId.set(u.id, u);
        byEmail.set(u.email, u);
    }

    const free = (u, empId) => u && (u.employeeId == null || u.employeeId === empId);
    for (const e of list) {
        const candidates = [byEmpId.get(e.id), byUserId.get(String(e.id)), e.emailAddress && byEmail.get(e.emailAddress)];
        const hit = candidates.find((u) => free(u, e.id));
        if (hit) result.set(e.id, hit);
    }
    return result;
}

export async function findLinkedUser(client, employee) {
    if (!employee) return null;
    return (await findLinkedUsers(client, employee)).get(employee.id) || null;
}

// Puts `employee.user` (or null) on each employee for the API response.
export async function attachLinkedUser(client, employees) {
    const list = (Array.isArray(employees) ? employees : [employees]).filter(Boolean);
    const linked = await findLinkedUsers(client, list);
    list.forEach((e) => {
        e.user = linked.get(e.id) || null;
    });
    return employees;
}

// Employee ids that have a login (for the "has login" filter). The User
// table is small, so this is one scan plus one lookup for legacy links.
export async function linkedEmployeeIds(client) {
    const users = await client.user.findMany({ select: { id: true, email: true, employeeId: true } });
    const ids = new Set();
    const numericIds = [];
    const emails = [];
    for (const u of users) {
        if (u.employeeId != null) {
            ids.add(u.employeeId);
        } else {
            if (/^\d+$/.test(u.id)) numericIds.push(Number(u.id));
            if (u.email) emails.push(u.email);
        }
    }
    if (numericIds.length || emails.length) {
        const legacy = await client.employee.findMany({
            where: { OR: [{ id: { in: numericIds } }, { emailAddress: { in: emails } }] },
            select: { id: true },
        });
        legacy.forEach((e) => ids.add(e.id));
    }
    return [...ids];
}

// Username / login-email clash checks (case-insensitive, ignoring the
// employee's own login). Returns an error message or null.
export async function loginConflict(client, { username, email, exceptUserId }) {
    const notSelf = exceptUserId ? { NOT: { id: exceptUserId } } : {};
    if (username) {
        const clash = await client.user.findFirst({
            where: { username: { equals: username, mode: "insensitive" }, ...notSelf },
            select: { id: true },
        });
        if (clash) return `Username "${username}" is already taken by another login`;
    }
    if (email) {
        const clash = await client.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" }, ...notSelf },
            select: { id: true },
        });
        if (clash) return `Login email "${email}" is already used by another login`;
    }
    return null;
}

// Prisma known-error -> friendly 4xx response body, or null.
export function prismaErrorResponse(error) {
    if (error?.code === "P2002") {
        const target = [].concat(error.meta?.target || []).join(", ");
        if (target.includes("emailAddress")) return { status: 409, error: "Another employee already uses this email address" };
        if (target.includes("username")) return { status: 409, error: "This username is already taken" };
        if (target.includes("email")) return { status: 409, error: "This login email is already used by another login" };
        if (target.includes("employeeId")) return { status: 409, error: "This employee already has a login" };
        return { status: 409, error: `Duplicate value (${target || "unique field"})` };
    }
    if (error?.code === "P2025") {
        return { status: 400, error: "A selected option (department, designation, cost center, ...) no longer exists. Reload and try again." };
    }
    return null;
}

// Employee.id has no DB-level default (legacy import quirk) — this is the
// suggested next value, used both to pre-fill the UI and as the create-time
// fallback when the admin doesn't type a specific id.
export async function getNextEmployeeId(client) {
    const { _max } = await client.employee.aggregate({ _max: { id: true } });
    return (_max.id || 0) + 1;
}

// Who may read / edit employee records and give them a login — permission
// codes (Admin → Roles), never a role name. Server only (dynamic import keeps
// Prisma out of the client bundle that imports this file's other helpers).
export async function canManageEmployees(session) {
    if (!session?.user?.id) return false;
    const { can } = await import("@/lib/auth/permissions");
    return (await can(session, "employee.manage")) || (await can(session, "setup.employees.view"));
}

// Granting / resetting logins and deleting employee records: employee.manage.
// Someone without users.manage may only give staff / self-service roles
// (lib/auth/roleAssign.js checkRoleChange { limitLevels }).
export async function canAdministerEmployeeAccess(session) {
    if (!session?.user?.id) return false;
    const { can } = await import("@/lib/auth/permissions");
    return can(session, "employee.manage");
}

// Prisma rejects `disconnect` on create (nothing to disconnect yet on a new
// row) but requires it on update to actually clear a previously-set relation.
function optionalRelation(id, isCreate) {
    if (id) return { connect: { id } };
    return isCreate ? undefined : { disconnect: true };
}

function manyRelation(ids, isCreate) {
    const connect = (ids || []).map((id) => ({ id }));
    return isCreate ? { connect } : { set: connect };
}

// Builds the Employee scalar/relation payload shared by create + update.
export function buildEmployeeData(parsed, { isCreate = false } = {}) {
    const {
        id, // never part of the Prisma `data` payload — id is set explicitly by the caller on create, and is immutable on update
        allowanceIds,
        deductionIds,
        leaveIds,
        designationId,
        departmentId,
        workLocationId,
        employeecatId,
        employeetypeId,
        cityId,
        branchId,
        managerId,
        bankId,
        bank_bracnhId,
        costCenterId,
        ...rest
    } = parsed;

    const data = {
        ...rest,
        company: { connect: { id: 1 } },
        Designation: { connect: { id: designationId } },
        department: { connect: { id: departmentId } },
        workLocation: optionalRelation(workLocationId, isCreate),
        employeecat: optionalRelation(employeecatId, isCreate),
        employeetype: optionalRelation(employeetypeId, isCreate),
        city: optionalRelation(cityId, isCreate),
        branch: optionalRelation(branchId, isCreate),
        manager: optionalRelation(managerId, isCreate),
        bank: optionalRelation(bankId, isCreate),
        bankBranch: optionalRelation(bank_bracnhId, isCreate),
        costCenter: { connect: { ccno: costCenterId } },
        // Same create-vs-update split as optionalRelation: `set` (declarative
        // replace) is update-only, `connect` is what create needs.
        allowances: manyRelation(allowanceIds, isCreate),
        deductions: manyRelation(deductionIds, isCreate),
        leaves: manyRelation(leaveIds, isCreate),
    };

    // Prisma treats an explicit `undefined` value the same as an omitted key,
    // so no extra cleanup is needed for the create-time "skip" case above.
    return data;
}

// Zod failure -> 400 body whose `error` already names the first problem, so
// the UI toast is specific ("Designation is required") not just "Validation failed".
export function validationErrorBody(zodError) {
    const flat = zodError.flatten();
    const first =
        Object.entries(flat.fieldErrors).map(([field, msgs]) => `${field}: ${msgs?.[0]}`)[0] ||
        flat.formErrors[0];
    return { error: first ? `Validation failed — ${first}` : "Validation failed", issues: flat };
}
