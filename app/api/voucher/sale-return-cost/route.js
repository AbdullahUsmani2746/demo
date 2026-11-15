// app/api/voucher/sale-return-cost/route.js
// ============================================================
// GET ?tran_id=n          cost of a Sale Return line by line, at the rate of
//                          the month its dispatch was sold in (or each line's
//                          cost rate for a dispatch from before system start)
// GET ?start_rate_itcd=n  the system-start opening rate of one item — prefills
//                          the cost rate of a return of an old dispatch
// Features "saleReturn.costAtOriginalMonth" / "saleReturn.requireDispatchLink"
// (lib/costing/saleReturnCost.js). Read only.
// ============================================================
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { getSaleReturnCost, getSystemStartRates } from "@/lib/costing/saleReturnCost";
import { getStockActivityWithRateReport } from "@/app/api/reports/[reportType]/route";

export const GET = guard("saleReturn.view", async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const startItcd = parseInt(params.get("start_rate_itcd") || "0", 10);
    if (startItcd) {
      const { start, rates } = await getSystemStartRates([startItcd]);
      return NextResponse.json({
        rate: rates.get(startItcd)?.total_rate ?? 0,
        start_month: start ? `${String(start.month).padStart(2, "0")}/${start.year}` : null,
      });
    }
    const tranId = parseInt(params.get("tran_id") || "0", 10);
    if (!tranId) return NextResponse.json({ error: "tran_id is required" }, { status: 400 });
    const result = await getSaleReturnCost(tranId, getStockActivityWithRateReport);
    if (result.error) return NextResponse.json(result, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[sale-return-cost]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
