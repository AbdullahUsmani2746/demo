// /api/audit/meta — tables, their fields and areas, plus users, departments
// and roles: for the Audit Trail filters (audit.view) and the notification
// alert builder (notification.manage). ?check=1 → only { canAudit, canAlerts }
// (any signed-in user; the sidebar uses it to show the links).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { activeRoleCodes } from "@/lib/auth/roleCatalog";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { auditModels } from "@/lib/audit/meta";
import { AUDIT_MODULES } from "@/lib/audit/catalog";

export const GET = guard(null, async (req, { session }) => {
  const [canAudit, canAlerts] = await Promise.all([can(session, "audit.view"), can(session, "notification.manage")]);
  if (new URL(req.url).searchParams.get("check") === "1") return NextResponse.json({ canAudit, canAlerts });
  if (!canAudit && !canAlerts) {
    return NextResponse.json({ error: "You do not have access to the audit trail or notification alerts." }, { status: 403 });
  }
  const [users, departments] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ select: { id: true, dept_name: true }, orderBy: { dept_name: "asc" } }),
  ]);
  return NextResponse.json({
    canAudit,
    canAlerts,
    models: auditModels(),
    modules: [...AUDIT_MODULES.map(({ key, label }) => ({ key, label })), { key: "other", label: "Other" }],
    users: users.map((u) => ({ id: u.id, name: u.name || u.email, role: u.role })),
    departments: departments.map((d) => ({ id: d.id, name: d.dept_name })),
    roles: await activeRoleCodes(),
  });
});
