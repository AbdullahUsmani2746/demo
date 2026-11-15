// PUT /api/bi/dashboards/[id]/assignments — BI Designer only.
// Replaces who sees this dashboard:
//   { assignments: [{ department_id? | role? | user_id?, is_landing? }] }
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson, routeId } from "@/lib/bi/http";
import { BiError } from "@/lib/bi/engine";

export const PUT = guard(
  null,
  bi(async (req, ctx) => {
    const id = await routeId(ctx);
    const exists = await prisma.biDashboard.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new BiError("Dashboard not found.", 404);

    const { assignments = [] } = await req.json();
    const rows = (Array.isArray(assignments) ? assignments : [])
      .map((a) => ({
        dashboard_id: id,
        department_id: Number(a.department_id) || null,
        role: a.role ? String(a.role).slice(0, 40) : null,
        user_id: a.user_id ? String(a.user_id).slice(0, 50) : null,
        is_landing: a.is_landing === true,
      }))
      // exactly one target per row
      .filter((a) => [a.department_id, a.role, a.user_id].filter(Boolean).length === 1);

    await prisma.$transaction([
      prisma.biDashboardAssignment.deleteMany({ where: { dashboard_id: id } }),
      ...(rows.length ? [prisma.biDashboardAssignment.createMany({ data: rows })] : []),
    ]);
    return biJson({ ok: true, count: rows.length });
  }, { design: true }),
);
