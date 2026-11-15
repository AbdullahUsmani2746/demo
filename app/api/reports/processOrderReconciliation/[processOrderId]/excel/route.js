import { NextResponse } from "next/server";
import XLSX from "xlsx-js-style";
import { getSingleProcessOrderReconciliationData } from "@/lib/reports/processOrderReconciliation";

export async function GET(request, { params }) {
  try {
    const { processOrderId } = await params;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    const payload = await getSingleProcessOrderReconciliationData(processOrderId, { dateFrom, dateTo });

    if (!payload) {
      return NextResponse.json({ error: "Process order not found for selected filters" }, { status: 404 });
    }

    const block = payload.selectedProcessOrder;
    const workbook = XLSX.utils.book_new();

    const dataRows = block.items.map((item) => ({
      "MM#": item.mm,
      "Material Description": item.materialDescription,
      "Ink Code": item.code,
      Issuance: item.issuance,
      Production: item.production,
      Var: item.variance,
    }));

    dataRows.push({
      "MM#": "",
      "Material Description": "Process Order Total",
      "Ink Code": "",
      Issuance: block.totals.issuance,
      Production: block.totals.production,
      Var: block.totals.variance,
    });

    const ws = XLSX.utils.json_to_sheet(dataRows, { origin: "A3" });
    XLSX.utils.sheet_add_aoa(ws, [[`Process Order ${block.processOrder}`]], { origin: "A1" });
    XLSX.utils.sheet_add_aoa(ws, [[`Date ${new Date(block.date).toLocaleDateString("en-GB")}`]], { origin: "A2" });

    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:F1");
    ws["!cols"] = [
      { wch: 14 },
      { wch: 45 },
      { wch: 20 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
    ];

    const headerCells = ["A3", "B3", "C3", "D3", "E3", "F3"];
    headerCells.forEach((cell) => {
      if (ws[cell]) {
        ws[cell].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "808080" } },
          alignment: { horizontal: "center", vertical: "center" },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } },
          },
        };
      }
    });

    for (let r = 4; r <= range.e.r + 1; r++) {
      ["A", "B", "C", "D", "E", "F"].forEach((col) => {
        const ref = `${col}${r}`;
        if (!ws[ref]) return;
        ws[ref].s = {
          font: { bold: r === range.e.r + 1 },
          alignment: {
            horizontal: ["A", "B", "C"].includes(col) ? "left" : "right",
            vertical: "center",
          },
          border: {
            top: { style: "thin", color: { rgb: "C0C0C0" } },
            bottom: { style: "thin", color: { rgb: "C0C0C0" } },
            left: { style: "thin", color: { rgb: "C0C0C0" } },
            right: { style: "thin", color: { rgb: "C0C0C0" } },
          },
        };
      });
    }

    XLSX.utils.book_append_sheet(workbook, ws, "Process Order");
    const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=process-order-${processOrderId}.xlsx`,
      },
    });
  } catch (error) {
    console.error("Error generating single process order Excel:", error);
    return NextResponse.json(
      { error: "Failed to generate process order Excel", details: error.message },
      { status: 500 }
    );
  }
}
