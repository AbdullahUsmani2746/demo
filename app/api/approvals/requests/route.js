// app/api/approvals/requests/route.js — the Approvals inbox (/dashboard/approvals).
//
//   GET ?box=inbox    pending requests this person may decide (approver of the rule),
//                     plus ones being posted right now (status "posting")
//   GET ?box=mine     requests this person submitted (any status)
//   GET ?box=history  decided requests of rules this person approves
//   HR requests (kind "hr") have no rule: they count as "this person's" when
//   they hold the HR type's approval permission (lib/hr/approvals.js).
//   Sale Orders waiting for approval (OrderMaster status 3 — not requests)
//   are listed beside them, id "so-<order_no>" (lib/approvals/saleOrders.js).
//   → { data, counts: { inbox, mine }, isApprover }
//   The header button polls GET /api/approvals/count instead (cheap, same scope).
//   Each row: can_decide = this person may approve / reject it now (pending,
//   theirs to decide, not their own request — ADMIN excepted).
// Every signed-in user may call it; each box only ever shows their own share.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { formLabel, REQUEST_STATUS, selfDecisionError } from "@/lib/approvals/rules";
import { saleOrderRows } from "@/lib/approvals/saleOrders";
import { inboxScope } from "@/lib/approvals/inbox";

export const GET = guard(null, async (req, { session }) => {
  const box = new URL(req.url).searchParams.get("box") || "inbox";
  const me = session.user.id;
  // Same scope as the header button's count (lib/approvals/inbox.js).
  const { ruleIds, hrTypes, decides } = await inboxScope(session);

  const where =
    box === "mine"
      ? { requested_by: me }
      : box === "history"
        ? { ...decides, status: { notIn: [REQUEST_STATUS.PENDING, REQUEST_STATUS.POSTING] } }
        : // "posting" ones stay listed (shown as in progress) but are not decidable
          { ...decides, status: { in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.POSTING] } };

  const [rows, inbox, mine, so] = await Promise.all([
    prisma.approvalRequest.findMany({
      where,
      orderBy: box === "inbox" ? { requested_at: "asc" } : { updated_at: "desc" },
      take: 300,
      select: {
        id: true, kind: true, action: true, target_id: true, rule_id: true, rule_name: true, doc_type: true, status: true, summary: true,
        requested_by: true, requested_at: true, decided_by: true, decided_at: true, remarks: true,
        posted_no: true, posted_tran_id: true, post_error: true, updated_at: true,
      },
    }),
    prisma.approvalRequest.count({ where: { ...decides, status: REQUEST_STATUS.PENDING } }),
    prisma.approvalRequest.count({ where: { requested_by: me, status: REQUEST_STATUS.PENDING } }),
    saleOrderRows(session, box),
  ]);

  const ids = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));

  // In the inbox every row is one this person approves (the where above); a
  // requester sees their own there too, but may not decide it.
  const decidable = (r) => box !== "mine" && r.status === REQUEST_STATUS.PENDING && !selfDecisionError(session, r);
  const data = [
    ...rows.map((r) => ({
      ...r,
      target_no: r.target_id,
      form: formLabel(r.doc_type),
      requested_by_name: nameOf.get(r.requested_by) || r.requested_by,
      decided_by_name: r.decided_by ? nameOf.get(r.decided_by) || r.decided_by : null,
      mine: r.requested_by === me,
      can_decide: decidable(r),
      can_approve: decidable(r),
    })),
    ...so.rows,
  ];
  // Oldest waiting first in the inbox; newest first elsewhere.
  const t = (r) => new Date(box === "inbox" ? r.requested_at : r.decided_at || r.updated_at || r.requested_at).getTime() || 0;
  data.sort((a, b) => (box === "inbox" ? t(a) - t(b) : t(b) - t(a)));

  return NextResponse.json({
    data,
    counts: { inbox: inbox + so.counts.inbox, mine: mine + so.counts.mine },
    isApprover: ruleIds.length > 0 || hrTypes.length > 0 || so.isApprover,
  });
});
