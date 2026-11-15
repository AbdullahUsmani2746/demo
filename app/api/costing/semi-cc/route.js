// app/api/costing/semi-cc/route.js
// ============================================================
// Start month of "semi-finished goods receive conversion cost" — Settings →
// Features "costing.semiFinishedCC" (lib/costing/ccPolicy.js). The month is a
// setting value (Settings key costingSemiCcFrom), never code.
//   GET                                     → { feature, enabled, from }
//   POST { action: "enable", month, year }  → semi-finished receive CC from that month on
//   POST { action: "disable" }              → finished goods only
// Changing it is for holders of period.lock (the people who close costing
// months); it can't move across a locked costing month.
// ============================================================
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";
import {
  SEMI_CC_FEATURE, getSemiCcFrom, setSemiCcFrom, firstLockedFrom, monthLabel,
} from "@/lib/costing/ccPolicy";

export const GET = guard("costing.manage", async () => {
  const on = await feature(SEMI_CC_FEATURE);
  const from = await getSemiCcFrom({ fresh: true });
  return NextResponse.json({ feature: on, enabled: on && !!from, from });
});

export const POST = guard("period.lock", async (request) => {
  if (!(await feature(SEMI_CC_FEATURE))) {
    return NextResponse.json(
      { error: "Semi-finished conversion cost is switched off on Settings → Features." },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const current = await getSemiCcFrom({ fresh: true });

  if (body.action === "disable") {
    if (!current) return NextResponse.json({ feature: true, enabled: false, from: null });
    const locked = await firstLockedFrom(current);
    if (locked) {
      return NextResponse.json(
        { error: `${monthLabel(locked)} is locked and was costed with semi-finished CC. Unlock it first, or keep the setting.` },
        { status: 422 },
      );
    }
    await setSemiCcFrom(null);
    return NextResponse.json({ feature: true, enabled: false, from: null });
  }

  if (body.action === "enable") {
    const month = parseInt(body.month, 10);
    const year = parseInt(body.year, 10);
    if (!(month >= 1 && month <= 12) || !(year > 2000)) {
      return NextResponse.json({ error: "month and year are required" }, { status: 400 });
    }
    // The earlier of the old and new start is the first month whose rule changes
    const ym = (p) => p.year * 12 + p.month;
    const changedFrom = current && ym(current) < ym({ month, year }) ? current : { month, year };
    const locked = await firstLockedFrom(changedFrom);
    if (locked) {
      return NextResponse.json(
        { error: `${monthLabel(locked)} is locked. Semi-finished CC can only start after the last locked month.` },
        { status: 422 },
      );
    }
    await setSemiCcFrom({ month, year });
    return NextResponse.json({ feature: true, enabled: true, from: { month, year } });
  }

  return NextResponse.json({ error: "action must be enable or disable" }, { status: 400 });
});
