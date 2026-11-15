// app/api/approvals/count/route.js — the header Approvals button
// (components/approvals/ApprovalsButton.jsx).
//
//   GET → { count, isApprover, hasOwn }
//     count       pending approvals this person may approve / reject now —
//                 the inbox scope (lib/approvals/inbox.js), not their own
//     isApprover  decides anything at all (approval rules, HR approval
//                 permissions, Sale Order approval) — no button without it
//     hasOwn      has requests of their own to follow (non-approvers only)
// Counts only — no rows, no user names. The button polls it every 45 s while
// the tab is visible and on focus. Every signed-in user may call it.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { approvalsBadge } from "@/lib/approvals/inbox";

export const GET = guard(null, async (_req, { session }) => {
  const badge = await approvalsBadge(session);
  return NextResponse.json(badge, { headers: { "Cache-Control": "no-store" } });
});
