// app/api/voucher/generate-pdf/route.js
import { NextResponse } from 'next/server';
import { generateVoucherPDF } from '@/components/Template/Payment';
import { generateUnifiedPDF } from '@/components/Template/UnifiedReport';
import { generateSalesOrderPDF } from '@/components/Template/SalesOrder';
import { generatePurchaseOrderPDF } from '@/components/Template/PurchaseOrder';
import { generateSalesTaxInvoicePDF } from '@/components/Template/SalesTaxInvoice';
import prisma from "@/lib/prisma";
import { getCompany } from "@/lib/company";

export async function POST(request) {
  try {
    const { voucherId, type } = await request.json();


    if (!voucherId) {
      return NextResponse.json(
        { message: 'Voucher ID is required' },
        { status: 400 }
      );
    }

    // Fetch voucher data based on type
    let voucherData;
    let apiUrl = '';

    // Determine API endpoint based on type
    if (['purchaseOrder', 'saleOrder'].includes(type)) {
      apiUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/orders/getById?id=${voucherId}`;
    } else if (type === 'grn' || type === 'dispatch') {
      apiUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/material/getById?id=${voucherId}`;
    } else {
      apiUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/voucher/getById?id=${voucherId}`;
    }

    // Fetch voucher data
    const cookies = request.headers.get('cookie') || '';
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'cookie': cookies,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voucher data: ${response.statusText}`);
    }

    const result = await response.json();
    voucherData = result.data;

    if (!voucherData) {
      throw new Error('Voucher data not found');
    }

    // Company settings from the Company table (neutral fallback if unset)
    const companyData = await getCompany();

    // Fetch default currency from database settings
    let currencyData = {
      code: "PKR",
      symbol: "PKR",
      name: "Pakistani Rupee"
    };

    try {
      const currencySetting = await prisma.settings.findUnique({
        where: { key: "currency_default" },
      });
      if (currencySetting) {
        const CURRENCIES = [
          { code: "PKR", symbol: "PKR", name: "Pakistani Rupee" },
          { code: "USD", symbol: "$", name: "US Dollar" },
          { code: "EUR", symbol: "€", name: "Euro" },
          { code: "GBP", symbol: "£", name: "British Pound" },
          { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
          { code: "SAR", symbol: "﷼", name: "Saudi Riyal" },
          { code: "INR", symbol: "₹", name: "Indian Rupee" },
        ];
        const match = CURRENCIES.find((c) => c.code === currencySetting.value);
        if (match) {
          currencyData = match;
        }
      }
    } catch (e) {
      console.error("Error fetching currency settings:", e);
    }

    // Generate PDF based on transaction type
    let pdfDoc;
    const tranCode = voucherData.tran_code || voucherData.order_catagory;

    switch (tranCode) {
      // Financial Vouchers
      case 1: // Receipt
      case 2: // Payment
      case 3: // Journal
        pdfDoc = await generateVoucherPDF(voucherData, companyData, currencyData);
        break;

      // Purchase Operations
      case 4: // Purchase Order
        pdfDoc = await generatePurchaseOrderPDF({ data: [voucherData], company: companyData, currency: currencyData });
        break;

      // Sale Operations
      case 6: // Sale Order / Sale
        if (type === 'sales') {
          pdfDoc = await generateSalesTaxInvoicePDF({ voucher: voucherData, companyData: companyData, currencyData: currencyData });
        } else if (type === 'delivery' || type === 'commission') {
          const mappedData = prepareVoucherForPDF(voucherData, type);
          pdfDoc = generateUnifiedPDF(mappedData);
        } else {
          pdfDoc = await generateSalesOrderPDF({ data: [voucherData] }, null, currencyData, companyData);
        }
        break;

      // Return Operations
      case 9: // Purchase Return
      case 10: // Sale Return
        pdfDoc = await generateVoucherPDF(voucherData, companyData, currencyData);
        break;

      // Inventory Operations
      case 1000: // GRN/Dispatch
        pdfDoc = await generateVoucherPDF(voucherData, companyData, currencyData);
        break;

      default:
        pdfDoc = await generateVoucherPDF(voucherData, companyData, currencyData);
        break;
    }

    // Convert PDF to buffer
    const pdfBuffer = await pdfDoc.output('arraybuffer');

    // Create response with PDF
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="voucher-${voucherId}.pdf"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });

  } catch (error) {
    console.error('PDF generation error:', error);

    return NextResponse.json(
      {
        message: 'Failed to generate PDF',
        error: error.message
      },
      { status: 500 }
    );
  }
}

// Helper function to prepare voucher data for PDF
function prepareVoucherForPDF(voucher, documentType = "sales") {
  const customer = {
    name: voucher.acno?.acname || "Unknown",
    strn: "Not Available",
    ntn: "Not Available",
    address: voucher.godownDetails?.godown || "Not Provided",
  };

  const entries = voucher.transactions
    ?.filter((t) => t.sub_tran_id !== 3)
    .map((t, idx) => {
      const itemName =
        t.itemDetails?.item || t.acnoDetails?.acname || "Unknown";
      const batchNo = t.chno || "-";
      const qty = t.qty ?? 0;
      const unit =
        voucher.tran_code === 1 || voucher.tran_code === 2 ? "" : "KG";
      const rate = t.rate ?? (t.damt || t.camt || 0);
      const amount =
        voucher.tran_code === 1 || voucher.tran_code === 2
          ? t.damt || t.camt || 0
          : (t.qty ?? 0) * (t.rate ?? 0);

      if (documentType === "delivery") {
        return [
          idx + 1,
          itemName,
          batchNo,
          `${t.no_of_pack}x${t.qty_per_pack}=${qty}`,
        ];
      }

      return [idx + 1, itemName, batchNo, qty, unit, rate, amount];
    }) || [];

  const totalAmount = entries.reduce(
    (acc, row) => acc + (row.at(-1) || 0),
    0
  );

  const totalSalesTax =
    voucher.transactions
      ?.filter((t) => t.sub_tran_id !== 3)
      .reduce((acc, t) => {
        const amount =
          voucher.tran_code === 1 || voucher.tran_code === 2
            ? t.damt || t.camt || 0
            : (t.qty ?? 0) * (t.rate ?? 0);
        const taxRate = (t.st_rate ?? 0) + (t.additional_tax ?? 0);
        return acc + amount * (taxRate / 100);
      }, 0) || 0;

  const grandTotal = totalAmount + totalSalesTax;

  const totals = {
    amount: totalAmount,
    tax: { label: "SALES TAX", value: totalSalesTax },
    grandTotal: { label: "GRAND TOTAL", value: grandTotal },
  };

  const invoice = {
    number: voucher.invoice_no || `INV-${voucher.vr_no}`,
    date: voucher.dated
      ? new Date(voucher.dated).toLocaleDateString("en-GB")
      : new Date().toLocaleDateString("en-GB"),
    po: "-",
    dueDate: "30 Days",
  };

  return {
    dated: voucher.dated,
    tran_code: voucher.tran_code,
    vr_no: voucher.vr_no,
    userId: voucher.userId,
    rmk: voucher.rmk,
    rmk1: voucher.rmk1,
    transactions: voucher.transactions,
    acno: voucher.acno,
    documentType,
    customer,
    entries,
    totals,
    invoice,
  };
}

// Optional: GET method for testing
export async function GET(request) {
  return NextResponse.json(
    { message: 'Use POST method to generate PDF' },
    { status: 200 }
  );
}