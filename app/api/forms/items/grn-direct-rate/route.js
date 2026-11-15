// GET /api/forms/items/grn-direct-rate?itcds=1,2,3
// → { itcds: [...] } the items whose rate is typed on the GRN (item or its
// category ticked) — Settings → Features "grn.directRateByItem"
// (lib/grn/directRate.js). Off → { itcds: [] }.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";
import { grnDirectRateItems, GRN_DIRECT_RATE_FEATURE } from "@/lib/grn/directRate";

export const GET = guard("grn.view", async (request) => {
  try {
    if (!(await feature(GRN_DIRECT_RATE_FEATURE))) return NextResponse.json({ itcds: [] });
    const itcds = String(new URL(request.url).searchParams.get("itcds") || "")
      .split(",")
      .map((v) => parseInt(v, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    const direct = await grnDirectRateItems(itcds);
    return NextResponse.json({ itcds: [...direct] });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load GRN rate rules", details: error.message }, { status: 500 });
  }
});
