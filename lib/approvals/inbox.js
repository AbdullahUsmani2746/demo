// lib/approvals/inbox.js — who decides what in the Approvals inbox
// (/dashboard/approvals). One definition, used by the inbox list
// (GET /api/approvals/requests) and the header button's count
// (GET /api/approvals/count), so the badge never disagrees with the inbox.
//
//   ApprovalRequest  rules this person approves (canDecide — approver users /
//                    roles on the rule; Super Admin approves every rule)
//                    + HR request types whose approval permission they hold
//   Sale Orders      approverScope() in lib/approvals/saleOrders.js
import prisma from "@/lib/prisma";
import { canDecide, REQUEST_STATUS, selfDecisionError } from "@/lib/approvals/rules";
import { hasOwnSaleOrderApprovals, saleOrderBadge } from "@/lib/approvals/saleOrders";
import { hrTypesDecidableBy } from "@/lib/hr/approvals";
import { HR_KIND } from "@/lib/hr/approvalTypes";

/** Rules + HR types this person decides, and the request `where` for them. */
export async function inboxScope(session) {
  const [rules, hrTypes] = await Promise.all([prisma.approvalRule.findMany(), hrTypesDecidableBy(session)]);
  const ruleIds = rules.filter((r) => canDecide(session, r)).map((r) => r.id);
  const decides = { OR: [{ rule_id: { in: ruleIds } }, ...(hrTypes.length ? [{ kind: HR_KIND, doc_type: { in: hrTypes } }] : [])] };
  return { ruleIds, hrTypes, decides, isApprover: ruleIds.length > 0 || hrTypes.length > 0 };
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
