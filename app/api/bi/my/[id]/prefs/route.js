// /api/bi/my/[id]/prefs — one person's own settings for one dashboard
// (Customize): hidden cards, card order per section, saved views.
//   GET → { hidden: [questionId], order: { <sectionId>: [questionId] },
//           views: [{ name, period, compare, filters }], defaultView }
//   PUT → the same shape, replaced. Nobody else's dashboard changes.
// Stored in Settings "biPrefs:<userId>:<dashboardId>" (excluded from the
// Settings screen).
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson, routeId } from "@/lib/bi/http";
import { BiError } from "@/lib/bi/engine";
import { canViewDashboard } from "@/lib/bi/access";
import { isValidPeriod } from "@/lib/bi/periods";

const keyFor = (userId, dashId) => `biPrefs:${userId}:${dashId}`;
const EMPTY = { hidden: [], order: {}, views: [], defaultView: null };

function clean(body) {
  const ids = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter(Number.isFinite))].slice(0, 200);
  const order = {};
  for (const [k, v] of Object.entries(body?.order && typeof body.order === "object" ? body.order : {}).slice(0, 40)) order[String(k).slice(0, 40)] = ids(v);
  const views = (Array.isArray(body?.views) ? body.views : []).slice(0, 20).map((v) => ({
    name: String(v?.name || "").trim().slice(0, 40) || "View",
    period: isValidPeriod(v?.period) ? v.period : "mtd",
    compare: v?.compare !== false,
    filters: Object.fromEntries(
      Object.entries(v?.filters && typeof v.filters === "object" ? v.filters : {})
        .slice(0, 10)
        .map(([f, vals]) => [String(f).slice(0, 40), (Array.isArray(vals) ? vals : []).map(String).slice(0, 50)]),
    ),
  }));
  const defaultView = views.some((v) => v.name === body?.defaultView) ? body.defaultView : null;
  return { hidden: ids(body?.hidden), order, views, defaultView };
}

async function check(ctx) {
  const id = await routeId(ctx);
  if (!(await canViewDashboard(ctx.session, id))) throw new BiError("This dashboard is not assigned to you.", 403);
  return id;
}

export const GET = guard(
  null,
  bi(async (_req, ctx) => {
    const id = await check(ctx);
    const row = await prisma.settings.findUnique({ where: { key: keyFor(ctx.session.user.id, id) } });
    let value = EMPTY;
    try {
      value = row ? { ...EMPTY, ...JSON.parse(row.value) } : EMPTY;
    } catch {
      value = EMPTY;
    }
    return biJson(value);
  }),
);

export const PUT = guard(
  null,
  bi(async (req, ctx) => {
    const id = await check(ctx);
    const value = clean(await req.json());
    const key = keyFor(ctx.session.user.id, id);
    await prisma.settings.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value), description: "Dashboard settings of one person (My Dashboards → Customize)", exclude: true },
      update: { value: JSON.stringify(value) },
    });
    return biJson(value);
  }),
);
