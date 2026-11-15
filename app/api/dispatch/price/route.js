// GET /api/dispatch/price?pycd=2338&itcds=12,15&so_no=1201
//   Default rate / GST % for dispatch lines: the Sale Order line when one is
//   linked, else the customer's price list (lib/dispatch/linePricing.js) —
//   the same values the server stamps on save. `canOverride` tells the form
//   whether to let this user edit them.
//   → { canOverride, rates: { "<itcd>": { rate, st_rate, source } } }
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { defaultDispatchRates, RATE_OVERRIDE_PERMISSION } from "@/lib/dispatch/linePricing";

export async function GET(req) {
  try {
    await authorize(null);
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }

  try {
    const { searchParams } = new URL(req.url);
    const itcds = (searchParams.get("itcds") || searchParams.get("itcd") || "")
      .split(",")
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);
    const session = await getServerSession(authOptions);

    const defaults = await defaultDispatchRates({
      itcds,
      pycd: searchParams.get("pycd"),
      so_no: searchParams.get("so_no"),
    });

    return NextResponse.json({
      canOverride: await can(session, RATE_OVERRIDE_PERMISSION),
      rates: Object.fromEntries(defaults),
    });
  } catch (error) {
    console.error("GET /api/dispatch/price:", error);
    return NextResponse.json({ error: "Failed to load dispatch rates" }, { status: 500 });
  }
}
