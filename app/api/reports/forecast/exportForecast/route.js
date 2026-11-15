import { NextResponse } from "next/server";
import XLSX from "xlsx-js-style";

export async function POST(req) {
  try {
    const body = await req.json();
    const { headers, rows, title } = body;

    const aoa = [
      [title],  
      headers,  
      ...rows, 
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // -------------MERGES----------------
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    ];

    // ----------- TITLE --------------------
    ws["A1"].s = {
      font: { bold: true, sz: 20, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center" },
      fill: { fgColor: { rgb: "800000" } },
    };

    // --------------HEADER ROW--------------------
    const headerStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "800000" } },
      alignment: { horizontal: "center" },
      border: {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      },
    };

    const HEADER_ROW = 1;

    headers.forEach((_, i) => {
      const cell = XLSX.utils.encode_cell({ r: HEADER_ROW, c: i });
      if (ws[cell]) ws[cell].s = headerStyle;
    });

    // ---------------DATA ROWS--------------
    const DATA_START = 2;

    rows.forEach((row, rIndex) => {
      row.forEach((_, cIndex) => {
        const cell = XLSX.utils.encode_cell({
          r: DATA_START + rIndex,
          c: cIndex,
        });

        if (!ws[cell]) return;

        ws[cell].s = {
          alignment: { horizontal: "center" },
          fill: {
            fgColor: { rgb: rIndex % 2 === 0 ? "F9F9F9" : "FFFFFF" },
          },
          border: {
            top: { style: "thin", color: { rgb: "DDDDDD" } },
            bottom: { style: "thin", color: { rgb: "DDDDDD" } },
            left: { style: "thin", color: { rgb: "DDDDDD" } },
            right: { style: "thin", color: { rgb: "DDDDDD" } },
          },
        };
      });
    });

    // ------GENERATE EXCEL FILE-----------------------
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Forecast");

    const excelBuffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        "Content-Disposition":
          `attachment; filename="Sales_Forecast_${Date.now()}.xlsx"`,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to generate Excel" },
      { status: 500 }
    );
  }
}
