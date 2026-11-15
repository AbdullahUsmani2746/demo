import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";
import { traceItemCosting, scanAllItemsCosting } from "@/lib/reconciliation/itemTrace";

// Item cost trace (ported from Accounting) — read-only.
// GET /api/costing/item-reconciliation?itcd=123&month=9&year=2026   → full trace of one item
// GET /api/costing/item-reconciliation?scope=all&month=9&year=2026  → every item checked, grouped by cause
// Add &fresh=1 to ignore the 10-minute cache of the month's data.
// Settings → Features "costing.reconciliation" switches the screen on.
export const GET = guard("costing.reconcile", async (request) => {
  if (!(await feature("costing.reconciliation"))) {
    return NextResponse.json({ error: "Costing reconciliation is switched off on Settings → Features." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope");
  const itcd = parseInt(searchParams.get("itcd"));
  const month = parseInt(searchParams.get("month"));
  const year = parseInt(searchParams.get("year"));
  const fresh = searchParams.get("fresh") === "1";

  if (!month || month < 1 || month > 12 || !year || (scope !== "all" && !itcd)) {
    return NextResponse.json({ error: "month (1-12), year and itcd (or scope=all) are required" }, { status: 400 });
  }

  try {
    const data = scope === "all"
      ? await scanAllItemsCosting({ month, year, fresh })
      : await traceItemCosting({ itcd, month, year, fresh });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Item reconciliation error:", err);
    const status = err?.status || err?.statusCode || 500;
    return NextResponse.json({ error: err?.message ?? "Failed to trace item" }, { status });
  }
});
