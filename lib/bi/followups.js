// lib/bi/followups.js — follow-ups from BI questions.
//
// Any table question can be a follow-up SCENARIO (BI Designer → question →
// "Follow-up"): config.followup = {
//   enabled,
//   key:        "d:<field>"  the column that identifies an item (e.g. SO No)
//   owner:      "sales_person" (the customer's sales person) | "assignees"
//   assignees:  [User.id]    who follows up when there is no sales person
//   escalation: [{ afterDays, users: [User.id], approvers }]  days AFTER it
//               is due; approvers: true → also the approvers below
//   approverRules: [ApprovalRule.id]  whoever approves these rules (Admin →
//               Permissions → Approvals) sees EVERY item of the scenario —
//               never a hard-coded person; change the rule, they change
//   notifyOnLog: true → the approvers are told each time a follow-up is logged
//   dueField:   "<date field>" + dueDays: n → an item is due n days after that
//               date (e.g. First Dispatch + 7); a row with no date is not a
//               follow-up yet. Without it: due from the first time it is flagged.
//   blockFoc:   true → a customer with an open follow-up of this scenario
//               cannot get a new Free of Cost / Trial Sale Order
// }
// Which rows need a follow-up = the question's highlight rules
// (visual.options.rowRules); none = every row.
//
// syncFollowups()   turns flagged rows into BiFollowup items (open), clears
//                   items whose row no longer qualifies; done items stay done.
// runEscalations()  daily: one summary per owner + escalation to the people of
//                   each step once an item is that many days overdue.
// Results: approved / not_suitable / other close it; more_time snoozes it to
// a date (due again then, escalation restarts).
import prisma from "@/lib/prisma";
import { runQuestion } from "@/lib/bi/engine";
import { datasetByKey } from "@/lib/bi/datasets";
import { rowFlag } from "@/components/bi/drill";
import { emit } from "@/lib/notifications/emit";
import { NOTIFICATION_TYPES } from "@/lib/notifications/config";
import { ruleApproverIds } from "@/lib/approvals/rules";

export const FOLLOWUP_RESULTS = [
  { key: "approved", label: "Customer approved — will order", closes: true, tone: "good" },
  { key: "not_suitable", label: "Not suitable", closes: true, tone: "bad" },
  { key: "more_time", label: "Needs more time", closes: false, tone: "warn" },
  { key: "other", label: "Other", closes: true, tone: "neutral" },
];
export const resultLabel = (k) => FOLLOWUP_RESULTS.find((r) => r.key === k)?.label ?? k;

const DAY = 24 * 60 * 60 * 1000;
// The sync runs as a full-access reader: what each PERSON sees of the items is
// limited later, by owner / their sales visibility.
const SYSTEM_SESSION = { user: { id: "system-followups", role: "ADMIN", name: "Follow-ups" } };

const arr = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/**
 * The approvers of a scenario: whoever approves its approverRules (users and
 * roles on the rule, active users only). [] when it names no rule.
 */
export async function scenarioApproverIds(f) {
  const ids = arr(f?.approverRules).map(Number).filter(Number.isFinite);
  if (!ids.length) return [];
  const rules = await prisma.approvalRule.findMany({ where: { id: { in: ids }, is_active: true } });
  const users = new Set();
  for (const r of rules) for (const id of await ruleApproverIds(r)) users.add(String(id));
  return [...users];
}

/** Scenario questions: every BiQuestion with config.followup.enabled. */
export async function scenarioQuestions() {
  const qs = await prisma.biQuestion.findMany();
  return qs.filter((q) => q.config?.followup?.enabled && q.config?.followup?.key);
}

let lastSync = 0;
/** Sync, but not more often than every `minutes` (pages call this on open). */
export async function maybeSync(minutes = 15) {
  if (Date.now() - lastSync < minutes * 60 * 1000) return null;
  lastSync = Date.now();
  try {
    return await syncFollowups();
  } catch (e) {
    console.error("[followups] sync failed:", e);
    return null;
  }
}

