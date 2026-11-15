import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  round2,
  sourceTypeFromTranCode,
  getSettlementLineGroup,
  resyncLineSplit,
  upsertGroupAllocation,
  RETURN_TRAN_CODES,
} from "@/lib/ledger/invoiceMatcher";
import { guard } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";

// GET — active allocations, filterable by source_tran_id / source_line_id / invoice_no / acno
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const sourceTranId = url.searchParams.get("source_tran_id");
    const sourceLineId = url.searchParams.get("source_line_id");
    const invoiceNo = url.searchParams.get("invoice_no");
    const acno = url.searchParams.get("acno");

    const where = { reversed_at: null };
    if (sourceTranId) where.source_tran_id = Number(sourceTranId);
    if (sourceLineId) where.source_line_id = Number(sourceLineId);
    if (invoiceNo) where.invoice_no = invoiceNo;
    if (acno) where.invoice_party_acno = Number(acno);

    const data = await prisma.invoiceKnockoff.findMany({
      where,
      orderBy: { created_at: "desc" },
      include: { createdByUser: { select: { name: true, email: true } } },
    });

    return NextResponse.json({ success: true, data, total: data.length });
  } catch (error) {
    console.error("Error fetching invoice knock-offs:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch allocations", error: error.message },
      { status: 500 },
    );
  }
}

// POST — manual (re)assignment. Body: { source_line_id, allocations: [{ invoice_no, amount }] }
// Replaces whatever active allocation(s) currently exist for that line (soft-reverses
// them) with the new set, so this also serves as the "override an auto-match" path.
export const POST = guard("knockoff.allocate", async (req, { session }) => {
  try {
    const userId = session?.user?.id ?? null;

    const body = await req.json();
    const sourceLineId = Number(body?.source_line_id);
    const allocations = Array.isArray(body?.allocations) ? body.allocations : [];

    if (!sourceLineId) {
      return NextResponse.json({ message: "source_line_id is required" }, { status: 400 });
    }
    if (allocations.length === 0) {
      return NextResponse.json({ message: "At least one allocation is required" }, { status: 400 });
    }
    for (const a of allocations) {
      // Amounts are signed: a debit-note JV allocates negative (it re-opens
      // the invoice). Zero is the only value that means nothing.
      if (!a?.invoice_no || !Number.isFinite(Number(a?.amount)) || Number(a.amount) === 0) {
        return NextResponse.json(
          { message: "Each allocation needs a non-empty invoice_no and a non-zero amount" },
          { status: 400 },
        );
      }
    }

    // The line may already be split into one row per invoice, so validate
    // against the group's original posted amount rather than one slice.
    const group = await getSettlementLineGroup(prisma, sourceLineId);
    if (!group) {
      return NextResponse.json({ message: "Voucher line not found" }, { status: 404 });
    }

    const { root, sliceIds, total: lineAmount } = group;
    const tranCode = root.transactionsMaster.tran_code;
    // Returns are knocked off only with Settings → Features "knockoff.matchReturns".
    if (RETURN_TRAN_CODES.includes(Number(tranCode)) && !(await feature("knockoff.matchReturns"))) {
      return NextResponse.json(
        { message: "Returns are not knocked off — switch on \"Knock off returns that name no invoice\" in Settings → Features" },
        { status: 400 },
      );
    }
    const requestedTotal = round2(allocations.reduce((sum, a) => sum + Number(a.amount), 0));

    // Signed comparison by magnitude: a receipt cannot allocate more than it
    // received, and a debit-note JV cannot allocate more than it debited.
    if (Math.abs(requestedTotal) > Math.abs(lineAmount) + 0.01) {
      return NextResponse.json(
        {
          message: `Allocation total (${requestedTotal}) exceeds this voucher line's amount (${lineAmount})`,
        },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Supersede every active allocation on the whole group, not just the
      // slice that was clicked — this replaces the line's entire settlement.
      await tx.invoiceKnockoff.updateMany({
        where: { source_line_id: { in: sliceIds }, reversed_at: null },
        data: { reversed_at: new Date(), reversed_by: userId },
      });

      const created = [];
      for (const a of allocations) {
        created.push(
          await upsertGroupAllocation(tx, {
            sliceIds,
            rootId: root.id,
            invoiceNo: a.invoice_no,
            acno: root.acno,
            amount: a.amount,
            mode: "set",
            data: {
              source_tran_id: root.tran_id,
              source_type: sourceTypeFromTranCode(tranCode),
              source_acno: root.acno,
              is_manual: true,
              run_id: null,
              created_by: userId,
            },
          }),
        );
      }
      // Reshape the posted rows into one row per invoice just allocated.
      await resyncLineSplit(tx, root.id);

      return created;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error creating manual invoice knock-off:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save manual allocation", error: error.message },
      { status: 500 },
    );
  }
});
