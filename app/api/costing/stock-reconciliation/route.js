import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";
import { getStockGlReconciliation } from "@/lib/reconciliation/stockGl";

// GET /api/costing/stock-reconciliation?month=9&year=2026
// Stock Activity With Rate report vs GL stock accounts, with the difference
// split into causes. Read-only (lib/reconciliation/stockGl.js).
export const GET = guard("costing.reconcile", async (request) => {
  if (!(await feature("costing.reconciliation"))) {
    return NextResponse.json({ error: "Stock ↔ GL reconciliation is switched off on Settings → Features." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const month = parseInt(searchParams.get("month"));
  const year = parseInt(searchParams.get("year"));

  if (!month || month < 1 || month > 12 || !year) {
    return NextResponse.json({ error: "month (1-12) and year are required" }, { status: 400 });
  }

  try {
    const data = await getStockGlReconciliation({ month, year });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Stock reconciliation error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed to build reconciliation" }, { status: 500 });
  }
});