export async function syncFollowups() {
  lastSync = Date.now();
  const out = [];
  for (const q of await scenarioQuestions()) {
    try {
      out.push({ question: q.id, ...(await syncOne(q)) });
    } catch (e) {
      console.error(`[followups] question ${q.id} failed:`, e?.message);
      out.push({ question: q.id, error: e?.message });
    }
  }
  return out;
}

async function syncOne(q) {
  const cfg = JSON.parse(JSON.stringify(q.config));
  const f = cfg.followup;
  const ds = datasetByKey(cfg.dataset);
  if (!ds) return { skipped: "dataset" };

  const keyField = String(f.key).replace(/^d:/, "");
  const shownDims = arr(cfg.dimensions);
  const dims = [...shownDims];
  if (!dims.some((d) => d.field === keyField)) dims.unshift({ field: keyField });
  const ownerField = ds.followup?.owner;
  const partyField = ds.followup?.party;
  if (ownerField && !dims.some((d) => d.field === ownerField)) dims.push({ field: ownerField });
  if (partyField && !dims.some((d) => d.field === partyField)) dims.push({ field: partyField });
  const dueField = f.dueField ? String(f.dueField).replace(/^d:/, "") : null;
  if (dueField && !dims.some((d) => d.field === dueField)) dims.push({ field: dueField });
  cfg.dimensions = dims;
  cfg.__internalDims = true;
  cfg.limit = 5000;

  const result = await runQuestion(cfg, { session: SYSTEM_SESSION });
  const cols = result.columns;
  const keyCol = cols.find((c) => c.role === "dimension" && c.field === keyField);
  if (!keyCol) return { skipped: "key column" };
  const ownerCol = ownerField ? cols.find((c) => c.role === "dimension" && c.field === ownerField) : null;
  const partyCol = partyField ? cols.find((c) => c.role === "dimension" && c.field === partyField) : null;
  const dueCol = dueField ? cols.find((c) => c.role === "dimension" && c.field === dueField) : null;
  const dueDays = Number(f.dueDays) || 0;
  const labelCols = cols.filter((c) => c.role === "dimension" && shownDims.some((d) => d.field === c.field));
  const rules = cfg.visual?.options?.rowRules;
  const hasRules = Array.isArray(rules) && rules.length > 0;

  const flagged = new Map();
  for (const row of result.rows) {
    const flag = hasRules ? rowFlag(row, cols, rules) : { label: "Follow up" };
    if (!flag) continue;
    const key = text(row[keyCol.key]).slice(0, 150);
    if (!key) continue;
    // Due n days after the row's date (e.g. First Dispatch + 7); no date yet =
    // not a follow-up yet (e.g. not dispatched)
    let due = null;
    if (dueCol) {
      const base = row[dueCol.key] ? new Date(row[dueCol.key]) : null;
      if (!base || Number.isNaN(base.getTime())) continue;
      due = new Date(base.getTime() + dueDays * DAY);
    }
    flagged.set(key, {
      due,
      label: labelCols.map((c) => text(row[c.key])).filter(Boolean).join(" · ").slice(0, 400) || key,
      flag: (flag.label || "Follow up").slice(0, 80),
      owner: ownerCol && f.owner !== "assignees" ? text(row[ownerCol.key]) || null : null,
      party: partyCol ? Number(row[partyCol.key]) || null : null,
    });
  }

  const existing = await prisma.biFollowup.findMany({ where: { question_id: q.id } });
  const byKey = new Map(existing.map((e) => [e.item_key, e]));
  const now = new Date();
  let created = 0, reopened = 0, cleared = 0;

  for (const [key, it] of flagged) {
    const ex = byKey.get(key);
    const data = { item_label: it.label, flag_label: it.flag, owner_id: it.owner, party_id: it.party, last_seen: now };
    if (!ex) {
      await prisma.biFollowup.create({ data: { question_id: q.id, item_key: key, ...data, status: "open", due_since: it.due ?? now } });
      created++;
    } else if (ex.status === "cleared") {
      await prisma.biFollowup.update({ where: { id: ex.id }, data: { ...data, status: "open", due_since: it.due ?? now, level: 0, next_date: null } });
      reopened++;
    } else if (ex.status === "open") {
      // Not logged yet: its due date follows the row's date (a snoozed item
      // keeps the date it was snoozed to)
      const due = it.due && !ex.result && new Date(ex.due_since).getTime() !== it.due.getTime() ? { due_since: it.due } : {};
      await prisma.biFollowup.update({ where: { id: ex.id }, data: { ...data, ...due } });
    }
  }
  // Rows that no longer qualify (e.g. the order was closed) stop being due.
  const gone = existing.filter((e) => e.status === "open" && !flagged.has(e.item_key)).map((e) => e.id);
  if (gone.length) {
    const r = await prisma.biFollowup.updateMany({ where: { id: { in: gone } }, data: { status: "cleared" } });
    cleared = r.count;
  }
  return { flagged: flagged.size, created, reopened, cleared };
}

