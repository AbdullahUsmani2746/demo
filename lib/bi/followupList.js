// lib/bi/followupList.js — the follow-ups ONE person sees, for My Follow-ups
// (/dashboard/followups), its sidebar badge and the bell's Follow-up tab.
// Who sees which item: lib/bi/followupAccess.js. Items are refreshed from
// their scenarios at most every 15 minutes (lib/bi/followups.js maybeSync).
//
//   box: overdue | snoozed | done
//   → { data, counts, scenarios, owners, results, isManager, any }
import prisma from "@/lib/prisma";
import { maybeSync, scenarioQuestions, FOLLOWUP_RESULTS, resultLabel } from "@/lib/bi/followups";
import { followupViewer } from "@/lib/bi/followupAccess";

const DAY = 24 * 60 * 60 * 1000;

export async function listFollowups(session, { box = "overdue", countOnly = false, sync = true, limit = null } = {}) {
  if (sync && !countOnly) {
    try {
      await maybeSync();
    } catch {
      // shown from what is stored
    }
  }
  const scenarios = await scenarioQuestions();
  const byId = new Map(scenarios.map((q) => [q.id, q]));
  const viewer = await followupViewer(session);

  const items = (
    await prisma.biFollowup.findMany({
      where: { question_id: { in: [...byId.keys()] }, status: { in: ["open", "done"] } },
      include: { notes: { orderBy: { created_at: "desc" }, take: 1 } },
      orderBy: { due_since: "asc" },
    })
  ).filter((it) => viewer.canSee(it, byId.get(it.question_id)));

  const now = Date.now();
  const isSnoozed = (it) => it.status === "open" && new Date(it.due_since).getTime() > now;
  const inBox = (it) =>
    box === "done" ? it.status === "done" : box === "snoozed" ? isSnoozed(it) : it.status === "open" && !isSnoozed(it);
  const counts = {
    overdue: items.filter((it) => it.status === "open" && !isSnoozed(it)).length,
    snoozed: items.filter(isSnoozed).length,
    done: items.filter((it) => it.status === "done").length,
  };
  const any = items.length > 0;

  if (countOnly) return { counts, any };

  const rows = items.filter(inBox).slice(0, limit ?? (box === "done" ? 300 : 1000));
  const userIds = [...new Set(rows.flatMap((r) => [r.owner_id, r.done_by, r.notes[0]?.user_id]).filter(Boolean))];
  const partyIds = [...new Set(rows.map((r) => r.party_id).filter(Boolean))];
  const [users, parties] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
    partyIds.length ? prisma.aCNO.findMany({ where: { acno: { in: partyIds } }, select: { acno: true, acname: true } }) : [],
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  const partyOf = new Map(parties.map((p) => [p.acno, p.acname]));

  const data = rows.map((it) => {
    const q = byId.get(it.question_id);
    const steps = (q.config.followup.escalation || []).length;
    const overdueDays = Math.max(0, Math.floor((now - new Date(it.due_since).getTime()) / DAY));
    const last = it.notes[0];
    return {
      id: it.id,
      scenario: q.name,
      scenario_id: q.id,
      key: it.item_key,
      label: it.item_label,
      flag: it.flag_label,
      customer: it.party_id ? partyOf.get(it.party_id) ?? null : null,
      owner: it.owner_id ? nameOf.get(it.owner_id) ?? it.owner_id : "Unassigned",
      owner_id: it.owner_id,
      status: it.status,
      result: it.result,
      result_label: it.result ? resultLabel(it.result) : null,
      remarks: it.remarks,
      next_date: it.next_date,
      due_since: it.due_since,
      overdue_days: it.status === "open" ? overdueDays : 0,
      escalated: it.level > 0,
      level: it.level,
      steps,
      done_at: it.done_at,
      done_by: it.done_by ? nameOf.get(it.done_by) ?? it.done_by : null,
      last_note: last?.remarks ?? null,
      last_note_at: last?.created_at ?? null,
      last_note_by: last?.user_id ? nameOf.get(last.user_id) ?? last.user_id : null,
      blocks: Boolean(q.config.followup.blockFoc),
    };
  });

  return {
    data,
    counts,
    any,
    scenarios: scenarios.filter((q) => items.some((it) => it.question_id === q.id)).map((q) => ({ id: q.id, name: q.name })),
    owners: [...new Map(data.filter((d) => d.owner_id).map((d) => [d.owner_id, d.owner])).entries()].map(([id, name]) => ({ id, name })),
    results: FOLLOWUP_RESULTS,
    isManager: viewer.isManager,
  };
}
