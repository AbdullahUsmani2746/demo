import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";

export const POST = guard("maintenance.bulkUpdate", async (req, { session }) => {
  try {
    const body = await req.json();
    const { updates } = body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ message: "No updates provided." }, { status: 400 });
    }

    // One $transaction for the whole batch, so refuse it if any voucher is locked
    const targets = await prisma.transactionsMaster.findMany({
      where: { tran_id: { in: updates.map((u) => Number(u.tran_id)) } },
      select: { tran_id: true, dated: true, tran_code: true },
    });
    for (const t of targets) {
      // GRNs, dispatches and their returns get their number from Invoicing
      // (one series, uniqueness, ledger posting) — never typed in here.
      if ([4, 6, 9, 10].includes(t.tran_code)) {
        return NextResponse.json(
          { message: `Voucher #${t.tran_id}: invoice numbers for GRNs, dispatches and returns are set in Invoicing.` },
          { status: 422 },
        );
      }
      const lockError = await checkPeriodLock(t.dated, t.tran_code, { action: "update" });
      if (lockError) {
        return NextResponse.json(
          { message: `Voucher #${t.tran_id}: ${lockError}` },
          { status: 422 },
        );
      }
    }

    // Run all updates in a transaction for data safety
    await prisma.$transaction(  
      updates.map((item) =>
        prisma.transactionsMaster.update({
          where: { tran_id: item.tran_id },
          data: { invoice_no: String(item.invoice_no) },
        })
      )
    );

    return NextResponse.json({
      message: "Invoices updated successfully!",
      updatedCount: updates.length,
    });
  } catch (error) {
    console.error("❌ Error in bulk-update-invoice:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
});