/** Who acts on an item: its owner, else the scenario's assignees. */
const actorsOf = (item, f) => (item.owner_id ? [item.owner_id] : arr(f?.assignees).map(String));

/**
 * Daily: escalations + one summary per person. Run from instrumentation.js.
 * An item is overdue once due_since has passed (snoozed items are in future).
 */
export async function runEscalations() {
  await syncFollowups();
  const now = Date.now();
  const scenarios = new Map((await scenarioQuestions()).map((q) => [q.id, q]));
  const items = await prisma.biFollowup.findMany({
    where: { status: "open", question_id: { in: [...scenarios.keys()] }, due_since: { lte: new Date() } },
  });

  const digest = new Map(); // userId → items they own
  const escalated = new Map(); // userId → items escalated to them
  const push = (m, uid, x) => {
    if (!uid) return;
    if (!m.has(uid)) m.set(uid, []);
    m.get(uid).push(x);
  };

  const approversOf = new Map();
  for (const [id, q] of scenarios) approversOf.set(id, await scenarioApproverIds(q.config.followup));

  for (const it of items) {
    const q = scenarios.get(it.question_id);
    const f = q.config.followup;
    const overdueDays = Math.floor((now - new Date(it.due_since).getTime()) / DAY);
    const x = { ...it, scenario: q.name, overdueDays };
    for (const uid of actorsOf(it, f)) push(digest, uid, x);

    // `level` = how many steps (in afterDays order) the item has reached, so
    // the index used here must be the SORTED one — the order the steps were
    // typed in is irrelevant.
    const steps = arr(f.escalation)
      .slice()
      .sort((a, b) => (Number(a.afterDays) || 0) - (Number(b.afterDays) || 0));
    let level = it.level;
    steps.forEach((s, k) => {
      if (k < it.level) return;
      if (overdueDays >= (Number(s.afterDays) || 0)) {
        const to = new Set([...arr(s.users).map(String), ...(s.approvers ? approversOf.get(it.question_id) : [])]);
        for (const uid of to) push(escalated, uid, x);
        level = Math.max(level, k + 1);
      }
    });
    if (level !== it.level) await prisma.biFollowup.update({ where: { id: it.id }, data: { level } });
  }

  const list = (xs) =>
    xs
      .slice(0, 5)
      .map((x) => `${x.item_label} (${x.overdueDays}d)`)
      .join("; ");
  for (const [uid, xs] of digest) {
    await emit(prisma, "followupDigest", {
      title: `${xs.length} follow-up${xs.length === 1 ? "" : "s"} due`,
      message: `${list(xs)}${xs.length > 5 ? ` … +${xs.length - 5} more` : ""}`.slice(0, 500),
      type: NOTIFICATION_TYPES.WARNING,
      entity: "followups",
      extraUserIds: [uid],
      vars: { count: xs.length, list: list(xs) },
    }).catch(() => {});
  }
  for (const [uid, xs] of escalated) {
    await emit(prisma, "followupEscalated", {
      title: `${xs.length} overdue follow-up${xs.length === 1 ? "" : "s"} escalated to you`,
      message: `${list(xs)}${xs.length > 5 ? ` … +${xs.length - 5} more` : ""}`.slice(0, 500),
      type: NOTIFICATION_TYPES.ERROR,
      entity: "followups",
      extraUserIds: [uid],
      vars: { count: xs.length, list: list(xs) },
    }).catch(() => {});
  }
  return { due: items.length, owners: digest.size, escalatedTo: escalated.size };
}

