// app/api/followups/route.js — My Follow-ups (/dashboard/followups).
//   GET ?box=overdue|snoozed|done  → { data, counts, scenarios, owners, results, isManager }
//   GET ?count=1                   → { counts, any } (the sidebar badge: no refresh)
// Each person gets only their share — lib/bi/followupList.js.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { listFollowups } from "@/lib/bi/followupList";

export const GET = guard(null, async (req, { session }) => {
  const url = new URL(req.url);
  try {
    return NextResponse.json(
      await listFollowups(session, {
        box: url.searchParams.get("box") || "overdue",
        countOnly: url.searchParams.get("count") === "1",
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: /BiFollowup|does not exist/i.test(e.message) ? "Follow-ups are not set up yet (run prisma/sql/2026-10-25_bi_dashboards.sql)." : e.message },
      { status: 500 },
    );
  }
});
