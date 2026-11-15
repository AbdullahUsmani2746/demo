// POST /api/bi/my/[id]/drill — the records behind one figure on a dashboard.
//   { questionId, period?, point: { d0, d1 }, filters? (query-string style) }
// Only for a question that is ON this dashboard, for someone it is assigned
// to, under their own data scope and dataset access.
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson, routeId } from "@/lib/bi/http";
import { BiError, breakdownFields, drillRows } from "@/lib/bi/engine";
import { isValidPeriod } from "@/lib/bi/periods";
import { canViewDashboard, allowedDatasets, layoutQuestionIds, dashFilterFields } from "@/lib/bi/access";
import { enabledDashFilters } from "@/lib/bi/dashFilters";

export const POST = guard(
  null,
  bi(async (req, ctx) => {
    const { session } = ctx;
    const id = await routeId(ctx);
    if (!(await canViewDashboard(session, id))) throw new BiError("This dashboard is not assigned to you.", 403);
    const dashboard = await prisma.biDashboard.findUnique({ where: { id } });
    if (!dashboard) throw new BiError("Dashboard not found.", 404);

    const body = await req.json();
    const qid = Number(body?.questionId);
    if (!layoutQuestionIds(dashboard.layout).includes(qid)) throw new BiError("That figure is not on this dashboard.", 403);
    const q = await prisma.biQuestion.findUnique({ where: { id: qid } });
    if (!q) throw new BiError("Question not found.", 404);
    const allowed = await allowedDatasets(session);
    if (allowed && !allowed.has(q.dataset)) throw new BiError("Your department does not have access to this data.", 403);

    // Only the dashboard's own filters are honoured.
    const fields = dashFilterFields(dashboard.layout, await enabledDashFilters());
    const filters = (Array.isArray(body?.filters) ? body.filters : []).filter((f) => fields.has(f?.field));
    // One value of any field of this figure ("Why did it change?" → a name):
    // only ever narrows what the person already sees.
    const narrow = body?.narrow;
    if (narrow?.field && narrow.value != null && breakdownFields(q.config).some((f) => f.key === narrow.field)) {
      filters.push({ field: narrow.field, value: [String(narrow.value)] });
    }
    const period = body?.period && isValidPeriod(body.period) ? body.period : undefined;
    return biJson(await drillRows(q.config, { session, period, point: body?.point, filters }));
  }),
);
