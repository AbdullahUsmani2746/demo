import prisma from "@/lib/prisma";

// employee_menu.employee_id points at Employee.id, but the session only carries
// User.id (auth.js sets session.user.id = token.sub). They are different
// tables, so scoping a menu query by the session id silently matches the wrong
// employee — or nobody. Resolve through email instead, exactly as the
// permission check in app/api/menu/check-permission does.
//
// Falls back to the session id so behaviour degrades to what app-sidebar.jsx
// does today rather than to an empty menu.
export async function resolveEmployeeId(session) {
  // The login's own employee (User.employeeId, carried on the session) first:
  // a login email may differ from the employee's email.
  if (session?.user?.employeeId) return session.user.employeeId;
  const email = session?.user?.email;

  if (email) {
    try {
      const employee = await prisma.employee.findUnique({
        where: { emailAddress: email },
        select: { id: true },
      });
      if (employee) return employee.id;
    } catch (error) {
      console.error("Failed to resolve employee for menu scoping:", error);
    }
  }

  return session?.user?.id ?? null;
}
