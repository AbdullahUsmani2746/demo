import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  generateProcessOrderReconciliationPDF,
  getProcessOrderReconciliationData,
} from "@/lib/reports/processOrderReconciliation";

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const processOrder = searchParams.get("processOrder") || undefined;
    const item = searchParams.get("item") || undefined;
    const category = searchParams.get("category") || undefined;

    const payload = await getProcessOrderReconciliationData({
      dateFrom,
      dateTo,
      processOrder,
      item,
      category,
      generatedBy: session?.user?.name || session?.user?.email || "System",
    });
    const doc = generateProcessOrderReconciliationPDF(payload);
    const pdfBuffer = await doc.output("arraybuffer");

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=process-order-reconciliation.pdf",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error generating process order reconciliation PDF:", error);
    return NextResponse.json(
      { error: "Failed to generate process order reconciliation PDF", details: error.message },
      { status: 500 }
    );
  }
}
