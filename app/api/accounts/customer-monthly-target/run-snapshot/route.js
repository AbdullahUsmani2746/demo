import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { calculateAndStoreMonthlySalesTeamActuals } from "@/utils/monthlySalesTeamSnapshot";
import { guard } from "@/lib/auth/route";

// Manual trigger for the Sales Team MIS month-end snapshot (Locked Target
// Recovery), for a specific month - lets a user backfill/recompute a
// month the automatic cron (instrumentation.js, 1st @ 02:30 Asia/Karachi)
// missed, or refresh a month after correcting transactions.
// Only holders of salesTarget.monthEnd (Admin → Permissions → Approvals →
// "Sales Targets month-end") may run it; running it again for a locked month
// re-locks it with fresh figures.
// POST { year, month }
export const POST = guard("salesTarget.monthEnd", async (request) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { year, month } = await request.json();
  const y = Number(year);
  const m = Number(month);

  if (!y || !m || m < 1 || m > 12) {
    return NextResponse.json({ error: "A valid year and month (1-12) are required" }, { status: 400 });
  }

  try {
    const results = await calculateAndStoreMonthlySalesTeamActuals(m, y);
    return NextResponse.json({
      count: results.length,
      lockedAt: results[0]?.lockedAt ?? new Date(),
      year: y,
      month: m,
    });
  } catch (error) {
    console.error("Manual Sales Team MIS snapshot run failed:", error);
    return NextResponse.json({ error: "Failed to run month-end calculation" }, { status: 500 });
  }
});
