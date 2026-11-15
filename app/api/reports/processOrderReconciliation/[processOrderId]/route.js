import { NextResponse } from "next/server";
import { getSingleProcessOrderReconciliationData } from "@/lib/reports/processOrderReconciliation";

export async function GET(request, { params }) {
  try {
    const { processOrderId } = await params;
    const { searchParams } = new URL(request.url);

    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    const payload = await getSingleProcessOrderReconciliationData(processOrderId, {
      dateFrom,
      dateTo,
    });

    if (!payload) {
      return NextResponse.json({ error: "Process order not found for selected filters" }, { status: 404 });
    }

    return NextResponse.json({
      processOrder: payload.selectedProcessOrder,
      report: {
        reportTitle: payload.reportTitle,
        companyName: payload.companyName,
        categoryLabel: payload.categoryLabel,
        categoryValue: payload.categoryValue,
        dateRangeLabel: payload.dateRangeLabel,
      },
    });
  } catch (error) {
    console.error("Error fetching process order details:", error);
    return NextResponse.json(
      { error: "Failed to fetch process order details", details: error.message },
      { status: 500 }
    );
  }
}
