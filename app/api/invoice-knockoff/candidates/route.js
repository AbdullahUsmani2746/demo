import { NextResponse } from "next/server";
import { findCandidateLines, round2 } from "@/lib/ledger/invoiceMatcher";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";

// Unmatched / partially-matched Receipt/Payment/JV lines awaiting review.
// GET /api/invoice-knockoff/candidates?partyType=customer|vendor&acno=123
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const partyType = url.searchParams.get("partyType") || undefined;
    const acno = url.searchParams.get("acno") || undefined;

    const [rows, customerMacnos] = await Promise.all([
      findCandidateLines({ partyType, acno }),
      getCustomerMacnos(),
    ]);

    const data = rows
      .map((row) => {
        const lineAmount = round2(row.line_amount);
        const alreadyAllocated = round2(row.already_allocated);
        return {
          lineId: row.line_id,
          sourceTranId: row.source_tran_id,
          partyAcno: Number(row.source_acno),
          partyName: row.party_name,
          partyType: customerMacnos.includes(Number(row.macno)) ? "customer" : "vendor",
          tranCode: row.tran_code,
          dated: row.dated,
          vrNo: row.vr_no,
          lineAmount,
          alreadyAllocated,
          // Signed — a debit-note JV is negative (it re-opens invoices).
          remaining: round2(lineAmount - alreadyAllocated),
        };
      })
      .filter((row) => Math.abs(row.remaining) > 0.01);

    return NextResponse.json({ success: true, data, total: data.length });
  } catch (error) {
    console.error("Error fetching invoice knock-off candidates:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch candidates", error: error.message },
      { status: 500 },
    );
  }
}
