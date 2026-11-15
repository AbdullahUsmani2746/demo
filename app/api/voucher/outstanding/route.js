import { NextResponse } from "next/server";
import {
  getCustomerOutstanding,
  getVendorOutstanding,
} from "@/lib/ledger/outstandingInvoices";

// ============================================================
// Outstanding invoices — Customer (receivables) & Vendor (payables)
// ------------------------------------------------------------
// type=customer (default): Sale Invoices outstanding for a customer.
// type=vendor: Purchase Invoices outstanding for a vendor.
//
// The actual queries live in lib/ledger/outstandingInvoices.js so
// they can be shared with the auto-matching engine
// (lib/ledger/invoiceMatcher.js) — see that file for the exact
// invoice-discovery / settlement-netting logic.
// ============================================================

export async function GET(req) {
  try {
    const url = new URL(req.url);
    // type: "customer" (default) or "vendor"
    const type = (url.searchParams.get("type") || "customer").toLowerCase();
    // account: the customer/vendor acno. Accept legacy "customer" param too.
    const account =
      url.searchParams.get("account") || url.searchParams.get("customer");

    if (!account) {
      return NextResponse.json(
        { message: "Account number is required" },
        { status: 400 }
      );
    }

    if (type !== "customer" && type !== "vendor") {
      return NextResponse.json(
        { message: "type must be 'customer' or 'vendor'" },
        { status: 400 }
      );
    }

    const accountNumber = Number(account);

    const agingReport =
      type === "vendor"
        ? await getVendorOutstanding(accountNumber)
        : await getCustomerOutstanding(accountNumber);

    const transformedInvoices = agingReport.map((row) => ({
      id: row.tran_id,
      tran_id: row.tran_id,
      partyName: row.party_name,
      partyCode: Number(row.party_code),
      // Backwards-compatible aliases (existing callers used customer*)
      customerName: row.party_name,
      customerCode: Number(row.party_code),
      invoiceno: row.invoice_no,
      invoicedate: row.dated,
      vrNo: row.vr_no,
      grossamount: Number(row.invoice_amount),
      totalAdjusted: Number(row.total_adjusted),
      remainingbalance: Number(row.outstanding),
      daysOutstanding: Number(row.days_outstanding),
      original: row,
    }));

    return NextResponse.json({
      success: true,
      type,
      data: transformedInvoices,
      total: transformedInvoices.length,
      message: `Found ${transformedInvoices.length} outstanding invoices`,
    });

  } catch (error) {
    console.error("Error fetching outstanding invoices:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to fetch outstanding invoices",
        error: error.message,
      },
      { status: 500 }
    );
  }
}
