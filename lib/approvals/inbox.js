// lib/approvals/inbox.js — who decides what in the Approvals inbox
// (/dashboard/approvals). One definition, used by the inbox list
// (GET /api/approvals/requests) and the header button's count
// (GET /api/approvals/count), so the badge never disagrees with the inbox.
//
//   ApprovalRequest  rules this person approves (canDecide — approver users /
//                    roles on the rule; Super Admin approves every rule)
//                    + HR request types whose approval permission they hold
//                    + HR requests in an approval chain whose CURRENT step is
//                      theirs (step_users; Super Admin: every step)
//   follows          chained HR requests they watch or already acted on —
//                    listed (not counted, not decidable) so they see the status
//   Sale Orders      approverScope() in lib/approvals/saleOrders.js
import prisma from "@/lib/prisma";
import { canDecide, REQUEST_STATUS, selfDecisionError } from "@/lib/approvals/rules";
import { hasOwnSaleOrderApprovals, saleOrderBadge } from "@/lib/approvals/saleOrders";
import { hrTypesDecidableBy } from "@/lib/hr/approvals";
import { HR_KIND } from "@/lib/hr/approvalTypes";
import { isSuperAdmin } from "@/lib/auth/roles";

/** Rules + HR types this person decides, and the request `where` for them. */
export async function inboxScope(session) {
  const me = session.user.id;
  const superAdmin = isSuperAdmin(session);
  const [rules, hrTypes, chains] = await Promise.all([
    prisma.approvalRule.findMany(),
    hrTypesDecidableBy(session),
    prisma.hrApprovalChain.findMany({ where: { is_active: true }, select: { steps: true, watchers: true } }).catch(() => []),
  ]);
  const ruleIds = rules.filter((r) => canDecide(session, r)).map((r) => r.id);
  const chainStep = superAdmin
    ? { kind: HR_KIND, chain_id: { not: null } }
    : { kind: HR_KIND, chain_id: { not: null }, step_users: { has: me } };
  const decides = {
    OR: [
      { rule_id: { in: ruleIds } },
      ...(hrTypes.length ? [{ kind: HR_KIND, doc_type: { in: hrTypes }, chain_id: null }] : []),
      chainStep,
    ],
  };
  const follows = { kind: HR_KIND, chain_id: { not: null }, OR: [{ watchers: { has: me } }, { chain_actors: { has: me } }] };
  // Named on a step or as a watcher of an active chain → they have an inbox.
  const inChains = chains.some(
    (c) =>
      (Array.isArray(c.watchers) && c.watchers.map(String).includes(me)) ||
      (Array.isArray(c.steps) && c.steps.some((s) => (s.users ?? []).map(String).includes(me))),
  );
  return { ruleIds, hrTypes, decides, follows, isApprover: ruleIds.length > 0 || hrTypes.length > 0 || inChains };
}

/**
 * The header Approvals button: pending items this person may approve or
 * reject NOW — the inbox scope, status pending (not "posting"), minus their
 * own requests unless they may decide their own (selfDecisionError: Super Admin).
 *   → { count, isApprover, hasOwn }
 * hasOwn (any request / Sale Order of their own in the inbox) is only worked
 * out for people who approve nothing — it decides whether they still get an
 * "Approvals" entry to follow their own requests.
 */
export async function approvalsBadge(session) {
  const me = session.user.id;
  const excludeOwn = Boolean(selfDecisionError(session, { requested_by: me }));
  const [scope, so] = await Promise.all([inboxScope(session), saleOrderBadge(session)]);
  const isApprover = scope.isApprover || so.isApprover;

  const [requests, ownRequest, ownOrder] = await Promise.all([
    scope.isApprover
      ? prisma.approvalRequest.count({
          where: { ...scope.decides, status: REQUEST_STATUS.PENDING, ...(excludeOwn ? { requested_by: { not: me } } : {}) },
        })
      : 0,
    isApprover ? null : prisma.approvalRequest.findFirst({ where: { requested_by: me }, select: { id: true } }),
    isApprover ? false : hasOwnSaleOrderApprovals(session),
  ]);

  return { count: requests + so.count, isApprover, hasOwn: isApprover || Boolean(ownRequest) || ownOrder };
}
