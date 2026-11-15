// GET /api/bi/my/[id]/values?field=godown — choices for a dashboard filter:
// the distinct values of that field across the datasets this dashboard uses,
// limited to what the viewer may see.
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson, routeId } from "@/lib/bi/http";
import { BiError, fieldValues } from "@/lib/bi/engine";
import { canViewDashboard, layoutQuestionIds } from "@/lib/bi/access";
import { datasetByKey } from "@/lib/bi/datasets";
import { enabledDashFilters } from "@/lib/bi/dashFilters";

export const GET = guard(
  null,
  bi(async (req, ctx) => {
    const { session } = ctx;
    const id = await routeId(ctx);
    if (!(await canViewDashboard(session, id))) throw new BiError("This dashboard is not assigned to you.", 403);
    const dashboard = await prisma.biDashboard.findUnique({ where: { id } });
    const field = new URL(req.url).searchParams.get("field");
    // The dashboard's own filters, or a built-in one that is switched on
    const builtin = (await enabledDashFilters()).some((f) => f.field === field && f.kind === "multi");
    if (!dashboard || !(builtin || (dashboard.layout?.filters ?? []).some((f) => f.field === field))) return biJson({ values: [] });

    const qs = await prisma.biQuestion.findMany({
      where: { id: { in: layoutQuestionIds(dashboard.layout) } },
      select: { dataset: true },
    });
    const datasets = [...new Set(qs.map((q) => q.dataset))].filter((d) => datasetByKey(d)?.fields.some((f) => f.key === field));
    const lists = await Promise.all(datasets.map((d) => fieldValues(d, field, { session }).catch(() => [])));
    const values = [...new Set(lists.flat())].sort((a, b) => String(a).localeCompare(String(b)));
    return biJson({ values });
  }),
);
