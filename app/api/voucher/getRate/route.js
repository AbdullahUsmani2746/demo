import { NextResponse } from "next/server";
import { averageRate } from "@/lib/stock/averageRate";

/**
 * GET /api/voucher/getRate?itcd=<id>&date=<YYYY-MM-DD>
 *
 * Weighted average rate of an item for the month of `date` (default today):
 *   (opening_value + purchases − purchase returns) / (opening qty + net purchase qty)
 * falling back to the opening rate, then the last purchase rate
 * (lib/stock/averageRate.js — shared with the dispatch BOM issue).
 */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const itcdParam = url.searchParams.get("itcd");
    const dateParam = url.searchParams.get("date");

    if (!itcdParam) {
      return NextResponse.json({ error: "itcd is required" }, { status: 400 });
    }

    const itcd = parseInt(itcdParam, 10);
    if (isNaN(itcd)) {
      return NextResponse.json({ error: "itcd must be a number" }, { status: 400 });
    }

    return NextResponse.json(await averageRate(itcd, dateParam ? new Date(dateParam) : new Date()));
  } catch (error) {
    console.error("getRate error:", error);
    return NextResponse.json(
      { error: "Failed to calculate average rate", details: error.message },
      { status: 500 }
    );
  }
}
