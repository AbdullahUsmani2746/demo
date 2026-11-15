import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  generateProcessOrderReconciliationPDF,
  getSingleProcessOrderReconciliationData,
} from "@/lib/reports/processOrderReconciliation";

export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    const { processOrderId } = await params;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    const payload = await getSingleProcessOrderReconciliationData(processOrderId, {
      dateFrom,
      dateTo,
      generatedBy: session?.user?.name || session?.user?.email || "System",
    });

    if (!payload) {
      return NextResponse.json({ error: "Process order not found for selected filters" }, { status: 404 });
    }

    const doc = generateProcessOrderReconciliationPDF(payload);
    const pdfBuffer = await doc.output("arraybuffer");

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=process-order-${processOrderId}.pdf`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error generating single process order PDF:", error);
    return NextResponse.json(
      { error: "Failed to generate process order PDF", details: error.message },
      { status: 500 }
    );
  }
}
