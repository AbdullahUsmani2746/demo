// /api/invoicing/[kind]/trial-items — Sale Invoicing → "Approved trial items"
// (feature "orders.trialLineBilling", lib/dispatch/trialBilling.js). Sale only.
//
//   GET   items dispatched on Trial / Rate Negotiation and not billed yet:
//         approved (Sale Order line now Normal with a rate) or still waiting
//         (invoicing.sale.view)
//   POST  { tran_id, itcds? } — bill the approved ones of that trial dispatch:
//         MOVES those lines into a billing part of the dispatch (1234-2, same
//         date — no Sale Return, stock unchanged), then invoiced like any
//         dispatch (invoicing.sale.generate)
// Switched off → GET { enabled: false, data: [] }, POST 403.
import { NextResponse } from "next/server";
import { invoicingRoute } from "@/lib/invoicing/route";
import { feature } from "@/lib/features/server";
import { documentScopeWhere } from "@/lib/auth/documentScope";
import { setAuditActor } from "@/lib/audit/context";
import { approvedTrialItems, billApprovedTrialItems } from "@/lib/dispatch/trialBilling";

const saleOnly = (kind) =>
  kind === "sale" ? null : NextResponse.json({ message: "Approved trial items are billed on Sale Invoicing only" }, { status: 400 });

export const GET = invoicingRoute("view", async (req, { kind, session }) => {
  const wrong = saleOnly(kind);
  if (wrong) return wrong;
  if (!(await feature("orders.trialLineBilling"))) return NextResponse.json({ enabled: false, data: [] });
  // only dispatches of the user's godowns, as the invoicing list
  const data = await approvedTrialItems({ scope: await documentScopeWhere(session, 6) });
  return NextResponse.json({ enabled: true, data });
});

export const POST = invoicingRoute("generate", async (req, { kind, session }) => {
  const wrong = saleOnly(kind);
  if (wrong) return wrong;
  if (!(await feature("orders.trialLineBilling"))) {
    return NextResponse.json({ message: "Trial line billing is switched off (Settings → Features)." }, { status: 403 });
  }
  setAuditActor(session);
  const body = await req.json().catch(() => ({}));
  const tranId = Number(body?.tran_id);
  if (!tranId) return NextResponse.json({ message: "tran_id is required" }, { status: 400 });
  const itcds = Array.isArray(body?.itcds) ? body.itcds.map(Number).filter(Boolean) : null;
  const { status, body: out } = await billApprovedTrialItems({ tranId, itcds, scope: await documentScopeWhere(session, 6) });
  return NextResponse.json(out, { status });
});
