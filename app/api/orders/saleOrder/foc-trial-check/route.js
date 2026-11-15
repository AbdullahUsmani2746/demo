// /api/orders/saleOrder/foc-trial-check — feature "saleOrder.focTrialWarning"
// (ported from Eastland). The Sale Order form asks, as products are picked on a
// Free of Cost order (or Trial lines), whether this customer already had any of
// them as Free of Cost / Trial on an earlier Sale Order (rejected ones aside).
// The form shows the message and cannot be saved; the orders route refuses the
// same save (lib/orders/saleOrderChecks.js focTrialError).
//   GET ?party_code=2001&itcd=601,602[&exclude=<order being edited>] → { message | null }
// Switched off → { message: null, enabled: false }.
import { NextResponse } from "next/server";
import { guardBy } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";
import { focTrialHistory } from "@/lib/orders/saleOrderChecks";

export const GET = guardBy(
  (req) => `saleOrder.${new URL(req.url).searchParams.get("exclude") ? "update" : "create"}`,
  async (req) => {
    if (!(await feature("saleOrder.focTrialWarning"))) return NextResponse.json({ message: null, enabled: false });
    const p = new URL(req.url).searchParams;
    const message = await focTrialHistory({
      party: Number(p.get("party_code")),
      itcds: (p.get("itcd") || "").split(","),
      exclude: Number(p.get("exclude")) || null,
    });
    return NextResponse.json({ message, enabled: true });
  },
);
