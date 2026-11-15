// GET /api/bi/my/[id]?period=mtd — one dashboard WITH all its data, in one
// request: the layout plus every question's result. Only for people it is
// assigned to (or designers). Each question runs under the viewer's own data
// scope and dataset access — a question they may not see shows a message
// instead of figures, never someone else's numbers.
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson, routeId } from "@/lib/bi/http";
import { BiError, runQuestion } from "@/lib/bi/engine";
import { canViewDashboard, allowedDatasets, layoutQuestionIds, readDashFilters } from "@/lib/bi/access";
import { datasetByKey } from "@/lib/bi/datasets";
import { isValidPeriod } from "@/lib/bi/periods";
import { resultLabel } from "@/lib/bi/followups";

// Follow-up status of a scenario question's rows (BI Designer → Follow-up):
// { key, items: { <item key>: { id, status, result, label, due } } } — only
// for the keys this person can already see in the result.
async function followupStatus(q, result) {
  const f = q.config?.followup;
  if (!f?.enabled || !f.key || !result?.rows?.length) return null;
  const field = String(f.key).replace(/^d:/, "");
  const col = result.columns.find((c) => c.role === "dimension" && c.field === field);
  if (!col) return null;
  const keys = [...new Set(result.rows.map((r) => String(r[col.key] ?? "")).filter(Boolean))];
  try {
    const items = await prisma.biFollowup.findMany({
      where: { question_id: q.id, item_key: { in: keys }, status: { in: ["open", "done"] } },
      select: { id: true, item_key: true, status: true, result: true, due_since: true, next_date: true },
    });
    return {
      key: f.key,
      items: Object.fromEntries(
        items.map((i) => [i.item_key, { id: i.id, status: i.status, result: i.result, label: i.result ? resultLabel(i.result) : null, due: i.due_since, next: i.next_date }]),
      ),
    };
  } catch {
    return null; // follow-ups not set up yet
  }
}

// Short per-user cache: a dashboard refreshed by many tabs / people should not
// re-run every query each time. Keyed by user (their scope) + question + period.
const CACHE_MS = 60 * 1000;
const cache = new Map();

async function cachedRun(userId, q, period, session, filters) {
  const key = `${userId}|${q.id}|${new Date(q.updated_at).getTime()}|${period}|${JSON.stringify(filters)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await runQuestion(q.config, { session, period, filters });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

export const GET = guard(
  null,
  bi(async (req, ctx) => {
    const { session } = ctx;
    const id = await routeId(ctx);
    if (!(await canViewDashboard(session, id))) {
      throw new BiError("This dashboard is not assigned to you.", 403);
    }
    const dashboard = await prisma.biDashboard.findUnique({ where: { id } });
    if (!dashboard || !dashboard.is_active) throw new BiError("Dashboard not found.", 404);

    const url = new URL(req.url);
    const asked = url.searchParams.get("period");
    // Fixed periods and picked dates ("custom:2026-11-01:2026-11-12") — lib/bi/periods.js
    const period = asked && isValidPeriod(asked) ? asked : dashboard.default_period || "mtd";
    const refresh = url.searchParams.get("refresh") === "1";
    const filters = readDashFilters(url, dashboard.layout);

    const ids = layoutQuestionIds(dashboard.layout);
    const [questions, allowed] = await Promise.all([
      prisma.biQuestion.findMany({ where: { id: { in: ids } } }),
      allowedDatasets(session),
    ]);
    if (refresh) for (const q of questions) for (const k of cache.keys()) if (k.startsWith(`${session.user.id}|${q.id}|`)) cache.delete(k);

    const results = {};
    await Promise.all(
      questions.map(async (q) => {
        const meta = { id: q.id, name: q.name, description: q.description, config: q.config, datasetLabel: datasetByKey(q.dataset)?.label };
        if (allowed && !allowed.has(q.dataset)) {
          results[q.id] = { ...meta, error: "Your department does not have access to this data." };
          return;
        }
        try {
          const result = await cachedRun(session.user.id, q, period, session, filters);
          results[q.id] = { ...meta, result, followup: await followupStatus(q, result) };
        } catch (e) {
          results[q.id] = { ...meta, error: e instanceof BiError ? e.message : "Could not load this figure." };
          if (!(e instanceof BiError)) console.error("[bi] question", q.id, e);
        }
      }),
    );

    // Event flags for trend charts (BI Designer → Events), last two years.
    let events = [];
    try {
      const since = new Date();
      since.setFullYear(since.getFullYear() - 2);
      events = (await prisma.biEvent.findMany({ where: { dated: { gte: since } }, orderBy: { dated: "asc" }, take: 200 })).map((e) => ({
        dated: e.dated.toISOString().slice(0, 10),
        label: e.label,
        note: e.note,
      }));
    } catch {
      events = []; // table not created yet (prisma/sql/2026-11-17_bi_events.sql)
    }

    return biJson({
      events,
      dashboard: { id: dashboard.id, name: dashboard.name, description: dashboard.description, layout: dashboard.layout, default_period: dashboard.default_period },
      period,
      filters,
      results,
      generatedAt: new Date().toISOString(),
    });
  }),
);
