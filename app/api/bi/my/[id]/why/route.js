// /api/bi/my/[id]/why — "Why did it change?" for one figure on a dashboard.
//   GET  ?questionId=           → { fields } it can be broken down by
//   POST { questionId, period, field, filters? }
//        → the figure split by that field, this period vs the one before
//          (lib/bi/engine.js breakdownChange), under the viewer's own scope.
// Only for a question ON this dashboard, for someone it is assigned to.
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson, routeId } from "@/lib/bi/http";
import { BiError, breakdownChange, breakdownFields } from "@/lib/bi/engine";
import { canViewDashboard, allowedDatasets, layoutQuestionIds, BUILTIN_DASH_FILTERS } from "@/lib/bi/access";
import { isValidPeriod } from "@/lib/bi/periods";

async function loadQuestion(session, ctx, questionId) {
  const id = await routeId(ctx);
  if (!(await canViewDashboard(session, id))) throw new BiError("This dashboard is not assigned to you.", 403);
  const dashboard = await prisma.biDashboard.findUnique({ where: { id } });
  if (!dashboard) throw new BiError("Dashboard not found.", 404);
  const qid = Number(questionId);
  if (!layoutQuestionIds(dashboard.layout).includes(qid)) throw new BiError("That figure is not on this dashboard.", 403);
  const q = await prisma.biQuestion.findUnique({ where: { id: qid } });
  if (!q) throw new BiError("Question not found.", 404);
  const allowed = await allowedDatasets(session);
  if (allowed && !allowed.has(q.dataset)) throw new BiError("Your department does not have access to this data.", 403);
  return { dashboard, q };
}

export const GET = guard(
  null,
  bi(async (req, ctx) => {
    const { q } = await loadQuestion(ctx.session, ctx, new URL(req.url).searchParams.get("questionId"));
    return biJson({ fields: breakdownFields(q.config) });
  }),
);

export const POST = guard(
  null,
  bi(async (req, ctx) => {
    const body = await req.json();
    const { dashboard, q } = await loadQuestion(ctx.session, ctx, body?.questionId);
    if (!isValidPeriod(body?.period) || body.period === "all") throw new BiError("Choose a period to compare.");
    const fields = new Set([...(dashboard.layout?.filters ?? []).map((f) => f.field), ...BUILTIN_DASH_FILTERS]);
    const filters = (Array.isArray(body?.filters) ? body.filters : []).filter((f) => fields.has(f?.field));
    return biJson(await breakdownChange(q.config, { session: ctx.session, period: body.period, field: body.field, filters }));
  }),
);
