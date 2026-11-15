import { jsPDF } from "jspdf";

export const generateBOMPDF = (
  bomList = [],
  session = null,
  company = null,
) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const W = 210;
  const m = 10;

  const maroon = [128, 0, 32];
  const titleGray = [100, 100, 100];
  const headerGray = [220, 220, 220];
  const lightGray = [245, 245, 245];
  const border = [100, 100, 100];

  let y = 0;

  // ===== HEADER =====
  const drawHeader = () => {
    const topGap = 5;
    const barHeight = 14;
    const centerX = m + (W - 2 * m) / 2;

    // ===== TOP MAROON BAR =====
    doc.setFillColor(...maroon);
    doc.rect(m, topGap, W - 2 * m, barHeight, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(company?.name, centerX, topGap + barHeight / 2 + 2, {
      align: "center",
    });

    y = topGap + barHeight + 5;

    // ===== BILL OF MATERIAL (HEADING) =====
    const titleBoxH = 12;
    doc.setFillColor(...titleGray);
    doc.rect(m, y, W - 2 * m, titleBoxH, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("BILL OF MATERIALS", centerX, y + titleBoxH / 2 + 2, {
      align: "center",
    });

    y += titleBoxH + 5;

    // ===== PRINT INFO BOX (LEFT) =====
    const boxW = 70;
    const boxH = 10;

    const printedBy = session?.user?.name || "N/A";
    const printedOn =
      new Date().toLocaleDateString("en-GB") +
      " " +
      new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

    doc.setFillColor(230, 230, 230);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.rect(m, y, boxW, boxH, "DF");

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`Printed On:`, m + 3, y + 4);
    doc.text(`Printed By:`, m + 3, y + 8);

    doc.setFont("helvetica", "normal");
    doc.text(printedOn, m + 25, y + 4);
    doc.text(printedBy, m + 25, y + 8);

    y += boxH + 5;
  };

  const checkPage = (needed) => {
    if (y + needed >= 280) {
      doc.addPage();
      drawHeader();
    }
  };

  const drawBOM = (bom) => {
    const rowH = 8;
    let x = m;

    const bomLabelW = 22;
    const bomValueW = 35;
    const middleW = 83;
    const dateLabelW = 20;
    const dateValueW = 30;

    checkPage(50);

    // ---- BOM Row 1: BOM# and Date ----
    doc.setFillColor(200, 200, 200);
    doc.rect(x, y, bomLabelW, rowH, "FD");
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("BOM#", x + bomLabelW / 2, y + 5.5, { align: "center" });

    x += bomLabelW;

    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, bomValueW, rowH, "FD");
    doc.setFont("helvetica", "normal");
    doc.text(bom.bomNo || "N/A", x + bomValueW / 2, y + 5.5, {
      align: "center",
    });
    x += bomValueW;

    doc.setFillColor(200, 200, 200);
    doc.rect(x, y, middleW, rowH, "FD");

    // "User" label
    doc.setFont("helvetica", "bold");
    doc.text("User", x + middleW / 7, y + 5.5, { align: "center" });

    // User value
    doc.setFont("helvetica", "normal");
    const userName = String(bom.user || "N/A");
    doc.text(userName, x + middleW / 2, y + 5.5, { align: "center" });

    x += middleW;

    doc.setFillColor(200, 200, 200);
    doc.rect(x, y, dateLabelW, rowH, "FD");
    doc.setFont("helvetica", "bold");
    doc.text("Date", x + dateLabelW / 2, y + 5.5, { align: "center" });
    x += dateLabelW;

    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, dateValueW, rowH, "FD");
    doc.setFont("helvetica", "normal");
    doc.text(bom.bomDate || "N/A", x + dateValueW / 2, y + 5.5, {
      align: "center",
    });

    y += rowH;

    // ---- BOM Row 2: Product Info ----
    x = m;

    doc.setFillColor(200, 200, 200);
    doc.rect(x, y, bomLabelW, rowH, "FD");
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Product", x + bomLabelW / 2, y + 5.5, { align: "center" });
    x += bomLabelW;

    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, bomValueW, rowH, "FD");
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(bom.productNo || "N/A", x + bomValueW / 2, y + 5.5, {
      align: "center",
    });
    x += bomValueW;

    const restW = W - 2 * m - bomLabelW - bomValueW;
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, restW, rowH, "FD");

    // Job No
    doc.setFont("helvetica", "normal");
    doc.text(bom.jobNo || "N/A", x + 5, y + 5.5);

    // Product Name (bold)
    doc.setFont("helvetica", "bold");
    const productText = bom.productName || "N/A";
    // Truncate if too long
    const maxProductLength = 50;
    const displayProduct =
      productText.length > maxProductLength
        ? productText.substring(0, maxProductLength) + "..."
        : productText;
    doc.text(displayProduct, x + 35, y + 5.5);

    y += rowH;

    // ---- Category Row (New) ----
    // if (bom.productCategory) {
    //   x = m;
    //   doc.setFillColor(200, 200, 200);
    //   doc.rect(x, y, bomLabelW, rowH, "FD");
    //   doc.setFont("helvetica", "bold");
    //   doc.text("Category", x + bomLabelW / 2, y + 5.5, { align: "center" });
    //   x += bomLabelW;

    //   doc.setFillColor(255, 255, 255);
    //   doc.rect(x, y, W - 2 * m - bomLabelW, rowH, "FD");
    //   doc.setFont("helvetica", "normal");
    //   doc.text(bom.productCategory, x + 5, y + 5.5);

    //   y += rowH;
    // }

    // ---- Table Header ----
    const colW = [22, 138, 30];
    const headerH = 8;
    x = m;

    doc.setFillColor(...headerGray);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");

    doc.rect(x, y, colW[0], headerH, "D");
    doc.text("MM#", x + colW[0] / 2, y + 5.5, { align: "center" });
    x += colW[0];

    doc.rect(x, y, colW[1], headerH, "D");
    doc.text("Description", x + colW[1] / 2, y + 5.5, { align: "center" });
    x += colW[1];

    doc.rect(x, y, colW[2], headerH, "D");
    doc.text("Percentage", x + colW[2] / 2, y + 5.5, { align: "center" });
    y += headerH;

    // y += headerH;

    // ---- Items ----
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    if (!bom.items || bom.items.length === 0) {
      // No items - show message
      const noItemsH = 10;
      doc.setFillColor(255, 255, 200);
      doc.rect(m, y, W - 2 * m, noItemsH, "FD");
      doc.setFont("helvetica", "italic");
      doc.text("No materials found for this BOM", m + (W - 2 * m) / 2, y + 6, {
        align: "center",
      });
      y += noItemsH;
    } else {
      bom.items.forEach((item, index) => {
        const itemRowH = 7;

        // Check if we need a new page
        checkPage(itemRowH);

        if (index % 2 === 0) {
          doc.setFillColor(...lightGray);
          doc.rect(m, y, W - 2 * m, itemRowH, "F");
        }

        x = m;
        doc.rect(x, y, colW[0], itemRowH, "D");
        doc.text(item.mm || "N/A", x + colW[0] / 2, y + 4.5, {
          align: "center",
        });
        x += colW[0];

        // Code block hata do, sirf Description rakho
        doc.rect(x, y, colW[1], itemRowH, "D");
        // const desc = item.desc || "N/A";
        // const maxDescLength = 70; // ✅ zyada characters ab
        // const displayDesc =
        //   desc.length > maxDescLength
        //     ? desc.substring(0, maxDescLength) + "..."
        //     : desc;
        // doc.text(displayDesc, x + 2, y + 4.5);
        x += colW[1];
        // Percentage Column
doc.rect(x, y, colW[2], itemRowH, "D");
doc.text(
  `${item.pct ?? 0}%`,
  x + colW[2] / 2,
  y + 4.5,
  { align: "center" }
);

        doc.rect(x, y, colW[2], itemRowH, "D");
        doc.text(String(`${item.pct}%` || "0"), x + colW[2] / 2, y + 4.5, {
          align: "center",
        });

        y += itemRowH;
      });
    }

    y += 10; // space before next BOM
  };

  // Start document
  drawHeader();

  // Draw each BOM
  if (!bomList || bomList.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(12);
    doc.text("No BOM data available", W / 2, y + 20, { align: "center" });
  } else {
    bomList.forEach((bom) => drawBOM(bom));
  }

  return doc;
};