/**
 * Open (due) follow-ups that block a new Free of Cost / Trial Sale Order for
 * this customer — scenarios with followup.blockFoc. [] = not blocked.
 */
export async function blockingFollowups(partyId) {
  const id = Number(partyId);
  if (!Number.isFinite(id)) return [];
  try {
    const scen = (await scenarioQuestions()).filter((q) => q.config.followup.blockFoc);
    if (!scen.length) return [];
    return await prisma.biFollowup.findMany({
      where: { party_id: id, status: "open", due_since: { lte: new Date() }, question_id: { in: scen.map((q) => q.id) } },
      select: { id: true, item_key: true, item_label: true, due_since: true },
      take: 5,
    });
  } catch {
    return []; // follow-ups not set up yet
  }
}

/**
 * Log a follow-up. approved / not_suitable / other close it; more_time snoozes
 * it to nextDate (due again then, escalation restarts).
 */
export async function logFollowup({ id, userId, userName = null, result, remarks, nextDate }) {
  const def = FOLLOWUP_RESULTS.find((r) => r.key === result);
  if (!def) throw new Error("Choose a result.");
  const note = remarks ? String(remarks).trim().slice(0, 1000) : "";
  if (!note) throw new Error("Write what the customer said.");
  let next = null;
  if (!def.closes) {
    next = nextDate ? new Date(nextDate) : null;
    if (!next || Number.isNaN(next.getTime()) || next.getTime() <= Date.now()) throw new Error("Pick the date to follow up again (in the future).");
  }
  const data = def.closes
    ? { status: "done", result: def.key, remarks: note, done_at: new Date(), done_by: userId, next_date: null }
    : { status: "open", result: def.key, remarks: note, next_date: next, due_since: next, level: 0 };
  const [item] = await prisma.$transaction([
    prisma.biFollowup.update({ where: { id: Number(id) }, data }),
    prisma.biFollowupNote.create({ data: { followup_id: Number(id), user_id: userId, result: def.key, remarks: note } }),
  ]);
  notifyLogged(item, { userId, userName, def, note, next }).catch((e) => console.error("[followups] notify failed:", e?.message));
  return item;
}

// Scenario with notifyOnLog: the approvers hear what was logged (not the
// person who logged it). In the background — the log is saved either way.
async function notifyLogged(item, { userId, userName, def, note, next }) {
  const q = await prisma.biQuestion.findUnique({ where: { id: item.question_id } });
  const f = q?.config?.followup;
  if (!f?.notifyOnLog) return;
  const to = (await scenarioApproverIds(f)).filter((uid) => uid !== String(userId));
  if (!to.length) return;
  const outcome = def.closes ? def.label : `${def.label} — again on ${next.toLocaleDateString("en-GB")}`;
  await emit(prisma, "followupLogged", {
    title: `Follow-up logged: ${item.item_label || item.item_key}`.slice(0, 200),
    message: `${userName || "Sales person"}: ${outcome}. "${note}"`.slice(0, 500),
    type: def.tone === "bad" ? NOTIFICATION_TYPES.WARNING : NOTIFICATION_TYPES.INFO,
    entity: "followups",
    entityId: String(item.id),
    extraUserIds: to,
    vars: { item: item.item_label || item.item_key, by: userName || "", result: outcome, remarks: note, scenario: q.name },
  });
}
