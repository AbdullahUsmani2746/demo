import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// POST - Create Tax Challans (Bulk)
export const POST = guard("taxChallan.manage", async (req) => {
  try {
    const data = await req.json();
    
    // Check if it's bulk creation
    if (data.challans && Array.isArray(data.challans)) {
      // Bulk create
      const createdChallans = await prisma.$transaction(
        data.challans.map((challan) => 
          prisma.taxChallan.create({
            data: {
              receipt_voucher_id: challan.receipt_voucher_id,
              invoice_id: challan.invoice_id,
              customer_acno: challan.customer_acno,
              dated: new Date(challan.dated),
              gross_amount: parseFloat(challan.gross_amount),
              tax_percent: parseFloat(challan.tax_percent),
              tax_amount: parseFloat(challan.tax_amount),
              amount_adjusted: parseFloat(challan.amount_adjusted),
              net_amount: parseFloat(challan.net_amount),
              invoice_no: challan.invoice_no,
              challan_no: challan.challan_no || `TC-${Date.now()}-${challan.customer_acno}-${Math.random().toString(36).substr(2, 5)}`,
              status: challan.status || 'pending'
            }
          })
        )
      );
      
      return NextResponse.json({
        success: true,
        data: createdChallans,
        message: `Created ${createdChallans.length} tax challans`
      }, { status: 201 });
    } else {
      // Single creation (for backward compatibility)
      const challanNo = `TC-${Date.now()}-${data.customer_acno}`;
      
      const taxChallan = await prisma.taxChallan.create({
        data: {
          receipt_voucher_id: data.receipt_voucher_id,
          invoice_id: data.invoice_id,
          customer_acno: data.customer_acno,
          dated: new Date(data.dated),
          gross_amount: parseFloat(data.gross_amount),
          tax_percent: parseFloat(data.tax_percent),
          tax_amount: parseFloat(data.tax_amount),
          amount_adjusted: parseFloat(data.amount_adjusted),
          net_amount: parseFloat(data.net_amount),
          invoice_no: data.invoice_no,
          challan_no: challanNo,
          status: data.status || 'pending'
        }
      });
      
      return NextResponse.json({
        success: true,
        data: taxChallan
      }, { status: 201 });
    }
    
  } catch (error) {
    console.error("Error creating tax challan:", error);
    return NextResponse.json({
      success: false,
      message: "Failed to create tax challan",
      error: error.message
    }, { status: 500 });
  }
});

// GET - Get Tax Challans
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const customer = url.searchParams.get("customer");
    const status = url.searchParams.get("status");
    // const page = parseInt(url.searchParams.get("page") || "1");
    // const limit = parseInt(url.searchParams.get("limit") || "10");
    // const skip = (page - 1) * limit;

    const where = {
      ...(customer && { customer_acno: parseInt(customer) }),
      ...(status && { status })
    };

    const [taxChallans, total] = await Promise.all([
      prisma.taxChallan.findMany({
        where,
        // skip,
        // take: limit,
        orderBy: { dated: 'desc' },
        include: {
          customer: true,
          // invoice: true, // Only if you have this relation
          receiptVoucher: true
        }
      }),
      prisma.taxChallan.count({ where })
    ]);

    // const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data: taxChallans,
      // totalPages,
      // page,
      // limit,
      total
    });

  } catch (error) {
    console.error("Error fetching tax challans:", error);
    return NextResponse.json({
      success: false,
      message: "Failed to fetch tax challans",
      error: error.message
    }, { status: 500 });
  }
}

// PATCH - Update Tax Challan (for marking as paid)
export const PATCH = guard("taxChallan.manage", async (req) => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    
    if (!id) {
      return NextResponse.json({
        success: false,
        message: "Challan ID is required"
      }, { status: 400 });
    }
    
    const data = await req.json();
    
    const updatedChallan = await prisma.taxChallan.update({
      where: { id: parseInt(id) },
      data: {
        status: data.status,
        payment_date: data.status === 'paid' ? new Date() : null,
        challan_no: data.challan_no,
        jv_tran_id: data.jv_tran_id,
        ...(data.payment_date && { payment_date: new Date(data.payment_date) })
      }
    });
    
    return NextResponse.json({
      success: true,
      data: updatedChallan
    });
    
  } catch (error) {
    console.error("Error updating tax challan:", error);
    return NextResponse.json({
      success: false,
      message: "Failed to update tax challan",
      error: error.message
    }, { status: 500 });
  }
});