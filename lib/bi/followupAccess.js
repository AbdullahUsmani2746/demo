// lib/bi/followupAccess.js — who sees / logs which follow-up.
//   · its owner (the customer's sales person) or the scenario's assignees
//   · whoever sees that sales person's customers (Permissions → Sales visibility:
//     All sales / Own + team) — managers see their team's follow-ups
//   · the approvers of the scenario's approval rules (config.followup.approverRules,
//     e.g. the Free of Cost / Trial Process rules) — every item of that scenario
//   · the people of the scenario's escalation steps
//   · ADMIN / ACCOUNTANT
import prisma from "@/lib/prisma";
import { hasFullAccess } from "@/lib/auth/permissions";
import { visibleSalesPersons } from "@/lib/auth/salesScope";
import { ruleApproverIds } from "@/lib/approvals/approvers";

const arr = (v) => (Array.isArray(v) ? v : []);

// Scenario ids (BiQuestion.id) whose approval rules this person approves
async function scenariosApprovedBy(me) {
  if (!me) return new Set();
  const qs = (await prisma.biQuestion.findMany({ select: { id: true, config: true } })).filter(
    (q) => q.config?.followup?.enabled && arr(q.config.followup.approverRules).length,
  );
  if (!qs.length) return new Set();
  const ruleIds = [...new Set(qs.flatMap((q) => arr(q.config.followup.approverRules).map(Number)))];
  const rules = await prisma.approvalRule.findMany({ where: { id: { in: ruleIds }, is_active: true } });
  const mine = new Set();
  for (const r of rules) if ((await ruleApproverIds(r)).map(String).includes(me)) mine.add(r.id);
  return new Set(qs.filter((q) => arr(q.config.followup.approverRules).map(Number).some((id) => mine.has(id))).map((q) => q.id));
}

export async function followupViewer(session) {
  const me = String(session?.user?.id || "");
  const full = hasFullAccess(session);
  const visible = full ? null : await visibleSalesPersons(session);
  const approverOf = full ? new Set() : await scenariosApprovedBy(me);
  return {
    me,
    full,
    // true when the person sees more than their own follow-ups
    isManager: full || visible === null || (Array.isArray(visible) && visible.length > 1) || approverOf.size > 0,
    canSee(item, scenario) {
      if (full) return true;
      const f = scenario?.config?.followup || {};
      if (scenario?.id != null && approverOf.has(scenario.id)) return true;
      if (item.owner_id && (visible === null || visible.includes(String(item.owner_id)))) return true;
      if (!item.owner_id && arr(f.assignees).map(String).includes(me)) return true;
      return arr(f.escalation).some((s) => arr(s.users).map(String).includes(me));
    },
  };
}
