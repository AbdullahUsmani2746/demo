import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { documentsScopeError } from "@/lib/auth/documentScope";
import { checkPeriodLock } from "@/lib/periodLock";
import { lockInvoiceSeries, invoiceNoConflict } from "@/lib/invoicing/core";
import { docLabelOf, isInvoicedMaster } from "@/lib/invoicing/kinds";

// ============================================================
// POST /api/dispatch-invoicing/edit
// ============================================================
// Body: { tran_id, invoice_no?, vehicle?, narration? }
//
// Direct correction of an invoiced dispatch's header without unlocking it.
// Only the fields present in the body are touched.
//   invoice_no — only on a dispatch that is already invoiced; must be unique
//                among sale invoices (tran_code 6, case-insensitive, trimmed),
//                checked under the same per-series lock Invoicing generates
//                under (lib/invoicing/core.js). There is no E / M series any
//                more; invoice_series is left as it is.
//   vehicle    → rmk4
//   narration  → rmk
// ============================================================

const MAX_INVOICE_NO_LENGTH = 150;

export const POST = guard("dispatch.invoice", async (req, { session }) => {
  try {
    const body = await req.json();
    const id = Number(body?.tran_id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ message: "A numeric tran_id is required" }, { status: 400 });
    }

    const scopeError = await documentsScopeError(session, prisma, [id]);
    if (scopeError) return NextResponse.json({ message: scopeError }, { status: 403 });

    const master = await prisma.transactionsMaster.findFirst({
      where: { tran_id: id, tran_code: 6 },
      select: { tran_id: true, dated: true, invoice_no: true, invoice_series: true },
    });
    if (!master) return NextResponse.json({ message: "Dispatch not found" }, { status: 404 });

    const lockError = await checkPeriodLock(master.dated, 6, { action: "update" });
    if (lockError) return NextResponse.json({ message: lockError }, { status: 422 });

    const data = {};
    if (body.vehicle !== undefined) data.rmk4 = String(body.vehicle ?? "").trim() || null;
    if (body.narration !== undefined) data.rmk = String(body.narration ?? "").trim() || null;

    if (body.invoice_no !== undefined) {
      if (!isInvoicedMaster(master)) {
        return NextResponse.json(
          { message: "This dispatch is not invoiced yet — generate the invoice first, then edit the number." },
          { status: 422 },
        );
      }
      const newNo = String(body.invoice_no ?? "").trim();
      if (!newNo) return NextResponse.json({ message: "Invoice number cannot be empty" }, { status: 400 });
      if (newNo.length > MAX_INVOICE_NO_LENGTH) {
        return NextResponse.json(
          { message: `Invoice number is longer than ${MAX_INVOICE_NO_LENGTH} characters` },
          { status: 400 },
        );
      }
      if (newNo !== String(master.invoice_no ?? "").trim()) data.invoice_no = newNo;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: "Nothing to change" }, { status: 400 });
    }

    const conflict = await prisma.$transaction(async (tx) => {
      if (data.invoice_no) {
        await lockInvoiceSeries(tx, 6);
        const clash = await invoiceNoConflict(tx, 6, data.invoice_no, id);
        if (clash) return clash;
        // Receipts are knocked off against the number (party + invoice_no):
        // renaming would orphan them.
        const knocked = await tx.invoiceKnockoff.count({ where: { invoice_tran_id: id, reversed_at: null } });
        if (knocked) {
          throw Object.assign(
            new Error(`Invoice ${master.invoice_no} has ${knocked} receipt allocation(s) — reverse them before renumbering.`),
            { statusCode: 422 },
          );
        }
      }
      await tx.transactionsMaster.update({ where: { tran_id: id }, data });
      return null;
    });

    if (conflict) {
      return NextResponse.json(
        { message: `Invoice ${data.invoice_no} is already used by ${docLabelOf(conflict, "sale")}` },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      message: data.invoice_no ? `Invoice changed from ${master.invoice_no} to ${data.invoice_no}` : "Dispatch updated",
    });
  } catch (error) {
    console.error("dispatch-invoicing edit error:", error);
    if (error?.statusCode === 422) return NextResponse.json({ message: error.message }, { status: 422 });
    return NextResponse.json({ message: "Failed to update dispatch", error: error.message }, { status: 500 });
  }
});
