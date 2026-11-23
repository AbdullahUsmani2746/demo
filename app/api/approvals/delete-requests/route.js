// app/api/approvals/delete-requests/route.js — "Request deletion" on a voucher /
// order list (lib/approvals/deletions.js).
//   POST { type, id, reason } → 202, held on /dashboard/approvals
//   GET  ?type=&ids=1,2,3     → { pending: { "<id>": requestId } } — rows already asked for
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { REQUEST_STATUS } from "@/lib/approvals/rules";
import { DELETE_ACTION, kindOf, requestDeletion } from "@/lib/approvals/deletions";

export const POST = guard(null, async (req, { session }) => {
  const { type, id, reason } = await req.json().catch(() => ({}));
  return requestDeletion({ session, type: String(type || ""), id, reason });
});

export const GET = guard(null, async (req) => {
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") || "";
  const ids = (sp.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (!type || !ids.length) return NextResponse.json({ pending: {} });
  const rows = await prisma.approvalRequest.findMany({
    where: {
      kind: kindOf(type),
      action: DELETE_ACTION,
      target_id: { in: ids },
      status: { in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.POSTING] },
    },
    select: { id: true, target_id: true },
  });
  return NextResponse.json({ pending: Object.fromEntries(rows.map((r) => [r.target_id, r.id])) });
});
