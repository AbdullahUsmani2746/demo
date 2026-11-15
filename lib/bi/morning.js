// lib/bi/morning.js — the 08:00 morning summary (cron in instrumentation-node.js).
//
// Who gets it is data: the recipients of the "biMorningSummary" event on
// Admin → Notifications (Super Admin by default). For each of them: their own
// landing dashboard that has headline cards, its headline and "needs
// attention" figures for yesterday — run under THEIR data access, never
// someone else's — written as one sentence (lib/bi/summary.js) and sent as a
// notification (bell + phone, lib/notifications/push.js).
import prisma from "@/lib/prisma";
import { emit, resolveRecipients } from "@/lib/notifications/emit";
import { subjectForUser } from "@/lib/auth/roleCatalog";
import { allowedDatasets, dashboardsFor } from "./access";
import { runQuestion } from "./engine";
import { buildSummary } from "./summary";

const EVENT = "biMorningSummary";
const PERIOD = "yday";

/** The first dashboard of this person (landing first) with headline cards. */
async function pickDashboard(subject) {
  const mine = await dashboardsFor(subject);
  for (const d of mine) {
    const full = await prisma.biDashboard.findUnique({ where: { id: d.id } });
    if (full?.is_active && (full.layout?.sections ?? []).some((s) => s.kind === "hero" && s.items?.length)) return full;
  }
  return null;
}

async function summaryFor(subject) {
  const dash = await pickDashboard(subject);
  if (!dash) return null;
  const wanted = (dash.layout.sections ?? []).filter((s) => s.kind === "hero" || s.kind === "attention").flatMap((s) => s.items ?? []);
  const ids = [...new Set(wanted.map((i) => i.questionId))];
  const [questions, allowed] = await Promise.all([prisma.biQuestion.findMany({ where: { id: { in: ids } } }), allowedDatasets(subject)]);
  const results = {};
  for (const q of questions) {
    if (allowed && !allowed.has(q.dataset)) continue;
    try {
      results[q.id] = { name: q.name, config: q.config, result: await runQuestion(q.config, { session: subject, period: PERIOD }) };
    } catch {
      /* a figure this person may not see is simply left out */
    }
  }
  const s = buildSummary(dash.layout, results, PERIOD, { compare: true });
  return s ? { dashboard: dash, text: `${s.lead} ${s.rest}`.trim() } : null;
}

/** Send today's morning summaries. Returns how many went out. */
export async function runMorningSummaries() {
  const resolved = await resolveRecipients(prisma, EVENT);
  if (!resolved?.recipients?.size) return 0;
  const users = await prisma.user.findMany({ where: { id: { in: [...resolved.recipients] }, isActive: true }, select: { id: true, role: true, email: true } });
  let sent = 0;
  for (const u of users) {
    try {
      const s = await summaryFor(await subjectForUser(u));
      if (!s) continue;
      sent += await emit(prisma, EVENT, {
        title: `Yesterday at a glance — ${s.dashboard.name}`,
        message: s.text,
        onlyUserIds: [u.id],
        vars: { summary: s.text, dashboard: s.dashboard.name },
      });
    } catch (e) {
      console.error("[bi] morning summary failed for", u.id, e.message);
    }
  }
  return sent;
}
