import { NextResponse } from "next/server";
import { invoicingRoute } from "@/lib/invoicing/route";
import { generateInvoices } from "@/lib/invoicing/core";

// POST /api/invoicing/[kind]/generate
// body { invoices: [ { tran_id, invoice_no?, lines: [ { line_id, rate, st_rate, ack_qty? } ],
//                      vendor_bill_no?, bill_date? } ] }      (vendor_bill_no / bill_date: purchase kinds)
// ack_qty: acknowledged qty in the line's billing unit (LTR lines: litres), ≥ 0, may exceed the billable qty;
//   omitted = keep the stored one, null = none (bill the full qty). See lib/invoicing/core.js.
// invoice_no blank → next number of the kind's series (consecutive in request order).
// → { results: [ { tran_id, status: "invoiced"|"blocked"|"failed", invoice_no?, message?, total? } ],
//     invoicedCount, failedCount }
export const POST = invoicingRoute("generate", async (req, { kind, session }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!Array.isArray(body?.invoices) || body.invoices.length === 0) {
    return NextResponse.json({ message: "invoices array is required" }, { status: 400 });
  }
  if (body.invoices.length > 500) {
    return NextResponse.json({ message: "At most 500 invoices per request" }, { status: 400 });
  }
  return NextResponse.json(await generateInvoices(kind, body.invoices, session));
});
